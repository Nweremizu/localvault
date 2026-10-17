import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {fields,capture,fill,visible,loginTarget} from '../test-built/forms.js';
import {httpsOrigin,sameDocument,validCapture} from '../test-built/security.js';
function dom(html) {
  const page=new JSDOM(html,{url:'https://example.com/login',pretendToBeVisual:true});
  Object.assign(globalThis,{window:page.window,document:page.window.document,HTMLInputElement:page.window.HTMLInputElement,ShadowRoot:page.window.ShadowRoot,Event:page.window.Event,getComputedStyle:page.window.getComputedStyle,innerWidth:1024,innerHeight:768});
  for(const input of document.querySelectorAll('input')){
    input.getClientRects=()=>[{x:10,y:10,width:200,height:30}];
    input.getBoundingClientRect=()=>({left:10,top:10,right:210,bottom:40,width:200,height:30});
  }
  return document;
}
test('exact origins include scheme, IDN and port',()=>{
  assert.equal(httpsOrigin('https://EXAMPLE.com:443/path'),'https://example.com');
  assert.equal(httpsOrigin('https://bücher.example:8443'),'https://xn--bcher-kva.example:8443');
  assert.notEqual(httpsOrigin('https://example.com.evil.test'),httpsOrigin('https://example.com'));
  for(const value of ['http://example.com','https://user:pass@example.com','data:text/html,hi'])assert.throws(()=>httpsOrigin(value));
});
test('reject stale document, origin or active tab',()=>{
  const expected={tabId:1,origin:'https://example.com',document:'first'};
  assert.equal(sameDocument(expected,{...expected}),true);
  for(const altered of [{tabId:2},{origin:'https://evil.test'},{document:'second'}])assert.equal(sameDocument(expected,{...expected,...altered}),false);
});
test('fill visible login fields and emit input events without submitting',()=>{
  const root=dom('<form><input autocomplete="username"><input type="password" autocomplete="current-password"></form>');
  let inputs=0,submits=0;root.addEventListener('input',()=>inputs++);root.addEventListener('submit',()=>submits++);
  assert.equal(fill(root,'alice','secret'),true);assert.equal(root.querySelector('input').value,'alice');
  assert.equal(root.querySelector('[type=password]').value,'secret');assert.equal(inputs,2);assert.equal(submits,0);
});
test('reject hidden, disabled, read-only and offscreen fields',()=>{
  const root=dom('<form><input type="password" id="p"></form>');const p=root.querySelector('input');
  for(const attribute of ['hidden','disabled','readonly']){p.setAttribute(attribute,'');assert.equal(visible(p),false);p.removeAttribute(attribute);}
  p.style.opacity='0';assert.equal(visible(p),false);p.style.opacity='1';
  p.parentElement.style.opacity='0';assert.equal(fill(root,'user','secret'),false);p.parentElement.style.opacity='1';
  p.getBoundingClientRect=()=>({left:-2000,right:-1800,top:0,bottom:30,width:200,height:30});assert.equal(visible(p),false);
});
test('avoid ambiguous password targets and signup filling',()=>{
  let root=dom('<input type=password><input type=password>');assert.equal(fill(root,'user','secret'),false);
  root=dom('<input autocomplete=username><input type=password autocomplete=new-password>');assert.equal(fill(root,'user','secret'),false);
});
test('capture signup and change password with new-password autocomplete',()=>{
  const root=dom('<form><input autocomplete=username value=alice><input type=password autocomplete=current-password value=old><input type=password autocomplete=new-password value=new><input type=password autocomplete=new-password value=new></form>');
  assert.deepEqual(capture(root),{username:'alice',password:'new'});
  root.querySelectorAll('[autocomplete=new-password]')[1].value='mismatch';assert.equal(capture(root),null);
});
test('username-only multi-step login can be filled',()=>{
  const root=dom('<input type=email autocomplete=username>');assert.equal(fields(root).password,undefined);
  assert.equal(fill(root,'alice@example.com','unused'),true);assert.equal(root.querySelector('input').value,'alice@example.com');
});
test('capture conventional old/new/confirm fields without autocomplete',()=>{
  const root=dom('<input type=password value=old><input type=password value=new><input type=password value=new>');
  assert.equal(capture(root).password,'new');
  root.querySelectorAll('input')[2].value='different';assert.equal(capture(root),null);
});
test('recheck password field after page mutates during username event',()=>{
  const root=dom('<input autocomplete=username><input type=password autocomplete=current-password>');
  root.querySelector('input').addEventListener('input',()=>{root.querySelector('[type=password]').hidden=true;});
  assert.equal(fill(root,'alice','secret'),false);assert.equal(root.querySelector('[type=password]').value,'');
});
test('capture field size and types are bounded',()=>{
  const good={username:'u',password:'p',document:'12345678-1234-1234-1234-123456789012'};
  assert.equal(validCapture(good),true);assert.equal(validCapture({...good,password:'x'.repeat(16385)}),false);
  assert.equal(validCapture({...good,username:null}),false);
});

test('inline suggestions target login fields and explicit username steps, not search or signup',()=>{
  for(const html of ['<input type=email>','<input autocomplete=username>','<input name=login>','<input type=password autocomplete=current-password>']){
    const root=dom(html);assert.equal(loginTarget(root,root.querySelector('input')),true);
  }
  for(const html of ['<input name=q>','<input type=search>','<input autocomplete=username><input type=password autocomplete=new-password>','<input type=password><input type=password>']){
    const root=dom(html);assert.equal(loginTarget(root,root.querySelector('input')),false);
  }
});
test('username is found beside search boxes, extra text fields and multi-token autocomplete',()=>{
  let root=dom('<input type=search name=q><input placeholder="Search docs"><input name=first><input id=user autocomplete="username webauthn"><input type=password>');
  assert.equal(fields(root).username.id,'user');assert.equal(loginTarget(root,root.querySelector('#user')),true);
  assert.equal(loginTarget(root,root.querySelector('[name=q]')),false);
  root=dom('<input name=query><input name=nickname><input id=user name=x><input type=password>');
  assert.equal(fields(root).username.id,'user');assert.equal(loginTarget(root,root.querySelector('#user')),true);
});
test('login fields inside open shadow roots (web components) are detected and filled',()=>{
  const root=dom('<form><user-field></user-field><pass-field></pass-field></form>');
  const rect=input=>{input.getClientRects=()=>[{x:10,y:10,width:200,height:30}];input.getBoundingClientRect=()=>({left:10,top:10,right:210,bottom:40,width:200,height:30});return input;};
  const user=rect(Object.assign(document.createElement('input'),{name:'username'}));
  const pass=rect(Object.assign(document.createElement('input'),{type:'password'}));
  root.querySelector('user-field').attachShadow({mode:'open'}).append(user);
  root.querySelector('pass-field').attachShadow({mode:'open'}).append(pass);
  const form=root.querySelector('form');
  assert.equal(fields(form).username,user);assert.equal(fields(form).password,pass);
  assert.equal(loginTarget(form,user),true);
  assert.equal(fill(form,'alice','secret'),true);assert.equal(user.value,'alice');assert.equal(pass.value,'secret');
});
test('two-step login with a hidden password field still offers and fills the username step',()=>{
  const root=dom('<form><input id=user autocomplete="username webauthn"><input type=password id=pass style="display:none"></form>');
  const user=root.querySelector('#user');
  assert.equal(loginTarget(root,user),true);
  assert.equal(fill(root,'alice','secret'),true);assert.equal(user.value,'alice');assert.equal(root.querySelector('#pass').value,'');
});
