# Validation — 17 October 2026

## Current release: 0.2.1

Built on Windows 11 x64 using the locked .NET/npm dependencies. Source is prepared for https://github.com/Nweremizu/localvault. Current results supersede the historical runs below.

| Check | Result |
| --- | --- |
| Release vault/protocol/update harness | 125 checks passed; disposable synthetic vaults only |
| React interactions | 15 tests passed, including explicit update action, canceled selection, and error reporting |
| Browser extensions | Chrome/Edge/Firefox builds; 35 form/security tests passed |
| Desktop and bridge | Self-contained Release publication succeeded |
| Native bridge executable | 3 framing/caller-denial checks passed |
| MSI | Built; 12 database assertions passed, including stable UpgradeCode, per-user registration, downgrade/previous-version detection, and rollback-scoped removal |
| Desktop MSI reader | Validated the actual 0.2.1 MSI as a newer update using the same native read-only metadata code as the app |
| Production dependency audits | UI and extension npm audits: zero known vulnerabilities; NuGet solution including transitive dependencies: none reported |
| Public-source hygiene | Generated output, vault/CSV data, dependency folders, environment files and private keys excluded; staged files inspected for common private-key/token patterns with no matches |

The full build used `scripts/build.ps1 -SkipInstall` to reuse installed npm dependencies while keeping the Vite dev server running; restore used NuGet locked mode and normal signature checks. Published files are under `artifacts/0.2.1/app`; the MSI is `artifacts/LocalVault-0.2.1-win-x64.msi`.

Not performed for this release: actual installation/0.2.0-to-0.2.1 upgrade/failed-install rollback/uninstall, desktop startup smoke, real external-site launches or password changes, live native-host browser pairing/fill/save, Hello hardware checks, separate-user ACL checks, visual/screens-reader/scaling verification, code signing, or independent security review. Earlier startup/browser fixtures below are historical evidence and do not establish current live integration coverage. No production vault was accessed or changed. Packages are unsigned; updater metadata checks do not authenticate the publisher. Online downloads and silent auto-updates are not implemented.

## Historical validation


## Extension update — 16 October 2026, version 0.1.3

The required HTTPS host permission replaces the separate enable step. The full build passes 81 current C# checks and 26 extension checks, including inline-session/frame binding, lock and navigation races, hidden/replaced inputs, focus restoration, and unrelated-field dismissal. A headless Edge profile loaded the actual unpacked bundle and verified required HTTPS access without a separate extension prompt. Its extension-origin iframe authenticated, displayed matching synthetic accounts, rejected a synthetic click, and filled/dismissed through trusted pointer and keyboard selections with focus restoration. That browser check substituted an in-memory Native Messaging fixture; it did not access a real vault or verify the installed native host. Full live Chrome/Firefox integration and browser permission/upgrade prompts remain manual acceptance checks.

## Earlier baseline

Built on Windows with the .NET 10.0.402 SDK and self-contained .NET 10.0.13 runtime for Windows x64.

| Check | Result |
| --- | --- |
| Entire C# solution, Release | Passed; zero warnings and errors |
| NuGet restoration with committed lock files | Passed with `--locked-mode`; official feed and normal signature checks |
| C# vault/protocol harness | 78 checks passed, using disposable synthetic vaults |
| Shared browser extension TypeScript build | Passed for Chrome, Edge and Firefox bundles |
| Extension form/security suite | 19 tests passed (DOM tests and a simulated browser/native API) |
| npm dependency audit, including development packages | No known vulnerabilities reported |
| NuGet vulnerability audit, including transitive packages | No known vulnerabilities reported in all four projects |
| Published self-contained desktop startup | `--ui-smoke` exited successfully; isolated temporary data, no production vault access |
| Published native bridge | 3 checks passed: unknown caller rejection, oversized-frame rejection, correctly framed denial for an unavailable/unpaired desktop |
| MSI packaging | WiX build succeeded; embedded application and extension payload |
| MSI database inspection | 9 checks passed: version, per-user scope, HKCU-only installed registry entries, three native host registrations, no vault/CSV payload, desktop/bridge executables |

Measured Argon2id creation times were 418–580 ms with 3 iterations and 256 MiB of memory on this machine; the final run took 441 ms. This is not calibration across other supported hardware.

One implementation correction was required: the originally planned LibSodium.Net alpha wrapper rejects current native libsodium 1.0.22. The application instead uses stable Sodium.Core 1.4.1, whose declared native dependency supports 1.0.22. No library version checks are bypassed; Argon2id, authenticated encryption, and the v1 vault layout are unchanged.

## Feature release — 17 October 2026, version 0.2.0

| Check | Result |
| --- | --- |
| C# vault/security harness | Passed 114 assertions, including v2 migration, history/Trash, CSV replacement history, notes/fields, backups, synthetic strength/reuse checks, bounded 16 MiB writes, and mocked HIBP parsing/errors/cancellation. No production vault was accessed and no live HIBP request was made. |
| React interaction suite | Passed 10 workflows for masked secret fields, secure-note creation, breach consent/cancellation/partial results, priority review, finding filters, unassessed-password handling, history restore confirmation, and Trash Undo. |
| React production build | Passed TypeScript check and Vite production build (2,041 modules). |
| Browser extension suite/build | Passed 35 extension security tests and TypeScript builds for Chrome, Edge and Firefox. |
| .NET restore/build | Locked restores and Release builds passed for all four projects. Individual project builds completed with zero warnings and errors. |
| Desktop smoke check | Published `LocalVault.exe --ui-smoke` exited successfully using its isolated temporary vault. |
| 0.2.0 MSI | WiX build passed. Database inspection passed 9 checks: version, per-user scope, HKCU-only registry entries, all three native hosts, no vault/CSV payload, and both executables. The installer contains 566 files and is unsigned. |

The NuGet vulnerability-data endpoint was unavailable during final packaging. The final locked restore used `-p:NuGetAudit=false`; the checked-in build script offers the same offline-only behavior through `-SkipNuGetAudit`. Neither changes package versions, but the current remote NuGet vulnerability audit remains unverified. A previous locked restore without the switch completed for all four projects. The full PowerShell build script also hit a transient `npm ci` `EPERM` in this sandbox; the bundles, tests, project publishes, and installer were built and checked in separate steps.

The Security dashboard redesign was verified with interaction tests, TypeScript, production compilation, and static layout review. Live browser preview was denied by the browser origin-approval policy. Screenshots, supported-width rendering, 200% zoom, RTL rendering, pseudo-localization, and screen-reader behavior are **Not verified** for this redesign. See `ui/SECURITY-REDESIGN.md` for the scoped review.

The subsequent breach-first live-preview iteration passed 12 React tests and the production UI build. It adds a top-level privacy walkthrough and filterable breach results. The MSI was not rebuilt for this iteration; the earlier installer results above describe the previously packaged design.

## Not verified here

- Actual installation/upgrade/uninstallation and live, paired Chrome/Edge/Firefox integration.
- Browser-store submission or persistent Mozilla-signed unlisted Firefox distribution; only developer-loadable extension bundles are supplied.
- Real Windows Hello hardware/OS prompts, Windows lock and suspend/resume, another Windows user's access checks, cross-device restore, clipboard history behavior, and full screen-reader/scaling checks.
- Independent security review and production code signing/update operations.

The installer and binaries are unsigned private-beta artifacts. Automated checks do not certify their security. Complete the manual checks in `ACCEPTANCE.md` and obtain independent review before using valuable credentials or distributing publicly.


The compact Security iteration removes the hero walkthrough, large overview, and chart. Breach status remains first; detailed results and privacy are collapsed, with dense actionable warnings below. All 12 React interaction tests and the production TypeScript/Vite build passed. Browser rendering remains unverified; installer and unchanged backend/extension suites were not rebuilt or rerun.


The breached-account Go to site iteration passed 14 React interaction tests, 35 extension tests, 114 C# vault checks, UI/extension production builds, and desktop Debug compilation (zero warnings/errors). New UI coverage verifies item-ID-only launch requests, unchanged warnings on launch, launch failures, disabled manual-use shortcuts, and fresh local analysis/cleared breach results after a vault revision. Existing extension checks verify new-password capture and confirmed update requests. No real site was opened or password changed during validation. Installer not rebuilt; native shell launching and live extension-to-desktop flows require manual verification.
