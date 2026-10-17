using System.Windows;

namespace LocalVault.Desktop;

// Browser pairing and save approvals stay native so web content can never imitate them.
internal static class Dialogs
{
    public static bool Confirm(Window owner, string message) => MessageBox.Show(owner, message, "LocalVault", MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) == MessageBoxResult.Yes;
}
