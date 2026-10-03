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
  if (iOS) return null;
  const w = window as unknown as {
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    SpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.webkitSpeechRecognition ?? w.SpeechRecognition ?? null;
}

export interface DictationSession { stop: () => void }

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
}): DictationSession | null {
  const Ctor = speechRecognition();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = false;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let ended = false;
  const end = () => { if (!ended) { ended = true; opts.onEnd(); } };
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
  return { stop: () => { try { rec.stop(); } catch { end(); } } };
}
