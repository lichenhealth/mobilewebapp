import { useEffect, useState, type ReactNode } from 'react';
import { linerCss, resolveInvite, invitePhotos, type InviteDesign, type InviteBackdrop } from '../lib/inviteDesign';
import './Invite.css';

// THE INVITATION CARD — one renderer for the composer's preview, the studio,
// the full-screen Preview and the guest page /e/. The emailed card is the
// edge twin (_shared/inviteDesign.ts) and wears the same anatomy.

export interface InviteFacts {
  title: string;
  when: string;
  where?: string;
  host: string;
  photo?: string | null;
  /** Every photo the event carries, in order — the two photo slots choose
   *  from these (smart default: first on the card, second on the envelope). */
  photos?: string[];
}

export function InviteCard({ design, facts, cta, footer }: {
  design?: Partial<InviteDesign> | null;
  facts: InviteFacts;
  cta?: ReactNode;       // replaces the RSVP pill (the guest page puts real buttons here)
  footer?: ReactNode;
}) {
  const r = resolveInvite(design);
  const t = r.template;
  const cardPhoto = invitePhotos(design, facts.photos ?? (facts.photo ? [facts.photo] : [])).card;
  const linkRow = r.links.length > 0 && (
    <p className="invc__links">
      {r.links.map((l) => (
        <a key={l.url} className="invc__link" href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a>
      ))}
    </p>
  );
  // THE HOST'S OWN CARD (Paperless Post's "upload your own"): the artwork
  // IS the card; the event's facts ride beneath it in plain type so the
  // invitation still reads when the image is decorative.
  if (r.artwork) return (
    <div className="invc invc--art" style={{ ['--invc-accent' as string]: r.accent }}>
      <img className="invc__art" src={r.artwork} alt={facts.title} />
      <div className="invc__artfacts">
        <p className="invc__arttitle">{facts.title}</p>
        <p className="invc__artline">{facts.when}</p>
        {facts.where && <p className="invc__artline">{facts.where}</p>}
        {r.message && <p className="invc__artline invc__artline--msg">{r.message}</p>}
        <p className="invc__artline">Hosted by <strong>{facts.host}</strong></p>
        {linkRow}
        {cta ?? <span className="invc__cta">{r.rsvp}</span>}
        {footer}
      </div>
    </div>
  );
  return (
    <div className={`invc invc--${t.border} invc--font-${r.font}`}
      style={{ ['--invc-paper' as string]: r.paper, ['--invc-ink' as string]: r.ink,
        ['--invc-soft' as string]: r.inkSoft, ['--invc-accent' as string]: r.accent,
        ['--invc-font' as string]: r.fontCss }}>
      {cardPhoto && <img className="invc__photo" src={cardPhoto} alt="" />}
      {t.id === 'celebration' && <div className="invc__confetti" aria-hidden="true" style={{ background: linerCss('confetti', r.accent) }} />}
      <div className="invc__body">
        {t.ornament && <p className="invc__orn" aria-hidden="true">{t.ornament}</p>}
        {r.headline && <p className="invc__eyebrow">{r.headline}</p>}
        <h2 className="invc__title">{facts.title}</h2>
        {t.ornament && <p className="invc__orn invc__orn--low" aria-hidden="true">{t.ornament}</p>}
        <p className="invc__when">{facts.when}</p>
        {facts.where && <p className="invc__where">{facts.where}</p>}
        {r.message && <p className="invc__msg">{r.message}</p>}
        <p className="invc__host">Hosted by <strong>{facts.host}</strong></p>
        {linkRow}
        {cta ?? <span className="invc__cta">{r.rsvp}</span>}
        {footer}
      </div>
    </div>
  );
}

/** THE ENVELOPE (Paperless Post's signature moment): the card arrives sealed
 *  in the host's envelope — colour + liner are design choices — the flap
 *  lifts, the card rises out, then the full card settles in. A tap on the
 *  sealed envelope opens it; reduced-motion skips straight to the card. */
export function InviteEnvelope({ design, peek, children, play = true, photos }: {
  design?: Partial<InviteDesign> | null;
  peek: string;          // the title the rising card shows
  children: ReactNode;   // the full card, shown once open
  play?: boolean;
  photos?: string[];     // the event's photos — the envelope wears its slot's
}) {
  const r = resolveInvite(design);
  const envPhoto = invitePhotos(design, photos ?? []).env;
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [stage, setStage] = useState<'sealed' | 'opening' | 'open'>(reduce ? 'open' : 'sealed');
  useEffect(() => {
    if (!play || stage !== 'sealed') return;
    const t = window.setTimeout(() => setStage('opening'), envPhoto ? 2600 : 1400);
    return () => window.clearTimeout(t);
  }, [play, stage]);
  useEffect(() => {
    if (stage !== 'opening') return;
    const t = window.setTimeout(() => setStage('open'), 3400);
    return () => window.clearTimeout(t);
  }, [stage]);
  if (stage === 'open') return <div className="invenv-done">{children}</div>;
  return (
    <button type="button" className={`invenv is-${stage}`} onClick={() => setStage('opening')}
      aria-label="Open the invitation"
      style={{ ['--env' as string]: r.envelope, ['--env-liner' as string]: linerCss(r.liner, r.accent),
        ['--invc-paper' as string]: r.paper, ['--invc-ink' as string]: r.ink,
        ['--invc-accent' as string]: r.accent, ['--invc-font' as string]: r.fontCss }}>
      <span className="invenv__back" />
      <span className="invenv__card">
        <span className={'invenv__card-eyebrow' + (r.font === 'script' ? ' is-script' : '')}>{r.headline}</span>
        <span className="invenv__card-title">{peek}</span>
      </span>
      <span className="invenv__front" />
      <span className="invenv__flap"><span className="invenv__liner" /></span>
      {stage === 'sealed' && <span className="invenv__seal" />}
      {/* THE OUTSIDE (founder 2026-11-09): the envelope's own photo with the
          headline over it — the first thing a guest sees, before the flap. */}
      {envPhoto && (
        <span className="invenv__face">
          <span className={'invenv__face-eyebrow' + (r.font === 'script' ? ' is-script' : '')}>{r.headline}</span>
          <img className="invenv__face-photo" src={envPhoto} alt="" />
        </span>
      )}
    </button>
  );
}

/** THE ANIMATED BACKDROP (Paperless Post's motion behind the card): a
 *  gentle field of falling/floating marks filling its container. Pure CSS,
 *  pointer-events none, decorative only; reduced-motion holds it still. */
const BACKDROP_MARK: Record<Exclude<InviteBackdrop, 'none'>, string[]> = {
  confetti: ['●', '■', '▲', '●'], snow: ['❄', '•', '❅', '•'], petals: ['❀', '✿', '❁'],
  stars: ['✦', '✧', '⋆', '✶'], bubbles: ['○', '◯', '○'], leaves: ['❦', '❧', '🍂'],
};
const BACKDROP_COLORS = ['#D9573F', '#C9892B', '#5E7A4E', '#4A6E8C', '#B65A6E'];
export function InviteBackdropLayer({ kind, accent }: { kind: InviteBackdrop; accent: string }) {
  if (kind === 'none') return null;
  const marks = BACKDROP_MARK[kind];
  const rise = kind === 'bubbles';
  const twinkle = kind === 'stars';
  const n = 22;
  return (
    <div className={`invbd invbd--${kind}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => {
        const left = (i * 37) % 100;
        const delay = -((i * 1.7) % 12);
        const dur = 9 + ((i * 3) % 7);
        const size = 10 + ((i * 5) % 14);
        const color = kind === 'confetti' ? BACKDROP_COLORS[i % BACKDROP_COLORS.length]
          : kind === 'snow' ? '#9DB2C4' : accent;
        return (
          <span key={i} className={'invbd__m' + (rise ? ' is-rise' : twinkle ? ' is-twinkle' : '')}
            style={{ left: `${left}%`, top: twinkle ? `${(i * 53) % 100}%` : undefined,
              animationDelay: `${delay}s`, animationDuration: `${twinkle ? 2.4 + (i % 4) : dur}s`,
              fontSize: size, color }}>
            {marks[i % marks.length]}
          </span>
        );
      })}
    </div>
  );
}
