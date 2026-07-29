import './ContactFields.css';

// The facts a public page needs (founder 2026-07-28: "your Lichen profile
// replaces what you'd need for a website"). Stored as one jsonb blob so
// adding a field later costs no migration.
export interface ContactInfo {
  website?: string;
  email?: string;
  phone?: string;
  booking?: string;
  hours?: string;
  address?: string;
  instagram?: string;
  facebook?: string;
}

const FIELDS: { key: keyof ContactInfo; label: string; placeholder: string }[] = [
  { key: 'website', label: 'Website', placeholder: 'https://…' },
  { key: 'email', label: 'Email for enquiries', placeholder: 'hello@…' },
  { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567' },
  { key: 'booking', label: 'Booking link', placeholder: 'https://…' },
  { key: 'hours', label: 'Hours', placeholder: 'Tue–Sat, 9–5 · by appointment' },
  { key: 'address', label: 'Address shown publicly', placeholder: 'Street, town' },
  { key: 'instagram', label: 'Instagram', placeholder: '@handle' },
  { key: 'facebook', label: 'Facebook', placeholder: 'facebook.com/…' },
];

export default function ContactFields({ value, onChange, lead }: {
  value: ContactInfo;
  onChange: (next: ContactInfo) => void;
  lead?: string;
}) {
  return (
    <div className="contactf">
      {lead && <p className="contactf__lead">{lead}</p>}
      <div className="contactf__grid">
        {FIELDS.map((f) => (
          <label className="contactf__field" key={f.key}>
            <span className="contactf__label">{f.label}</span>
            <input
              className="contactf__input"
              value={value[f.key] ?? ''}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
              placeholder={f.placeholder}
            />
          </label>
        ))}
      </div>
      <p className="contactf__note">
        Anything you fill in here is <strong>public</strong> — it appears on your page for
        anyone on the web. Leave a field empty to keep it off.
      </p>
    </div>
  );
}

/** Read-only display for the public page. */
export function ContactList({ contact }: { contact: ContactInfo }) {
  const rows: [string, string, string?][] = [];
  if (contact.address) rows.push(['Address', contact.address]);
  if (contact.hours) rows.push(['Hours', contact.hours]);
  if (contact.phone) rows.push(['Phone', contact.phone, `tel:${contact.phone.replace(/[^\d+]/g, '')}`]);
  if (contact.email) rows.push(['Email', contact.email, `mailto:${contact.email}`]);
  if (contact.website) rows.push(['Website', contact.website.replace(/^https?:\/\//, ''), contact.website]);
  if (contact.booking) rows.push(['Book', 'Book a time', contact.booking]);
  if (contact.instagram) rows.push(['Instagram', contact.instagram,
    `https://instagram.com/${contact.instagram.replace(/^@/, '')}`]);
  if (contact.facebook) rows.push(['Facebook', contact.facebook,
    contact.facebook.startsWith('http') ? contact.facebook : `https://${contact.facebook}`]);
  if (!rows.length) return null;
  return (
    <div className="contactl">
      {rows.map(([label, text, href]) => (
        <p className="contactl__row" key={label}>
          <span className="contactl__label">{label}</span>
          {href
            ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener">{text}</a>
            : <span>{text}</span>}
        </p>
      ))}
    </div>
  );
}
