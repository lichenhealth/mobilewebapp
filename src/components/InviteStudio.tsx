import { invitePhotos } from '../lib/inviteDesign';
import { isHeic } from '../lib/heic';
import { useEffect, useState } from 'react';
import { InviteCard, InviteEnvelope, InviteBackdropLayer, type InviteFacts } from './InviteCard';
import {
  INVITE_TEMPLATES, INVITE_FONTS, INVITE_ACCENTS, INVITE_PAPERS, INVITE_ENVELOPES, INVITE_LINERS, INVITE_BACKDROPS,
  linerCss, resolveInvite, templateById, type InviteDesign, type RsvpForm, type InviteLink,
} from '../lib/inviteDesign';
import { uploadPageImage } from '../lib/avatarApi';
import './Invite.css';

// THE STUDIO (founder 2026-11-08: "The edit goes to a template to build out an
// invite. Create multiple templates… parity to paperless post"): a full-screen
// editor — the live card on the left (top on phones), the choices beside it:
// Design (templates by occasion), Words, Style (font · accent · paper),
// Envelope (colour · liner · photo). Done hands the design back; nothing is
// sent from here — the event's Post (or Save) is what keeps it.

type Tab = 'design' | 'words' | 'replies' | 'style' | 'envelope';
const OCCASIONS = ['All', 'Celebrations', 'Gatherings', 'Seasonal', 'Simple'] as const;

export function InviteStudio({ design, facts, onDone, onClose, uploaderId }: {
  design: InviteDesign | null;
  facts: InviteFacts;
  uploaderId?: string;
  onDone: (d: InviteDesign) => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<InviteDesign>(design ?? { template: 'classic' });
  const [tab, setTab] = useState<Tab>('design');
  const [occ, setOcc] = useState<(typeof OCCASIONS)[number]>('All');
  const r = resolveInvite(d);
  const set = (p: Partial<InviteDesign>) => setD((cur) => ({ ...cur, ...p }));
  const setForm = (p: Partial<RsvpForm>) => setD((cur) => ({ ...cur, form: { ...(cur.form ?? {}), ...p } }));
  const [artBusy, setArtBusy] = useState(false);
  const [artErr, setArtErr] = useState('');
  async function uploadArt(f: File | undefined) {
    if (!f || !uploaderId) return;
    if (!f.type.startsWith('image/') && !isHeic(f)) { setArtErr('That isn’t an image.'); return; }
    setArtBusy(true); setArtErr('');
    try { const url = await uploadPageImage(uploaderId, f); set({ artwork: url }); }
    catch (e) { setArtErr((e as Error).message || 'Upload failed.'); }
    finally { setArtBusy(false); }
  }
  const links: InviteLink[] = d.links ?? [];
  const setLinks = (l: InviteLink[]) => set({ links: l });
  const meals = d.form?.meals ?? [];
  const questions = d.form?.questions ?? [];
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose]);

  // Picking a template starts fresh from IT — the words the host typed stay.
  const pick = (id: string) => setD((cur) => ({
    template: id, message: cur.message, photo: cur.photo, form: cur.form, links: cur.links, backdrop: cur.backdrop,
    cardPhoto: cur.cardPhoto, envPhoto: cur.envPhoto,
  }));

  return (
    <div className="invst" role="dialog" aria-modal="true" aria-label="Design your invitation">
      <div className="invst__bar">
        <button className="invst__close" onClick={onClose} aria-label="Close without saving">×</button>
        <h2>Design your invitation</h2>
        <button className="invst__done" onClick={() => onDone(d)}>Done</button>
      </div>
      <div className="invst__main">
        <div className="invst__stage" style={{ background: `color-mix(in srgb, ${r.envelope} 35%, var(--bone))` }}>
          <InviteBackdropLayer kind={r.backdrop} accent={r.accent} />
          <InviteCard design={d} facts={facts} />
        </div>
        <div className="invst__panel">
          <div className="invst__tabs" role="tablist">
            {(['design', 'words', 'replies', 'style', 'envelope'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={'invst__tab' + (tab === t ? ' is-on' : '')}
                onClick={() => setTab(t)}>{t === 'design' ? 'Design' : t === 'words' ? 'Words' : t === 'replies' ? 'Replies' : t === 'style' ? 'Style' : 'Envelope'}</button>
            ))}
          </div>

          {tab === 'design' && (<>
            <div className="invst__chips">
              {OCCASIONS.map((o) => (
                <button key={o} className={'invst__chip' + (occ === o ? ' is-on' : '')} onClick={() => setOcc(o)}>{o}</button>
              ))}
            </div>
            {/* UPLOAD YOUR OWN (Paperless Post's own-artwork card): the image
                IS the card; the event's facts ride beneath it. */}
            <div className="invst__own">
              {d.artwork ? (
                <>
                  <img className="invst__own-thumb" src={d.artwork} alt="" />
                  <span className="invst__own-txt">Your own card is on. The event’s details ride beneath it.</span>
                  <button className="invst__reset" onClick={() => set({ artwork: undefined })}>Use a template instead</button>
                </>
              ) : uploaderId ? (
                <label className="invst__own-up">
                  <input type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { void uploadArt(e.target.files?.[0]); e.target.value = ''; }} />
                  {artBusy ? 'Uploading…' : '⊕ Upload your own card'}
                  <span className="invst__own-sub">A finished design from Canva, a painting, a photo — it becomes the whole card.</span>
                </label>
              ) : null}
              {artErr && <p className="invst__note">{artErr}</p>}
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
            <span className="invst__label">Registry & links</span>
            <p className="invst__note">A gift registry, a wish list, directions, a dress-code page — worn on the card as buttons.</p>
            {links.map((l, i) => (
              <div className="invst__linkrow" key={i}>
                <input placeholder="Label" value={l.label} maxLength={40}
                  onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input placeholder="https://…" value={l.url} maxLength={500}
                  autoCapitalize="none" autoCorrect="off" spellCheck={false}
                  onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button className="invst__x" aria-label="Remove link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            {links.length > 0 && links.some((l) => l.url && !/^https:\/\//i.test(l.url.trim())) && (
              <p className="invst__note">Links need to start with https:// to show on the card.</p>
            )}
            {links.length < 3 && (
              <button className="invst__reset" onClick={() => setLinks([...links, { label: links.length ? 'Link' : 'Registry', url: '' }])}>⊕ Add a link</button>
            )}
          </>)}

          {tab === 'replies' && (<>
            <p className="invst__note">What the RSVP asks, beyond going, maybe or can’t. Guests answer on their invitation; you see every reply on the event’s RSVP tab.</p>
            <label className="invst__field">
              <span className="invst__label">Extra guests each reply may bring</span>
              <select value={d.form?.plusOnes ?? 0} onChange={(e) => setForm({ plusOnes: Number(e.target.value) })}>
                {[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n === 0 ? 'None — just them' : `Up to ${n}`}</option>)}
              </select>
            </label>
            <span className="invst__label">Meal choices</span>
            {meals.map((m, i) => (
              <div className="invst__linkrow" key={i}>
                <input value={m} maxLength={60} placeholder="e.g. Vegetarian"
                  onChange={(e) => setForm({ meals: meals.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button className="invst__x" aria-label="Remove choice" onClick={() => setForm({ meals: meals.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            {meals.length < 8 && <button className="invst__reset" onClick={() => setForm({ meals: [...meals, ''] })}>⊕ Add a meal choice</button>}
            <span className="invst__label" style={{ marginTop: 16 }}>Questions for your guests</span>
            {questions.map((q, i) => (
              <div className="invst__linkrow" key={i}>
                <input value={q} maxLength={200} placeholder="e.g. Any allergies we should know?"
                  onChange={(e) => setForm({ questions: questions.map((x, j) => (j === i ? e.target.value : x)) })} />
                <button className="invst__x" aria-label="Remove question" onClick={() => setForm({ questions: questions.filter((_, j) => j !== i) })}>×</button>
              </div>
            ))}
            {questions.length < 5 && <button className="invst__reset" onClick={() => setForm({ questions: [...questions, ''] })}>⊕ Add a question</button>}
            <label className="invst__check" style={{ marginTop: 18 }}>
              <input type="checkbox" checked={d.form?.remind !== false} onChange={(e) => setForm({ remind: e.target.checked })} />
              Remind everyone who said yes or maybe, the day before
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
            <button className="invst__reset" onClick={() => setD((cur) => ({ template: cur.template, headline: cur.headline, message: cur.message, rsvp: cur.rsvp, photo: cur.photo, cardPhoto: cur.cardPhoto, envPhoto: cur.envPhoto, form: cur.form, links: cur.links, backdrop: cur.backdrop }))}>
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
            <span className="invst__label">Backdrop</span>
            <p className="invst__note">Gentle motion behind the envelope on the guest page.</p>
            <div className="invst__chips" style={{ marginBottom: 18 }}>
              {INVITE_BACKDROPS.map((b) => (
                <button key={b.id} className={'invst__chip' + (r.backdrop === b.id ? ' is-on' : '')}
                  onClick={() => set({ backdrop: b.id === 'none' ? undefined : b.id })}>{b.label}</button>
              ))}
            </div>
            {/* THE TWO PHOTO SLOTS (founder 2026-11-09): one on the
                envelope's outside, one on the card with the details. */}
            {(() => {
              const photos = facts.photos ?? (facts.photo ? [facts.photo] : []);
              const now = invitePhotos(d, photos);
              if (!photos.length) return <p className="invst__note">Add photos to the event in the composer and you can place them on the envelope and the card here.</p>;
              const row = (slot: 'envPhoto' | 'cardPhoto', cur: string | null, label: string) => (
                <>
                  <span className="invst__label">{label}</span>
                  <div className="invst__photos" style={{ marginBottom: 18 }}>
                    <button className={'invst__ph invst__ph--none' + (!cur ? ' is-on' : '')}
                      onClick={() => set(slot === 'cardPhoto' ? { cardPhoto: 'none', photo: true } : { envPhoto: 'none' })}>None</button>
                    {photos.map((u) => (
                      <button key={u} className={'invst__ph' + (cur === u ? ' is-on' : '')}
                        aria-label={`Use this photo — ${label}`}
                        onClick={() => set(slot === 'cardPhoto' ? { cardPhoto: u, photo: true } : { envPhoto: u })}>
                        <img src={u} alt="" />
                      </button>
                    ))}
                  </div>
                </>
              );
              return (<>
                {row('envPhoto', now.env, 'Photo on the front of the card — seen as it slides out')}
                {row('cardPhoto', now.card, 'Photo inside the card — with the details')}
                <p className="invst__note">Preview plays the whole opening: the envelope, the card’s front, then the inside.</p>
              </>);
            })()}
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
      <InviteBackdropLayer kind={r.backdrop} accent={r.accent} />
      <div className="invpv__stage">
        <InviteEnvelope key={run} design={design} peek={facts.title} photos={facts.photos}>
          <InviteCard design={design} facts={facts} />
        </InviteEnvelope>
      </div>
      <button className="invpv__again" onClick={() => setRun((n) => n + 1)}>Play the envelope again</button>
    </div>
  );
}
