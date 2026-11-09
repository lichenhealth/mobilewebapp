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
  // THE OPENING, IN THE FOUNDER'S ORDER (2026-11-09): (1) the envelope's
  // FRONT with the pretty title, (2) it flips to its back, the flap lifts
  // and the card slides out showing the card's FRONT — the front photo
  // (envPhoto: "all 4 of us as a family"), (3) the card opens to its INSIDE
  // (children: the photo + every detail), and the event details follow on
  // the page, not as a card.
  const frontPhoto = invitePhotos(design, photos ?? []).env;
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  type Stage = 'front' | 'flipping' | 'sealed' | 'opening' | 'cover' | 'turning' | 'open';
  const [stage, setStage] = useState<Stage>(reduce ? 'open' : 'front');
  const next: Partial<Record<Stage, [Stage, number]>> = {
    front: ['flipping', 1800], flipping: ['sealed', 900], sealed: ['opening', 700],
    opening: ['cover', 3000], cover: ['turning', 2800], turning: ['open', 900],
  };
  useEffect(() => {
    if (!play) return;
    const n = next[stage];
    if (!n) return;
    const t = window.setTimeout(() => setStage(n[0]), n[1]);
    return () => window.clearTimeout(t);
  }, [play, stage]); // eslint-disable-line react-hooks/exhaustive-deps
  if (stage === 'open') return <div className="invenv-done">{children}</div>;
  const vars = { ['--env' as string]: r.envelope, ['--env-liner' as string]: linerCss(r.liner, r.accent),
    ['--invc-paper' as string]: r.paper, ['--invc-ink' as string]: r.ink,
    ['--invc-accent' as string]: r.accent, ['--invc-font' as string]: r.fontCss };
  const eyebrow = <span className={'invenv__card-eyebrow' + (r.font === 'script' ? ' is-script' : '')}>{r.headline}</span>;
  // (3) THE CARD'S FRONT, full size, then it turns open to the inside.
  if (stage === 'cover' || stage === 'turning') return (
    <button type="button" className={'invcover' + (stage === 'turning' ? ' is-turning' : '')} style={vars}
      onClick={() => setStage('turning')} aria-label="Open the card">
      {frontPhoto ? <img className="invcover__photo" src={frontPhoto} alt="" /> : <span className="invcover__orn" aria-hidden="true">{r.template.ornament || '✦'}</span>}
      <span className="invcover__words">
        {eyebrow}
        <span className="invcover__title">{peek}</span>
      </span>
      <span className="invcover__hint">Tap to open</span>
    </button>
  );
  const advance = () => setStage((s0) => (s0 === 'front' ? 'flipping' : s0 === 'sealed' ? 'opening' : s0 === 'opening' ? 'cover' : s0));
  return (
    <button type="button" className={`invenv is-${stage}`} onClick={advance}
      aria-label="Open the invitation" style={vars}>
      {/* (1) THE ENVELOPE'S FRONT — the pretty title, like an addressed envelope. */}
      <span className="invenv__addr" aria-hidden={stage !== 'front'}>
        {eyebrow}
        <span className="invenv__addr-title">{peek}</span>
        <span className="invenv__stamp" aria-hidden="true">{r.template.ornament || '✦'}</span>
      </span>
      {/* (2) THE BACK — flap, liner, seal; the card rises wearing its front. */}
      <span className="invenv__back" />
      <span className="invenv__card">
        {frontPhoto
          ? <img className="invenv__card-photo" src={frontPhoto} alt="" />
          : <>{eyebrow}<span className="invenv__card-title">{peek}</span></>}
      </span>
      <span className="invenv__front" />
      <span className="invenv__flap"><span className="invenv__liner" /></span>
      {stage === 'sealed' && <span className="invenv__seal" />}
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
