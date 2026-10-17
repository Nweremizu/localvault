# LocalVault 0.2.1 — preview release

- Compact Security dashboard with prioritized findings, expandable breach results, and direct site shortcuts.
- Password history, Trash/Undo, secure notes/custom fields, and consent-based breach checks from 0.2.0 are included.
- Settings → Install update accepts a newer downloaded LocalVault MSI, validates compatibility, requires confirmation, locks the vault, and hands off to Windows Installer. No separate uninstall is required. Vault, preferences, and pairing data stay outside the application directory.
- MSI upgrades retain the stable product family, reject downgrades, and remove the prior version inside a rollback transaction.
- Removed the unused cn npm dependency, included missing frontend/WebView2 notices, synchronized versions, and corrected stale lifecycle/Hello/network documentation.

## Upgrade

From 0.2.0 or earlier, close LocalVault using Quit in the system tray, then run the 0.2.1 MSI directly. From 0.2.1 onward, Settings also offers Install update for future, strictly newer packages. Reopen the app when Windows Installer finishes. Developer extensions must be reloaded; production extensions use approved browser channels.

Keep an encrypted backup before upgrading. This is an unsigned, unaudited preview. The updater validates package compatibility but cannot authenticate its publisher. There is no unattended update download or execution. Use only packages from the trusted LocalVault release source.

## Still requires external/manual verification

Real 0.2.0-to-0.2.1 install/rollback and uninstall data preservation on a disposable Windows account; live extension save/fill across Chrome/Edge/Firefox; Windows Hello enrollment/cancellation/reset on actual hardware; accessibility, scaling and clipboard history; separate-user ACL checks; signing and independent security review. These are release gates, not completed tasks.

## Automated validation

125 C# checks, 35 extension tests, 15 React tests, 3 native bridge checks, 12 MSI database assertions, actual-MSI update-reader validation, and production UI/extension/self-contained desktop builds passed. Production npm and transitive NuGet audits reported no known vulnerabilities. See VALIDATION.md for scope and remaining gates.
