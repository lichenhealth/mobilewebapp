import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { VoiceChoice } from '../lib/dictation';
import OpenInBrowser from './OpenInBrowser';
import './LocalSpeechChoice.css';

/** THE iPHONE VOICE SHEET (founder 2026-11-26). Lichen's on-phone listener
 *  is switched off ("not high enough quality… we're just going to use
 *  what's on the phone"), so the iPhone home-screen app — which Apple keeps
 *  from its speech recognition — gets two honest paths, no download:
 *  VOICE CONVERSATIONS open Lichen in Safari or Chrome (the signed-in
 *  hand-off, voice on — Apple's recognition there), and VOICE-TO-TEXT uses
 *  the keyboard's own mic (Apple's dictation, right in the app). A third,
 *  quiet choice keeps voice mode in the app with replies read aloud.
 *  Opened by askIosVoice() in src/lib/dictation.ts; mounted once in
 *  App.tsx. (File name kept from the listener era.) */
type Req = { prefer: 'talk' | 'text'; resolve: (c: VoiceChoice) => void };

export default function LocalSpeechChoice() {
  const [req, setReq] = useState<Req | null>(null);
  const reqRef = useRef<Req | null>(null);
  reqRef.current = req;

  useEffect(() => {
    const h = (e: Event) => {
      reqRef.current?.resolve(null);
      setReq((e as CustomEvent<Req>).detail);
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
  function close(c: VoiceChoice) {
    reqRef.current?.resolve(c);
    setReq(null);
  }

  return (
    <div className="lsc" onClick={() => close(null)} role="dialog" aria-modal="true" aria-label="Using your voice">
      <div className="lsc__card" onClick={(e) => e.stopPropagation()}>
        <button className="lsc__x" onClick={() => close(null)} aria-label="Close">×</button>
        <h2 className="lsc__title">How would you like to use your voice?</h2>
        <div className={'lsc__opt' + (req.prefer === 'talk' ? ' is-lead' : '')}>
          <div className="lsc__opthead"><Icon name="speaker" size={18} /><strong>Voice conversations with Claude</strong></div>
          <p className="lsc__optp">You talk, and Claude talks back — hands free. Lichen opens in Safari, signed in on this same screen, with voice on.</p>
          <OpenInBrowser flags={{ voice: '1' }} />
          <button className="lsc__link" onClick={() => close('talk')}>Or stay here and just have replies read aloud</button>
        </div>
        <div className={'lsc__opt' + (req.prefer === 'text' ? ' is-lead' : '')}>
          <div className="lsc__opthead"><Icon name="mic" size={18} /><strong>Just voice-to-text</strong></div>
          <p className="lsc__optp">Tap the box, then the <strong>mic on your keyboard</strong> — your words appear as you speak, and you press send.</p>
          <button className="btn btn-primary lsc__btn" onClick={() => close('keyboard')}>Use my keyboard’s mic</button>
        </div>
        <p className="lsc__fine">On an iPhone only Safari can listen — Apple keeps speech recognition from home-screen apps and from Chrome — so for hands-free listening Lichen opens in Safari.</p>
      </div>
    </div>
  );
}
