import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon, IconName } from '../components/Icon';
import HexagonRadar from '../components/HexagonRadar';
import ChatConversation from '../components/ChatConversation';
import CarePostCard from '../components/CarePostCard';
import { supabase } from '../lib/supabase';
import {
  loadConciergeAccess, ensureDirectChat, monogramFor, colorFor, uploadChatMedia,
  type MediaType, type Attachment,
} from '../lib/chatApi';
import {
  loadCarePosts, computeWowScores, wowAxes, signCareMedia, deleteCarePost,
  WOW_DIMENSIONS, mondayOfWeek, todayISO, weekDays, formatWeekRange, localDate, toISO,
  loadOnCallRoster, onCallNow, nextOnCall, nextOnCallLabel,
  type CarePostRow, type Dimension, type OnCallCaregiver,
} from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import {
  loadCareLinks, inviteCare, approveCare, removeCare, cancelCareInvite,
  copyCareInvite, sendCareInviteEmail, type CareLink, type CareInvite,
} from '../lib/careTeamApi';
import { occursOn } from '../lib/recurrence';
import { useAuth } from '../auth/AuthProvider';
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

/** Care Team — the directory behind the chat's info circle. On your own
 *  Concierge you manage the team right here (invite by email, approve,
 *  remove); viewing a client's Concierge it stays a read-only roster —
 *  who joins their team is the patient's call. */
function CareTeamDirectory({ subjectId, me }: { subjectId: string; me: string }) {
  const navigate = useNavigate();
  const managing = !!me && subjectId === me;

  const [roster, setRoster] = useState<OnCallCaregiver[]>([]);
  const [links, setLinks] = useState<CareLink[]>([]);
  const [invites, setInvites] = useState<CareInvite[]>([]);
  const [myName, setMyName] = useState('');
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [r, care, prof] = await Promise.all([
      loadOnCallRoster(subjectId).catch(() => [] as OnCallCaregiver[]),
      managing ? loadCareLinks().catch(() => ({ links: [], invites: [] })) : Promise.resolve({ links: [], invites: [] }),
      managing ? supabase.from('profiles').select('full_name').eq('id', me).maybeSingle() : Promise.resolve(null),
    ]);
    setRoster(r);
    setLinks(care.links.filter((l) => l.patient_id === me));
    setInvites(care.invites.filter((i) => i.role === 'caregiver'));
    setMyName((prof?.data as { full_name: string | null } | null)?.full_name ?? '');
    setReady(true);
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
      <p className="conc__team-lead">
        {managing
          ? 'The people who help care for you. Invite by email — they approve before joining.'
          : 'The people actively caring here. Tap a name for their profile.'}
      </p>
      {!ready && <p className="conc__team-muted">Loading…</p>}

      {ready && activeRows.length === 0 && pending.length === 0 && invites.length === 0 && (
        <p className="conc__team-muted">
          {managing ? 'No one on your care team yet — invite your first caregiver below.'
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
              </span>
            </span>
          </button>
          <span className="conc__team-actions">
            {row.rich?.phone && <a className="btn conc__team-btn" href={`tel:${row.rich.phone}`}>Call</a>}
            {row.rich?.phone && <a className="btn conc__team-btn" href={`sms:${row.rich.phone}`}>Text</a>}
            {managing && (
              <button className="btn conc__team-btn" disabled={busy}
                onClick={() => { void act(() => removeCare(row.linkId)); }}>Remove</button>
            )}
          </span>
        </div>
      ))}

      {ready && managing && pending.map((l) => {
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

      {ready && managing && invites.map((i) => (
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

      {ready && managing && (
        <div className="conc__team-add">
          <input className="conc__team-input" type="email" value={email}
            onChange={(e) => { setEmail(e.target.value); setMsg(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && email.trim() && !busy) void invite(); }}
            placeholder="Add a caregiver by email" />
          <button className="btn btn-primary conc__team-btn" disabled={busy || !email.trim()}
            onClick={() => { void invite(); }}>Invite</button>
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

  const [aiOn, setAiOn] = useState(true);
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
  useEffect(() => {
    if (!me) return;
    let active = true;
    setDataReady(false);
    (async () => {
      const [wow, koc] = await Promise.all([
        loadCarePosts(subjectId, 'wow'),
        loadCarePosts(subjectId, 'koc', { from: weekStart, to: weekEnd }),
      ]);
      if (!active) return;
      setWowPosts(wow);
      setKocPosts(koc);
      setDataReady(true);
    })();
    return () => { active = false; };
  }, [me, subjectId, weekStart, weekEnd]);

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

  // Caregivers author their client's snapshots/plans; the patient's self view is read-only.
  const canAuthor = isClientView && clientAuthorized;

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
          onClick={() => setAiOn((v) => !v)}
          aria-pressed={aiOn}
          title={aiOn ? 'AI assistance on \u2014 tap to disable' : 'AI assistance off \u2014 tap to enable'}
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
        const scores = computeWowScores(wowPosts);
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
              </>
            )}
            {canAuthor && (
              <button className="board__post-btn" onClick={() => navigate(`${basePath}/wow/edit`)} aria-label="Post to Web of Wellbeing">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M9 3.75V14.25M3.75 9H14.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {dataReady && wowPosts.length === 0 && (
              <ConciergeEmpty icon="health" title="Web of Wellbeing"
                sub={canAuthor
                  ? 'Post the first entry — add content, tag a dimension, and give it a wellbeing score.'
                  : "Your care team hasn't posted here yet."} />
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
