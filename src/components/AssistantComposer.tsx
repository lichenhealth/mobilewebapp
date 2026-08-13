import { useState } from 'react';
import { Icon } from './Icon';
import './AssistantComposer.css';

interface SpeechRecognitionLike {
  lang: string; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void;
}

/** The text box every surface that talks to Claude sends through — the
 *  brief's inline reply and the feed's compose box alike. Dictation where
 *  the browser offers it; Enter sends, Shift+Enter makes a new line. Text
 *  stays in place if `onSend` throws, so a failed send never loses what
 *  was typed. */
export default function AssistantComposer({
  onSend, placeholder = 'Ask about any of this…', className = '', initialText,
}: {
  onSend: (text: string) => void | Promise<void>;
  placeholder?: string;
  className?: string;
  /** A door can arrive carrying its intent (founder 2026-08-11: "Draft it
   *  with Claude" shouldn't forget why you came) — the prompt sits here
   *  ready to send, or to edit first (add a website to read, a length…). */
  initialText?: string;
}) {
  const [ask, setAsk] = useState(initialText ?? '');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);

  const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike })
    .webkitSpeechRecognition
    ?? (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition;
  function dictate() {
    if (!SR || listening) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const said = e.results[e.results.length - 1][0].transcript;
      setAsk((a) => (a ? `${a} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  async function submit() {
    const text = ask.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setAsk('');
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={'assist-composer ' + className} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {SR && (
        <button type="button" className={'assist-composer__btn' + (listening ? ' is-live' : '')}
          onClick={dictate} aria-label="Speak instead">
          <Icon name="mic" size={17} />
        </button>
      )}
      <textarea
        className="assist-composer__input"
        rows={1}
        value={ask}
        placeholder={placeholder}
        onChange={(e) => setAsk(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
        }}
      />
      <button className="assist-composer__send" type="submit" disabled={!ask.trim() || sending}
        aria-label="Send to your assistant">
        <Icon name="send" size={15} />
      </button>
    </form>
  );
}
