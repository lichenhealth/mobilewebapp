import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { googleCalUrl, icsDataUri, outlookCalUrl, office365CalUrl, type EventForCal } from '../lib/ics';
import { LichenMark } from './LichenMark';
import { Icon } from './Icon';
import { videoServiceOf } from '../lib/linkify';
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
  /** The event's own words — they ride INSIDE the card, right under its photo
   *  (founder 2026-11-09: "should be on the inside of the card… attached to
   *  the bottom of the photo"), never as a paragraph below the card. */
  description?: string;
}

/** "Zoom" / a Meet link / "Teams" → the service's name, so the card can wear
 *  a camera and a Join door instead of a bare word. */
export function videoWhere(where?: string): string | null {
  const w = (where || '').trim();
  if (!w) return null;
  const svc = videoServiceOf(w);
  if (svc) return svc;
  const m = w.length <= 32 && w.match(/^(zoom|google meet|meet|microsoft teams|teams|webex|whereby|jitsi|facetime)\b/i);
  return m ? (m[1].toLowerCase() === 'meet' ? 'Google Meet' : m[1].replace(/\b\w/g, (c) => c.toUpperCase())) : null;
}

export interface RsvpChoice { key: string; label: string; on?: boolean }

/** THE CARD'S TWO DROP-DOWNS (founder 2026-11-09: "Can we just have RSVP and
 *  Add to cal be drop downs with the RSVP options and cal add options? this
 *  feels redundant"): the answer and the calendar live on the card itself. */
function CardDoors({ label, rsvp, onPick, onRsvp, cal }: {
  label: string;
  rsvp?: RsvpChoice[];
  onPick?: (key: string) => void;
  onRsvp?: () => void;
  cal?: EventForCal | null;
}) {
  const [open, setOpen] = useState<'' | 'rsvp' | 'cal'>('');
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(''); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  const chosen = rsvp?.find((c) => c.on);
  return (
    <div className="invc__actions" ref={ref}>
      <div className="invc__dd">
        <button type="button" className="invc__cta" aria-expanded={open === 'rsvp'}
          onClick={() => (rsvp ? setOpen(open === 'rsvp' ? '' : 'rsvp') : onRsvp?.())}>
          {chosen ? `${chosen.label} ✓` : label}{rsvp && <span className="invc__caret" aria-hidden="true">▾</span>}
        </button>
        {open === 'rsvp' && rsvp && (
          <div className="invc__menu" role="menu">
            {rsvp.map((c) => (
              <button key={c.key} type="button" role="menuitem" className={'invc__menuitem' + (c.on ? ' is-on' : '')}
                onClick={() => { onPick?.(c.key); setOpen(''); }}>{c.label}{c.on ? ' ✓' : ''}</button>
            ))}
          </div>
        )}
      </div>
      {cal && (
        <div className="invc__dd">
          <button type="button" className="invc__cta invc__cta--ghost" aria-expanded={open === 'cal'}
            onClick={() => setOpen(open === 'cal' ? '' : 'cal')}>
            Add to cal<span className="invc__caret" aria-hidden="true">▾</span>
          </button>
          {open === 'cal' && (
            <div className="invc__menu" role="menu">
              <a role="menuitem" className="invc__menuitem" href={googleCalUrl(cal)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen('')}>Google</a>
              <a role="menuitem" className="invc__menuitem" href={icsDataUri(cal)} download={`${cal.title}.ics`} onClick={() => setOpen('')}>Apple</a>
              <a role="menuitem" className="invc__menuitem" href={outlookCalUrl(cal)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen('')}>Outlook</a>
              <a role="menuitem" className="invc__menuitem" href={office365CalUrl(cal)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen('')}>Office 365</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InviteCard({ design, facts, cta, footer, onRsvp, rsvp, onPick, cal, rsvpLabel, joinUrl, onJoin }: {
  design?: Partial<InviteDesign> | null;
  facts: InviteFacts;
  cta?: ReactNode;       // replaces the whole action row (e.g. "your request is with the host")
  footer?: ReactNode;
  /** THE CARD'S TWO DOORS (founder 2026-11-09: "RSVP on the left and add to
   *  cal on the right"): given handlers, they render as real buttons; with
   *  neither, the row is a still picture (the Studio thumbnail). */
  onRsvp?: () => void;
  /** RSVP as a drop-down: the choices, and what picking one does. */
  rsvp?: RsvpChoice[];
  onPick?: (key: string) => void;
  /** Add to cal as a drop-down (Google · Apple · Outlook · Office 365). */
  cal?: EventForCal | null;
  rsvpLabel?: string;
  /** A video event's room — the camera chip grows a Join door (no RSVP needed). */
  joinUrl?: string | null;
  onJoin?: () => void;
}) {
  const r = resolveInvite(design);
  const t = r.template;
  const cardPhoto = invitePhotos(design, facts.photos ?? (facts.photo ? [facts.photo] : [])).card;
  const video = videoWhere(facts.where);
  const whereEl = facts.where && (video ? (
    <p className="invc__where invc__where--video">
      <span className="invc__video"><Icon name="video" size={15} /> {video}</span>
      {joinUrl
        ? <a className="invc__join" href={joinUrl} target="_blank" rel="noopener noreferrer">Join {video} ›</a>
        : onJoin ? <button type="button" className="invc__join" onClick={onJoin}>Join {video} ›</button> : null}
    </p>
  ) : <p className="invc__where">{facts.where}</p>);
  const label = rsvpLabel ?? (r.rsvp === 'RSVP & see the details' ? 'RSVP' : r.rsvp);
  const actions = cta ?? (onRsvp || rsvp || cal
    ? <CardDoors label={label} rsvp={rsvp} onPick={onPick} onRsvp={onRsvp} cal={cal} />
    : (
    <div className="invc__actions">
      <span className="invc__cta">{label}</span>
      <span className="invc__cta invc__cta--ghost">Add to cal</span>
    </div>
  ));
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
        {whereEl}
        {facts.description && <p className="invc__artline invc__artline--msg">{facts.description}</p>}
        {r.message && <p className="invc__artline invc__artline--msg">{r.message}</p>}
        <p className="invc__artline">Hosted by <strong>{facts.host}</strong></p>
        {linkRow}
        {actions}
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
      {facts.description && <p className="invc__desc">{facts.description}</p>}
      {t.id === 'celebration' && <div className="invc__confetti" aria-hidden="true" style={{ background: linerCss('confetti', r.accent) }} />}
      <div className="invc__body">
        {t.ornament && <p className="invc__orn" aria-hidden="true">{t.ornament}</p>}
        {r.headline && <p className="invc__eyebrow">{r.headline}</p>}
        <h2 className="invc__title">{facts.title}</h2>
        {t.ornament && <p className="invc__orn invc__orn--low" aria-hidden="true">{t.ornament}</p>}
        <p className="invc__when">{facts.when}</p>
        {whereEl}
        {r.message && <p className="invc__msg">{r.message}</p>}
        <p className="invc__host">Hosted by <strong>{facts.host}</strong></p>
        {linkRow}
        {actions}
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
    opening: ['cover', 3000], cover: ['turning', 5000], turning: ['open', 900],
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
      onClick={() => setStage('turning')} aria-label="Open the card (it opens by itself in a moment)">
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
          ? <><img className="invenv__card-photo" src={frontPhoto} alt="" /><span className="invenv__card-words">{eyebrow}<span className="invenv__card-title">{peek}</span></span></>
          : <>{eyebrow}<span className="invenv__card-title">{peek}</span></>}
      </span>
      <span className="invenv__frontwrap"><span className="invenv__front" /></span>
      <svg className="invenv__seams" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0 100 L50 74 L100 100" fill="none" stroke="rgba(0,0,0,0.07)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
        <path d="M0 99.4 L50 74.6 L100 99.4" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="invenv__flapwrap"><span className="invenv__flap"><span className="invenv__liner" /></span></span>
      {stage === 'sealed' && <WaxSeal />}
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

// A pressed wax seal in the design's accent: an uneven poured edge, a raised
// rim, a soft sheen, and the Lichen mark stamped into the middle.
const SEAL_EDGE = 'M92.7 45.3 Q94.0 50.0 93.6 54.9 Q93.2 59.9 90.6 64.1 Q87.9 68.3 85.7 72.4 Q83.4 76.6 80.3 80.4 Q77.3 84.2 73.2 86.9 Q69.1 89.7 64.2 90.3 Q59.3 90.8 54.7 93.4 Q50.0 95.9 45.1 94.6 Q40.1 93.3 35.6 91.3 Q31.1 89.2 27.2 86.4 Q23.2 83.6 18.9 80.9 Q14.5 78.3 12.1 73.9 Q9.6 69.4 9.4 64.4 Q9.2 59.3 7.6 54.7 Q6.0 50.0 7.2 45.3 Q8.4 40.5 9.0 35.5 Q9.6 30.5 13.3 27.1 Q16.9 23.6 19.7 19.5 Q22.4 15.4 26.7 12.9 Q30.9 10.4 35.8 9.5 Q40.6 8.7 45.3 8.5 Q50.0 8.2 55.1 6.6 Q60.3 5.0 65.2 6.6 Q70.1 8.2 73.2 12.7 Q76.3 17.1 80.2 19.9 Q84.2 22.7 87.9 26.3 Q91.7 29.9 91.5 35.2 Q91.4 40.6 92.7 45.3Z';
function WaxSeal() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <span className="invenv__seal" aria-hidden="true">
      <svg viewBox="0 0 100 100" className="invenv__seal-wax">
        <defs>
          <radialGradient id={`ws${id}`} cx="36%" cy="30%" r="75%">
            <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.32" />
          </radialGradient>
        </defs>
        <path d={SEAL_EDGE} style={{ fill: 'var(--invc-accent)' }} />
        <path d={SEAL_EDGE} fill={`url(#ws${id})`} />
        <circle cx="50" cy="50" r="31" fill="none" stroke="rgba(0,0,0,0.22)" strokeWidth="3.2" />
        <circle cx="49.2" cy="49.2" r="33" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.6" />
        <circle cx="50" cy="50" r="29" style={{ fill: 'var(--invc-accent)' }} opacity="0.55" />
      </svg>
      <span className="invenv__seal-mark"><LichenMark size={30} label="" fill="rgba(0,0,0,0.3)" /></span>
    </span>
  );
}
