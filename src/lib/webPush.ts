import { supabase } from './supabase';

// ─── Web Push (2026-07-22) ───────────────────────────────────────────────────
// Lock-screen notifications on the phone, even when Lichen is closed. A device
// subscribes once; the subscription lands in `push_subscriptions`. Every row
// inserted into `notifications` fans out to that member's subscribed devices via
// the send-push edge function (see the notifications → push trigger). So push
// rides the existing notify() — no per-feature wiring.
//
// iOS caveat: pushManager only works when Lichen is INSTALLED to the home screen
// (standalone display), iOS 16.4+. In plain Safari, subscribe() throws — we
// surface an "add to home screen" hint rather than an error.

// Client-safe VAPID public key (like the Supabase anon key; the private half is
// an edge secret). If this ever rotates, resubscribe every device.
const VAPID_PUBLIC_KEY = 'BOdgAopssAIrFZs7L6fKrGbSsZJtZNmSxi0mzEus-QW_t7B6I1ztnKRdl1xpwoBtKVUxW78IpZI3JRcwvOgRXfY';

export type PushState = 'unsupported' | 'denied' | 'off' | 'on';

/** Does this browser support the full Web Push stack? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** True on iOS Safari (where push needs the app added to the home screen). */
export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return iOS && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

/** Whether the PWA is running installed (standalone) — required for iOS push. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS-specific flag
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register the service worker (idempotent) and return an ACTIVE registration.
 *  iOS rejects pushManager.subscribe() on a worker that isn't active yet, so we
 *  wait for navigator.serviceWorker.ready rather than the bare registration. */
async function ready(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (!existing) await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;   // resolves only once a worker is active
}

/** Current push state for this device + this member. */
export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && (await reg.pushManager.getSubscription());
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

const subRow = (sub: PushSubscription, me: string) => {
  const json = sub.toJSON();
  return {
    profile_id: me,
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
    user_agent: navigator.userAgent.slice(0, 300),
  };
};

/** Turn push ON for this device: permission → subscribe → save. Throws with a
 *  human message the caller can show (iOS-not-installed, permission-denied…). */
export async function enablePush(me: string): Promise<void> {
  if (!pushSupported()) throw new Error('This browser can’t show push notifications.');
  if (isIosSafari() && !isStandalone()) {
    throw new Error('On iPhone, add Lichen to your Home Screen first (Share → Add to Home Screen), then open it from there.');
  }
  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Enable them in your browser settings to get phone alerts.');

  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(subRow(sub, me), { onConflict: 'endpoint' });
  if (error) throw error;
}

/** Turn push OFF for this device: unsubscribe + forget the subscription. */
export async function disablePush(me: string): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).eq('profile_id', me);
      await sub.unsubscribe();
    }
  } catch (e) {
    console.warn('disablePush:', (e as Error).message);
  }
}
