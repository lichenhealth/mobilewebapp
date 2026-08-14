import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import TimeField from '../components/TimeField';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { WEEKDAYS_SHORT, WEEKDAYS_FULL } from '../lib/recurrence';
import {
  AvailabilityKind, AvailabilityWindow, ShareRule, minToLabel,
  loadMyAvailability, addAvailability, deleteAvailability,
  loadMyShares, upsertShare, deleteShare,
  ExternalCalendar, listExternalCalendars, addExternalCalendar,
  removeExternalCalendar, syncExternalCalendars, deleteEveryoneShare,
  startGoogleConnect, disconnectGoogle, googleAccountId,
} from '../lib/calendarApi';
import { useSearchParams } from 'react-router-dom';
import CalImportGuide from '../components/CalImportGuide';
import ShareRulesEditor from '../components/ShareRulesEditor';
import TaskShareRules from '../components/TaskShareRules';
import { loadMyPhone } from '../lib/conciergeApi';
import {
  BookingType, listMyBookingTypes, saveBookingType, deleteBookingType,
} from '../lib/bookingApi';
import './Concierge.css';
import './Calendar.css';
import { useConfirm } from '../components/ConfirmDialog';

interface MemberOpt { id: string; full_name: string | null }

/** "3m ago" / "2h ago" / "just now" for the auto-update status line. */
function agoLabel(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.round(hrs / 24)}d ago`;
}

// Parked until Google verifies Lichen (founder, 2026-07-18): the OAuth flow
// works but unverified consent is three alarm screens + flaky generic errors.
// The secret-address route is the alpha path. Flip to true post-verification.
const SHOW_GOOGLE_CONNECT = false;


/** Calendar settings: declared weekly hours (availability / on-call) and
 *  audience visibility rules (most-specific wins). */
export default function CalendarSettings() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const confirmDialog = useConfirm();

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


  // Bookable sessions (the Calendly layer)
  const [bkTypes, setBkTypes] = useState<BookingType[]>([]);
  // The PUBLIC link (founder 2026-08-14, the Calendly replacement) hangs off
  // your vanity handle: lichen.health/book/<handle>.
  const [myHandle, setMyHandle] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // The provider's own spaces — the audience picker for space-scoped types.
  const [mySpaces, setMySpaces] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void supabase.from('space_members').select('spaces(id, name)').eq('profile_id', me)
      .then(({ data }) => {
        if (!live) return;
        setMySpaces(((data as unknown as { spaces: { id: string; name: string } | null }[] | null) ?? [])
          .map((r) => r.spaces).filter((x): x is { id: string; name: string } => !!x)
          .sort((a, b) => a.name.localeCompare(b.name)));
      });
    return () => { live = false; };
  }, [me]);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void supabase.from('profiles').select('handle').eq('id', me).maybeSingle()
      .then(({ data }) => { if (live) setMyHandle((data as { handle: string | null } | null)?.handle ?? null); });
    return () => { live = false; };
  }, [me]);
  const [bkOpen, setBkOpen] = useState(false);
  const [bkEdit, setBkEdit] = useState<Partial<BookingType>>({});

  // External calendars (secret iCal import)
  const [extCals, setExtCals] = useState<ExternalCalendar[]>([]);
  const [extName, setExtName] = useState('');
  const [extUrl, setExtUrl] = useState('');
  const [syncing, setSyncing] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [stepsSent, setStepsSent] = useState(false);

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
            Three kinds, because they're genuinely different hours.
            <strong> Work</strong> is when you'd take a booking — groups also use it
            (plus your events) to find meeting times.
            <strong> Social</strong> is when you'd welcome a chat; it's what shows your
            web that you&rsquo;re available, without you having to be in the app.
            <strong> On call</strong> powers your care team&rsquo;s urgent coverage.
            Anything booked takes you out of work and social hours automatically —
            people can still message you, they just know not to expect you.
          </p>
          {windows.map((w) => (
            <div className="cset__row" key={w.id}>
              <span className="cset__day">{WEEKDAYS_SHORT[w.weekday]}</span>
              <span className="cset__time">{minToLabel(w.start_min)} – {minToLabel(w.end_min)}</span>
              <span className={'cset__kind'
                + (w.kind === 'on_call' ? ' is-oncall' : '')
                + (w.kind === 'social' ? ' is-social' : '')}>
                {w.kind === 'on_call' ? 'On call' : w.kind === 'social' ? 'Social' : 'Work'}
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
              <option value="available">Work</option>
              <option value="social">Social</option>
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
                {bt.audience === 'mycelium' ? ' · mycelium' : bt.audience === 'public' ? ' · public link' : bt.audience === 'space' ? ` · ${mySpaces.find((sp) => sp.id === bt.audience_space_id)?.name ?? 'one group'}` : ''}
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

          {bkTypes.some((t) => t.audience === 'public' && t.active) && (
            <p className="cset__publink">
              {myHandle ? (
                <>
                  Your public booking link:{' '}
                  <code>lichen.health/book/{myHandle}</code>{' '}
                  <button
                    className="cedit__add cedit__add--sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`https://lichen.health/book/${myHandle}`);
                      setLinkCopied(true);
                      window.setTimeout(() => setLinkCopied(false), 2000);
                    }}
                  >
                    {linkCopied ? 'Copied ✓' : 'Copy'}
                  </button>
                  <br />Anyone with it — on Lichen or not — sees your live
                  availability and books straight in.
                </>
              ) : (
                <>
                  Your public link needs an address first —{' '}
                  <Link to="/profile#public-page">set yours in Profile → Public page</Link>{' '}
                  and it becomes <code>lichen.health/book/&lt;your-address&gt;</code>.
                </>
              )}
            </p>
          )}

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
                <option value="public">Anyone — even outside Lichen, via your link</option>
                <option value="everyone">Anyone on Lichen</option>
                <option value="mycelium">My-celium only</option>
                <option value="space">Members of one of your groups…</option>
              </select>
              {bkEdit.audience === 'space' && (
                <select className="cset__select" value={bkEdit.audience_space_id ?? ''}
                  onChange={(e) => setBkEdit((c) => ({ ...c, audience_space_id: e.target.value || null }))} aria-label="Which group">
                  <option value="">Pick the group…</option>
                  {mySpaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </select>
              )}
              <button
                className="cedit__add cedit__add--sm"
                disabled={!(bkEdit.title ?? '').trim() || (bkEdit.audience === 'space' && !bkEdit.audience_space_id)}
                onClick={() => act(async () => {
                  await saveBookingType(me, { ...bkEdit, title: (bkEdit.title ?? '').trim() } as Partial<BookingType> & { title: string });
                  setBkOpen(false); setBkEdit({});
                })}
              >
                <Icon name="plus" size={12} /> Save
              </button>
              {bkEdit.id && (
                <button className="cedit__add cedit__add--sm" onClick={() => {
                  void confirmDialog({ message: 'Delete this session type? Its booking history goes with it.', confirmLabel: 'Delete', danger: true }).then((ok) => {
                    if (ok) void act(async () => { await deleteBookingType(me, bkEdit.id!); setBkOpen(false); setBkEdit({}); });
                  });
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
            <summary>{extCals.length > 0 ? 'Adding another calendar? How to find its address' : 'How do I find my secret address?'}</summary>
            <div className="cset__howto-body">
              <p><strong>Google Calendar</strong> (use a computer — the secret address
                only appears on the web, not in Google&rsquo;s phone app):
                {' '}<a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noreferrer">open
                Google Calendar settings</a> and follow the pictures:</p>
              <CalImportGuide />
              <p>Then back here: paste it below &rarr; <em>Add</em>.</p>
              <p><strong>Apple / iCloud</strong> — easiest right on your iPhone:
                open the <em>Calendar app</em> &rarr; <em>Calendars</em> (bottom) &rarr; tap
                the <em>ⓘ</em> beside your iCloud calendar &rarr; turn on
                <em> Public Calendar</em> &rarr; <em>Share Link</em> &rarr; Copy, then paste
                it below (it starts with webcal:// — paste as-is). On a computer:{' '}
                <a href="https://www.icloud.com/calendar" target="_blank" rel="noreferrer">icloud.com/calendar</a>
                {' '}&rarr; share icon beside your calendar &rarr; <em>Public Calendar</em>.</p>
              <p><strong>Outlook</strong> (use a computer — publishing lives in the web
                version, not the phone app): at{' '}
                <a href="https://outlook.live.com/calendar/options/calendar/SharedCalendars" target="_blank" rel="noreferrer">outlook.com&rsquo;s
                shared-calendars settings</a> &rarr; publish your calendar (&ldquo;Can view all
                details&rdquo;) &rarr; copy the <em>ICS</em> link.</p>
              <p className="cset__howto-note">Treat the address like a password — anyone
                holding it can read your calendar. Lichen never shows it again after you
                add it, and each provider&rsquo;s settings can reset the link if it ever leaks.</p>
              <p className="cset__howto-note">
                <strong>On your phone?</strong> Google opens its app when you tap that link —
                and the app doesn&rsquo;t show the secret address (web only). Have the
                steps waiting in your inbox for the next time you&rsquo;re at a computer:
              </p>
              <button
                className="cedit__add"
                disabled={stepsSent}
                onClick={async () => {
                  try {
                    const { data, error: e } = await supabase.functions.invoke('send-cal-steps');
                    if (e || !data?.ok) throw new Error(e?.message || 'Could not send.');
                    setStepsSent(true);
                  } catch (err) { setError((err as Error).message); }
                }}
              >
                {stepsSent ? 'Sent — check your inbox' : 'Email me the steps'}
              </button>
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
            <div className="cset__extcal" key={c.id}>
              <div className="cset__row">
                <span className="cset__aud cset__extname">
                  {c.name}
                  {googleAccountId(c.url) && <em className="cset__gtag"> · Google</em>}
                </span>
                <span className="cset__extmeta">
                  {c.last_error
                    ? <em className="cset__exterr" title={c.last_error}>couldn&rsquo;t sync</em>
                    : c.last_synced_at
                      ? `auto-updates · checked ${agoLabel(c.last_synced_at)}`
                      : 'first sync happens when you open your calendar'}
                </span>
                <button
                  className="cedit__add cedit__add--sm"
                  title="Refresh now (it also refreshes itself whenever you open your calendar)"
                  aria-label="Refresh now"
                  disabled={syncing === c.id}
                  onClick={async () => {
                    setSyncing(c.id); setError('');
                    try { await syncExternalCalendars({ force: true, calendarId: c.id }); await load(); }
                    catch (e) { setError((e as { message?: string } | null)?.message || 'Refresh failed.'); }
                    setSyncing(null);
                  }}
                >
                  {syncing === c.id ? '…' : '↻'}
                </button>
                <button
                  className="cedit__remove"
                  onClick={() => act(async () => {
                    const gid = googleAccountId(c.url);
                    if (gid) await disconnectGoogle(gid);   // token + row + busy blocks
                    else await removeExternalCalendar(c.id);
                  })}
                  aria-label={`Remove ${c.name}`}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
              <details className="cset__calrules">
                <summary>Who sees my {c.name}{googleAccountId(c.url) ? ' (Google)' : ''} calendar</summary>
                <p className="cedit__hint">
                  Without rules of its own, this calendar follows your Lichen rules —
                  at most busy times, titles just for you. Add rules to grant chosen
                  people or groups more (Full details shows event titles) or less.
                </p>
                <ShareRulesEditor
                  me={me}
                  rules={rules.filter((r) => r.external_calendar_id === c.id)}
                  onChanged={load}
                  everyoneUnsetLabel="Follow my Lichen rules (busy at most)"
                  onUpsert={(aud, lvl) => upsertShare(me, aud, lvl, c.id)}
                  onDeleteRule={(id) => deleteShare(id)}
                  onUnsetEveryone={() => deleteEveryoneShare(me, c.id)}
                />
              </details>
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
        {/* ── My Lichen calendar — who sees it ── */}
        <div className="cedit__field">
          <span className="cedit__label">My Lichen calendar &mdash; who sees it</span>
          <p className="cedit__hint">
            The most specific rule wins: a rule for a person beats their group's rule, which beats
            the everyone rule. "Busy times only" hides what and where — people just see you're taken.
          </p>
          <ShareRulesEditor
            me={me}
            rules={rules.filter((r) => !r.external_calendar_id)}
            onChanged={load}
            onUpsert={(aud, lvl) => upsertShare(me, aud, lvl, null)}
            onDeleteRule={(id) => deleteShare(id)}
          />
        </div>

        {/* ── Tasks — who sees them (founder 2026-08-14) ── */}
        <div className="cedit__field">
          <span className="cedit__label">My tasks &mdash; who sees them</span>
          <p className="cedit__hint">
            Your to-dos and reminders are <strong>hidden by default</strong> —
            a task list is undone work, and it stays yours until you open it.
            The most specific rule wins, and a rule set to Hidden excludes
            that person or group even when a broader rule says yes. People
            you admit see your list read-only, from the To&nbsp;Do view.
          </p>
          <TaskShareRules me={me} />
        </div>

      </div>
    </div>
  );
}
