using System.Collections.Concurrent;
using System.IO;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LocalVault.Core;

namespace LocalVault.Desktop;

// Fetches website icons straight from each site (never a third-party icon service, which would learn every site
// the user has an account on). Results are returned to the page as data: URLs so the page itself stays offline.
// Icons are cached in icons.cache, encrypted with a key derived from the vault key: the file reveals nothing about
// which sites are saved, and it can only be read while the vault is unlocked.
internal sealed partial class SiteIcons(string directory)
{
    private const int MaxBytes = 256 * 1024;
    private const int MaxCacheBytes = 32 * 1024 * 1024;
    private static readonly TimeSpan KeepFound = TimeSpan.FromDays(30), KeepMissing = TimeSpan.FromDays(3);
    private static readonly byte[] Info = "LocalVault icon cache v1"u8.ToArray();
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        UseCookies = false, AllowAutoRedirect = true, MaxAutomaticRedirections = 4,
        ConnectTimeout = TimeSpan.FromSeconds(4), PooledConnectionLifetime = TimeSpan.FromMinutes(2),
    }) { Timeout = TimeSpan.FromSeconds(8), DefaultRequestHeaders = { { "User-Agent", "Mozilla/5.0 LocalVault" } } };
    private static readonly SemaphoreSlim Parallel = new(4);

    private readonly string path = Path.Combine(directory, "icons.cache");
    private readonly object gate = new();
    private readonly ConcurrentDictionary<string, Task<string?>> inflight = new(StringComparer.Ordinal);
    private byte[]? key;
    private Dictionary<string, CachedIcon>? cache;
    private bool saveQueued;

    public bool IsOpen { get { lock (gate) return key != null; } }

    /// <summary>Loads the encrypted cache with a key derived from the vault key. The caller zeroes vaultKey.</summary>
    public void Open(byte[] vaultKey)
    {
        var derived = HKDF.DeriveKey(HashAlgorithmName.SHA256, vaultKey, 32, null, Info);
        var loaded = Load(derived);
        lock (gate) { Close(); key = derived; cache = loaded; }
    }

    public void Close()
    {
        lock (gate)
        {
            if (key != null) CryptographicOperations.ZeroMemory(key);
            key = null; cache = null;
        }
    }

    /// <summary>Forgets every cached icon (icons turned off, or LocalVault reset).</summary>
    public void Clear()
    {
        lock (gate) { cache?.Clear(); if (File.Exists(path)) File.Delete(path); }
    }

    /// <summary>Returns a data: URL for the site's icon, or null when none could be fetched safely.</summary>
    public async Task<string?> Get(string origin)
    {
        lock (gate)
            if (cache != null && cache.TryGetValue(origin, out var hit) && DateTimeOffset.UtcNow - hit.Fetched < (hit.Url != null ? KeepFound : KeepMissing))
                return hit.Url;
        var task = inflight.GetOrAdd(origin, Fetch);
        try
        {
            var url = await task;
            lock (gate)
            {
                if (cache == null) return url;
                cache[origin] = new CachedIcon(url, DateTimeOffset.UtcNow);
                if (!saveQueued) { saveQueued = true; _ = SaveSoon(); }
            }
            return url;
        }
        finally { inflight.TryRemove(new(origin, task)); }
    }

    // Many icons arrive together after unlock; write the file once for the batch.
    private async Task SaveSoon()
    {
        await Task.Delay(750);
        byte[] plaintext, secret;
        lock (gate)
        {
            saveQueued = false;
            if (key == null || cache == null) return;
            plaintext = JsonSerializer.SerializeToUtf8Bytes(cache, Json.Options); secret = key.ToArray();
        }
        try
        {
            if (plaintext.Length > MaxCacheBytes) return;
            var file = new byte[12 + 16 + plaintext.Length];
            RandomNumberGenerator.Fill(file.AsSpan(0, 12));
            using (var aes = new AesGcm(secret, 16)) aes.Encrypt(file.AsSpan(0, 12), plaintext, file.AsSpan(28), file.AsSpan(12, 16), Info);
            lock (gate) if (key != null) LocalFiles.AtomicWrite(path, file, false);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { } // only a cache: icons refetch next time
        finally { CryptographicOperations.ZeroMemory(plaintext); CryptographicOperations.ZeroMemory(secret); }
    }

    private Dictionary<string, CachedIcon> Load(byte[] secret)
    {
        try
        {
            if (!File.Exists(path) || new FileInfo(path).Length is < 28 or > MaxCacheBytes + 28) return new(StringComparer.Ordinal);
            var file = File.ReadAllBytes(path);
            var plaintext = new byte[file.Length - 28];
            using (var aes = new AesGcm(secret, 16)) aes.Decrypt(file.AsSpan(0, 12), file.AsSpan(28), file.AsSpan(12, 16), plaintext, Info);
            var loaded = JsonSerializer.Deserialize<Dictionary<string, CachedIcon>>(plaintext, Json.Options);
            return new(loaded?.Where(e => e.Value.Url == null || e.Value.Url.StartsWith("data:image/", StringComparison.Ordinal)) ?? [], StringComparer.Ordinal);
        }
        // A different vault (after restore or reset) or a damaged file: start an empty cache.
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or CryptographicException or JsonException) { return new(StringComparer.Ordinal); }
    }

    private static async Task<string?> Fetch(string origin)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var site) || site.Scheme != "https") return null;
        await Parallel.WaitAsync();
        try
        {
            // The saved address first, then its main site: account.konami.net → konami.net, account.jumia.com.ng → jumia.com.ng.
            foreach (var host in Hosts(site.IdnHost))
                foreach (var candidate in await Candidates(new UriBuilder("https", host, host == site.IdnHost ? site.Port : -1).Uri) ?? [])
                    if (await Download(candidate) is { } icon) return icon;
            return null;
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException or UriFormatException) { return null; }
        finally { Parallel.Release(); }
    }

    // Last resort for brands whose sign-in lives on another TLD than their website (account.konami.net → konami.com).
    // Only an icon is at stake (never autofill), so a rare unrelated .com match is acceptable.
    internal static string[] Hosts(string host)
    {
        var main = Origin.MainDomain(host);
        if (main == host && (!host.Contains('.') || System.Net.IPAddress.TryParse(host, out _))) return [host];
        var brand = main.Split('.')[0] + ".com";
        return new[] { host, main, "www." + main, brand, "www." + brand }.Distinct(StringComparer.Ordinal).ToArray();
    }

    // Icons declared in the home page's <head>, best first, then the conventional /favicon.ico.
    // Null when the host cannot be reached at all, so its /favicon.ico is not tried (and timed out) as well.
    private static async Task<List<Uri>?> Candidates(Uri site)
    {
        var found = new List<(Uri Uri, int Score)>();
        try
        {
            using var response = await Http.GetAsync(site, HttpCompletionOption.ResponseHeadersRead);
            // Error and sign-in-required pages often still declare the site icon, so the status code is not checked.
            if (response.Content.Headers.ContentType?.MediaType == "text/html")
            {
                var html = Encoding.UTF8.GetString(await Read(response, MaxBytes * 2, truncate: true) ?? []);
                var head = html[..Math.Max(0, html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase) is var end and > 0 ? end : html.Length)];
                var root = response.RequestMessage?.RequestUri ?? site;
                foreach (Match tag in LinkTag().Matches(head))
                {
                    var rel = Attribute(tag.Value, "rel")?.ToLowerInvariant() ?? "";
                    var href = Attribute(tag.Value, "href");
                    if (href == null || !rel.Split(' ').Any(r => r is "icon" or "apple-touch-icon" or "apple-touch-icon-precomposed")) continue;
                    if (!Uri.TryCreate(root, System.Net.WebUtility.HtmlDecode(href), out var uri) || uri.Scheme != "https") continue;
                    var sizes = Attribute(tag.Value, "sizes") ?? "";
                    var declared = Regex.Match(sizes, @"(\d+)x\d+");
                    var size = declared.Success && int.TryParse(declared.Groups[1].Value, out var n) ? n : rel.Contains("apple") ? 180 : 32;
                    var svg = uri.AbsolutePath.EndsWith(".svg", StringComparison.OrdinalIgnoreCase) || Attribute(tag.Value, "type") == "image/svg+xml" || sizes == "any";
                    // Prefer crisp sizes around 64–192px; scalable SVG ranks high, huge bitmaps rank low.
                    found.Add((uri, svg ? 500 : size is >= 48 and <= 256 ? 300 + size : size < 48 ? size : 100));
                }
            }
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException) { return null; }
        return found.OrderByDescending(f => f.Score).Select(f => f.Uri).Take(4).Append(new Uri(site, "/favicon.ico")).Distinct().ToList();
    }

    private static async Task<string?> Download(Uri uri)
    {
        try
        {
            using var response = await Http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead);
            if (!response.IsSuccessStatusCode || response.RequestMessage?.RequestUri?.Scheme != "https") return null;
            var bytes = await Read(response, MaxBytes);
            var type = bytes == null ? null : Sniff(bytes);
            return type == null ? null : $"data:{type};base64,{Convert.ToBase64String(bytes!)}";
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or IOException) { return null; }
    }

    private static async Task<byte[]?> Read(HttpResponseMessage response, int limit, bool truncate = false)
    {
        if (!truncate && response.Content.Headers.ContentLength > limit) return null;
        await using var stream = await response.Content.ReadAsStreamAsync();
        using var buffer = new MemoryStream();
        var chunk = new byte[16384];
        for (int read; (read = await stream.ReadAsync(chunk)) > 0;)
        {
            buffer.Write(chunk, 0, read);
            if (buffer.Length > limit) return truncate ? buffer.ToArray()[..limit] : null;
        }
        return buffer.ToArray();
    }

    // Trust the bytes, not the server's Content-Type. SVG is shown through <img>, where scripts never run.
    private static string? Sniff(byte[] b)
    {
        if (b.Length < 8) return null;
        if (b[0] == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return "image/png";
        if (b[0] == 0 && b[1] == 0 && b[2] == 1 && b[3] == 0) return "image/x-icon";
        if (b[0] == 'G' && b[1] == 'I' && b[2] == 'F') return "image/gif";
        if (b[0] == 0xFF && b[1] == 0xD8) return "image/jpeg";
        if (b.Length > 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "image/webp";
        var text = Encoding.UTF8.GetString(b, 0, Math.Min(b.Length, 512)).TrimStart('﻿', ' ', '\r', '\n', '\t');
        return text.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) || (text.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase) && text.Contains("<svg", StringComparison.OrdinalIgnoreCase)) ? "image/svg+xml" : null;
    }

    private static string? Attribute(string tag, string name)
    {
        var match = Regex.Match(tag, $@"\b{name}\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s>]+))", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Success ? match.Groups[2].Value : match.Groups[3].Value : null;
    }

    [GeneratedRegex(@"<link\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex LinkTag();
}

internal sealed record CachedIcon(string? Url, DateTimeOffset Fetched);
