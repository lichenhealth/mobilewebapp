import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import TimeField from '../components/TimeField';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { WEEKDAYS_SHORT, WEEKDAYS_FULL } from '../lib/recurrence';
import {
  AvailabilityKind, AvailabilityWindow, ShareLevel, ShareRule, minToLabel,
  loadMyAvailability, addAvailability, deleteAvailability,
  loadMyShares, upsertShare, deleteShare,
  ExternalCalendar, listExternalCalendars, addExternalCalendar,
  removeExternalCalendar, syncExternalCalendars,
  startGoogleConnect, disconnectGoogle, googleAccountId,
} from '../lib/calendarApi';
import { useSearchParams } from 'react-router-dom';
import { loadMyPhone } from '../lib/conciergeApi';
import {
  BookingType, listMyBookingTypes, saveBookingType, deleteBookingType,
} from '../lib/bookingApi';
import './Concierge.css';
import './Calendar.css';

interface MemberOpt { id: string; full_name: string | null }

// Parked until Google verifies Lichen (founder, 2026-07-18): the OAuth flow
// works but unverified consent is three alarm screens + flaky generic errors.
// The secret-address route is the alpha path. Flip to true post-verification.
const SHOW_GOOGLE_CONNECT = false;

const LEVEL_LABELS: Record<ShareLevel, string> = {
  hidden: 'Nothing', busy: 'Busy times only', details: 'Full details',
};

/** Calendar settings: declared weekly hours (availability / on-call) and
 *  audience visibility rules (most-specific wins). */
export default function CalendarSettings() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [rules, setRules] = useState<ShareRule[]>([]);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [myPhone, setMyPhone] = useState<string | null>(null);
  const [error, setError] = useState('');

  // add-hours form
  const [wDay, setWDay] = useState(0);
  const [wStart, setWStart] = useState(9 * 60);
  const [wEnd, setWEnd] = useState(17 * 60);
  const [wKind, setWKind] = useState<AvailabilityKind>('available');

  // add-rule form: one smart search across members AND spaces (groups,
  // communities, organizations, places) — no audience-type dropdown.
  interface RulePick { type: 'profile' | 'space'; id: string; name: string; label: string }
  const [rQuery, setRQuery] = useState('');
  const [rPick, setRPick] = useState<RulePick | null>(null);
  const [rResults, setRResults] = useState<RulePick[]>([]);
  const [rLevel, setRLevel] = useState<ShareLevel>('details');

  // Bookable sessions (the Calendly layer)
  const [bkTypes, setBkTypes] = useState<BookingType[]>([]);
  const [bkOpen, setBkOpen] = useState(false);
  const [bkEdit, setBkEdit] = useState<Partial<BookingType>>({});

  // External calendars (secret iCal import)
  const [extCals, setExtCals] = useState<ExternalCalendar[]>([]);
  const [extName, setExtName] = useState('');
  const [extUrl, setExtUrl] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Back from Google's consent screen: sync the fresh connection, tidy the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const googleStatus = searchParams.get('google');
  useEffect(() => {
    if (!googleStatus || !me) return;
    if (googleStatus === 'connected') {
      void syncExternalCalendars({ force: true }).catch(() => {}).then(() => load());
    } else {
      setError(googleStatus === 'denied'
        ? 'Google connection was cancelled.'
        : 'Google connection didn’t complete — try again.');
    }
    searchParams.delete('google');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googleStatus, me]);

  const load = useCallback(async () => {
    if (!me) return;
    const [w, r, memRes, phone, ext, bk] = await Promise.all([
      loadMyAvailability(me),
      loadMyShares(me),
      supabase.from('profiles').select('id, full_name').neq('id', me).order('full_name').limit(500),
      loadMyPhone(),
      listExternalCalendars(me),
      listMyBookingTypes(me),
    ]);
    setWindows(w); setRules(r);
    setMembers((memRes.data as MemberOpt[] | null) ?? []);
    setMyPhone(phone);
    setExtCals(ext);
    setBkTypes(bk);
  }, [me]);
  useEffect(() => { load(); }, [load]);

  const everyoneLevel: ShareLevel =
    (rules.find((r) => r.audience_type === 'everyone')?.level) ?? 'busy';
  const specificRules = rules.filter((r) => r.audience_type !== 'everyone');

  // Smart audience search: members client-side + all spaces by name, labeled
  // by what they are (Member / Group / Community / Organization / Place).
  useEffect(() => {
    const q = rQuery.trim();
    if (q.length < 2 || rPick) { setRResults([]); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.from('spaces').select('id, name, kind').ilike('name', `%${q}%`).limit(5);
      if (!live) return;
      const spaceHits = ((data as { id: string; name: string; kind: string }[] | null) ?? [])
        .map((s) => ({
          type: 'space' as const, id: s.id, name: s.name,
          label: s.kind === 'community' ? 'Community' : s.kind === 'organization' ? 'Organization' : s.kind === 'place' ? 'Place' : 'Group',
        }));
      const memberHits = members
        .filter((m) => (m.full_name ?? '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 5)
        .map((m) => ({ type: 'profile' as const, id: m.id, name: m.full_name || 'Member', label: 'Member' }));
      setRResults([...memberHits, ...spaceHits]);
    })();
    return () => { live = false; };
  }, [rQuery, rPick, members]);

  const act = async (fn: () => Promise<void>) => {
    if (!me) return; // session still resolving — never write with an empty id
    setError('');
    try { await fn(); await load(); }
    catch (e) { setError((e as { message?: string } | null)?.message || 'Something went wrong.'); }
  };

  // Don't render interactive controls until the session (and data) are ready —
  // acting before `me` resolves produced uuid "" errors.
  if (!me) {
    return (
      <div className="cedit">
        <header className="cedit__head">
          <button className="conc__back" onClick={() => navigate('/calendar')} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
          <h1 className="cedit__title">Calendar settings</h1>
          <span />
        </header>
        <p className="cedit__hint" style={{ padding: 'var(--s-4)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={() => navigate('/calendar')} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <h1 className="cedit__title">Calendar settings</h1>
        <span />
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__body">
        {/* ── My hours ── */}
        <div className="cedit__field">
          <span className="cedit__label">My hours</span>
          <p className="cedit__hint">
            Times you're generally available. Groups use this (plus your events) to find meeting
            times; on-call windows power your care team's urgent coverage.
          </p>
          {windows.map((w) => (
            <div className="cset__row" key={w.id}>
              <span className="cset__day">{WEEKDAYS_SHORT[w.weekday]}</span>
              <span className="cset__time">{minToLabel(w.start_min)} – {minToLabel(w.end_min)}</span>
              <span className={'cset__kind' + (w.kind === 'on_call' ? ' is-oncall' : '')}>
                {w.kind === 'on_call' ? 'On call' : 'Available'}
              </span>
              <button className="cedit__remove" onClick={() => act(() => deleteAvailability(w.id))} aria-label="Remove"><Icon name="close" size={13} /></button>
            </div>
          ))}
          <div className="cset__add">
            <select className="cset__select" value={wDay} onChange={(e) => setWDay(Number(e.target.value))} aria-label="Weekday">
              {WEEKDAYS_FULL.map((d, i) => <option key={i} value={i}>{d}</option>)}
            </select>
            <TimeField value={wStart} onChange={(m) => { setWStart(m); if (wEnd <= m) setWEnd(Math.min(m + 60, 1440)); }} ariaLabel="From" />
            <span className="rec__lbl">to</span>
            <TimeField value={wEnd} onChange={setWEnd} min={wStart} ariaLabel="Until" />
            <select className="cset__select" value={wKind} onChange={(e) => setWKind(e.target.value as AvailabilityKind)} aria-label="Kind">
              <option value="available">Available</option>
              <option value="on_call">On call</option>
            </select>
            <button
              className="cedit__add cedit__add--sm"
              onClick={() => act(() => addAvailability(me, { weekday: wDay, startMin: wStart, endMin: wEnd, kind: wKind }))}
            >
              <Icon name="plus" size={12} /> Add
            </button>
          </div>
          {myPhone !== null && !myPhone && windows.some((w) => w.kind === 'on_call') && (
            <p className="cedit__hint">
              You have on-call hours but no phone number — add one in your{' '}
              <Link to="/profile">Profile</Link> so clients can call you when you&rsquo;re on call.
            </p>
          )}
        </div>

        {/* ── Who sees my calendar ── */}
        <div className="cedit__field">
          <span className="cedit__label">Who sees my calendar</span>
          <p className="cedit__hint">
            The most specific rule wins: a rule for a person beats their group's rule, which beats
            the everyone rule. "Busy times only" hides what and where — people just see you're taken.
          </p>

          <div className="cset__row">
            <span className="cset__aud">Everyone</span>
            <select
              className="cset__select cset__select--grow" value={everyoneLevel}
              onChange={(e) => act(() => upsertShare(me, { type: 'everyone' }, e.target.value as ShareLevel))}
              aria-label="Everyone sees"
            >
              {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
          </div>

          {specificRules.map((r) => (
            <div className="cset__row" key={r.id}>
              <span className="cset__aud">
                {r.audience_type === 'space'
                  ? (r.space?.name ?? 'A space')
                  : (r.profile?.full_name || 'A member')}
              </span>
              <select
                className="cset__select cset__select--grow" value={r.level}
                onChange={(e) => act(() =>
                  upsertShare(
                    me,
                    r.audience_type === 'space'
                      ? { type: 'space', spaceId: r.audience_space_id! }
                      : { type: 'profile', profileId: r.audience_profile_id! },
                    e.target.value as ShareLevel,
                  ))}
                aria-label="Sees"
              >
                {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
              </select>
              <button className="cedit__remove" onClick={() => act(() => deleteShare(r.id))} aria-label="Remove"><Icon name="close" size={13} /></button>
            </div>
          ))}

          <div className="cset__add cset__add--wrap">
            {rPick ? (
              <button className="calp__invitee" onClick={() => { setRPick(null); setRQuery(''); }}>
                {rPick.name} <span className="cset__kind">{rPick.label}</span> ×
              </button>
            ) : (
              <input
                className="cedit__input cset__grow"
                placeholder="Search Members, Groups/Communities, Organizations and/or Places…"
                value={rQuery} onChange={(e) => setRQuery(e.target.value)}
              />
            )}
            <select className="cset__select" value={rLevel} onChange={(e) => setRLevel(e.target.value as ShareLevel)} aria-label="Level">
              {(Object.keys(LEVEL_LABELS) as ShareLevel[]).map((l) => <option key={l} value={l}>{LEVEL_LABELS[l]}</option>)}
            </select>
            <button
              className="cedit__add cedit__add--sm"
              onClick={() => act(async () => {
                if (!rPick) return;
                await upsertShare(
                  me,
                  rPick.type === 'space' ? { type: 'space', spaceId: rPick.id } : { type: 'profile', profileId: rPick.id },
                  rLevel,
                );
                setRPick(null); setRQuery('');
              })}
            >
              <Icon name="plus" size={12} /> Add rule
            </button>
          </div>
          {rResults.map((r) => (
            <button className="calp__match" key={r.type + r.id} onClick={() => { setRPick(r); setRQuery(''); }}>
              {r.name} <span className="cset__kind">{r.label}</span>
            </button>
          ))}
        </div>

        {/* ── Bookable sessions (the Calendly layer) ── */}
        <div className="cedit__field">
          <span className="cedit__label">Bookable sessions</span>
          <p className="cedit__hint">
            Offer sessions members can book from your profile. Open times come
            from your hours above minus everything on your calendar (imported
            calendars included). Price is just words — payment happens however
            you and your people already do it.
          </p>

          {bkTypes.map((bt) => (
            <div className={'cset__row' + (bt.active ? '' : ' cset__bkoff')} key={bt.id}>
              <span className="cset__aud cset__extname">{bt.title}</span>
              <span className="cset__bkrow-sub">
                {bt.duration_min}m{bt.price ? ` · ${bt.price}` : ''} · {bt.approval === 'instant' ? 'instant' : 'by request'}
                {bt.audience === 'mycelium' ? ' · mycelium' : ''}
              </span>
              <button className="cedit__add cedit__add--sm" onClick={() => { setBkEdit(bt); setBkOpen(true); }}>Edit</button>
              <button
                className="cedit__remove"
                aria-label={bt.active ? 'Pause' : 'Resume'}
                title={bt.active ? 'Pause bookings' : 'Resume bookings'}
                onClick={() => act(() => saveBookingType(me, { ...bt, active: !bt.active }))}
              >
                <Icon name={bt.active ? 'close' : 'plus'} size={13} />
              </button>
            </div>
          ))}

          {!bkOpen ? (
            <button className="cedit__add cedit__add--sm" onClick={() => { setBkEdit({ duration_min: 60, approval: 'request', audience: 'everyone', active: true }); setBkOpen(true); }}>
              <Icon name="plus" size={12} /> New session type
            </button>
          ) : (
            <div className="cset__add cset__add--wrap">
              <input
                className="cedit__input cset__grow"
                placeholder="Session name (e.g. Reiki, 1:1 coaching)"
                value={bkEdit.title ?? ''}
                onChange={(e) => setBkEdit((c) => ({ ...c, title: e.target.value }))}
              />
              <select className="cset__select" value={bkEdit.duration_min ?? 60}
                onChange={(e) => setBkEdit((c) => ({ ...c, duration_min: Number(e.target.value) }))} aria-label="Length">
                {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
              <input
                className="cedit__input cset__extfield"
                placeholder="Price (e.g. $90, Free)"
                value={bkEdit.price ?? ''}
                onChange={(e) => setBkEdit((c) => ({ ...c, price: e.target.value }))}
              />
              <input
                className="cedit__input cset__grow"
                placeholder="Where (e.g. Online — Zoom, or an address)"
                value={bkEdit.location ?? ''}
                onChange={(e) => setBkEdit((c) => ({ ...c, location: e.target.value }))}
              />
              <select className="cset__select" value={bkEdit.approval ?? 'request'}
                onChange={(e) => setBkEdit((c) => ({ ...c, approval: e.target.value as BookingType['approval'] }))} aria-label="Approval">
                <option value="request">I approve each request</option>
                <option value="instant">Book instantly</option>
              </select>
              <select className="cset__select" value={bkEdit.audience ?? 'everyone'}
                onChange={(e) => setBkEdit((c) => ({ ...c, audience: e.target.value as BookingType['audience'] }))} aria-label="Who can book">
                <option value="everyone">Anyone on Lichen</option>
                <option value="mycelium">My mycelium only</option>
              </select>
              <button
                className="cedit__add cedit__add--sm"
                disabled={!(bkEdit.title ?? '').trim()}
                onClick={() => act(async () => {
                  await saveBookingType(me, { ...bkEdit, title: (bkEdit.title ?? '').trim() } as Partial<BookingType> & { title: string });
                  setBkOpen(false); setBkEdit({});
                })}
              >
                <Icon name="plus" size={12} /> Save
              </button>
              {bkEdit.id && (
                <button className="cedit__add cedit__add--sm" onClick={() => {
                  if (window.confirm('Delete this session type? Its booking history goes with it.')) {
                    void act(async () => { await deleteBookingType(me, bkEdit.id!); setBkOpen(false); setBkEdit({}); });
                  }
                }}>Delete</button>
              )}
              <button className="cedit__remove" aria-label="Close" onClick={() => { setBkOpen(false); setBkEdit({}); }}>
                <Icon name="close" size={13} />
              </button>
            </div>
          )}
        </div>

        {/* ── Other calendars (secret iCal import) ── */}
        <div className="cedit__field">
          <span className="cedit__label">Other calendars</span>
          <p className="cedit__hint">
            Bring your Google, Apple, or Outlook calendar into Lichen: paste its
            <strong> secret iCal address</strong> and your busy times flow into
            find-a-time and booking — other members only ever see &ldquo;busy,&rdquo;
            never your event details.
          </p>
          <details className="cset__howto">
            <summary>How do I find my secret address?</summary>
            <div className="cset__howto-body">
              <p><strong>Google Calendar</strong> (use a browser — it&rsquo;s not in the phone app):
                {' '}<a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">open
                Google Calendar settings</a> &rarr; click your calendar&rsquo;s name in the left
                list &rarr; scroll to <em>Integrate calendar</em> &rarr; copy the
                <em> Secret address in iCal format</em>.</p>
              <p><strong>Apple / iCloud</strong>: at icloud.com open Calendar &rarr; tap the
                share icon beside your calendar &rarr; turn on <em>Public Calendar</em> &rarr;
                copy the link (it starts with webcal:// — paste it as-is).</p>
              <p><strong>Outlook</strong>: at outlook.com &rarr; gear &rarr; <em>Calendar</em> &rarr;
                <em>Shared calendars</em> &rarr; publish your calendar (&ldquo;Can view all
                details&rdquo;) &rarr; copy the <em>ICS</em> link.</p>
              <p className="cset__howto-note">Treat the address like a password — anyone
                holding it can read your calendar. Lichen never shows it again after you
                add it, and each provider&rsquo;s settings can reset the link if it ever leaks.</p>
            </div>
          </details>

          {/* One-tap Google OAuth: BUILT AND DEPLOYED but parked for alpha
              (founder decision 2026-07-18) — until Google verifies Lichen,
              their consent flow shows three alarm screens and fails with
              generic errors for some accounts (Workspace policies, embedded
              browsers). The secret-address route below is deterministic.
              Flip SHOW_GOOGLE_CONNECT when verification clears. */}
          {SHOW_GOOGLE_CONNECT && (
            <>
              <button
                className="cedit__add cset__gconnect"
                disabled={connecting}
                onClick={async () => {
                  setConnecting(true); setError('');
                  try { await startGoogleConnect(); }
                  catch (e) { setError((e as Error).message); setConnecting(false); }
                }}
              >
                {connecting ? 'Opening Google…' : 'Connect Google Calendar — one tap'}
              </button>
              <p className="cedit__hint cset__gconnect-hint">
                Heads up: until Google finishes verifying Lichen, their consent
                screens shout &ldquo;unverified app&rdquo; — that&rsquo;s expected.
                Tap <em>Advanced&nbsp;&rarr;&nbsp;Continue</em> and carry on; Lichen
                only ever reads busy times, and other members never see your event
                details. Or paste any calendar&rsquo;s secret iCal address below
                (Apple, Outlook, and Google alike).
              </p>
            </>
          )}

          {extCals.map((c) => (
            <div className="cset__row" key={c.id}>
              <span className="cset__aud cset__extname">
                {c.name}
                {googleAccountId(c.url) && <em className="cset__gtag"> · Google</em>}
              </span>
              <span className="cset__extmeta">
                {c.last_error
                  ? <em className="cset__exterr" title={c.last_error}>couldn&rsquo;t sync</em>
                  : c.last_synced_at
                    ? `${c.event_count} busy ${c.event_count === 1 ? 'block' : 'blocks'}`
                    : 'not synced yet'}
              </span>
              <button
                className="cedit__add cedit__add--sm"
                disabled={syncing === c.id}
                onClick={async () => {
                  setSyncing(c.id); setError('');
                  try { await syncExternalCalendars({ force: true, calendarId: c.id }); await load(); }
                  catch (e) { setError((e as { message?: string } | null)?.message || 'Sync failed.'); }
                  setSyncing(null);
                }}
              >
                {syncing === c.id ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                className="cedit__remove"
                onClick={() => act(async () => {
                  const gid = googleAccountId(c.url);
                  if (gid) await disconnectGoogle(gid);   // token + row + busy blocks
                  else await removeExternalCalendar(c.id);
                })}
                aria-label="Remove calendar"
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          ))}

          <div className="cset__add cset__add--wrap">
            <input
              className="cedit__input cset__extfield"
              placeholder="Name (e.g. Work Google Cal)"
              value={extName} onChange={(e) => setExtName(e.target.value)}
            />
            <input
              className="cedit__input cset__grow"
              placeholder="Paste the secret iCal address (https://… or webcal://…)"
              value={extUrl} onChange={(e) => setExtUrl(e.target.value)}
            />
            <button
              className="cedit__add cedit__add--sm"
              disabled={!/^(https?|webcal):\/\/.+/i.test(extUrl.trim())}
              onClick={() => act(async () => {
                await addExternalCalendar(me, extName, extUrl);
                setExtName(''); setExtUrl('');
                try { await syncExternalCalendars({ force: true }); } catch { /* surfaced per-row */ }
              })}
            >
              <Icon name="plus" size={12} /> Add calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
