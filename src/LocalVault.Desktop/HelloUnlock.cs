using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Security.Cryptography;
using System.Text.Json;
using LocalVault.Core;
using Windows.Security.Credentials;

namespace LocalVault.Desktop;

// Unlock across app restarts with Windows Hello. Hello holds an RSA key in the TPM (or Windows' software key store)
// that signs only after a face, fingerprint or PIN check. Its PKCS#1 v1.5 signature over a fixed random challenge
// is deterministic, so HKDF(signature) gives a stable AES key that wraps a copy of the vault key in hello.json.
// Provider behavior and cancellation must be verified on supported hardware; same-user process compromise remains outside this boundary.
internal sealed class HelloUnlock(string directory)
{
    private const string CredentialName = "LocalVault vault unlock";
    private static readonly byte[] Info = "LocalVault Windows Hello v1"u8.ToArray();
    private readonly string path = Path.Combine(directory, "hello.json");

    public bool Enrolled => File.Exists(path);
    public static async Task<bool> Available() => await KeyCredentialManager.IsSupportedAsync();

    public async Task Enroll(byte[] vaultKey)
    {
        var challenge = RandomNumberGenerator.GetBytes(32);
        var created = await Prompt(() => KeyCredentialManager.RequestCreateAsync(CredentialName, KeyCredentialCreationOption.ReplaceExisting).AsTask());
        if (created.Status != KeyCredentialStatus.Success) throw Failed(created.Status);
        var wrapping = await Derive(created.Credential, challenge);
        try
        {
            var nonce = RandomNumberGenerator.GetBytes(12);
            var cipher = new byte[vaultKey.Length]; var tag = new byte[16];
            using (var aes = new AesGcm(wrapping, 16)) aes.Encrypt(nonce, vaultKey, cipher, tag, Info);
            LocalFiles.AtomicWrite(path, JsonSerializer.SerializeToUtf8Bytes(new HelloFile(1, challenge, nonce, cipher, tag), Json.Options), false);
        }
        finally { CryptographicOperations.ZeroMemory(wrapping); }
    }

    /// <summary>Shows the Hello prompt and returns the vault key. The caller zeroes it after use.</summary>
    public async Task<byte[]> Unwrap()
    {
        var file = Read();
        var opened = await KeyCredentialManager.OpenAsync(CredentialName);
        if (opened.Status != KeyCredentialStatus.Success) throw Failed(opened.Status);
        var wrapping = await Derive(opened.Credential, file.Challenge);
        try
        {
            var key = new byte[file.Cipher.Length];
            using var aes = new AesGcm(wrapping, 16);
            try { aes.Decrypt(file.Nonce, file.Cipher, file.Tag, key, Info); }
            catch (AuthenticationTagMismatchException) { throw new InvalidOperationException("Windows Hello sign-in changed. Unlock with your master password, then turn Windows Hello on again."); }
            return key;
        }
        finally { CryptographicOperations.ZeroMemory(wrapping); }
    }

    public async Task Remove()
    {
        if (File.Exists(path)) File.Delete(path);
        try { await KeyCredentialManager.DeleteAsync(CredentialName); }
        catch (Exception ex) when (ex is COMException or FileNotFoundException) { } // already gone
    }

    private static async Task<byte[]> Derive(KeyCredential credential, byte[] challenge)
    {
        var signed = await Prompt(() => credential.RequestSignAsync(challenge.AsBuffer()).AsTask());
        if (signed.Status != KeyCredentialStatus.Success) throw Failed(signed.Status);
        var signature = signed.Result.ToArray();
        try { return HKDF.DeriveKey(HashAlgorithmName.SHA256, signature, 32, challenge, Info); }
        finally { CryptographicOperations.ZeroMemory(signature); }
    }

    private HelloFile Read()
    {
        try
        {
            if (new FileInfo(path).Length > 4096) throw new InvalidDataException();
            var file = JsonSerializer.Deserialize<HelloFile>(File.ReadAllBytes(path), Json.Options)!;
            if (file.Version != 1 || file.Challenge.Length != 32 || file.Nonce.Length != 12 || file.Cipher.Length != 32 || file.Tag.Length != 16) throw new InvalidDataException();
            return file;
        }
        catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException or UnauthorizedAccessException or NullReferenceException)
        { throw new InvalidOperationException("Windows Hello unlock data is missing or damaged. Use your master password."); }
    }

    private static InvalidOperationException Failed(KeyCredentialStatus status) => new(status switch
    {
        KeyCredentialStatus.UserCanceled => "Windows Hello was canceled. Use Windows Hello again or your master password.",
        KeyCredentialStatus.NotFound => "Windows Hello unlock was removed. Use your master password, then turn it on again in Settings.",
        KeyCredentialStatus.UserPrefersPassword => "Use your master password.",
        KeyCredentialStatus.SecurityDeviceLocked => "Windows Hello is locked after too many attempts. Use your master password.",
        _ => "Windows Hello is not available. Use your master password.",
    });

    // The Hello dialog of KeyCredentialManager has no owner-window API for desktop apps and can open behind the
    // app; bring it forward while the request is pending.
    private static async Task<T> Prompt<T>(Func<Task<T>> request)
    {
        var task = request();
        for (var i = 0; i < 30 && !task.IsCompleted; i++)
        {
            await Task.WhenAny(task, Task.Delay(100));
            var dialog = FindWindow("Credential Dialog Xaml Host", null);
            if (dialog != IntPtr.Zero) { BringForward(dialog); break; }
        }
        return await task;
    }

    // When the request comes from the browser, LocalVault is in the background and Windows refuses a plain
    // SetForegroundWindow. Sharing the foreground window's input queue for the call is the accepted workaround.
    private static void BringForward(IntPtr dialog)
    {
        var foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
        var current = GetCurrentThreadId();
        var attached = foreground != 0 && foreground != current && AttachThreadInput(current, foreground, true);
        try { SetForegroundWindow(dialog); }
        finally { if (attached) AttachThreadInput(current, foreground, false); }
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string? className, string? windowName);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, IntPtr processId);
    [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint attach, uint attachTo, bool join);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
}

internal sealed record HelloFile(int Version, byte[] Challenge, byte[] Nonce, byte[] Cipher, byte[] Tag);
