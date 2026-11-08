import { useEffect, useState } from 'react';
import { InviteCard, InviteEnvelope, type InviteFacts } from './InviteCard';
import {
  INVITE_TEMPLATES, INVITE_FONTS, INVITE_ACCENTS, INVITE_PAPERS, INVITE_ENVELOPES, INVITE_LINERS,
  linerCss, resolveInvite, templateById, type InviteDesign,
} from '../lib/inviteDesign';
import './Invite.css';

// THE STUDIO (founder 2026-11-08: "The edit goes to a template to build out an
// invite. Create multiple templates… parity to paperless post"): a full-screen
// editor — the live card on the left (top on phones), the choices beside it:
// Design (templates by occasion), Words, Style (font · accent · paper),
// Envelope (colour · liner · photo). Done hands the design back; nothing is
// sent from here — the event's Post (or Save) is what keeps it.

type Tab = 'design' | 'words' | 'style' | 'envelope';
const OCCASIONS = ['All', 'Celebrations', 'Gatherings', 'Seasonal', 'Simple'] as const;

export function InviteStudio({ design, facts, onDone, onClose }: {
  design: InviteDesign | null;
  facts: InviteFacts;
  onDone: (d: InviteDesign) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<InviteDesign>(design ?? { template: 'classic' });
  const [tab, setTab] = useState<Tab>('design');
  const [occ, setOcc] = useState<(typeof OCCASIONS)[number]>('All');
  const r = resolveInvite(d);
  const set = (p: Partial<InviteDesign>) => setD((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);

  // Picking a template starts fresh from IT — the words the host typed stay.
  const pick = (id: string) => setD((cur) => ({ template: id, message: cur.message, photo: cur.photo }));

  return (
    <div className="invst" role="dialog" aria-modal="true" aria-label="Design your invitation">
      <div className="invst__bar">
        <button className="invst__close" onClick={onClose} aria-label="Close without saving">×</button>
        <h2>Design your invitation</h2>
        <button className="invst__done" onClick={() => onDone(d)}>Done</button>
      </div>
      <div className="invst__main">
        <div className="invst__stage" style={{ background: `color-mix(in srgb, ${r.envelope} 35%, var(--bone))` }}>
          <InviteCard design={d} facts={facts} />
        </div>
        <div className="invst__panel">
          <div className="invst__tabs" role="tablist">
            {(['design', 'words', 'style', 'envelope'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={'invst__tab' + (tab === t ? ' is-on' : '')}
                onClick={() => setTab(t)}>{t === 'design' ? 'Design' : t === 'words' ? 'Words' : t === 'style' ? 'Style' : 'Envelope'}</button>
            ))}
          </div>

          {tab === 'design' && (<>
            <div className="invst__chips">
              {OCCASIONS.map((o) => (
                <button key={o} className={'invst__chip' + (occ === o ? ' is-on' : '')} onClick={() => setOcc(o)}>{o}</button>
              ))}
            </div>
            <div className="invst__grid">
              {INVITE_TEMPLATES.filter((t) => occ === 'All' || t.occasion === occ).map((t) => {
                const tr = resolveInvite({ template: t.id });
                return (
                  <button key={t.id} className={'invst__tpl' + (d.template === t.id ? ' is-on' : '')} onClick={() => pick(t.id)}
                    aria-pressed={d.template === t.id}>
                    <span className="invst__thumb" style={{ background: t.paper, color: t.ink, fontFamily: tr.fontCss,
                      backgroundImage: t.id === 'celebration' ? linerCss('confetti', t.accent) : undefined,
                      backgroundSize: t.id === 'celebration' ? undefined : undefined }}>
                      {t.ornament && <span className="invst__thumb-orn" style={{ color: t.accent }}>{t.ornament}</span>}
                      <span className="invst__thumb-eye" style={{ color: t.accent }}>{t.headline}</span>
                      <span className="invst__thumb-title">{facts.title || 'Your event'}</span>
                    </span>
                    <span className="invst__tplname">{t.name}</span>
                  </button>
                );
              })}
            </div>
          </>)}

          {tab === 'words' && (<>
            <label className="invst__field">
              <span className="invst__label">Headline</span>
              <input value={d.headline ?? templateById(d.template).headline} maxLength={80}
                onChange={(e) => set({ headline: e.target.value })} />
            </label>
            <p className="invst__note">The event&rsquo;s title, date and place come from the event itself — change them in the composer.</p>
            <label className="invst__field">
              <span className="invst__label">A note from you</span>
              <textarea value={d.message ?? ''} maxLength={600} placeholder="Come as you are — we'll have tea and a fire going."
                onChange={(e) => set({ message: e.target.value })} />
            </label>
            <label className="invst__field">
              <span className="invst__label">Button words</span>
              <input value={d.rsvp ?? templateById(d.template).rsvp} maxLength={40}
                onChange={(e) => set({ rsvp: e.target.value })} />
            </label>
          </>)}

          {tab === 'style' && (<>
            <span className="invst__label">Typeface</span>
            <div className="invst__fonts" style={{ marginBottom: 18 }}>
              {INVITE_FONTS.map((f) => (
                <button key={f.id} className={'invst__font' + (r.font === f.id ? ' is-on' : '')} style={{ fontFamily: f.css }}
                  onClick={() => set({ font: f.id })}>{f.label}</button>
              ))}
            </div>
            <span className="invst__label">Accent</span>
            <div className="invst__swatches" style={{ marginBottom: 18 }}>
              {INVITE_ACCENTS.map((c) => (
                <button key={c} className={'invst__sw' + (r.accent === c ? ' is-on' : '')} style={{ background: c }}
                  aria-label={`Accent ${c}`} onClick={() => set({ accent: c })} />
              ))}
            </div>
            <span className="invst__label">Paper</span>
            <div className="invst__swatches" style={{ marginBottom: 18 }}>
              {INVITE_PAPERS.map((c) => (
                <button key={c} className={'invst__sw' + (r.paper === c ? ' is-on' : '')} style={{ background: c }}
                  aria-label={`Paper ${c}`} onClick={() => set({ paper: c })} />
              ))}
            </div>
            <button className="invst__reset" onClick={() => setD((cur) => ({ template: cur.template, headline: cur.headline, message: cur.message, rsvp: cur.rsvp, photo: cur.photo }))}>
              Back to the template&rsquo;s own colours
            </button>
          </>)}

          {tab === 'envelope' && (<>
            <p className="invst__note">Guests who open your link see the card arrive in this envelope.</p>
            <span className="invst__label">Envelope</span>
            <div className="invst__swatches" style={{ marginBottom: 18 }}>
              {INVITE_ENVELOPES.map((c) => (
                <button key={c} className={'invst__sw' + (r.envelope === c ? ' is-on' : '')} style={{ background: c }}
                  aria-label={`Envelope ${c}`} onClick={() => set({ envelope: c })} />
              ))}
            </div>
            <span className="invst__label">Liner</span>
            <div className="invst__swatches" style={{ marginBottom: 18 }}>
              {INVITE_LINERS.map((l) => (
                <button key={l.id} className={'invst__sw invst__sw--liner' + (r.liner === l.id ? ' is-on' : '')}
                  style={{ background: linerCss(l.id, r.accent), backgroundColor: `color-mix(in srgb, ${r.envelope} 70%, white)` }}
                  aria-label={`${l.label} liner`} data-tip={l.label} onClick={() => set({ liner: l.id })} />
              ))}
            </div>
            <label className="invst__check">
              <input type="checkbox" checked={r.photo} onChange={(e) => set({ photo: e.target.checked })} />
              Wear the event&rsquo;s cover photo{facts.photo ? '' : ' (add one in the composer)'}
            </label>
          </>)}
        </div>
      </div>
    </div>
  );
}

/** THE PREVIEW — exactly what a guest sees: the envelope opens, the card
 *  settles in. "Play it again" re-seals it. */
export function InvitePreview({ design, facts, onClose }: {
  design: InviteDesign | null;
  facts: InviteFacts;
  onClose: () => void;
}) {
  const r = resolveInvite(design);
  const [run, setRun] = useState(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <div className="invpv" role="dialog" aria-modal="true" aria-label="Invitation preview"
      style={{ background: `color-mix(in srgb, ${r.envelope} 45%, var(--bone))` }}>
      <div className="invpv__bar">
        <span className="invpv__tag">Preview — what your guests see</span>
        <button className="invst__close" onClick={onClose} aria-label="Close preview">×</button>
      </div>
      <div className="invpv__stage">
        <InviteEnvelope key={run} design={design} peek={facts.title}>
          <InviteCard design={design} facts={facts} />
        </InviteEnvelope>
      </div>
      <button className="invpv__again" onClick={() => setRun((n) => n + 1)}>Play the envelope again</button>
    </div>
  );
}
