import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { canDictate, foregroundListening, hushAllListening, startDictation, type DictationSession } from './dictation';

/** VOICE MODE (founder 2026-11-26: "give the brain the ability to speak, so
 *  we can talk back and forth… read my next step to me as I'm cooking" and
 *  "have voice mode be possible throughout the website, so you can talk to
 *  the brain with voice record and it can talk back").
 *
 *  The browser does both halves: its speech recognition hears you (Chrome
 *  sends the audio to Google's speech service to do that; Safari does much
 *  of it on the device), and its own voices read the reply on the device.
 *  Lichen itself never records or stores audio — only the words, as an
 *  ordinary message. One switch for the whole
 *  platform (remembered per device), so every brain opens the way you left
 *  it. Where a phone can't listen (an iPhone's installed app), voice mode
 *  still READS every reply aloud and the keyboard's own mic does the
 *  hearing. */

const KEY = 'lichen.voiceMode';
let on = false;
try { on = localStorage.getItem(KEY) === '1'; } catch { /* private window */ }
let speaking = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export function voiceOn(): boolean { return on; }
export function setVoiceOn(v: boolean) {
  on = v;
  try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* */ }
  if (!v) stopSpeaking();
  emit();
}
export function useVoiceMode(): boolean { return useSyncExternalStore(subscribe, () => on, () => false); }
export function useSpeaking(): boolean { return useSyncExternalStore(subscribe, () => speaking, () => false); }

// THE BRAIN'S VOICE (founder 2026-11-27: "Can we change her voice?"): the
// device's own voices, chosen per device (voice names differ phone to
// computer). Unset = the device default for the person's language.
const VKEY = 'lichen.voiceName';
let voiceName = '';
try { voiceName = localStorage.getItem(VKEY) ?? ''; } catch { /* */ }
export function chosenVoiceName(): string { return voiceName; }
export function setVoiceName(n: string) {
  voiceName = n;
  try { if (n) localStorage.setItem(VKEY, n); else localStorage.removeItem(VKEY); } catch { /* */ }
  emit();
}
/** Voices for the person's language (English first if theirs is missing),
 *  the higher-quality ("Enhanced", "Premium", "Natural", Google) first. */
export function availableVoices(): SpeechSynthesisVoice[] {
  if (!canSpeak()) return [];
  const all = window.speechSynthesis.getVoices();
  const lang = (navigator.language || 'en-US').slice(0, 2).toLowerCase();
  let list = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
  if (!list.length) list = all.filter((v) => v.lang.toLowerCase().startsWith('en'));
  const score = (v: SpeechSynthesisVoice) => (/premium|enhanced|natural|neural|google/i.test(v.name) ? 0 : 1);
  return [...list].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}
/** Voices arrive late in some browsers — re-render when they do. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [, force] = useState(0);
  useEffect(() => {
    if (!canSpeak()) return;
    const s = window.speechSynthesis;
    const h = () => force((n) => n + 1);
    s.addEventListener?.('voiceschanged', h);
    return () => s.removeEventListener?.('voiceschanged', h);
  }, []);
  return availableVoices();
}
// LICHEN'S DEFAULT PER KIND OF DEVICE (founder 2026-11-27: "a default voice
// for lichen users on iphone, and on android"): an admin hears voices on a
// device of that kind and makes one the default (platform_settings
// 'default_voices'). Used only where the device HAS that voice and the
// person hasn't chosen their own.
export type VoicePlatform = 'iphone' | 'android' | 'mac' | 'windows' | 'other';
export function devicePlatform(): VoicePlatform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iphone';
  if (/Android/i.test(ua)) return 'android';
  if (/Mac/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}
export const PLATFORM_LABEL: Record<VoicePlatform, string> = { iphone: 'iPhone & iPad', android: 'Android', mac: 'Mac', windows: 'Windows', other: 'this kind of device' };
let defaults: Partial<Record<VoicePlatform, string>> = {};
let defaultsLoaded = false;
export function loadDefaultVoices(force = false) {
  if (defaultsLoaded && !force) return;
  defaultsLoaded = true;
  void supabase.from('platform_settings').select('value').eq('key', 'default_voices').maybeSingle()
    .then(({ data }) => { defaults = (data?.value as typeof defaults) ?? {}; emit(); });
}
export function defaultVoiceName(): string { loadDefaultVoices(); return defaults[devicePlatform()] ?? ''; }
export async function setDefaultVoice(name: string | null) {
  const { error } = await supabase.rpc('set_default_voice', { p_platform: devicePlatform(), p_name: name });
  if (error) throw new Error(error.message);
  loadDefaultVoices(true);
}
export function useDefaultVoiceName(): string { return useSyncExternalStore(subscribe, () => defaultVoiceName(), () => ''); }
function pickVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices();
  if (voiceName) { const v = all.find((x) => x.name === voiceName); if (v) return v; }
  const d = defaultVoiceName();
  return d ? all.find((x) => x.name === d) ?? null : null;
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const canListen = () => canDictate();

/** Words for the ear, not the eye: no markdown, links, emoji or arrows. */
export function forSpeech(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\([^)\s]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\*\*|__|`+|#+\s/g, '')
    .replace(/[•›→←✓✔︎✨⚡]/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

let token = 0;
// What the brain last said, and when it stopped — so words that come back
// through the microphone are recognized as its own echo, not the person.
let lastSpoken = '';
let spokeUntil = 0;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
/** True when a heard phrase is just the brain's own reply coming back in
 *  (within 10s of speaking): most of its words appear, in order, in what
 *  the brain said. */
export function heardOwnWords(phrase: string): boolean {
  if (!lastSpoken || Date.now() - spokeUntil > 10_000) return false;
  const said = norm(lastSpoken);
  const heard = norm(phrase).split(' ').filter(Boolean);
  if (heard.length < 2) return false;
  if (said.includes(heard.join(' '))) return true;
  const saidWords = new Set(said.split(' '));
  return heard.filter((w) => saidWords.has(w)).length / heard.length >= 0.8;
}
/** Speak `text`; resolves when done or stopped. Long text goes sentence by
 *  sentence — some engines cut a single long utterance off mid-way. */
export function speak(text: string): Promise<void> {
  if (!canSpeak()) return Promise.resolve();
  const clean = forSpeech(text);
  if (!clean) return Promise.resolve();
  const my = ++token;
  try { window.speechSynthesis.cancel(); } catch { /* */ }
  const parts = clean.match(/[^.!?]+[.!?]*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];
  // Join short sentences so the voice doesn't pause after every one.
  const chunks: string[] = [];
  for (const p of parts) {
    const last = chunks[chunks.length - 1];
    if (last && last.length + p.length < 180) chunks[chunks.length - 1] = `${last} ${p}`;
    else chunks.push(p);
  }
  speaking = true; emit();
  hushAllListening();
  lastSpoken = clean; spokeUntil = Infinity;
  return new Promise((resolve) => {
    const done = () => { if (my === token) { speaking = false; spokeUntil = Date.now(); emit(); } resolve(); };
    const next = (i: number) => {
      if (my !== token || i >= chunks.length) { done(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i]);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else u.lang = navigator.language || 'en-US';
      u.rate = 1;
      u.onend = () => next(i + 1);
      u.onerror = () => next(i + 1);
      try { window.speechSynthesis.speak(u); } catch { done(); }
    };
    next(0);
  });
}

export function stopSpeaking() {
  token++;
  try { window.speechSynthesis?.cancel(); } catch { /* */ }
  if (speaking) { speaking = false; emit(); }
}

/** Listen for one phrase. Resolves with what was said ('' on silence/stop). */
export function listenOnce(onPhrase?: (p: string) => void, background = false): { done: Promise<string>; stop: () => void } {
  let phrase = '';
  let session: DictationSession | null = null;
  const done = new Promise<string>((resolve) => {
    session = startDictation({
      onPhrase: (p) => { phrase = p; onPhrase?.(p); },
      onEnd: () => resolve(phrase.trim()),
      background,
    });
    if (!session) resolve('');
  });
  return { done, stop: () => session?.stop() };
}

/** A surface that just received the brain's reply calls this: in voice mode
 *  the reply is read aloud, then the composer is asked to listen again. */
export async function voiceReply(text: string) {
  if (!on) return;
  await speak(text);
  // Let the speakers fall silent before the mic opens — engines report the
  // end of speech a beat before the last of it leaves the speakers.
  await new Promise((r) => setTimeout(r, 900));
  if (on && canListen() && !speaking) window.dispatchEvent(new Event('lichen:voice-listen'));
}

/** "HEY BRAIN" or "HEY CLAUDE" (founder 2026-11-26, both wake words: "or how about, hey brain";: "default claude listening when you
 *  speak to it, kinda like hey google"). While a screen holds this open and
 *  the tab is visible, recognition runs in a loop and only a phrase that
 *  STARTS WITH the wake words acts — everything else is dropped on the
 *  floor, never sent. "Hey Claude, how much butter?" asks at once; a bare
 *  "Hey Claude" answers "Yes?" and listens for the question. Paused while
 *  the brain is speaking, so it never hears itself. */
const WAKE = /\b(?:hey|hi|ok|okay)[,.!\s]+(?:claude|cloud|clawed|clod|claud|brain|brane)\b[,.!?\s]*/i;
export function startWakeWord(onAsk: (said: string) => void): { stop: () => void } {
  let active = true;
  let cur: { stop: () => void } | null = null;
  const loop = async () => {
    while (active) {
      if (document.visibilityState !== 'visible' || speaking || foregroundListening()) { await new Promise((r) => setTimeout(r, 400)); continue; }
      const l = listenOnce(undefined, true);
      cur = l;
      const heard = await l.done;
      cur = null;
      if (!active) break;
      if (heardOwnWords(heard)) continue;
      const m = WAKE.exec(heard);
      if (m) {
        let q = heard.slice(m.index + m[0].length).trim();
        if (!q) {
          await speak('Yes?');
          if (!active) break;
          const l2 = listenOnce(); cur = l2;
          q = (await l2.done).trim(); cur = null;
        }
        if (q && active) onAsk(q);
      }
      // A refused or instantly-ended session: breathe before retrying.
      await new Promise((r) => setTimeout(r, heard ? 120 : 600));
    }
  };
  void loop();
  return { stop: () => { active = false; cur?.stop(); } };
}

/* ── ALWAYS LISTENING FOR "HEY BRAIN" (founder 2026-11-26: "a setting for
   audio, which is that Claude is always listening or the brain is always
   listening for Hey Brain or Hey Claude") ─────────────────────────────────
   A per-device switch. While it's on and Lichen is open on screen, the wake
   listener runs app-wide (GlobalWake). A screen can take the wake words over
   for itself (a doc's Claude panel: "Hey Brain, next") by pushing a handler;
   otherwise the words go to the brain. */
const WKEY = 'lichen.wakeAlways';
let wakeAlways = false;
try { wakeAlways = localStorage.getItem(WKEY) === '1'; } catch { /* */ }
const handlers: ((said: string) => void)[] = [];
export function useWakeAlways(): boolean { return useSyncExternalStore(subscribe, () => wakeAlways, () => false); }
export function setWakeAlways(v: boolean) {
  wakeAlways = v;
  try { localStorage.setItem(WKEY, v ? '1' : '0'); } catch { /* */ }
  emit();
}
let handlerTick = 0;
export function useWakeWanted(): boolean {
  return useSyncExternalStore(subscribe, () => wakeAlways || handlers.length > 0, () => false);
}
/** A screen claims the wake words while mounted; returns the release. */
export function pushWakeHandler(fn: (said: string) => void): () => void {
  handlers.push(fn); handlerTick++; emit();
  return () => { const i = handlers.lastIndexOf(fn); if (i >= 0) handlers.splice(i, 1); handlerTick++; emit(); };
}
export function topWakeHandler(): ((said: string) => void) | null { return handlers[handlers.length - 1] ?? null; }
