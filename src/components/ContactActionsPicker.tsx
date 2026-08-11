import type { ContactActionKind } from './PublicPage';

/** "How do you want people to get in touch" (founder 2026-08-11) — the
 *  public page's CTA picker, multi-select, a checkbox list rather than
 *  chips. Shared by Profile.tsx's Web-page view and every space's Public
 *  Profile Builder, same as ContactFields/PageTabsEditor. Each row's hint
 *  names the Contact & hours field its link is derived from — which is
 *  also why a checked action might not show on the page yet. Styling
 *  rides the existing .prof__consent idiom (Privacy's rows). */

const ROWS: { kind: ContactActionKind; label: string; hint: string }[] = [
  { kind: 'call',  label: 'Call',  hint: 'A "Call us" button — uses the phone number from Contact & hours.' },
  { kind: 'book',  label: 'Book',  hint: 'A "Book a time" button — uses the booking link from Contact & hours.' },
  { kind: 'email', label: 'Email', hint: 'A "Get in touch" button — uses the email from Contact & hours.' },
  { kind: 'visit', label: 'Visit', hint: 'A "Visit us" button — opens the address from Contact & hours in maps.' },
];

export default function ContactActionsPicker({ value, onChange }: {
  value: ContactActionKind[];
  onChange: (next: ContactActionKind[]) => void;
}) {
  const toggle = (kind: ContactActionKind) =>
    onChange(value.includes(kind) ? value.filter((k) => k !== kind) : [...value, kind]);
  return (
    <>
      {ROWS.map((r) => (
        <label className="prof__consent" key={r.kind}>
          <input type="checkbox" checked={value.includes(r.kind)} onChange={() => toggle(r.kind)} />
          <span>
            <strong>{r.label}</strong>
            <em>{r.hint}</em>
          </span>
        </label>
      ))}
    </>
  );
}
