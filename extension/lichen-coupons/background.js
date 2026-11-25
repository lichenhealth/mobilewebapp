// Lichen coupons — background worker.
// Keeps a copy of the member's coupons (refreshed every few hours) and, when
// the open tab is a store they hold a coupon for, lights the badge — and at
// checkout, rings one notification per store per day. Nothing about the tab
// is ever sent anywhere: the comparison happens right here.
import { API, APP, couponsFor, atCheckout, couponLine, todayIso } from './shared.js';

async function refresh() {
  const { token } = await chrome.storage.local.get('token');
  if (!token) { await chrome.storage.local.set({ coupons: [], name: '' }); return { ok: false }; }
  try {
    const r = await fetch(API, { headers: { 'x-lichen-ext': token } });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { await chrome.storage.local.set({ token: '', coupons: [], name: '', error: d.error || 'Disconnected.' }); return { ok: false, error: d.error }; }
    if (!r.ok) { await chrome.storage.local.set({ error: d.error || 'Lichen didn’t answer — will try again.' }); return { ok: false, error: d.error }; }
    await chrome.storage.local.set({ coupons: d.coupons || [], name: d.name || '', error: '', fetchedAt: Date.now() });
    return { ok: true };
  } catch {
    await chrome.storage.local.set({ error: 'Offline — showing the coupons saved earlier.' });
    return { ok: false };
  }
}

async function check(tabId, url) {
  if (!url) return;
  const { coupons = [], told = {} } = await chrome.storage.local.get(['coupons', 'told']);
  const hits = couponsFor(url, coupons);
  await chrome.action.setBadgeText({ tabId, text: hits.length ? String(hits.length) : '' });
  if (!hits.length) return;
  await chrome.action.setBadgeBackgroundColor({ tabId, color: '#C8643C' });
  if (!atCheckout(url)) return;
  const key = hits[0].merchant.toLowerCase() + '|' + todayIso();
  if (told[key]) return;
  told[key] = true;
  // keep the memory small: only today's
  for (const k of Object.keys(told)) if (!k.endsWith(todayIso())) delete told[k];
  await chrome.storage.local.set({ told });
  const c = hits[0];
  chrome.notifications.create('lichen-' + c.id, {
    type: 'basic',
    iconUrl: 'icons/icon-128.png',
    title: `You have a ${c.merchant} coupon`,
    message: (c.code ? `Code ${c.code} — ` : '') + couponLine(c),
    contextMessage: 'Click to copy it from Lichen',
    priority: 2,
  });
}

chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  try { await chrome.action.openPopup(); } catch { chrome.tabs.create({ url: APP + '/currentcy#coupons' }); }
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === 'complete' || info.url) void check(tabId, tab.url); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { const t = await chrome.tabs.get(tabId).catch(() => null); if (t) void check(tabId, t.url); });

chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'refresh') void refresh(); });
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('refresh', { periodInMinutes: 180 }); void refresh(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('refresh', { periodInMinutes: 180 }); void refresh(); });

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'pair' && /^lx_[0-9a-f]{48}$/.test(msg.token || '')) {
    chrome.storage.local.set({ token: msg.token, error: '' }).then(refresh).then(reply);
    return true;
  }
  if (msg?.type === 'refresh') { refresh().then(reply); return true; }
  if (msg?.type === 'unpair') { chrome.storage.local.set({ token: '', coupons: [], name: '' }).then(() => reply({ ok: true })); return true; }
  return false;
});
