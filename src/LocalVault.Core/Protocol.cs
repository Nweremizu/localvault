using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;

namespace LocalVault.Core;

public sealed record BrowserRequest
{
    public int Version { get; init; }
    public string Id { get; init; } = "";
    public string Operation { get; init; } = "";
    public string Client { get; init; } = "";
    public string Token { get; init; } = "";
    public string Profile { get; init; } = "";
    public string Code { get; init; } = "";
    public string Origin { get; init; } = "";
    public Guid? EntryId { get; init; }
    public int Offset { get; init; }
    public string Username { get; init; } = "";
    public string Password { get; init; } = "";
}

public sealed record BrowserResponse(string Id, bool Ok, string Error, object? Data = null)
{
    public int Version => 1;
    public static BrowserResponse Fail(string id, string message) => new(id, false, message);
}

public static class Frames
{
    public const int MaxBytes = 128 * 1024;
    public static async Task<byte[]?> Read(Stream stream, CancellationToken cancellation = default)
    {
        var header = new byte[4];
        var first = await stream.ReadAsync(header.AsMemory(0, 1), cancellation);
        if (first == 0) return null;
        await stream.ReadExactlyAsync(header.AsMemory(1), cancellation);
        var length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is <= 0 or > MaxBytes) throw new InvalidDataException("Invalid message size.");
        var bytes = new byte[length];
        try { await stream.ReadExactlyAsync(bytes, cancellation); return bytes; }
        catch { CryptographicOperations.ZeroMemory(bytes); throw; }
    }

    public static async Task Write(Stream stream, byte[] bytes, CancellationToken cancellation = default)
    {
        if (bytes.Length is <= 0 or > MaxBytes) throw new InvalidDataException("Invalid message size.");
        var header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        await stream.WriteAsync(header, cancellation);
        await stream.WriteAsync(bytes, cancellation);
        await stream.FlushAsync(cancellation);
    }

    public static BrowserRequest Parse(byte[] bytes)
    {
        var request = JsonSerializer.Deserialize<BrowserRequest>(bytes, Json.Options)
            ?? throw new InvalidDataException("Invalid message.");
        if (request.Version != 1 || request.Id.Length is 0 or > 64 || request.Client.Length > 128 ||
            request.Token.Length > 128 || request.Profile.Length > 80 || request.Code.Length > 6 ||
            request.Origin.Length > 2048 || request.Username.Length > 4096 || request.Password.Length > 16384 || request.Offset is < 0 or > 10000 ||
            request.Operation is not ("pair" or "status" or "unlock" or "matches" or "get" or "save"))
            throw new InvalidDataException("Invalid message fields or protocol version.");
        return request;
    }
}

public sealed record BrowserIdentity(string ChromiumId, string ChromiumKey, string FirefoxId)
{
    public static BrowserIdentity Load() => JsonSerializer.Deserialize<BrowserIdentity>(
        File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "browser-identity.json")), Json.Options)
        ?? throw new InvalidDataException("Missing browser identities.");
    public bool Allows(string id) => id == ChromiumId || id == FirefoxId;
    public string InvocationClient(string[] args)
    {
        if (args.Length >= 1 && args[0] == "chrome-extension://" + ChromiumId + "/") return ChromiumId;
        if (args.Length >= 2 && args[1] == FirefoxId &&
            string.Equals(Path.GetFullPath(args[0]), Path.Combine(AppContext.BaseDirectory, "firefox-host.json"), StringComparison.OrdinalIgnoreCase)) return FirefoxId;
        throw new UnauthorizedAccessException("Unrecognized browser extension.");
    }
}

public sealed record Pairing(Guid Id, string Client, string Profile, string TokenHash, DateTimeOffset Created);

public sealed class Pairings
{
    private readonly string path;
    private List<Pairing> items;
    public bool WasDamaged { get; private set; }
    public Pairings(string directory)
    {
        path = Path.Combine(directory, "pairings.json");
        try
        {
            if (File.Exists(path) && new FileInfo(path).Length > 128 * 1024) throw new InvalidDataException("Invalid pairing file.");
            items = File.Exists(path) ? JsonSerializer.Deserialize<List<Pairing>>(File.ReadAllBytes(path), Json.Options)
                ?? throw new InvalidDataException("Invalid pairing file.") : [];
            if (items.Count > 32 || items.Any(p => p is null || p.Id == Guid.Empty || p.Profile.Length > 80 || p.Client.Length > 128 ||
                p.TokenHash.Length != 64 || p.TokenHash.Any(c => !char.IsAsciiHexDigit(c))))
                throw new InvalidDataException("Invalid pairing file.");
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or JsonException or UnauthorizedAccessException)
        { items = []; WasDamaged = true; }
    }
    public IReadOnlyList<Pairing> Snapshot() => items.ToArray();
    public string Add(string client, string profile)
    {
        if (items.Count >= 32) throw new InvalidOperationException("Revoke an old browser pairing first (maximum 32).");
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
        var next = items.Append(new Pairing(Guid.NewGuid(), client, profile, Hash(token), DateTimeOffset.UtcNow)).ToList();
        Save(next); return token;
    }
    public bool Verify(string client, string token)
    {
        if (token.Length != 64) return false;
        var hash = Convert.FromHexString(Hash(token));
        return items.Any(p => p.Client == client &&
            CryptographicOperations.FixedTimeEquals(Convert.FromHexString(p.TokenHash), hash));
    }
    public void Revoke(Guid id) => Save(items.Where(p => p.Id != id).ToList());
    public void RevokeAll() => Save([]);
    private void Save(List<Pairing> next)
    {
        LocalFiles.AtomicWrite(path, JsonSerializer.SerializeToUtf8Bytes(next, Json.Options), WasDamaged);
        items = next; WasDamaged = false;
    }
    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));
}
