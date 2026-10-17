using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace LocalVault.Desktop;

// Metadata is a compatibility check, not proof of publisher identity. Installation always needs native confirmation.
internal static class InstallerUpdate
{
    internal const string UpgradeCode = "4E2E6377-7F0E-423A-A263-5F5E8F5F9C29";

    internal static Version Validate(IReadOnlyDictionary<string, string> properties, Version current)
    {
        if (properties.GetValueOrDefault("ProductName") != "LocalVault Private Beta" ||
            !Guid.TryParse(properties.GetValueOrDefault("UpgradeCode"), out var family) || family != Guid.Parse(UpgradeCode) ||
            !string.IsNullOrEmpty(properties.GetValueOrDefault("ALLUSERS")))
            throw new InvalidDataException("Choose a per-user LocalVault update package.");
        if (!Version.TryParse(properties.GetValueOrDefault("ProductVersion"), out var version) ||
            version.Build < 0 || version.Revision >= 0 || version.Major > 255 || version.Minor > 255 || version.Build > 65535 ||
            version <= new Version(current.Major, current.Minor, current.Build))
            throw new InvalidDataException("Choose a LocalVault version newer than the installed version.");
        return version;
    }

    internal static Version Inspect(string path, Version current)
    {
        var file = new FileInfo(path);
        if (!file.Exists || file.Length is <= 0 or > 512 * 1024 * 1024 || !path.EndsWith(".msi", StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Choose a LocalVault MSI update package (up to 512 MiB).");
        Ensure(MsiOpenDatabase(path, IntPtr.Zero, out var database));
        try
        {
            Ensure(MsiDatabaseOpenView(database, "SELECT `Property`, `Value` FROM `Property`", out var view));
            try
            {
                Ensure(MsiViewExecute(view, 0));
                var properties = new Dictionary<string, string>();
                for (var count = 0; ; count++)
                {
                    var result = MsiViewFetch(view, out var record);
                    if (result == 259) break; // ERROR_NO_MORE_ITEMS
                    Ensure(result);
                    try
                    {
                        if (count >= 128) throw new InvalidDataException("Invalid update package metadata.");
                        properties.Add(Read(record, 1), Read(record, 2));
                    }
                    finally { MsiCloseHandle(record); }
                }
                return Validate(properties, current);
            }
            finally { MsiCloseHandle(view); }
        }
        finally { MsiCloseHandle(database); }
    }

    private static string Read(uint record, uint field)
    {
        var buffer = new StringBuilder(1024); uint size = 1024;
        Ensure(MsiRecordGetString(record, field, buffer, ref size));
        return buffer.ToString();
    }
    private static void Ensure(uint result)
    { if (result != 0) throw new InvalidDataException("The selected update package could not be validated."); }

    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiOpenDatabaseW")]
    private static extern uint MsiOpenDatabase(string path, IntPtr persist, out uint database);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiDatabaseOpenViewW")]
    private static extern uint MsiDatabaseOpenView(uint database, string query, out uint view);
    [DllImport("msi.dll")]
    private static extern uint MsiViewExecute(uint view, uint record);
    [DllImport("msi.dll")]
    private static extern uint MsiViewFetch(uint view, out uint record);
    [DllImport("msi.dll", CharSet = CharSet.Unicode, EntryPoint = "MsiRecordGetStringW")]
    private static extern uint MsiRecordGetString(uint record, uint field, StringBuilder value, ref uint size);
    [DllImport("msi.dll")]
    private static extern uint MsiCloseHandle(uint handle);
}
