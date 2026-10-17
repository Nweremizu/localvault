// LocalVault website. Two live fragments of the product, plus entrances. Everything works without this file:
// the picker is shown open and the breach readout shows the hash of "password".
document.documentElement.classList.add('js');
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add('loaded')));

// ---- Hero: the extension's account picker on a sample sign-in form --------------------------------------
{
  const user = document.getElementById('demo-user');
  const pass = document.getElementById('demo-pass');
  const picker = document.getElementById('demo-picker');
  const hint = document.getElementById('demo-hint');
  const accounts = [...picker.querySelectorAll('.picker-account')];
  const open = () => { picker.hidden = false; user.setAttribute('aria-expanded', 'true'); };
  const close = () => { picker.hidden = true; user.setAttribute('aria-expanded', 'false'); };
  user.addEventListener('focus', open);
  user.addEventListener('click', open);
  user.addEventListener('input', () => { pass.value = ''; hint.textContent = 'Pick an account, or keep typing.'; });
  user.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && !picker.hidden) { e.preventDefault(); accounts[0].focus(); }
    if (e.key === 'Escape') close();
  });
  picker.addEventListener('keydown', e => {
    const index = accounts.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      accounts[(index + (e.key === 'ArrowDown' ? 1 : -1) + accounts.length) % accounts.length].focus();
    }
    if (e.key === 'Escape') { close(); user.focus({ preventScroll: true }); close(); }
  });
  for (const account of accounts) account.addEventListener('click', () => {
    user.value = account.dataset.user;
    pass.value = 'sample-password-not-real';
    close();
    hint.textContent = 'Filled. Review the form before submitting: LocalVault never submits for you.';
  });
  picker.querySelector('.picker-close').addEventListener('click', () => { close(); hint.textContent = 'Click the field again to reopen LocalVault.'; });
  document.addEventListener('pointerdown', e => { if (!picker.hidden && !e.target.closest('.field-wrap')) close(); });
}

// ---- Breach check: the SHA-1 hash, worked out in this page; only its first five characters would be sent --
{
  const section = document.getElementById('breach');
  const input = document.getElementById('breach-input');
  const sent = section.querySelector('[data-hash-sent]');
  const kept = section.querySelector('[data-hash-kept]');
  const word = section.querySelector('[data-breach-word]');
  let request = 0;
  async function update() {
    const value = input.value;
    const mine = ++request;
    if (!value) { sent.textContent = '·····'; kept.textContent = ''; word.textContent = 'Five characters leave'; section.dataset.state = 'idle'; return; }
    if (!crypto.subtle) return; // insecure context: keep the static example
    const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
    if (mine !== request) return;
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    sent.textContent = hex.slice(0, 5); kept.textContent = hex.slice(5);
    const typed = value !== 'password';
    section.dataset.state = typed ? 'typed' : 'idle';
    word.textContent = typed ? `Only ${hex.slice(0, 5)} leaves` : 'Five characters leave';
  }
  input.addEventListener('input', update);
}

// ---- Entrances: each section's parts rise in turn, once ---------------------------------------------------
{
  const blocks = document.querySelectorAll('.reveal');
  for (const block of blocks) {
    if (!block.children.length || block.matches('.exchange, .inside-picture, .inside-note, h2')) block.classList.add('solo');
    [...block.children].forEach((child, i) => child.style.setProperty('--i', String(i)));
  }
  const show = entries => entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('in'); observer.unobserve(entry.target); } });
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(show, { rootMargin: '0px 0px -12% 0px' }) : null;
  blocks.forEach(block => observer ? observer.observe(block) : block.classList.add('in'));
}
