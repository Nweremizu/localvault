import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArchiveRestore, Check, Copy, Dices, Eye, EyeOff, Fingerprint, Globe, History, KeyRound, Lock, MoreHorizontal, NotebookPen, Pencil, Plus, RotateCcw, Search, Settings, ShieldCheck, Trash2, Undo2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { SecurityDashboard } from './SecurityDashboard';
import { call, isMock, onHostChange, type EntryContent, type EntryView, type ImportRowView, type VaultState } from './bridge';
import { BackupsDialog, BrowsersDialog, ConfirmDelete, EntryDialog, GeneratorDialog, HelloOffer, HistoryDialog, ImportDialog, ResetDialog, RestoreDialog, SettingsDialog, TrashPurgeDialog } from './dialogs';

export type Notify = (message: string, tone?: 'default' | 'error') => void;

export function App() {
  const [state, setState] = useState<VaultState | null>(null);
  const [offerHello, setOfferHello] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'default' | 'error'; key: number } | null>(null);
  const notify = useCallback<Notify>((message, tone = 'default') => setToast({ message, tone, key: Date.now() }), []);
  const refresh = useCallback(async () => setState(await call('state')), []);

  useEffect(() => { void refresh(); return onHostChange(() => void refresh()); }, [refresh]);
  useEffect(() => { if (state?.notice) notify(state.notice, 'error'); }, [state?.notice, notify]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 3200);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <>
      {state == null ? null : state.unlocked
        ? <VaultScreen onLocked={refresh} notify={notify} state={state} offerHello={offerHello} onHelloOffered={() => setOfferHello(false)} />
        : <LockScreen state={state} onChange={refresh} notify={notify} onCreated={() => setOfferHello(state.helloAvailable)} />}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
        {toast && (
          <div key={toast.key} className={cn('animate-in fade-in slide-in-from-bottom-1 max-w-md rounded-lg bg-popover px-3.5 py-2 text-[13px] text-popover-foreground duration-200 ease-out',
            'shadow-[0_0_0_1px_var(--border),0_8px_24px_-6px_oklch(0_0_0/0.25)]', toast.tone === 'error' && 'text-destructive')}>
            {toast.message}
          </div>
        )}
      </div>
    </>
  );
}

// ---- Lock / create ---------------------------------------------------------------------------------------

let helloTriedAtLaunch = false;

function LockScreen({ state, onChange, notify, onCreated }: { state: VaultState; onChange: () => Promise<void>; notify: Notify; onCreated: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const creating = !state.exists;
  const hello = state.exists && state.helloEnrolled;

  const run = async (action: () => Promise<unknown>, success?: string) => {
    setWorking(true); setError('');
    try { await action(); if (success) notify(success); await onChange(); }
    catch (e) { setError((e as Error).message); }
    finally { setWorking(false); }
  };
  const submit = () => {
    if (creating && password !== confirm) { setError('The master passwords do not match.'); return; }
    const value = password; setPassword(''); setConfirm('');
    void run(async () => { await call(creating ? 'create' : 'unlock', { password: value }); if (creating) onCreated(); },
      creating ? 'Vault created. Keep an encrypted backup somewhere safe.' : undefined);
  };
  const unlockWithHello = () => void run(() => call('hello'));
  // Opening the app goes straight to the Windows Hello prompt; after a manual lock the user chooses.
  useEffect(() => { if (hello && !helloTriedAtLaunch) { helloTriedAtLaunch = true; unlockWithHello(); } else helloTriedAtLaunch = true; }, []); // once per app run
  const pickRestore = async () => {
    try { const file = await call('restorePick'); if (file) setRestoreFile(file); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <main className="flex h-full flex-col items-center justify-center px-6">
      <form className="w-full max-w-[340px]" onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
          <Logo className="size-10" />
          <h1 className="mt-6 text-xl font-semibold tracking-tight">{creating ? 'Create your vault' : 'Welcome back'}</h1>
          <p className="mt-1.5 text-muted-foreground">
            {creating ? 'Choose a master password of at least 12 characters. It cannot be recovered.' : hello ? 'Unlock with Windows Hello or your master password.' : 'Enter your master password to unlock.'}
          </p>
        </div>
        <div className="animate-in fade-in slide-in-from-bottom-1 mt-7 space-y-2.5 fill-mode-both duration-300 ease-out [animation-delay:100ms]">
          {hello && (
            <>
              <Button type="button" className="h-10 w-full" disabled={working} onClick={unlockWithHello}>
                {working ? <Spinner /> : <><Fingerprint /> Unlock with Windows Hello</>}
              </Button>
              <div className="flex items-center gap-3 py-1.5 text-[12px] text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            </>
          )}
          <Input type="password" autoFocus={!hello} autoComplete="off" maxLength={1024} placeholder="Master password" aria-label="Master password"
            value={password} onChange={e => setPassword(e.target.value)} disabled={working} className="h-10" />
          {creating && (
            <Input type="password" autoComplete="off" maxLength={1024} placeholder="Confirm master password" aria-label="Confirm master password"
              value={confirm} onChange={e => setConfirm(e.target.value)} disabled={working} className="h-10" />
          )}
          <Button type="submit" variant={hello ? 'outline' : 'default'} className="h-10 w-full" disabled={working || !password}>
            {working && !hello ? <Spinner /> : creating ? 'Create vault' : hello ? 'Unlock with password' : 'Unlock'}
          </Button>
          <p role="alert" className="min-h-5 text-[12.5px] text-destructive">{error}</p>
        </div>
        <div className="animate-in fade-in fill-mode-both mt-2 flex flex-col items-start gap-0.5 duration-300 ease-out [animation-delay:200ms]">
          <Button type="button" variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" disabled={working} onClick={() => void pickRestore()}>
            <ArchiveRestore /> Restore from backup
          </Button>
          {state.exists && (
            <Button type="button" variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" disabled={working} onClick={() => setResetOpen(true)}>
              <KeyRound /> Forgot master password?
            </Button>
          )}
        </div>
      </form>
      <p className="fixed bottom-5 text-xs text-muted-foreground">Stored only on this device{isMock && ' · design preview'}</p>
      <RestoreDialog file={restoreFile} onClose={() => setRestoreFile(null)}
        onRestored={async () => { setRestoreFile(null); notify('Backup restored. The previous vault was preserved.'); await onChange(); }} />
      <ResetDialog open={resetOpen} onClose={() => setResetOpen(false)}
        onReset={async () => { setResetOpen(false); notify('LocalVault was reset. Create a new master password.'); await onChange(); }} />
    </main>
  );
}

// ---- Unlocked workspace ----------------------------------------------------------------------------------

type Dialog = { kind: 'new'; type?: 'login' | 'note' } | { kind: 'edit'; entry: EntryView } | { kind: 'delete'; entry: EntryView } | { kind: 'import'; rows: ImportRowView[] }
  | { kind: 'history'; entry: EntryView } | { kind: 'trashPurge'; entry?: EntryView } | { kind: 'backups' } | { kind: 'restore'; file: string }
  | { kind: 'browsers' } | { kind: 'settings' } | { kind: 'generator' } | null;
type Section = 'passwords' | 'notes' | 'security' | 'trash';

async function loadPages(op: 'list' | 'trashList'): Promise<EntryView[]> {
  const items: EntryView[] = []; let offset = 0; let total = 0;
  do { const page = await call(op, { offset }); total = page.total; items.push(...page.items); offset += page.items.length; if (!page.items.length) break; } while (offset < total);
  return items;
}

function VaultScreen({ state, onLocked, notify, offerHello, onHelloOffered }: { state: VaultState; onLocked: () => Promise<void>; notify: Notify; offerHello: boolean; onHelloOffered: () => void }) {
  const [entries, setEntries] = useState<EntryView[]>([]); const [trash, setTrash] = useState<EntryView[]>([]);
  const [section, setSection] = useState<Section>('passwords'); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trashId, setTrashId] = useState<string | null>(null); const [query, setQuery] = useState(''); const [dialog, setDialog] = useState<Dialog>(null);
  const [undoId, setUndoId] = useState<string | null>(null); const [revision, setRevision] = useState(0); const search = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { try { setEntries(await loadPages('list')); setRevision(x => x + 1); } catch { await onLocked(); } }, [onLocked]);
  const loadTrash = useCallback(async () => { try { setTrash(await loadPages('trashList')); } catch { await onLocked(); } }, [onLocked]);
  useEffect(() => { void load(); return onHostChange(() => { void load(); if (section === 'trash') void loadTrash(); }); }, [load, loadTrash, section]);
  useEffect(() => { if (section === 'trash') void loadTrash(); }, [section, loadTrash]);
  useEffect(() => { if (!undoId) return; const timer = setTimeout(() => setUndoId(null), 10000); return () => clearTimeout(timer); }, [undoId]);

  const source = entries.filter(e => section === 'notes' ? e.type === 'note' : e.type === 'login');
  const visible = useMemo(() => { const term = query.trim().toLowerCase(); return term ? source.filter(e => e.title.toLowerCase().includes(term) || e.username.toLowerCase().includes(term) || (e.origin ?? '').toLowerCase().includes(term)) : source; }, [source, query]);
  const selected = visible.find(e => e.id === selectedId) ?? visible[0] ?? null;
  const selectedTrash = trash.find(e => e.id === trashId) ?? trash[0] ?? null;
  const lock = useCallback(async () => { await call('lock'); await onLocked(); }, [onLocked]);
  const act = async (action: () => Promise<unknown>, success?: string) => { try { await action(); if (success) notify(success); } catch (e) { notify((e as Error).message, 'error'); } };
  const startImport = () => act(async () => { const rows = await call('importPick'); if (rows) setDialog({ kind: 'import', rows }); });
  useEffect(() => {
    const keys = (e: KeyboardEvent) => { if (!e.ctrlKey || e.altKey || dialog) return; const key = e.key.toLowerCase();
      if (key === 'k' || key === 'f') { e.preventDefault(); search.current?.focus(); search.current?.select(); }
      else if (key === 'n') { e.preventDefault(); setDialog({ kind: 'new', type: section === 'notes' ? 'note' : 'login' }); }
      else if (key === 'l') { e.preventDefault(); void lock(); } else if (key === 'g') { e.preventDefault(); setDialog({ kind: 'generator' }); } };
    window.addEventListener('keydown', keys); return () => window.removeEventListener('keydown', keys);
  }, [dialog, lock, section]);
  const move = (delta: number) => { if (!visible.length) return; const index = Math.max(0, Math.min(visible.length - 1, visible.findIndex(e => e.id === selected?.id) + delta)); setSelectedId(visible[index].id); document.getElementById('entry-' + visible[index].id)?.scrollIntoView({ block: 'nearest' }); };
  const chooseSection = (next: Section) => { setSection(next); setQuery(''); if (next === 'notes') setSelectedId(entries.find(e => e.type === 'note')?.id ?? null); else if (next === 'passwords') setSelectedId(entries.find(e => e.type === 'login')?.id ?? null); };

  return (
    <IconsEnabled.Provider value={state.siteIcons}>
    <div className="flex h-full">
      <aside className="flex w-[280px] shrink-0 flex-col border-r bg-sidebar">
        <div className="flex h-12 items-center gap-2.5 px-4"><Logo className="size-[18px]" /><span className="font-medium">LocalVault</span>{state.preview && <span className="rounded-sm bg-muted px-1.5 py-px text-[11px] text-muted-foreground">Preview</span>}<div className="flex-1" /><IconButton label={section === 'notes' ? 'New secure note' : 'New password'} shortcut="Ctrl N" onClick={() => setDialog({ kind: 'new', type: section === 'notes' ? 'note' : 'login' })}><Plus /></IconButton></div>
        <div className="px-3 pb-2"><div className="relative"><Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label="Search vault" onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); } else if (e.key === 'Escape') setQuery(''); }} className="h-8 border-transparent bg-accent/70 pr-12 pl-8 shadow-none focus-visible:border-input dark:bg-accent/60" /><kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 font-mono text-[10.5px] text-muted-foreground">Ctrl K</kbd></div></div>
        <nav aria-label="Vault sections" className="space-y-px px-2 pb-2">
          <NavButton icon={<KeyRound />} active={section === 'passwords'} onClick={() => chooseSection('passwords')}>Passwords <span className="ml-auto tabular-nums">{entries.filter(e => e.type === 'login').length}</span></NavButton>
          <NavButton icon={<NotebookPen />} active={section === 'notes'} onClick={() => chooseSection('notes')}>Secure notes <span className="ml-auto tabular-nums">{entries.filter(e => e.type === 'note').length}</span></NavButton>
          <NavButton icon={<ShieldCheck />} active={section === 'security'} onClick={() => chooseSection('security')}>Security</NavButton>
          <NavButton icon={<Trash2 />} active={section === 'trash'} onClick={() => chooseSection('trash')}>Trash <span className="ml-auto tabular-nums">{trash.length}</span></NavButton>
        </nav>
        {section === 'passwords' || section === 'notes' ? <>
          <div className="flex items-center justify-between px-5 pt-2 pb-1.5 text-[11px] text-muted-foreground"><span>{section === 'notes' ? 'Secure notes' : 'Passwords'}</span><span className="tabular-nums">{visible.length}</span></div>
          <nav aria-label={section === 'notes' ? 'Secure notes' : 'Saved passwords'} className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {visible.map(entry => <button key={entry.id} id={'entry-' + entry.id} data-static onClick={() => setSelectedId(entry.id)} aria-current={entry.id === selected?.id} className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50', entry.id === selected?.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}>
              {entry.type === 'note' ? <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><NotebookPen className="size-4" /></span> : <SiteIcon title={entry.title} origin={entry.origin ?? undefined} />}
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.title}</span><span className="block truncate text-[12px] text-muted-foreground">{entry.type === 'note' ? 'Secure note' : entry.username || 'No username'}</span></span>
            </button>)}
            {!visible.length && <p className="px-3 py-8 text-center text-muted-foreground">{query ? 'No matches.' : section === 'notes' ? 'No secure notes yet.' : 'No passwords yet.'}</p>}
          </nav>
        </> : section === 'trash' ? <>
          <div className="flex items-center justify-between px-5 pt-2 pb-1.5 text-[11px] text-muted-foreground"><span>Deleted items</span><div className="flex items-center gap-2"><span className="tabular-nums">{trash.length}</span>{trash.length > 0 && <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setDialog({ kind: 'trashPurge' })}>Empty</button>}</div></div>
          <nav aria-label="Trash items" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{trash.map(entry => <button key={entry.id} onClick={() => setTrashId(entry.id)} aria-current={entry.id === selectedTrash?.id} className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left', entry.id === selectedTrash?.id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50')}><Trash2 className="ml-1 size-4 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate font-medium">{entry.title}</span><span className="block truncate text-[12px] text-muted-foreground">{entry.type === 'note' ? 'Secure note' : entry.username || 'Password'}</span></span></button>)}{!trash.length && <p className="px-3 py-8 text-center text-muted-foreground">Trash is empty.</p>}</nav>
        </> : <div className="min-h-0 flex-1" />}
        <div className="space-y-px border-t p-2">
          <NavButton icon={<Upload />} onClick={() => void startImport()}>Import from browser</NavButton><NavButton icon={<ArchiveRestore />} onClick={() => setDialog({ kind: 'backups' })}>Backups</NavButton>
          <NavButton icon={<Dices />} shortcut="Ctrl G" onClick={() => setDialog({ kind: 'generator' })}>Password generator</NavButton><NavButton icon={<Globe />} onClick={() => setDialog({ kind: 'browsers' })}>Browser connections</NavButton>
          <NavButton icon={<Settings />} onClick={() => setDialog({ kind: 'settings' })}>Settings</NavButton><NavButton icon={<Lock />} shortcut="Ctrl L" onClick={() => void lock()}>Lock</NavButton>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {section === 'security' ? <SecurityDashboard refreshKey={revision} entries={entries} onSelect={id => { setSection('passwords'); setSelectedId(id); }} /> : section === 'trash' ? (
          selectedTrash ? <><header className="flex h-12 shrink-0 items-center gap-2 border-b px-4"><span className="truncate text-muted-foreground">Trash / <span className="text-foreground">{selectedTrash.title}</span></span><div className="flex-1" /><Button variant="outline" size="sm" onClick={() => void act(async () => { await call('trashRestore', { id: selectedTrash.id }); await loadTrash(); await load(); }, 'Item restored.')}><RotateCcw /> Restore</Button><Button variant="destructive" size="sm" onClick={() => setDialog({ kind: 'trashPurge', entry: selectedTrash })}><Trash2 /> Delete permanently</Button></header>
            <div className="mx-auto w-full max-w-[680px] px-10 py-10"><h1 className="text-[22px] font-semibold">{selectedTrash.title}</h1><p className="mt-1 text-muted-foreground">{selectedTrash.type === 'note' ? 'Secure note' : selectedTrash.username || 'Password'} · Deleted {selectedTrash.deletedAt ? new Date(selectedTrash.deletedAt).toLocaleString() : ''}</p><p className="mt-6 rounded-lg border bg-muted/30 p-4 text-[13px] text-muted-foreground">This item and its history remain encrypted in Trash. Older encrypted backups and preserved vault revisions may still contain deleted data.</p></div></>
          : <div className="flex flex-1 items-center justify-center text-muted-foreground">Trash is empty.</div>
        ) : selected ? <>
          <header className="flex h-12 shrink-0 items-center gap-1 border-b px-4"><span className="truncate text-muted-foreground">{section === 'notes' ? 'Secure notes' : 'Passwords'} <span className="px-1 opacity-50">/</span> <span className="text-foreground">{selected.title}</span></span><div className="flex-1" />
            {selected.historyCount > 0 && <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'history', entry: selected })}><History /> History</Button>}
            <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'edit', entry: selected })}><Pencil /> Edit</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="More actions"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'delete', entry: selected })}><Trash2 /> Move to Trash</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </header>
          <Detail key={selected.id} entry={selected} notify={notify} />
        </> : <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground"><p>{section === 'notes' ? 'No secure notes yet.' : 'Your vault is empty.'}</p><div className="flex gap-2"><Button size="sm" onClick={() => setDialog({ kind: 'new', type: section === 'notes' ? 'note' : 'login' })}><Plus /> {section === 'notes' ? 'New secure note' : 'New password'}</Button>{section === 'passwords' && <Button size="sm" variant="outline" onClick={() => void startImport()}><Upload /> Import CSV</Button>}</div></div>}
      </main>

      {undoId && <div role="status" className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-popover px-3.5 py-2 text-[13px] shadow-lg"><span>Moved to Trash</span><Button size="sm" variant="outline" onClick={() => void act(async () => { await call('undoDelete', { id: undoId }); setUndoId(null); await load(); }, 'Item restored.') }><Undo2 /> Undo</Button></div>}
      <EntryDialog open={dialog?.kind === 'new' || dialog?.kind === 'edit'} entry={dialog?.kind === 'edit' ? dialog.entry : null} initialType={dialog?.kind === 'new' ? dialog.type : undefined}
        onClose={() => setDialog(null)} onSaved={async (id, type) => { setDialog(null); notify('Saved.'); await load(); if (id) setSelectedId(id); setSection(type === 'note' ? 'notes' : 'passwords'); }} />
      <ConfirmDelete entry={dialog?.kind === 'delete' ? dialog.entry : null} onClose={() => setDialog(null)} onDeleted={async id => { setDialog(null); setUndoId(id); await load(); await loadTrash(); }} />
      <HistoryDialog entry={dialog?.kind === 'history' ? dialog.entry : null} onClose={() => setDialog(null)} onRestored={async () => { setDialog(null); await load(); }} notify={notify} />
      <TrashPurgeDialog open={dialog?.kind === 'trashPurge'} entry={dialog?.kind === 'trashPurge' ? dialog.entry : undefined} onClose={() => setDialog(null)} onPurged={async () => { setDialog(null); await loadTrash(); }} />
      <ImportDialog rows={dialog?.kind === 'import' ? dialog.rows : null} onClose={() => { void call('importCancel'); setDialog(null); }} onImported={async () => { setDialog(null); notify('Import committed. Delete the plaintext CSV yourself.'); await load(); }} />
      <BackupsDialog open={dialog?.kind === 'backups'} onClose={() => setDialog(null)} notify={notify} onRestorePicked={file => setDialog({ kind: 'restore', file })} />
      <RestoreDialog file={dialog?.kind === 'restore' ? dialog.file : null} onClose={() => setDialog(null)} onRestored={async () => { setDialog(null); notify('Backup restored. Turn Windows Hello on again in Settings if you use it.'); await onLocked(); await load(); }} />
      <BrowsersDialog open={dialog?.kind === 'browsers'} onClose={() => setDialog(null)} notify={notify} /><HelloOffer open={offerHello} onClose={onHelloOffered} notify={notify} onChange={onLocked} />
      <GeneratorDialog open={dialog?.kind === 'generator'} onClose={() => setDialog(null)} notify={notify} />
      <SettingsDialog open={dialog?.kind === 'settings'} hello={state.helloEnrolled} helloAvailable={state.helloAvailable} siteIcons={state.siteIcons} onClose={() => setDialog(null)} notify={notify} onChange={onLocked} />
    </div>
    </IconsEnabled.Provider>
  );
}

function Detail({ entry, notify }: { entry: EntryView; notify: Notify }) {
  const [content, setContent] = useState<EntryContent | null>(null);
  const [password, setPassword] = useState<string | null>(null); const [revealed, setRevealed] = useState<Record<string, string>>({});
  useEffect(() => { let live = true; setContent(null); setPassword(null); setRevealed({}); void call('getItem', { id: entry.id }).then(value => { if (live) setContent(value); }, e => notify((e as Error).message, 'error')); return () => { live = false; }; }, [entry.id, entry.version, notify]);
  const copy = (field: 'username' | 'password') =>
    call('copy', { id: entry.id, field }).then(() => notify('Copied. Clipboard clears in 30 seconds.'), e => notify((e as Error).message, 'error'));
  const copyField = (fieldId: string) => call('copyField', { id: entry.id, fieldId }).then(() => notify('Copied. Clipboard clears in 30 seconds.'), e => notify((e as Error).message, 'error'));
  const toggle = async () => {
    if (password != null) { setPassword(null); return; }
    try { setPassword(await call('reveal', { id: entry.id })); } catch (e) { notify((e as Error).message, 'error'); }
  };

  if (!content) return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Loading selected item…</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="animate-in fade-in mx-auto max-w-[680px] px-10 py-10 duration-200 ease-out">
        <div className="flex items-center gap-4">
          {entry.type === 'note' ? <span className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-muted text-muted-foreground"><NotebookPen className="size-5" /></span> : <SiteIcon title={entry.title} origin={content.origins[0]} large />}
          <div className="min-w-0">
            <h1 className="selectable truncate text-[22px] font-semibold tracking-tight">{entry.title}</h1>
            <p className="mt-0.5 text-muted-foreground">Updated {new Date(entry.updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
        </div>

        <dl className="mt-8 divide-y rounded-xl border">
          {content.type === 'login' ? <>
            <Field label="Username" actions={<CopyButton label="Copy username" onCopy={() => copy('username')} />}><span className="selectable">{content.username || <span className="text-muted-foreground">—</span>}</span></Field>
            <Field label="Password" actions={<><IconButton label={password != null ? 'Hide password' : 'Show password'} onClick={() => void toggle()}><SwapIcon on={password != null} a={<Eye />} b={<EyeOff />} /></IconButton><CopyButton label="Copy password" onCopy={() => copy('password')} /></>}>
              <span className={cn('selectable font-mono break-all', password == null && 'tracking-[0.2em] text-muted-foreground')}>{password ?? '••••••••••••'}</span>
            </Field>
            <Field label="Websites">{content.origins.length ? <ul className="space-y-1">{content.origins.map(o => <li key={o} className="selectable truncate">{o.replace('https://', '')}</li>)}</ul> : <span className="text-muted-foreground">Manual use only</span>}</Field>
            {content.notes && <Field label="Notes"><p className="selectable whitespace-pre-wrap">{content.notes}</p></Field>}
          </> : <Field label="Note"><p className="selectable whitespace-pre-wrap">{content.notes}</p></Field>}
          {content.fields.map(field => <Field key={field.id} label={field.label} actions={<>{field.type === 'secret' && <IconButton label={revealed[field.id] == null ? 'Reveal field' : 'Hide field'} onClick={() => void (revealed[field.id] == null ? call('revealField', { id: entry.id, fieldId: field.id }).then(v => setRevealed(x => ({ ...x, [field.id]: v })), e => notify((e as Error).message, 'error')) : setRevealed(x => { const next = { ...x }; delete next[field.id]; return next; }))}><SwapIcon on={revealed[field.id] != null} a={<Eye />} b={<EyeOff />} /></IconButton>}<CopyButton label={`Copy ${field.label}`} onCopy={() => copyField(field.id)} /></>}>
            <span className={cn('selectable whitespace-pre-wrap break-all', field.type === 'secret' && revealed[field.id] == null && 'font-mono tracking-[0.2em] text-muted-foreground')}>{field.type === 'secret' ? revealed[field.id] ?? '••••••••••' : field.value}</span>
          </Field>)}
        </dl>
        <p className="mt-4 text-[12px] text-muted-foreground">Secrets stay masked until you choose to reveal or copy them.</p>
      </div>
    </div>
  );
}

// ---- Small pieces ----------------------------------------------------------------------------------------

function Field({ label, actions, children }: { label: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="group flex min-h-12 items-center gap-4 px-4 py-2.5">
      <dt className="w-24 shrink-0 self-start pt-1 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 py-1">{children}</dd>
      {actions && <div className="flex shrink-0 gap-0.5 self-start opacity-60 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">{actions}</div>}
    </div>
  );
}

function IconButton({ label, shortcut, onClick, children }: { label: string; shortcut?: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className="text-muted-foreground hover:text-foreground">{children}</Button></TooltipTrigger>
      <TooltipContent>{label}{shortcut && <span className="ml-2 font-mono opacity-60">{shortcut}</span>}</TooltipContent>
    </Tooltip>
  );
}

function CopyButton({ label, onCopy }: { label: string; onCopy: () => Promise<unknown> }) {
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1400); return () => clearTimeout(t); }, [done]);
  return <IconButton label={label} onClick={() => void onCopy().then(() => setDone(true))}><SwapIcon on={done} a={<Copy />} b={<Check />} /></IconButton>;
}

// Cross-fades two icons with opacity/scale/blur (better-ui contextual icon animation, no motion dependency).
function SwapIcon({ on, a, b }: { on: boolean; a: ReactNode; b: ReactNode }) {
  const layer = 'col-start-1 row-start-1 transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none';
  return (
    <span className="grid place-items-center">
      <span className={cn(layer, on ? 'scale-25 opacity-0 blur-[4px]' : 'scale-100 opacity-100 blur-0')}>{a}</span>
      <span className={cn(layer, on ? 'scale-100 opacity-100 blur-0' : 'scale-25 opacity-0 blur-[4px]')}>{b}</span>
    </span>
  );
}

function NavButton({ icon, shortcut, onClick, children, active = false }: { icon: ReactNode; shortcut?: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-current={active ? 'page' : undefined} className={cn('w-full justify-start gap-2.5 px-2.5 font-normal text-muted-foreground hover:text-foreground', active && 'bg-accent text-accent-foreground')}>
      {icon}<span className="flex-1 text-left">{children}</span>{shortcut && <kbd className="font-mono text-[10.5px] opacity-60">{shortcut}</kbd>}
    </Button>
  );
}

const IconsEnabled = createContext(false);
const iconCache = new Map<string, Promise<string | null>>();

// The site's own favicon on a light tile (dark logos stay visible in dark mode); falls back to the monogram.
function SiteIcon({ title, origin, large }: { title: string; origin?: string; large?: boolean }) {
  const enabled = useContext(IconsEnabled);
  const [src, setSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setSrc(null); setLoaded(false);
    if (!enabled || !origin) return;
    let live = true;
    if (!iconCache.has(origin)) iconCache.set(origin, call('icon', { origin }).catch(() => null));
    void iconCache.get(origin)!.then(url => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [enabled, origin]);

  if (!src) return <Monogram title={title} large={large} />;
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center bg-white shadow-[inset_0_0_0_1px_oklch(0_0_0/0.08)] dark:shadow-none',
      large ? 'size-11 rounded-[10px]' : 'size-7 rounded-md')}>
      <img src={src} alt="" draggable={false} onLoad={() => setLoaded(true)} onError={() => setSrc(null)}
        className={cn('object-contain transition-opacity duration-150 ease-out', large ? 'size-7' : 'size-[18px]', loaded ? 'opacity-100' : 'opacity-0')} />
    </span>
  );
}

function Monogram({ title, large }: { title: string; large?: boolean }) {
  return (
    <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-md bg-muted font-medium text-muted-foreground uppercase shadow-[inset_0_0_0_1px_var(--border)]',
      large ? 'size-11 rounded-[10px] text-base' : 'size-7 text-[12px]')}>
      {title.trim().charAt(0) || '·'}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  return <img src="/logo.png" alt="" draggable={false} className={cn('rounded-[22%] outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10', className)} />;
}

export function Spinner() {
  return <span aria-label="Working" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />;
}
