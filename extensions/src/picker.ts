import browser, {Runtime} from 'webextension-polyfill';
const element=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const nonce=location.hash.slice(1);
const list=element('accounts'),status=element('status');
let nextOffset:number|null=null;
async function send(operation:string,data:Record<string,unknown>={}) {
  if(!/^[a-f0-9-]{36}$/.test(nonce))throw new Error('Focus a login field to open LocalVault.');
  const result=await browser.runtime.sendMessage({operation,nonce,...data}) as {ok:boolean;data:unknown;error:string};
  if(!result.ok)throw new Error(result.error);return result.data;
}
function unavailable(message:string) {list.replaceChildren();element('more').hidden=true;status.textContent=message;element('retry').hidden=false;}
async function run(action:()=>Promise<void>) {
  const buttons=Array.from(document.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);
  try{await action();}catch(error){unavailable(error instanceof Error?error.message:'Open the LocalVault desktop app.');}
  finally{buttons.forEach(b=>b.disabled=false);}
}
async function load(offset=0) {
  const view=await send('pickerView',{offset}) as {origin:string;locked?:boolean;accounts:{id:string;title:string;username:string}[];nextOffset:number|null};
  if(offset===0)list.replaceChildren();
  element('origin').textContent=view.origin;element('retry').hidden=true;
  if(view.locked) {
    status.textContent='Your vault is locked.';element('more').hidden=true;
    const unlock=document.createElement('button');unlock.className='primary';unlock.dataset.account='true';unlock.textContent='Unlock LocalVault';
    unlock.addEventListener('click',event=>{if(event.isTrusted)void run(async()=>{status.textContent='Confirm with Windows Hello, or unlock in the LocalVault window…';await send('pickerUnlock');await load();});});
    list.append(unlock);unlock.focus();return;
  }
  for(const account of view.accounts) {
    const button=document.createElement('button');button.className='account';button.dataset.account='true';
    // The username is what tells accounts apart; the site name is secondary (and the bold line when there is no username).
    const main=document.createElement('strong');main.textContent=account.username||account.title;
    button.append(main);
    if(account.username){const site=document.createElement('span');site.textContent=account.title;button.append(site);}
    button.addEventListener('click',event=>{if(event.isTrusted)void run(async()=>{await send('pickerFill',{entryId:account.id});list.replaceChildren();status.textContent='Filled. Review the form before submitting.';});});
    list.append(button);
  }
  status.textContent=list.childElementCount?'':'No saved accounts for this exact website. Add one in LocalVault.';
  nextOffset=view.nextOffset;element('more').hidden=nextOffset===null;
}
element('close').addEventListener('click',event=>{if(event.isTrusted)void send('pickerClose').catch(()=>{});});
element('more').addEventListener('click',event=>{if(event.isTrusted && nextOffset!==null)void run(()=>load(nextOffset!));});
element('retry').addEventListener('click',event=>{if(event.isTrusted)void run(()=>load());});
document.addEventListener('keydown',event=>{
  if(!event.isTrusted)return;
  if(event.key==='Escape'){event.preventDefault();void send('pickerClose').catch(()=>{});}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
    const buttons=Array.from(document.querySelectorAll<HTMLButtonElement>('[data-account]'));if(!buttons.length)return;
    event.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]!.focus();
  }
});
window.addEventListener('focus',()=>{if(document.activeElement===document.body)document.querySelector<HTMLButtonElement>('[data-account]')?.focus();});
browser.runtime.onMessage.addListener((message:unknown,sender:Runtime.MessageSender)=>{
  if(sender.id===browser.runtime.id && !sender.tab && (message as {operation?:string})?.operation==='pickerUnavailable')
    unavailable('Open LocalVault to reconnect. Then try again.');
});
void run(()=>load());
