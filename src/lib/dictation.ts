import { agreeLocalSpeech, localSpeechAgreed, localSpeechOnly, localSpeechSupported, LOCAL_SPEECH_MB, startLocalListening } from './localSpeech';

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
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
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
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

export interface DictationSession { stop: () => void }


/** Can this page hear at all — the browser's own speech service, or the
 *  on-phone Whisper (2026-11-26) where the browser has none? */
export function canDictate(): boolean {
  return !!speechRecognition() || localSpeechSupported();
}
/** Ask once for the on-phone download when this device will listen with
 *  it (a person's tap — a wake-word switch, hands-free); true = ready to go. */
export function ensureLocalSpeech(): boolean {
  if (!usesLocalSpeech() || localSpeechAgreed()) return true;
  const yes = window.confirm(`Turn on listening on this phone?\n\nA one-time download of about ${LOCAL_SPEECH_MB} MB (Wi-Fi is best). After that, what you say is turned into words right here on your phone — the audio is never sent anywhere.`);
  if (yes) agreeLocalSpeech();
  return yes;
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
}): DictationSession | null {
  if (opts.background && foreground > 0) return null;
  // ON-PHONE WHISPER (2026-11-26): where the browser can't listen (an
  // iPhone's home-screen app) or the person chose private listening, this
  // device turns speech into words itself — audio never leaves it. A
  // person-started session asks once for the one-time download; the
  // background wake listener never asks.
  if (usesLocalSpeech()) {
    if (!localSpeechAgreed()) {
      if (opts.background || !ensureLocalSpeech()) return null;
    }
    if (!opts.background) for (const b of [...background]) b.stop();
    let ended = false;
    let session: DictationSession | null = null;
    const l = startLocalListening({
      onPhrase: opts.onPhrase,
      background: opts.background,
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
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let ended = false;
  let session: DictationSession | null = null;
  const end = () => {
    if (ended) return;
    ended = true;
    if (opts.background) { if (session) background.delete(session); } else foreground = Math.max(0, foreground - 1);
    opts.onEnd();
  };
  rec.onresult = (e) => {
    const parts: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal === false) continue; // an engine that ignores interimResults
      const t = (r[0]?.transcript ?? '').trim();
      // The same segment twice in a row is a duplicate delivery, not speech.
      if (t && parts[parts.length - 1] !== t) parts.push(t);
    }
    if (parts.length) opts.onPhrase(parts.join(' '));
  };
  rec.onend = end;
  rec.onerror = end;
  // A refused start (mic permission, engine state) is "no session" — the
  // caller never lights the button for it.
  try { rec.start(); } catch { return null; }
  session = { stop: () => { try { rec.stop(); } catch { end(); } } };
  if (opts.background) background.add(session); else foreground++;
  return session;
}
