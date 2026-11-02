import { PayMethod, payMethodDoor, realPayMethods } from '../lib/bookingApi';
import './PayDoors.css';

/* The booker's "ways to pay" line (founder 2026-11-02: "a how to collect
 * online payment if its priced, with buttons to all the options - credit
 * card, venmo, etc"): the provider's off-platform payment pointers, rendered
 * wherever payment is asked — done screens, the guest token page, /bookings
 * rows. Linkable services (Venmo, PayPal, Cash App) open their pay page in a
 * new tab wearing the link-cue; Zelle and free words stay plain. The CARD
 * door (Lichen's own checkout) is each surface's own button — this component
 * only carries the pointers beside it. Lichen never tracks whether an
 * off-platform payment happened, so callers decide when to show it (the
 * standing rule: once a booking is CONFIRMED and no online payment has
 * already been recorded). */
export default function PayDoors({ methods, lead, className }: {
  methods: PayMethod[] | null | undefined;
  /** e.g. "Ways to pay $45" or "Or pay directly". */
  lead: string;
  className?: string;
}) {
  const real = realPayMethods(methods);
  if (!real.length) return null;
  return (
    <p className={'paydoors' + (className ? ` ${className}` : '')}>
      <span className="paydoors__lead">{lead}:</span>
      {real.map((m, i) => {
        const d = payMethodDoor(m);
        if (!d.label) return null;
        return d.href ? (
          <a key={i} className="paydoors__door link-cue" href={d.href} target="_blank" rel="noopener noreferrer">{d.label}</a>
        ) : (
          <span key={i} className="paydoors__door">{d.label}</span>
        );
      })}
    </p>
  );
}
