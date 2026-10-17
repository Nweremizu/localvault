# Security design and release limits

## Threat boundary

This application protects vault files and encrypted backups from disclosure without the master password, subject to password strength, KDF cost, and the security of the cryptographic dependencies. User-restricted directory ACLs reduce accidental exposure to other Windows accounts. The app does not resist administrators, malware operating as the same Windows user, debugger/process injection, keyloggers, malicious browser builds, malicious allowed extensions, or compromised websites. A website can read any password filled into its own form.

No telemetry is configured. The extension has no external messaging interface, remotely hosted script, or network fetch. The desktop contacts Have I Been Pwned only when the user explicitly starts and confirms a breached-password check. Optional website icons are fetched directly from saved websites when enabled; those sites see the requests. Go to site opens the saved HTTPS origin in the external browser. The HIBP range API receives the IP address and first five hexadecimal characters of a SHA-1 hash; LocalVault matches suffixes locally and sends no password, full hash, username, or website. Requests use HTTPS, no cookies, no redirects, bounded response size, and at most four concurrent calls. Website scripts do not receive pairing tokens. Only pairing tokens persist in the extension's **local**, never sync, storage; native host registrations and app/browser binaries contain no vault secrets. Pairing tokens are bearer credentials; the desktop persists SHA-256 hashes only, binds them to an extension identity, and supports revocation. The local named pipe is restricted to the current Windows user. This is an IPC authorization boundary, not protection against a compromised Windows account.

## Vault format v1

All integers are little-endian. Files are bounded to 16 MiB and entries to 10,000. Unknown versions and any KDF cost other than the v1 supported preset are rejected before key derivation. No attacker-selected memory or iteration count reaches Argon2id.

| Offset | Length | Meaning |
| --- | --- | --- |
| 0 | 8 | ASCII `LVLT0001` |
| 8 | 4 | Format version, 1 |
| 12 | 4 | Argon2id v1.3 iterations, 3 |
| 16 | 4 | Memory, 268435456 bytes (256 MiB) |
| 20 | 16 | Random password salt |
| 36 | 24 | Random wrapping nonce |
| 60 | 48 | Random 32-byte vault key encrypted with XChaCha20-Poly1305, including tag |
| 108 | 24 | Random payload nonce, regenerated for every write |
| 132 | remainder | UTF-8 vault payload encrypted with XChaCha20-Poly1305, including tag |

The password is UTF-8 encoded with no normalization or truncation. Master-password creation/change requires 12–1,024 characters. Argon2id derives a 32-byte wrapping key. Wrapping AAD is bytes 0–35; payload AAD is the entire 132-byte header. Separate random nonces protect wrapping and payload. Metadata, sites, notes, usernames, passwords, history, custom fields, and Trash are inside the encrypted payload. The reader accepts legacy entry arrays and versioned v2 payloads; a successful mutation writes v2, which older app builds reject without rewriting. A password change generates a fresh salt and wrapping nonce; the vault data key remains random. Password changes do not re-encrypt earlier backups or erase old revisions.

Atomic saves write and flush encrypted bytes to a unique same-directory temporary file, then replace the primary and preserve its previous revision. Decrypted CSV data and serialized vault plaintext are never written to temporary files. Memory buffers for plaintext serialization, derived keys, IPC bodies, and active/session keys are cleared when no longer needed. Managed strings, browser strings, UI bindings, copies left by garbage collection, OS memory paging, and operating-system crash dumps cannot be guaranteed erased. Full-disk encryption is complementary protection.

## Persistent opt-in Windows Hello

The current desktop implementation enrolls a Windows KeyCredential and stores `hello.json` in the user-restricted data directory. A random challenge is signed after an OS Hello prompt; HKDF-SHA256 derives an AES-GCM wrapping key from the signature to encrypt a copy of the vault key. Enrollment therefore permits unlocking after app restarts. It depends on stable signature behavior and the Windows credential provider; TPM availability and enrollment cancellation/reset require hardware verification. This implementation has not received independent cryptographic review and must not be described as session-only or as guaranteed hardware-backed.

Active keys are cleared on lock/end session; enrollment remains until explicitly disabled or reset. The core's separate protected in-memory session-key facilities remain covered by unit tests, but those tests do not validate the desktop's persisted Hello enrollment. Managed strings and code running inside the user process remain outside this protection boundary.

## Application updates

The beta installer preserves a stable UpgradeCode and uses a rollback-scoped major upgrade. The desktop update action accepts only a user-selected MSI, reads bounded metadata using Windows Installer's read-only API, requires the expected product family/per-user scope and a strictly newer three-part version, and asks for native confirmation. It locks/ends the active session before starting the system `msiexec.exe` with separated arguments. It does not execute scripts from the UI, accept a UI-supplied file path, poll a server, or download binaries.

These metadata checks establish compatibility, not authenticity. Beta packages are unsigned, and the confirmation says so. No unattended update installation is provided. A signed, authenticated release channel with publisher verification is required before adding automatic downloads/execution. Vault and pairing files are outside the installation directory and are not MSI components. Failed-update rollback, existing-version upgrades, and data preservation still need real install tests on a disposable Windows account.

## Browser boundary

Native Messaging is limited to configured extension IDs. The bridge verifies the browser-supplied invocation identity, replaces any claimed client identity in the message, and forwards framed, size-limited requests over a current-user pipe. Desktop authorization checks run again per request. There is no bulk-read, script execution, file-access, or master-password operation in the protocol.

The toolbar popup can request fill/save/pair. An inline picker can request account summaries and one selected fill, authenticated by a fresh random nonce bound to the top tab, document, exact HTTPS origin, extension URL, and browser-supplied picker frame ID. Its frame lives in a closed shadow root so the page cannot read the nonce or account DOM; passwords never go to the picker. Only a trusted click or keyboard activation selects an account. Content scripts may open/dismiss a picker or report bounded captures from top-frame HTTPS sites; they cannot request credential reads directly. Filling rechecks the active tab, exact origin, document marker, selected form/input, visible/unambiguous targets, and vault generation. It never submits. New-account saves require extension confirmation; replacing a saved password additionally requires desktop approval. Replacement is explicit.

HTTPS host access is required at installation and remains subject to browser permissions and restricted-site policies. The inline host is still attached to an untrusted page: websites can disrupt or visually spoof extension affordances, and this design does not eliminate clickjacking. The toolbar offers an alternative selection surface. The nonce, selected target, and summaries stay in memory for at most one minute; no password is stored in the page UI or extension storage.

There remains an unavoidable asynchronous gap between the final desktop lock check and DOM insertion. Lock revocation of pending captures is polled at one-second intervals. Unsupported or ambiguous forms fail closed. Cross-origin frames and incognito windows are excluded in v1.

## Dependencies and release gates

- **Sodium.Core 1.4.1**, a stable .NET binding, and **libsodium 1.0.22** are explicitly pinned. This replaces the originally planned LibSodium.Net alpha wrapper because its ABI check rejects the current native library; no version checks are bypassed. The vault still uses Argon2id and XChaCha20-Poly1305 with the same v1 format.
- **zxcvbn-core 7.0.92** estimates password strength locally. Exact password reuse is checked locally. Optional HIBP results and range responses are held in memory only and discarded on lock; historical/trashed passwords and custom secret fields are excluded.
- Pin and inspect NuGet/npm lock files and native binaries. Automated tests are not a cryptographic audit.
- The MSI and desktop binaries here are unsigned beta builds. Public releases need a protected code-signing process, authenticated update distribution, store identity validation, and independent security review.
- Browser-store publication, Firefox signing, actual Hello hardware testing, other-user ACL checks, real suspend/resume, and accessibility testing require the acceptance steps in `ACCEPTANCE.md`.

Do not publish exploitable details or real credentials in bug reports. Supply a minimal reproduction using synthetic data; this project has no configured remote crash reporter.
