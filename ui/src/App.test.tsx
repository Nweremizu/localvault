import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TooltipProvider } from './components/ui/tooltip';
import { App } from './App';
import { SecurityDashboard } from './SecurityDashboard';
import { SettingsDialog } from './dialogs';

const { callMock } = vi.hoisted(() => ({ callMock: vi.fn() }));
vi.mock('./bridge', async importOriginal => ({ ...(await importOriginal<typeof import('./bridge')>()), call: callMock }));
globalThis.ResizeObserver ??= class implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  constructor(_callback: ResizeObserverCallback) {}
};

let active: any[];
let trashed: any[];
let breachStaysRunning: boolean;
let securityReport: any;
let breachResults: any[];
const account = () => ({ id: 'login-1', type: 'login', title: 'GitHub', username: 'alex@example.com', password: '123456', origins: ['https://github.com'], origin: 'https://github.com', notes: '', created: '2026-10-01T00:00:00.000Z', updated: '2026-10-02T00:00:00.000Z', version: 'v1', deletedAt: null, historyCount: 1, fields: [{ id: 'field-1', label: 'API token', type: 'secret', value: 'top-secret-field' }], history: [{ password: 'older' }] });
const summary = (item: any) => ({ id: item.id, type: item.type, title: item.title, username: item.username, origin: item.origin ?? item.origins[0] ?? null, updated: item.updated, version: item.version, deletedAt: item.deletedAt ?? null, historyCount: item.history?.length ?? 0, fields: item.fields.map(({ id, label, type }: any) => ({ id, label, type })) });
const renderApp = () => render(<TooltipProvider><App /></TooltipProvider>);

beforeEach(() => {
  cleanup(); active = [account()]; trashed = []; breachStaysRunning = false;
  securityReport = { total: 1, weak: 1, reused: 0, notAssessed: 0, findings: [{ id: 'login-1', title: 'GitHub', score: 1, weak: true, reused: false, assessed: true }] };
  breachResults = [{ id: 'login-1', title: 'GitHub', state: 'found', count: 17 }];
  callMock.mockImplementation(async (op: string, args: any = {}) => {
    switch (op) {
      case 'state': return { exists: true, unlocked: true, helloAvailable: false, helloEnrolled: false, siteIcons: false, preview: true, notice: null };
      case 'list': { const items = active.slice(args.offset ?? 0, (args.offset ?? 0) + 16).map(summary); return { total: active.length, offset: args.offset ?? 0, items }; }
      case 'trashList': { const items = trashed.slice(args.offset ?? 0, (args.offset ?? 0) + 16).map(summary); return { total: trashed.length, offset: args.offset ?? 0, items }; }
      case 'getItem': return { ...active.find(item => item.id === args.id), fields: active.find(item => item.id === args.id).fields.map((field: any) => ({ ...field })), history: [] };
      case 'revealField': return 'top-secret-field';
      case 'history': return { version: 'v1', items: [{ index: 0, revisedAt: '2026-10-01T00:00:00.000Z', type: 'login', title: 'GitHub', username: 'alex@example.com' }] };
      case 'historyContent': return { type: 'login', title: 'GitHub', username: 'alex@example.com', password: 'earlier-secret', origins: ['https://github.com'], notes: '', fields: [], created: '2026-10-01T00:00:00.000Z', updated: '2026-10-01T00:00:00.000Z' };
      case 'historyRestore': return null;
      case 'securityAnalyze': return securityReport;
      case 'breachStart': return 'scan-1';
      case 'breachStatus': return breachStaysRunning ? { status: 'running', results: null } : { status: 'completed', results: breachResults };
      case 'breachCancel': case 'copy': case 'copyField': case 'copyText': return null;
      case 'save': {
        const old = active.find(item => item.id === args.id);
        const item = { ...args, id: old?.id ?? 'note-1', type: args.type ?? 'login', username: args.username ?? '', password: args.password ?? old?.password ?? '', origins: args.origins ?? [], origin: args.origins?.[0] ?? null, fields: args.fields ?? [], created: old?.created ?? new Date().toISOString(), updated: new Date().toISOString(), version: 'v2', deletedAt: null, history: old?.history ?? [] };
        active = [...active.filter(entry => entry.id !== item.id), item]; return null;
      }
      case 'delete': { const item = active.find(entry => entry.id === args.id); item.deletedAt = new Date().toISOString(); trashed.push(item); active = active.filter(entry => entry.id !== args.id); return null; }
      case 'undoDelete': case 'trashRestore': { const item = trashed.find(entry => entry.id === args.id); item.deletedAt = null; active.push(item); trashed = trashed.filter(entry => entry.id !== args.id); return null; }
      case 'trashPurge': trashed = args.id ? trashed.filter(entry => entry.id !== args.id) : []; return null;
      case 'icon': return null;
      default: return null;
    }
  });
});

describe('LocalVault feature workflows', () => {
  it('starts updates only from the explicit settings action and reports cancellation or failure', async () => {
    const user = userEvent.setup(); const notify = vi.fn();
    render(<SettingsDialog open hello={false} helloAvailable={false} siteIcons={false} onClose={() => {}} notify={notify} onChange={async () => {}} />);
    expect(callMock.mock.calls.some(([op]) => op === 'installUpdate')).toBe(false);
    callMock.mockResolvedValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Install update…' }));
    expect(notify).not.toHaveBeenCalled();
    callMock.mockRejectedValueOnce(new Error('Choose a newer LocalVault version.'));
    await user.click(screen.getByRole('button', { name: 'Install update…' }));
    expect(await screen.findByText('Choose a newer LocalVault version.')).toBeTruthy();
    callMock.mockResolvedValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Install update…' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Windows Installer is starting. Reopen LocalVault after the update.'));
  });

  it('keeps a selected secret custom field masked until explicitly revealed', async () => {
    const user = userEvent.setup(); renderApp();
    await screen.findByRole('heading', { name: 'GitHub' });
    expect(screen.queryByText('top-secret-field')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reveal field' }));
    expect(await screen.findByText('top-secret-field')).toBeTruthy();
  });

  it('creates a secure note with a custom field from the Secure notes section', async () => {
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: /Secure notes/ }));
    await user.click(screen.getAllByRole('button', { name: 'New secure note' })[0]);
    await user.type(screen.getByLabelText('Title'), 'Recovery codes');
    await user.type(screen.getByLabelText('Note'), 'One-time recovery details');
    await user.click(screen.getByRole('button', { name: 'Add field' }));
    await user.type(screen.getByLabelText('Custom field label'), 'Account reference');
    await user.type(screen.getByLabelText('Account reference value'), 'AC-2048');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('One-time recovery details');
    const save = callMock.mock.calls.find(([op]) => op === 'save')?.[1];
    expect(save.type).toBe('note'); expect(save.origins).toEqual([]); expect(save.password).toBeUndefined();
    expect(save.fields[0]).toMatchObject({ label: 'Account reference', value: 'AC-2048', type: 'text' });
  });

  it('requires consent before starting the online breached-password check', async () => {
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    await user.click(await screen.findByRole('button', { name: 'Check breached passwords' }));
    expect(await screen.findByRole('heading', { name: 'Check breached passwords online?' })).toBeTruthy();
    expect(callMock.mock.calls.some(([op]) => op === 'breachStart')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Continue with check' }));
    await user.click(await screen.findByText(/Scan results ·/));
    expect(await screen.findByText('Found · 17 times')).toBeTruthy();
    expect(callMock.mock.calls.filter(([op]) => op === 'breachStart')).toHaveLength(1);
    expect(callMock.mock.calls.filter(([op]) => op === 'breachStatus')).toHaveLength(1);
  });

  it('keeps breach checking first with privacy collapsed until requested', async () => {
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    const panel = await screen.findByRole('region', { name: 'Breached passwords' });
    const queue = await screen.findByRole('region', { name: '1 account needs review' });
    expect(panel.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const privacy = within(panel).getByText('Privacy & limits').closest('details')!;
    expect(privacy.open).toBe(false);
    await user.click(within(panel).getByText('Privacy & limits'));
    expect(privacy.open).toBe(true);
    expect(within(panel).getByText(/five-character SHA-1 hash prefix/)).toBeTruthy();
    expect(callMock.mock.calls.some(([op]) => op === 'breachStart')).toBe(false);
  });

  it('filters the top breach results and opens the selected account', async () => {
    active.push({ ...account(), id: 'login-2', title: 'Work email' });
    breachResults.push({ id: 'login-2', title: 'Work email', state: 'notFound', count: 0 });
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    await user.click(await screen.findByRole('button', { name: 'Check breached passwords' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with check' }));
    const panel = screen.getByRole('region', { name: 'Breached passwords' });
    const results = (await within(panel).findByText(/Scan results ·/)).closest('details')!;
    expect(results.open).toBe(false);
    await user.click(within(panel).getByText(/Scan results ·/));
    await within(panel).findByText('Found · 17 times');
    expect(within(panel).queryByRole('button', { name: 'Open breach result for Work email' })).toBeNull();
    const filters = within(panel).getByRole('group', { name: 'Filter breach results' });
    await user.click(within(filters).getByRole('button', { name: /Not found/ }));
    expect(within(panel).queryByRole('button', { name: 'Open breach result for GitHub' })).toBeNull();
    await user.click(within(panel).getByRole('button', { name: /Show all/ }));
    expect(within(panel).getByRole('button', { name: 'Open breach result for GitHub' })).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Open breach result for Work email' }));
    expect(await screen.findByRole('heading', { name: 'Work email' })).toBeTruthy();
  });

  it('opens a breached account by ID without clearing its warning, then refreshes after a saved change', async () => {
    const user = userEvent.setup();
    const props = { entries: active.map(summary), onSelect: vi.fn() };
    const view = render(<SecurityDashboard {...props} refreshKey={0} />);
    await user.click(await screen.findByRole('button', { name: 'Check breached passwords' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with check' }));
    await screen.findByText('1 password found in breaches');
    await user.click(within(screen.getByRole('region', { name: '1 account needs review' })).getByRole('button', { name: 'Go to site for GitHub' }));
    expect(callMock.mock.calls.find(([op]) => op === 'openSite')?.[1]).toEqual({ id: 'login-1' });
    expect(screen.getByText('1 password found in breaches')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review GitHub' })).toBeTruthy();
    expect(await screen.findByText(/approve the LocalVault extension/)).toBeTruthy();
    securityReport = { total: 1, weak: 0, reused: 0, notAssessed: 0, findings: [
      { id: 'login-1', title: 'GitHub', score: 4, weak: false, reused: false, assessed: true },
    ] };
    view.rerender(<SecurityDashboard {...props} refreshKey={1} />);
    expect(await screen.findByText('0 accounts need review')).toBeTruthy();
    expect(screen.queryByText('1 password found in breaches')).toBeNull();
    expect(screen.getByText('Not checked in this session')).toBeTruthy();
    expect(callMock.mock.calls.filter(([op]) => op === 'breachStart')).toHaveLength(1);
  });

  it('disables the site shortcut for manual-use accounts and reports launch failures', async () => {
    const user = userEvent.setup();
    const props = { entries: active.map(summary), onSelect: vi.fn() };
    const view = render(<SecurityDashboard {...props} refreshKey={0} />);
    await user.click(await screen.findByRole('button', { name: 'Check breached passwords' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with check' }));
    await screen.findByText('1 password found in breaches');
    const action = within(screen.getByRole('region', { name: '1 account needs review' })).getByRole('button', { name: 'Go to site for GitHub' });
    callMock.mockRejectedValueOnce(new Error('The website could not be opened.'));
    await user.click(action);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The website could not be opened.');
    view.rerender(<SecurityDashboard {...props} entries={props.entries.map(e => ({ ...e, origin: null }))} refreshKey={0} />);
    expect(screen.getAllByRole('button', { name: 'Go to site for GitHub' }).every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.getByText('1 password found in breaches')).toBeTruthy();
  });

  it('cancels an in-flight check without showing stale results', async () => {
    breachStaysRunning = true;
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    await user.click(await screen.findByRole('button', { name: 'Check breached passwords' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with check' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel check' }));
    await waitFor(() => expect(callMock.mock.calls.some(([op]) => op === 'breachCancel')).toBe(true));
    expect(screen.getByRole('button', { name: 'Check breached passwords' })).toBeTruthy();
    expect(screen.queryByText('Found · 17 times')).toBeNull();
  });

  it('filters the review queue and opens the affected account', async () => {
    active.push({ ...account(), id: 'login-2', title: 'Work email' });
    securityReport = { total: 2, weak: 1, reused: 1, notAssessed: 0, findings: [
      { id: 'login-1', title: 'GitHub', score: 1, weak: true, reused: false, assessed: true },
      { id: 'login-2', title: 'Work email', score: 4, weak: false, reused: true, assessed: true },
    ] };
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    await user.click(await screen.findByRole('button', { name: /^Reused/ }));
    expect(screen.queryByRole('button', { name: 'Review GitHub' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Review Work email' }));
    expect(await screen.findByRole('heading', { name: 'Work email' })).toBeTruthy();
  });

  it('prioritizes an exposed password ahead of reused passwords in the next-review flow', async () => {
    active.push({ ...account(), id: 'login-2', title: 'Work email' });
    securityReport = { total: 2, weak: 1, reused: 1, notAssessed: 0, findings: [
      { id: 'login-1', title: 'GitHub', score: 1, weak: true, reused: false, assessed: true },
      { id: 'login-2', title: 'Work email', score: 4, weak: false, reused: true, assessed: true },
    ] };
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    expect((await screen.findAllByRole('button', { name: /^Review (GitHub|Work email)$/ }))[0].getAttribute('aria-label')).toBe('Review Work email');
    await user.click(screen.getByRole('button', { name: 'Check breached passwords' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with check' }));
    await screen.findByText('1 password found in breaches');
    expect(screen.getAllByRole('button', { name: /^Review (GitHub|Work email)$/ })[0].getAttribute('aria-label')).toBe('Review GitHub');
    await user.click(screen.getByRole('button', { name: 'Review next password' }));
    expect(await screen.findByRole('heading', { name: 'GitHub' })).toBeTruthy();
  });

  it('keeps partial online results distinct from a clear result', async () => {
    breachResults = [{ id: 'login-1', title: 'GitHub', state: 'unavailable', count: null }];
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    await user.click(await screen.findByRole('button', { name: 'Check breached passwords' }));
    await user.click(await screen.findByRole('button', { name: 'Continue with check' }));
    expect(await screen.findByText('Some passwords could not be checked')).toBeTruthy();
    expect(screen.getByText(/Some requests were unavailable/)).toBeTruthy();
    expect(screen.queryByText('No matches found in this check')).toBeNull();
  });

  it('keeps unassessed passwords actionable without labeling them strong', async () => {
    securityReport = { total: 1, weak: 0, reused: 0, notAssessed: 1, findings: [
      { id: 'login-1', title: 'GitHub', score: null, weak: false, reused: false, assessed: false },
    ] };
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'Security' }));
    await user.click(await screen.findByRole('button', { name: /^Not assessed/ }));
    expect(screen.getByRole('button', { name: 'Review GitHub' })).toBeTruthy();
    expect(screen.getByText(/Over the 1,024-character analysis limit/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Refresh local check' }));
    await waitFor(() => expect(callMock.mock.calls.filter(([op]) => op === 'securityAnalyze').length).toBeGreaterThan(1));
    expect(callMock.mock.calls.some(([op]) => op === 'breachStart')).toBe(false);
  });

  it('reveals an item history revision only after selection and confirms restoration', async () => {
    const user = userEvent.setup(); renderApp();
    await user.click(await screen.findByRole('button', { name: 'History' }));
    expect(await screen.findByText(/Revision summaries omit secrets/)).toBeTruthy();
    expect(screen.queryByText('earlier-secret')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'View revision' }));
    await user.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(await screen.findByText('earlier-secret')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore this version' }));
    await user.click(await screen.findByRole('button', { name: 'Restore revision' }));
    await waitFor(() => expect(callMock.mock.calls.some(([op]) => op === 'historyRestore')).toBe(true));
  });

  it('moves a password into Trash and restores it with the short Undo action', async () => {
    const user = userEvent.setup(); renderApp();
    await screen.findByRole('heading', { name: 'GitHub' });
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to Trash' }));
    await user.click(await screen.findByRole('button', { name: 'Move to Trash' }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(active.some(item => item.id === 'login-1')).toBe(true));
    expect(trashed).toHaveLength(0);
  });
});
