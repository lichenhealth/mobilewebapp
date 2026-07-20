import './CalImportGuide.css';

/** Illustrated "where to look" mockups for the Google secret-address hunt —
 *  drawn, not screenshotted, so no real account data (or the secret address
 *  itself — it's a password) ever lands in the repo. Token-colored SVGs. */

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <figure className="calg__fig">
      <svg viewBox="0 0 320 110" className="calg__svg" role="img" aria-label={label}>
        {/* browser chrome */}
        <rect x="0" y="0" width="320" height="110" rx="8" fill="var(--bone-warm)" stroke="var(--bone-edge)" />
        <rect x="0" y="0" width="320" height="20" rx="8" fill="var(--bone-deep, #e7e2d8)" />
        <circle cx="12" cy="10" r="3" fill="var(--bone-edge)" />
        <circle cx="22" cy="10" r="3" fill="var(--bone-edge)" />
        <rect x="34" y="4" width="150" height="12" rx="6" fill="var(--bone)" />
        <text x="42" y="13" fontSize="8" fill="var(--ink-muted)" fontFamily="monospace">calendar.google.com</text>
        {children}
      </svg>
      <figcaption className="calg__cap">{label}</figcaption>
    </figure>
  );
}

export default function CalImportGuide() {
  return (
    <div className="calg">
      <Frame label="1 · At a computer: the gear (top right) → Settings">
        <circle cx="290" cy="34" r="9" fill="none" stroke="var(--peach)" strokeWidth="2" />
        <text x="290" y="38" fontSize="10" textAnchor="middle" fill="var(--ink)">⚙</text>
        <rect x="238" y="48" width="70" height="18" rx="4" fill="var(--bone)" stroke="var(--peach)" />
        <text x="246" y="60" fontSize="9" fill="var(--ink)">Settings</text>
      </Frame>

      <Frame label="2 · Left list: click YOUR calendar's name">
        <text x="14" y="40" fontSize="8" fill="var(--ink-faint)">Settings for my calendars</text>
        <rect x="10" y="46" width="110" height="16" rx="4" fill="var(--peach-tint)" stroke="var(--peach)" />
        <text x="16" y="57" fontSize="9" fill="var(--ink)">Your name</text>
        <text x="16" y="76" fontSize="9" fill="var(--ink-muted)">Birthdays</text>
        <text x="16" y="92" fontSize="9" fill="var(--ink-muted)">Tasks</text>
      </Frame>

      <Frame label="3 · Scroll to Integrate calendar → copy the SECRET address">
        <text x="14" y="38" fontSize="9" fontWeight="600" fill="var(--ink)">Integrate calendar</text>
        <text x="14" y="54" fontSize="8" fill="var(--ink-muted)">Public address in iCal format</text>
        <text x="14" y="74" fontSize="8" fill="var(--ink)">Secret address in iCal format</text>
        <rect x="10" y="80" width="240" height="16" rx="4" fill="var(--bone)" stroke="var(--peach)" strokeWidth="1.5" />
        <text x="16" y="91" fontSize="7.5" fill="var(--ink-muted)" fontFamily="monospace">https://…/private-••••••/basic.ics</text>
        <circle cx="272" cy="88" r="10" fill="none" stroke="var(--peach)" strokeWidth="2" />
        <text x="272" y="92" fontSize="9" textAnchor="middle" fill="var(--ink)">⧉</text>
      </Frame>
    </div>
  );
}
