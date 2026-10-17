import browser, {Runtime} from 'webextension-polyfill';
import {httpsOrigin, sameDocument, validCapture} from './security';

type NativeResponse = {version:number;id:string;ok:boolean;error:string;data?:unknown};
type Pending = {username:string;password:string;origin:string;document:string;at:number;generation:number;ready?:boolean;entryId?:string;title?:string};
const pending = new Map<number,Pending>();
const usernames = new Map<number,{origin:string;value:string;at:number}>();
type Picker = {nonce:string;origin:string;document:string;at:number;frameId?:number};
const pickers = new Map<number,Picker>();
type SavePrompt = {nonce:string;origin:string;at:number;frameId?:number};
const savePrompts = new Map<number,SavePrompt>();
let port: Runtime.Port | undefined;
let locked = true;
let generation = -1;
let pairingCode = '';
let pairingAt = 0;
const waiting = new Map<string,{resolve:(value:NativeResponse)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();

function closePicker(tabId:number) {
  const item=pickers.get(tabId); pickers.delete(tabId);
  if(item) void browser.tabs.sendMessage(tabId,{operation:'dismissPicker',nonce:item.nonce},{frameId:0}).catch(()=>{});
}

function closeSave(tabId:number) {
  const item=savePrompts.get(tabId); savePrompts.delete(tabId);
  if(item) void browser.tabs.sendMessage(tabId,{operation:'dismissSave',nonce:item.nonce},{frameId:0}).catch(()=>{});
}
function dropPending(tabId:number) {
  pending.delete(tabId); closeSave(tabId); void browser.action.setBadgeText({tabId,text:''}).catch(() => {});
}
function clearPending() {
  for (const tabId of savePrompts.keys()) closeSave(tabId);
  for (const tabId of pending.keys()) void browser.action.setBadgeText({tabId,text:''}).catch(() => {});
  pending.clear(); usernames.clear(); void browser.action.setBadgeText({text:''});
}
function disconnected() {
  port = undefined; locked = true; clearPending();
  for(const [tabId,item] of pickers) if(item.frameId!==undefined)
    void browser.tabs.sendMessage(tabId,{operation:'pickerUnavailable'},{frameId:item.frameId}).catch(()=>{});
  for (const item of waiting.values()) { clearTimeout(item.timer); item.reject(new Error('Open LocalVault to connect.')); }
  waiting.clear();
}
function native(operation:string, data: Record<string,unknown> = {}): Promise<NativeResponse> {
  if (!port) {
    try {
      port = browser.runtime.connectNative('com.localvault.bridge');
      port.onDisconnect.addListener(disconnected);
      port.onMessage.addListener((value:unknown) => {
        if (!value || typeof value !== 'object') return;
        const response = value as NativeResponse;
        if (response.version !== 1 || typeof response.id !== 'string' || typeof response.ok !== 'boolean') return;
        const item = waiting.get(response.id); if (!item) return;
        clearTimeout(item.timer); waiting.delete(response.id); item.resolve(response);
      });
    } catch { return Promise.reject(new Error('Install and open the LocalVault desktop app.')); }
  }
  const id = crypto.randomUUID();
  return new Promise((resolve,reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error('Desktop request timed out.')); },operation==='pair'||operation==='save'||operation==='unlock'?120000:10000);
    waiting.set(id,{resolve,reject,timer});
    try { port!.postMessage({version:1,id,operation,...data}); }
    catch { clearTimeout(timer); waiting.delete(id); reject(new Error('Desktop app unavailable.')); }
  });
}
async function call(operation:string, data:Record<string,unknown> = {}):Promise<unknown> {
  const {token} = await browser.storage.local.get('token');
  const result = await native(operation,{...data,token:typeof token === 'string'?token:''});
  if (!result.ok) throw new Error(result.error || 'Desktop request failed.');
  return result.data;
}
async function status() {
  const value = await call('status') as {locked:boolean;generation:number};
  if (typeof value?.locked !== 'boolean' || !Number.isSafeInteger(value.generation)) throw new Error('Invalid desktop response.');
  if (value.locked || value.generation !== generation) clearPending();
  // Locking closes every picker; an unlock (often requested by a picker) leaves them open to load accounts.
  const unlocking = locked && !value.locked;
  if ((value.locked && !locked) || (generation!==-1 && value.generation!==generation && !unlocking))
    for(const tabId of pickers.keys()) closePicker(tabId);
  locked = value.locked; generation = value.generation; return value;
}
async function register() {
  const allowed = await browser.permissions.contains({origins:['https://*/*']});
  if (!allowed) return;
  const scripts = await browser.scripting.getRegisteredContentScripts();
  if (!scripts.some(s => s.id === 'localvault-forms'))
    await browser.scripting.registerContentScripts([{id:'localvault-forms',matches:['https://*/*'],js:['content.js'],runAt:'document_idle',allFrames:false,persistAcrossSessions:true}]);
}
void register().catch(() => {});
browser.runtime.onInstalled.addListener(() => {
  void (async()=>{
    await register();
    for(const tab of await browser.tabs.query({url:['https://*/*']}))
      if(tab.id!==undefined && !tab.incognito)
        await browser.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},files:['content.js']}).catch(()=>{});
  })().catch(()=>{});
});
browser.permissions.onAdded.addListener(() => { void register().catch(() => {}); });
browser.permissions.onRemoved.addListener(() => { clearPending(); for(const id of pickers.keys()) closePicker(id); void browser.scripting.unregisterContentScripts({ids:['localvault-forms']}).catch(() => {}); });
browser.tabs.onRemoved.addListener(id => { pending.delete(id); usernames.delete(id);pickers.delete(id);savePrompts.delete(id); });
browser.tabs.onUpdated.addListener((id,change) => {
  if(change.status==='loading' || change.url) closePicker(id);
  if (change.url) {
    try {
      const origin = httpsOrigin(change.url);
      if (origin !== usernames.get(id)?.origin) usernames.delete(id);
      if (origin !== pending.get(id)?.origin) { pending.delete(id); void browser.action.setBadgeText({tabId:id,text:''}); }
    }
    catch { usernames.delete(id);pending.delete(id);void browser.action.setBadgeText({tabId:id,text:''}); }
  }
});
setInterval(() => {
  for(const [id,item] of pickers) if(Date.now()-item.at>60000) closePicker(id);
  for (const [id,item] of pending) if (Date.now()-item.at > 120000) dropPending(id);
  for (const id of savePrompts.keys()) if (!pending.has(id)) closeSave(id);
  for (const [id,item] of usernames) if (Date.now()-item.at > 60000) usernames.delete(id);
  if (pending.size || usernames.size || pickers.size) void status().catch(() => { locked=true; clearPending(); });
},1000);

async function current() {
  const [tab] = await browser.tabs.query({active:true,lastFocusedWindow:true});
  if (tab?.id === undefined || tab.incognito) throw new Error('Open a regular HTTPS tab. Private browsing is not supported in this beta.');
  const origin = httpsOrigin(tab.url);
  if (!await browser.permissions.contains({origins:['https://*/*']})) throw new Error('Allow website access in the browser extension settings.');
  return {tabId:tab.id,origin};
}
async function probe(tabId:number,nonce?:string) {
  try { return await browser.tabs.sendMessage(tabId,{operation:'probe',nonce},{frameId:0}) as {document:string;origin:string;canFill:boolean}; }
  catch {
    await browser.scripting.executeScript({target:{tabId,frameIds:[0]},files:['content.js']});
    return await browser.tabs.sendMessage(tabId,{operation:'probe',nonce},{frameId:0}) as {document:string;origin:string;canFill:boolean};
  }
}
function popupSender(sender:Runtime.MessageSender) {
  return !sender.tab && sender.id === browser.runtime.id && sender.url === browser.runtime.getURL('popup.html');
}
async function fillSelected(tab:{tabId:number;origin:string}, entryId:unknown, picker?:Picker) {
  if(typeof entryId!=='string' || entryId.length>80) throw new Error('Choose an account.');
  const nonce=picker?.nonce;
  const before=await probe(tab.tabId,nonce);
  if(!before.canFill || before.origin!==tab.origin || (picker && before.document!==picker.document))
    throw new Error('Login fields changed or are unsupported. Use manual copy.');
  const expected={...tab,document:before.document};
  const credentials=await call('get',{origin:tab.origin,entryId}) as {username:string;password:string;generation:number};
  try {
    const after=await current();const documentAfter=await probe(after.tabId,nonce);
    if(!sameDocument(expected,{...after,document:documentAfter.document}) || documentAfter.origin!==after.origin || !documentAfter.canFill)
      throw new Error('Website changed. Select the account again.');
    const now=await status();
    if(now.locked || now.generation!==credentials.generation || (picker && pickers.get(tab.tabId)!==picker))
      throw new Error('Vault session changed. Try again.');
    const finalTab=await current();
    if(finalTab.tabId!==tab.tabId || finalTab.origin!==tab.origin) throw new Error('Active tab changed.');
    const result=await browser.tabs.sendMessage(tab.tabId,{operation:'fill',document:before.document,origin:tab.origin,nonce,username:credentials.username,password:credentials.password},{frameId:0}) as {filled:boolean};
    if(!result?.filled) throw new Error('Could not fill safely. Use manual copy.');
    return {filled:true};
  } finally { credentials.username='';credentials.password=''; }
}
async function pickerRequest(message:Record<string,unknown>,sender:Runtime.MessageSender) {
  const tabId=sender.tab?.id;
  const item=tabId===undefined?undefined:pickers.get(tabId);
  if(!item || sender.id!==browser.runtime.id || sender.url?.split('#')[0]!==browser.runtime.getURL('picker.html') ||
      sender.frameId===undefined || sender.frameId===0 || sender.tab?.incognito ||
      message.nonce!==item.nonce || Date.now()-item.at>60000 || (item.frameId!==undefined && item.frameId!==sender.frameId))
    throw new Error('This account picker expired. Focus the login field again.');
  const tab=await current();
  if(tab.tabId!==tabId || tab.origin!==item.origin || httpsOrigin(sender.tab?.url)!==item.origin) throw new Error('Website changed.');
  item.frameId=sender.frameId;
  if(message.operation==='pickerClose') { closePicker(tabId!);return {}; }
  const {token}=await browser.storage.local.get('token');
  if(!token) throw new Error('Pair this browser using the LocalVault toolbar button.');
  const state=await status();
  // Locked: the picker offers an Unlock button; the desktop then asks for Windows Hello (or shows its window).
  if(message.operation==='pickerUnlock') {
    if(state.locked) { await call('unlock'); await status(); }
    if(pickers.get(tabId!)!==item) throw new Error('The session changed. Focus the field again.');
    return {};
  }
  if(state.locked) {
    if(message.operation==='pickerView') return {origin:item.origin,locked:true,accounts:[],nextOffset:null};
    throw new Error('Vault locked. Choose Unlock first.');
  }
  if(pickers.get(tabId!)!==item) throw new Error('The session changed. Focus the field again.');
  if(message.operation==='pickerView') {
    const offset=message.offset??0;
    if(typeof offset!=='number' || !Number.isSafeInteger(offset) || offset<0 || offset>10000) throw new Error('Invalid account page.');
    const target=await probe(tab.tabId,item.nonce);
    if(!target.canFill || target.document!==item.document || target.origin!==item.origin) throw new Error('Login fields changed.');
    const page=await call('matches',{origin:item.origin,offset});
    const after=await current();
    if(after.tabId!==tabId || after.origin!==item.origin || pickers.get(tabId!)!==item) throw new Error('Website changed.');
    return {origin:item.origin,...page as object};
  }
  if(message.operation==='pickerFill') {
    const result=await fillSelected(tab,message.entryId,item);closePicker(tabId!);return result;
  }
  throw new Error('Unknown picker request.');
}
// Decide what the captured login means: already saved (stay quiet), a changed password (offer Update) or new (offer Save).
// ponytail: checks the first page (32) of accounts for this website; enough for real sites.
async function classify(tabId:number) {
  const item=pending.get(tabId); if(!item) return;
  const page=await call('matches',{origin:item.origin}) as {accounts:{id:string;title:string;username:string}[]};
  const same=page.accounts.find(a=>a.username===item.username);
  if(same) {
    const saved=await call('get',{origin:item.origin,entryId:same.id}) as {password:string};
    const unchanged=saved.password===item.password; saved.password='';
    if(pending.get(tabId)!==item) return;
    if(unchanged) { dropPending(tabId); return; }
    item.entryId=same.id; item.title=same.title;
  }
  if(pending.get(tabId)!==item) return;
  item.ready=true;
  // The form may have navigated already; the new page also asks for the prompt when it loads.
  void browser.tabs.sendMessage(tabId,{operation:'offerSave'},{frameId:0}).catch(()=>{});
}
async function saveRequest(message:Record<string,unknown>,sender:Runtime.MessageSender) {
  const tabId=sender.tab?.id;
  const prompt=tabId===undefined?undefined:savePrompts.get(tabId);
  if(!prompt || sender.id!==browser.runtime.id || sender.url?.split('#')[0]!==browser.runtime.getURL('save.html') ||
      sender.frameId===undefined || sender.frameId===0 || sender.tab?.incognito || message.nonce!==prompt.nonce ||
      (prompt.frameId!==undefined && prompt.frameId!==sender.frameId) || httpsOrigin(sender.tab?.url)!==prompt.origin)
    throw new Error('This prompt expired.');
  prompt.frameId=sender.frameId;
  const item=pending.get(tabId!);
  if(message.operation==='saveDismiss') { dropPending(tabId!); return {}; }
  if(!item || item.origin!==prompt.origin || Date.now()-item.at>=120000) { closeSave(tabId!); throw new Error('This prompt expired. Submit the form again.'); }
  if(message.operation==='saveView') return {origin:item.origin,username:item.username,update:Boolean(item.entryId),title:item.title??''};
  const state=await status();
  if(state.locked || item.generation!==generation) throw new Error('Vault locked. Unlock LocalVault and sign in again.');
  if(pending.get(tabId!)!==item) throw new Error('This prompt expired.');
  // An update still needs approval in the desktop app; a brand-new account saves directly.
  const result=await call('save',{origin:item.origin,username:item.username,password:item.password,entryId:item.entryId??null});
  dropPending(tabId!); return result;
}
async function dispatch(message:Record<string,unknown>, sender:Runtime.MessageSender):Promise<unknown> {
  if(typeof message.operation==='string' && ['pickerView','pickerFill','pickerClose','pickerUnlock'].includes(message.operation))
    return pickerRequest(message,sender);
  if(typeof message.operation==='string' && ['saveView','saveConfirm','saveDismiss'].includes(message.operation))
    return saveRequest(message,sender);
  if (sender.tab) {
    const tabId = sender.tab.id;
    if (tabId === undefined || sender.frameId !== 0 || sender.tab.incognito) throw new Error('Unsupported frame.');
    const origin = httpsOrigin(sender.url);
    if (httpsOrigin(sender.tab.url) !== origin) throw new Error('Website changed.');
    if (!await browser.permissions.contains({origins:['https://*/*']})) throw new Error('Website permission is missing.');
    if(message.operation==='saveOpen') {
      const item=pending.get(tabId);
      if(!item?.ready || item.origin!==origin || Date.now()-item.at>=120000 || item.generation!==generation) return {};
      closeSave(tabId);
      const nonce=crypto.randomUUID(); savePrompts.set(tabId,{nonce,origin,at:Date.now()});
      return {nonce};
    }
    if(message.operation==='inlineClose') {
      if(pickers.get(tabId)?.nonce===message.nonce) closePicker(tabId);
      return {};
    }
    if(message.operation==='inlineOpen') {
      if(typeof message.document!=='string' || message.document.length!==36) throw new Error('Invalid document.');
      const tab=await current(); const target=await probe(tabId);
      if(tab.tabId!==tabId || tab.origin!==origin || target.document!==message.document || target.origin!==origin || !target.canFill) throw new Error('Login field changed.');
      await status().catch(()=>{locked=true;});
      closePicker(tabId);
      const nonce=crypto.randomUUID();pickers.set(tabId,{nonce,origin,document:message.document,at:Date.now()});
      return {nonce};
    }
    if (message.operation === 'rememberUsername' && typeof message.username==='string' && message.username.length<=4096) {
      await status(); if (locked) return {};
      usernames.set(tabId,{origin,value:message.username,at:Date.now()}); return {};
    }
    if (message.operation !== 'capture' || !validCapture(message)) throw new Error('Invalid capture.');
    await status(); if (locked) return {};
    // Sender URL/frame identity is browser-supplied. A submit may already be navigating.
    const previous = usernames.get(tabId);
    const username = message.username || (previous?.origin===origin && Date.now()-previous.at<60000?previous.value:'');
    pending.set(tabId,{username,password:message.password,origin,document:message.document,at:Date.now(),generation});
    await browser.action.setBadgeBackgroundColor({tabId,color:'#386B59'});
    await browser.action.setBadgeText({tabId,text:'SAVE'});
    void classify(tabId).catch(()=>{}); return {};
  }
  if (!popupSender(sender)) throw new Error('Unknown extension context.');
  if (message.operation === 'pairCode') { pairingAt=Date.now();pairingCode=String(crypto.getRandomValues(new Uint32Array(1))[0]!%1000000).padStart(6,'0'); return {code:pairingCode}; }
  if (message.operation === 'pair') {
    if (!pairingCode || Date.now()-pairingAt>60000 || message.code!==pairingCode || typeof message.profile!=='string' || message.profile.length<1 || message.profile.length>80) throw new Error('Request a new pairing code with Refresh.');
    const code = pairingCode; pairingCode='';
    const response = await native('pair',{code,profile:message.profile});
    if (!response.ok) throw new Error(response.error);
    const data = response.data as {token:string};
    if (!/^[A-F0-9]{64}$/.test(data.token)) throw new Error('Invalid pairing response.');
    await browser.storage.local.set({token:data.token}); return {paired:true};
  }
  if (message.operation === 'forget') { await browser.storage.local.remove('token'); clearPending(); for(const id of pickers.keys()) closePicker(id); port?.disconnect(); return {}; }
  const state = await status();
  if (message.operation === 'status') return state;
  if (message.operation === 'unlock') { if (state.locked) { await call('unlock'); await status(); } return {}; }
  if (locked) throw new Error('Unlock the desktop vault first.');
  const tab = await current();
  if (message.operation === 'view') {
    const offset = message.offset ?? 0;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset<0 || offset>10000) throw new Error('Invalid account page.');
    const page = await call('matches',{origin:tab.origin,offset}) as {accounts:unknown[];nextOffset:number|null};
    const item = pending.get(tab.tabId);
    return {origin:tab.origin,...page,pending:item && Date.now()-item.at<120000?{username:item.username,origin:item.origin}:null};
  }
  if (message.operation === 'reject') { dropPending(tab.tabId); return {}; }
  if (message.operation === 'fill') {
    return fillSelected(tab,message.entryId);
  }
  if (message.operation === 'save') {
    const item = pending.get(tab.tabId);
    if(!item || item.origin!==tab.origin || item.generation!==generation || Date.now()-item.at>=120000) throw new Error('The save prompt expired. Submit the form again.');
    dropPending(tab.tabId);
    return await call('save',{origin:item.origin,username:item.username,password:item.password,entryId:typeof message.entryId==='string'&&message.entryId?message.entryId:null});
  }
  throw new Error('Unknown operation.');
}
browser.runtime.onMessage.addListener((message:unknown,sender:Runtime.MessageSender) => {
  if(!message || typeof message!=='object') return Promise.resolve({ok:false,error:'Invalid request.'});
  return dispatch(message as Record<string,unknown>,sender).then(data=>({ok:true,data}),error=>({ok:false,error:error instanceof Error?error.message:'Request failed.'}));
});
