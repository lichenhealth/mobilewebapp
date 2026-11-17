import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { useAuth } from '../auth/AuthProvider';
import { addExternalCalendar, listExternalCalendars, syncExternalCalendars } from '../lib/calendarApi';
import { oneTapLinks } from '../lib/calShare';
import './CalFeedCard.css';

/** ADD THIS CALENDAR IN ONE TAP (founder 2026-11-17: "I saw the message on
 *  Gabe's phone teaching him how to add my lichen cal. Can't we just have his
 *  assistant do it for him?"). Rides a shared-calendar message in chat (and a
 *  brain reply): Google's own add screen, Apple's subscribe sheet, or straight
 *  into their Lichen calendar — no copy-paste, no settings hunt. The last
 *  confirm on Google/Apple is theirs (their own account's screen). */
export default function CalFeedCard({ url, name, mine }: { url: string; name?: string; mine?: boolean }) {
  const { user } = useAuth();
  const [inLichen, setInLichen] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const links = oneTapLinks(url);
  const calName = name ? `${name}'s calendar` : 'A shared calendar';

  useEffect(() => {
    if (!user || mine) return;
    void listExternalCalendars(user.id).then((rows) => setInLichen(rows.some((r) => r.url === url)));
  }, [user, url, mine]);

  async function addLichen() {
    if (!user || busy) return;
    setBusy(true); setMsg(null);
    try {
      await addExternalCalendar(user.id, calName, url);
      await syncExternalCalendars({ force: true }).catch(() => {});
      setInLichen(true);
    } catch (e) { setMsg((e as Error).message || 'Couldn’t add it — try again.'); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMsg('Link copied ✓'); }
    catch { setMsg('Press and hold to copy: ' + url); }
  }

  return (
    <div className="calfeed">
      <p className="calfeed__head"><Icon name="calendar" size={16} /> <strong>{calName}</strong></p>
      {mine ? (
        <p className="calfeed__fine">They get one-tap buttons here to add it to Google, Apple or their Lichen calendar.</p>
      ) : (
        <>
          <div className="calfeed__btns">
            <a className="calfeed__btn" href={links.google} target="_blank" rel="noreferrer">Add to Google Calendar</a>
            <a className="calfeed__btn" href={links.apple}>Add to Apple Calendar</a>
            {inLichen
              ? <Link className="calfeed__btn calfeed__btn--done" to="/calendar">In your Lichen calendar ✓</Link>
              : <button type="button" className="calfeed__btn" disabled={busy || inLichen === null} onClick={() => void addLichen()}>{busy ? 'Adding…' : 'Add to my Lichen calendar'}</button>}
          </div>
          <p className="calfeed__fine">Google or Apple shows its own “Add calendar?” screen — one more tap there and it’s in. <button type="button" className="calfeed__copy" onClick={() => void copy()}>Copy link</button></p>
        </>
      )}
      {msg && <p className="calfeed__fine">{msg}</p>}
    </div>
  );
}
