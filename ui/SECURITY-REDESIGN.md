# Compact security workspace

Security uses a single-column review list with a small breach panel first. It keeps the existing app typography and colors. Large counts, distribution charts, the separate overview card, and the privacy walkthrough have been removed.

| Severity | Source | Change | Reason |
| --- | --- | --- | --- |
| Medium, addressed | `ui/src/SecurityDashboard.tsx:84` | One header with active-password count, local-check time, and refresh. | Remove repeated summaries. |
| Medium, addressed | `ui/src/SecurityDashboard.tsx:115` | Small breach status panel; scan results and privacy details expand on demand. | Keep warnings visible without a tall introductory flow. |
| Medium, addressed | `ui/src/security.css:18` | Smaller outer spacing, compact filters, dense account rows, badges beside warnings. | Increase information density while retaining readable text and distinct controls. |
| Medium, addressed | `ui/src/security.css:70` | Rows and actions wrap using dashboard container width. | Preserve reading order in narrow panes. |

Breach findings still take priority over reuse, weakness, and unassessed passwords. Each account appears once in the review list. Result-category filters and direct account navigation remain in the expandable scan results. Unavailable requests remain visible outside the disclosure. Every online check still requires consent; cancellation and vault-change invalidation are unchanged. No vault schema, browser protocol, or network behavior changed.

Verification: 12 React interaction tests passed; TypeScript and Vite production build passed. Tests cover collapsed privacy/results, breach-first DOM order, consent, cancel, partial responses, priority, and account navigation. The Vite preview remains on localhost:5173.

Not verified: actual rendering, narrow windows, zoom, RTL, screen readers, or light/dark screenshots. Previous browser origin approval was rejected; no alternative surface was used. Backend and extension suites were not rerun for this UI-only change. The installer was not rebuilt.

Approve: scoped to source inspection and passing interaction checks; visual coverage remains unverified.



## Breached-account site shortcut

Both breached review rows and expanded found results include Go to site. The desktop receives only an item ID, requires an unlocked active login, reads its first saved origin, validates it with the existing HTTPS origin parser, and opens the default browser. Launch failures leave findings intact. Manual-use accounts have a disabled shortcut. The design preview opens the same origin in a separate tab.

The existing extension capture/update confirmation flow is reused. Opening a website never marks a finding resolved. A confirmed save notifies React and triggers local reanalysis, while clearing stale online results. Unsupported or username-less forms may require manual editing; no website success is inferred.

Validation: 14 UI interaction tests, 35 extension tests, 114 C# vault checks, production UI/extension builds, and desktop Debug build passed. Real browser navigation/password changes, visual rendering, and the installer remain unverified/not rebuilt for this iteration.
