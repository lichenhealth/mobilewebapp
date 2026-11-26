import { useSyncExternalStore } from 'react';
import { foregroundListening, speechRecognition, startDictation, type DictationSession } from './dictation';

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

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const canListen = () => !!speechRecognition();

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
  return new Promise((resolve) => {
    const done = () => { if (my === token) { speaking = false; emit(); } resolve(); };
    const next = (i: number) => {
      if (my !== token || i >= chunks.length) { done(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i]);
      u.lang = navigator.language || 'en-US';
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
  if (on && canListen()) window.dispatchEvent(new Event('lichen:voice-listen'));
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
