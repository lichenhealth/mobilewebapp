import { LichenMark } from './LichenMark';
import '../routes/FrontDoor.css';

// The website's persistent top nav (founder 2026-07-31): app pages that
// signed-out visitors read (About, Donate, posts) wear the SAME header as
// the static marketing pages — same doors, same order. Full-page
// navigations on purpose: the logo and most doors lead to static pages
// served filesystem-first, and "/" must hit the server so its redirect to
// /welcome fires (an SPA navigate('/') would land on the retired FrontDoor).
const DOORS: [string, string][] = [
  ['Home', '/'],
  ['About', '/about'],
  ['Care', '/project/care'],
  ['Business', '/project/business'],
  ['Platform', '/project/platform'],
  ['The Economy', '/economy'],
  ['Donate', '/donate'],
  ['Get Involved', '/get-involved'],
  ['Events', '/events'],
];

export default function SiteHeader() {
  return (
    <header className="fdoor__head">
      <a className="fdoor__brand" href="/">
        <LichenMark size={34} />
        <span>Lichen</span>
      </a>
      <nav className="fdoor__nav">
        {DOORS.map(([label, href]) => <a key={href} href={href}>{label}</a>)}
      </nav>
      <div className="fdoor__ways">
        <a className="fdoor__signin" href="/login">Sign in</a>
        <a className="fdoor__cta" href="/signup">Request an invitation</a>
      </div>
    </header>
  );
}
