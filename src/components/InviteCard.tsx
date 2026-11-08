import { useEffect, useState, type ReactNode } from 'react';
import { linerCss, resolveInvite, type InviteDesign } from '../lib/inviteDesign';
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
}

export function InviteCard({ design, facts, cta, footer }: {
  design?: Partial<InviteDesign> | null;
  facts: InviteFacts;
  cta?: ReactNode;       // replaces the RSVP pill (the guest page puts real buttons here)
  footer?: ReactNode;
}) {
  const r = resolveInvite(design);
  const t = r.template;
  return (
    <div className={`invc invc--${t.border} invc--font-${r.font}`}
      style={{ ['--invc-paper' as string]: r.paper, ['--invc-ink' as string]: r.ink,
        ['--invc-soft' as string]: r.inkSoft, ['--invc-accent' as string]: r.accent,
        ['--invc-font' as string]: r.fontCss }}>
      {r.photo && facts.photo && <img className="invc__photo" src={facts.photo} alt="" />}
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
export function InviteEnvelope({ design, peek, children, play = true }: {
  design?: Partial<InviteDesign> | null;
  peek: string;          // the title the rising card shows
  children: ReactNode;   // the full card, shown once open
  play?: boolean;
}) {
  const r = resolveInvite(design);
  const reduce = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [stage, setStage] = useState<'sealed' | 'opening' | 'open'>(reduce ? 'open' : 'sealed');
  useEffect(() => {
    if (!play || stage !== 'sealed') return;
    const t = window.setTimeout(() => setStage('opening'), 700);
    return () => window.clearTimeout(t);
  }, [play, stage]);
  useEffect(() => {
    if (stage !== 'opening') return;
    const t = window.setTimeout(() => setStage('open'), 1700);
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
    </button>
  );
}
