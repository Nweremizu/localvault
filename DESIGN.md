# LocalVault interface guide

The desktop window is WPF, but the vault screens are a React app rendered inside WebView2. Edit `ui/src/App.tsx` for the workspace and navigation, `ui/src/dialogs.tsx` for item/history/Trash dialogs, and `ui/src/index.css` for global Tailwind tokens. The Security review workspace lives in `ui/src/SecurityDashboard.tsx`, with scoped layout and color tokens in `ui/src/security.css`. Shared controls live in `ui/src/components/ui/`. The desktop bridge and in-memory design preview are in `ui/src/bridge.ts`.

The browser popup and field picker are separate extension pages in `extensions/src/`. Their shared styles and behavior are built from TypeScript and CSS with `npm run build` in `extensions`.

## Visual direction

The desktop uses a quiet workspace: a searchable navigation sidebar and a selected-item pane. Its palette stays near-white and warm gray with one violet accent: canvas `#F8F8F6`, sidebar `#FBFBFA`, ink `#262725`, muted text `#70736F`, divider `#E6E6E2`, accent `#6558D3`, and selected surface `#F0EEFF`. Keep focus, selection, lock state, and destructive actions understandable without color alone.

Keep item summaries free of note bodies and secret values. Ask the desktop bridge only for the selected item, selected history revision, or explicitly requested scan. Reuse the shared button, input, dialog, tooltip, and table components before adding new UI primitives.

## Preview and live editing

For the isolated sample vault, select **LocalVault: UI preview** in VS Code and press **F5**. It launches `LocalVault.exe --ui-preview`; it never opens the real vault. Close an existing preview before starting another one.

For React-style hot reload in the WPF window, start Vite from `ui` with `npm run dev -- --host localhost`, then start the app with `LOCALVAULT_UI_DEV=http://localhost:5173`. In PowerShell:

```powershell
$env:LOCALVAULT_UI_DEV = 'http://localhost:5173'
dotnet run --project src/LocalVault.Desktop -- --ui-preview
```

The desktop only accepts this localhost development origin in Debug builds. Vite HMR refreshes layout and style changes immediately; restart the app for changes to C# or WPF window behavior. Production builds embed `ui/dist` and use a restrictive WebView2 content security policy.

Review locked and unlocked views, note/password editors, history, Trash confirmation, breach-check consent, keyboard focus, narrow windows, and 200% Windows text scaling after visual edits. The installer is unsigned, and visual polish does not replace an independent security review.
