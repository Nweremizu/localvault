using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using Zxcvbn;

namespace LocalVault.Core;

public sealed record PasswordSecret(Guid Id, string Title, string Password);
public sealed record SecurityFinding(Guid Id, string Title, int? Score, bool Weak, bool Reused, bool Assessed);
public sealed record SecurityReport(int Total, int Weak, int Reused, int NotAssessed, SecurityFinding[] Findings);
public sealed record BreachFinding(Guid Id, string Title, string State, int? Count);

public static class SecurityChecks
{
    public static SecurityReport Analyze(IReadOnlyList<Entry> entries)
    {
        var accounts = entries.Where(e => e.Type == "login" && e.DeletedAt == null).ToArray();
        var duplicatePasswords = accounts.GroupBy(e => e.Password, StringComparer.Ordinal).Where(g => g.Count() > 1)
            .SelectMany(g => g.Select(e => e.Id)).ToHashSet();
        var findings = accounts.Select(e =>
        {
            if (e.Password.Length > 1024) return new SecurityFinding(e.Id, e.Title, null, false, duplicatePasswords.Contains(e.Id), false);
            var score = Zxcvbn.Core.EvaluatePassword(e.Password, Array.Empty<string>()).Score;
            return new SecurityFinding(e.Id, e.Title, score, score <= 2, duplicatePasswords.Contains(e.Id), true);
        }).ToArray();
        return new SecurityReport(findings.Length, findings.Count(f => f.Weak), findings.Count(f => f.Reused),
            findings.Count(f => !f.Assessed), findings);
    }
}

public sealed class PwnedPasswords : IDisposable
{
    private const int MaxResponseBytes = 256 * 1024;
    private readonly HttpClient http;
    private readonly bool ownsClient;
    private readonly SemaphoreSlim concurrency = new(4, 4);

    public PwnedPasswords(HttpClient? client = null)
    {
        if (client != null) { http = client; return; }
        var handler = new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, ConnectTimeout = TimeSpan.FromSeconds(8) };
        http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(12) };
        ownsClient = true;
    }

    public async Task<BreachFinding[]> CheckAsync(IReadOnlyList<PasswordSecret> passwords, CancellationToken cancellationToken)
    {
        using var cache = new RangeCache(this);
        var pending = passwords.Select(async item =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (prefix, suffix) = HashParts(item.Password);
            var range = await cache.Get(prefix, cancellationToken).ConfigureAwait(false);
            if (range == null) return new BreachFinding(item.Id, item.Title, "unavailable", null);
            return range.TryGetValue(suffix, out var count)
                ? new BreachFinding(item.Id, item.Title, "found", count)
                : new BreachFinding(item.Id, item.Title, "notFound", 0);
        }).ToArray();
        return await Task.WhenAll(pending).ConfigureAwait(false);
    }

    private async Task<Dictionary<string, int>?> Fetch(string prefix, CancellationToken token)
    {
        await concurrency.WaitAsync(token).ConfigureAwait(false);
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, "https://api.pwnedpasswords.com/range/" + prefix);
            request.Headers.Add("Add-Padding", "true");
            request.Headers.UserAgent.ParseAdd("LocalVault/0.2.0");
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, token).ConfigureAwait(false);
            if (response.StatusCode != HttpStatusCode.OK || response.Content.Headers.ContentLength is > MaxResponseBytes) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(token).ConfigureAwait(false);
            using var output = new MemoryStream();
            var chunk = new byte[8192];
            while (true)
            {
                var read = await stream.ReadAsync(chunk, token).ConfigureAwait(false);
                if (read == 0) break;
                if (output.Length + read > MaxResponseBytes) return null;
                output.Write(chunk, 0, read);
            }
            var rows = Encoding.ASCII.GetString(output.GetBuffer(), 0, (int)output.Length).Split('\n');
            if (rows.Length > 1200) return null;
            var result = new Dictionary<string, int>(StringComparer.Ordinal);
            var parsedRows = 0;
            foreach (var line in rows)
            {
                var trimmed = line.TrimEnd('\r');
                if (trimmed.Length == 0) continue;
                var parts = trimmed.Split(':');
                if (parts.Length != 2 || parts[0].Length != 35 || parts[0].Any(c => !Uri.IsHexDigit(c)) ||
                    !int.TryParse(parts[1], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var count)) return null;
                parsedRows++;
                if (count > 0) result[parts[0]] = count;
            }
            if (parsedRows == 0) return null;
            return result;
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception ex) when (ex is HttpRequestException or IOException or TaskCanceledException or InvalidDataException)
        { return null; }
        finally { concurrency.Release(); }
    }

    private static (string Prefix, string Suffix) HashParts(string password)
    {
        var bytes = Encoding.UTF8.GetBytes(password);
        try
        {
            Span<byte> hash = stackalloc byte[20];
            SHA1.HashData(bytes, hash);
            var hex = Convert.ToHexString(hash);
            CryptographicOperations.ZeroMemory(hash);
            return (hex[..5], hex[5..]);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    public void Dispose()
    {
        if (ownsClient) http.Dispose();
        concurrency.Dispose();
    }

    private sealed class RangeCache(PwnedPasswords owner) : IDisposable
    {
        private readonly ConcurrentDictionary<string, Lazy<Task<Dictionary<string, int>?>>> ranges = new(StringComparer.Ordinal);
        public Task<Dictionary<string, int>?> Get(string prefix, CancellationToken token) =>
            ranges.GetOrAdd(prefix, p => new Lazy<Task<Dictionary<string, int>?>>(() => owner.Fetch(p, token), LazyThreadSafetyMode.ExecutionAndPublication)).Value;
        public void Dispose() => ranges.Clear();
    }
}
