using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;
using LocalVault.Core;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace LocalVault.Desktop;

// Hosts the React UI (/ui) in WebView2. The page is untrusted presentation: it only sees what each bridge
// operation returns, never touches files, and gets a password only when the user reveals or edits that entry.
public partial class MainWindow : Window
{
    private const string AppOrigin = "https://app.localvault";
    private readonly VaultStore vault;
    private readonly Pairings pairings;
    private readonly BrowserIdentity identity;
    private readonly PipeServer? server;
    private readonly PrivateClipboard clipboard = new();
    private readonly DispatcherTimer timer = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly Stopwatch idle = Stopwatch.StartNew();
    private readonly bool smoke;
    private readonly string? smokeDirectory;
    private readonly string? devServer;
    private bool busy;
    private long lockEpoch;
    private List<ImportRow>? pendingImport;
    private long importGeneration;
    private string? restorePath;
    private readonly string settingsPath;
    private bool siteIcons = true;
    private GeneratorOptions generator = new();
    private readonly HelloUnlock hello;
    private readonly SiteIcons icons;
    private readonly PwnedPasswords pwned = new();
    private sealed record BreachScan(string Id, long Generation, CancellationTokenSource Cancellation, Task<BreachFinding[]> Task);
    private BreachScan? breachScan;
    private bool helloAvailable;
    private readonly System.Windows.Forms.NotifyIcon? tray;
    private bool quitting, trayHintShown;

    public MainWindow(bool smoke = false, bool preview = false)
    {
        this.smoke = smoke;
        InitializeComponent();
#if DEBUG
        // Debug builds can load the Vite dev server for live UI editing: set LOCALVAULT_UI_DEV=http://localhost:5173
        devServer = Environment.GetEnvironmentVariable("LOCALVAULT_UI_DEV") is { } dev && dev.StartsWith("http://localhost:", StringComparison.Ordinal) ? dev.TrimEnd('/') : null;
#else
        devServer = null;
#endif
        var dark = SystemDark();
        Background = new SolidColorBrush(dark ? Color.FromRgb(0x0A, 0x0A, 0x0A) : Colors.White);
        Web.DefaultBackgroundColor = dark ? System.Drawing.Color.FromArgb(0x0A, 0x0A, 0x0A) : System.Drawing.Color.White;
        SourceInitialized += (_, _) => DarkTitleBar(dark);
        var directory = smoke ? (smokeDirectory = Path.Combine(Path.GetTempPath(), "LocalVault-ui-" + Guid.NewGuid().ToString("N"))) : LocalFiles.DataDirectory;
        vault = new VaultStore(directory); pairings = new Pairings(directory); identity = BrowserIdentity.Load();
        hello = new HelloUnlock(directory);
        icons = new SiteIcons(directory);
        settingsPath = Path.Combine(directory, "settings.json");
        try
        {
            if (File.Exists(settingsPath) && JsonSerializer.Deserialize<DesktopSettings>(File.ReadAllBytes(settingsPath), Json.Options) is { } saved)
            { siteIcons = saved.SiteIcons; generator = saved.Generator?.Validated() ?? generator; }
        }
        catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException or InvalidDataException) { }
        if (preview)
        {
            vault.Create("preview-only-password");
            vault.Save(new Entry { Title = "Northstar Studio", Username = "alex@example.com", Password = "preview-only-password", Origins = ["https://www.figma.com"], Notes = "Team workspace · sample account" });
            vault.Save(new Entry { Title = "Field Notes", Username = "alex@example.com", Password = "preview-only-password", Origins = ["https://github.com"] });
            vault.Save(new Entry { Title = "Harbor Finance", Username = "alex@example.com", Password = "preview-only-password", Origins = ["https://linear.app"] });
            vault.Save(new Entry { Title = "Konami", Username = "alex@example.com", Password = "preview-only-password", Origins = ["https://account.konami.net"] });
            vault.Save(new Entry { Title = "Jumia", Username = "alex@example.com", Password = "preview-only-password", Origins = ["https://account.jumia.com.ng"] });
        }
        if (!smoke) server = new PipeServer(HandleBrowser);
        InputManager.Current.PreProcessInput += DesktopInput;
        timer.Tick += (_, _) => { if (vault.IsUnlocked && idle.Elapsed > TimeSpan.FromMinutes(5)) LockVault(false); };
        timer.Start();
        if (!smoke) { SystemEvents.SessionSwitch += SessionSwitch; SystemEvents.PowerModeChanged += PowerChanged; }
        // Preview and smoke runs use a throwaway vault: no tray, and never touch the real Windows Hello key.
        if (!smoke) { tray = CreateTray(); Closing += HideToTray; }
        Closed += OnClosed;
        Loaded += async (_, _) => await StartUi();
    }

    private async Task StartUi()
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null,
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LocalVault", "WebView2"));
            var options = environment.CreateCoreWebView2ControllerOptions();
            options.IsInPrivateModeEnabled = true; // nothing the page does is persisted to disk
            await Web.EnsureCoreWebView2Async(environment, options);
        }
        catch (Exception ex) when (ex is WebView2RuntimeNotFoundException or COMException or InvalidOperationException)
        {
            if (!IsLoaded) return;
            MessageBox.Show(this, "LocalVault needs the Microsoft Edge WebView2 Runtime, which is included with Windows 11. Repair or reinstall it from Microsoft, then start LocalVault again. Your vault has not been changed.", "LocalVault", MessageBoxButton.OK, MessageBoxImage.Error);
            Close(); return;
        }
        var core = Web.CoreWebView2;
        var settings = core.Settings;
        settings.AreDevToolsEnabled = devServer != null;
        settings.AreBrowserAcceleratorKeysEnabled = devServer != null;
        settings.AreDefaultContextMenusEnabled = false;
        settings.IsStatusBarEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
        settings.AreHostObjectsAllowed = false;
        settings.IsZoomControlEnabled = false;
        settings.IsSwipeNavigationEnabled = false;
        core.SetVirtualHostNameToFolderMapping("app.localvault", Path.Combine(AppContext.BaseDirectory, "ui"), CoreWebView2HostResourceAccessKind.Deny);
        core.NavigationStarting += (_, e) => { if (!Trusted(e.Uri)) e.Cancel = true; };
        core.FrameNavigationStarting += (_, e) => e.Cancel = true;
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.DownloadStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += WebMessage;
        helloAvailable = smokeDirectory == null && await HelloUnlock.Available();
        core.Navigate(devServer != null ? devServer + "/" : AppOrigin + "/index.html");
    }

    private bool Trusted(string uri) =>
        uri.StartsWith(AppOrigin + "/", StringComparison.Ordinal) || (devServer != null && uri.StartsWith(devServer + "/", StringComparison.Ordinal));

    private void SessionSwitch(object sender, SessionSwitchEventArgs e)
    { if (e.Reason == SessionSwitchReason.SessionLock) Dispatcher.Invoke(() => LockVault(false)); }
    private void PowerChanged(object sender, PowerModeChangedEventArgs e)
    { if (e.Mode == PowerModes.Suspend) Dispatcher.Invoke(() => LockVault(false)); }

    private async void OnClosed(object? sender, EventArgs e)
    {
        InputManager.Current.PreProcessInput -= DesktopInput;
        if (!smoke) { SystemEvents.SessionSwitch -= SessionSwitch; SystemEvents.PowerModeChanged -= PowerChanged; }
        timer.Stop(); var scan = breachScan; breachScan = null; scan?.Cancellation.Cancel(); server?.Dispose(); tray?.Dispose(); vault.Dispose(); pendingImport?.Clear(); _ = clipboard.Clear(); Web.Dispose();
        if (scan != null) { try { await scan.Task; } catch (Exception) { } scan.Cancellation.Dispose(); }
        pwned.Dispose();
        if (smokeDirectory != null && Path.GetFullPath(smokeDirectory).StartsWith(
            Path.Combine(Path.GetTempPath(), "LocalVault-ui-"), StringComparison.OrdinalIgnoreCase)) Directory.Delete(smokeDirectory, true);
    }
    private void DesktopInput(object sender, PreProcessInputEventArgs e)
    {
        if (e.StagingItem.Input is KeyEventArgs or MouseEventArgs or TextCompositionEventArgs) idle.Restart();
    }

    // ---- Bridge ---------------------------------------------------------------------------------------------

    private async void WebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!Trusted(e.Source)) return;
        var id = "";
        try
        {
            var json = e.WebMessageAsJson;
            if (json.Length > 1024 * 1024) throw new InvalidDataException("Request too large.");
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions { MaxDepth = 8 });
            var root = document.RootElement;
            id = root.GetProperty("id").GetString() ?? "";
            if (id.Length > 64) throw new InvalidDataException("Invalid request.");
            var args = root.TryGetProperty("args", out var value) && value.ValueKind == JsonValueKind.Object ? value : default;
            var result = await Handle(Text(root, "op", 32), args);
            Post(new { id, ok = true, result });
        }
        catch (Exception ex)
        {
            Post(new { id, ok = false, error = ex is InvalidDataException or InvalidOperationException ? ex.Message
                : "The operation could not finish. Check the selected file or folder; the previous vault was preserved." });
        }
    }

    private void Post(object message)
    {
        if (Web.CoreWebView2 is { } core) core.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json.Options));
    }
    // Tells the page to re-read state after changes it did not initiate (auto-lock, browser saves).
    private void Changed()
    {
        if (breachScan is { } scan && vault.Generation != scan.Generation) CancelBreachScan();
        Post(new { @event = "changed" });
    }

    private void CancelBreachScan()
    {
        if (breachScan is not { } scan) return;
        breachScan = null; scan.Cancellation.Cancel();
        _ = scan.Task.ContinueWith(task => { _ = task.Exception; scan.Cancellation.Dispose(); }, CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
    }

    private async Task<object?> Handle(string op, JsonElement a)
    {
        switch (op)
        {
            case "state":
                return new { exists = vault.Exists, unlocked = vault.IsUnlocked, helloAvailable, helloEnrolled = hello.Enrolled, siteIcons,
                    preview = smokeDirectory != null, notice = pairings.WasDamaged ? "Browser pairings could not be read and were disabled. Pair browsers again; the vault has not been reset." : null };
            case "unlock": { var password = Text(a, "password", 1024); await Work(() => vault.Unlock(password)); return null; }
            case "create": { var password = Text(a, "password", 1024); await Work(() => vault.Create(password)); return null; }
            case "lock": LockVault(false); return null;
            case "endSession": LockVault(true); return null;
            case "installUpdate":
            {
                RequireUnlocked();
                if (smokeDirectory != null) throw new InvalidOperationException("Updates are not available in preview mode.");
                if (busy) throw new InvalidOperationException("Wait for the current vault operation to finish.");
                var dialog = new OpenFileDialog { Filter = "LocalVault update (*.msi)|*.msi", Title = "Choose a LocalVault update" };
                if (dialog.ShowDialog(this) != true) return false;
                var version = InstallerUpdate.Inspect(dialog.FileName, typeof(App).Assembly.GetName().Version!);
                if (!Dialogs.Confirm(this, $"Install LocalVault {version}?\n\nLocalVault will lock and exit. Windows Installer will upgrade it without a separate uninstall. Your vault and browser pairings remain on this device. Reopen LocalVault after installation.\n\nThis beta does not authenticate the publisher of the selected package. Only continue with a package you obtained from the trusted LocalVault release source. Metadata checks alone do not prove it is genuine.")) return false;
                if (busy) throw new InvalidOperationException("Wait for the current vault operation to finish.");
                RequireUnlocked();
                LockVault(true);
                var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "msiexec.exe")) { UseShellExecute = false };
                start.ArgumentList.Add("/i"); start.ArgumentList.Add(dialog.FileName); start.ArgumentList.Add("/norestart");
                try { Process.Start(start); }
                catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
                { throw new InvalidOperationException("Windows Installer could not start. Your vault remains locked. Try opening the MSI directly."); }
                _ = Dispatcher.BeginInvoke(() => Quit(), DispatcherPriority.Background);
                return true;
            }
            case "hello": await UnlockWithHello(); return null;
            case "setHello": await SetHello(a.GetProperty("enabled").GetBoolean()); return null;
            case "list":
            {
                var all = vault.Snapshot().OrderBy(e => e.Title, StringComparer.OrdinalIgnoreCase).ToArray();
                var offset = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("offset", out var listOffset) && listOffset.TryGetInt32(out var n) && n >= 0 ? n : 0;
                var page = all.Skip(offset).Take(16).Select(Summary).ToArray();
                return new { total = all.Length, offset, items = page };
            }
            case "getItem": return StripHistory(Find(a));
            case "openSite":
            {
                RequireUnlocked();
                var item = Find(a);
                if (item.Type != "login" || item.Origins.Length == 0)
                    throw new InvalidOperationException("Add an HTTPS website to this account first.");
                var origin = Origin.Parse(item.Origins[0]);
                try { Process.Start(new ProcessStartInfo(origin) { UseShellExecute = true }); }
                catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException)
                { throw new InvalidOperationException("The website could not be opened. Check your default browser."); }
                return null;
            }
            case "trashList":
            {
                var all = vault.TrashSnapshot().OrderByDescending(e => e.DeletedAt).ToArray();
                var offset = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("offset", out var trashOffset) && trashOffset.TryGetInt32(out var n) && n >= 0 ? n : 0;
                return new { total = all.Length, offset, items = all.Skip(offset).Take(16).Select(Summary).ToArray() };
            }
            case "history":
            {
                var id = Id(a); var item = Find(a);
                return new { version = item.Updated.UtcTicks.ToString(), items = vault.History(id).Select((h, index) => new
                { index, revisedAt = h.RevisedAt, type = h.Content.Type, title = h.Content.Title, username = h.Content.Username }).ToArray() };
            }
            case "historyContent":
            {
                var item = Find(a);
                if (item.Updated.UtcTicks.ToString() != Text(a, "version", 32)) throw new InvalidOperationException("This item changed. Reopen history.");
                return vault.History(item.Id).ElementAt(Index(a)).Content;
            }
            case "revealField":
            {
                var item = Find(a); var fieldId = Id(a, "fieldId");
                return item.Fields.FirstOrDefault(f => f.Id == fieldId && f.Type == "secret")?.Value
                    ?? throw new InvalidOperationException("That secret field no longer exists.");
            }
            case "copyField":
            {
                var item = Find(a); var fieldId = Id(a, "fieldId");
                var field = item.Fields.FirstOrDefault(f => f.Id == fieldId) ?? throw new InvalidOperationException("That field no longer exists.");
                clipboard.Copy(field.Value); return null;
            }
            case "historyRestore":
                vault.RestoreHistory(Id(a), Index(a), Text(a, "version", 32)); Changed(); return null;
            case "trashRestore": vault.RestoreTrash(Id(a)); Changed(); return null;
            case "undoDelete": vault.UndoDelete(Id(a)); Changed(); return null;
            case "trashPurge":
                if (Text(a, "confirm", 16) != "DELETE") throw new InvalidOperationException("Type DELETE to confirm permanent removal.");
                vault.PurgeTrash(a.TryGetProperty("id", out _) ? Id(a) : null); Changed(); return null;
            case "securityAnalyze":
            {
                var generation = vault.Generation;
                var report = await Task.Run(() => SecurityChecks.Analyze(vault.Snapshot()));
                if (!vault.IsUnlocked || vault.Generation != generation) throw new InvalidOperationException("Vault locked during the scan. Unlock again.");
                return report;
            }
            case "breachStart": return StartBreachScan();
            case "breachStatus": return await BreachStatus(a);
            case "breachCancel":
                RequireUnlocked();
                if (breachScan is { } running && running.Id == Text(a, "scanId", 32)) CancelBreachScan();
                return null;
            case "reveal": return Find(a).Password;
            case "copy":
            {
                var entry = Find(a);
                clipboard.Copy(Text(a, "field", 16) == "username" ? entry.Username : entry.Password);
                return null;
            }
            case "generate": return Passwords.Generate(a.ValueKind == JsonValueKind.Object && a.TryGetProperty("options", out var o) ? Options(o) : generator);
            case "generatorOptions": return generator;
            case "setGeneratorOptions": generator = Options(a.GetProperty("options")); SaveSettings(); return null;
            case "copyText": clipboard.Copy(Text(a, "value", 16384)); return null;
            case "icon":
            {
                if (!siteIcons || !vault.IsUnlocked) return null;
                var origin = Origin.Parse(Text(a, "origin", 2048));
                if (!icons.IsOpen) { var key = vault.CopyKey(); try { icons.Open(key); } finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(key); } }
                return await icons.Get(origin);
            }
            case "setSiteIcons":
                siteIcons = a.GetProperty("enabled").GetBoolean();
                if (!siteIcons) icons.Clear();
                SaveSettings();
                return null;
            case "save": await Save(a); Changed(); return null;
            case "delete": { var entry = Find(a); await Work(() => vault.Delete(entry.Id)); Changed(); return null; }
            case "importPick": return ImportPick();
            case "importCommit": await ImportCommit(a); Changed(); return null;
            case "importCancel": pendingImport?.Clear(); pendingImport = null; return null;
            case "backup":
            {
                RequireUnlocked();
                var dialog = new SaveFileDialog { Filter = "Encrypted LocalVault backup (*.lvault)|*.lvault", FileName = "LocalVault-" + DateTime.Now.ToString("yyyyMMdd") + ".lvault" };
                if (dialog.ShowDialog(this) != true) return false;
                await Work(() => vault.Backup(dialog.FileName)); return true;
            }
            case "restorePick":
            {
                var dialog = new OpenFileDialog { Filter = "Encrypted LocalVault vault (*.lvault)|*.lvault" };
                restorePath = dialog.ShowDialog(this) == true ? dialog.FileName : null;
                return restorePath == null ? null : Path.GetFileName(restorePath);
            }
            case "restore":
            {
                var source = restorePath ?? throw new InvalidOperationException("Choose a backup file first.");
                var password = Text(a, "password", 1024);
                await Work(() => vault.Restore(source, password)); restorePath = null;
                await hello.Remove(); // the restored vault may use a different key
                icons.Close();
                Changed();
                return null;
            }
            case "changePassword":
            {
                RequireUnlocked();
                var current = Text(a, "current", 1024); var next = Text(a, "next", 1024);
                await Work(() => vault.ChangePassword(current, next)); Changed(); return null;
            }
            case "reset":
                if (Text(a, "confirm", 16) != "RESET") throw new InvalidOperationException("Type RESET to confirm.");
                LockVault(true);
                await Work(() => { vault.Reset(); pairings.RevokeAll(); });
                icons.Clear();
                await hello.Remove(); return null;
            case "pairings":
                return new { chromiumId = identity.ChromiumId, firefoxId = identity.FirefoxId,
                    items = pairings.Snapshot().Select(p => new { p.Id, p.Profile, p.Created }).ToArray() };
            case "revokePairing": pairings.Revoke(Id(a)); return null;
            default: throw new InvalidOperationException("Unsupported request.");
        }
    }

    private async Task Save(JsonElement a)
    {
        RequireUnlocked();
        var origins = a.ValueKind == JsonValueKind.Object && a.TryGetProperty("origins", out var originValues) && originValues.ValueKind == JsonValueKind.Array
            ? originValues.EnumerateArray().Take(33).Select(o => o.GetString() ?? "").ToArray() : [];
        if (origins.Length > 32) throw new InvalidDataException("Use at most 32 websites per entry.");
        var password = a.TryGetProperty("password", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
        if (password?.Length > 16384) throw new InvalidDataException("Password is too long.");
        Entry entry;
        if (a.TryGetProperty("id", out var idValue) && idValue.ValueKind == JsonValueKind.String)
        {
            var old = Find(a);
            if (old.Updated.UtcTicks.ToString() != Text(a, "version", 32))
                throw new InvalidOperationException("This entry changed while you were editing. Reopen it before saving.");
            entry = old with { Password = password ?? old.Password };
        }
        else entry = new Entry { Password = password ?? "" };
        var type = a.TryGetProperty("type", out var typeValue) && typeValue.ValueKind == JsonValueKind.String ? typeValue.GetString()! : "login";
        var fields = a.TryGetProperty("fields", out var fieldValues) && fieldValues.ValueKind == JsonValueKind.Array
            ? JsonSerializer.Deserialize<CustomField[]>(fieldValues.GetRawText(), Json.Options) ?? [] : [];
        entry = (entry with { Type = type, Title = Text(a, "title", 256), Username = type == "note" ? "" : Text(a, "username", 4096),
            Password = type == "note" ? "" : password ?? entry.Password, Notes = Text(a, "notes", 16384), Fields = fields,
            Origins = type == "note" ? [] : origins.Select(o => o.Trim()).Where(o => o.Length > 0).ToArray() }).Validated();
        await Work(() => vault.Save(entry));
    }

    private object? ImportPick()
    {
        RequireUnlocked();
        var dialog = new OpenFileDialog { Filter = "Browser CSV (*.csv)|*.csv", Title = "Import Chrome or Edge passwords" };
        if (dialog.ShowDialog(this) != true) return null;
        pendingImport?.Clear();
        pendingImport = ImportCsv.Preview(dialog.FileName, vault.Snapshot()); importGeneration = vault.Generation;
        return pendingImport.Select((r, index) => new { index, r.Row, r.Title, r.Username, r.Website, r.Status,
            action = r.Action.ToString().ToLowerInvariant(), valid = r.Entry != null }).ToArray();
    }

    private async Task ImportCommit(JsonElement a)
    {
        var rows = pendingImport ?? throw new InvalidOperationException("Choose a CSV file first.");
        var actions = a.GetProperty("actions").EnumerateArray().Select(v => v.GetString() ?? "").ToArray();
        if (actions.Length != rows.Count) throw new InvalidDataException("Import choices do not match the preview.");
        if (importGeneration != vault.Generation) throw new InvalidOperationException("The vault changed during preview. Import again to review current conflicts.");
        for (var i = 0; i < rows.Count; i++)
            rows[i].Action = rows[i].Entry == null || !Enum.TryParse<ImportAction>(actions[i], true, out var action) ? ImportAction.Skip : action;
        await Work(() => vault.Import(rows));
        rows.Clear(); pendingImport = null;
    }

    // Runs vault work off the UI thread (Argon2 is deliberately slow) and discards results if the vault locked meanwhile.
    private async Task Work(Action action)
    {
        if (busy) throw new InvalidOperationException("Another operation is still running.");
        var startedAt = lockEpoch; busy = true;
        try { await Task.Run(action); idle.Restart(); }
        finally { busy = false; if (startedAt != lockEpoch) vault.Lock(); }
        if (startedAt != lockEpoch) throw new InvalidOperationException("Vault locked during the operation. Unlock again to continue.");
    }

    private Entry Find(JsonElement a)
    {
        var id = Id(a);
        return vault.Snapshot().FirstOrDefault(e => e.Id == id) ?? throw new InvalidOperationException("This entry no longer exists.");
    }
    private static Guid Id(JsonElement a, string name) => a.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && Guid.TryParse(value.GetString(), out var id)
        ? id : throw new InvalidDataException("Invalid request.");

    private static object Summary(Entry e) => new { id = e.Id, type = e.Type, e.Title,
        username = e.Username.Length > 256 ? e.Username[..253] + "…" : e.Username, origin = e.Origins.FirstOrDefault(),
        updated = e.Updated, version = e.Updated.UtcTicks.ToString(), deletedAt = e.DeletedAt,
        historyCount = e.History.Length, fields = e.Fields.Select(f => new { f.Id, f.Label, f.Type }).ToArray() };

    private static Entry StripHistory(Entry e) => e with { History = [] };
    private static int Index(JsonElement a) => a.TryGetProperty("index", out var value) && value.TryGetInt32(out var index) && index >= 0 && index < 20
        ? index : throw new InvalidDataException("Invalid history revision.");

    private string StartBreachScan()
    {
        RequireUnlocked();
        if (breachScan != null) throw new InvalidOperationException("A breached-password scan is already running.");
        var generation = vault.Generation;
        var secrets = vault.Snapshot().Where(e => e.Type == "login").Select(e => new PasswordSecret(e.Id, e.Title, e.Password)).ToArray();
        var cancellation = new CancellationTokenSource();
        var id = Guid.NewGuid().ToString("N");
        var task = Task.Run(async () =>
        {
            try
            {
                var result = await pwned.CheckAsync(secrets, cancellation.Token).ConfigureAwait(false);
                if (!vault.IsUnlocked || vault.Generation != generation) throw new InvalidOperationException("Vault locked during the check. Unlock again.");
                return result;
            }
            finally { Array.Clear(secrets); }
        });
        breachScan = new BreachScan(id, generation, cancellation, task);
        return id;
    }

    private async Task<object> BreachStatus(JsonElement a)
    {
        RequireUnlocked();
        var scan = breachScan ?? throw new InvalidOperationException("There is no active breached-password check.");
        if (scan.Id != Text(a, "scanId", 32)) throw new InvalidOperationException("The breached-password check changed.");
        if (!scan.Task.IsCompleted) return new { scanId = scan.Id, status = "running", results = (BreachFinding[]?)null };
        try
        {
            var results = await scan.Task;
            if (!vault.IsUnlocked || vault.Generation != scan.Generation) throw new InvalidOperationException("Vault locked during the check. Unlock again.");
            breachScan = null; scan.Cancellation.Dispose();
            return new { scanId = scan.Id, status = "completed", results };
        }
        catch (OperationCanceledException)
        {
            breachScan = null; scan.Cancellation.Dispose();
            return new { scanId = scan.Id, status = "canceled", results = (BreachFinding[]?)null };
        }
        catch { breachScan = null; scan.Cancellation.Dispose(); throw; }
    }
    private static GeneratorOptions Options(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || value.GetRawText().Length > 1024) throw new InvalidDataException("Invalid request.");
        try { return (JsonSerializer.Deserialize<GeneratorOptions>(value.GetRawText(), Json.Options) ?? throw new JsonException()).Validated(); }
        catch (JsonException) { throw new InvalidDataException("Invalid generator settings."); }
    }

    private void SaveSettings() =>
        LocalFiles.AtomicWrite(settingsPath, JsonSerializer.SerializeToUtf8Bytes(new DesktopSettings(siteIcons, generator), Json.Options));

    // Works whether the vault is locked or not: it only generates, it never saves.
    private void GenerateFromTray()
    {
        try
        {
            clipboard.Copy(Passwords.Generate(generator));
            tray?.ShowBalloonTip(2500, "Password copied", $"{generator.Length} characters. The clipboard clears in 30 seconds.", System.Windows.Forms.ToolTipIcon.None);
        }
        catch (InvalidOperationException) { tray?.ShowBalloonTip(2500, "Could not copy", "The clipboard is busy. Try again.", System.Windows.Forms.ToolTipIcon.Warning); }
    }

    private void RequireUnlocked() { if (!vault.IsUnlocked) throw new InvalidOperationException("Unlock the vault first."); }
    private static Guid Id(JsonElement a) => Guid.TryParse(Text(a, "id", 64), out var id) ? id : throw new InvalidDataException("Invalid request.");
    private static string Text(JsonElement a, string name, int max)
    {
        if (a.ValueKind != JsonValueKind.Object || !a.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("Invalid request.");
        var text = value.GetString()!;
        return text.Length <= max ? text : throw new InvalidDataException("A field is too long.");
    }

    private void LockVault(bool end)
    {
        lockEpoch++;
        CancelBreachScan();
        if (end) vault.EndSession(); else vault.Lock();
        icons.Close();
        pendingImport?.Clear(); pendingImport = null; restorePath = null;
        foreach (var window in OwnedWindows.Cast<Window>().ToArray()) window.Close();
        _ = clipboard.Clear(); Changed();
    }

    private async Task SetHello(bool enabled)
    {
        if (smokeDirectory != null) throw new InvalidOperationException("Windows Hello is not available in preview mode.");
        if (!enabled) { await hello.Remove(); return; }
        RequireUnlocked();
        if (!helloAvailable) throw new InvalidOperationException("Set up Windows Hello (face, fingerprint or PIN) in Windows Settings first.");
        var key = vault.CopyKey();
        try { await hello.Enroll(key); }
        catch (COMException) { throw new InvalidOperationException("Windows Hello could not be turned on. Check Windows Hello in Windows Settings."); }
        finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(key); }
    }

    private async Task UnlockWithHello()
    {
        if (busy || !hello.Enrolled || vault.IsUnlocked) throw new InvalidOperationException("Enter your master password.");
        byte[] key;
        try { key = await hello.Unwrap(); }
        catch (COMException) { throw new InvalidOperationException("Windows Hello is not available. Use your master password."); }
        try { await Work(() => vault.UnlockWithKey(key)); }
        finally { System.Security.Cryptography.CryptographicOperations.ZeroMemory(key); }
    }

    // ---- System tray: closing the window keeps LocalVault running so browsers can still fill -----------------

    private System.Windows.Forms.NotifyIcon CreateTray()
    {
        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add("Open LocalVault", null, (_, _) => ShowFromTray());
        menu.Items.Add("Generate password", null, (_, _) => GenerateFromTray());
        menu.Items.Add("Lock", null, (_, _) => LockVault(false));
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add("Quit LocalVault", null, (_, _) => Quit());
        var icon = new System.Windows.Forms.NotifyIcon
        {
            Icon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath!), Text = "LocalVault", ContextMenuStrip = menu, Visible = true,
        };
        icon.MouseClick += (_, e) => { if (e.Button == System.Windows.Forms.MouseButtons.Left) ShowFromTray(); };
        return icon;
    }

    public void ShowFromTray()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    public void Quit() { quitting = true; Close(); }

    private void HideToTray(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (quitting || tray == null) return;
        e.Cancel = true; Hide();
        if (trayHintShown) return;
        trayHintShown = true;
        tray.ShowBalloonTip(4000, "LocalVault is still running", "Open it from the system tray. Right-click the icon to quit.", System.Windows.Forms.ToolTipIcon.None);
    }

    // ---- Browser extension requests (native approval prompts, which the page cannot imitate) ----------------

    private Task<BrowserResponse> HandleBrowser(BrowserRequest request) => request.Operation == "unlock"
        ? Dispatcher.InvokeAsync(() => UnlockForBrowser(request)).Task.Unwrap()
        : Dispatcher.InvokeAsync(() => ProcessBrowser(request)).Task;

    private bool browserUnlockWaiting;

    // A paired browser may ask to unlock, so fills work without opening the window. The user still proves presence:
    // Windows Hello prompts on top of the browser; without Hello the window comes up for the master password.
    private async Task<BrowserResponse> UnlockForBrowser(BrowserRequest request)
    {
        object Unlocked() => new { locked = false, generation = vault.Generation };
        if (!identity.Allows(request.Client) || !pairings.Verify(request.Client, request.Token)) return BrowserResponse.Fail(request.Id, "Pair this browser with the desktop app again.");
        if (vault.IsUnlocked) return new(request.Id, true, "", Unlocked());
        if (busy || browserUnlockWaiting) return BrowserResponse.Fail(request.Id, "LocalVault is already waiting for you to unlock.");
        browserUnlockWaiting = true;
        try
        {
            if (hello.Enrolled)
            {
                try { await UnlockWithHello(); Changed(); return new(request.Id, true, "", Unlocked()); }
                catch (Exception ex) when (ex is InvalidOperationException or InvalidDataException) { return BrowserResponse.Fail(request.Id, ex.Message); }
            }
            ShowFromTray(); Changed();
            for (var waited = 0; waited < 105 && !vault.IsUnlocked; waited++) await Task.Delay(TimeSpan.FromSeconds(1));
            return vault.IsUnlocked ? new(request.Id, true, "", Unlocked()) : BrowserResponse.Fail(request.Id, "LocalVault is still locked.");
        }
        finally { browserUnlockWaiting = false; }
    }
    private BrowserResponse ProcessBrowser(BrowserRequest request)
    {
        var started = Stopwatch.StartNew();
        try
        {
            if (!identity.Allows(request.Client)) return BrowserResponse.Fail(request.Id, "Unknown extension.");
            if (request.Operation == "pair")
            {
                if (busy || !vault.IsUnlocked || request.Code.Length != 6 || !request.Code.All(char.IsAsciiDigit) || string.IsNullOrWhiteSpace(request.Profile))
                    return BrowserResponse.Fail(request.Id, "Unlock the desktop vault before pairing.");
                var generation = vault.Generation;
                ShowFromTray();
                if (!Dialogs.Confirm(this, $"Pair browser profile ‘{request.Profile}’?\n\nConfirm the extension displays code {request.Code}.\n\nApprove only if you just requested this connection.") || !vault.IsUnlocked || generation != vault.Generation || started.Elapsed > TimeSpan.FromSeconds(110))
                    return BrowserResponse.Fail(request.Id, "Pairing was not approved.");
                idle.Restart();
                var token = pairings.Add(request.Client, request.Profile); Changed();
                return new(request.Id, true, "", new { token, locked = false, generation = vault.Generation });
            }
            if (!pairings.Verify(request.Client, request.Token)) return BrowserResponse.Fail(request.Id, "Pair this browser with the desktop app again.");
            if (request.Operation == "status") return new(request.Id, true, "", new { locked = busy || !vault.IsUnlocked, generation = vault.Generation });
            if (busy || !vault.IsUnlocked) return BrowserResponse.Fail(request.Id, "Unlock the desktop vault first.");
            var origin = Origin.Parse(request.Origin);
            if (origin != request.Origin) return BrowserResponse.Fail(request.Id, "Invalid website origin.");
            var matching = vault.Snapshot().Where(e => e.Type == "login" && e.Origins.Contains(origin, StringComparer.Ordinal)).ToArray();
            if (request.Operation == "matches")
            {
                var page = matching.Skip(request.Offset).Take(32).Select(e => new { e.Id, e.Title,
                    Username = e.Username.Length > 256 ? e.Username[..253] + "…" : e.Username }).ToArray();
                return new(request.Id, true, "", new { accounts = page,
                    nextOffset = request.Offset + page.Length < matching.Length ? (int?)(request.Offset + page.Length) : null });
            }
            if (request.Operation == "get")
            {
                idle.Restart(); // filling from the browser counts as using the vault for auto-lock
                var item = matching.FirstOrDefault(e => e.Id == request.EntryId);
                return item == null ? BrowserResponse.Fail(request.Id, "No matching account for this website.") :
                    new(request.Id, true, "", new { item.Username, item.Password, generation = vault.Generation });
            }
            if (request.Operation == "save")
            {
                var generation = vault.Generation;
                var previous = matching.FirstOrDefault(e => e.Id == request.EntryId);
                if (request.EntryId != null && previous == null) return BrowserResponse.Fail(request.Id, "The selected account no longer matches this website.");
                var item = ((previous ?? new Entry { Title = new Uri(origin).Host, Origins = [origin] }) with
                { Username = request.Username, Password = request.Password }).Validated();
                // New accounts were already approved in the extension's own prompt. Replacing a saved password can
                // destroy the only copy of it, so that still needs the native confirmation a web page cannot fake.
                if (previous != null)
                {
                    ShowFromTray();
                    if (!Dialogs.Confirm(this, $"Replace the saved password for {origin}?\n\nUsername: {item.Username}\n\nThis was captured after a submission attempt; login success was not verified.") ||
                        !vault.IsUnlocked || generation != vault.Generation || started.Elapsed > TimeSpan.FromSeconds(110))
                        return BrowserResponse.Fail(request.Id, "Update was not approved.");
                }
                vault.Save(item); idle.Restart(); Changed(); return new(request.Id, true, "", new { saved = true });
            }
            return BrowserResponse.Fail(request.Id, "Unsupported request.");
        }
        catch (Exception)
        { return BrowserResponse.Fail(request.Id, "The request could not complete. Check the desktop app; no credential was returned."); }
    }

    // ---- Window chrome follows the Windows light/dark setting -----------------------------------------------

    private static bool SystemDark() =>
        Registry.GetValue(@"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "AppsUseLightTheme", 1) is 0;
    private void DarkTitleBar(bool dark)
    {
        var value = dark ? 1 : 0;
        _ = DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 20, ref value, sizeof(int));
    }
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}

internal sealed record DesktopSettings(bool SiteIcons = true, GeneratorOptions? Generator = null);
