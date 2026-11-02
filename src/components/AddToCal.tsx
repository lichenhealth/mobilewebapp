import { icsDataUri, googleCalUrl, outlookCalUrl, office365CalUrl, type EventForCal } from '../lib/ics';

/** ONE smart add-to-calendar card (founder 2026-11-02: "links to the major
 *  calendars out there to seamlessly add it to your most used cal", then the
 *  same day's markup: "put the 4 calendar options in a centered rectangle…
 *  Maybe we make the cal add options buttons? So they feel different than
 *  the links?"): Google · Apple (.ics) · Outlook · Office 365 as peach pill
 *  BUTTONS inside one centered framed card, built from one EventForCal and
 *  worn by every guest confirmation surface — the .ics stays the universal
 *  catch-all for anything else. */
export default function AddToCal({ ev, file = 'lichen-booking.ics' }: {
  ev: EventForCal;
  file?: string;
}) {
  const cls = 'btn addcal__btn';
  return (
    <div className="addcal">
      <a className={cls} href={googleCalUrl(ev)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
      <a className={cls} href={icsDataUri(ev)} download={file}>Apple Calendar (.ics)</a>
      <a className={cls} href={outlookCalUrl(ev)} target="_blank" rel="noopener noreferrer">Outlook</a>
      <a className={cls} href={office365CalUrl(ev)} target="_blank" rel="noopener noreferrer">Office 365</a>
    </div>
  );
}
