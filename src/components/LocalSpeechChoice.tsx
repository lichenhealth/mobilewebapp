import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { agreeLocalSpeech, localSpeechAgreed, LOCAL_SPEECH_MB, useLocalSpeechStatus } from '../lib/localSpeech';
import { isIosHomeScreenApp } from '../lib/browserHandoff';
import type { VoiceChoice } from '../lib/dictation';
import './LocalSpeechChoice.css';

/** THE VOICE CHOICE (founder 2026-11-26, replacing a bare OK/Cancel box:
 *  "the pop-up needs to show that you can turn on voice conversations with
 *  Claude and it requires this download, or like, no, I just want to use
 *  voice to text so the person understands the difference" + "It didn't
 *  give me any indication that that download had happened or taken me
 *  where I need to go to finish it").
 *  Two cards side by side in meaning: VOICE CONVERSATIONS (you talk, Claude
 *  talks back, hands free) and JUST VOICE-TO-TEXT (your words land in the
 *  box, you send). On the iPhone home-screen app, plain voice-to-text
 *  points first to the keyboard's own mic — Apple's dictation is instant
 *  and needs no download. Choosing the listener shows the download's
 *  progress right here, then a Start button: the person's tap is the next
 *  step (iPhones only start audio from a tap). Opened by askVoiceChoice()
 *  in src/lib/dictation.ts; mounted once in App.tsx. */
type Req = { prefer: 'talk' | 'text'; resolve: (c: VoiceChoice) => void };

export default function LocalSpeechChoice() {
  const [req, setReq] = useState<Req | null>(null);
  const [picked, setPicked] = useState<'talk' | 'text' | null>(null);
  const st = useLocalSpeechStatus();
  const reqRef = useRef<Req | null>(null);
  reqRef.current = req;

  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<Req>).detail;
      reqRef.current?.resolve(null);
      setReq(d);
      // Already said yes (download still running): straight to its progress.
      setPicked(localSpeechAgreed() ? d.prefer : null);
    };
    window.addEventListener('lichen:voice-choice', h);
    return () => window.removeEventListener('lichen:voice-choice', h);
  }, []);
  useEffect(() => {
    if (!req) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(null); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;
  const iosApp = isIosHomeScreenApp();

  function close(c: VoiceChoice) {
    reqRef.current?.resolve(c);
    setReq(null); setPicked(null);
  }
  function choose(c: 'talk' | 'text') {
    setPicked(c);
    agreeLocalSpeech(); // starts the download; progress shows below
  }

  const ready = st.state === 'ready';
  const pct = Math.max(0, Math.min(100, Math.round(st.pct || 0)));

  return (
    <div className="lsc" onClick={() => close(null)} role="dialog" aria-modal="true" aria-label="Using your voice">
      <div className="lsc__card" onClick={(e) => e.stopPropagation()}>
        <button className="lsc__x" onClick={() => close(null)} aria-label="Close">×</button>
        {!picked ? (
          <>
            <h2 className="lsc__title">How would you like to use your voice?</h2>
            <div className={'lsc__opt' + (req.prefer === 'talk' ? ' is-lead' : '')}>
              <div className="lsc__opthead"><Icon name="speaker" size={18} /><strong>Voice conversations with Claude</strong></div>
              <p className="lsc__optp">You talk, and Claude talks back. When you finish speaking it answers out loud, then listens for your reply — hands free.</p>
              <p className="lsc__optfine">Needs a one-time download of about {LOCAL_SPEECH_MB} MB (Wi-Fi is best).</p>
              <button className="btn btn-primary lsc__btn" onClick={() => choose('talk')}>Turn on voice conversations</button>
            </div>
            <div className={'lsc__opt' + (req.prefer === 'text' ? ' is-lead' : '')}>
              <div className="lsc__opthead"><Icon name="mic" size={18} /><strong>Just voice-to-text</strong></div>
              <p className="lsc__optp">Say it, and your words appear in the box. You read it over and press send — Claude answers in writing.</p>
              {iosApp ? (
                <>
                  <p className="lsc__optfine">Fastest on iPhone: tap the box, then the <strong>mic on your keyboard</strong>. No download.</p>
                  <button className="btn btn-primary lsc__btn" onClick={() => close('keyboard')}>Use my keyboard’s mic</button>
                  <button className="lsc__link" onClick={() => choose('text')}>Or use Lichen’s private on-phone listener ({LOCAL_SPEECH_MB} MB download, slower)</button>
                </>
              ) : (
                <>
                  <p className="lsc__optfine">Needs the same one-time {LOCAL_SPEECH_MB} MB download.</p>
                  <button className="btn btn-ghost lsc__btn" onClick={() => choose('text')}>Use voice-to-text</button>
                  <button className="lsc__link" onClick={() => close('keyboard')}>Or just type — your keyboard’s mic works too</button>
                </>
              )}
            </div>
            <p className="lsc__fine">With Lichen’s listener, this phone turns your speech into words itself — your voice never leaves it.</p>
          </>
        ) : (
          <>
            <h2 className="lsc__title">{picked === 'talk' ? 'Setting up voice conversations' : 'Setting up voice-to-text'}</h2>
            {st.state === 'error' ? (
              <>
                <p className="lsc__optp">The download didn’t finish{st.message ? ` — ${st.message}` : ''}.</p>
                <button className="btn btn-primary lsc__btn" onClick={() => agreeLocalSpeech()}>Try again</button>
              </>
            ) : ready ? (
              <>
                <p className="lsc__ready">✓ Ready on this phone</p>
                <p className="lsc__optp">{picked === 'talk'
                  ? 'Tap below and start talking. Claude will answer out loud, then listen again. Tap the speaker button any time to stop.'
                  : 'Tap below and start talking. Your words appear in the box as you pause — tap the mic again when you’re done.'}</p>
                <button className="btn btn-primary lsc__btn" onClick={() => close(picked)}>
                  {picked === 'talk' ? 'Start talking with Claude' : 'Start voice-to-text'}
                </button>
              </>
            ) : (
              <>
                <p className="lsc__optp">Downloading the listener — about {LOCAL_SPEECH_MB} MB, one time only. Keep Lichen open.</p>
                <div className="lsc__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <p className="lsc__pct">{pct}%</p>
                <button className="lsc__link" onClick={() => close(null)}>Close — it keeps downloading</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
