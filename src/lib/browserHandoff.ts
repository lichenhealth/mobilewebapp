import { supabase } from './supabase';

/** OPEN IN SAFARI OR CHROME, STILL SIGNED IN (founder 2026-11-26: "have the
 *  installed app on iPhone take you to the web version on either Safari or
 *  Chrome when the person wants to do always-on listening, so that it feels
 *  seamless"). The home-screen app can't listen (Apple's limit on installed
 *  web apps); the browser can, but keeps its own login — so a one-time code
 *  (voice-handoff, 3 minutes, single use) signs the browser in as you and
 *  lands you on the same screen with voice switched on. */

export function isIosHomeScreenApp(): boolean {
  if (typeof window === 'undefined') return false;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iOS && !!standalone;
}

export type HandoffBrowser = 'safari' | 'chrome';

/** `to` is an in-app path; `flags` ride along (voice=1, wake=1, hands=1). */
export async function openInBrowser(browser: HandoffBrowser, to: string, flags: Record<string, string> = {}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('voice-handoff', { body: { mode: 'mint' } });
  if (error || !data?.code) throw new Error('Couldn’t prepare the hand-off — try again.');
  const qs = new URLSearchParams({ c: data.code, to: to.startsWith('/') ? to : '/home', ...flags });
  const https = `${window.location.origin}/handoff?${qs}`;
  const bare = https.replace(/^https?:\/\//, '');
  // Safari's own scheme (iOS 17+) and Chrome's; if neither opens, the plain
  // link still leaves the app for the browser.
  window.location.href = browser === 'chrome' ? `googlechromes://${bare}` : `x-safari-https://${bare}`;
  window.setTimeout(() => { if (document.visibilityState === 'visible') window.open(https, '_blank'); }, 1400);
}
