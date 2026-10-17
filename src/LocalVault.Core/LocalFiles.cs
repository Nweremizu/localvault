using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;

namespace LocalVault.Core;

public static class LocalFiles
{
    public static string DataDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalVault", "Data");
    public static string PipeName => "LocalVault." + WindowsIdentity.GetCurrent().User!.Value.Replace('-', '_');

    public static void RestrictDirectory(string path)
    {
        var directory = Directory.CreateDirectory(path);
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Vault directory must not be a link.");
        var acl = new DirectorySecurity();
        acl.SetAccessRuleProtection(true, false);
        acl.SetOwner(WindowsIdentity.GetCurrent().User!);
        foreach (var sid in new[] { WindowsIdentity.GetCurrent().User!, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
            acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
        directory.SetAccessControl(acl);
    }

    public static void AtomicWrite(string path, byte[] contents, bool preservePrevious = true)
    {
        var directory = Path.GetDirectoryName(Path.GetFullPath(path))!;
        var temporary = Path.Combine(directory, "." + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None,
                65536, FileOptions.WriteThrough))
            {
                stream.Write(contents);
                stream.Flush(true);
            }
            if (File.Exists(path)) File.Replace(temporary, path, preservePrevious ? path + ".previous" : null);
            else File.Move(temporary, path);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}

public sealed class SessionSecret : IDisposable
{
    private byte[]? buffer;
    public SessionSecret(ReadOnlySpan<byte> secret)
    {
        buffer = secret.ToArray();
        if (buffer.Length % 16 != 0 || !CryptProtectMemory(buffer, (uint)buffer.Length, 0))
        {
            Dispose();
            throw new CryptographicException("Windows could not protect the session key.");
        }
    }

    public byte[] Reveal()
    {
        var copy = buffer?.ToArray() ?? throw new InvalidOperationException("Session ended.");
        if (!CryptUnprotectMemory(copy, (uint)copy.Length, 0))
        {
            CryptographicOperations.ZeroMemory(copy);
            throw new CryptographicException("Cannot resume the protected session.");
        }
        return copy;
    }

    public void Dispose()
    {
        if (buffer != null) CryptographicOperations.ZeroMemory(buffer);
        buffer = null;
    }

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectMemory([In, Out] byte[] data, uint size, uint flags);
    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectMemory([In, Out] byte[] data, uint size, uint flags);
}
