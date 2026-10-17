using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using LocalVault.Core;

// stdout is exclusively the browser's binary Native Messaging protocol.
try
{
    var client = BrowserIdentity.Load().InvocationClient(args);
    using var input = Console.OpenStandardInput();
    using var output = Console.OpenStandardOutput();
    while (true)
    {
        var incoming = await Frames.Read(input);
        if (incoming == null) break;
        var id = "invalid";
        byte[]? outgoing = null;
        byte[]? forwarded = null;
        try
        {
            var request = Frames.Parse(incoming) with { Client = client };
            id = request.Id;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(request.Operation is "pair" or "save" or "unlock" ? 120 : 8));
            using var pipe = new NamedPipeClientStream(".", LocalFiles.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
            await pipe.ConnectAsync(2000, timeout.Token);
            forwarded = JsonSerializer.SerializeToUtf8Bytes(request, Json.Options);
            await Frames.Write(pipe, forwarded, timeout.Token);
            outgoing = await Frames.Read(pipe, timeout.Token) ?? throw new IOException();
        }
        catch (Exception ex) when (ex is IOException or InvalidDataException or JsonException or OperationCanceledException or UnauthorizedAccessException or TimeoutException or ArgumentException)
        {
            outgoing = JsonSerializer.SerializeToUtf8Bytes(BrowserResponse.Fail(id, "Open LocalVault and check the browser connection. The request was not completed."), Json.Options);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(incoming);
            if (forwarded != null) CryptographicOperations.ZeroMemory(forwarded);
        }
        try { await Frames.Write(output, outgoing!); }
        finally { if (outgoing != null) CryptographicOperations.ZeroMemory(outgoing); }
    }
    return 0;
}
catch
{
    // Do not emit exception text: request bodies may contain credentials.
    return 1;
}
