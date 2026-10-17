# Private-beta acceptance

This file distinguishes automated checks from manual release gates. A successful build is not a security certification.

## Automated checks

- C# assert-based harness: vault round trip; wrong passwords; authenticated metadata/key/payload; malformed/truncated files; bounded KDF; failed atomic replace; encrypted previous revision; session-memory protection and invalidation; password change; backup verification/preservation; CSV quoting, notes, HTTP handling, duplicates, conflicts, replacement history and transactionality; legacy-array migration to v2; item history/no-op detection/20-revision trimming/restore; Trash/Undo/restore/purge; custom-field bounds; local weak/reuse checks; mocked HIBP prefix/padding/errors/cancellation; hashed/revoked pairing tokens; strict IPC and framing; password generator; concurrent writes.
- React/Vitest interaction suite: secure-note creation and custom fields; secret-field masking/reveal; online-check consent and polling; explicit history reveal/restore confirmation; Trash Undo.
- Extension TypeScript compilation and Node tests: exact origins and IDN/ports; document/tab races; form visibility and ambiguity; signup/password-change capture; username-only multi-step filling; event-driven DOM mutation; capture size bounds; popup authorization; cross-origin frame rejection; lock during fill; ephemeral pending captures; same-origin redirects; explicit save and fresh pairing codes.
- Production extension dependency audit: `npm audit --omit=dev`.
- Desktop initialization smoke check: `LocalVault.exe --ui-smoke` creates and removes a separate temporary empty test folder; it does not access the production vault or register a native pipe.

Actual run results are recorded in `VALIDATION.md` after building.

## Required manual checks before distributing real credentials

Use a disposable Windows account and synthetic credentials. Keep a copy of the fixture vault before intentionally damaging files.

| Area | Cases and expected result |
| --- | --- |
| Installer | Validate a 0.2.0 → 0.2.1 upgrade without manual uninstall, cancel/fail an upgrade and verify rollback. Test Settings → Install update with wrong product, same version, downgrade, corrupt MSI, cancellation and launch failure. Install, upgrade and uninstall as a standard Windows user. Verify Start shortcuts, each browser's host registry entry, absolute manifest registry path, relative executable path resolution, and data-folder preservation. Reinstall and unlock the retained vault. |
| Browser setup | Chrome and Edge load the fixed-ID development builds. Firefox loads a temporary build; test a signed unlisted build for persistent setup. Confirm HTTPS access is requested at installation with no separate LocalVault enable step, including permission warnings on upgrades, withheld access, and already-open tabs. Approve matching pairing codes and revoke each browser independently. Rejected/expired requests must not pair. |
| Inline picker | Focus login username/current-password fields, including dynamically inserted and username-first forms. Select accounts by trusted pointer/keyboard interaction. Check below/above positioning, scrolling/resizing, Escape/outside dismissal, focus restoration, one-minute expiry, replaced/hidden fields, lock/revocation, navigation, guessed nonces, unrelated frames, page styles/CSP and spoofed controls. No password may reach the picker frame. Keep toolbar/manual fallback. |
| Login/save | Login, signup, password change, multiple accounts, dynamic forms, username-first navigation, submission failures, same-origin redirects, cross-origin redirects. Show SAVE and explicit save/update choices only; never assert login success or auto-overwrite. |
| Fill | Select an account on its exact origin. Check IDN domains, similar-looking domains, subdomains, ports, hidden fields, iframes, multiple forms, navigation/tab changes, permission denial/removal, private windows, and app/browser restarts. No fill across unmatched boundaries. |
| Hello hardware | Real configured fingerprint, face and PIN where available. Enable, cancel, fail verification, lock/reopen, end session, restart app/Windows, change Hello configuration, disable Hello. Cancellation/failure must remain locked; persistent Hello enrollment after restart and master-password fallback. |
| Lifecycle | Wait five minutes with and without browser traffic; lock Windows; suspend/resume. Vault locks, dialogs drop unsaved values, and pending browser saves clear. Lock during Argon2/import/save must never reopen automatically. |
| Clipboard | Check 30-second expiry and immediate lock cleanup. Copy different content before expiry and verify it survives. Inspect Windows clipboard history/roaming exclusion. |
| Recovery | Restore a backup on another computer/Windows account using its original master password. Wrong passwords and damaged backups leave current data intact. Test an unreadable/corrupt current primary without resetting it; preserve before restoring. |
| History | Change an item from desktop, browser save/update, and CSV Replace; confirm each real content change creates one prior revision and a no-op does not. Restore an older login and note, verify current content is captured first, and confirm revision summaries and unselected revision details omit secrets. |
| Secure notes and fields | Create/edit a plain-text note with text and secret fields. Check the 32-field, 128-character label, and 16,384-character value boundaries; confirm secret fields stay masked until reveal/copy and note text renders literally. Confirm notes and fields never appear in extension matches. |
| Trash | Delete, restart, restore from Trash, and purge a synthetic item. Undo only within ten seconds. Confirm typed permanent-delete warning and that the UI explains backups and preserved encrypted revisions may retain old data. |
| Security dashboard | Confirm weak/reused findings open the correct active login, while notes, custom fields, history, and Trash are excluded. Try passwords over 1,024 characters and verify “Not assessed.” |
| Breached-password check | Review consent before each scan. With mocked responses, verify unavailable/partial outcomes and cancellation on lock or vault change; do not send real credentials during development. A “not found” result must not be presented as proof of safety. |
| Storage ACL | As a second standard Windows user, attempt to read files under the original user's vault folder and connect to its named pipe. Access should fail. |
| Accessibility | Keyboard-only setup, list navigation, entry edit, import actions and backup/restore. Verify Narrator labels, focus, error announcements, high contrast, and 150%/200% display scaling. |
| Diagnostics | Inspect app/bridge/browser diagnostic output and installed files after synthetic operations. No passwords, master passwords or plaintext vault/CSV copies. |

## Before public release

Independent review of cryptography, dependencies, IPC, extension permissions, origin/form handling, and Windows session behavior; code signing and verified update distribution; approved browser distribution and fixed production identities. These require real hardware, browser accounts, and external review and are not supplied by automated builds.
