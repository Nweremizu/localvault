import browser from 'webextension-polyfill';
// In-page "Save / Update password?" prompt. It runs in an extension frame, so the website cannot read or click it.
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nonce = location.hash.slice(1);
const status = element('status');
async function send(operation: string) {
  if (!/^[a-f0-9-]{36}$/.test(nonce)) throw new Error('This prompt expired.');
  const result = await browser.runtime.sendMessage({ operation, nonce }) as { ok: boolean; data: unknown; error: string };
  if (!result.ok) throw new Error(result.error); return result.data;
}
async function run(action: () => Promise<void>) {
  const buttons = Array.from(document.querySelectorAll('button')); buttons.forEach(b => b.disabled = true);
  try { await action(); } catch (error) { status.textContent = error instanceof Error ? error.message : 'Open the LocalVault desktop app.'; }
  finally { buttons.forEach(b => b.disabled = false); }
}
function strong(text: string) { const s = document.createElement('strong'); s.textContent = text; return s; }
void run(async () => {
  const view = await send('saveView') as { origin: string; username: string; update: boolean; title: string };
  const host = new URL(view.origin).host;
  element('title').textContent = view.update ? 'Update saved password?' : 'Save password?';
  element('save').textContent = view.update ? 'Update' : 'Save';
  element('detail').replaceChildren(...(view.update
    ? ['Replace the password for ', strong(view.username || '(no username)'), ' on ', strong(view.title || host), '. LocalVault will ask you to confirm.']
    : [strong(view.username || '(no username)'), ' on ', strong(host)]));
});
element('save').addEventListener('click', e => { if (e.isTrusted) void run(async () => { await send('saveConfirm'); }); });
for (const id of ['dismiss', 'close']) element(id).addEventListener('click', e => { if (e.isTrusted) void send('saveDismiss').catch(() => {}); });
document.addEventListener('keydown', e => { if (e.isTrusted && e.key === 'Escape') void send('saveDismiss').catch(() => {}); });
