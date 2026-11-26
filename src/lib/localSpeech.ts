import { useSyncExternalStore } from 'react';

/** HEARING ON THE PHONE ITSELF (founder 2026-11-26: "is there an ethical one
 *  from a data standpoint…" → "yes"). Open-source Whisper turns speech into
 *  words in a worker on this device: nothing a person says is sent anywhere.
 *  It is the ear wherever the browser has none (an iPhone's home-screen app,
 *  Firefox), and anywhere a person chooses it ("Hear me on this device only").
 *
 *  One mic stream for the page, opened by the first session and closed a few
 *  seconds after the last ends; a small voice-activity gate decides when
 *  someone started and stopped talking; each phrase goes to the worker. */

const ON_KEY = 'lichen.localSpeech';       // 'on' once the person agreed to the download
const PREF_KEY = 'lichen.localSpeechOnly'; // '1' = use it even where the browser can listen
export const LOCAL_SPEECH_MB = 42;

type Status = { state: 'off' | 'loading' | 'ready' | 'error'; pct: number; message?: string };
let status: Status = { state: 'off', pct: 0 };
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const set = (s: Partial<Status>) => { status = { ...status, ...s }; emit(); };
export const localSpeechStatusNow = () => status.state;
export const useLocalSpeechStatus = () => useSyncExternalStore(subscribe, () => status, () => status);

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* */ } emit(); };

export function localSpeechSupported(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
}
export const localSpeechAgreed = () => read(ON_KEY) === 'on';
export const localSpeechOnly = () => read(PREF_KEY) === '1';
export function setLocalSpeechOnly(v: boolean) { write(PREF_KEY, v ? '1' : null); if (v) agreeLocalSpeech(); }
export function agreeLocalSpeech() { write(ON_KEY, 'on'); warm(); }
export function forgetLocalSpeech() { write(ON_KEY, null); write(PREF_KEY, null); }
export const useLocalSpeechPrefs = () => useSyncExternalStore(subscribe,
  () => `${read(ON_KEY) ?? ''}|${read(PREF_KEY) ?? ''}`, () => '|');

/* ── The worker ─────────────────────────────────────────────────────── */
let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { ok: (t: string) => void; no: (e: Error) => void }>();
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./localSpeechWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ type: string; id?: number; text?: string; pct?: number; message?: string }>) => {
    const m = e.data;
    if (m.type === 'progress') set({ state: 'loading', pct: m.pct ?? 0 });
    else if (m.type === 'ready') { if (status.state !== 'ready') set({ state: 'ready', pct: 100 }); }
    else if (m.type === 'text' && m.id) { waiting.get(m.id)?.ok(m.text ?? ''); waiting.delete(m.id); }
    else if (m.type === 'error') {
      if (m.id) { waiting.get(m.id)?.no(new Error(m.message)); waiting.delete(m.id); }
      else set({ state: 'error', message: m.message });
    }
  };
  worker.onerror = () => set({ state: 'error', message: 'The on-phone listener couldn’t start.' });
  return worker;
}
/** Start fetching the model (once; the browser caches it after). */
export function warm() {
  if (!localSpeechSupported() || !localSpeechAgreed()) return;
  if (status.state === 'off' || status.state === 'error') set({ state: 'loading', pct: status.pct || 0, message: undefined });
  getWorker().postMessage({ type: 'load' });
}
function transcribe(audio: Float32Array): Promise<string> {
  const id = nextId++;
  return new Promise((ok, no) => {
    waiting.set(id, { ok, no });
    getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

/** What Whisper says about silence or noise isn't speech. */
function clean(t: string): string {
  const s = t.replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/[a-z0-9]/i.test(s)) return '';
  if (/^(you|thank you\.?|thanks for watching!?|bye\.?)$/i.test(s)) return '';
  return s;
}

/* ── The microphone ─────────────────────────────────────────────────── */
type Ctx = AudioContext;
let ctx: Ctx | null = null;
let stream: MediaStream | null = null;
let node: ScriptProcessorNode | null = null;
let src: MediaStreamAudioSourceNode | null = null;
let closeTimer: number | null = null;
const listeners = new Set<(frame: Float32Array) => void>();

function audioCtx(): Ctx {
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new C();
  }
  return ctx;
}
// iPhones only let audio start from a tap — any tap anywhere wakes it.
if (typeof document !== 'undefined') {
  const wake = () => { if (ctx && ctx.state === 'suspended') void ctx.resume(); };
  document.addEventListener('pointerdown', wake, true);
  document.addEventListener('keydown', wake, true);
}
async function openMic() {
  if (closeTimer) { window.clearTimeout(closeTimer); closeTimer = null; }
  if (stream && node) return;
  const c = audioCtx();
  if (c.state === 'suspended') { try { await c.resume(); } catch { /* resumes on the next tap */ } }
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  src = c.createMediaStreamSource(stream);
  node = c.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (ev) => {
    const d = ev.inputBuffer.getChannelData(0);
    const copy = new Float32Array(d.length); copy.set(d);
    listeners.forEach((f) => f(copy));
  };
  src.connect(node); node.connect(c.destination);
}
function closeMicSoon() {
  if (closeTimer) window.clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    if (listeners.size) return;
    try { node?.disconnect(); src?.disconnect(); } catch { /* */ }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null; node = null; src = null; closeTimer = null;
  }, 4000);
}

function to16k(chunks: Float32Array[], rate: number): Float32Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(len); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  if (rate === 16000) return all;
  const ratio = rate / 16000, out = new Float32Array(Math.floor(len / ratio));
  for (let i = 0; i < out.length; i++) {
    // average over the span — a cheap low-pass so it doesn't alias
    const a = Math.floor(i * ratio), b = Math.min(len, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += all[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/** Listen on this device. Same contract as startDictation: onPhrase with
 *  the WHOLE text so far, onEnd exactly once.
 *  One-phrase mode (voice conversations, the wake loop) ends at the first
 *  pause. CONTINUOUS mode (plain voice-to-text — founder 2026-11-26: "it
 *  stopped recording the stuff I said after that") keeps listening until
 *  stop(): each short pause turns that stretch into words right away, so
 *  text appears as you go instead of all at the end. */
export function startLocalListening(opts: {
  onPhrase: (p: string) => void; onEnd: () => void; background?: boolean; continuous?: boolean;
  onState?: (s: 'listening' | 'hearing' | 'thinking') => void;
}): { stop: () => void } {
  let ended = false, stopped = false;
  const end = () => { if (ended) return; ended = true; listeners.delete(onFrame); closeMicSoon(); opts.onEnd(); };
  const cont = !!opts.continuous && !opts.background;
  let chunks: Float32Array[] = []; const pre: Float32Array[] = [];
  let speaking = false, silentMs = 0, spokenMs = 0, waitedMs = 0, floor = 0.006;
  const rate = () => ctx?.sampleRate ?? 48000;
  // Continuous: a long idle (a minute with nothing said) ends it; a short
  // pause (0.7s) cuts a stretch so its words show up quickly.
  const maxWait = cont ? 60000 : opts.background ? 12000 : 8000;
  const tailMs = cont ? 700 : opts.background ? 900 : 1500;
  const maxSpoken = cont ? 12000 : 20000;
  let said = '';
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  const cut = () => {
    const audio = (speaking && spokenMs >= 300) ? to16k(chunks, rate()) : null;
    chunks = []; speaking = false; silentMs = 0; spokenMs = 0; waitedMs = 0;
    if (!audio) return;
    pending++; opts.onState?.('thinking');
    queue = queue.then(async () => {
      try {
        const text = clean(await transcribe(audio));
        if (text && !ended) { said = said ? said + ' ' + text : text; opts.onPhrase(said); }
      } catch (err) { console.warn('[on-device listening]', err); /* an error is silence, not words */ }
      pending--;
      if (!ended && !stopped && pending === 0) opts.onState?.('listening');
    });
  };
  const finish = () => {
    listeners.delete(onFrame);
    cut();
    void queue.then(end);
  };
  const onFrame = (f: Float32Array) => {
    if (ended) return;
    const ms = (f.length / rate()) * 1000;
    let sum = 0; for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    const loud = rms > Math.max(0.012, floor * 3);
    if (!loud) floor = floor * 0.95 + rms * 0.05;
    if (stopped) { finish(); return; }
    if (!speaking) {
      pre.push(f); if (pre.length > 3) pre.shift();
      waitedMs += ms;
      if (loud) { speaking = true; chunks.push(...pre); opts.onState?.('hearing'); }
      else if (waitedMs > maxWait) finish();
      return;
    }
    chunks.push(f);
    if (loud) { spokenMs += ms; silentMs = 0; } else silentMs += ms;
    if (silentMs > tailMs || spokenMs > maxSpoken) {
      if (cont) cut(); else finish();
    }
  };
  void (async () => {
    try {
      warm();
      await openMic();
      if (ended) return;
      listeners.add(onFrame);
      opts.onState?.('listening');
    } catch (err) { console.warn('[on-device listening] mic', err); end(); }
  })();
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      // Stopping mid-phrase still turns what was said into words.
      if (!speaking && pending === 0) { listeners.delete(onFrame); end(); }
      else if (!speaking) { listeners.delete(onFrame); void queue.then(end); }
    },
  };
}
