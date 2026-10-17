using System.Security.Principal;
using System.Windows;

namespace LocalVault.Desktop;

public partial class App : Application
{
    private Mutex? instance;
    private EventWaitHandle? showSignal;
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var smoke = e.Args.Contains("--ui-smoke");
        var preview = e.Args.Contains("--ui-preview");
        var name = "Local\\LocalVault." + WindowsIdentity.GetCurrent().User!.Value + (smoke ? ".smoke" : preview ? ".preview" : "");
        instance = new Mutex(true, name, out var created);
        // A second launch brings the running copy (often hidden in the tray) to the front instead of starting another.
        showSignal = new EventWaitHandle(false, EventResetMode.AutoReset, name + ".show");
        if (!created) { showSignal.Set(); Shutdown(); return; }
        try
        {
            var window = new MainWindow(smoke || preview, preview); MainWindow = window; window.Show();
            ThreadPool.RegisterWaitForSingleObject(showSignal, (_, _) => window.Dispatcher.BeginInvoke(window.ShowFromTray), null, -1, false);
            if (smoke)
                window.Dispatcher.BeginInvoke(() => { window.Close(); Shutdown(0); }, System.Windows.Threading.DispatcherPriority.ApplicationIdle);
        }
        catch
        {
            MessageBox.Show("LocalVault could not start. Check the installation and access to the local vault folder. Existing vault files have not been reset.", "LocalVault", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
    // Windows sign-out/shutdown must really close the window rather than hide it to the tray.
    protected override void OnSessionEnding(SessionEndingCancelEventArgs e) { (MainWindow as MainWindow)?.Quit(); base.OnSessionEnding(e); }
    protected override void OnExit(ExitEventArgs e) { showSignal?.Dispose(); instance?.Dispose(); base.OnExit(e); }
}
