using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Sodium;

namespace LocalVault.Core;

public static class VaultFormat
{
    public const int MaxFileBytes = 16 * 1024 * 1024;
    public const int HeaderSize = 132;
    public const int Iterations = 3;
    public const int MemoryBytes = 256 * 1024 * 1024;
    private static ReadOnlySpan<byte> Magic => "LVLT0001"u8;
    private sealed record Payload(int SchemaVersion, List<Entry> Entries);

    public static byte[] Header(string password, byte[] vaultKey)
    {
        CheckPassword(password, creating: true);
        var header = new byte[HeaderSize];
        Magic.CopyTo(header);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(8), 1);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(12), Iterations);
        BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(16), MemoryBytes);
        RandomNumberGenerator.Fill(header.AsSpan(20, 16));
        RandomNumberGenerator.Fill(header.AsSpan(36, 24));
        var derived = Derive(password, header);
        try
        {
            SecretAeadXChaCha20Poly1305.Encrypt(vaultKey, header[36..60], derived, header[..36]).CopyTo(header, 60);
            return header;
        }
        finally { CryptographicOperations.ZeroMemory(derived); }
    }

    public static void Validate(ReadOnlySpan<byte> file)
    {
        if (file.Length < HeaderSize + 16 || file.Length > MaxFileBytes || !file[..8].SequenceEqual(Magic) ||
            BinaryPrimitives.ReadInt32LittleEndian(file[8..]) != 1 ||
            BinaryPrimitives.ReadInt32LittleEndian(file[12..]) != Iterations ||
            BinaryPrimitives.ReadInt32LittleEndian(file[16..]) != MemoryBytes)
            throw new InvalidDataException("Unsupported or damaged vault. The file has not been changed.");
    }

    public static (byte[] Key, List<Entry> Entries) Open(byte[] file, string password)
    {
        Validate(file);
        CheckPassword(password, creating: false);
        var derived = Derive(password, file);
        byte[]? key = null;
        try
        {
            key = SecretAeadXChaCha20Poly1305.Decrypt(file[60..108], file[36..60], derived, file[..36]);
            return (key, ReadEntries(file, key));
        }
        catch
        {
            if (key != null) CryptographicOperations.ZeroMemory(key);
            throw new InvalidDataException("Cannot unlock: incorrect password or damaged vault.");
        }
        finally { CryptographicOperations.ZeroMemory(derived); }
    }

    public static List<Entry> ReadEntries(byte[] file, byte[] key)
    {
        Validate(file);
        var plaintext = SecretAeadXChaCha20Poly1305.Decrypt(file[HeaderSize..], file[108..132], key, file[..HeaderSize]);
        try
        {
            using var document = JsonDocument.Parse(plaintext, new JsonDocumentOptions { MaxDepth = 32 });
            var entries = document.RootElement.ValueKind switch
            {
                JsonValueKind.Array => JsonSerializer.Deserialize<List<Entry>>(plaintext, Json.Options),
                JsonValueKind.Object => ReadCurrentPayload(plaintext),
                _ => null
            } ?? throw new InvalidDataException("Invalid vault contents.");
            if (entries.Count > 10000 || entries.Select(e => e.Id).Distinct().Count() != entries.Count)
                throw new InvalidDataException("Invalid vault item count or duplicate identifiers.");
            return entries.Select(e => e.Validated()).ToList();
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    public static byte[] Seal(byte[] header, byte[] key, IReadOnlyList<Entry> entries)
    {
        if (entries.Count > 10000) throw new InvalidDataException("The beta supports up to 10,000 items, including Trash.");
        byte[] plaintext;
        using (var output = new BoundedPayloadStream(MaxFileBytes - HeaderSize - 16))
        {
            using (var writer = new Utf8JsonWriter(output))
            {
                writer.WriteStartObject(); writer.WriteNumber("schemaVersion", 2); writer.WritePropertyName("entries"); writer.WriteStartArray();
                foreach (var entry in entries) JsonSerializer.Serialize(writer, entry.Validated(), Json.Options);
                writer.WriteEndArray(); writer.WriteEndObject(); writer.Flush();
            }
            plaintext = output.ToArray();
        }
        try
        {
            var file = new byte[HeaderSize + plaintext.Length + 16];
            header.AsSpan(0, HeaderSize).CopyTo(file);
            RandomNumberGenerator.Fill(file.AsSpan(108, 24));
            SecretAeadXChaCha20Poly1305.Encrypt(plaintext, file[108..132], key, file[..HeaderSize]).CopyTo(file, HeaderSize);
            return file;
        }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }

    private static List<Entry>? ReadCurrentPayload(ReadOnlySpan<byte> plaintext)
    {
        var payload = JsonSerializer.Deserialize<Payload>(plaintext, Json.Options);
        if (payload?.SchemaVersion != 2 || payload.Entries == null)
            throw new InvalidDataException("Unsupported vault payload version. The file has not been changed.");
        return payload.Entries;
    }

    private sealed class BoundedPayloadStream(int maximum) : MemoryStream()
    {
        private void CheckLimit(int count)
        {
            if (count < 0 || Position > maximum - count) throw new InvalidDataException("Vault exceeds 16 MiB.");
        }

        public override void Write(byte[] buffer, int offset, int count) { CheckLimit(count); base.Write(buffer, offset, count); }
        public override void Write(ReadOnlySpan<byte> buffer) { CheckLimit(buffer.Length); base.Write(buffer); }
        public override void WriteByte(byte value) { CheckLimit(1); base.WriteByte(value); }
        public override void SetLength(long value)
        {
            if (value > maximum) throw new InvalidDataException("Vault exceeds 16 MiB.");
            base.SetLength(value);
        }
        protected override void Dispose(bool disposing)
        {
            if (disposing && TryGetBuffer(out var buffer)) CryptographicOperations.ZeroMemory(buffer.AsSpan(0, checked((int)Length)));
            base.Dispose(disposing);
        }
    }

    public static byte[] ReadBounded(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is < HeaderSize + 16 or > MaxFileBytes) throw new InvalidDataException("Invalid vault size.");
        var file = new byte[(int)stream.Length];
        stream.ReadExactly(file);
        Validate(file);
        return file;
    }

    private static byte[] Derive(string password, byte[] header)
    {
        var bytes = Encoding.UTF8.GetBytes(password);
        try
        {
            return PasswordHash.ArgonHashBinary(bytes, header[20..36], Iterations, MemoryBytes, 32,
                PasswordHash.ArgonAlgorithm.Argon_2ID13);
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }

    private static void CheckPassword(string password, bool creating)
    {
        if (password.Length > 1024 || (creating ? password.Length < 12 : password.Length == 0))
            throw new InvalidDataException(creating ? "Use a master password of 12–1,024 characters." : "Enter the master password.");
    }
}
