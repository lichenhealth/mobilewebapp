import { canListen, canSpeak, setVoiceOn, setWakeAlways, useVoiceMode, useWakeAlways } from '../lib/voice';
import './VoiceSettings.css';

/** THE AUDIO SETTINGS (founder 2026-11-26: "we can have a setting for audio,
 *  which is that Claude is always listening or the brain is always listening
 *  for Hey Brain or Hey Claude"). Per device — each phone or computer keeps
 *  its own choice. `compact` = the strip under a brain composer. */
export default function VoiceSettings({ compact = false }: { compact?: boolean }) {
  const voice = useVoiceMode();
  const wake = useWakeAlways();
  const listen = canListen();
  const iosApp = !listen && /iP(hone|ad|od)/.test(navigator.userAgent);
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
        <input type="checkbox" checked={wake && listen} disabled={!listen} onChange={(e) => setWakeAlways(e.target.checked)} />
        <span>
          <strong>Always listen for “Hey Brain”</strong> (or “Hey Claude”) — then just say what you need, from any screen.
          {listen
            ? ' Listens only while Lichen is open on your screen; nothing that doesn’t start with “Hey Brain” is ever sent.'
            : iosApp
              ? ' Not in the iPhone home-screen app yet — Apple doesn’t let installed web apps listen. Open lichen.health in Safari for hands-free.'
              : ' This browser can’t listen — try Chrome or Safari.'}
        </span>
      </label>
      {!compact && listen && (
        <p className="vset__fine">Your browser turns speech into words (Chrome sends the audio to Google’s speech service; Safari does much of it on the device). Lichen never records or keeps audio — only the words you send.</p>
      )}
    </div>
  );
}
