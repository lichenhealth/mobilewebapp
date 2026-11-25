// THE LICHEN BROWSER EXTENSION (founder 2026-11-25). The extension holds one
// narrow key that reads only this member's coupons; the app mints it and
// hands it to the extension through window.postMessage (the extension's
// content script on lichen.health listens for it). Sites the member visits
// never leave their browser — matching happens inside the extension.
import { supabase } from './supabase';

export type ExtensionToken = { id: string; label: string | null; created_at: string; last_used_at: string | null };
export type ExtensionPresence = { installed: boolean; connected: boolean; version?: string };

export const EXTENSION_ZIP = '/downloads/lichen-coupons.zip';

export async function listExtensionTokens(): Promise<ExtensionToken[]> {
  const { data } = await supabase.from('extension_tokens').select('id, label, created_at, last_used_at').order('created_at', { ascending: false });
  return (data as ExtensionToken[] | null) ?? [];
}

export async function revokeExtensionToken(id: string): Promise<void> {
  const { error } = await supabase.from('extension_tokens').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export function browserLabel(): string {
  const ua = navigator.userAgent;
  const b = /Edg\//.test(ua) ? 'Edge' : /Brave/.test(ua) ? 'Brave' : /Chrome\//.test(ua) ? 'Chrome' : 'Browser';
  const os = /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}

/** Ask the extension (if it's installed in this browser) to say hello. */
export function detectExtension(timeoutMs = 900): Promise<ExtensionPresence> {
  return new Promise((resolve) => {
    let done = false;
    const on = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'lichen-ext' || e.data?.type !== 'hello') return;
      done = true; window.removeEventListener('message', on);
      resolve({ installed: true, connected: !!e.data.connected, version: e.data.version });
    };
    window.addEventListener('message', on);
    window.postMessage({ source: 'lichen-app', type: 'ping' }, window.location.origin);
    setTimeout(() => { if (!done) { window.removeEventListener('message', on); resolve({ installed: false, connected: false }); } }, timeoutMs);
  });
}

/** Mint a key and hand it to the extension in this browser. */
export async function connectExtension(): Promise<void> {
  const { data, error } = await supabase.rpc('mint_extension_token', { p_label: browserLabel() });
  if (error || !data) throw new Error(error?.message ?? 'Could not make a key.');
  const token = String(data);
  await new Promise<void>((resolve, reject) => {
    const on = (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== 'lichen-ext' || e.data?.type !== 'paired') return;
      window.removeEventListener('message', on); clearTimeout(t);
      if (e.data.ok) resolve(); else reject(new Error(e.data.error || 'The extension didn’t take the key — try again.'));
    };
    const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('The extension didn’t answer. Is it installed in this browser?')); }, 8000);
    window.addEventListener('message', on);
    window.postMessage({ source: 'lichen-app', type: 'pair', token }, window.location.origin);
  });
}
