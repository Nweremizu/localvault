import browser from 'webextension-polyfill';
import {capture, deepActive, fields, fill, formFor, inputs, loginTarget, visible} from './forms';
import {httpsOrigin} from './security';

if (window.top === window && location.protocol === 'https:') {
  const marker = '__localVaultContentInstalled';
  const scope = globalThis as unknown as Record<string, unknown>;
  if (!scope[marker]) { scope[marker] = true; install(); }
}
function install() {
  const documentId = crypto.randomUUID();
  let lastSubmission = '';
  let lastAt = 0;
  // The real target inside web components (events are retargeted to the shadow host).
  const targetOf = (event: Event) => event.composedPath()[0];
  const rootFor = (event?: Event): ParentNode => {
    const target = event ? targetOf(event) : null;
    const active = target instanceof Element ? target : deepActive();
    const form = active ? formFor(active) : document;
    if (form !== document) return form;
    const forms = Array.from(document.forms).filter(f => fields(f).password || fields(f).username);
    return forms.length === 1 ? forms[0]! : document;
  };
  let opening=0;
  let pendingOpen:Promise<unknown>=Promise.resolve();
  let restoringFocus=false;
  let picker:{nonce:string;input:HTMLInputElement;root:ParentNode;host:HTMLElement;frame:HTMLIFrameElement;timer:ReturnType<typeof setInterval>;expires:ReturnType<typeof setTimeout>}|undefined;
  const validPicker=()=>Boolean(picker && visible(picker.input) && loginTarget(picker.root,picker.input) &&
    formFor(picker.input)===picker.root && document.visibilityState==='visible' &&
    (deepActive()===picker.input || document.activeElement===picker.host));
  function dismiss(notify=true,restoreFocus=false) {
    opening++;
    const old=picker;picker=undefined;
    if(!old)return;
    clearInterval(old.timer);clearTimeout(old.expires);old.host.remove();
    if(restoreFocus && visible(old.input)){restoringFocus=true;old.input.focus({preventScroll:true});restoringFocus=false;}
    if(notify)void browser.runtime.sendMessage({operation:'inlineClose',nonce:old.nonce}).catch(()=>{});
  }
  function position() {
    if(!picker)return;
    if(!validPicker()){dismiss();return;}
    const bounds=picker.input.getBoundingClientRect();
    const width=Math.min(360,innerWidth-16);
    const height=Math.min(232,innerHeight-16);
    const below=innerHeight-bounds.bottom-8;
    const top=below>=Math.min(180,height)?bounds.bottom+5:Math.max(8,bounds.top-height-5);
    picker.host.style.setProperty('left',Math.max(8,Math.min(bounds.left,innerWidth-width-8))+'px','important');
    picker.host.style.setProperty('top',Math.min(top,innerHeight-height-8)+'px','important');
    picker.host.style.setProperty('width',width+'px','important');
    picker.host.style.setProperty('height',Math.min(height,top===bounds.bottom+5?below:height)+'px','important');
  }
  async function show(input:HTMLInputElement) {
    const root=formFor(input);
    if(!loginTarget(root,input)){dismiss();return;}
    if(picker?.input===input && validPicker())return;
    dismiss();
    const request=++opening;
    try {
      pendingOpen=pendingOpen.catch(()=>{}).then(()=>request===opening?browser.runtime.sendMessage({operation:'inlineOpen',document:documentId}):undefined);
      const response=await pendingOpen as {ok:boolean;data?:{nonce:string}}|undefined;
      if(!response)return;
      const nonce=response.data?.nonce;
      if(!response.ok || typeof nonce!=='string')return;
      if(request!==opening || deepActive()!==input || !loginTarget(root,input)) {
        void browser.runtime.sendMessage({operation:'inlineClose',nonce}).catch(()=>{});return;
      }
      const host=document.createElement('div');
      host.style.cssText='all:initial!important;position:fixed!important;display:block!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;';
      const shadow=host.attachShadow({mode:'closed'});
      const frame=document.createElement('iframe');
      frame.title='LocalVault matching accounts';frame.src=browser.runtime.getURL('picker.html')+'#'+nonce;
      frame.style.cssText='display:block;width:100%;height:100%;border:0;border-radius:12px;box-shadow:0 0 0 1px #0000000f,0 12px 32px -8px #0000004d;background:transparent;color-scheme:normal;';
      shadow.append(frame);
      // Keep the nonce and extension frame out of the page's DOM tree.
      host.popover='manual';document.documentElement.append(host);
      if(typeof host.showPopover==='function')host.showPopover();
      picker={nonce,input,root,host,frame,timer:setInterval(position,250),expires:setTimeout(()=>dismiss(),60000)};
      position();
    } catch { if(request===opening)dismiss(); }
  }
  document.addEventListener('focusin',event=>{
    if(restoringFocus)return;
    if(event.target===picker?.host)return;
    const target=targetOf(event);
    if(target instanceof HTMLInputElement && event.isTrusted)void show(target);
    else dismiss();
  },true);
  document.addEventListener('click',event=>{
    const target=targetOf(event);
    if(event.isTrusted && target instanceof HTMLInputElement)void show(target);
  },true);
  document.addEventListener('pointerdown',event=>{
    if(picker && event.target!==picker.host && targetOf(event)!==picker.input)dismiss();
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')dismiss();
    if(event.key==='ArrowDown' && picker && targetOf(event)===picker.input){event.preventDefault();picker.frame.focus();}
  },true);
  window.addEventListener('scroll',position,true);window.addEventListener('resize',position);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')dismiss();});
  window.addEventListener('pagehide',()=>dismiss());
  function submitted(event: Event) {
    if (!event.isTrusted) return;
    const root = rootFor(event);
    const item = capture(root);
    if (!item) {
      const user = fields(root).username?.value;
      if (user) void browser.runtime.sendMessage({operation:'rememberUsername', username:user, document:documentId}).catch(() => {});
      return;
    }
    if (item.password.length > 16384 || item.username.length > 4096) return;
    const signature = item.username + '\0' + item.password;
    if (signature === lastSubmission && Date.now() - lastAt < 2000) return;
    lastSubmission = signature; lastAt = Date.now();
    void browser.runtime.sendMessage({operation:'capture',...item,document:documentId}).catch(() => {});
    setTimeout(() => { lastSubmission = ''; },2000);
  }
  document.addEventListener('submit',submitted,true);
  document.addEventListener('click',event => {
    const target = event.target instanceof Element ? event.target.closest('button,input[type="submit"]') : null;
    if (target && (target instanceof HTMLButtonElement ? target.type === 'submit' || !target.form : true)) submitted(event);
  },true);
  document.addEventListener('keydown',event => { if (event.key === 'Enter' && targetOf(event) instanceof HTMLInputElement) submitted(event); },true);
  // Login pages often focus the username box before this script runs; offer accounts for it straight away.
  const focused = deepActive();
  if (focused instanceof HTMLInputElement && document.hasFocus()) void show(focused);

  // "Save / Update password?" banner, top-right like the browser's own prompt. It lives in a closed shadow root.
  let banner:{nonce:string;host:HTMLElement}|undefined;
  function closeBanner() { banner?.host.remove(); banner=undefined; }
  async function offerSave() {
    const response=await browser.runtime.sendMessage({operation:'saveOpen',document:documentId}) as {ok:boolean;data?:{nonce?:string}};
    const nonce=response?.ok?response.data?.nonce:undefined;
    if(typeof nonce!=='string' || !/^[a-f0-9-]{36}$/.test(nonce))return;
    closeBanner();
    const host=document.createElement('div');
    host.style.cssText='all:initial!important;position:fixed!important;display:block!important;top:12px!important;right:12px!important;width:min(340px,calc(100vw - 24px))!important;height:136px!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;z-index:2147483647!important;';
    const shadow=host.attachShadow({mode:'closed'});
    const frame=document.createElement('iframe');
    frame.title='LocalVault: save password';frame.src=browser.runtime.getURL('save.html')+'#'+nonce;
    frame.style.cssText='display:block;width:100%;height:100%;border:0;border-radius:12px;box-shadow:0 0 0 1px #0000000f,0 12px 32px -8px #0000004d;background:transparent;color-scheme:normal;';
    shadow.append(frame);
    host.popover='manual';document.documentElement.append(host);
    if(typeof host.showPopover==='function')host.showPopover();
    banner={nonce,host};
  }
  void offerSave().catch(()=>{});

  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object') return undefined;
    const item = message as Record<string,unknown>;
    if(item.operation==='offerSave'){void offerSave().catch(()=>{});return Promise.resolve({});}
    if(item.operation==='dismissSave' && item.nonce===banner?.nonce){closeBanner();return Promise.resolve({});}
    if(item.operation==='dismissPicker' && item.nonce===picker?.nonce){dismiss(false,true);return Promise.resolve({});}
    const bound=item.nonce!==undefined;
    const root=bound?(item.nonce===picker?.nonce && validPicker()?picker?.root:undefined):rootFor();
    if (item.operation === 'probe') {
      const inputs=root?fields(root):{};
      return Promise.resolve({document:documentId,origin:httpsOrigin(location.href),canFill:Boolean(root && (inputs.username || inputs.password))});
    }
    if (item.operation === 'fill' && item.document === documentId && item.origin === httpsOrigin(location.href) &&
        typeof item.username === 'string' && item.username.length <=4096 && typeof item.password === 'string' && item.password.length <=16384 && document.visibilityState === 'visible')
      { const filled=Boolean(root && fill(root,item.username,item.password));if(filled)dismiss(true,true);return Promise.resolve({filled}); }
    return undefined;
  });
}
