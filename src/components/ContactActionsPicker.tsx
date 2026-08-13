import type { ContactActionKind } from './PublicPage';
import type { ContactInfo } from './ContactFields';
import './ContactActionsPicker.css';

/** "How do you want people to get in touch" (founder 2026-08-11) — the
 *  public page's CTA picker, multi-select, a checkbox list rather than
 *  chips. Shared by Profile.tsx's Public page section and every space's
 *  Public Profile Builder. Checking a row reveals the Contact & hours
 *  field its button is built from — prefilled when it already exists,
 *  empty to fill in right here when it doesn't (founder 2026-08-11:
 *  "smart enough to pull in the information if it exists... but have it
 *  populate in the other aspects of the app as well"). It edits the SAME
 *  contact object as the Contact & hours section below, so one value
 *  feeds the CTA, the Practical list, and everywhere else. Styling rides
 *  the existing .prof__consent idiom (Privacy's rows). */

const ROWS: {
  kind: ContactActionKind; field: keyof ContactInfo;
  label: string; hint: string; placeholder: string;
}[] = [
  { kind: 'call',  field: 'phone',   label: 'Call',
    hint: 'A "Call us" button — uses the phone number from Contact & hours.',
    placeholder: '(555) 123-4567' },
  { kind: 'book',  field: 'booking', label: 'Book',
    hint: 'A "Book a time" button — uses the booking link from Contact & hours.',
    placeholder: 'https://… your booking page' },
  { kind: 'email', field: 'email',   label: 'Email',
    hint: 'A "Get in touch" button — uses the email from Contact & hours.',
    placeholder: 'hello@…' },
  { kind: 'visit', field: 'address', label: 'Visit',
    hint: 'A "Visit us" button — opens the address from Contact & hours in maps.',
    placeholder: 'Street, town' },
];

export default function ContactActionsPicker({ value, onChange, contact, onContact }: {
  value: ContactActionKind[];
  onChange: (next: ContactActionKind[]) => void;
  contact: ContactInfo;
  onContact: (patch: Partial<ContactInfo>) => void;
}) {
  const toggle = (kind: ContactActionKind) =>
    onChange(value.includes(kind) ? value.filter((k) => k !== kind) : [...value, kind]);
  return (
    <>
      {ROWS.map((r) => {
        const on = value.includes(r.kind);
        const cur = contact[r.field] ?? '';
        return (
          <div key={r.kind}>
            <label className="prof__consent">
              <input type="checkbox" checked={on} onChange={() => toggle(r.kind)} />
              <span>
                <strong>{r.label}</strong>
                <em>{r.hint}</em>
              </span>
            </label>
            {/* Outside the <label> so typing never toggles the checkbox. */}
            {on && (
              <div className="capk__fill">
                <input
                  className="prof__input"
                  value={cur}
                  onChange={(e) => onContact({ [r.field]: e.target.value })}
                  placeholder={r.placeholder}
                  aria-label={`${r.label} — the Contact & hours field this button uses`}
                />
                <p className="prof__hint capk__hint">
                  {cur.trim()
                    ? 'Synced with Contact & hours — one value, everywhere it appears.'
                    : 'Nothing on file yet — add it here and it fills Contact & hours too.'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
