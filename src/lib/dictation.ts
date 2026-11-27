import { localSpeechAgreed, localSpeechStatusNow, localSpeechOnly, localSpeechSupported, LOCAL_SPEECH_MB, startLocalListening } from './localSpeech';

// Speech recognition that's actually USABLE here — not merely present.
//
// iOS Safari defines webkitSpeechRecognition, but starting it inside an
// installed (standalone) web app hangs the page — a WebKit bug Apple has
// not fixed for PWAs (founder 2026-08-22: "Claude freezes when you try to
// use the audio feature to dictate"). The iPhone keyboard carries its own
// dictation mic on every text field, so hiding our button there loses
// nothing; desktop Chrome and friends keep it.

export interface SpeechRecognitionLike {
  lang: string; interimResults: boolean; continuous: boolean; maxAlternatives: number;
  onresult: ((e: {
    results: ArrayLike<{ isFinal?: boolean } & ArrayLike<{ transcript: string }>>;
  }) => void) | null;
  onend: (() => void) | null; onerror: ((ev?: unknown) => void) | null;
  start: () => void; stop: () => void; abort?: () => void;
}

export function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  // iPadOS masquerades as MacIntel — the touch-points check catches it.
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // The hang is the INSTALLED app's; Safari itself listens fine (2026-11-26,
  // voice mode), so only a standalone iOS web app is refused.
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (iOS && standalone) return null;
  // iPhone Chrome/Firefox/Edge expose the object but never hear anything
  // (Apple's in-app web view) — refuse it so callers offer Safari instead.
  if (iOS && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent)) return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

export interface DictationSession { stop: () => void }

function isIOS(): boolean {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}


/** Can this page hear at all — the browser's own speech service, or the
 *  on-phone Whisper (2026-11-26) where the browser has none? */
export function canDictate(): boolean {
  return !!speechRecognition() || localSpeechSupported();
}
/** Ask once for the on-phone download when this device will listen with
 *  it (a person's tap — a wake-word switch, hands-free); true = ready to go. */
export type VoiceChoice = 'talk' | 'text' | 'keyboard' | null;
/** THE VOICE CHOICE (founder 2026-11-26: "the pop-up needs to show that you
 *  can turn on voice conversations with Claude and it requires this
 *  download, or like, no, I just want to use voice to text"). Opens the
 *  app-wide sheet (LocalSpeechChoice.tsx) and resolves with what the person
 *  chose — only once the download is ready, so the next step is theirs to
 *  tap. Resolves straight away when no download is needed. */
export function askVoiceChoice(prefer: 'talk' | 'text'): Promise<VoiceChoice> {
  if (!usesLocalSpeech() || localSpeechAgreed() && localSpeechStatusNow() === 'ready') return Promise.resolve(prefer);
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent('lichen:voice-choice', { detail: { prefer, resolve } }));
  });
}
/** The iPhone home-screen app's voice sheet (2026-11-26): Apple keeps its
 *  speech recognition from home-screen apps, so voice conversations hand
 *  off to Safari/Chrome and voice-to-text uses the keyboard's own mic.
 *  'talk' here means "just read replies aloud in the app". */
export function askIosVoice(prefer: 'talk' | 'text'): Promise<VoiceChoice> {
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent('lichen:voice-choice', { detail: { prefer, resolve } }));
  });
}
/** For switches that need the listener (Hey Brain, hands-free, private
 *  listening): true once it's ready. */
export async function ensureLocalSpeech(prefer: 'talk' | 'text' = 'talk'): Promise<boolean> {
  const c = await askVoiceChoice(prefer);
  return c === 'talk' || c === 'text';
}
/** Which ear a session will use. */
export function usesLocalSpeech(): boolean {
  return localSpeechSupported() && (localSpeechOnly() || !speechRecognition());
}


// ONE EAR AT A TIME (2026-11-26, "Hey Brain" always listening): engines run
// one recognition session per page. The always-on wake listener is a
// BACKGROUND session; anything a person starts (a mic tap, voice mode) is
// FOREGROUND and stops the background one first. The wake loop waits while
// a foreground session is live.
const background = new Set<DictationSession>();
let foreground = 0;
// THE BRAIN NEVER HEARS ITSELF (founder 2026-11-27: "the brain is listening
// to itself when it responds to me and thinking i'm saying it"): every live
// session can be HUSHED — its words dropped, then ended — the moment the
// brain starts speaking (voice.ts speak()).
const hushers = new Set<() => void>();
export function hushAllListening() { for (const h of [...hushers]) h(); }
export const foregroundListening = () => foreground > 0;

/** One dictation session, duplicate-proof — THE one way every mic button
 *  starts recognition (AssistantComposer, SnapshotPanel; a new surface
 *  joins it, never hand-rolls onresult).
 *
 *  Engines disagree about delivery: desktop Chrome sends one final result
 *  per session, but Safari and Android Chrome RE-FIRE onresult carrying
 *  the same final segment again (cumulative result lists, duplicated
 *  events) even with interimResults off. The old append-per-event code
 *  turned that into "the same four or five words, repeated several times"
 *  (founder 2026-10-03). So the whole session's phrase is REBUILT from the
 *  full results list on every event and handed to onPhrase as a
 *  REPLACEMENT, never an append — a re-delivered event re-sets the same
 *  text instead of doubling it, and duplicate consecutive segments are
 *  dropped as deliveries, not speech. */
export function startDictation(opts: {
  /** The whole phrase dictated THIS session, every time it grows. The
   *  caller replaces its session text with this — never appends. */
  onPhrase: (phrase: string) => void;
  /** Fires exactly once, however the session ends (silence, stop, error,
   *  refused start never calls it — startDictation returns null then). */
  onEnd: () => void;
  /** The always-on wake listener — yields to anything a person starts. */
  background?: boolean;
  /** Keep listening across pauses until stop() — plain voice-to-text. */
  continuous?: boolean;
  /** On-device only: listening / hearing / thinking (writing it out). */
  onState?: (s: 'listening' | 'hearing' | 'thinking') => void;
  /** The engine's own error word ('not-allowed', 'no-speech', 'network'…)
   *  — so a caller can say WHY nothing was heard instead of sitting idle. */
  onError?: (code: string) => void;
  /** LIVE ROUGH WORDS (founder 2026-11-27: "rebuild what I'm experiencing
   *  here with you and Claude"): present = the engine's not-yet-certain
   *  words arrive here as they're heard ('' clears), for display only — the
   *  caller shows them faintly and never treats them as settled. The words
   *  still on screen when a session ends are handed over through onPhrase,
   *  so nothing seen is lost. */
  onInterim?: (rough: string) => void;
}): DictationSession | null {
  if (opts.background && foreground > 0) return null;
  // ON-PHONE WHISPER (2026-11-26): where the browser can't listen (an
  // iPhone's home-screen app) or the person chose private listening, this
  // device turns speech into words itself — audio never leaves it. A
  // person-started session asks once for the one-time download; the
  // background wake listener never asks.
  if (usesLocalSpeech()) {
    // Not set up yet: the caller asks first (askVoiceChoice) — never here.
    if (!localSpeechAgreed()) return null;
    if (!opts.background) for (const b of [...background]) b.stop();
    let ended = false;
    let session: DictationSession | null = null;
    const l = startLocalListening({
      onPhrase: opts.onPhrase,
      background: opts.background,
      continuous: opts.continuous,
      onState: opts.onState,
      onEnd: () => {
        if (ended) return; ended = true;
        if (opts.background) { if (session) background.delete(session); } else foreground = Math.max(0, foreground - 1);
        opts.onEnd();
      },
    });
    session = { stop: l.stop };
    if (opts.background) background.add(session); else foreground++;
    return session;
  }
  const Ctor = speechRecognition();
  if (!Ctor) return null;
  if (!opts.background) for (const b of [...background]) b.stop();
  const rec = new Ctor();
  rec.lang = navigator.language || 'en-US';
  // iPhone Safari heard nothing with live rough words switched on (founder
  // 2026-11-27, the day they shipped: "no words appeared") — before them it
  // worked. Live words stay where they're proven: computers and Android.
  rec.interimResults = !!opts.onInterim && !isIOS();
  rec.continuous = !!opts.continuous && !opts.background;
  rec.maxAlternatives = 1;
  let ended = false;
  let session: DictationSession | null = null;
  const end = () => {
    if (ended) return;
    ended = true;
    if (opts.background) { if (session) background.delete(session); } else foreground = Math.max(0, foreground - 1);
    opts.onEnd();
  };
  // iPHONE SAFARI OFTEN NEVER SAYS "FINAL" (founder 2026-11-27: voice mode
  // on her phone "didn't pick anything up"): it delivers what it heard as a
  // non-final result and then ends. Non-final results still never reach the
  // caller mid-session (the duplicate-delivery rule above), but the latest
  // one is kept and handed over at the end when nothing final ever came.
  let gotFinal = false;
  let pending = '';
  let lastFinal = '';
  let lastRough = '';
  let hushed = false;
  const hush = () => { hushed = true; pending = ''; if (lastRough) { lastRough = ''; opts.onInterim?.(''); }
    window.setTimeout(() => { if (!ended) { hushers.delete(hush); end(); } }, 1500); try { rec.abort?.(); } catch { /* */ } try { rec.stop(); } catch { end(); } };
  hushers.add(hush);
  rec.onresult = (e) => {
    if (hushed) return;
    const parts: string[] = [];
    const loose: string[] = [];
    const rough: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      const t = (r[0]?.transcript ?? '').trim();
      if (t && loose[loose.length - 1] !== t) loose.push(t);
      if (r.isFinal === false) { if (t && rough[rough.length - 1] !== t) rough.push(t); continue; }
      // The same segment twice in a row is a duplicate delivery, not speech.
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    if (parts.length) {
      gotFinal = true;
      const f = parts.join(' ');
      if (f !== lastFinal) { lastFinal = f; opts.onPhrase(f); }
    } else if (loose.length) pending = loose.join(' ');
    if (opts.onInterim) {
      let r = rough.join(' ');
      // An engine re-sending settled words as rough ones is not new speech.
      if (r && lastFinal.endsWith(r)) r = '';
      if (r !== lastRough) { lastRough = r; opts.onInterim(r); }
    }
  };
  // Whatever was still showing when listening stops is kept, never dropped.
  let settled = false;
  const settle = () => {
    if (hushed || settled) return;
    settled = true;
    if (opts.onInterim && lastRough) {
      opts.onPhrase((lastFinal ? lastFinal + ' ' : '') + lastRough);
    } else if (!gotFinal && pending) opts.onPhrase(pending);
    if (lastRough) { lastRough = ''; opts.onInterim?.(''); }
  };
  rec.onend = () => {
    hushers.delete(hush);
    settle();
    end();
  };
  rec.onerror = (ev: unknown) => {
    const code = (ev as { error?: string })?.error ?? 'error';
    hushers.delete(hush);
    if (code !== 'aborted' && !hushed) opts.onError?.(code);
    settle();
    end();
  };
  // A refused start (mic permission, engine state) is "no session" — the
  // caller never lights the button for it.
  try { rec.start(); } catch { return null; }
  // iPhones sometimes never fire onend after stop(): the session then looked
  // alive forever and every later tap went nowhere. Give it 1.5s, then abort
  // and end it ourselves.
  session = {
    stop: () => {
      try { rec.stop(); } catch { end(); return; }
      window.setTimeout(() => { if (!ended) { try { rec.abort?.(); } catch { /* */ } hushers.delete(hush); settle(); end(); } }, 1500);
    },
  };
  if (opts.background) background.add(session); else foreground++;
  return session;
}
