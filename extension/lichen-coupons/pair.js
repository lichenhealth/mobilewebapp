// Runs only on lichen.health. Lets the app know the extension is installed,
// and accepts the coupon key when the member presses "Connect this browser".
(() => {
  const say = (m) => window.postMessage({ source: 'lichen-ext', ...m }, window.location.origin);
  const hello = () => chrome.storage.local.get(['token', 'name']).then((s) => say({ type: 'hello', version: chrome.runtime.getManifest().version, connected: !!s.token, name: s.name || '' }));
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const d = e.data || {};
    if (d.source !== 'lichen-app') return;
    if (d.type === 'ping') hello();
    if (d.type === 'pair') chrome.runtime.sendMessage({ type: 'pair', token: d.token }, (r) => say({ type: 'paired', ok: !!r?.ok, error: r?.error || '' }));
  });
  hello();
})();
