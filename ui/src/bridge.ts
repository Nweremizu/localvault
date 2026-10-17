// The WebView bridge exposes summaries broadly and returns secrets only for a selected item or explicit action.

export type VaultState = { exists: boolean; unlocked: boolean; helloAvailable: boolean; helloEnrolled: boolean; siteIcons: boolean; preview: boolean; notice: string | null };
export type FieldMeta = { id: string; label: string; type: 'text' | 'secret' };
export type CustomField = FieldMeta & { value: string };
export type EntryView = { id: string; type: 'login' | 'note'; title: string; username: string; origin: string | null; updated: string; version: string; deletedAt: string | null; historyCount: number; fields: FieldMeta[] };
export type EntryContent = Omit<EntryView, 'fields'> & { password: string; origins: string[]; notes: string; fields: CustomField[]; created: string };
export type EntryInput = { id?: string; version?: string; type?: 'login' | 'note'; title: string; username?: string; password?: string; origins: string[]; notes: string; fields?: CustomField[] };
export type ImportAction = 'skip' | 'add' | 'replace';
export type ImportRowView = { index: number; row: number; title: string; username: string; website: string; status: string; action: ImportAction; valid: boolean };
export type Pairing = { id: string; profile: string; created: string };
export type PairingsView = { chromiumId: string; firefoxId: string; items: Pairing[] };
export type GeneratorOptions = { length: number; upper: boolean; lower: boolean; digits: boolean; symbols: boolean; avoidAmbiguous: boolean };
export type ItemPage = { total: number; offset: number; items: EntryView[] };
export type HistoryView = { version: string; items: { index: number; revisedAt: string; type: 'login' | 'note'; title: string; username: string }[] };
export type HistoryContent = { type: 'login' | 'note'; title: string; username: string; password: string; origins: string[]; notes: string; fields: CustomField[]; created: string; updated: string };
export type SecurityFinding = { id: string; title: string; score: number | null; weak: boolean; reused: boolean; assessed: boolean };
export type SecurityReport = { total: number; weak: number; reused: number; notAssessed: number; findings: SecurityFinding[] };
export type BreachFinding = { id: string; title: string; state: 'found' | 'notFound' | 'unavailable'; count: number | null };

type Ops = {
  installUpdate: [void, boolean];
  openSite: [{ id: string }, null];
  state: [void, VaultState]; unlock: [{ password: string }, null]; create: [{ password: string }, null]; lock: [void, null]; endSession: [void, null]; hello: [void, null]; setHello: [{ enabled: boolean }, null];
  list: [{ offset?: number }, ItemPage]; getItem: [{ id: string }, EntryContent]; reveal: [{ id: string }, string]; copy: [{ id: string; field: 'username' | 'password' }, null]; revealField: [{ id: string; fieldId: string }, string]; copyField: [{ id: string; fieldId: string }, null];
  history: [{ id: string }, HistoryView]; historyContent: [{ id: string; index: number; version: string }, HistoryContent]; historyRestore: [{ id: string; index: number; version: string }, null];
  trashList: [{ offset?: number }, ItemPage]; trashRestore: [{ id: string }, null]; undoDelete: [{ id: string }, null]; trashPurge: [{ confirm: string; id?: string }, null];
  securityAnalyze: [void, SecurityReport]; breachStart: [void, string]; breachStatus: [{ scanId: string }, { status: 'running' | 'completed' | 'canceled'; results: BreachFinding[] | null }]; breachCancel: [{ scanId: string }, null];
  generate: [{ options?: GeneratorOptions }, string]; generatorOptions: [void, GeneratorOptions]; setGeneratorOptions: [{ options: GeneratorOptions }, null]; copyText: [{ value: string }, null]; icon: [{ origin: string }, string | null]; setSiteIcons: [{ enabled: boolean }, null]; save: [EntryInput, null]; delete: [{ id: string }, null]; importPick: [void, ImportRowView[] | null]; importCommit: [{ actions: ImportAction[] }, null]; importCancel: [void, null];
  backup: [void, boolean]; restorePick: [void, string | null]; restore: [{ password: string }, null]; changePassword: [{ current: string; next: string }, null]; reset: [{ confirm: string }, null]; pairings: [void, PairingsView]; revokePairing: [{ id: string }, null];
};

type Reply = { id: string; ok: boolean; result?: unknown; error?: string } | { event: 'changed' };
type WebView = { postMessage(message: unknown): void; addEventListener(type: 'message', listener: (e: { data: Reply }) => void): void };
const webview = (window as unknown as { chrome?: { webview?: WebView } }).chrome?.webview;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
const listeners = new Set<() => void>(); let next = 0;
webview?.addEventListener('message', ({ data }) => {
  if ('event' in data) { listeners.forEach(listener => listener()); return; }
  const waiter = pending.get(data.id); if (!waiter) return; pending.delete(data.id);
  if (data.ok) waiter.resolve(data.result ?? null); else waiter.reject(new Error(data.error ?? 'The operation failed.'));
});
export function call<K extends keyof Ops>(op: K, ...args: Ops[K][0] extends void ? [] : [Ops[K][0]]): Promise<Ops[K][1]> {
  if (!webview) return mock(op, args[0]) as Promise<Ops[K][1]>;
  const id = String(++next);
  return new Promise((resolve, reject) => { pending.set(id, { resolve: resolve as (value: unknown) => void, reject }); webview.postMessage({ id, op, args: args[0] ?? {} }); });
}
export function onHostChange(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const isMock = !webview;

// ---- Design-time mock: deterministic examples only; breach checks never make network requests. ----------------
type MockEntry = EntryContent & { history: HistoryContent[] };
const sample = (title: string, username: string, origin: string, notes = '', password = 'correct-horse-battery-staple'): MockEntry => {
  const now = new Date(Date.now() - Math.random() * 9e9).toISOString();
  return { id: crypto.randomUUID(), type: 'login', title, username, password, origins: [origin], origin, notes, created: now, updated: now, version: '1', deletedAt: null, historyCount: 0, fields: [], history: [] };
};
const note: MockEntry = { id: crypto.randomUUID(), type: 'note', title: 'Recovery codes', username: '', password: '', origins: [], origin: null, notes: 'Store recovery codes here.\nKeep a separate encrypted backup.', created: new Date().toISOString(), updated: new Date().toISOString(), version: '1', deletedAt: null, historyCount: 0, fields: [{ id: crypto.randomUUID(), label: 'Vault PIN', type: 'secret', value: '482916' }], history: [] };
const reusable = sample('Linear', 'alex@studio.example', 'https://linear.app');
const db = {
  exists: true, unlocked: false, hello: true, siteIcons: true,
  generator: { length: 20, upper: true, lower: true, digits: true, symbols: true, avoidAmbiguous: false } as GeneratorOptions,
  entries: [sample('GitHub', 'alex@example.com', 'https://github.com', 'Personal account · 2FA via authenticator', '123456'), reusable,
    sample('Figma', 'alex@studio.example', 'https://www.figma.com', '', reusable.password), sample('Harbor Finance', 'alex.r', 'https://bank.example', 'Card PIN is not stored here.', 'better-passphrase-unique'),
    sample('Vercel', 'alex@example.com', 'https://vercel.com'), sample('Notion', 'alex@example.com', 'https://www.notion.so'), note,
    sample('Archived account', 'former-user', 'https://archive.example')],
};
db.entries[7].deletedAt = new Date().toISOString();
db.entries[0].fields = [{ id: crypto.randomUUID(), label: 'Customer ID', type: 'text', value: 'LV-2048' }, { id: crypto.randomUUID(), label: 'Recovery key', type: 'secret', value: 'sample-secret-value' }];
db.entries[0].history = [{ type: 'login', title: 'GitHub', username: 'alex@example.com', password: 'old-sample-password', origins: ['https://github.com'], notes: '', fields: [], created: db.entries[0].created, updated: new Date(Date.now() - 86400000).toISOString() }];
db.entries[0].historyCount = 1;
const wait = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));
const fail = (message: string): never => { throw new Error(message); };
const metadata = (e: MockEntry): EntryView => ({ id: e.id, type: e.type, title: e.title, username: e.username, origin: e.origin,
  updated: e.updated, version: e.version, deletedAt: e.deletedAt, historyCount: e.history.length,
  fields: e.fields.map(({ id, label, type }) => ({ id, label, type })) });
async function mock(op: keyof Ops, args: any): Promise<unknown> {
  await wait(op === 'unlock' || op === 'create' ? 260 : 70);
  const find = (id: string) => db.entries.find(e => e.id === id && !e.deletedAt) ?? fail('This item no longer exists.');
  switch (op) {
    case 'installUpdate': fail('Updates are not available in the design preview. Use the installed desktop app.'); return false;
    case 'state': return { exists: db.exists, unlocked: db.unlocked, helloAvailable: true, helloEnrolled: db.hello && db.exists, siteIcons: db.siteIcons, preview: true, notice: null };
    case 'unlock': if (!args.password) fail('Enter the master password.'); db.unlocked = true; return null;
    case 'create': if (args.password.length < 12) fail('Use a master password of 12–1,024 characters.'); db.exists = db.unlocked = true; db.entries = []; return null;
    case 'lock': case 'endSession': db.unlocked = false; return null;
    case 'hello': db.unlocked = true; return null;
    case 'setHello': db.hello = args.enabled; return null;
    case 'list': case 'trashList': {
      const rows = db.entries.filter(e => op === 'trashList' ? !!e.deletedAt : !e.deletedAt).sort((a, b) => a.title.localeCompare(b.title));
      const offset = Math.max(0, args?.offset ?? 0); return { total: rows.length, offset, items: rows.slice(offset, offset + 16).map(metadata) };
    }
    case 'openSite': {
      if (!db.unlocked) fail('Unlock the vault first.');
      const e = find(args.id);
      const site = e.type === 'login' && e.origins[0] ? new URL(e.origins[0]) : null;
      if (!site || site.protocol !== 'https:' || site.username || site.password) fail('Add an HTTPS website to this account first.');
      window.open(site!.origin, '_blank', 'noopener,noreferrer'); return null;
    }
    case 'getItem': { const e = find(args.id); return { ...e, fields: e.fields.map(f => ({ ...f })), history: [] }; }
    case 'reveal': return find(args.id).password;
    case 'revealField': return find(args.id).fields.find(f => f.id === args.fieldId && f.type === 'secret')?.value ?? fail('That secret field no longer exists.');
    case 'copy': case 'copyField': return null;
    case 'breachStart': return 'mock-scan';
    case 'breachStatus': return { status: 'completed', results: db.entries.filter(e => !e.deletedAt && e.type === 'login').map((e, i) => ({ id: e.id, title: e.title, state: i === 0 ? 'found' : 'notFound', count: i === 0 ? 12 : 0 })) };
    case 'breachCancel': return null;
    case 'history': { const e = find(args.id); return { version: e.version, items: [...e.history].reverse().map((h, index) => ({ index, revisedAt: h.updated, type: h.type, title: h.title, username: h.username })) }; }
    case 'historyContent': return find(args.id).history.slice().reverse()[args.index] ?? fail('That history revision is no longer available.');
    case 'historyRestore': { const e = find(args.id); if (e.version !== args.version) fail('This item changed. Reopen history.'); const h = e.history.slice().reverse()[args.index]; if (!h) fail('That history revision is no longer available.'); e.history.push({ type: e.type, title: e.title, username: e.username, password: e.password, origins: e.origins, notes: e.notes, fields: e.fields, created: e.created, updated: e.updated }); Object.assign(e, h, { id: e.id, updated: new Date().toISOString(), version: String(Date.now()) }); return null; }
    case 'trashRestore': case 'undoDelete': { const e = db.entries.find(item => item.id === args.id && item.deletedAt) ?? fail('This Trash item no longer exists.'); e.deletedAt = null; e.updated = new Date().toISOString(); e.version = String(Date.now()); return null; }
    case 'trashPurge': if (args.confirm !== 'DELETE') fail('Type DELETE to confirm permanent removal.'); db.entries = db.entries.filter(e => e.id !== args.id); return null;
    case 'securityAnalyze': {
      const active = db.entries.filter(e => !e.deletedAt && e.type === 'login');
      const counts = new Map<string, number>(); for (const e of active) counts.set(e.password, (counts.get(e.password) ?? 0) + 1);
      const findings = active.map(e => ({ id: e.id, title: e.title, score: e.password.length > 1024 ? null : (e.password.length < 10 ? 1 : 4), weak: e.password.length < 10, reused: (counts.get(e.password) ?? 0) > 1, assessed: e.password.length <= 1024 }));
      return { total: findings.length, weak: findings.filter(f => f.weak).length, reused: findings.filter(f => f.reused).length, notAssessed: findings.filter(f => !f.assessed).length, findings };
    }
    case 'icon': return db.siteIcons ? args.origin + '/favicon.ico' : null;
    case 'setSiteIcons': db.siteIcons = args.enabled; return null;
    case 'generate': { const o: GeneratorOptions = args.options ?? db.generator; const pool = (o.upper ? 'ABCDEFGHJKLMNPQRSTUVWXYZ' : '') + (o.lower ? 'abcdefghijkmnpqrstuvwxyz' : '') + (o.digits ? '23456789' : '') + (o.symbols ? '!@#$%^&*()-_=+[]{};:,.?' : ''); return Array.from(crypto.getRandomValues(new Uint32Array(o.length)), n => pool[n % pool.length]).join(''); }
    case 'generatorOptions': return db.generator;
    case 'setGeneratorOptions': db.generator = args.options; return null;
    case 'copyText': return null;
    case 'save': {
      if (!args.title.trim()) fail('Entry fields are missing or exceed the allowed size.');
      const old = args.id ? find(args.id) : undefined;
      if (old && old.version !== args.version) fail('This item changed while you were editing. Reopen it before saving.');
      const entry = { ...(old ?? sample('', '', 'https://example.com')), ...args, type: args.type ?? 'login', password: args.type === 'note' ? '' : (args.password ?? old?.password ?? ''), username: args.type === 'note' ? '' : (args.username ?? ''), origins: args.type === 'note' ? [] : args.origins, fields: args.fields ?? old?.fields ?? [], updated: new Date().toISOString(), version: String(Date.now()), history: old?.history ?? [], historyCount: old?.history.length ?? 0, deletedAt: null } as MockEntry;
      if (entry.type === 'login' && !entry.password) fail('Entry fields are missing or exceed the allowed size.');
      if (entry.type === 'note' && !entry.notes.trim()) fail('Secure notes require a title and body.');
      if (old) {
        const changed = old.type !== entry.type || old.title !== entry.title || old.username !== entry.username || old.password !== entry.password || old.notes !== entry.notes || old.origins.join() !== entry.origins.join() || JSON.stringify(old.fields) !== JSON.stringify(entry.fields);
        if (!changed) return null;
        entry.history = [...old.history, { type: old.type, title: old.title, username: old.username, password: old.password, origins: old.origins, notes: old.notes, fields: old.fields, created: old.created, updated: old.updated }].slice(-20);
        entry.historyCount = entry.history.length;
      }
      db.entries = [...db.entries.filter(e => e.id !== entry.id), entry]; return null;
    }
    case 'delete': { const e = find(args.id); e.deletedAt = new Date().toISOString(); return null; }
    case 'importPick': return [{ index: 0, row: 2, title: 'Dribbble', username: 'alex', website: 'https://dribbble.com', status: 'New account', action: 'add', valid: true }, { index: 1, row: 3, title: 'GitHub', username: 'alex@example.com', website: 'https://github.com', status: 'Conflicts with an existing account', action: 'skip', valid: true }, { index: 2, row: 4, title: 'Invalid row', username: '', website: 'javascript:bad', status: 'Invalid fields, URL, or CSV quoting — skipped', action: 'skip', valid: false }];
    case 'importCommit': case 'importCancel': case 'changePassword': case 'restore': case 'revokePairing': return null;
    case 'backup': return true;
    case 'restorePick': return 'LocalVault-20261001.lvault';
    case 'reset': db.hello = false; db.exists = false; db.unlocked = false; db.entries = []; return null;
    case 'pairings': return { chromiumId: 'abcdefghijklmnopabcdefghijklmnop', firefoxId: 'localvault@example', items: [{ id: crypto.randomUUID(), profile: 'Chrome · Work', created: new Date().toISOString() }] };
  }
}
