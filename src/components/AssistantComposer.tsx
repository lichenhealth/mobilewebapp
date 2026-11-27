import { isHeic } from '../lib/heic';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { uploadPageImage } from '../lib/avatarApi';
import { iosCantListen } from '../lib/browserHandoff';
import { askIosVoice, askVoiceChoice, canDictate, startDictation, usesLocalSpeech, type DictationSession } from '../lib/dictation';
import { localSpeechAgreed, localSpeechStatusNow, useLocalSpeechStatus } from '../lib/localSpeech';
import { revealBelow } from '../lib/smartReveal';
import VoiceSettings from './VoiceSettings';
import VoiceMeter from './VoiceMeter';
import { canListen, canSpeak, heardOwnWords, setVoiceOn, unlockSpeech, stopSpeaking, useSpeaking, useVoiceMode } from '../lib/voice';
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
   *  voice-mode listen cue — one drop zone, one ear for the after-reply
   *  re-listen. It DOES wear the voice switch since 2026-11-27 (founder: the
   *  summary "seems to have only voice to text"): a spoken reply to the
   *  summary sends, the conversation opens, and its box speaks + listens. */
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
  const mirrorRef = useRef<HTMLDivElement>(null);
  const typedYet = useRef(false);
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    if (mirrorRef.current) mirrorRef.current.scrollTop = ta.scrollTop;
    // 'auto' (instant), never smooth: per-keystroke smooth scrolls cancel
    // each other into zero net motion (smartReveal.ts has the story).
    if (typedYet.current) revealBelow(ta.closest('form'), 'auto');
    typedYet.current = true;
  }, [ask]);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  // LIVE ROUGH WORDS (founder 2026-11-27: make it feel like talking to
  // Claude): the tail of the box the phone hasn't settled yet, shown faint.
  const [rough, setRough] = useState('');
  // Bumps each time the engine hears something — moves the voice bars.
  const [pulse, setPulse] = useState(0);
  // Each listening session's words count only while it's the live one: a
  // send (or a new session) retires it, so a late phrase can't refill a
  // box that was just sent.
  const gen = useRef(0);
  /** Settled words + rough words → the box, rough remembered as the tail. */
  const live = (base: string, final: string, r: string) => {
    const head = base + final;
    const tail = r ? (head && !/\s$/.test(head) ? ' ' : '') + r : '';
    setRough(tail);
    setAsk(head + tail);
  };
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
  const iosApp = !SR && iosCantListen();
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
    const my = ++gen.current;
    let final = '';
    const s = startDictation({
      onPhrase: (phrase) => { if (my !== gen.current) return; final = phrase; live(base, final, ''); setPulse((n) => n + 1); },
      onInterim: (r) => { if (my !== gen.current) return; live(base, final, r); if (r) setPulse((n) => n + 1); },
      onEnd: () => { setListening(false); setHearState(null); setRough(''); dictation.current = null; },
      onError: micErr,
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
  // WHY NOTHING WAS HEARD (founder 2026-11-27, voice on her phone "didn't
  // pick anything up"): a session that ends empty used to leave the switch
  // reading "Voice on" with nobody listening. Now it says so, with a tap to
  // try again; a refused microphone says that instead.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  // THINKING (2026-11-27): between a spoken send and the reply being read
  // aloud, the pill says Claude is working on it — never a blank wait.
  const [thinking, setThinking] = useState(false);
  useEffect(() => {
    if (!thinking) return;
    if (speakingNow || listening) { setThinking(false); return; }
    const t = window.setTimeout(() => setThinking(false), 90_000);
    return () => window.clearTimeout(t);
  }, [thinking, speakingNow, listening]);
  const micErr = (code: string) => {
    if (code === 'not-allowed' || code === 'service-not-allowed') setVoiceNote('Lichen can’t use your microphone — allow it for this site in your browser’s settings, then tap to talk');
    else if (code === 'network') setVoiceNote('The speech service didn’t answer — check your connection, then tap to talk');
    else if (code === 'audio-capture') setVoiceNote('No microphone found — tap to try again');
  };
  const submitRef = useRef<(t?: string) => Promise<void>>(async () => {});
  // TALK, THEN SEND — LIKE A RADIO (founder 2026-11-27: "transcribe what is
  // being spoken, and show that it's being recorded, and then we have the
  // arrow to send it, or the person says over… so that it's easier"): voice
  // mode no longer sends on the first pause. Words write into the box as
  // they come (a pause is just a pause), a red dot says it's recording, and
  // the message goes when they tap the arrow or say "send".
  const voiceSent = useRef(false);
  const askNow = useRef('');
  askNow.current = ask;
  // "send" counts only as its OWN word after a pause (a new stretch of
  // speech, or set off by the engine's punctuation), or "okay, send" /
  // "please send" / "send it now" — so "send it to Gabe" in one breath is a
  // sentence, not a send. (Was "over", radio-style, for an hour; founder
  // 2026-11-27: "maybe we say send when we're ready to send, or we press the
  // button, so it's the same.")
  const SEND_ALONE = /^\s*(?:(?:ok(?:ay)?|please|and)\s+)?send(?:\s+it(?:\s+now)?)?[\s.!?]*$/i;
  const SEND_SET_OFF = /[,.;!?]\s*(?:(?:ok(?:ay)?|please)\s+)?send(?:\s+it(?:\s+now)?)?[\s.!?]*$/i;
  const SEND_TAIL = /[\s,.;:!?-]*(?:\b(?:ok(?:ay)?|please|and)\s+)?\bsend(?:\s+it(?:\s+now)?)?[\s.!?]*$/i;
  const saidSend = (prev: string, phrase: string) => {
    const added = phrase.startsWith(prev) ? phrase.slice(prev.length) : '';
    return (!!prev && SEND_ALONE.test(added)) || SEND_SET_OFF.test(phrase);
  };
  function voiceListen() {
    unlockSpeech();
    if (!SR) return;
    // A session still winding down (stop() is asynchronous) used to make
    // the next listen quietly do nothing — stop it and start fresh.
    if (dictation.current) {
      const old = dictation.current;
      dictation.current = null;
      try { old.stop(); } catch { /* */ }
      window.setTimeout(() => voiceListen(), 350);
      return;
    }
    voicePhrase.current = '';
    voiceSent.current = false;
    setVoiceNote(null);
    let errored = false;
    const base = askNow.current.trim() ? askNow.current.replace(/\s+$/, '') + ' ' : '';
    const sendIt = (text: string) => {
      if (voiceSent.current) return;
      voiceSent.current = true;
      dictation.current?.stop();
      const said = text.trim();
      // The brain's own reply coming back through the speakers is never
      // sent as the person's words.
      if (!said || heardOwnWords(said)) { setAsk(''); if (said) setVoiceNote('That was me talking — tap here, then talk'); return; }
      void submitRef.current(said);
    };
    let mine: DictationSession | null = null;
    const my = ++gen.current;
    const s = startDictation({
      continuous: true,
      onPhrase: (phrase) => {
        if (voiceSent.current || my !== gen.current) return;
        setPulse((n) => n + 1);
        if (saidSend(voicePhrase.current, phrase)) { const t = (base + phrase.replace(SEND_TAIL, '')).trim(); setRough(''); setAsk(t); sendIt(t); return; }
        voicePhrase.current = phrase;
        live(base, phrase, '');
      },
      onInterim: (r) => {
        if (voiceSent.current || my !== gen.current) return;
        live(base, voicePhrase.current, r);
        if (r) setPulse((n) => n + 1);
      },
      onState: setHearState,
      onError: (code) => { errored = true; micErr(code); if (code === 'no-speech') setVoiceNote('Didn’t hear anything — tap to talk'); },
      onEnd: () => {
        // A replaced session ending late must not clear the live one.
        if (dictation.current && dictation.current !== mine) return;
        setListening(false); setHearState(null); setRough(''); dictation.current = null;
        if (voiceSent.current) return;
        // The phone stopped listening on its own (a long silence): the words
        // stay in the box for the arrow; one tap keeps talking.
        if (voicePhrase.current.trim()) setVoiceNote('Paused — tap here to keep talking, or tap the arrow to send');
        else if (!errored) setVoiceNote('Didn’t catch that — tap to talk');
      },
    });
    mine = s;
    dictation.current = s;
    setListening(!!s);
    if (!s) setVoiceNote('Couldn’t start listening — tap to try again');
  }
  function toggleVoice() {
    unlockSpeech();
    // While the brain is reading aloud, a tap means "stop — I'll talk now",
    // not "voice off" (founder 2026-11-27: stuck on Speaking…).
    if (voice && speakingNow) { stopSpeaking(); window.setTimeout(() => voiceListen(), 250); return; }
    if (voice) { dictation.current?.stop(); stopSpeaking(); setVoiceOn(false); setVoiceNote(null); return; }
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
    if (voice) unlockSpeech();
    // Sending retires the live session — its late words never refill the box.
    gen.current++;
    if (voice) voiceSent.current = true;
    if (dictation.current) dictation.current.stop();
    setRough('');
    if ((!text && images.length === 0 && !attachment) || sending || upBusy) return;
    setSending(true);
    try {
      await onSend(text, images.length ? images : undefined);
      if (voice) setThinking(true);
      setAsk('');
      setImages([]);
      setVoiceNote(null);
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
      <div className="assist-composer__field">
        <textarea
          className={'assist-composer__input' + (rough ? ' is-ghosted' : '')}
          rows={1}
          ref={taRef}
          value={ask}
          placeholder={placeholder}
          onChange={(e) => { setRough(''); setAsk(e.target.value); }}
          onScroll={(e) => { if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop; }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); }
          }}
        />
        {rough && ask.endsWith(rough) && (
          <div className="assist-composer__mirror" ref={mirrorRef} aria-hidden="true">
            {ask.slice(0, ask.length - rough.length)}<span className="assist-composer__rough">{rough}</span>
          </div>
        )}
      </div>
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
        {listening && !voice && !usesLocalSpeech() && (
          <span className="assist-composer__voiceword"><VoiceMeter active pulse={pulse} />Listening — tap the mic when done</span>
        )}
        {kbHint && <span className="assist-composer__voiceword">Tap the mic on your keyboard</span>}
        {/* VOICE ON, NOBODY LISTENING (founder 2026-11-27: "opened up voice
            mode and spoke again but nothing happened"): switching voice on in
            settings, or arriving with it on, can't start the mic by itself —
            a phone needs a tap. Say so, and make the line the tap. */}
        {voice && !voiceNote && !listening && !speakingNow && !sending && !thinking && (
          <button type="button" className="assist-composer__voicenote"
            onClick={() => { if (SR && !iosApp) voiceListen(); else { taRef.current?.focus(); setKbHint(true); window.setTimeout(() => setKbHint(false), 6000); } }}>
            {SR && !iosApp ? 'Voice is on — tap here, then talk' : 'Voice is on — tap the box, then the mic on your keyboard, to talk'}
          </button>
        )}
        {voice && listening && !usesLocalSpeech() && (
          <span className="assist-composer__voicenote is-hint">Talk as long as you like — say “send” or tap the arrow</span>
        )}
        {voiceNote && !listening && !speakingNow && (
          <button type="button" className="assist-composer__voicenote"
            onClick={() => { if (voice) voiceListen(); else { setVoiceNote(null); dictate(); } }}>
            {voiceNote}
          </button>
        )}
        {listening && usesLocalSpeech() && (localSt.state === 'loading'
          ? <span className="assist-composer__voiceword">Getting ready… {localSt.pct}%</span>
          : hearState === 'thinking' ? <span className="assist-composer__voiceword">Writing it out…</span>
          : !voice && hearState ? <span className="assist-composer__voiceword">Listening… tap the mic when done</span>
          : null)}
        {canSpeak() && (
          <button type="button" className={'assist-composer__btn assist-composer__voice' + (voice ? ' is-live' : '')}
            onClick={toggleVoice} aria-pressed={voice}
            aria-label={voice ? 'Turn voice mode off' : 'Voice mode — talk, and hear the reply'}
            data-tip={voice ? (speakingNow ? 'Tap to stop and talk' : 'Voice mode on — tap to turn off') : 'Voice mode'}>
            <Icon name="speaker" size={17} />
            {voice && <span className="assist-composer__voiceword">{speakingNow ? 'Speaking… tap to talk' : listening ? <><VoiceMeter active pulse={pulse} />Listening</> : thinking ? <><span className="assist-composer__thinking" aria-hidden="true"><i /><i /><i /></span>Thinking…</> : canListen() ? 'Voice on' : 'Replies read aloud'}</span>}
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
