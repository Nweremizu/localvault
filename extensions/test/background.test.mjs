import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/background.ts'],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'fake-browser',setup(b){b.onResolve({filter:/^webextension-polyfill$/},()=>({path:'fake',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export default globalThis.testBrowser;',loader:'js'}));}}]});
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);}});
function harness(){
  const storage={token:'A'.repeat(64)};let tab={id:1,url:'https://example.com/login',incognito:false};
  let document='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let locked=false,generation=1,canFill=true;
  const messages=[],requests=[],timers=[],badges=[];let onGet=()=>{};
  const native={onMessage:event(),onDisconnect:event(),postMessage(request){requests.push(request);queueMicrotask(()=>{
    let data={};
    if(request.operation==='status')data={locked,generation};
    if(request.operation==='matches')data={accounts:[{id:'entry-one',title:'Account',username:'alice'}],nextOffset:null};
    if(request.operation==='get'){data={username:'alice',password:'secret',generation};onGet();}
    if(request.operation==='pair')data={token:'B'.repeat(64)};
    if(request.operation==='unlock'){locked=false;generation++;data={locked:false,generation};}
    native.onMessage.listeners.forEach(fn=>fn({version:1,id:request.id,ok:true,error:'',data}));
  });},disconnect(){this.onDisconnect.listeners.forEach(fn=>fn());}};
  const browser={
    runtime:{id:'test-extension',getURL:(path)=> 'chrome-extension://test-extension/'+path,connectNative:()=>native,onMessage:event(),onInstalled:event()},
    storage:{local:{async get(key){return {[key]:storage[key]};},async set(value){Object.assign(storage,value);},async remove(key){delete storage[key];}}},
    action:{async setBadgeText(value){badges.push(value);},async setBadgeBackgroundColor(){}},
    permissions:{async contains(){return true;},onAdded:event(),onRemoved:event()},
    scripting:{async getRegisteredContentScripts(){return [{id:'localvault-forms'}];},async registerContentScripts(){},async unregisterContentScripts(){},async executeScript(){}},
    tabs:{async query(){return [{...tab}];},async sendMessage(id,message){if(message.operation==='probe')return {document,origin:new URL(tab.url).origin,canFill};messages.push({id,...message});return {filled:true};},onRemoved:event(),onUpdated:event()}
  };
  const context=vm.createContext({testBrowser:browser,crypto:webcrypto,URL,Map,Uint32Array,Date,Error,Number,String,Boolean,Promise,queueMicrotask,setTimeout,clearTimeout,setInterval(fn){timers.push(fn);}});
  vm.runInContext(bundle.outputFiles[0].text,context);
  const popup={id:'test-extension',url:'chrome-extension://test-extension/popup.html'};
  const sender={id:'test-extension',url:tab.url,tab:{...tab},frameId:0};
  const dispatch=(message,who=popup)=>browser.runtime.onMessage.listeners[0](message,who);
  return {dispatch,popup,sender,browser,storage,messages,requests,badges,
    picker(nonce,frameId=2){return {id:'test-extension',url:'chrome-extension://test-extension/picker.html#'+nonce,tab:{...tab},frameId};},
    saveFrame(nonce,frameId=3,page='save.html'){return {id:'test-extension',url:'chrome-extension://test-extension/'+page+'#'+nonce,tab:{...tab},frameId};},
    async settle(){for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));},
    hideTarget(){canFill=false;},
    navigate(url){tab={...tab,url};document='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';browser.tabs.onUpdated.listeners.forEach(fn=>fn(1,{url,status:'loading'}));},
    switchTab(){tab={...tab,id:2};},setLocked(value){locked=value;generation++;},onGet(fn){onGet=fn;},async tick(){for(const fn of timers)fn();await new Promise(resolve=>setImmediate(resolve));}
  };
}
test('content scripts cannot request credentials or impersonate popup',async()=>{
  const h=harness();const result=await h.dispatch({operation:'fill',entryId:'entry-one'},h.sender);
  assert.equal(result.ok,false);assert.equal(h.requests.length,0);
  assert.equal((await h.dispatch({operation:'fill',entryId:'entry-one'},{...h.popup,url:'https://evil.test'})).ok,false);
});
test('cross-origin frames and HTTP capture are rejected',async()=>{
  const h=harness();const capture={operation:'capture',username:'alice',password:'secret',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
  assert.equal((await h.dispatch(capture,{...h.sender,frameId:1})).ok,false);
  assert.equal((await h.dispatch(capture,{...h.sender,url:'http://example.com'})).ok,false);
  assert.equal((await h.dispatch(capture,{...h.sender,url:'https://evil.test'})).ok,false);
});
test('fill is bounded to selected account and document',async()=>{
  const h=harness();assert.equal((await h.dispatch({operation:'fill',entryId:'entry-one'})).ok,true);
  assert.equal(h.requests.filter(r=>r.operation==='get').length,1);
  assert.equal(h.messages[0].password,'secret');assert.equal(h.messages[0].document,'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.deepEqual(Object.keys(h.storage),['token']);
});
test('navigation and tab switch during credential request cancel filling',async()=>{
  for(const mutate of [h=>h.navigate('https://evil.test'),h=>h.navigate('https://example.com/other'),h=>h.switchTab()]) {
    const h=harness();h.onGet(()=>mutate(h));
    assert.equal((await h.dispatch({operation:'fill',entryId:'entry-one'})).ok,false);assert.equal(h.messages.length,0);
  }
});
test('lock/session change during credential request cancels filling',async()=>{
  const h=harness();h.onGet(()=>h.setLocked(true));
  assert.equal((await h.dispatch({operation:'fill',entryId:'entry-one'})).ok,false);assert.equal(h.messages.length,0);
});
test('pending passwords never reach browser storage and require explicit save',async()=>{
  const h=harness();const result=await h.dispatch({operation:'capture',username:'alice',password:'captured-secret',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  assert.equal(result.ok,true);assert.equal(h.requests.some(r=>r.operation==='save'),false);
  assert.equal((await h.dispatch({operation:'view'})).data.pending.username,'alice');
  assert.deepEqual(Object.keys(h.storage),['token']);
  await h.dispatch({operation:'reject'});assert.equal((await h.dispatch({operation:'view'})).data.pending,null);
});
test('same-origin redirect preserves save prompt; different origin clears it',async()=>{
  const h=harness();await h.dispatch({operation:'capture',username:'alice',password:'captured-secret',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  h.navigate('https://example.com/account');assert.equal((await h.dispatch({operation:'view'})).data.pending.username,'alice');
  assert.equal((await h.dispatch({operation:'save',entryId:''})).ok,true);
  assert.equal(h.requests.find(r=>r.operation==='save').origin,'https://example.com');
  await h.dispatch({operation:'capture',username:'alice',password:'captured-secret',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  h.navigate('https://other.example');assert.equal((await h.dispatch({operation:'view'})).data.pending,null);
});
test('locking clears captured credentials at next status check',async()=>{
  const h=harness();await h.dispatch({operation:'capture',username:'alice',password:'captured-secret',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  h.setLocked(true);await h.tick();h.setLocked(false);
  assert.equal((await h.dispatch({operation:'view'})).data.pending,null);
  assert.equal(h.badges.some(b=>b.tabId===1&&b.text===''),true);
});
test('pairing requests require a fresh popup-issued code',async()=>{
  const h=harness();assert.equal((await h.dispatch({operation:'pair',profile:'test',code:'123456'})).ok,false);
  const value=await h.dispatch({operation:'pairCode'});
  assert.equal((await h.dispatch({operation:'pair',profile:'test',code:value.data.code})).ok,true);
  assert.equal(h.storage.token,'B'.repeat(64));
  assert.equal((await h.dispatch({operation:'pair',profile:'test',code:value.data.code})).ok,false);
});

test('inline picker binds a nonce to the extension frame and returns no passwords',async()=>{
  const h=harness();
  const opened=await h.dispatch({operation:'inlineOpen',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  assert.equal(opened.ok,true);const nonce=opened.data.nonce;
  assert.equal((await h.dispatch({operation:'pickerView',nonce},h.sender)).ok,false);
  assert.equal((await h.dispatch({operation:'pickerView',nonce:'guessed'},h.picker(nonce))).ok,false);
  const view=await h.dispatch({operation:'pickerView',nonce},h.picker(nonce));
  assert.equal(view.ok,true);assert.equal(view.data.accounts[0].username,'alice');
  assert.equal(JSON.stringify(view).includes('secret'),false);
  assert.equal((await h.dispatch({operation:'pickerView',nonce},h.picker(nonce,3))).ok,false);
  assert.equal((await h.dispatch({operation:'pickerFill',nonce,entryId:'entry-one'},h.picker(nonce))).ok,true);
  const fills=h.messages.filter(m=>m.operation==='fill');
  assert.equal(fills.length,1);assert.equal(fills[0].nonce,nonce);
  assert.equal(fills[0].password,'secret');
  assert.equal((await h.dispatch({operation:'pickerFill',nonce,entryId:'entry-one'},h.picker(nonce))).ok,false);
  assert.deepEqual(Object.keys(h.storage),['token']);
});

test('inline picker rejects navigation, changed targets, locks and active tab changes',async()=>{
  for(const mutate of [h=>h.navigate('https://example.com/next'),h=>h.navigate('https://evil.test'),h=>h.hideTarget(),h=>h.setLocked(true),h=>h.switchTab()]){
    const h=harness();
    const {data:{nonce}}=await h.dispatch({operation:'inlineOpen',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
    const sender=h.picker(nonce);mutate(h);
    assert.equal((await h.dispatch({operation:'pickerFill',nonce,entryId:'entry-one'},sender)).ok,false);
    assert.equal(h.messages.filter(m=>m.operation==='fill').length,0);
  }
});

test('inline lock race cancels credential delivery; unpaired frame cannot retrieve accounts',async()=>{
  const h=harness();
  const {data:{nonce}}=await h.dispatch({operation:'inlineOpen',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  h.onGet(()=>h.setLocked(true));
  assert.equal((await h.dispatch({operation:'pickerFill',nonce,entryId:'entry-one'},h.picker(nonce))).ok,false);
  assert.equal(h.messages.filter(m=>m.operation==='fill').length,0);
  const other=harness();delete other.storage.token;
  const opened=await other.dispatch({operation:'inlineOpen',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},other.sender);
  assert.equal((await other.dispatch({operation:'pickerView',nonce:opened.data.nonce},other.picker(opened.data.nonce))).ok,false);
  assert.equal(other.requests.some(r=>r.operation==='matches'||r.operation==='get'),false);
});
test('save prompt stays quiet when the submitted password is already saved',async()=>{
  const h=harness();const document='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await h.dispatch({operation:'capture',username:'alice',password:'secret',document},h.sender);await h.settle();
  assert.equal(h.messages.some(m=>m.operation==='offerSave'),false);
  assert.equal((await h.dispatch({operation:'view'})).data.pending,null);
  assert.equal((await h.dispatch({operation:'saveOpen',document},h.sender)).data.nonce,undefined);
});
test('save prompt offers Save for a new account and Update for a changed password',async()=>{
  for(const [username,update,entryId] of [['bob',false,null],['alice',true,'entry-one']]) {
    const h=harness();const document='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await h.dispatch({operation:'capture',username,password:'brand-new-secret',document},h.sender);await h.settle();
    assert.equal(h.messages.some(m=>m.operation==='offerSave'),true);
    const {nonce}=(await h.dispatch({operation:'saveOpen',document},h.sender)).data;
    assert.match(nonce,/^[a-f0-9-]{36}$/);
    const view=(await h.dispatch({operation:'saveView',nonce},h.saveFrame(nonce))).data;
    assert.equal(view.update,update);assert.equal(view.username,username);assert.equal('password' in view,false);
    assert.equal((await h.dispatch({operation:'saveConfirm',nonce},h.saveFrame(nonce))).ok,true);
    const save=h.requests.find(r=>r.operation==='save');
    assert.equal(save.entryId,entryId);assert.equal(save.password,'brand-new-secret');assert.equal(save.origin,'https://example.com');
    assert.equal((await h.dispatch({operation:'view'})).data.pending,null);
  }
});
test('save prompt nonce only works from the extension save frame on the same website',async()=>{
  const h=harness();const document='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await h.dispatch({operation:'capture',username:'bob',password:'brand-new-secret',document},h.sender);await h.settle();
  const {nonce}=(await h.dispatch({operation:'saveOpen',document},h.sender)).data;
  assert.equal((await h.dispatch({operation:'saveConfirm',nonce},h.sender)).ok,false);
  assert.equal((await h.dispatch({operation:'saveConfirm',nonce},h.saveFrame(nonce,3,'picker.html'))).ok,false);
  assert.equal((await h.dispatch({operation:'saveConfirm',nonce:'00000000-0000-0000-0000-000000000000'},h.saveFrame(nonce))).ok,false);
  assert.equal((await h.dispatch({operation:'saveOpen',document},{...h.sender,url:'https://evil.test/'})).ok,false);
  assert.equal(h.requests.some(r=>r.operation==='save'),false);
});
test('locked vault: picker offers Unlock, stays open after unlocking and then lists accounts',async()=>{
  const h=harness();h.setLocked(true);
  const opened=await h.dispatch({operation:'inlineOpen',document:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},h.sender);
  const nonce=opened.data.nonce;
  const locked=await h.dispatch({operation:'pickerView',nonce},h.picker(nonce));
  assert.equal(locked.ok,true);assert.equal(locked.data.locked,true);assert.equal(locked.data.accounts.length,0);
  assert.equal((await h.dispatch({operation:'pickerFill',nonce,entryId:'entry-one'},h.picker(nonce))).ok,false);
  assert.equal(h.requests.some(r=>r.operation==='get'),false);
  assert.equal((await h.dispatch({operation:'pickerUnlock',nonce},h.picker(nonce))).ok,true);
  assert.equal(h.requests.filter(r=>r.operation==='unlock').length,1);
  const view=await h.dispatch({operation:'pickerView',nonce},h.picker(nonce));
  assert.equal(view.ok,true);assert.equal(view.data.accounts[0].username,'alice');
  assert.equal((await h.dispatch({operation:'pickerFill',nonce,entryId:'entry-one'},h.picker(nonce))).ok,true);
});
test('only the popup or a live picker frame can ask the desktop to unlock',async()=>{
  const h=harness();h.setLocked(true);
  assert.equal((await h.dispatch({operation:'unlock'},h.sender)).ok,false);
  assert.equal((await h.dispatch({operation:'pickerUnlock',nonce:'00000000-0000-0000-0000-000000000000'},h.picker('00000000-0000-0000-0000-000000000000'))).ok,false);
  assert.equal(h.requests.some(r=>r.operation==='unlock'),false);
  assert.equal((await h.dispatch({operation:'unlock'})).ok,true);
  assert.equal(h.requests.filter(r=>r.operation==='unlock').length,1);
});
