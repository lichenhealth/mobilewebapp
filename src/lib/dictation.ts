// Speech recognition that's actually USABLE here — not merely present.
//
// iOS Safari defines webkitSpeechRecognition, but starting it inside an
// installed (standalone) web app hangs the page — a WebKit bug Apple has
// not fixed for PWAs (founder 2026-08-22: "Claude freezes when you try to
// use the audio feature to dictate"). The iPhone keyboard carries its own
// dictation mic on every text field, so hiding our button there loses
// nothing; desktop Chrome and friends keep it.

export interface SpeechRecognitionLike {
  lang: string; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void;
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
