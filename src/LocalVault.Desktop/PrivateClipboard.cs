using Windows.ApplicationModel.DataTransfer;

namespace LocalVault.Desktop;

internal sealed class PrivateClipboard
{
    private const string Marker = "LocalVaultClipboardOwner";
    private string? token;
    private CancellationTokenSource? timer;
    public void Copy(string value)
    {
        token = Guid.NewGuid().ToString("N");
        var data = new DataPackage(); data.SetText(value); data.SetData(Marker, token);
        if (!Clipboard.SetContentWithOptions(data, new ClipboardContentOptions { IsAllowedInHistory = false, IsRoamable = false }))
            throw new InvalidOperationException("Windows could not copy to the clipboard.");
        timer?.Cancel(); timer = new CancellationTokenSource(); _ = ClearLater(timer.Token);
    }
    private async Task ClearLater(CancellationToken cancellation)
    {
        try { await Task.Delay(TimeSpan.FromSeconds(30), cancellation); await Clear(); }
        catch (OperationCanceledException) { }
    }
    public async Task Clear()
    {
        var expected = token;
        if (expected == null) return;
        try
        {
            var content = Clipboard.GetContent();
            if (content.Contains(Marker) && (await content.GetDataAsync(Marker)) as string == expected && token == expected)
                Clipboard.Clear();
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException) { }
        if (token == expected) token = null;
    }
}
