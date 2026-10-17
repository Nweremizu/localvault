import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeOff, Fingerprint, RefreshCw, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { call, type CustomField, type EntryContent, type EntryView, type GeneratorOptions, type HistoryContent, type ImportAction, type ImportRowView, type PairingsView } from './bridge';
import { Spinner, type Notify } from './App';

/** Runs a bridge action with a busy flag and an inline error message. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await action(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, setError, run };
}

function ErrorText({ children }: { children: string }) {
  return children ? <p role="alert" className="text-[12.5px] text-destructive">{children}</p> : null;
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-[12.5px] font-normal text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ---- Entry editor ----------------------------------------------------------------------------------------

type Editor = { type: 'login' | 'note'; title: string; username: string; password: string; origins: string; notes: string; fields: CustomField[] };
const emptyEditor = (type: 'login' | 'note' = 'login'): Editor => ({ type, title: '', username: '', password: '', origins: '', notes: '', fields: [] });

export function EntryDialog({ open, entry, initialType = 'login', onClose, onSaved }: { open: boolean; entry: EntryView | null; initialType?: 'login' | 'note'; onClose: () => void; onSaved: (id?: string, type?: 'login' | 'note') => void }) {
  const [form, setForm] = useState<Editor>(() => emptyEditor()); const [original, setOriginal] = useState<EntryContent | null>(null);
  const [show, setShow] = useState(false); const [showFields, setShowFields] = useState<Record<string, boolean>>({}); const [loading, setLoading] = useState(false);
  const { busy, error, setError, run } = useAction();
  useEffect(() => {
    if (!open) return;
    let live = true; setError(''); setShow(false); setShowFields({}); setOriginal(null); setForm(emptyEditor(initialType));
    if (entry) { setLoading(true); void call('getItem', { id: entry.id }).then(value => { if (!live) return; setOriginal(value); setForm({ type: value.type, title: value.title, username: value.username, password: value.password, origins: value.origins.join('\n'), notes: value.notes, fields: value.fields.map(f => ({ ...f })) }); }, e => setError((e as Error).message)).finally(() => { if (live) setLoading(false); }); }
    return () => { live = false; setForm(emptyEditor()); setOriginal(null); };
  }, [open, entry, initialType, setError]);
  const set = (key: keyof Editor) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value }));
  const updateField = (index: number, patch: Partial<CustomField>) => setForm(f => ({ ...f, fields: f.fields.map((field, i) => i === index ? { ...field, ...patch } : field) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await call('save', { ...(entry ? { id: entry.id, version: entry.version } : {}), type: form.type, title: form.title,
        username: form.type === 'login' ? form.username : '', notes: form.notes,
        origins: form.type === 'login' ? form.origins.split(/\r?\n/).map(o => o.trim()).filter(Boolean) : [], fields: form.fields,
        ...((!entry || form.password !== original?.password) && form.type === 'login' ? { password: form.password } : {}) });
      onSaved(entry?.id, form.type);
    });
  };

  return <Dialog open={open} onOpenChange={o => !o && onClose()}><DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
    <form onSubmit={submit} className="grid gap-5"><DialogHeader><DialogTitle>{entry ? form.type === 'note' ? 'Edit secure note' : 'Edit password' : form.type === 'note' ? 'New secure note' : 'New password'}</DialogTitle><DialogDescription>Encrypted and stored only on this device.</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        {!entry && <div className="flex gap-2"><Button type="button" size="sm" variant={form.type === 'login' ? 'default' : 'outline'} onClick={() => setForm(f => ({ ...f, type: 'login' }))}>Password</Button><Button type="button" size="sm" variant={form.type === 'note' ? 'default' : 'outline'} onClick={() => setForm(f => ({ ...f, type: 'note' }))}>Secure note</Button></div>}
        <Field label="Title" htmlFor="title"><Input id="title" autoFocus maxLength={256} value={form.title} onChange={set('title')} /></Field>
        {form.type === 'login' ? <>
          <Field label="Username or email" htmlFor="username"><Input id="username" maxLength={4096} autoComplete="off" value={form.username} onChange={set('username')} /></Field>
          <Field label="Password" htmlFor="password"><div className="flex gap-1.5"><div className="relative flex-1"><Input id="password" type={show ? 'text' : 'password'} maxLength={16384} autoComplete="off" value={form.password} onChange={set('password')} className="pr-9 font-mono" />
            <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:text-foreground [&_svg]:size-3.5">{show ? <EyeOff /> : <Eye />}</button></div>
            <Button type="button" variant="outline" onClick={() => void call('generate', {}).then(p => { setForm(f => ({ ...f, password: p })); setShow(true); })}><RefreshCw /> Generate</Button></div></Field>
          <Field label="Websites" htmlFor="origins" hint="HTTPS addresses, one per line. Autofill only offers this entry on these sites."><Textarea id="origins" rows={2} maxLength={65536} value={form.origins} onChange={set('origins')} placeholder="https://example.com" className="min-h-0 resize-none font-mono text-[12.5px]" /></Field>
          <Field label="Notes" htmlFor="notes"><Textarea id="notes" rows={3} maxLength={16384} value={form.notes} onChange={set('notes')} className="min-h-0 resize-none" /></Field>
        </> : <Field label="Note" htmlFor="notes" hint="Stored as plain text inside the encrypted vault."><Textarea id="notes" autoFocus={!entry} rows={7} maxLength={16384} value={form.notes} onChange={set('notes')} className="resize-y" /></Field>}
        <div className="grid gap-2"><div className="flex items-center justify-between"><h3 className="text-[13px] font-medium">Custom fields</h3><Button type="button" variant="outline" size="sm" disabled={form.fields.length >= 32} onClick={() => setForm(f => ({ ...f, fields: [...f.fields, { id: crypto.randomUUID(), label: '', type: 'text', value: '' }] }))}>Add field</Button></div>
          {form.fields.map((field, index) => <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_100px_auto] gap-2 rounded-lg border p-2.5">
            <Input aria-label="Custom field label" placeholder="Label" maxLength={128} value={field.label} onChange={e => updateField(index, { label: e.target.value })} />
            <Select value={field.type} onValueChange={value => updateField(index, { type: value as 'text' | 'secret' })}><SelectTrigger aria-label="Custom field type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="text">Text</SelectItem><SelectItem value="secret">Secret</SelectItem></SelectContent></Select>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${field.label || 'custom'} field`} onClick={() => setForm(f => ({ ...f, fields: f.fields.filter((_, i) => i !== index) }))}>×</Button>
            <Input className="col-span-3" aria-label={`${field.label || 'Custom'} value`} type={field.type === 'secret' && !showFields[field.id] ? 'password' : 'text'} maxLength={16384} value={field.value} onChange={e => updateField(index, { value: e.target.value })} />
            {field.type === 'secret' && <button type="button" className="col-span-3 justify-self-start text-[12px] text-muted-foreground hover:text-foreground" onClick={() => setShowFields(s => ({ ...s, [field.id]: !s[field.id] }))}>{showFields[field.id] ? 'Hide secret' : 'Reveal secret'}</button>}
          </div>)}
          {form.fields.length === 0 && <p className="text-[12px] text-muted-foreground">No custom fields.</p>}
        </div>
      </div>
      <ErrorText>{error}</ErrorText><DialogFooter><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || loading || !form.title.trim() || (form.type === 'login' ? !form.password : !form.notes.trim())}>{busy || loading ? <Spinner /> : 'Save'}</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}

export function ConfirmDelete({ entry, onClose, onDeleted }: { entry: EntryView | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const { busy, error, run } = useAction();
  return (
    <AlertDialog open={entry != null} onOpenChange={o => !o && onClose()}>
      <AlertDialogContent className="sm:max-w-[400px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Move “{entry?.title}” to Trash?</AlertDialogTitle>
          <AlertDialogDescription>You can undo this for 10 seconds or restore it later from Trash. Older encrypted backups and preserved vault revisions may still contain deleted data.</AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{error}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button variant="destructive" disabled={busy} onClick={() => void run(async () => { await call('delete', { id: entry!.id }); onDeleted(entry!.id); })}>Move to Trash</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function HistoryDialog({ entry, onClose, onRestored, notify }: { entry: EntryView | null; onClose: () => void; onRestored: () => void; notify: Notify }) {
  const [history, setHistory] = useState<{ version: string; items: { index: number; revisedAt: string; type: 'login' | 'note'; title: string; username: string }[] } | null>(null);
  const [viewed, setViewed] = useState<HistoryContent | null>(null); const [viewedIndex, setViewedIndex] = useState<number | null>(null); const [showPassword, setShowPassword] = useState(false);
  const [confirm, setConfirm] = useState(false); const { busy, error, run } = useAction();
  useEffect(() => { let live = true; setHistory(null); setViewed(null); setConfirm(false); if (entry) void call('history', { id: entry.id }).then(value => { if (live) setHistory(value); }, e => notify((e as Error).message, 'error')); return () => { live = false; setViewed(null); }; }, [entry, notify]);
  const view = async (index: number) => { if (!entry || !history) return; try { setShowPassword(false); setViewed(await call('historyContent', { id: entry.id, index, version: history.version })); setViewedIndex(index); } catch (e) { notify((e as Error).message, 'error'); } };
  const restore = () => { if (!entry || !history || viewedIndex == null) return; void run(async () => { await call('historyRestore', { id: entry.id, index: viewedIndex, version: history.version }); setConfirm(false); onRestored(); }); };
  return <>
    <Dialog open={entry != null} onOpenChange={o => !o && onClose()}><DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Password history · {entry?.title}</DialogTitle><DialogDescription>Revision summaries omit secrets. Select View revision to inspect one stored version.</DialogDescription></DialogHeader>
      <div className="divide-y rounded-lg border">{history?.items.map(item => <div key={item.index} className="flex items-center gap-3 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-[12px] text-muted-foreground">{item.type === 'note' ? 'Secure note' : item.username || 'No username'} · {new Date(item.revisedAt).toLocaleString()}</p></div><Button size="sm" variant="outline" onClick={() => void view(item.index)}>View revision</Button></div>)}{history && history.items.length === 0 && <p className="px-3 py-5 text-center text-sm text-muted-foreground">No earlier revisions.</p>}{!history && <p className="px-3 py-5 text-center text-sm text-muted-foreground">Loading history…</p>}</div>
      {viewed && <section className="grid gap-2 rounded-lg border bg-muted/20 p-3"><div className="flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{viewed.title}</h3><Button size="sm" variant="outline" onClick={() => setConfirm(true)}>Restore this version</Button></div>
        {viewed.type === 'login' ? <><p className="text-[12px] text-muted-foreground">{viewed.username || 'No username'}</p><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-[12px]">{showPassword ? viewed.password : '••••••••••••'}</code><Button size="sm" variant="ghost" onClick={() => setShowPassword(v => !v)}>{showPassword ? 'Hide' : 'Reveal'}</Button><Button size="sm" variant="ghost" onClick={() => void call('copyText', { value: viewed.password }).then(() => notify('Revision password copied. Clipboard clears in 30 seconds.'))}>Copy</Button></div></> : <><p className="selectable whitespace-pre-wrap text-[13px]">{viewed.notes}</p><Button size="sm" variant="ghost" className="justify-self-start" onClick={() => void call('copyText', { value: viewed.notes }).then(() => notify('Revision note copied. Clipboard clears in 30 seconds.'))}>Copy note</Button></>}
        {viewed.fields.map(field => <div key={field.id} className="flex min-w-0 items-center gap-2 text-[12px]"><span className="w-28 shrink-0 truncate text-muted-foreground">{field.label}</span><span className="min-w-0 flex-1 truncate">{field.type === 'secret' ? '••••••••' : field.value}</span>{field.type === 'secret' && <Button size="sm" variant="ghost" onClick={() => void call('copyText', { value: field.value }).then(() => notify('Revision field copied. Clipboard clears in 30 seconds.'))}>Copy</Button>}</div>)}
      </section>}
      <ErrorText>{error}</ErrorText><DialogFooter><Button variant="ghost" onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent></Dialog>
    <AlertDialog open={confirm} onOpenChange={setConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Restore this revision?</AlertDialogTitle><AlertDialogDescription>The current item will first be saved as a new history revision. The item keeps its ID and browser links.</AlertDialogDescription></AlertDialogHeader><ErrorText>{error}</ErrorText><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button disabled={busy} onClick={restore}>{busy ? <Spinner /> : 'Restore revision'}</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

export function TrashPurgeDialog({ open, entry, onClose, onPurged }: { open: boolean; entry?: EntryView; onClose: () => void; onPurged: () => void }) {
  const [typed, setTyped] = useState(''); const { busy, error, run } = useAction();
  useEffect(() => { if (!open) { setTyped(''); } }, [open]);
  const purge = () => void run(async () => { await call('trashPurge', { confirm: typed, ...(entry ? { id: entry.id } : {}) }); onPurged(); });
  return <AlertDialog open={open} onOpenChange={o => !o && onClose()}><AlertDialogContent className="sm:max-w-[440px]"><AlertDialogHeader><AlertDialogTitle>{entry ? `Delete “${entry.title}” permanently?` : 'Empty Trash permanently?'}</AlertDialogTitle><AlertDialogDescription>This cannot be undone. Older encrypted backups and preserved vault revisions may still contain the deleted data. Type <span className="font-mono text-foreground">DELETE</span> to confirm.</AlertDialogDescription></AlertDialogHeader>
    <Input autoFocus aria-label="Type DELETE to confirm" placeholder="DELETE" maxLength={16} value={typed} onChange={e => setTyped(e.target.value)} className="font-mono"/><ErrorText>{error}</ErrorText><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button variant="destructive" disabled={busy || typed !== 'DELETE'} onClick={purge}>{busy ? <Spinner /> : entry ? 'Delete permanently' : 'Empty Trash'}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}

export function BreachConsentDialog({ open, onClose, onContinue }: { open: boolean; onClose: () => void; onContinue: () => void }) {
  return <AlertDialog open={open} onOpenChange={o => !o && onClose()}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Check breached passwords online?</AlertDialogTitle><AlertDialogDescription>LocalVault sends your IP address and the first five characters of each password’s SHA-1 hash to Have I Been Pwned over HTTPS. Passwords, full hashes, usernames, and websites are not sent. The check runs only now; results remain in memory and “not found” does not mean safe.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><Button onClick={onContinue}>Continue with check</Button></AlertDialogFooter></AlertDialogContent></AlertDialog>;
}

// ---- Import ----------------------------------------------------------------------------------------------

export function ImportDialog({ rows, onClose, onImported }: { rows: ImportRowView[] | null; onClose: () => void; onImported: () => void }) {
  const [actions, setActions] = useState<ImportAction[]>([]);
  const { busy, error, run } = useAction();
  useEffect(() => { setActions(rows?.map(r => r.action) ?? []); }, [rows]);
  const count = actions.filter(a => a !== 'skip').length;

  return (
    <Dialog open={rows != null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-[860px]">
        <DialogHeader>
          <DialogTitle>Review import</DialogTitle>
          <DialogDescription>Passwords are hidden here. Conflicts default to Skip; choose Replace to overwrite an existing account.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[420px] overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow><TableHead className="w-12">Row</TableHead><TableHead>Title</TableHead><TableHead>Username</TableHead><TableHead>Status</TableHead><TableHead className="w-32">Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {rows?.map((row, i) => (
                <TableRow key={row.index} className={cn(!row.valid && 'text-muted-foreground')}>
                  <TableCell className="tabular-nums">{row.row}</TableCell>
                  <TableCell className="max-w-[160px] truncate">{row.title}</TableCell>
                  <TableCell className="max-w-[180px] truncate">{row.username}</TableCell>
                  <TableCell className="max-w-[240px] truncate text-muted-foreground" title={row.status}>{row.status}</TableCell>
                  <TableCell>
                    <Select value={actions[i]} disabled={!row.valid} onValueChange={v => setActions(a => a.map((x, j) => j === i ? v as ImportAction : x))}>
                      <SelectTrigger size="sm" className="w-28" aria-label={`Action for row ${row.row}`}><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="skip">Skip</SelectItem><SelectItem value="add">Add</SelectItem><SelectItem value="replace">Replace</SelectItem></SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <ErrorText>{error}</ErrorText>
        <DialogFooter className="items-center">
          <p className="mr-auto text-muted-foreground">{rows?.length ?? 0} rows · {count} to import. The CSV contains plaintext passwords; delete it when done.</p>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || count === 0} onClick={() => void run(async () => { await call('importCommit', { actions }); onImported(); })}>
            {busy ? <Spinner /> : `Import ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Backups ---------------------------------------------------------------------------------------------

export function BackupsDialog({ open, onClose, notify, onRestorePicked }: { open: boolean; onClose: () => void; notify: Notify; onRestorePicked: (file: string) => void }) {
  const { busy, error, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Encrypted backups</DialogTitle>
          <DialogDescription>Keep a copy on another device. A backup opens with the master password in use when it was made, and may contain passwords you later changed or deleted.</DialogDescription>
        </DialogHeader>
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => { const file = await call('restorePick'); if (file) onRestorePicked(file); })}>Restore backup…</Button>
          <Button disabled={busy} onClick={() => void run(async () => { if (await call('backup')) { notify('Encrypted backup saved.'); onClose(); } })}>Create backup…</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RestoreDialog({ file, onClose, onRestored }: { file: string | null; onClose: () => void; onRestored: () => void }) {
  const [password, setPassword] = useState('');
  const { busy, error, setError, run } = useAction();
  useEffect(() => { setPassword(''); setError(''); }, [file, setError]);
  return (
    <Dialog open={file != null} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <form className="grid gap-5" onSubmit={e => { e.preventDefault(); const value = password; setPassword(''); void run(async () => { await call('restore', { password: value }); onRestored(); }); }}>
          <DialogHeader>
            <DialogTitle>Restore backup</DialogTitle>
            <DialogDescription>Restoring <span className="font-mono text-foreground">{file}</span> replaces the current vault. The current vault file is kept alongside it first.</DialogDescription>
          </DialogHeader>
          <Field label="Backup master password" htmlFor="restore-password">
            <Input id="restore-password" type="password" autoFocus autoComplete="off" maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !password}>{busy ? <Spinner /> : 'Verify and restore'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Browsers --------------------------------------------------------------------------------------------

export function BrowsersDialog({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: Notify }) {
  const [data, setData] = useState<PairingsView | null>(null);
  const load = () => call('pairings').then(setData, e => notify((e as Error).message, 'error'));
  useEffect(() => { if (open) void load(); }, [open]);
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Browser connections</DialogTitle>
          <DialogDescription>Install the LocalVault extension, enable website access in its popup, then choose Pair and approve the matching code here.</DialogDescription>
        </DialogHeader>
        <div className="divide-y rounded-lg border">
          {data?.items.length ? data.items.map(p => (
            <div key={p.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate">{p.profile}</p>
                <p className="text-[12px] text-muted-foreground">Paired {new Date(p.created).toLocaleDateString(undefined, { dateStyle: 'medium' })}</p>
              </div>
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                onClick={() => void call('revokePairing', { id: p.id }).then(() => { notify('Browser connection revoked.'); return load(); })}>Revoke</Button>
            </div>
          )) : <p className="px-3.5 py-6 text-center text-muted-foreground">No browsers paired yet.</p>}
        </div>
        {data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <dt>Chrome / Edge ID</dt><dd className="selectable truncate font-mono">{data.chromiumId}</dd>
            <dt>Firefox ID</dt><dd className="selectable truncate font-mono">{data.firefoxId}</dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- Settings --------------------------------------------------------------------------------------------

export function SettingsDialog({ open, hello, helloAvailable, siteIcons, onClose, notify, onChange }: { open: boolean; hello: boolean; helloAvailable: boolean; siteIcons: boolean; onClose: () => void; notify: Notify; onChange: () => Promise<void> }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const { busy, error, setError, run } = useAction();
  useEffect(() => { if (!open) { setForm({ current: '', next: '', confirm: '' }); setError(''); } }, [open, setError]);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [key]: e.target.value }));

  const change = (e: FormEvent) => {
    e.preventDefault();
    if (form.next !== form.confirm) { setError('The new passwords do not match.'); return; }
    const { current, next } = form; setForm({ current: '', next: '', confirm: '' });
    void run(async () => { await call('changePassword', { current, next }); notify('Master password changed. Older backups keep their original password.'); });
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-[460px]">
        <DialogHeader><DialogTitle>Settings</DialogTitle></DialogHeader>
        <section className="flex items-start gap-4 rounded-lg border p-3.5">
          <div className="flex-1">
            <Label htmlFor="hello" className="font-normal">Unlock with Windows Hello</Label>
            <p className="mt-0.5 text-[12px] text-muted-foreground">{helloAvailable ? 'Use your face, fingerprint or Windows PIN instead of the master password, including after restarts. The master password always works too.' : 'Set up Windows Hello (face, fingerprint or PIN) in Windows Settings to use this.'}</p>
          </div>
          <Switch id="hello" checked={hello} disabled={busy || (!hello && !helloAvailable)}
            onCheckedChange={enabled => void run(async () => { await call('setHello', { enabled }); await onChange(); notify(enabled ? 'Windows Hello is on. Next time, unlock with Hello.' : 'Windows Hello is off. Unlock with your master password.'); })} />
        </section>
        <section className="flex items-start gap-4 rounded-lg border p-3.5">
          <div className="flex-1">
            <Label htmlFor="site-icons" className="font-normal">Show website icons</Label>
            <p className="mt-0.5 text-[12px] text-muted-foreground">Fetched directly from each saved website, never through a third-party icon service. Those sites can see the request.</p>
          </div>
          <Switch id="site-icons" checked={siteIcons} disabled={busy}
            onCheckedChange={enabled => void run(async () => { await call('setSiteIcons', { enabled }); await onChange(); })} />
        </section>
        <section className="grid gap-2 rounded-lg border p-3.5">
          <h3 className="font-medium">Application updates</h3>
          <p className="text-[12px] text-muted-foreground">Choose a newer LocalVault MSI from the trusted release source. The app locks and closes for installation. Your vault and paired browsers are preserved; no separate uninstall is needed.</p>
          <Button variant="outline" disabled={busy} onClick={() => void run(async () => { if (await call('installUpdate')) notify('Windows Installer is starting. Reopen LocalVault after the update.'); })}>Install update…</Button>
        </section>
        <form onSubmit={change} className="grid gap-3.5">
          <h3 className="font-medium">Change master password</h3>
          <Field label="Current master password" htmlFor="current"><Input id="current" type="password" autoComplete="off" maxLength={1024} value={form.current} onChange={set('current')} /></Field>
          <Field label="New master password" htmlFor="next" hint="At least 12 characters. Older backups still need their original password.">
            <Input id="next" type="password" autoComplete="off" maxLength={1024} value={form.next} onChange={set('next')} />
          </Field>
          <Field label="Confirm new master password" htmlFor="confirm"><Input id="confirm" type="password" autoComplete="off" maxLength={1024} value={form.confirm} onChange={set('confirm')} /></Field>
          <ErrorText>{error}</ErrorText>
          <DialogFooter>
            <Button type="submit" disabled={busy || !form.current || form.next.length < 12}>{busy ? <Spinner /> : 'Change password'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---- Reset (forgotten master password) --------------------------------------------------------------------

export function ResetDialog({ open, onClose, onReset }: { open: boolean; onClose: () => void; onReset: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState('');
  const { busy, error, setError, run } = useAction();
  useEffect(() => { if (open) { setStep(1); setTyped(''); setError(''); } }, [open, setError]);

  return (
    <AlertDialog open={open} onOpenChange={o => !o && onClose()}>
      <AlertDialogContent className="sm:max-w-[440px]">
        <AlertDialogHeader>
          <div className="mb-1 grid size-9 place-items-center rounded-full bg-destructive/10 text-destructive"><TriangleAlert className="size-4.5" /></div>
          <AlertDialogTitle>{step === 1 ? 'Reset LocalVault?' : 'Erase vault and start over'}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            {step === 1 ? (
              <div className="space-y-3">
                <p>Use this only if the master password is forgotten. It cannot be undone:</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Every saved password, username and note becomes inaccessible.</li>
                  <li>All paired browsers are disconnected.</li>
                  <li>You start again with an empty vault and a new master password.</li>
                </ul>
                <p>Have an encrypted backup whose password you remember? Cancel and use <span className="text-foreground">Restore from backup</span> instead.</p>
              </div>
            ) : (
              <p>Last check. The old encrypted vault file is set aside in the data folder and stays unreadable unless you remember its original password. Type <span className="font-mono text-foreground">RESET</span> to confirm.</p>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {step === 2 && <Input autoFocus value={typed} onChange={e => setTyped(e.target.value)} aria-label="Type RESET to confirm" placeholder="RESET" maxLength={16} className="font-mono" />}
        <ErrorText>{error}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {step === 1
            ? <Button variant="destructive" onClick={() => setStep(2)}>Continue</Button>
            : <Button variant="destructive" disabled={busy || typed !== 'RESET'} onClick={() => void run(async () => { await call('reset', { confirm: typed }); onReset(); })}>Erase and reset</Button>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- First-run offer: after creating the vault with a master password, use Windows Hello from then on ----------

export function HelloOffer({ open, onClose, notify, onChange }: { open: boolean; onClose: () => void; notify: Notify; onChange: () => Promise<void> }) {
  const { busy, error, run } = useAction();
  return (
    <AlertDialog open={open} onOpenChange={o => !o && onClose()}>
      <AlertDialogContent className="sm:max-w-[420px]">
        <AlertDialogHeader>
          <div className="mb-1 grid size-9 place-items-center rounded-full bg-muted"><Fingerprint className="size-4.5" /></div>
          <AlertDialogTitle>Unlock with Windows Hello?</AlertDialogTitle>
          <AlertDialogDescription>
            Next time, open your vault with your face, fingerprint or Windows PIN instead of typing the master password. Your master password still works, and you need it if Windows Hello is reset. You can change this in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ErrorText>{error}</ErrorText>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <Button disabled={busy} onClick={() => void run(async () => { await call('setHello', { enabled: true }); await onChange(); notify('Windows Hello is on. Next time, unlock with Hello.'); onClose(); })}>
            {busy ? <Spinner /> : 'Use Windows Hello'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- Password generator: a standalone tool. It never saves to the vault; its settings also drive the tray item. ----

const typeLabels: { key: 'upper' | 'lower' | 'digits' | 'symbols'; label: string; sample: string }[] = [
  { key: 'upper', label: 'Uppercase', sample: 'A–Z' }, { key: 'lower', label: 'Lowercase', sample: 'a–z' },
  { key: 'digits', label: 'Numbers', sample: '0–9' }, { key: 'symbols', label: 'Symbols', sample: '!@#$' },
];

function strength(o: GeneratorOptions) {
  const pool = (o.upper ? (o.avoidAmbiguous ? 24 : 26) : 0) + (o.lower ? (o.avoidAmbiguous ? 24 : 26) : 0) + (o.digits ? (o.avoidAmbiguous ? 8 : 10) : 0) + (o.symbols ? 23 : 0);
  const bits = Math.round(o.length * Math.log2(Math.max(pool, 2)));
  const [label, level] = bits < 50 ? ['Weak', 1] : bits < 75 ? ['Fair', 2] : bits < 100 ? ['Strong', 3] : ['Very strong', 4];
  return { bits, label, level };
}

export function GeneratorDialog({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: Notify }) {
  const [options, setOptions] = useState<GeneratorOptions | null>(null);
  const [value, setValue] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const generate = (o: GeneratorOptions) => call('generate', { options: o }).then(setValue, e => setError((e as Error).message));
  useEffect(() => {
    if (!open) { setValue(''); return; }
    setError('');
    void call('generatorOptions').then(o => { setOptions(o); void generate(o); }, e => setError((e as Error).message));
  }, [open]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1400); return () => clearTimeout(t); }, [copied]);
  // Persist changes shortly after the last edit so the tray's "Generate password" uses them too.
  useEffect(() => {
    if (!open || !options) return;
    const t = setTimeout(() => void call('setGeneratorOptions', { options }).catch(e => setError((e as Error).message)), 300);
    return () => clearTimeout(t);
  }, [options, open]);

  const change = (patch: Partial<GeneratorOptions>) => setOptions(o => { const next = { ...o!, ...patch }; void generate(next); return next; });
  const copy = () => call('copyText', { value }).then(() => { setCopied(true); notify('Password copied. Clipboard clears in 30 seconds.'); }, e => setError((e as Error).message));
  const enabledTypes = options ? typeLabels.filter(t => options[t.key]).length : 0;
  const score = options ? strength(options) : null;

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Password generator</DialogTitle>
          <DialogDescription>Make a strong password to use anywhere. Nothing is saved to your vault. Tray ▸ Generate password uses these settings.</DialogDescription>
        </DialogHeader>
        {options && score && (
          <div className="grid gap-5">
            <div className="rounded-xl border bg-muted/40 p-1.5">
              <div className="flex items-start gap-1">
                <p aria-live="polite" className="selectable min-h-[52px] flex-1 px-2.5 py-2 font-mono text-[15px] leading-relaxed break-all">{value}</p>
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Generate another" onClick={() => void generate(options)} className="mt-1.5 text-muted-foreground hover:text-foreground"><RefreshCw /></Button>
              </div>
              <div className="flex items-center gap-2 px-2.5 pt-1 pb-1.5">
                <div className="flex flex-1 gap-1" aria-hidden>
                  {[1, 2, 3, 4].map(i => <span key={i} className={cn('h-1 flex-1 rounded-full bg-border transition-colors duration-150', i <= score.level && (score.level === 1 ? 'bg-destructive' : score.level === 2 ? 'bg-amber-500' : 'bg-emerald-500'))} />)}
                </div>
                <span className="text-[12px] text-muted-foreground tabular-nums">{score.label} · {score.bits} bits</span>
              </div>
            </div>

            <div className="grid gap-2.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="gen-length" className="font-normal text-muted-foreground">Length</Label>
                <Input type="number" min={8} max={128} value={options.length} aria-label="Password length" className="h-7 w-16 text-right tabular-nums"
                  onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 8 && n <= 128) change({ length: n }); }} />
              </div>
              <input id="gen-length" type="range" min={8} max={64} value={Math.min(options.length, 64)} onChange={e => change({ length: Number(e.target.value) })}
                className="h-1.5 w-full cursor-pointer appearance-auto accent-foreground" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {typeLabels.map(t => (
                <label key={t.key} className={cn('flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5', options[t.key] && enabledTypes === 1 ? 'opacity-70' : 'cursor-pointer')}>
                  <span>{t.label} <span className="ml-1 font-mono text-[12px] text-muted-foreground">{t.sample}</span></span>
                  <Switch checked={options[t.key]} disabled={options[t.key] && enabledTypes === 1} onCheckedChange={v => change({ [t.key]: v })} aria-label={t.label} />
                </label>
              ))}
              <label className="col-span-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
                <span>Avoid look-alike characters <span className="ml-1 font-mono text-[12px] text-muted-foreground">I l 1 O 0 o</span></span>
                <Switch checked={options.avoidAmbiguous} onCheckedChange={v => change({ avoidAmbiguous: v })} aria-label="Avoid look-alike characters" />
              </label>
            </div>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="button" disabled={!value} onClick={() => void copy()}>{copied ? <Check /> : <Copy />} Copy password</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
