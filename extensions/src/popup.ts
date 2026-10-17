import browser from 'webextension-polyfill';
const element = <T extends HTMLElement>(id:string) => document.getElementById(id) as T;
const status = element('status');
type Account={id:string;title:string;username:string};
type View={origin:string;accounts:Account[];nextOffset:number|null;pending:{username:string;origin:string}|null};
let nextOffset:number|null=null;
async function send(operation:string,data:Record<string,unknown>={}) {
  const result=await browser.runtime.sendMessage({operation,...data}) as {ok:boolean;data:unknown;error:string};
  if(!result.ok) throw new Error(result.error); return result.data;
}
async function run(action:()=>Promise<void>) {
  const buttons=Array.from(document.querySelectorAll('button')); buttons.forEach(b=>b.disabled=true);
  try { await action(); } catch(error) {status.textContent=error instanceof Error?error.message:'Connection unavailable. Open LocalVault.';}
  finally {buttons.forEach(b=>b.disabled=false);}
}
async function refresh() {
  element('accounts').hidden=true;element('pending').hidden=true;element('unlock').hidden=true;
  const allowed=await browser.permissions.contains({origins:['https://*/*']});element('permission').hidden=allowed;
  const {token}=await browser.storage.local.get('token');element('pairing').hidden=Boolean(token);
  if(!token) {const value=await send('pairCode') as {code:string};element('code').textContent=value.code;status.textContent='Pair this browser with your desktop vault.';return;}
  const state=await send('status') as {locked:boolean};
  if(state.locked) {status.textContent='Your vault is locked.';element('unlock').hidden=false;return;}
  if(!allowed) {status.textContent='Website access is restricted. Allow all HTTPS sites in the browser extension settings.';return;}
  const value=await send('view') as View;
  status.textContent='Choose an account to fill. Forms are never submitted automatically.';
  element('origin').textContent=value.origin;element('accounts').hidden=false;
  const list=element('account-list');list.replaceChildren();
  const replace=element<HTMLSelectElement>('replace');replace.replaceChildren(new Option('Save as a new account',''));
  append(value);
  element('empty').hidden=value.accounts.length>0;
  if(value.pending) {element('pending').hidden=false;element('pending-user').textContent=value.pending.username || '(no username captured)';}
}
function append(value:View) {
  const list=element('account-list');const replace=element<HTMLSelectElement>('replace');
  for(const account of value.accounts) {
    const button=document.createElement('button');button.className='account';button.textContent=account.username || account.title;
    if(account.username){const site=document.createElement('span');site.textContent=account.title;button.append(site);}
    button.addEventListener('click',()=>void run(async()=>{await send('fill',{entryId:account.id});status.textContent='Filled. Review the form before submitting.';}));list.append(button);
    replace.add(new Option(account.title+' — '+account.username,account.id));
  }
  nextOffset=value.nextOffset;element('more').hidden=nextOffset===null;
}
element('more').addEventListener('click',()=>void run(async()=>{if(nextOffset===null)return;const value=await send('view',{offset:nextOffset}) as View;if(value.origin!==element('origin').textContent){await refresh();return;}append(value);}));
element('pair').addEventListener('click',()=>void run(async()=>{status.textContent='Check the code and approve in the desktop app.';await send('pair',{profile:element<HTMLInputElement>('profile').value.trim(),code:element('code').textContent});await refresh();}));
element('unlock').addEventListener('click',()=>void run(async()=>{status.textContent='Confirm with Windows Hello, or unlock in the LocalVault window…';await send('unlock');await refresh();}));
element('forget').addEventListener('click',()=>void run(async()=>{await send('forget');await refresh();}));
element('refresh').addEventListener('click',()=>void run(refresh));
element('save').addEventListener('click',()=>void run(async()=>{status.textContent='Confirm the save in the desktop app.';await send('save',{entryId:element<HTMLSelectElement>('replace').value});await refresh();status.textContent='Password saved.';}));
element('reject').addEventListener('click',()=>void run(async()=>{await send('reject');await refresh();}));
void run(refresh);
