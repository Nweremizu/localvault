using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using LocalVault.Core;

namespace LocalVault.Desktop;

internal sealed class PipeServer : IDisposable
{
    private readonly CancellationTokenSource stop = new();
    private readonly SemaphoreSlim capacity = new(8);
    private readonly Func<BrowserRequest, Task<BrowserResponse>> handle;
    public PipeServer(Func<BrowserRequest, Task<BrowserResponse>> handle)
    {
        this.handle = handle; _ = Listen();
    }
    private async Task Listen()
    {
        while (!stop.IsCancellationRequested)
        {
            NamedPipeServerStream? pipe = null;
            var reserved = false;
            try
            {
                await capacity.WaitAsync(stop.Token);
                reserved = true;
                pipe = new NamedPipeServerStream(LocalFiles.PipeName, PipeDirection.InOut, 8,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(stop.Token);
                _ = Serve(pipe); pipe = null; reserved = false;
            }
            catch (OperationCanceledException) { pipe?.Dispose(); if (reserved) capacity.Release(); break; }
            catch (IOException) { pipe?.Dispose(); if (reserved) capacity.Release(); await Task.Delay(500, stop.Token).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing); }
        }
    }
    private async Task Serve(NamedPipeServerStream pipe)
    {
        using (pipe)
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token))
        {
            timeout.CancelAfter(TimeSpan.FromSeconds(120));
            byte[]? input = null; byte[]? output = null;
            try
            {
                input = await Frames.Read(pipe, timeout.Token);
                if (input == null) return;
                var response = await handle(Frames.Parse(input)).WaitAsync(timeout.Token);
                output = JsonSerializer.SerializeToUtf8Bytes(response, Json.Options);
                await Frames.Write(pipe, output, timeout.Token);
            }
            catch (Exception ex) when (ex is IOException or JsonException or InvalidDataException or OperationCanceledException or ArgumentException) { }
            finally
            {
                if (input != null) CryptographicOperations.ZeroMemory(input);
                if (output != null) CryptographicOperations.ZeroMemory(output);
                capacity.Release();
            }
        }
    }
    public void Dispose() { stop.Cancel(); }
}
