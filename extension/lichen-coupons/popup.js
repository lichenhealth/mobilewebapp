import { APP, couponsFor, couponLine, live } from './shared.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function card(c, here) {
  const box = el('div', 'c' + (here ? ' here' : ''));
  box.append(el('span', 'm', c.merchant), el('span', 'o', couponLine(c)));
  if (c.code) {
    const b = el('button', 'code');
    const label = el('span', null, 'Copy');
    b.append(el('span', null, c.code), label);
    b.onclick = async () => { await navigator.clipboard.writeText(c.code); label.textContent = 'Copied ✓'; setTimeout(() => (label.textContent = 'Copy'), 2000); };
    box.append(b);
  } else box.append(el('span', 't', 'No code — show the coupon or it applies at checkout.'));
  if (c.terms) box.append(el('span', 't', c.terms));
  return box;
}

async function render() {
  const s = await chrome.storage.local.get(['token', 'coupons', 'name', 'error']);
  const main = $('main'); const foot = $('foot');
  main.replaceChildren(); foot.replaceChildren();
  if (!s.token) {
    $('who').textContent = '';
    main.append(
      el('p', null, 'Connect this browser to Lichen and it will show your coupon codes when you shop at those stores.'),
      el('p', 't', 'Which sites you visit never leaves this browser — the extension only downloads your coupon list.'),
    );
    if (s.error) main.append(el('p', 'err', s.error));
    const a = el('a', 'go', 'Connect in Lichen ›'); a.href = APP + '/profile#connections'; a.target = '_blank';
    main.append(a);
    return;
  }
  $('who').textContent = s.name ? s.name : '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const all = (s.coupons || []).filter(live);
  const here = couponsFor(tab?.url || '', all);
  if (here.length) { main.append(el('h2', null, 'Works on this site')); here.forEach((c) => main.append(card(c, true))); }
  const rest = all.filter((c) => !here.includes(c));
  if (rest.length) { main.append(el('h2', null, here.length ? 'Your other coupons' : 'Your coupons')); rest.forEach((c) => main.append(card(c, false))); }
  if (!all.length) main.append(el('p', null, 'No coupons saved yet. Snap one in Lichen → Current-cy → Coupons.'));
  if (s.error) main.append(el('p', 'err', s.error));
  const add = el('a', null, 'Add a coupon'); add.href = APP + '/currentcy#coupons'; add.target = '_blank';
  const ref = el('button', null, 'Refresh'); ref.onclick = () => chrome.runtime.sendMessage({ type: 'refresh' }, render);
  const off = el('button', null, 'Disconnect'); off.onclick = () => chrome.runtime.sendMessage({ type: 'unpair' }, render);
  foot.append(add, ref, off);
}
render();
