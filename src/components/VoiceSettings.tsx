import { canListen, canSpeak, setVoiceOn, setWakeAlways, useVoiceMode, useWakeAlways } from '../lib/voice';
import { ensureLocalSpeech, usesLocalSpeech } from '../lib/dictation';
import {
  forgetLocalSpeech, localSpeechAgreed, localSpeechOnly, localSpeechSupported, setLocalSpeechOnly,
  useLocalSpeechPrefs, useLocalSpeechStatus, LOCAL_SPEECH_MB,
} from '../lib/localSpeech';
import { speechRecognition } from '../lib/dictation';
import { isIosHomeScreenApp } from '../lib/browserHandoff';
import OpenInBrowser from './OpenInBrowser';
import './VoiceSettings.css';

/** THE AUDIO SETTINGS (founder 2026-11-26: "we can have a setting for audio,
 *  which is that Claude is always listening or the brain is always listening
 *  for Hey Brain or Hey Claude"). Per device — each phone or computer keeps
 *  its own choice. `compact` = the strip under a brain composer.
 *  Where this device hears with on-phone Whisper (2026-11-26: the iPhone
 *  home-screen app, or anyone who picks private listening), the words are
 *  made right here and the audio never leaves the device. */
export default function VoiceSettings({ compact = false }: { compact?: boolean }) {
  const voice = useVoiceMode();
  const wake = useWakeAlways();
  useLocalSpeechPrefs();
  const st = useLocalSpeechStatus();
  const listen = canListen();
  const local = usesLocalSpeech();
  const browserCanToo = !!speechRecognition() && localSpeechSupported();
  // The iPhone home-screen app recommends the browser hand-off even though
  // the on-phone listener could run here — Apple's recognition is far faster
  // and more accurate (founder 2026-11-26).
  const iosApp = isIosHomeScreenApp();
  if (!canSpeak()) return compact ? null : <p className="vset__fine">This browser can’t speak or listen — try Safari or Chrome.</p>;
  return (
    <div className={'vset' + (compact ? ' vset--compact' : '')}>
      {!compact && (
        <label className="vset__row">
          <input type="checkbox" checked={voice} onChange={(e) => setVoiceOn(e.target.checked)} />
          <span><strong>Voice mode</strong> — the brain reads its replies aloud, and listens for your answer.</span>
        </label>
      )}
      <label className={'vset__row' + (listen ? '' : ' is-off')}>
        <input type="checkbox" checked={wake && listen} disabled={!listen}
          onChange={(e) => { const v = e.target.checked; if (!v) { setWakeAlways(false); return; } void ensureLocalSpeech('talk').then((ok) => { if (ok) setWakeAlways(true); }); }} />
        <span>
          <strong>Always listen for “Hey Brain”</strong> (or “Hey Claude”) — then just say what you need, from any screen.
          {listen && !iosApp
            ? ' Listens only while Lichen is open on your screen; nothing that doesn’t start with “Hey Brain” is ever sent.'
            : iosApp
              ? ' Best in your browser — Lichen opens there signed in with Hey Brain on, using Apple’s speech recognition. (It also works here with Lichen’s slower on-phone listener.)'
              : ' This browser can’t listen — try Chrome or Safari.'}
          {local && listen && ' Uses more battery while on.'}
        </span>
      </label>
      {iosApp && <OpenInBrowser flags={{ voice: '1', wake: '1' }} />}
      {!compact && browserCanToo && (
        <label className="vset__row">
          <input type="checkbox" checked={localSpeechOnly()}
            onChange={(e) => {
              const v = e.target.checked;
              if (!v || localSpeechAgreed()) { setLocalSpeechOnly(v); return; }
              // Mark the preference first so the sheet knows Lichen's own
              // listener is the one being set up; undo if they back out.
              setLocalSpeechOnly(true);
              void ensureLocalSpeech('text').then((ok) => { if (!ok) setLocalSpeechOnly(false); });
            }} />
          <span><strong>Hear me on this device only</strong> — private listening: your words are made right here instead of by your browser’s speech service.</span>
        </label>
      )}
      {local && localSpeechAgreed() && (st.state === 'loading' || st.state === 'error') && (
        <p className="vset__fine">{st.state === 'loading' ? `Getting the listener ready on this device… ${st.pct}%` : 'The on-device listener couldn’t load — check your connection and try the mic again.'}</p>
      )}
      {!compact && listen && (
        <p className="vset__fine">
          {local
            ? 'This device turns what you say into words itself, with open-source Whisper — the audio is never sent anywhere, and Lichen never records or keeps it. Only the words you send leave your device.'
            : 'Your browser turns speech into words (Chrome sends the audio to Google’s speech service; Safari does much of it on the device). Lichen never records or keeps audio — only the words you send.'}
          {local && localSpeechAgreed() && !compact && <> <button type="button" className="vset__link" onClick={() => forgetLocalSpeech()}>Turn off on-device listening</button></>}
        </p>
      )}
    </div>
  );
}
