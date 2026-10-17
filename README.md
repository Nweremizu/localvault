# LocalVault — Windows private beta

A local encrypted password vault with Chrome, Edge, and Firefox extensions. Windows 11 x64 only. The vault, history, Trash, and dashboard checks stay on this device. Online breached-password checks contact Have I Been Pwned only when you start a scan and approve its disclosure. This beta has not received an independent security audit.

To change the appearance, see [DESIGN.md](DESIGN.md) for the React/Tailwind desktop UI, browser UI files, visual tokens, and preview command.

## Install and start

1. Run `artifacts/LocalVault-0.2.1-win-x64.msi`. It installs for the current Windows user, without an administrator account. The build is unsigned; verify its SHA-256 against the included checksums before installing.
2. Open **LocalVault** from Start. Create a unique master password of at least 12 characters. There is no password reset.
3. Create an encrypted backup through **Encrypted backups** and keep it on another device. A backup needs the master password used when it was created. Windows Hello cannot unlock a backup.

The vault lives in `%LOCALAPPDATA%\LocalVault\Data\vault.lvault`. The installer and uninstall process preserve this entire data folder. Keep the desktop app running for browser integration; closing the window hides it to the system tray. Use Quit from the tray to end the process.

## Connect browsers

The installer registers Native Messaging hosts for Chrome, Edge, and Firefox. Browser approval is required to install an extension. The app cannot silently install one or bypass browser policies.

**Chrome/Edge developer testing:** open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select `%LOCALAPPDATA%\Programs\LocalVault\extensions\chrome` or `...\edge`. Use only the supplied trusted build. These folders have a fixed development identity, also allowlisted by the bridge.

**Firefox developer testing:** open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `...\extensions\firefox\manifest.json`. Temporary installation ends on browser restart. Persistent private distribution requires a Mozilla-signed unlisted XPI. No signing account or submitted/signed package is included.

For private testers, distribute via approved store/private channels and signing. Confirm the resulting store extension IDs before release; store IDs may differ from development IDs. Update `browser-identity.json`, rebuild app/bridge/extensions/installer together, and retest pairing. Do not expand the allowlist to arbitrary extension IDs.

For each browser profile:

1. Approve the browser's installation permissions. HTTPS website access is required by the extension and enabled at installation, subject to browser controls; there is no separate LocalVault website-access button. Browser-internal/extension pages and private/incognito windows are excluded. Updating an older beta may require accepting the browser's new permission warning. If the browser withholds access, allow HTTPS sites in its extension settings.
2. With the desktop vault unlocked, enter a profile label and choose **Pair with desktop app**.
3. Verify the six-digit code matches the desktop request, then approve. Only pair requests you initiated. Revoke individual connections through **Browser connections** in the desktop app.
4. On a login page, focus a username/email or current-password field. An anchored LocalVault picker lists accounts for that exact HTTPS origin; select one to fill without submitting. Arrow Down enters the picker, arrow keys move among accounts, and Escape dismisses it. It opens below the input where space permits, otherwise above it. The toolbar popup remains available as a fallback. Subdomains and alternative ports require explicit additional websites on the saved entry.
5. After a login/signup/password-change submission attempt, a **SAVE** toolbar badge offers a prompt in the extension popup. Select a new account or an existing account to update. Approve the final desktop confirmation. Login success is not verified, so save only credentials you intended.

Save prompts expire after two minutes, clear when the vault locks (detected by polling within approximately one second), and clear on a change to another origin. Navigation within the same origin preserves them. Inline pickers expire after one minute and close on navigation, outside interaction, or session changes. Their account list is rendered in an extension-owned frame; passwords are never passed to that picker. Some redirects, complex forms, closed shadow DOM, CAPTCHAs, restrictive frame policies, browser-internal pages, ambiguous multi-form layouts, and cross-origin embedded login forms need the toolbar or manual entry/copy. Filling requires a visible unambiguous field and a current document. Existing HTTPS tabs are initialized on installation where permitted; reload a tab if detection has not started.

## Daily use

- **New password:** store a title, username, password, allowed HTTPS websites, and optional notes. A blank website list means manual use only. Use **Generate password** for a random 24-character password.
- **Secure notes and custom fields:** save notes as plain text inside the encrypted vault. Passwords and notes can include up to 32 labeled text or secret fields; secret fields stay masked until revealed or copied.
- **Password history:** content changes save the previous complete item, up to 20 revisions. Open **History** on an item to inspect or restore a revision. Restoring first saves the current version.
- **Trash and Undo:** deleting moves the item and its history to Trash. Undo is available for 10 seconds; later use **Trash** to restore or permanently delete items. Emptying Trash needs typed confirmation. Older encrypted backups and preserved vault revisions can still contain deleted data.
- **Security:** the dashboard checks active login passwords locally for reuse and estimates strength with zxcvbn. Passwords longer than 1,024 characters are marked not assessed. Optional breached-password checks are manual and ask for consent each time; LocalVault sends your IP and a five-character SHA-1 hash prefix to Have I Been Pwned. It never sends the password, full hash, username, or website. A result not found does not prove safety.
- **Fix a breached password:** use **Go to site** beside the affected account. This opens its first saved HTTPS origin in your default browser; navigate to the site's password settings. Keep LocalVault unlocked and use a browser with the paired extension and website access enabled. On supported forms, submitting the replacement offers an Update prompt; approve the extension prompt and the desktop replacement confirmation to save it. The previous password is retained in history and Security refreshes. If the form omits an identifiable username or no prompt appears, edit the saved account manually. Opening the site alone does not resolve a finding, and the app cannot verify that the website accepted a password change. Online breach results are discarded when the vault changes; a new online check requires consent again.
- **Import browser CSV:** choose a Chrome/Edge export, review rows, and commit. Exact duplicates skip automatically; conflicting accounts default to Skip. Choose Replace explicitly to overwrite. Invalid rows are ignored; a conflicting or invalid commit cannot partially write the vault. HTTP entries are manual-use only, with their original URL retained in notes. The source CSV is plaintext and remains your responsibility; LocalVault does not delete it.
- **Copy:** the app requests exclusion from Windows clipboard history and roaming. Copied values clear after 30 seconds or on lock if the ownership marker is still present. Clipboard monitoring software can still observe copied text.
- **Lock:** clears decrypted entries and the active vault key. If you enrolled Windows Hello, a protected copy of the vault key remains encrypted in the local Hello enrollment file; OS authentication is required to unwrap it.
- **End session / Quit:** clears active keys. Windows Hello enrollment persists across restarts until disabled in Settings; the master password remains the fallback. Closing the window hides it to the tray.
- The app locks after five minutes without input in the desktop window, on Windows lock, and before suspend. Explicit browser credential retrieval and confirmed saves reset the timer; background status polling does not. Unsaved desktop dialogs close on lock.
- **Master password:** verify the current password before changing it. Keep the old password for old backups and preserved encrypted revisions.

## Updating without uninstalling

Download the newer MSI from [LocalVault releases](https://github.com/Nweremizu/localvault/releases). Run it directly over your existing installation, or choose **Settings → Install update…** in version 0.2.1 and later. The in-app action checks the package's LocalVault upgrade family, per-user scope, and strictly newer version, asks for native confirmation, then locks and exits before launching Windows Installer. Reopen LocalVault after installation. No separate uninstall is needed. The vault, browser pairings, and preferences remain in the app data directory. Make an encrypted backup before updating.

This beta uses user-selected packages; it does not poll GitHub, download updates, or silently execute them. Package metadata is not publisher authentication, and the beta binaries are unsigned. Obtain packages only from the trusted release source. An interrupted or canceled update is handled by Windows Installer's transaction; verify failure/rollback on a disposable Windows account before wider distribution. Browser extensions still update through their browser-approved channels; reload developer builds manually.

## Backup and recovery

Create backups outside the vault data folder. The app retains `vault.lvault.previous` when saving, and creates a separate `vault.lvault.before-restore.<timestamp>` before restoring over an existing valid vault. These are encrypted full snapshots and can include old/deleted credentials. Clean old copies yourself after verifying a separate backup.

Version 0.2.0 reads legacy entry-array payloads and migrates them to a versioned payload on the first successful vault mutation. Older app versions reject the new payload without modifying the vault; do not downgrade after updating.

If the primary file is damaged, close the app, preserve all files, copy a known valid encrypted revision to a `.lvault` file outside the data folder, and use **Restore encrypted backup** with its original password. The app never automatically resets a damaged vault. Restore verifies authentication and format before replacing anything. Data destruction, forgotten master passwords, and the loss of all valid backups cannot be recovered by this product.

## Build and checks

Prerequisites: Windows 11 x64, .NET 10 SDK, Node.js 22+, npm, network access for package restore. No runtime installation is needed by the published self-contained application. Build from this directory:

```powershell
powershell -NoProfile -File scripts/build.ps1
# Or supply a workspace-local SDK:
pwsh -NoProfile -File scripts/build.ps1 -Dotnet C:\path\to\dotnet.exe
```

The script pins dependencies, runs the C# check harness and extension tests, publishes self-contained binaries, and builds an MSI with WiX 6.0.2. Use `-SkipInstaller` for an app-only build, or `-SkipInstall` to reuse already restored npm dependencies (for example while the dev server is running). Published binaries are staged under `artifacts/0.2.1/app/`. WiX is installed locally in `.tools` when needed. Source projects use NuGet lock files; use `dotnet restore --locked-mode` in CI and `npm ci` for repeatable restoration.

To inspect the desktop design without opening your actual vault, run `artifacts/0.2.1/app/LocalVault.exe --ui-preview` after building. It displays sample entries in a temporary vault that is removed when the preview closes. The browser popup styles are in `extensions/src/popup.html` and `extensions/src/popup.css`; rebuild them with `npm run build` from `extensions`.

```powershell
dotnet run --project tests/LocalVault.Tests -c Release
cd extensions
npm ci
npm run build
npm test
```

See `SECURITY.md` for boundaries and `ACCEPTANCE.md` for automated results and the hardware/browser checks still required. Use disposable test credentials until those checks and independent review are complete.
