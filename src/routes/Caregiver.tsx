import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import {
  loadConciergeAccess, loadCareClients, loadUnreadCounts, messagePreview, formatRelative,
  colorFor, monogramFor, CareClient,
} from '../lib/chatApi';
import {
  loadCarePosts, computeWowLenses, wowScoreBand, getCareSettings, WOW_WINDOW_DEFAULT,
  loadOnCallRoster, onCallNow, nextOnCall, nextOnCallLabel, type OnCallCaregiver,
} from '../lib/conciergeApi';
import { loadMyAvailability, minToLabel, type AvailabilityWindow } from '../lib/calendarApi';
import {
  loadCareLinks, approveCare, removeCare, remindCareRequest, remindedRecently,
  sendCareInviteEmail, prepareCareText, cancelCareInvite, type CareLink, type CareInvite,
} from '../lib/careTeamApi';
import CareAddBox from '../components/CareAddBox';
import { supabase } from '../lib/supabase';
import './Caregiver.css';

type CgTab = 'wow' | 'koc' | 'chat' | 'urgent' | 'clients';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Per-client glance data for the WOW and KOC tabs — the client's own
 *  numbers, read through their own window so the dashboard never disagrees
 *  with their board. */
type ClientStats = { overall: number | null; kocWeek: number; roster: OnCallCaregiver[] };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Caregiver dashboard — a Concierge feature, mirroring the Concierge board's
 *  own tabs (founder 2026-09-26: "the WOW tab for your prof dashboard lists
 *  all the clients you have… Same for the KOC… Care Team is Client List
 *  instead"). Every tab is your clients through that lens; clicking through
 *  lands on that client's board, where you can engage with any aspect. */
export default function Caregiver() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [clients, setClients] = useState<CareClient[]>([]);
  const [loading, setLoading] = useState(true);
  // Client List is the LANDING tab (founder 2026-09-27: "This should
  // default to 'Client List' when you toggle to provider view") — the
  // other tabs are lenses on that list once you're here.
  const [tab, setTab] = useState<CgTab>('clients');
  const [stats, setStats] = useState<Map<string, ClientStats>>(new Map());
  const [statsReady, setStatsReady] = useState(false);
  const [unread, setUnread] = useState<Map<string, number>>(new Map());
  // Your own on-call rota (Urgent Care tab) — HOURS ARE SET in Calendar
  // settings, the one editor (standing rule); this tab reads them back and
  // holds the door.
  const [myOnCall, setMyOnCall] = useState<AvailabilityWindow[]>([]);
  // For the empty state's add-your-first-client box (the prepared care text
  // speaks the inviter's name).
  const [myName, setMyName] = useState('');
  // THE ROSTER MANAGER (founder 2026-10-19: "pending clients with an accept
  // or reject button… it feels like it should be in your provider dashboard"):
  // pending links where I'M the caregiver + my outstanding client invitations
  // render right on the Client List tab — nobody is sent to Profile to decide.
  const [pendLinks, setPendLinks] = useState<CareLink[]>([]);
  const [pendInvites, setPendInvites] = useState<CareInvite[]>([]);
  const [pendBusy, setPendBusy] = useState('');
  const [confirmId, setConfirmId] = useState('');
  const [pendMsg, setPendMsg] = useState('');

  useEffect(() => {
    if (!me) return;
    void supabase.from('profiles').select('full_name').eq('id', me).maybeSingle()
      .then(({ data }) => setMyName((data as { full_name: string | null } | null)?.full_name ?? ''));
  }, [me]);

  useEffect(() => {
    if (!me) return;
    let active = true;
    (async () => {
      let ok = await loadConciergeAccess(me);
      // A brand-new member's growth gift can land a beat after arrival (the
      // App gate grants it in parallel) — one short re-check before the gate
      // card ever shows, so nobody meets a paywall their gift already opened
      // (founder 2026-10-19: "that weird, intermediary screen").
      if (!ok) {
        await new Promise((r) => setTimeout(r, 1200));
        if (!active) return;
        ok = await loadConciergeAccess(me);
      }
      if (!active) return;
      setAllowed(ok);
      if (ok) {
        const [list, counts, roster] = await Promise.all([
          loadCareClients(me), loadUnreadCounts(), loadCareLinks().catch(() => null),
        ]);
        if (!active) return;
        // Alphabetical (founder 2026-10-19: "your list of clients in
        // alphabetical order") — recency stays visible on the Chat lens's
        // time labels, the ORDER is a roster's.
        setClients([...list].sort((a, b) => a.name.localeCompare(b.name)));
        if (roster) {
          setPendLinks(roster.links.filter((l) => l.caregiver_id === me && l.status === 'pending'));
          setPendInvites(roster.invites.filter((i) => i.role === 'patient'));
        }
        setUnread(counts);
        setLoading(false);
        // The glance numbers, per client: their current overall WOW (self +
        // care team combined, through their own tuned window) and this
        // week's plan entries. Loaded after the list so the rows never wait.
        const now = new Date();
        const mon = new Date(now); mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
        const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        const [rows, mine] = await Promise.all([
          Promise.all(list.map(async (c) => {
            const [wow, koc, settings, roster] = await Promise.all([
              loadCarePosts(c.patient_id, 'wow').catch(() => []),
              loadCarePosts(c.patient_id, 'koc', { from: iso(mon), to: iso(sun) }).catch(() => []),
              getCareSettings(c.patient_id).catch(() => null),
              loadOnCallRoster(c.patient_id).catch(() => [] as OnCallCaregiver[]),
            ]);
            const windowDays = settings?.wow_window_auto && settings.wow_window_days
              ? settings.wow_window_days : WOW_WINDOW_DEFAULT;
            const lenses = computeWowLenses(wow, c.patient_id, new Date(), windowDays);
            return [c.patient_id, { overall: lenses.combo.overall, kocWeek: koc.length, roster }] as const;
          })),
          loadMyAvailability(me).catch(() => [] as AvailabilityWindow[]),
        ]);
        if (!active) return;
        setStats(new Map(rows));
        setMyOnCall(mine.filter((w) => w.kind === 'on_call'));
        setStatsReady(true);
      } else {
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [me]);

  /** Re-read clients + the pending roster after any decision or add. */
  async function refreshRoster() {
    const [list, roster] = await Promise.all([loadCareClients(me), loadCareLinks()]);
    setClients([...list].sort((a, b) => a.name.localeCompare(b.name)));
    setPendLinks(roster.links.filter((l) => l.caregiver_id === me && l.status === 'pending'));
    setPendInvites(roster.invites.filter((i) => i.role === 'patient'));
  }

  async function acceptAsk(l: CareLink) {
    setPendBusy(l.id); setPendMsg('');
    try {
      await approveCare(l.id);
      await refreshRoster();
      setPendMsg(`${l.patientName} is your client now.`);
    } catch { setPendMsg('That didn’t save — try again.'); }
    setPendBusy('');
  }

  async function declineAsk(l: CareLink) {
    if (confirmId !== l.id) { setConfirmId(l.id); return; }
    setConfirmId(''); setPendBusy(l.id); setPendMsg('');
    try { await removeCare(l.id); await refreshRoster(); }
    catch { setPendMsg('That didn’t save — try again.'); }
    setPendBusy('');
  }

  async function remindAsk(l: CareLink) {
    setPendBusy(l.id);
    setPendMsg(await remindCareRequest(l.id));
    setPendLinks((rows) => rows.map((r) => (r.id === l.id ? { ...r, reminded_at: new Date().toISOString() } : r)));
    setPendBusy('');
  }

  async function emailInvite(i: CareInvite) {
    setPendBusy(i.id);
    const m = await sendCareInviteEmail(i.id, myName, i.email);
    setPendMsg(m);
    // Stamp locally only when a send actually went out (the server stamps
    // reminded_at only after Resend accepts — mirror that).
    if (/emailed/i.test(m)) {
      setPendInvites((rows) => rows.map((r) => (r.id === i.id ? { ...r, reminded_at: new Date().toISOString() } : r)));
    }
    setPendBusy('');
  }

  async function textInvite(i: CareInvite) {
    if (!i.phone) return;
    setPendBusy(i.id);
    const t = await prepareCareText('patient', i.phone, myName);
    setPendBusy('');
    window.location.href = t.href;
  }

  async function cancelInvite(i: CareInvite) {
    if (confirmId !== i.id) { setConfirmId(i.id); return; }
    setConfirmId(''); setPendBusy(i.id); setPendMsg('');
    try { await cancelCareInvite(i.id); await refreshRoster(); }
    catch { setPendMsg('That didn’t save — try again.'); }
    setPendBusy('');
  }

  const TABS: { id: CgTab; label: string }[] = [
    { id: 'wow', label: 'WOW' },
    { id: 'koc', label: 'KOC' },
    { id: 'chat', label: 'Chat' },
    { id: 'urgent', label: 'Urgent Care' },
    { id: 'clients', label: 'Client List' },
  ];
  const SUBS: Record<CgTab, string> = {
    wow: 'Each client’s Web of Wellbeing at a glance. Open one to read their web and weave entries in.',
    koc: 'Each client’s care plan. Open one to see the week and add plan entries.',
    chat: 'Every care conversation you’re part of, one per client.',
    urgent: 'Who answers urgently for each client — and your own on-call hours.',
    clients: 'People whose care team you’re on. Open a client to engage with any part of their board.',
  };

  const go = (c: CareClient) => {
    navigate(tab === 'koc' ? `/concierge/client/${c.patient_id}/koc`
      : tab === 'chat' ? `/concierge/client/${c.patient_id}/chat`
        : tab === 'urgent' ? `/concierge/client/${c.patient_id}/urgent`
          : `/concierge/client/${c.patient_id}`);
  };

  /** One line per client: who holds the urgent door right now, or next. */
  const urgentLine = (s: ClientStats | undefined): string => {
    if (!statsReady || !s) return '…';
    if (!s.roster.length || s.roster.every((r) => r.windows.length === 0)) {
      return 'No on-call hours set for this team';
    }
    const now = new Date();
    const today = iso(now);
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const live = s.roster.find((r) => onCallNow(r.windows, today, nowMin));
    if (live) return `${live.name.split(' ')[0]} is on call now`;
    let best: { name: string; next: { iso: string; startMin: number } } | null = null;
    for (const r of s.roster) {
      const n = nextOnCall(r.windows, today, nowMin);
      if (n && (!best || n.iso < best.next.iso
        || (n.iso === best.next.iso && n.startMin < best.next.startMin))) {
        best = { name: r.name, next: n };
      }
    }
    return best ? `${best.name.split(' ')[0]} · ${nextOnCallLabel(best.next)}` : 'No on-call hours set for this team';
  };

  return (
    <div className="cg">
      {/* The dashboard switch is a DROPDOWN at the upper right (founder
          2026-09-26, third pass — "a drop down to the upper right for My
          Concierge versus Provider View"), mirrored from Concierge. */}
      {!loading && allowed && (
        <div className="cg__dashdrop">
          <select className="cg__dash-select" value="provider" aria-label="Dashboard"
            onChange={(e) => { if (e.target.value === 'me') navigate('/concierge'); }}>
            <option value="me">My Concierge</option>
            <option value="provider">Provider View</option>
          </select>
        </div>
      )}

      <header className="cg__head">
        <span className="eyebrow">Caregiver</span>
        <h1 className="cg__title">
          <span className="display-italic">Your clients</span>
        </h1>
        <p className="cg__sub">{SUBS[tab]}</p>
      </header>

      {!loading && allowed && (
        <nav className="cg__tabs" aria-label="Caregiver views">
          {TABS.map((t) => (
            <button key={t.id} className={'cg__tab' + (tab === t.id ? ' is-active' : '')}
              onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      )}

      {loading && <div className="cg__empty"><p>Loading your clients…</p></div>}

      {!loading && allowed === false && (
        <div className="cg__gate">
          <Icon name="shield-user" size={22} />
          <h3 className="cg__gate-title">A Concierge feature</h3>
          <p className="cg__gate-sub">
            The caregiver dashboard — one place for all the people you care for — is part of
            Concierge membership.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/membership')}>See Concierge</button>
        </div>
      )}

      {/* THE PRACTITIONER'S FIRST SCREEN (founder 2026-10-13: "concierge
          dashboard only… subsidies for their clients and coordinate their
          clients' care") — a new practitioner lands here with no clients, so
          the empty state IS the add door: offer to care for someone, and the
          moment they accept, their board appears in this list. */}
      {!loading && allowed && clients.length === 0 && (
        <div className="cg__empty">
          <Icon name="heart-line" size={20} />
          <p>No clients yet</p>
          <p className="cg__empty-sub">
            Add your first client below — search members by name, or invite
            someone by email or phone. Care is consensual: they appear here
            the moment they say yes.
          </p>
          <div className="cg__empty-add">
            <CareAddBox role="patient" me={me} myName={myName} onAdded={() => void refreshRoster()}
              placeholder="A client’s name, email, or phone…" />
          </div>
        </div>
      )}

      {/* Urgent Care leads with YOUR rota (founder 2026-09-26: "the way
          you go in and set 'on call' details for yourself"): hours are
          read back here, and the door goes to Calendar settings — the one
          hours editor, never a second. */}
      {!loading && allowed && tab === 'urgent' && (
        <div className="cg__oncall">
          <p className="cg__oncall-lead">Your on-call hours</p>
          {myOnCall.length === 0
            ? <p className="cg__oncall-empty">You haven&rsquo;t set on-call hours yet — clients can&rsquo;t reach you urgently until you do.</p>
            : (
              <ul className="cg__oncall-list">
                {myOnCall.map((w) => (
                  <li key={w.id}>{DAY_NAMES[w.weekday]} {minToLabel(w.start_min)} – {minToLabel(w.end_min)}</li>
                ))}
              </ul>
            )}
          <button className="cg__oncall-set link-cue" onClick={() => navigate('/calendar/settings')}>
            Set your on-call hours &rsaquo;
          </button>
        </div>
      )}

      {!loading && allowed && clients.length > 0 && (
        <div className="cg__list">
          {clients.map((c) => {
            const s = stats.get(c.patient_id);
            const n = c.chatId ? (unread.get(c.chatId) ?? 0) : 0;
            return (
              <button key={c.patient_id} className="cg__row" onClick={() => go(c)}>
                <span className="cg__avatar" style={{ background: colorFor(c.patient_id) }}>
                  {monogramFor(c.name)}
                </span>
                <span className="cg__row-body">
                  <span className="cg__row-top">
                    <span className="cg__row-name">{c.name}</span>
                    {tab === 'chat' && (
                      <span className="cg__row-time">{c.last ? formatRelative(c.last.created_at) : ''}</span>
                    )}
                  </span>
                  {tab === 'wow' && (
                    <span className="cg__row-preview">
                      {!statsReady ? '…'
                        : s?.overall != null
                          ? <>Overall <span className={'cg__score is-' + wowScoreBand(s.overall)}>{s.overall}%</span></>
                          : 'No WOW entries yet'}
                    </span>
                  )}
                  {tab === 'koc' && (
                    <span className="cg__row-preview">
                      {!statsReady ? '…'
                        : s?.kocWeek
                          ? `${s.kocWeek} plan ${s.kocWeek === 1 ? 'entry' : 'entries'} this week`
                          : 'Nothing on the plan this week'}
                    </span>
                  )}
                  {tab === 'urgent' && (
                    <span className="cg__row-preview">{urgentLine(s)}</span>
                  )}
                  {(tab === 'chat' || tab === 'clients') && (
                    <span className="cg__row-preview">
                      {c.last ? messagePreview(c.last) : <em>No messages yet</em>}
                    </span>
                  )}
                </span>
                <span className="cg__row-side">
                  {tab === 'chat' && n > 0 && <span className="cg__pill">{n}</span>}
                  <Icon name="chevron-right" size={16} />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* THE ROSTER MANAGER (founder 2026-10-19: "pending clients with an
          accept or reject button until the practitioner makes the decision…
          it feels like it should be in your provider dashboard"): every
          pending edge where I'm the caregiver, decided right here — asked
          of me → Accept / Decline; my own offer → Remind; a non-member I
          invited → Email / Text / Cancel. Care stays consensual: nothing
          here acts for the other person. */}
      {!loading && allowed && tab === 'clients' && (pendLinks.length > 0 || pendInvites.length > 0) && (
        <div className="cg__pend">
          <p className="cg__pend-h">Waiting on a yes</p>
          {pendLinks.map((l) => {
            const asked = l.initiated_by === l.patient_id;
            return (
              <div className="cg__pend-row" key={l.id}>
                <span className="cg__avatar" style={{ background: colorFor(l.patient_id) }}>
                  {monogramFor(l.patientName)}
                </span>
                <span className="cg__pend-body">
                  <span className="cg__pend-name">{l.patientName}</span>
                  <span className="cg__pend-sub">
                    {asked ? 'Asked you to join their care team' : 'Waiting for them to approve your offer'}
                  </span>
                </span>
                <span className="cg__pend-actions">
                  {asked ? (
                    <>
                      <button className="btn btn-primary cg__pend-btn" disabled={pendBusy === l.id}
                        onClick={() => void acceptAsk(l)}>Accept</button>
                      <button className="cg__pend-ghost" disabled={pendBusy === l.id}
                        onClick={() => void declineAsk(l)}>{confirmId === l.id ? 'Decline?' : 'Decline'}</button>
                    </>
                  ) : remindedRecently(l.reminded_at)
                    ? <span className="cg__pend-done">Reminded ✓</span>
                    : <button className="cg__pend-ghost" disabled={pendBusy === l.id}
                        onClick={() => void remindAsk(l)}>Remind ›</button>}
                </span>
              </div>
            );
          })}
          {pendInvites.map((i) => (
            <div className="cg__pend-row" key={i.id}>
              <span className="cg__avatar" style={{ background: colorFor(i.id) }}>
                {monogramFor(i.email ?? i.phone ?? '?')}
              </span>
              <span className="cg__pend-body">
                <span className="cg__pend-name">{i.email ?? i.phone}</span>
                <span className="cg__pend-sub">Invited to Lichen — becomes your client when they join and say yes</span>
              </span>
              <span className="cg__pend-actions">
                {i.email && (remindedRecently(i.reminded_at)
                  ? <span className="cg__pend-done">Emailed ✓</span>
                  : <button className="cg__pend-ghost" disabled={pendBusy === i.id}
                      onClick={() => void emailInvite(i)}>{i.reminded_at ? 'Remind ›' : 'Email ›'}</button>)}
                {i.phone && (
                  <button className="cg__pend-ghost" disabled={pendBusy === i.id}
                    onClick={() => void textInvite(i)}>Text ›</button>
                )}
                <button className="cg__pend-ghost" disabled={pendBusy === i.id}
                  onClick={() => void cancelInvite(i)}>{confirmId === i.id ? 'Cancel?' : 'Cancel'}</button>
              </span>
            </div>
          ))}
          {pendMsg && <p className="cg__pend-msg">{pendMsg}</p>}
        </div>
      )}

      {/* The add door is STANDING on the Client List tab (founder 2026-10-19:
          "if you look up someone who's not yet a client… you can send the
          request… in your provider dashboard") — the empty state already
          carries one, this covers a dashboard with clients on it. */}
      {!loading && allowed && tab === 'clients' && clients.length > 0 && (
        <div className="cg__addblock">
          <p className="cg__pend-h">Add a client</p>
          <CareAddBox role="patient" me={me} myName={myName} onAdded={() => void refreshRoster()}
            placeholder="A client’s name, email, or phone…" />
        </div>
      )}
    </div>
  );
}
