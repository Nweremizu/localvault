export function visible(input: HTMLInputElement): boolean {
  if (!input.isConnected || input.disabled || input.readOnly || input.type === 'hidden' || input.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const style = getComputedStyle(input);
  if (style.display === 'none' || style.visibility !== 'visible' || parseFloat(style.opacity) === 0 || input.getClientRects().length === 0) return false;
  for (let parent = parentAcrossShadow(input); parent; parent = parentAcrossShadow(parent)) {
    const parentStyle = getComputedStyle(parent);
    if (parentStyle.display === 'none' || parentStyle.visibility !== 'visible' || parseFloat(parentStyle.opacity) === 0) return false;
  }
  const bounds = input.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0 && bounds.right > 0 && bounds.bottom > 0 && bounds.left < innerWidth && bounds.top < innerHeight;
}

function parentAcrossShadow(element: Element): Element | null {
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/** Inputs under root in tree order, including those inside open shadow roots (web-component login forms). */
export function inputs(root: ParentNode): HTMLInputElement[] {
  const found: HTMLInputElement[] = [];
  const walk = (node: ParentNode) => {
    for (const element of Array.from(node.querySelectorAll('*'))) {
      if (element instanceof HTMLInputElement) found.push(element);
      if (element.shadowRoot) walk(element.shadowRoot);
    }
  };
  walk(root);
  return found;
}

/** The form that owns an input, looking through shadow-root boundaries; the whole document when there is none. */
export function formFor(input: Element): ParentNode {
  for (let element: Element | null = input; element;) {
    const form = element.closest('form');
    if (form) return form;
    const root = element.getRootNode();
    element = root instanceof ShadowRoot ? root.host : null;
  }
  return document;
}

/** The focused element, descending into open shadow roots. */
export function deepActive(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

const hasToken = (input: HTMLInputElement, ...tokens: string[]) => input.autocomplete.split(/\s+/).some(t => tokens.includes(t.toLowerCase()));
const describes = (input: HTMLInputElement, pattern: RegExp) =>
  pattern.test([input.name, input.id, input.placeholder, input.getAttribute('aria-label') ?? ''].join(' '));

export function fields(root: ParentNode): {username?:HTMLInputElement; password?:HTMLInputElement} {
  const all = inputs(root).filter(visible);
  const passwords = all.filter(i => i.type === 'password');
  const preferred = passwords.filter(i => hasToken(i, 'current-password'));
  const password = preferred.length === 1 ? preferred[0] : passwords.length === 1 && !hasToken(passwords[0]!, 'new-password') ? passwords[0] : undefined;
  // Search boxes and similar text fields elsewhere on the page are never the username.
  const usernames = all.filter(i => ['text','email','tel'].includes(i.type) && !describes(i, /search|query|filter|coupon|promo/i));
  const explicit = usernames.filter(i => hasToken(i, 'username', 'email'));
  let username = explicit.length === 1 ? explicit[0] : usernames.length === 1 ? usernames[0] : undefined;
  // Several text fields: the classic layout puts the username directly before the password.
  if (!username && password) username = usernames.filter(i => all.indexOf(i) < all.indexOf(password)).at(-1);
  return {username,password};
}

export function loginTarget(root:ParentNode,input:HTMLInputElement):boolean {
  if(!visible(input)) return false;
  const target=fields(root);
  if(target.password===input) return true;
  if(target.username!==input) return false;
  if(target.password) return true;
  // Only visible password fields count: two-step logins (X, Microsoft…) keep a hidden one in the form.
  if(inputs(root).some(i => i.type === 'password' && visible(i))) return false;
  return input.type==='email' || hasToken(input,'username','email') || describes(input,/user|email|login|account|identifier/i);
}

export function capture(root: ParentNode): {username:string; password:string} | null {
  const all = inputs(root).filter(visible);
  const passwords = all.filter(i => i.type === 'password' && i.value.length > 0);
  const newPasswords = passwords.filter(i => hasToken(i, 'new-password'));
  const chosen = newPasswords.length > 0 ? newPasswords :
    passwords.length === 3 && passwords[1]!.value === passwords[2]!.value ? passwords.slice(1) : passwords;
  if (!chosen[0] || !chosen.every(i => i.value === chosen[0]!.value)) return null;
  return {username: fields(root).username?.value ?? '', password:chosen[0].value};
}

export function fill(root: ParentNode, username: string, password: string): boolean {
  const target = fields(root);
  if (!target.password && !target.username) return false;
  if (!target.password && inputs(root).some(i => i.type === 'password' && visible(i))) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!;
  function put(input: HTMLInputElement, value:string) {
    setter.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true,composed:true})); input.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
  }
  if (target.username) put(target.username,username);
  if (target.password) {
    // Page event handlers may alter the form after the username is entered.
    if (!visible(target.password) || fields(root).password !== target.password) return false;
    put(target.password,password);
  }
  return true;
}
