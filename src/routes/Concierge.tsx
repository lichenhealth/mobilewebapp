import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import HexagonRadar from '../components/HexagonRadar';
import { getFinancialPosition, saveFinancialPosition, requestFinancialCoordinator, INCOME_BANDS, SUBSIDY_NEEDS, MEANS_FIELDS, bandLabel, type FinancialPosition, type SubsidyNeed, type MeansField } from '../lib/meansApi';
import ChatConversation from '../components/ChatConversation';
import CarePostCard from '../components/CarePostCard';
import { supabase } from '../lib/supabase';
import {
  loadConciergeAccess, ensureDirectChat, monogramFor, colorFor, uploadChatMedia,
  type MediaType, type Attachment,
} from '../lib/chatApi';
import {
  loadCarePosts, computeWowScores, wowAxes, signCareMedia, deleteCarePost,
  createCarePost, DIMENSION_META,
  getCareSettings, setWowWindowAuto, tuneWowWindow, WOW_WINDOW_DEFAULT, type CareSettings,
  WOW_DIMENSIONS, mondayOfWeek, todayISO, weekDays, formatWeekRange, localDate, toISO,
  loadOnCallRoster, onCallNow, nextOnCall, nextOnCallLabel,
  type CarePostRow, type Dimension, type OnCallCaregiver,
} from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import {
  loadCareLinks, inviteCare, addCareCaregiverById, approveCare, removeCare, cancelCareInvite,
  copyCareInvite, sendCareInviteEmail, type CareLink, type CareInvite,
} from '../lib/careTeamApi';
import { occursOn } from '../lib/recurrence';
import { useAuth } from '../auth/AuthProvider';
import { consentOn, setConsent, careConsent } from '../lib/assistantConsentApi';
import './Concierge.css';

type ConciergeTab = 'wow' | 'koc' | 'chat' | 'urgent' | 'team';

/** Urgent Care: who on the subject's care team is on call RIGHT NOW
 *  (availability_windows kind='on_call' via the on_call_roster RPC), with real
 *  Call (tel:) and Text (DM) actions. The rest of the team lists as backups
 *  with their next on-call times. Windows are viewer-local, like the calendar. */
function UrgentCare({ subjectId, me }: { subjectId: string; me: string }) {
  const navigate = useNavigate();
  const [roster, setRoster] = useState<OnCallCaregiver[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [errNote, setErrNote] = useState('');
  // Re-render each minute so the card flips when a shift starts or ends.
  const [, setTick] = useState(0);
  // Media context — uploads go straight into the DM with the on-call caregiver
  // (the chat is found-or-created on first attach), so Send just references them.
  const [pending, setPending] = useState<{ type: MediaType; path: string; localUrl: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const dmRef = useRef<{ otherId: string; chatId: string } | null>(null);

  useEffect(() => {
    if (!subjectId) return;              // auth still resolving
    let cancelled = false;
    setReady(false);
    loadOnCallRoster(subjectId).then((r) => {
      if (!cancelled) { setRoster(r); setReady(true); }
    });
    return () => { cancelled = true; };
  }, [subjectId]);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const today = todayISO();
  const nowD = new Date();
  const nowMin = nowD.getHours() * 60 + nowD.getMinutes();

  const active = roster
    .map((c) => ({ c, win: onCallNow(c.windows, today, nowMin)! }))
    .filter((x) => x.win)
    .sort((a, b) => b.win.end_min - a.win.end_min || a.c.name.localeCompare(b.c.name));
  const primary = active[0];
  const backups: { c: OnCallCaregiver; label: string }[] = [
    ...active.slice(1).map(({ c, win }) => ({ c, label: `On call until ${minToLabel(win.end_min)}` })),
    ...roster
      .filter((c) => !active.some((a) => a.c.id === c.id))
      .map((c) => ({ c, next: nextOnCall(c.windows, today, nowMin) }))
      .sort((a, b) => {
        if (!a.next) return b.next ? 1 : a.c.name.localeCompare(b.c.name);
        if (!b.next) return -1;
        return a.next.iso.localeCompare(b.next.iso) || a.next.startMin - b.next.startMin;
      })
      .map(({ c, next }) => ({ c, label: nextOnCallLabel(next) })),
  ];
  const firstName = (c: OnCallCaregiver) => c.name.split(' ')[0];

  async function ensureDM(otherId: string): Promise<string> {
    if (dmRef.current?.otherId === otherId) return dmRef.current.chatId;
    const chatId = await ensureDirectChat(otherId);
    dmRef.current = { otherId, chatId };
    return chatId;
  }

  async function openDM(caregiverId: string, body?: string, attachments?: Attachment[]) {
    if (sending) return;
    setSending(true);
    try {
      const chatId = await ensureDM(caregiverId);
      const text = body?.trim();
      if (text || attachments?.length) {
        const { error } = await supabase
          .from('chat_messages')
          .insert({
            chat_id: chatId, sender_id: me, body: text || null,
            attachments: attachments?.length ? attachments : null,
          });
        if (error) throw error;
      }
      navigate(`/chat/${chatId}`);
    } catch {
      setErrNote('Could not open the chat. Please try again.');
      setTimeout(() => setErrNote(''), 3000);
      setSending(false);
    }
  }

  async function addPending(file: Blob, ext: string, type: MediaType) {
    if (!primary) return;
    setUploading(true);
    try {
      const chatId = await ensureDM(primary.c.id);
      const path = await uploadChatMedia(chatId, file, ext);
      setPending((p) => [...p, { type, path, localUrl: URL.createObjectURL(file) }]);
    } catch {
      setErrNote('Could not attach that. Please try again.');
      setTimeout(() => setErrNote(''), 3000);
    }
    setUploading(false);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>, type: MediaType) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const ext = file.name.split('.').pop() || (type === 'photo' ? 'jpg' : 'mp4');
    addPending(file, ext, type);
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        addPending(new Blob(chunksRef.current, { type: 'audio/webm' }), 'webm', 'audio');
      };
      rec.start();
      recRef.current = rec;
      setRecording(true);
    } catch {
      setErrNote('Microphone unavailable.');
      setTimeout(() => setErrNote(''), 3000);
    }
  }

  const avatar = (c: OnCallCaregiver, small?: boolean) => (
    <div
      className={'urgent__avatar' + (small ? ' urgent__avatar--sm' : '')}
      style={c.avatarUrl ? undefined : { background: colorFor(c.id) }}
    >
      {c.avatarUrl ? <img src={c.avatarUrl} alt="" /> : monogramFor(c.name)}
    </div>
  );

  if (!ready) {
    return <div className="urgent"><p className="conc__care-hint">Loading…</p></div>;
  }

  if (roster.length === 0) {
    return (
      <div className="urgent">
        <ConciergeEmpty
          icon="shield-user"
          title="No care team yet"
          sub="Urgent care connects you with your own caregivers when they're on call. Build your care team in the Care Team tab."
          action={subjectId === me ? { label: 'Go to Care Team', onClick: () => navigate('/concierge/team') } : undefined}
        />
        <aside className="urgent__emergency">
          <Icon name="info" size={14} />
          <p>
            <strong>If this is a life-threatening emergency,</strong> call <a href="tel:911">911</a> immediately. Lichen urgent care is not a substitute for emergency services.
          </p>
        </aside>
      </div>
    );
  }

  return (
    <div className="urgent">
      <header className="urgent__head">
        <p className="urgent__eyebrow">Get help now</p>
        <h2 className="urgent__title">
          Reach the caregiver <span className="display-italic">on call.</span>
        </h2>
        <p className="urgent__sub">
          For non-life-threatening urgent care from your own care team.
        </p>
      </header>

      {primary ? (
        <article className="urgent__oncall">
          <div className="urgent__priority-badge">
            <Icon name="shield-user" size={11} />
            <span>On your care team</span>
          </div>
          <header className="urgent__oncall-head">
            {avatar(primary.c)}
            <div className="urgent__oncall-id">
              <h3 className="urgent__oncall-name">{primary.c.name}</h3>
              <p className="urgent__oncall-role">{primary.c.headline ?? 'Care team'}</p>
            </div>
            <div className="urgent__status">
              <span className="urgent__status-dot" />
              <span>On call</span>
            </div>
          </header>
          <p className="urgent__oncall-blurb">
            On call until {minToLabel(primary.win.end_min)}.
          </p>

          {/* Primary actions: Call + Text open the phone's own dialer/SMS app
              (prefilled with the typed context); in-app delivery is the Send
              button below. */}
          <div className="urgent__actions">
            {primary.c.phone && (
              <a className="urgent__call" href={`tel:${primary.c.phone}`}>
                <Icon name="phone" size={16} />
                <span>Call {firstName(primary.c)}</span>
              </a>
            )}
            {primary.c.phone ? (
              <a
                className="urgent__text-btn"
                href={`sms:${primary.c.phone}?&body=${encodeURIComponent(message.trim())}`}
              >
                <Icon name="message" size={16} />
                <span>Text</span>
              </a>
            ) : (
              <a
                href="#urgent-text"
                className="urgent__text-btn"
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('urgent-text')?.focus();
                }}
              >
                <Icon name="message" size={16} />
                <span>Message</span>
              </a>
            )}
          </div>
        </article>
      ) : (
        <article className="urgent__oncall urgent__oncall--none">
          <header className="urgent__oncall-head">
            <div className="urgent__avatar" style={{ background: 'var(--bone-edge)' }}>
              <Icon name="phone" size={18} />
            </div>
            <div className="urgent__oncall-id">
              <h3 className="urgent__oncall-name">No one is on call right now</h3>
              <p className="urgent__oncall-role">Your care team's next times are below</p>
            </div>
            <div className="urgent__status urgent__status--off">
              <span className="urgent__status-dot" />
              <span>Off call</span>
            </div>
          </header>
        </article>
      )}

      {/* Context message → first DM message to the on-call caregiver */}
      {primary && (
        <section className="urgent__context">
          <h3 className="urgent__h3">What&rsquo;s going on?</h3>
          <textarea
            id="urgent-text"
            className="urgent__textarea"
            placeholder="Describe what you&rsquo;re experiencing. Symptoms, timing, anything that might help them help you faster."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
          />

          {/* Attached media chips */}
          {(pending.length > 0 || uploading) && (
            <ul className="urgent__attachments">
              {pending.map((p, i) => (
                <li key={i} className="urgent__chip">
                  <Icon name={p.type === 'photo' ? 'image' : p.type === 'video' ? 'video' : 'mic'} size={12} />
                  <span>{p.type === 'photo' ? 'Photo' : p.type === 'video' ? 'Video' : 'Voice note'}</span>
                  <button
                    className="urgent__chip-x"
                    onClick={() => setPending((cur) => cur.filter((_, idx) => idx !== i))}
                    aria-label="Remove attachment"
                  >
                    <Icon name="close" size={10} />
                  </button>
                </li>
              ))}
              {uploading && <li className="urgent__chip">Uploading…</li>}
            </ul>
          )}

          {/* Attachment row */}
          <div className="urgent__attach-row">
            <p className="urgent__attach-label">Add context</p>
            <div className="urgent__attach-buttons">
              <button className="urgent__attach-btn" onClick={() => photoRef.current?.click()}>
                <Icon name="image" size={16} />
                <span>Photo</span>
              </button>
              <button className="urgent__attach-btn" onClick={() => videoRef.current?.click()}>
                <Icon name="video" size={16} />
                <span>Video</span>
              </button>
              <button
                className={'urgent__attach-btn' + (recording ? ' is-recording' : '')}
                onClick={toggleRecord}
              >
                <Icon name="mic" size={16} />
                <span>{recording ? 'Stop' : 'Voice'}</span>
              </button>
            </div>
          </div>
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e, 'photo')} />
          <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => onFile(e, 'video')} />

          <button
            className="urgent__send"
            onClick={() => openDM(primary.c.id, message, pending.map((p) => ({ type: p.type, url: p.path })))}
            disabled={sending || uploading || recording || (!message.trim() && pending.length === 0)}
          >
            <Icon name="send" size={14} />
            <span>{sending ? 'Opening chat…' : `Send to ${firstName(primary.c)}`}</span>
          </button>
        </section>
      )}

      {/* The rest of the team, soonest on-call first */}
      {backups.length > 0 && (
        <section className="urgent__backup">
          <h3 className="urgent__h3">{primary ? 'If they don’t pick up' : 'Your care team'}</h3>
          <p className="urgent__sub urgent__sub--tight">
            {primary ? 'The rest of your care team.' : 'Tap anyone to message them.'}
          </p>
          <ul className="urgent__backup-list">
            {backups.map(({ c, label }) => (
              <li key={c.id}>
                <button className="urgent__backup-item" onClick={() => openDM(c.id)} disabled={sending}>
                  {avatar(c, true)}
                  <div className="urgent__backup-body">
                    <div className="urgent__backup-row">
                      <span className="urgent__backup-name">{c.name}</span>
                      <span className="urgent__backup-rt">{label}</span>
                    </div>
                    <span className="urgent__backup-role">{c.headline ?? 'Care team'}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Emergency disclaimer */}
      <aside className="urgent__emergency">
        <Icon name="info" size={14} />
        <p>
          <strong>If this is a life-threatening emergency,</strong> call <a href="tel:911">911</a> immediately. Lichen urgent care is not a substitute for emergency services.
        </p>
      </aside>

      {errNote && <div className="mkt__toast">{errNote}</div>}
    </div>
  );
}

/** The Economic aspect of the Web of Wellbeing (founder 2026-07-27): the
 *  member's honest financial picture. Owner edits; the active care team reads
 *  (RLS enforces it). Never a score, never counted, never compared — it
 *  informs subsidies and means-aware pricing in the exchange algorithm. */
function MeansCard({ subjectId, me, openSignal, web, standalone }: {
  subjectId: string; me: string; openSignal?: number;
  /** On its own screen (/concierge/financial): no collapsed row, always open. */
  standalone?: boolean;
  /** The self-assessment RIDES ALONG, never gates (founder 2026-08-20): the
   *  answered aspects show back so nothing is retyped, and an unfinished web
   *  invites — with a link — rather than blocking the form. */
  web?: { answered: Dimension[]; latest: Partial<Record<Dimension, { body: string; score: number | null }>> };
}) {
  const own = subjectId === me;
  const [open, setOpen] = useState(!!standalone);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);
  const [row, setRow] = useState<FinancialPosition | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [band, setBand] = useState<string>('');
  const [household, setHousehold] = useState('');
  const [words, setWords] = useState('');
  const [assets, setAssets] = useState('');
  const [debt, setDebt] = useState('');
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState('');
  const [needs, setNeeds] = useState<SubsidyNeed[]>([]);
  const [obstacles, setObstacles] = useState('');
  const [omit, setOmit] = useState<MeansField[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    let live = true;
    void getFinancialPosition(subjectId).then((r) => {
      if (!live) return;
      setRow(r); setLoaded(true);
      if (r) {
        setBand(r.income_band ?? ''); setHousehold(r.household_size?.toString() ?? ''); setWords(r.circumstances ?? '');
        setAssets(r.assets?.toString() ?? ''); setDebt(r.debt?.toString() ?? '');
        setIncome(r.monthly_income?.toString() ?? ''); setExpenses(r.monthly_expenses?.toString() ?? '');
        setNeeds(r.needs ?? []); setObstacles(r.obstacles ?? ''); setOmit(r.ai_omit_fields ?? []);
      }
    });
    return () => { live = false; };
  }, [subjectId]);
  if (!loaded) return null;
  const shared = !!row && !!(row.income_band || row.household_size || row.circumstances
    || row.assets != null || row.debt != null || row.monthly_income != null || row.monthly_expenses != null
    || (row.needs && row.needs.length) || row.obstacles);
  return (
    <div className={'means' + (standalone ? ' means--page' : '')} id="financial">
      {!standalone && (
      <button className="means__row" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="dollar" size={15} />
        <span className="means__title">Financial health profile</span>
        <span className="means__state">
          {row && row.care_team_visible === false
            ? 'private — only you'
            : shared ? 'shared with your care team' : own ? 'not shared yet' : 'not shared'}
        </span>
        <Icon name="chevron-right" size={13} />
      </button>
      )}
      {open && own && (
        <div className="means__body">
          {/* THE WEB TRAVELS WITH IT, but never bars the door (founder
              2026-08-20, reversing same-day gating): someone in a financial
              hole may need to start HERE — the form always opens, and an
              unfinished web gets a linked invitation instead of a wall. */}
          {web && web.answered.length < WOW_DIMENSIONS.length && (
            <p className="means__hint means__hint--flag">
              <Icon name="health" size={13} />
              <span>
                It is important to look at the causes and solutions to your
                financial needs holistically in order to best support you.
                Please fill out the rest of your{' '}
                <Link className="means__web-link" to="/concierge/wow/edit">Web of Wellbeing</Link>{' '}
                to get started.
              </span>
            </p>
          )}
            <>
              {web && web.answered.length > 0 && (
                <div className="means__web">
                  <p className="means__web-head">Your web, as you told it</p>
                  {WOW_DIMENSIONS.map((d) => {
                    const e = web.latest[d];
                    if (!e) return null;
                    return (
                      <p className="means__web-row" key={d}>
                        <em>{d}</em>
                        {e.score != null && <span className="means__web-score">{e.score}</span>}
                        <span className="means__web-words">{e.body.slice(0, 120)}</span>
                      </p>
                    );
                  })}
                  <p className="means__hint">Pulled in from your self-assessment — nothing to retype.</p>
                </div>
              )}

              <p className="means__hint means__hint--coord">
                <Icon name="user-multiple" size={13} />
                <span>
                  <strong>A financial coordinator joins your care team.</strong> Saving
                  this asks Lichen for someone whose job is exactly this piece —
                  subsidies, money conversations, and the parts money alone
                  doesn&rsquo;t fix. They offer, you approve like any caregiver,
                  and you can remove them any time.
                </span>
              </p>
              <p className="means__hint">
                Only you and your active care team can see this — never a score, never
                public, never shown to admins or other members. Whether your care team
                sees it at all is yours to switch in Profile → Privacy.
              </p>

              <p className="means__section">Where you stand</p>
              <div className="means__grid">
                <span>
                  <label className="means__label">Monthly income</label>
                  <input className="means__input" type="number" min={0} value={income}
                    onChange={(e) => setIncome(e.target.value)} placeholder="$" />
                </span>
                <span>
                  <label className="means__label">Monthly expenses</label>
                  <input className="means__input" type="number" min={0} value={expenses}
                    onChange={(e) => setExpenses(e.target.value)} placeholder="$" />
                </span>
                <span>
                  <label className="means__label">Assets</label>
                  <input className="means__input" type="number" min={0} value={assets}
                    onChange={(e) => setAssets(e.target.value)} placeholder="$" />
                </span>
                <span>
                  <label className="means__label">Debt</label>
                  <input className="means__input" type="number" min={0} value={debt}
                    onChange={(e) => setDebt(e.target.value)} placeholder="$" />
                </span>
              </div>
              <label className="means__label">Household income band</label>
              <select className="means__input" value={band} onChange={(e) => setBand(e.target.value)}>
                <option value="">Prefer not to say</option>
                {INCOME_BANDS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
              </select>
              <label className="means__label">People in your household</label>
              <input className="means__input" type="number" min={1} max={20} value={household}
                onChange={(e) => setHousehold(e.target.value)} placeholder="e.g. 3" />

              <p className="means__section">What you need</p>
              <div className="means__needs">
                {SUBSIDY_NEEDS.map((n) => {
                  const on = needs.includes(n.value);
                  return (
                    <label className={'means__need' + (on ? ' is-on' : '')} key={n.value}>
                      <input type="checkbox" checked={on}
                        onChange={() => setNeeds((cur) => on ? cur.filter((x) => x !== n.value) : [...cur, n.value])} />
                      <span><strong>{n.label}</strong><em>{n.hint}</em></span>
                    </label>
                  );
                })}
              </div>

              <label className="means__label">What&rsquo;s in the way?</label>
              <p className="means__hint">
                The part money alone doesn&rsquo;t fix. Lichen can cover paid time
                off and your employer still has to approve the leave; a repair needs
                a landlord&rsquo;s yes. Say it here — that&rsquo;s the work your
                coordinator does with you.
              </p>
              <textarea className="means__input means__words" value={obstacles} onChange={(e) => setObstacles(e.target.value)}
                placeholder="e.g. my job allows unpaid leave but I can't afford to take it, and HR needs 30 days' notice…" />

              <label className="means__label">Anything else (optional)</label>
              <textarea className="means__input means__words" value={words} onChange={(e) => setWords(e.target.value)}
                placeholder="Anything that shapes your financial picture — care costs, seasonal work, supporting family…" />

              {/* WHAT CLAUDE MAY HELP WITH — case by case (founder 2026-08-20:
                  "maybe you don't want your credit score in there, but you do
                  want your monthly expenses, in case Claude can help you
                  streamline your budgeting"). Switching a line off holds it
                  back from every assistant; your care team still sees it. */}
              <p className="means__section">What Claude may help with</p>
              <p className="means__hint">
                This intelligence can be worth a great deal here — the right
                intervention, the right way through a hole. Every line is yours
                to hold back, one at a time. Anything switched off never reaches
                an assistant; your coordinator and care team still see it.
                {' '}Switch AI off for all of Concierge in Profile → Privacy.
              </p>
              <div className="means__omit">
                {MEANS_FIELDS.map((f) => {
                  const held = omit.includes(f.key);
                  return (
                    <button type="button" key={f.key}
                      className={'means__omit-chip' + (held ? ' is-held' : '')}
                      aria-pressed={!held}
                      title={held ? `${f.label} is held back from AI — tap to allow` : `Claude may use ${f.label.toLowerCase()} — tap to hold back`}
                      onClick={() => setOmit((cur) => held ? cur.filter((x) => x !== f.key) : [...cur, f.key])}>
                      {f.label}{held ? ' · held back' : ''}
                    </button>
                  );
                })}
              </div>

              <div className="means__save">
                <button className="btn btn-primary" disabled={saving}
                  onClick={() => {
                    setSaving(true); setMsg('');
                    const num = (v: string) => v.trim() ? Number(v) : null;
                    const firstTime = !shared;
                    void saveFinancialPosition({
                      income_band: (band || null) as FinancialPosition['income_band'],
                      household_size: household ? Number(household) : null,
                      circumstances: words.trim() || null,
                      assets: num(assets), debt: num(debt),
                      monthly_income: num(income), monthly_expenses: num(expenses),
                      needs, obstacles: obstacles.trim() || null, ai_omit_fields: omit,
                    }).then(async () => {
                      if (firstTime) await requestFinancialCoordinator();
                      setMsg(firstTime
                        ? 'Saved — your care team can see it, and Lichen has been asked for a financial coordinator.'
                        : 'Saved — visible to you and your care team.');
                    })
                      .catch((e) => setMsg((e as Error).message))
                      .finally(() => setSaving(false));
                  }}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {msg && <span className="means__msg">{msg}</span>}
              </div>
            </>
        </div>
      )}

      {open && !own && (
        <div className="means__body">
          {shared ? (
            <>
              {row?.needs && row.needs.length > 0 && (
                <p className="means__ro"><em>Asking for</em> {row.needs.map((n) => SUBSIDY_NEEDS.find((x) => x.value === n)?.label ?? n).join(', ')}</p>
              )}
              {row?.monthly_income != null && <p className="means__ro"><em>Monthly income</em> ${row.monthly_income}</p>}
              {row?.monthly_expenses != null && <p className="means__ro"><em>Monthly expenses</em> ${row.monthly_expenses}</p>}
              {row?.assets != null && <p className="means__ro"><em>Assets</em> ${row.assets}</p>}
              {row?.debt != null && <p className="means__ro"><em>Debt</em> ${row.debt}</p>}
              {row?.income_band && <p className="means__ro"><em>Household income</em> {bandLabel(row.income_band)}</p>}
              {row?.household_size != null && <p className="means__ro"><em>Household</em> {row.household_size} {row.household_size === 1 ? 'person' : 'people'}</p>}
              {row?.obstacles && <p className="means__ro means__ro-words"><em>In the way</em> {row.obstacles}</p>}
              {row?.circumstances && <p className="means__ro means__ro-words">{row.circumstances}</p>}
            </>
          ) : (
            <p className="means__hint">They haven&rsquo;t shared a financial picture yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Empty-state card for WOW/KOC — doubles as the caregiver's "author the first one" entry. */
function ConciergeEmpty({ icon, title, sub, action }: {
  icon: IconName; title: string; sub: string; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="conc__care-gate">
      <Icon name={icon} size={22} />
      <h3 className="conc__care-gate-title">{title}</h3>
      <p className="conc__care-gate-sub">{sub}</p>
      {action && <button className="btn btn-primary" onClick={action.onClick}>{action.label}</button>}
    </div>
  );
}

/** THE AUDIT IN YOUR OWN WORDS (founder 2026-08-14): your Web of Wellbeing
 *  KICKS OFF with a self-evaluation — all six dimensions, each in your own
 *  words with an optional 0–100 self-score feeding the same radar the care
 *  team's entries feed. Any answered dimension becomes a real WOW post
 *  authored by you; skipped ones simply wait. Economic words live here like
 *  any other dimension — the structured Financial position card stays its
 *  own separate, skippable thing. */
function SelfAudit({ me, onDone, onOpenMeans }: { me: string; onDone: () => void; onOpenMeans: () => void }) {
  const blank = () => Object.fromEntries(
    WOW_DIMENSIONS.map((d) => [d, { text: '', score: null as number | null }]),
  ) as Record<Dimension, { text: string; score: number | null }>;
  const [entries, setEntries] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // A save that fails halfway must not double-post the dimensions that
  // already landed when the member retries.
  const saved = useRef(new Set<Dimension>());
  const touched = WOW_DIMENSIONS.filter((d) => entries[d].text.trim() || entries[d].score != null);
  const set = (d: Dimension, patch: Partial<{ text: string; score: number | null }>) =>
    setEntries((cur) => ({ ...cur, [d]: { ...cur[d], ...patch } }));
  return (
    <section className="selfaudit">
      <h3 className="selfaudit__title">Start with your own words</h3>
      <p className="selfaudit__sub">
        Your Web of Wellbeing begins with how YOU see yourself — six aspects of
        one life. Write as much or as little as you like, score any you want on
        the web, and skip what isn&rsquo;t ready. Your care team can read what
        you share here, and their entries will weave in alongside yours.
      </p>
      {WOW_DIMENSIONS.map((d) => (
        <div className="selfaudit__dim" key={d}>
          <div className="selfaudit__dimhead">
            <Icon name={DIMENSION_META[d]} size={16} />
            <span className="selfaudit__dimname">{d}</span>
            {entries[d].score == null ? (
              <button className="selfaudit__scorebtn" onClick={() => set(d, { score: 70 })}>
                Add a score
              </button>
            ) : (
              <span className="selfaudit__scorewrap">
                <input
                  type="range" min={0} max={100} value={entries[d].score ?? 70}
                  onChange={(e) => set(d, { score: Number(e.target.value) })}
                  aria-label={`${d} score`}
                />
                <span className="selfaudit__scoreval">{entries[d].score}</span>
                <button className="selfaudit__scoreclear" onClick={() => set(d, { score: null })} aria-label="Remove score">×</button>
              </span>
            )}
          </div>
          <textarea
            className="selfaudit__words"
            value={entries[d].text}
            onChange={(e) => set(d, { text: e.target.value })}
            placeholder={`In your own words — how is your ${d.toLowerCase()} wellbeing right now?`}
          />
          {/* The door to the structured piece lives IN the bubble it belongs
              to (founder 2026-08-20) — words here are always just yours to
              give; the subsidy ask is a separate, deliberate step. */}
          {d === 'Economic' && (
            <p className="selfaudit__fine">
              In need of subsidies within the network?{' '}
              <button type="button" className="selfaudit__meanslink" onClick={onOpenMeans}>
                Create a financial health profile
              </button>
            </p>
          )}
        </div>
      ))}
      {error && <p className="selfaudit__error">{error}</p>}
      {/* No dead button (founder 2026-08-20: "Answer any aspect to begin
          doesn't go anywhere and is misleading") — the save appears when
          there is something to save. */}
      {touched.length > 0 && (
      <button
        className="btn btn-primary selfaudit__save"
        disabled={saving}
        onClick={() => {
          setSaving(true); setError('');
          void (async () => {
            try {
              for (const d of touched) {
                if (saved.current.has(d)) continue;
                await createCarePost(me, {
                  patientId: me, kind: 'wow', body: entries[d].text.trim(),
                  dimensions: [d], score: entries[d].score ?? undefined,
                  attachments: [], links: [], previews: [],
                });
                saved.current.add(d);
              }
              onDone();
            } catch (e) {
              setError((e as Error)?.message || 'Something went wrong.');
              setSaving(false);
            }
          })();
        }}
      >
        {saving ? 'Weaving it in…' : `Save your evaluation (${touched.length} of 6)`}
      </button>
      )}
    </section>
  );
}

/** Care Team — the directory behind the chat's info circle. On your own
 *  Concierge you manage the team right here (invite by email, approve,
 *  remove); viewing a client's Concierge it stays a read-only roster —
 *  who joins their team is the patient's call. */
function CareTeamDirectory({ subjectId, me }: { subjectId: string; me: string }) {
  const navigate = useNavigate();
  const managing = !!me && subjectId === me;
  // ADMIN vs LICHEN view (founder 2026-08-20): living your care team is a
  // LIST — the people who hold you, calm. Tending it (invite, approve,
  // remove) is admin work, behind the same toggle the rest of the platform
  // uses. ?manage=1 arrives already wearing the admin hat.
  const [searchParams] = useSearchParams();
  const [adminMode, setAdminMode] = useState(() => searchParams.get('manage') === '1');
  const admin = managing && adminMode;

  const [roster, setRoster] = useState<OnCallCaregiver[]>([]);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [invites, setInvites] = useState<CareInvite[]>([]);
  // Caregivers who work without an assistant in Concierge — told to the
  // client plainly (founder 2026-08-17: consent is mutual, mutually visible).
  const [noAi, setNoAi] = useState<Set<string>>(new Set());
  const [myName, setMyName] = useState('');
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Add type-ahead: recognize existing members by name; fall back to email or
  // phone for non-members.
  const [hits, setHits] = useState<{ id: string; full_name: string | null; headline: string | null }[]>([]);
  const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s.trim());
  const isPhone = (s: string) => /^[\d\s()+.-]{7,}$/.test(s.trim());

  const load = useCallback(async () => {
    const [r, care, prof] = await Promise.all([
      loadOnCallRoster(subjectId).catch(() => [] as OnCallCaregiver[]),
      managing ? loadCareLinks().catch(() => ({ links: [], invites: [] })) : Promise.resolve({ links: [], invites: [] }),
      managing ? supabase.from('profiles').select('full_name').eq('id', me).maybeSingle() : Promise.resolve(null),
    ]);
    setRoster(r);
    const myLinks = care.links.filter((l) => l.patient_id === me);
    setLinks(myLinks);
    setInvites(care.invites.filter((i) => i.role === 'caregiver'));
    setMyName((prof?.data as { full_name: string | null } | null)?.full_name ?? '');
    setReady(true);
    if (managing) {
      // Each active caregiver's own concierge-level choice, via the two-party
      // resolver — a caregiver working without AI is worth the client knowing.
      const activeIds = myLinks.filter((l) => l.status === 'active').map((l) => l.caregiver_id);
      const answers = await Promise.all(activeIds.map(async (id) => {
        const cc = await careConsent(me, id).catch(() => null);
        return cc && !cc.caregiverOn ? id : null;
      }));
      setNoAi(new Set(answers.filter((id): id is string => !!id)));
    }
  }, [subjectId, me, managing]);
  useEffect(() => { setReady(false); void load(); }, [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setMsg('');
    try { await fn(); await load(); } catch (e) { setMsg((e as Error)?.message || 'Something went wrong.'); }
    setBusy(false);
  }

  async function invite() {
    setBusy(true); setMsg('');
    const res = await inviteCare('caregiver', email);
    setBusy(false);
    setMsg(res.message);
    if (res.ok) { setEmail(''); void load(); }
  }

  // Name type-ahead — existing members (skip when it looks like email/phone).
  useEffect(() => {
    const q = email.trim();
    if (!managing || q.length < 2 || isEmail(q) || isPhone(q)) { setHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name, headline').ilike('full_name', `%${q}%`).limit(5);
      if (live) setHits(((data as { id: string; full_name: string | null; headline: string | null }[] | null) ?? []).filter((m) => m.id !== me));
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [email, managing, me]);

  async function addExisting(id: string) {
    setBusy(true); setMsg('');
    const res = await addCareCaregiverById(id);
    setBusy(false); setMsg(res.message);
    if (res.ok) { setEmail(''); setHits([]); void load(); }
  }

  async function copyPhoneInvite() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/signup`);
      setMsg(`Invite link copied — text it to ${email.trim()}. Add them here once they join.`);
      setEmail('');
    } catch { setMsg('Could not copy the link.'); }
  }

  // Rich roster data (avatar/headline/phone) exists for ACTIVE caregivers;
  // pending links render from the care rows alone.
  const rosterMap = new Map(roster.map((r) => [r.id, r]));
  const active = links.filter((l) => l.status === 'active');
  const pending = links.filter((l) => l.status === 'pending');
  // Client view has no care links — the roster itself is the list.
  const activeRows = managing
    ? active.map((l) => ({ key: l.id, linkId: l.id, personId: l.caregiver_id, name: l.caregiverName, rich: rosterMap.get(l.caregiver_id) }))
    : roster.map((r) => ({ key: r.id, linkId: '', personId: r.id, name: r.name, rich: r as OnCallCaregiver | undefined }));

  return (
    <section className="conc__team">
      {managing && (
        <div className="view-toggle-row">
          <span className="view-toggle" role="group" aria-label="Care team view">
            <button className={'view-toggle__side view-toggle__side--admin' + (adminMode ? ' is-on' : '')}
              onClick={() => setAdminMode(true)}>Admin</button>
            <button className={'view-toggle__side' + (!adminMode ? ' is-on' : '')}
              onClick={() => setAdminMode(false)}>Lichen view</button>
          </span>
        </div>
      )}
      <p className="conc__team-lead">
        {admin
          ? 'The people who help care for you. Invite by email — they approve before joining.'
          : managing
            ? 'The people who hold you. Admin is where the team is tended.'
            : 'The people actively caring here. Tap a name for their profile.'}
      </p>
      {!ready && <p className="conc__team-muted">Loading…</p>}

      {ready && activeRows.length === 0 && pending.length === 0 && invites.length === 0 && (
        <p className="conc__team-muted">
          {admin ? 'No one on your care team yet — invite your first caregiver below.'
            : 'No active care team yet.'}
        </p>
      )}

      {ready && activeRows.map((row) => (
        <div className="conc__team-row" key={row.key}>
          <button className="conc__team-who" onClick={() => navigate(`/members/${row.personId}`)}>
            <span
              className="urgent__avatar urgent__avatar--sm"
              style={row.rich?.avatarUrl ? undefined : { background: colorFor(row.personId) }}
              aria-hidden
            >
              {row.rich?.avatarUrl ? <img src={row.rich.avatarUrl} alt="" /> : monogramFor(row.name)}
            </span>
            <span className="conc__team-text">
              <span className="conc__team-name">{row.name}</span>
              <span className="conc__team-sub">
                Caregiver{row.rich?.headline ? ` · ${row.rich.headline}` : ''}
                {row.rich && row.rich.windows.length > 0 ? ' · takes on-call shifts' : ''}
                {noAi.has(row.personId) ? ' · works without an AI assistant here' : ''}
              </span>
            </span>
          </button>
          <span className="conc__team-actions">
            {row.rich?.phone && <a className="btn conc__team-btn" href={`tel:${row.rich.phone}`}>Call</a>}
            {row.rich?.phone && <a className="btn conc__team-btn" href={`sms:${row.rich.phone}`}>Text</a>}
            {admin && (
              <button className="btn conc__team-btn" disabled={busy}
                onClick={() => { void act(() => removeCare(row.linkId)); }}>Remove</button>
            )}
          </span>
        </div>
      ))}

      {ready && admin && pending.map((l) => {
        const incoming = l.initiated_by !== me;
        return (
          <div className="conc__team-row" key={l.id}>
            <button className="conc__team-who" onClick={() => navigate(`/members/${l.caregiver_id}`)}>
              <span className="urgent__avatar urgent__avatar--sm"
                style={{ background: colorFor(l.caregiver_id) }} aria-hidden>
                {monogramFor(l.caregiverName)}
              </span>
              <span className="conc__team-text">
                <span className="conc__team-name">{l.caregiverName}</span>
                <span className="conc__team-sub">{incoming ? 'wants to join your care team' : 'invited · awaiting their approval'}</span>
              </span>
            </button>
            <span className="conc__team-actions">
              {incoming && (
                <button className="btn btn-primary conc__team-btn" disabled={busy}
                  onClick={() => { void act(() => approveCare(l.id)); }}>Approve</button>
              )}
              <button className="btn conc__team-btn" disabled={busy}
                onClick={() => { void act(() => removeCare(l.id)); }}>{incoming ? 'Decline' : 'Cancel'}</button>
            </span>
          </div>
        );
      })}

      {ready && admin && invites.map((i) => (
        <div className="conc__team-row" key={i.id}>
          <span className="conc__team-who conc__team-who--static">
            <span className="urgent__avatar urgent__avatar--sm"
              style={{ background: 'var(--bone-edge)' }} aria-hidden>@</span>
            <span className="conc__team-text">
              <span className="conc__team-name">{i.email}</span>
              <span className="conc__team-sub">invited to Lichen — waiting for them to sign up</span>
            </span>
          </span>
          <span className="conc__team-actions">
            <button className="btn conc__team-btn" disabled={busy}
              onClick={() => { void sendCareInviteEmail(i.email, 'caregiver', myName).then(setMsg); }}>Email</button>
            <button className="btn conc__team-btn" disabled={busy}
              onClick={() => { void copyCareInvite(i.email).then(setMsg); }}>Copy</button>
            <button className="btn conc__team-btn" disabled={busy}
              onClick={() => { void act(() => cancelCareInvite(i.id)); }}>Cancel</button>
          </span>
        </div>
      ))}

      {ready && admin && (
        <div className="conc__team-addwrap">
          <div className="conc__team-add">
            <input className="conc__team-input" value={email}
              onChange={(e) => { setEmail(e.target.value); setMsg(''); }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || busy || !email.trim()) return;
                if (isPhone(email)) void copyPhoneInvite(); else void invite();
              }}
              placeholder="Add to your care team — name, email, or phone" />
            {isPhone(email) ? (
              <button className="btn btn-primary conc__team-btn" disabled={busy}
                onClick={() => { void copyPhoneInvite(); }}>Copy invite</button>
            ) : isEmail(email) ? (
              <button className="btn btn-primary conc__team-btn" disabled={busy}
                onClick={() => { void invite(); }}>Invite</button>
            ) : null}
          </div>
          {hits.length > 0 && (
            <div className="conc__team-hits">
              {hits.map((h) => (
                <button className="conc__team-hit" key={h.id} disabled={busy}
                  onClick={() => { void addExisting(h.id); }}>
                  <span className="conc__team-name">{h.full_name ?? 'Member'}</span>
                  {h.headline && <span className="conc__team-sub">{h.headline}</span>}
                  <span className="conc__team-hit-add" aria-hidden>Add</span>
                </button>
              ))}
            </div>
          )}
          {email.trim().length >= 2 && !hits.length && !isEmail(email) && !isPhone(email) && (
            <p className="conc__team-hint">No member by that name — type their email or phone to invite them to Lichen.</p>
          )}
        </div>
      )}
      {msg && <p className="conc__team-msg">{msg}</p>}
    </section>
  );
}

export default function Concierge() {
  const { tab, patientId } = useParams<{ tab?: ConciergeTab; patientId?: string }>();
  const [searchParams] = useSearchParams();
  // Arrived from Profile's "Set up my care team" door — offer the way back.
  const fromProfile = searchParams.get('from') === 'profile';
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const activeTab: ConciergeTab = (tab as ConciergeTab) ?? 'wow';

  // Client view: a caregiver viewing one of their clients' Concierge page.
  // Self view (no patientId): the member's own Concierge. The "subject" is whose
  // care data we show.
  const isClientView = !!patientId;
  const subjectId = patientId ?? me;

  // The Concierge brain is the member's REAL concierge-level AI consent now
  // (founder 2026-08-17) — one row in assistant_consent that the edge
  // functions check server-side. It used to be component state: reset on
  // every mount, controlled nothing. Care is the highest-stakes room, so it
  // was the worst place for a switch to be theatre.
  const [aiOn, setAiOn] = useState(() => consentOn('section', 'concierge'));
  // Mutual visibility (founder 2026-08-17): each side is told what the other
  // chose — silence in either direction is the failure.
  const [clientAiOff, setClientAiOff] = useState(false);
  const [scope, setScope] = useState<'Day' | 'Week' | 'Month'>('Day');
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  // Concierge access (care-team chat, client view): active Concierge tier, or admin.
  const [careAllowed, setCareAllowed] = useState<boolean | null>(null);
  const [careChatId, setCareChatId] = useState<string | null>(null);
  const [careReady, setCareReady] = useState(false);
  const [clientName, setClientName] = useState<string | null>(null);
  const [clientAuthorized, setClientAuthorized] = useState(true); // am I a caregiver of this patient?
  const careAnchor = useRef<HTMLDivElement>(null);
  const [careTop, setCareTop] = useState(0);

  // WOW/KOC care-post board for whoever we're viewing (RLS scopes to care-team reads).
  const [wowPosts, setWowPosts] = useState<CarePostRow[]>([]);
  const [kocPosts, setKocPosts] = useState<CarePostRow[]>([]);
  const [wowFilter, setWowFilter] = useState<Dimension | 'All'>('All');
  const [weekStart, setWeekStart] = useState<string>(mondayOfWeek(todayISO()));
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    if (!me) return;
    let active = true;
    (async () => {
      const allowed = await loadConciergeAccess(me);
      // The care-team chat for whoever we're viewing (self or a client).
      const chatRes = await supabase
        .from('chats').select('id').eq('patient_id', subjectId).eq('kind', 'care_team').maybeSingle();
      let name: string | null = null;
      let authorized = true;
      if (isClientView) {
        // Confirm I actually care for this patient, and grab their name for the header.
        const linkRes = await supabase
          .from('care_team_members')
          .select('patient:profiles!care_team_members_patient_id_fkey(full_name)')
          .eq('caregiver_id', me).eq('patient_id', subjectId).eq('status', 'active')
          .maybeSingle();
        const link = linkRes.data as { patient: { full_name: string | null } | null } | null;
        authorized = !!link;
        name = link?.patient?.full_name ?? 'Client';
        // Their consent, told to you (founder 2026-08-17): if the client has
        // switched AI off at the Concierge level, their caregiver must know —
        // an assistant assumed to be reading a chart it can't is the failure.
        if (authorized) {
          const cc = await careConsent(subjectId, me).catch(() => null);
          if (active) setClientAiOff(cc ? !cc.patientOn : false);
        }
      }
      if (!active) return;
      setCareAllowed(allowed);
      setCareChatId((chatRes.data as { id: string } | null)?.id ?? null);
      setClientName(name);
      setClientAuthorized(authorized);
      setCareReady(true);
    })();
    return () => { active = false; };
  }, [me, subjectId, isClientView]);

  // The care chat is a fixed panel filling from below the tabs to above the nav;
  // measure where it should start so it tracks the (variable) top chrome height.
  useLayoutEffect(() => {
    if (activeTab !== 'chat') return;
    const measure = () => { const el = careAnchor.current; if (el) setCareTop(el.getBoundingClientRect().top); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [activeTab, showSearch, careReady, careAllowed, careChatId, clientName]);

  // Load the subject's WOW posts (unfiltered → feeds the radar) + this week's KOC posts.
  const weekEnd = weekDays(weekStart)[6].iso;
  const [boardNonce, setBoardNonce] = useState(0);

  const [careSettings, setCareSettings] = useState<CareSettings | null>(null);
  const [tuning, setTuning] = useState(false);
  useEffect(() => {
    if (!me) return;
    let active = true;
    setDataReady(false);
    (async () => {
      const [wow, koc, settings] = await Promise.all([
        loadCarePosts(subjectId, 'wow'),
        loadCarePosts(subjectId, 'koc', { from: weekStart, to: weekEnd }),
        getCareSettings(subjectId),
      ]);
      if (!active) return;
      setWowPosts(wow);
      setKocPosts(koc);
      setCareSettings(settings);
      setDataReady(true);
      // The self-driving part: with the switch on, a stale window (>7 days)
      // quietly re-tunes on arrival — the member's evolution keeps steering.
      if (settings?.wow_window_auto && subjectId === me) {
        const age = settings.wow_window_set_at ? Date.now() - new Date(settings.wow_window_set_at).getTime() : Infinity;
        if (age > 7 * 86400_000) {
          void tuneWowWindow().then((r) => {
            if (r && active) setCareSettings((cur) => cur ? { ...cur, wow_window_days: r.days, wow_window_reason: r.reason, wow_window_set_at: new Date().toISOString() } : cur);
          });
        }
      }
    })();
    return () => { active = false; };
  }, [me, subjectId, weekStart, weekEnd, boardNonce]);
  // The window the radar reads through: Claude's pick when the member handed
  // it over, the platform default otherwise. Caregivers see the same number
  // the member does — care_settings RLS lets the team read it.
  const wowWindow = careSettings?.wow_window_auto && careSettings.wow_window_days
    ? careSettings.wow_window_days : WOW_WINDOW_DEFAULT;

  // Sign any attachment paths we haven't signed yet.
  useEffect(() => {
    const need = new Set<string>();
    for (const p of [...wowPosts, ...kocPosts]) for (const a of p.attachments) if (!mediaUrls[a.path]) need.add(a.path);
    if (need.size === 0) return;
    let active = true;
    signCareMedia([...need]).then((m) => { if (active) setMediaUrls((cur) => ({ ...cur, ...m })); });
    return () => { active = false; };
  }, [wowPosts, kocPosts, mediaUrls]);

  async function removePost(id: string) {
    try {
      await deleteCarePost(id);
      setWowPosts((cur) => cur.filter((p) => p.id !== id));
      setKocPosts((cur) => cur.filter((p) => p.id !== id));
    } catch (e) { console.error(e); }
  }
  function shiftWeek(days: number) {
    const d = localDate(weekStart); d.setDate(d.getDate() + days); setWeekStart(toISO(d));
  }

  // Default scope follows the active tab: Day for WOW, Week for KOC
  useEffect(() => {
    if (activeTab === 'koc') setScope('Week');
    else if (activeTab === 'wow') setScope('Day');
  }, [activeTab]);

  // Tab routing — patient-aware so client view stays within /concierge/client/:id.
  const basePath = isClientView ? `/concierge/client/${patientId}` : '/concierge';
  const handleTabClick = (target: ConciergeTab) => {
    navigate(target === 'wow' ? basePath : `${basePath}/${target}`);
  };

  // Caregivers author their client's snapshots/plans — and since 2026-08-14
  // you author on YOUR OWN board too (the self-audit + updated scores;
  // care_posts RLS gained the matching self-arm).
  const canAuthor = isClientView ? clientAuthorized : true;

  // In client view, gate the WHOLE page behind access + caregiver relationship.
  if (isClientView && careReady && (careAllowed === false || !clientAuthorized)) {
    return (
      <div className="conc">
        <header className="conc__head conc__head--client">
          <button className="conc__back" onClick={() => navigate('/caregiver')} aria-label="Back">
            <Icon name="arrow-left" size={18} />
          </button>
          <h1 className="conc__title">Concierge</h1>
        </header>
        <div className="conc__care-gate">
          <Icon name="shield-user" size={22} />
          <h3 className="conc__care-gate-title">
            {careAllowed === false ? 'Concierge access required' : 'Not your client'}
          </h3>
          <p className="conc__care-gate-sub">
            {careAllowed === false
              ? 'The caregiver dashboard is part of Concierge membership.'
              : 'You don’t have an active care connection with this member.'}
          </p>
          <button className="btn btn-primary" onClick={() => navigate(careAllowed === false ? '/membership' : '/caregiver')}>
            {careAllowed === false ? 'See Concierge' : 'Back to clients'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="conc">
      <header className={'conc__head' + (isClientView ? ' conc__head--client' : '')}>
        {isClientView ? (
          <button className="conc__back" onClick={() => navigate('/caregiver')} aria-label="Back to clients">
            <Icon name="arrow-left" size={18} />
          </button>
        ) : fromProfile && (
          <button className="conc__back" onClick={() => navigate('/profile')} aria-label="Back to profile">
            <Icon name="arrow-left" size={18} />
          </button>
        )}
        <h1 className="conc__title">
          {isClientView ? (clientName ?? 'Client') : 'Concierge'}
        </h1>
        {isClientView && <span className="conc__client-tag">Client view</span>}
      </header>

      {/* Consent is mutual, and mutually visible (founder 2026-08-17): the
          client's choice governs both assistants here, and their caregiver is
          told rather than left assuming. */}
      {isClientView && clientAiOff && (
        <p className="conc__ai-note">
          <Icon name="brain" size={13} />
          <span>
            {clientName ?? 'This member'} has switched AI off for their care —
            no assistant, yours included, reads or helps with this board.
          </span>
        </p>
      )}

      {/* 4 tabs: WOW / KOC / Chat / Urgent Care */}
      <nav className="conc__tabs">
        <button
          className={'conc__tab' + (activeTab === 'wow' ? ' is-active' : '')}
          onClick={() => handleTabClick('wow')}
        >
          WOW
        </button>
        <button
          className={'conc__tab' + (activeTab === 'koc' ? ' is-active' : '')}
          onClick={() => handleTabClick('koc')}
        >
          KOC
        </button>
        <button
          className={'conc__tab' + (activeTab === 'chat' ? ' is-active' : '')}
          onClick={() => handleTabClick('chat')}
        >
          Chat
        </button>
        <button
          className={'conc__tab' + (activeTab === 'urgent' ? ' is-active' : '')}
          onClick={() => handleTabClick('urgent')}
        >
          Urgent Care
        </button>
        <button
          className={'conc__tab' + (activeTab === 'team' ? ' is-active' : '')}
          onClick={() => handleTabClick('team')}
        >
          Care Team
        </button>
      </nav>

      {/* Tool row (search · AI brain · scope · pagination) */}
      <div className="conc__tools">
        <button
          className={'conc__tool-circle' + (showSearch ? ' is-active' : '')}
          onClick={() => {
            setShowSearch((s) => !s);
            if (showSearch) setQuery('');
          }}
          aria-label="Search"
        >
          <Icon name="search" size={14} />
        </button>
        <button
          className={'conc__brain' + (aiOn ? ' is-on' : '')}
          onClick={() => {
            const next = !aiOn;
            setAiOn(next);
            setConsent('section', 'concierge', next);
          }}
          aria-pressed={aiOn}
          title={aiOn
            ? 'Your assistant is part of your care here \u2014 tap to switch it off. Your care team can see your choice.'
            : 'You\u2019ve switched AI off for your care \u2014 no assistant reads or helps here, and your care team can see that. Tap to change.'}
        >
          <Icon name="brain" size={20} />
        </button>
        {activeTab !== 'chat' && activeTab !== 'urgent' && (
          <>
            {/* Same control language as the Calendar's view picker (founder,
                2026-07-17) — a dropdown, not a tap-to-cycle pill. */}
            <select
              className="conc__vselect"
              value={scope}
              onChange={(e) => setScope(e.target.value as typeof scope)}
              aria-label="Scope"
            >
              {(['Day', 'Week', 'Month'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="conc__pager">
              <button className="conc__tool-circle conc__pager-btn" aria-label="Previous">
                <Icon name="chevron-left" size={12} />
              </button>
              <button className="conc__tool-circle conc__pager-btn" aria-label="Next">
                <Icon name="chevron-right" size={12} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Search bar (toggleable) */}
      {showSearch && (
        <div className="conc__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="conc__search-input"
            placeholder="Search your snapshots"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} className="conc__search-clear" aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Active tab content */}
      {activeTab === 'wow' && (() => {
        const scores = computeWowScores(wowPosts, new Date(), wowWindow);
        // The member's OWN answers, latest per aspect — the gate for the
        // financial profile and the picture it shows (founder 2026-08-20).
        const mine = wowPosts.filter((p) => p.author_id === subjectId);
        const latest: Partial<Record<Dimension, { body: string; score: number | null }>> = {};
        for (const p of [...mine].reverse()) {
          for (const d of p.dimensions) if (!latest[d] && (p.body.trim() || p.score != null)) {
            latest[d] = { body: p.body, score: p.score };
          }
        }
        const ownWeb = { answered: WOW_DIMENSIONS.filter((d) => !!latest[d]), latest };
        const feed = wowFilter === 'All' ? wowPosts : wowPosts.filter((p) => p.dimensions.includes(wowFilter));
        return (
          <>
            {!dataReady && <p className="conc__care-hint">Loading…</p>}
            {dataReady && wowPosts.length > 0 && (
              <>
                <div className="wow__overall">
                  <span className="wow__overall-num">{scores.overall != null ? `${scores.overall}%` : '—'}</span>
                  <span className="wow__overall-lbl">Overall wellbeing</span>
                </div>
                <div className="wow__radar"><HexagonRadar axes={wowAxes(scores.byDimension)} size={200} /></div>
                <div className="wow__chips">
                  {(['All', ...WOW_DIMENSIONS] as const).map((c) => (
                    <button key={c} className={'wow__chip' + (wowFilter === c ? ' is-on' : '')} onClick={() => setWowFilter(c)}>{c}</button>
                  ))}
                </div>
                {/* THE SELF-DRIVING WINDOW (founder 2026-08-14): the score is
                    a now-reading over a window; whose hands the window is in
                    is the member's choice — visible, reasoned, revocable. */}
                {!isClientView && (
                  <div className="wowwin">
                    {careSettings?.wow_window_auto ? (
                      <>
                        <p className="wowwin__line">
                          Claude tunes your window as you evolve — currently <strong>{wowWindow} days</strong>.
                          {careSettings.wow_window_reason && <span className="wowwin__reason"> “{careSettings.wow_window_reason}”</span>}
                        </p>
                        <button className="wowwin__btn" disabled={tuning}
                          onClick={() => {
                            setTuning(true);
                            void setWowWindowAuto(me, false)
                              .then(() => setCareSettings((cur) => cur ? { ...cur, wow_window_auto: false } : cur))
                              .finally(() => setTuning(false));
                          }}>
                          Take the wheel back
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="wowwin__line">Scores read your last <strong>{WOW_WINDOW_DEFAULT} days</strong>.</p>
                        <button className="wowwin__btn" disabled={tuning}
                          title="Claude picks the window from the rhythm of your entries — always shown with its reason, always yours to take back"
                          onClick={() => {
                            setTuning(true);
                            void setWowWindowAuto(me, true)
                              .then(() => tuneWowWindow())
                              .then((r) => setCareSettings((cur) => ({
                                wow_window_auto: true,
                                wow_window_days: r?.days ?? cur?.wow_window_days ?? null,
                                wow_window_reason: r?.reason ?? cur?.wow_window_reason ?? null,
                                wow_window_set_at: new Date().toISOString(),
                              })))
                              .finally(() => setTuning(false));
                          }}>
                          {tuning ? 'Tuning…' : 'Let Claude tune it'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {canAuthor && (
              <button className="board__post-btn" onClick={() => navigate(`${basePath}/wow/edit`)} aria-label="Post to Web of Wellbeing">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {/* Your web KICKS OFF with the self-evaluation (founder
                2026-08-14) — it shows until you've authored something
                yourself, even if the care team spoke first. */}
            {dataReady && !isClientView && !wowPosts.some((p) => p.author_id === me) && (
              <SelfAudit
                me={me}
                onDone={() => setBoardNonce((n) => n + 1)}
                onOpenMeans={() => navigate('/concierge/financial')}
              />
            )}
            {/* The financial picture sits UNDER the self-evaluation (founder
                2026-08-15): it's the sixth aspect's structured companion, not
                a banner over the whole board — and it carries the honest
                condition for subsidised care. */}
            {/* THE OWNER'S FORM MOVED OUT (founder 2026-08-20): "create a
                financial health profile should click you through to the loan
                app form" — it's /concierge/financial now, not a bubble at the
                foot of the board. What stays here is the READ side: a
                caregiver looking at their client's picture. */}
            {dataReady && isClientView && (
              <MeansCard subjectId={subjectId} me={me} web={ownWeb} />
            )}
            {dataReady && isClientView && wowPosts.length === 0 && (
              <ConciergeEmpty icon="health" title="Web of Wellbeing"
                sub={canAuthor
                  ? 'Post the first entry — add content, tag a dimension, and give it a wellbeing score.'
                  : "They haven't been woven into their web yet."} />
            )}
            {feed.map((p) => (
              <CarePostCard key={p.id} post={p} mediaUrls={mediaUrls}
                canDelete={canAuthor && p.author_id === me} onDelete={removePost} />
            ))}
          </>
        );
      })()}

      {activeTab === 'koc' && (
        <>
          <div className="koc__weeknav">
            <button className="conc__tool-circle" onClick={() => shiftWeek(-7)} aria-label="Previous week"><Icon name="chevron-left" size={14} /></button>
            <span className="koc__weeklbl">{formatWeekRange(weekStart)}</span>
            <button className="conc__tool-circle" onClick={() => shiftWeek(7)} aria-label="Next week"><Icon name="chevron-right" size={14} /></button>
          </div>
          {canAuthor && (
            <button className="board__post-btn" onClick={() => navigate(`${basePath}/koc/edit`)} aria-label="Post to care plan">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {!dataReady && <p className="conc__care-hint">Loading…</p>}
          {dataReady && weekDays(weekStart).map((day) => {
            const posts = kocPosts.filter((p) => occursOn(p, day.iso));
            return (
              <section className="koc__daysec" key={day.iso}>
                <h3 className="koc__daylbl">{day.label}</h3>
                {posts.length === 0
                  ? <p className="koc__dayempty">Nothing scheduled</p>
                  : posts.map((p) => (
                    <CarePostCard key={p.id + day.iso} post={p} mediaUrls={mediaUrls}
                      canDelete={canAuthor && p.author_id === me} onDelete={removePost} />
                  ))}
              </section>
            );
          })}
        </>
      )}

      {activeTab === 'chat' && (
        <>
          <div ref={careAnchor} className="conc__care-anchor" aria-hidden="true" />

          {!careReady && <p className="conc__care-hint">Loading your care team…</p>}

          {careReady && careAllowed === false && (
            <div className="conc__care-gate">
              <Icon name="shield-user" size={22} />
              <h3 className="conc__care-gate-title">Your care team, in one place</h3>
              <p className="conc__care-gate-sub">
                The care-team chat — where your practitioners coordinate with you — is part of
                Concierge membership.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/membership')}>
                See Concierge
              </button>
            </div>
          )}

          {careReady && careAllowed && !careChatId && (
            <div className="conc__care-gate">
              <Icon name="heart-line" size={22} />
              <h3 className="conc__care-gate-title">No care team yet</h3>
              <p className="conc__care-gate-sub">
                Add caregivers from your profile. Once someone joins, your care-team chat opens here.
              </p>
              <button className="btn btn-primary" onClick={() => navigate('/profile')}>
                Manage care team
              </button>
            </div>
          )}

          {careReady && careAllowed && careChatId && (
            <div className="conc__care" style={{ top: careTop }}>
              <ChatConversation chatId={careChatId} me={me} showIntro={false} onInfo={() => handleTabClick('team')} />
            </div>
          )}
        </>
      )}

      {activeTab === 'urgent' && <UrgentCare subjectId={subjectId} me={me} />}
      {activeTab === 'team' && <CareTeamDirectory subjectId={subjectId} me={me} />}
    </div>
  );
}


/** THE FINANCIAL HEALTH PROFILE, on its own screen (founder 2026-08-20:
 *  "create a financial health profile should click you through to the loan
 *  app form"). Reached from the Economic bubble of the Web-of-Wellbeing
 *  self-assessment; always fillable — an unfinished web shows a linked
 *  invitation to complete it, and answered aspects show back. */
export function FinancialProfilePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [posts, setPosts] = useState<CarePostRow[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void loadCarePosts(me, 'wow').then((rows) => { if (live) { setPosts(rows); setReady(true); } });
    return () => { live = false; };
  }, [me]);

  const latest: Partial<Record<Dimension, { body: string; score: number | null }>> = {};
  for (const p of [...posts].filter((p) => p.author_id === me).reverse()) {
    for (const d of p.dimensions) if (!latest[d] && (p.body.trim() || p.score != null)) {
      latest[d] = { body: p.body, score: p.score };
    }
  }
  const web = { answered: WOW_DIMENSIONS.filter((d) => !!latest[d]), latest };

  if (!me) return null;
  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={() => navigate('/concierge')} aria-label="Back">
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 className="cedit__title">Financial health profile</h1>
      </header>
      <p className="means__pagelead">
        What the network needs in order to help carry your costs — and what
        money alone won&rsquo;t fix. Only you and your active care team ever see it.
      </p>
      {!ready ? <p className="conc__team-muted">Loading…</p>
        : <MeansCard subjectId={me} me={me} web={web} standalone />}
    </div>
  );
}
