import { isHeic } from '../lib/heic';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { uploadPageImage } from '../lib/avatarApi';
import { isIosHomeScreenApp } from '../lib/browserHandoff';
import { askIosVoice, askVoiceChoice, canDictate, startDictation, usesLocalSpeech, type DictationSession } from '../lib/dictation';
import { localSpeechAgreed, localSpeechStatusNow, useLocalSpeechStatus } from '../lib/localSpeech';
import { revealBelow } from '../lib/smartReveal';
import VoiceSettings from './VoiceSettings';
import { canListen, canSpeak, setVoiceOn, stopSpeaking, useSpeaking, useVoiceMode } from '../lib/voice';
import './AssistantComposer.css';

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
  onSend, placeholder = 'Ask about any of this…', className = '', initialText, uploaderId, attachment, secondary = false,
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
  /** Something riding the send ABOVE the box (founder 2026-11-14: an email
   *  "should be like an attachment in a chat, with the clear space to write
   *  additional context, below it"). Present = the box may send with no
   *  words, the attachment alone being the ask. */
  attachment?: React.ReactNode;
  /** A second composer on the same screen (the brief's summary reply beside
   *  the last conversation): it never catches window-wide drops or the
   *  voice-mode listen cue, and wears no voice switch — one ear, one drop zone. */
  secondary?: boolean;
}) {
  const [ask, setAsk] = useState(initialText ?? '');
  // An attachment arriving means "write about this" — the box takes focus
  // so its clear space is right there (and on screen).
  const hasAtt = !!attachment;
  useEffect(() => {
    if (!hasAtt) return;
    const t = window.setTimeout(() => taRef.current?.focus(), 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAtt]);
  // THE BOX GROWS WITH ITS WORDS (founder 2026-10-29, a brain-door prefill
  // arriving clipped: "clicking in didn't show the entire text for me to
  // edit, so the box needs to expand") — height follows content from the
  // first paint (prefills included), capped at ~6 lines, then it scrolls.
  // AND THE SCREEN FOLLOWS THE WORDS (founder 2026-11-02: "the type gets
  // cutoff and i keep typing, but its below the fold, can you fix the
  // scroll?"): EVERY text change keeps the whole composer above the bottom
  // nav — revealBelow, the one platform scroll helper, which no-ops when
  // it's already in view (so this costs one rect read per keystroke).
  // Per-keystroke, not per-growth, deliberately: a smooth scroll can get
  // clamped mid-animation and the box stops growing at its cap, so each
  // keystroke self-corrects whatever the last one missed. Never on mount:
  // the brief renders this same composer mid-page and must not auto-scroll
  // to it on arrival.
  const taRef = useRef<HTMLTextAreaElement>(null);
  const typedYet = useRef(false);
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    // 'auto' (instant), never smooth: per-keystroke smooth scrolls cancel
    // each other into zero net motion (smartReveal.ts has the story).
    if (typedYet.current) revealBelow(ta.closest('form'), 'auto');
    typedYet.current = true;
  }, [ask]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [upBusy, setUpBusy] = useState(false);
  // DRAG IT STRAIGHT IN (founder 2026-11-02: "pull a screenshot from
  // desktop into the composer"): a dropped image rides the same addFiles
  // pipeline as paste and the + picker.
  const [dragOver, setDragOver] = useState(false);

  // Usable-here check, not merely present (src/lib/dictation.ts): on iOS
  // this is null — starting recognition in an installed web app hangs the
  // page, and the iPhone keyboard's own mic covers dictation anyway.
  const SR = canDictate();
  // The iPhone home-screen app can't run speech recognition: the mic points
  // to the keyboard's own (Apple's dictation), voice mode offers Safari.
  const iosApp = !SR && isIosHomeScreenApp();
  const [kbHint, setKbHint] = useState(false);
  const localSt = useLocalSpeechStatus();
  const dictation = useRef<DictationSession | null>(null);
  // On-device only: 'thinking' = turning a stretch of speech into words.
  const [hearState, setHearState] = useState<'listening' | 'hearing' | 'thinking' | null>(null);
  // Lichen's listener not set up (or still downloading): the voice choice
  // sheet explains talk-vs-text and shows the download, then hands back
  // what they picked (src/components/LocalSpeechChoice.tsx).
  const needsChoice = () => usesLocalSpeech() && !(localSpeechAgreed() && localSpeechStatusNow() === 'ready');
  async function routeChoice(prefer: 'talk' | 'text') {
    const c = await askVoiceChoice(prefer);
    if (c === 'talk') { setVoiceOn(true); voiceListen(); }
    else if (c === 'text') startText();
    else if (c === 'keyboard') taRef.current?.focus();
  }
  function dictate() {
    if (iosApp) { taRef.current?.focus(); setKbHint(true); window.setTimeout(() => setKbHint(false), 6000); return; }
    if (!SR) return;
    // Second tap while live = stop (dictation.onEnd clears the light).
    if (listening) { dictation.current?.stop(); return; }
    if (needsChoice()) { void routeChoice('text'); return; }
    startText();
  }
  function startText() {
    if (dictation.current) return;
    // The phrase REPLACES everything after this base — duplicate engine
    // deliveries re-set the same text instead of appending it again
    // (src/lib/dictation.ts has the whole story).
    const base = ask.trim() ? ask.replace(/\s+$/, '') + ' ' : '';
    const s = startDictation({
      onPhrase: (phrase) => setAsk(base + phrase),
      onEnd: () => { setListening(false); setHearState(null); dictation.current = null; },
      // Plain voice-to-text keeps listening across pauses until the mic is
      // tapped again (founder 2026-11-26: "it stopped recording the stuff I
      // said after that").
      continuous: true,
      onState: setHearState,
    });
    // A refused start (mic permission, engine state) returns null — never
    // strand the button lit.
    dictation.current = s;
    setListening(!!s);
  }

  // VOICE MODE (founder 2026-11-26: "talk to the brain with voice record and
  // it can talk back"): one switch, the whole platform. On, this box listens;
  // when you stop talking it sends what you said; the reply is read aloud
  // (voiceReply, where replies land) and then it listens again. Where a
  // phone can't listen, replies are still read aloud and the keyboard's mic
  // does the hearing.
  const voice = useVoiceMode();
  const speakingNow = useSpeaking();
  const voicePhrase = useRef('');
  const submitRef = useRef<(t?: string) => Promise<void>>(async () => {});
  function voiceListen() {
    if (!SR || dictation.current) return;
    voicePhrase.current = '';
    const s = startDictation({
      onPhrase: (phrase) => { voicePhrase.current = phrase; setAsk(phrase); },
      onState: setHearState,
      onEnd: () => {
        setListening(false); setHearState(null); dictation.current = null;
        const said = voicePhrase.current.trim();
        if (said) void submitRef.current(said);
      },
    });
    dictation.current = s;
    setListening(!!s);
  }
  function toggleVoice() {
    if (voice) { dictation.current?.stop(); stopSpeaking(); setVoiceOn(false); return; }
    if (iosApp) {
      void askIosVoice('talk').then((c) => {
        if (c === 'talk') setVoiceOn(true);
        else if (c === 'keyboard') { taRef.current?.focus(); setKbHint(true); window.setTimeout(() => setKbHint(false), 6000); }
      });
      return;
    }
    if (needsChoice() && canListen()) { void routeChoice('talk'); return; }
    setVoiceOn(true);
    voiceListen();
  }
  useEffect(() => {
    if (secondary) return;
    const go = () => { if (voice) voiceListen(); };
    window.addEventListener('lichen:voice-listen', go);
    return () => window.removeEventListener('lichen:voice-listen', go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, secondary]);
  useEffect(() => () => { dictation.current?.stop(); }, []);

  async function addFiles(files: File[]) {
    if (!uploaderId || !files.length) return;
    setUpBusy(true);
    try {
      for (const f of files) {
        if (!f.type.startsWith('image/') && !isHeic(f)) continue;
        const url = await uploadPageImage(uploaderId, f);
        setImages((cur) => [...cur, url]);
      }
    } catch (err) { console.error(err); }
    setUpBusy(false);
  }

  // THE WHOLE BRAIN SCREEN IS A DROP ZONE (founder 2026-11-09: "you can't
  // drag and drop content from desktop into the feed for some brain chats…
  // make sure you can drag and drop but also upload content via any Ai chat
  // brain"): a file dropped ANYWHERE on the screen — the conversation, the
  // brief, the empty space — lands in this composer, not just on the box.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    if (!uploaderId || secondary) return;
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((it) => it.kind === 'file');
    const over = (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDragOver(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDragOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) && !(e.dataTransfer?.files?.length)) return;
      e.preventDefault(); setDragOver(false);
      void addFilesRef.current([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [uploaderId, secondary]);

  function onPaste(e: React.ClipboardEvent) {
    if (!uploaderId) return;
    const files = [...e.clipboardData.items]
      .filter((it) => it.kind === 'file' && (it.type.startsWith('image/') || it.type === ''))
      .map((it) => it.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      e.preventDefault();   // don't paste the file's name as text
      void addFiles(files);
    }
  }

  async function submit(override?: string) {
    const text = (override ?? ask).trim();
    if ((!text && images.length === 0 && !attachment) || sending || upBusy) return;
    setSending(true);
    try {
      await onSend(text, images.length ? images : undefined);
      setAsk('');
      setImages([]);
    } finally {
      setSending(false);
    }
  }
  submitRef.current = submit;

  return (
    <form
      className={'assist-composer ' + className + (dragOver ? ' is-dragover' : '')}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      {attachment && <div className="assist-composer__att">{attachment}</div>}
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
      {/* Words on top, full width; the tools ride a bar beneath (founder
          2026-11-19: the placeholder broke onto two lines beside an empty
          column of icons — "move the text over so its 1 line"). */}
      <textarea
        className="assist-composer__input"
        rows={1}
        ref={taRef}
        value={ask}
        placeholder={placeholder}
        onChange={(e) => setAsk(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
        }}
      />
      <div className="assist-composer__row">
        {uploaderId && (
          <label className={'assist-composer__btn' + (upBusy ? ' is-live' : '')} aria-label="Add a photo">
            <Icon name="image" size={17} />
            <input type="file" accept="image/*,.heic,.heif" multiple hidden disabled={upBusy}
              onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </label>
        )}
        {(SR || iosApp) && (
          <button type="button" className={'assist-composer__btn' + (listening ? ' is-live' : '')}
            onClick={dictate} aria-label="Speak instead">
            <Icon name="mic" size={17} />
          </button>
        )}
        {kbHint && <span className="assist-composer__voiceword">Tap the mic on your keyboard</span>}
        {listening && usesLocalSpeech() && (localSt.state === 'loading'
          ? <span className="assist-composer__voiceword">Getting ready… {localSt.pct}%</span>
          : hearState === 'thinking' ? <span className="assist-composer__voiceword">Writing it out…</span>
          : !voice && hearState ? <span className="assist-composer__voiceword">Listening… tap the mic when done</span>
          : null)}
        {canSpeak() && !secondary && (
          <button type="button" className={'assist-composer__btn assist-composer__voice' + (voice ? ' is-live' : '')}
            onClick={toggleVoice} aria-pressed={voice}
            aria-label={voice ? 'Turn voice mode off' : 'Voice mode — talk, and hear the reply'}
            data-tip={voice ? 'Voice mode on — tap to turn off' : 'Voice mode'}>
            <Icon name="speaker" size={17} />
            {voice && <span className="assist-composer__voiceword">{speakingNow ? 'Speaking…' : listening ? 'Listening…' : canListen() ? 'Voice on' : 'Replies read aloud'}</span>}
          </button>
        )}
        <button className="assist-composer__send" type="submit"
          disabled={(!ask.trim() && images.length === 0 && !attachment) || sending || upBusy}
          aria-label="Send to your assistant">
          <Icon name="send" size={15} />
        </button>
      </div>
      {/* With voice mode on, the always-listening choice sits right here. */}
      {voice && !secondary && <VoiceSettings compact />}
    </form>
  );
}
