import { icsDataUri, googleCalUrl, outlookCalUrl, office365CalUrl, type EventForCal } from '../lib/ics';

/** ONE smart add-to-calendar row (founder 2026-11-02: "links to the major
 *  calendars out there to seamlessly add it to your most used cal"):
 *  Google · Apple (.ics) · Outlook · Office 365, all built from one
 *  EventForCal, worn by every guest confirmation surface — the .ics stays
 *  the universal catch-all for anything else. */
export default function AddToCal({ ev, file = 'lichen-booking.ics', btnClass = 'btn bkg__btn' }: {
  ev: EventForCal;
  file?: string;
  btnClass?: string;
}) {
  return (
    <div className="addcal">
      <a className={btnClass} href={googleCalUrl(ev)} target="_blank" rel="noopener noreferrer">Google Calendar</a>
      <a className={btnClass} href={icsDataUri(ev)} download={file}>Apple Calendar (.ics)</a>
      <a className={btnClass} href={outlookCalUrl(ev)} target="_blank" rel="noopener noreferrer">Outlook</a>
      <a className={btnClass} href={office365CalUrl(ev)} target="_blank" rel="noopener noreferrer">Office 365</a>
    </div>
  );
}
