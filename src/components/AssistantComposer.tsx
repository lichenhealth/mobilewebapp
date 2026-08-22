import { useState } from 'react';
import { Icon } from './Icon';
import { uploadPageImage } from '../lib/avatarApi';
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
 *  was typed.
 *
 *  PHOTOS (founder 2026-08-22: "copy and paste images into build with
 *  claude, like we can here"): when `uploaderId` is given, an image pasted
 *  into the box (or picked via the + on phones, where paste barely exists)
 *  uploads immediately, previews as a chip, and rides the send. */
export default function AssistantComposer({
  onSend, placeholder = 'Ask about any of this…', className = '', initialText, uploaderId,
}: {
  onSend: (text: string, images?: string[]) => void | Promise<void>;
  placeholder?: string;
  className?: string;
  /** A door can arrive carrying its intent (founder 2026-08-11: "Draft it
   *  with Claude" shouldn't forget why you came) — the prompt sits here
   *  ready to send, or to edit first (add a website to read, a length…). */
  initialText?: string;
  /** Present = photos may be pasted/attached; whose storage they land in. */
  uploaderId?: string;
}) {
  const [ask, setAsk] = useState(initialText ?? '');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [upBusy, setUpBusy] = useState(false);

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

  async function addFiles(files: File[]) {
    if (!uploaderId || !files.length) return;
    setUpBusy(true);
    try {
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const url = await uploadPageImage(uploaderId, f);
        setImages((cur) => [...cur, url]);
      }
    } catch (err) { console.error(err); }
    setUpBusy(false);
  }

  function onPaste(e: React.ClipboardEvent) {
    if (!uploaderId) return;
    const files = [...e.clipboardData.items]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();   // don't paste the file's name as text
      void addFiles(files);
    }
  }

  async function submit() {
    const text = ask.trim();
    if ((!text && images.length === 0) || sending || upBusy) return;
    setSending(true);
    try {
      await onSend(text, images.length ? images : undefined);
      setAsk('');
      setImages([]);
    } finally {
      setSending(false);
    }
  }

  return (
    <form className={'assist-composer ' + className} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {images.length > 0 && (
        <div className="assist-composer__shots">
          {images.map((url) => (
            <span className="assist-composer__shot" key={url}>
              <img src={url} alt="" />
              <button type="button" onClick={() => setImages((cur) => cur.filter((x) => x !== url))}
                aria-label="Remove this photo">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="assist-composer__row">
        {uploaderId && (
          <label className={'assist-composer__btn' + (upBusy ? ' is-live' : '')} aria-label="Add a photo">
            <Icon name="image" size={17} />
            <input type="file" accept="image/*" multiple hidden disabled={upBusy}
              onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
        )}
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
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
        />
        <button className="assist-composer__send" type="submit"
          disabled={(!ask.trim() && images.length === 0) || sending || upBusy}
          aria-label="Send to your assistant">
          <Icon name="send" size={15} />
        </button>
      </div>
    </form>
  );
}
