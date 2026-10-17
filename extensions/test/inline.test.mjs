import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {webcrypto} from 'node:crypto';
const bundle=await build({entryPoints:['src/content.ts'],bundle:true,write:false,format:'iife',platform:'browser',plugins:[{name:'fake-browser',setup(b){b.onResolve({filter:/^webextension-polyfill$/},()=>({path:'fake',namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export default globalThis.testBrowser;',loader:'js'}));}}]});
function page({autofocus=false}={}){
  const dom=new JSDOM('<form id="login"><input autocomplete="username"><input type="password"></form><form id="other"><input type="password"></form>',{url:'https://example.com/login',pretendToBeVisual:true,runScripts:'outside-only'});
  const w=dom.window;const listeners=[],requests=[];let shadow;
  Object.defineProperty(w.crypto,'randomUUID',{value:()=>webcrypto.randomUUID()});
  const original=w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow=function(options){shadow=original.call(this,options);return shadow;};
  for(const input of w.document.querySelectorAll('input')){
    input.getClientRects=()=>[{width:240,height:36}];
    input.getBoundingClientRect=()=>({left:20,top:20,right:260,bottom:56,width:240,height:36});
  }
  if(autofocus)w.document.querySelector('#login input').focus();
  const nonce=webcrypto.randomUUID();
  w.testBrowser={runtime:{getURL:path=>'chrome-extension://test/'+path,onMessage:{addListener:fn=>listeners.push(fn)},async sendMessage(message){requests.push(message);return {ok:true,data:{nonce}};}}};
  w.eval(bundle.outputFiles[0].text);
  return {w,nonce,requests,get shadow(){return shadow;},async focus(){w.document.querySelector('#login input').focus();await new Promise(resolve=>setImmediate(resolve));},message:item=>listeners[0](item),close:()=>w.close()};
}
test('inline host hides its extension frame and keeps a selected form bound across iframe focus',async()=>{
  const p=page();
  try{
    await p.focus();
    const frame=p.shadow.querySelector('iframe');
    assert.ok(frame);assert.equal(p.w.document.querySelector('iframe'),null);
    assert.equal(p.shadow.host.shadowRoot,null);
    assert.equal(frame.title,'LocalVault matching accounts');
    const probe=await p.message({operation:'probe',nonce:p.nonce});
    assert.equal(probe.canFill,true);
    frame.focus();
    let submits=0;p.w.document.addEventListener('submit',()=>submits++);
    const result=await p.message({operation:'fill',nonce:p.nonce,document:probe.document,origin:probe.origin,username:'alice',password:'secret'});
    assert.equal(result.filled,true);
    assert.equal(p.w.document.querySelector('#login [type=password]').value,'secret');
    assert.equal(p.w.document.querySelector('#other [type=password]').value,'');
    assert.equal(submits,0);assert.equal(p.shadow.host.isConnected,false);
  }finally{p.close();}
});
test('inline content rejects guessed sessions and replaced or hidden focused fields',async()=>{
  const p=page();
  try{
    await p.focus();
    const probe=await p.message({operation:'probe',nonce:p.nonce});
    assert.equal((await p.message({operation:'probe',nonce:'guessed'})).canFill,false);
    p.w.document.querySelector('#login input').remove();
    const result=await p.message({operation:'fill',nonce:p.nonce,document:probe.document,origin:probe.origin,username:'alice',password:'secret'});
    assert.equal(result.filled,false);
    assert.equal(p.w.document.querySelector('#login [type=password]').value,'');
  }finally{p.close();}
});
test('dismissal restores input focus without reopening; unrelated inputs dismiss the picker',async()=>{
  const p=page();
  try{
    await p.focus();const input=p.w.document.querySelector('#login input');
    p.shadow.querySelector('iframe').focus();
    await p.message({operation:'dismissPicker',nonce:p.nonce});
    assert.equal(p.w.document.activeElement,input);assert.equal(p.shadow.host.isConnected,false);
    input.blur();await p.focus();
    const other=p.w.document.createElement('input');other.type='search';p.w.document.body.append(other);other.focus();
    assert.equal(p.shadow.host.isConnected,false);
  }finally{p.close();}
});
test('a login field focused before the extension loads gets the picker straight away',async()=>{
  const p=page({autofocus:true});
  try{
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(p.requests.some(r=>r.operation==='inlineOpen'));
    assert.equal(p.shadow?.querySelector('iframe')?.title,'LocalVault matching accounts');
  }finally{p.close();}
});
