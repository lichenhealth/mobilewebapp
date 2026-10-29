import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import TimeField from '../components/TimeField';
import FitSelect from '../components/FitSelect';
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
import AssistantDoor from '../components/AssistantDoor';
import ShareRulesEditor from '../components/ShareRulesEditor';
import TaskShareRules from '../components/TaskShareRules';
import { loadMyPhone } from '../lib/conciergeApi';
import { videoServiceOf } from '../lib/linkify';
import {
  BookingType, listMyBookingTypes, saveBookingType, deleteBookingType, slugify,
  TypeHourRow, TypeCondition, listTypeHours, saveTypeHours,
  listTypeConditions, saveTypeConditions, searchConditionTargets,
  listMyMeetingLinks, saveMeetingLink, normalizeMeetingUrl,
  MeetingSetting, zoomMintAllowed, usdLabel,
} from '../lib/bookingApi';
import { numericAmount } from '../lib/ledgerApi';
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

/** A scheduling-rule dropdown with a Google-cal-style "Custom…" tail
 *  (founder 2026-10-29: "let's have custom options as the bottom drop down
 *  for each one, which allows you to make custom rules, kinda like google
 *  cal"). Presets list as before; Custom… opens a small numeric input in the
 *  field's own unit; an off-list value (typed here, or set by the assistant)
 *  renders as its own labeled option instead of blanking the select.
 *  Module-level on purpose — defined inside the page it would remount and
 *  drop the input's focus every parent render (the EText lesson). */
function RuleSelect(props: {
  value: number | null;
  options: { v: number | null; label: string }[];
  offLabel: (v: number) => string;
  unit: string;
  /** input × scale = stored (notice stores minutes, asks in hours). */
  scale?: number;
  min: number; max: number;
  decimals?: boolean;
  aria: string;
  onChange: (v: number | null) => void;
}) {
  const [custom, setCustom] = useState(false);
  const scale = props.scale ?? 1;
  const listed = props.options.some((o) => o.v === props.value);
  return (
    <span className="cset__rulewrap">
      <FitSelect
        className="cset__select"
        aria-label={props.aria}
        value={custom ? 'custom' : listed ? String(props.value) : 'off:' + String(props.value)}
        onChange={(e) => {
          if (e.target.value === 'custom') { setCustom(true); return; }
          setCustom(false);
          const raw = e.target.value.startsWith('off:') ? e.target.value.slice(4) : e.target.value;
          props.onChange(raw === 'null' ? null : Number(raw));
        }}
      >
        {props.options.map((o, i) => <option key={i} value={String(o.v)}>{o.label}</option>)}
        {!listed && props.value != null && (
          <option value={'off:' + String(props.value)}>{props.offLabel(props.value)}</option>
        )}
        <option value="custom">Custom…</option>
      </FitSelect>
      {custom && (
        <>
          <input
            className="cedit__input cset__ruleinput"
            inputMode={props.decimals ? 'decimal' : 'numeric'}
            placeholder={props.unit}
            autoFocus
            defaultValue={props.value != null ? String(props.value / scale) : ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= props.min && n <= props.max) {
                props.onChange(Math.round(n * scale));
              }
            }}
            onBlur={() => setCustom(false)}
          />
          <span className="cset__ruleunit">{props.unit}</span>
        </>
      )}
    </span>
  );
}

export default function CalendarSettings() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const confirmDialog = useConfirm();

  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  // ON CALL IS A JOB, NOT A LIFESTYLE (founder 2026-08-19: it belongs to
  // being on someone's care team — a first-responder-shaped duty — and
  // shouldn't surface for everyone). The kind is offered only to active
  // caregivers; existing on-call rows always render (data is never hidden).
  const [isCaregiver, setIsCaregiver] = useState(false);
  useEffect(() => {
    if (!me) return;
    let live = true;
    void supabase.from('care_team_members')
      .select('id', { count: 'exact', head: true })
      .eq('caregiver_id', me).eq('status', 'active')
      .then(({ count }) => { if (live) setIsCaregiver((count ?? 0) > 0); });
    return () => { live = false; };
  }, [me]);
  const [rules, setRules] = useState<ShareRule[]>([]);
  const [members, setMembers] = useState<MemberOpt[]>([]);
  const [myPhone, setMyPhone] = useState<string | null>(null);
  const [error, setError] = useState('');

  // add-hours form
  // wDay is a single weekday index (0=Mon … 6=Sun) OR a batch key — most
  // people work a typical work week (founder 2026-10-19), so one Add can lay
  // down the whole set. Storage stays one row per day either way.
  const [wDay, setWDay] = useState<string>('weekdays');
  const [wStart, setWStart] = useState(9 * 60);
  const [wEnd, setWEnd] = useState(17 * 60);
  const [wKind, setWKind] = useState<AvailabilityKind>('available');


  // Bookable sessions (the Calendly layer)
  const [bkTypes, setBkTypes] = useState<BookingType[]>([]);
  // Video links live in their own owner-only table (never on the type row,
  // which others can read) — kept beside the form, not inside bkEdit, so
  // saveBookingType never tries to write a column booking_types doesn't have.
  const [bkLinks, setBkLinks] = useState<Record<string, MeetingSetting>>({});
  const [bkLink, setBkLink] = useState('');
  // Unique Zoom meeting per booking (founder 2026-10-07): minted on
  // Lichen's own Zoom at confirm. Offered only to providers on the
  // platform_settings.zoom_providers list — one Zoom host, one live
  // meeting at a time.
  const [bkZoom, setBkZoom] = useState(false);
  const [zoomOk, setZoomOk] = useState(false);
  // The PUBLIC link (founder 2026-08-14, the Calendly replacement) hangs off
  // your vanity handle: lichen.health/book/<handle>.
  const [myHandle, setMyHandle] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Which type's vanity link was just copied (founder 2026-10-03).
  const [copiedType, setCopiedType] = useState('');
  // A type's OWN hours + its place/people rules (founder 2026-10-03:
  // "an event itself can have hour rules… place rules, people rules").
  const [bkHours, setBkHours] = useState<TypeHourRow[]>([]);
  const [bkConds, setBkConds] = useState<TypeCondition[]>([]);
  const [condQ, setCondQ] = useState('');
  const [condHits, setCondHits] = useState<TypeCondition[]>([]);
  // Batch day options for a type's OWN hours too (founder 2026-10-29:
  // "Let's have the Monday - Friday and other options on the standard cal
  // apply here, too, so you don't have to do the laborious day by day") —
  // one Add writes one row per covered day, the main composer's shape.
  const [chDay, setChDay] = useState<string>('weekdays');
  const [chStart, setChStart] = useState(540);
  const [chEnd, setChEnd] = useState(1020);
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
    setBkLinks(await listMyMeetingLinks(bk.map((t) => t.id)));
    setZoomOk(await zoomMintAllowed(me));
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
        <header className="cedit__head cedit__head--noback">
                    <h1 className="cedit__title">Calendar settings</h1>
          <span />
        </header>
        <p className="cedit__hint" style={{ padding: 'var(--s-4)' }}>Loading…</p>
      </div>
    );
  }

  return (
    <div className="cedit">
      <header className="cedit__head cedit__head--noback">
                <h1 className="cedit__title">Calendar settings</h1>
        {/* The brain lives HERE too (founder 2026-10-03: "tell the Ai
            assistant your work and social hours and it can manage your
            cal for you, like a human secretary") — the calendar thread's
            tools already set hours and build session types by voice. */}
        <AssistantDoor section="calendar" label="Tell your assistant your hours — it manages your calendar" />
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__body">
        {/* ── My hours ── */}
        <div className="cedit__field">
          <span className="cedit__label">My hours</span>
          <p className="cedit__hint">
            {isCaregiver ? 'Three kinds' : 'Two kinds'}, because they're genuinely different hours.
            <strong> Work</strong> is when you'd take a booking — groups also use it
            (plus your events) to find meeting times.
            <strong> Social</strong> is when you'd welcome a chat; it's what shows your
            web that you&rsquo;re available, without you having to be in the app.
            {isCaregiver && <>
              <strong> On call</strong> powers your care team&rsquo;s urgent coverage.
            </>}
            {' '}Anything booked takes you out of work and social hours automatically —
            people can still message you, they just know not to expect you.
            {' '}Or just tell your assistant (the brain above) &ldquo;work 9&ndash;5 weekdays,
            social Sunday afternoons&rdquo; — it sets all of this for you.
          </p>
          {windows.map((w) => (
            <div className="cset__row" key={w.id}>
              <span className={'cset__kind'
                + (w.kind === 'on_call' ? ' is-oncall' : '')
                + (w.kind === 'social' ? ' is-social' : '')}>
                {w.kind === 'on_call' ? 'On call' : w.kind === 'social' ? 'Social' : 'Work'}
              </span>
              <span className="cset__day">{WEEKDAYS_SHORT[w.weekday]}</span>
              <span className="cset__time">{minToLabel(w.start_min)} – {minToLabel(w.end_min)}</span>
              <button className="cedit__remove" onClick={() => act(() => deleteAvailability(w.id))} aria-label="Remove"><Icon name="close" size={13} /></button>
            </div>
          ))}
          <div className="cset__add">
            {/* The KIND leads (founder 2026-08-19): what these hours ARE, then
                when. On call is offered only to active caregivers — a duty of
                a role, not a general setting; rows someone already has always
                render, and the option returns while any exist so they can be
                understood and removed. */}
            <FitSelect className="cset__select" value={wKind} onChange={(e) => setWKind(e.target.value as AvailabilityKind)} aria-label="Kind">
              <option value="available">Work</option>
              <option value="social">Social</option>
              {(isCaregiver || wKind === 'on_call' || windows.some((w) => w.kind === 'on_call')) && <option value="on_call">On call</option>}
            </FitSelect>
            <FitSelect className="cset__select" value={wDay} onChange={(e) => setWDay(e.target.value)} aria-label="Weekday">
              <option value="weekdays">Monday – Friday</option>
              <option value="weekend">Saturday &amp; Sunday</option>
              <option value="everyday">Every day</option>
              {WEEKDAYS_FULL.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
            </FitSelect>
            <TimeField value={wStart} onChange={(m) => { setWStart(m); if (wEnd <= m) setWEnd(Math.min(m + 60, 1440)); }} ariaLabel="From" />
            <span className="rec__lbl">to</span>
            <TimeField value={wEnd} onChange={setWEnd} min={wStart} ariaLabel="Until" />
            <button
              className="cedit__add cedit__add--sm"
              onClick={() => act(() => addAvailability(me, {
                weekday: wDay === 'weekdays' ? [0, 1, 2, 3, 4]
                  : wDay === 'weekend' ? [5, 6]
                  : wDay === 'everyday' ? [0, 1, 2, 3, 4, 5, 6]
                  : Number(wDay),
                startMin: wStart, endMin: wEnd, kind: wKind,
              }))}
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

          {/* THE SESSION CARD (founder 2026-10-07: "Make the UI for these
              different meeting types more readable — audit calendly and
              other similar software"): the Calendly/Cal.com event-type
              anatomy on Lichen's paper — the TITLE owns its own line and
              never truncates (the screenshot showed "Care T…"), the facts
              breathe on a fine line below, and the sendable link (or the
              honest needs-an-address note) gets the full width. */}
          {bkTypes.map((bt) => (
            <div className={'cset__bkcard' + (bt.active ? '' : ' cset__bkoff')} key={bt.id}>
              <div className="cset__bkhead">
                <span className="cset__bktitle">{bt.title}</span>
                {!bt.active && <em className="cset__bkpaused">Paused</em>}
                <span className="cset__bkbtns">
                  <button className="cedit__add cedit__add--sm" onClick={() => {
                    setBkEdit(bt); setBkOpen(true);
                    setBkLink(bkLinks[bt.id]?.url ?? '');
                    setBkZoom(bkLinks[bt.id]?.zoom_unique ?? false);
                    setBkHours([]); setBkConds([]); setCondQ(''); setCondHits([]);
                    void listTypeHours(bt.id).then(setBkHours);
                    void listTypeConditions(bt.id).then(setBkConds);
                  }}>Edit</button>
                  <button
                    className="cedit__remove"
                    aria-label={bt.active ? 'Pause' : 'Resume'}
                    title={bt.active ? 'Pause bookings' : 'Resume bookings'}
                    onClick={() => act(async () => { await saveBookingType(me, { ...bt, active: !bt.active }); })}
                  >
                    <Icon name={bt.active ? 'close' : 'plus'} size={13} />
                  </button>
                </span>
              </div>
              <p className="cset__bkmeta">
                {bt.duration_min} min{bt.slot_increment_min != null && bt.slot_increment_min !== bt.duration_min ? ` · starts every ${bt.slot_increment_min} min` : ''}{bt.price ? ` · ${bt.price}` : ''}{bt.price_cents != null ? ` · collects ${usdLabel(bt.price_cents)} online` : ''} · {bt.approval === 'instant' ? 'books instantly' : 'by request'}
                {bt.audience === 'mycelium' ? ' · my-celium only' : bt.audience === 'public' ? ' · public link' : bt.audience === 'space' ? ` · ${mySpaces.find((sp) => sp.id === bt.audience_space_id)?.name ?? 'one group'}` : ' · anyone on Lichen'}
                {bkLinks[bt.id]?.zoom_unique ? ' · unique Zoom per booking'
                  : bkLinks[bt.id]?.url ? ` · ${videoServiceOf(bkLinks[bt.id].url!) ?? 'video'} link` : ''}
              </p>
              {/* The vanity link (founder 2026-10-03, the Calendly shape):
                  this session's own sendable address. */}
              {bt.slug && myHandle && (
                <span className="cset__bkrow-vanity">
                  <code>lichen.health/book/{myHandle}/{bt.slug}</code>
                  <button
                    className="cedit__add cedit__add--sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`https://lichen.health/book/${myHandle}/${bt.slug}`);
                      setCopiedType(bt.id);
                      window.setTimeout(() => setCopiedType(''), 2000);
                    }}
                  >
                    {copiedType === bt.id ? 'Copied ✓' : 'Copy'}
                  </button>
                </span>
              )}
              {bt.slug && !myHandle && (
                <span className="cset__bkrow-vanity cset__bkrow-vanity--muted">
                  Its direct link needs an address first — set yours in Profile → Public page, or just ask the brain here to set your handle.
                </span>
              )}
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
            <button className="cedit__add cedit__add--sm" onClick={() => {
              setBkEdit({ duration_min: 60, approval: 'request', audience: 'everyone', active: true });
              setBkLink(''); setBkZoom(false);
              setBkHours([]); setBkConds([]); setCondQ(''); setCondHits([]);
              setBkOpen(true);
            }}>
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
              <RuleSelect
                value={bkEdit.duration_min ?? 60}
                options={[30, 45, 60, 90, 120].map((m) => ({ v: m, label: `${m} min` }))}
                offLabel={(v) => `${v} min`}
                unit="minutes" min={15} max={480} aria="Length"
                onChange={(v) => setBkEdit((c) => ({ ...c, duration_min: v ?? 60 }))}
              />
              <input
                className="cedit__input cset__extfield"
                placeholder="Price (e.g. $90, Free)"
                value={bkEdit.price ?? ''}
                onChange={(e) => setBkEdit((c) => ({ ...c, price: e.target.value }))}
              />
              {/* ONLINE PAYMENT (founder 2026-10-29: "Let's do both"): a real
                  amount collected by card at booking via Lichen's Stripe —
                  the provider accrues Current-cy 1:1 (or an auto cash-out,
                  their wallet's choice). Empty = no online payment; the
                  words-price above stays for display/sliding. Request types
                  never charge before the provider accepts. */}
              <input
                className="cedit__input cset__extfield"
                inputMode="decimal"
                placeholder="Collect online: $ (optional)"
                value={bkEdit.price_cents != null ? String(bkEdit.price_cents / 100) : ''}
                onChange={(e) => {
                  const clean = numericAmount(e.target.value);
                  setBkEdit((c) => ({ ...c, price_cents: clean ? Math.round(Number(clean) * 100) : null }));
                }}
              />
              {bkEdit.price_cents != null && (
                <p className="cedit__hint cset__linkhint">
                  {usdLabel(bkEdit.price_cents)} collected by card or US bank transfer at booking
                  ($1–$5,000) — you receive it as Current-cy, or as dollars via your
                  wallet&rsquo;s cash-out choice.
                </p>
              )}
              {bkEdit.price_cents != null && (
                <label className="cset__zoomcheck">
                  <input
                    type="checkbox"
                    checked={bkEdit.allow_pay_later !== false}
                    onChange={(e) => setBkEdit((c) => ({ ...c, allow_pay_later: e.target.checked }))}
                  />
                  <span>
                    Offer <strong>&ldquo;invoice me later&rdquo;</strong> at booking — they can settle
                    from their booking link any time. Unchecked, payment is asked up front.
                  </span>
                </label>
              )}
              <input
                className="cedit__input cset__grow"
                placeholder="Where (an address, or e.g. Online)"
                value={bkEdit.location ?? ''}
                onChange={(e) => setBkEdit((c) => ({ ...c, location: e.target.value }))}
              />
              {/* The video link (founder 2026-10-06): an IDENTIFIER field —
                  declines autocorrect. Shared only with people who book. */}
              <input
                className="cedit__input cset__grow"
                type="url"
                inputMode="url"
                placeholder="Video call link — Zoom, Google Meet, Teams… (optional)"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={bkLink}
                onChange={(e) => setBkLink(e.target.value)}
              />
              {bkLink.trim() && (() => {
                const n = normalizeMeetingUrl(bkLink);
                const svc = n.url ? videoServiceOf(n.url) : null;
                return (
                  <p className="cedit__hint cset__linkhint">
                    {n.error
                      ? n.error
                      : `${svc ? `${svc} link ✓` : 'Video link ✓'} — shown only to people once their booking is confirmed, never on your public booking page.`}
                  </p>
                );
              })()}
              {/* Unique Zoom meeting per booking (founder 2026-10-07: "walk
                  me thru how to do this with zoom, yes!"): minted on
                  Lichen's Zoom the moment a booking confirms — nobody can
                  ever land in a room booked for someone else, and a
                  cancelled booking's door actually closes. Offered only to
                  providers on the zoom_providers list. */}
              {zoomOk && (
                <label className="cset__zoomcheck">
                  <input type="checkbox" checked={bkZoom} onChange={(e) => setBkZoom(e.target.checked)} />
                  <span>
                    Create a <strong>unique Zoom meeting</strong> for each booking (on Lichen&rsquo;s Zoom).
                    {bkLink.trim() ? ' Your link above becomes the fallback if Zoom is ever unreachable.' : ''}
                  </span>
                </label>
              )}
              <FitSelect className="cset__select" value={bkEdit.approval ?? 'request'}
                onChange={(e) => setBkEdit((c) => ({ ...c, approval: e.target.value as BookingType['approval'] }))} aria-label="Approval">
                <option value="request">I approve each request</option>
                <option value="instant">Book instantly</option>
              </FitSelect>
              {/* Calendly-parity scheduling rules (founder 2026-10-03): how
                  close to now a slot may start, and how far out the book
                  opens. Enforced client-side in slotsForDay AND server-side
                  by the booking_notice_window trigger. */}
              <RuleSelect
                value={bkEdit.min_notice_min ?? 60}
                options={[
                  { v: 0, label: 'No minimum notice' },
                  { v: 60, label: 'At least 1 hour\u2019s notice' },
                  { v: 240, label: 'At least 4 hours\u2019 notice' },
                  { v: 720, label: 'At least 12 hours\u2019 notice' },
                  { v: 1440, label: 'At least 24 hours\u2019 notice' },
                  { v: 2880, label: 'At least 48 hours\u2019 notice' },
                ]}
                offLabel={(v) => v >= 60 && v % 60 === 0 ? `At least ${v / 60} hours\u2019 notice` : `At least ${v} min notice`}
                unit="hours" scale={60} min={0} max={336} decimals aria="Minimum notice"
                onChange={(v) => setBkEdit((c) => ({ ...c, min_notice_min: v ?? 60 }))}
              />
              <RuleSelect
                value={bkEdit.max_days_out ?? null}
                options={[
                  { v: null, label: 'Bookable any time ahead' },
                  { v: 7, label: 'Up to 1 week out' },
                  { v: 14, label: 'Up to 2 weeks out' },
                  { v: 28, label: 'Up to 4 weeks out' },
                  { v: 56, label: 'Up to 8 weeks out' },
                  { v: 84, label: 'Up to 12 weeks out' },
                ]}
                offLabel={(v) => `Up to ${v} days out`}
                unit="days" min={1} max={365} aria="How far out people can book"
                onChange={(v) => setBkEdit((c) => ({ ...c, max_days_out: v }))}
              />
              {/* Start-time increments independent of session length (founder
                  2026-10-29, the Calendly-parity gap closed): a 60-min
                  session can offer start times every 30. Null = step by the
                  session length, the original behavior — existing types are
                  untouched. */}
              <RuleSelect
                value={bkEdit.slot_increment_min ?? null}
                options={[
                  { v: null, label: 'Start times every session length' },
                  ...[15, 20, 30, 45, 60].map((n) => ({ v: n, label: `Start times every ${n} min` })),
                ]}
                offLabel={(v) => `Start times every ${v} min`}
                unit="minutes" min={5} max={240} aria="Start times every"
                onChange={(v) => setBkEdit((c) => ({ ...c, slot_increment_min: v }))}
              />
              {/* Daily cap + group capacity (founder 2026-10-03, the
                  Calendly audit). Cap counts sessions, not seats — joining
                  a group slot already on the books is never a new one. */}
              <RuleSelect
                value={bkEdit.max_per_day ?? null}
                options={[
                  { v: null, label: 'No daily limit' },
                  ...[1, 2, 3, 4, 6].map((n) => ({ v: n, label: `At most ${n} ${n === 1 ? 'session' : 'sessions'} a day` })),
                ]}
                offLabel={(v) => `At most ${v} sessions a day`}
                unit="sessions" min={1} max={48} aria="Daily limit"
                onChange={(v) => setBkEdit((c) => ({ ...c, max_per_day: v }))}
              />
              <RuleSelect
                value={bkEdit.capacity ?? 1}
                options={[
                  { v: 1, label: 'One person per slot (1:1)' },
                  ...[2, 4, 6, 8, 10, 12, 20].map((n) => ({ v: n, label: `Group — up to ${n} people` })),
                ]}
                offLabel={(v) => `Group — up to ${v} people`}
                unit="people" min={1} max={200} aria="Group size"
                onChange={(v) => setBkEdit((c) => ({ ...c, capacity: v ?? 1 }))}
              />
              {/* An event's HOUR RULES (founder 2026-10-03: "it can be work,
                  social, or on call if you have that; or custom and you can
                  set hours for that event type"). */}
              <FitSelect className="cset__select" value={bkEdit.hours_kind ?? 'work'}
                onChange={(e) => setBkEdit((c) => ({ ...c, hours_kind: e.target.value as BookingType['hours_kind'] }))} aria-label="Books from which hours">
                <option value="work">Books from your work hours</option>
                <option value="social">Books from your social hours</option>
                {(isCaregiver || bkEdit.hours_kind === 'on_call') && <option value="on_call">Books from your on-call hours</option>}
                <option value="custom">Has its own hours</option>
              </FitSelect>
              {(bkEdit.hours_kind === 'custom') && (
                <div className="cset__typehours">
                  {bkHours.map((h, i) => (
                    <div className="cset__typehour" key={i}>
                      <span>{WEEKDAYS_FULL[h.weekday]} {minToLabel(h.start_min)} – {minToLabel(h.end_min)}</span>
                      <button className="cedit__remove" aria-label="Remove these hours"
                        onClick={() => setBkHours((rows) => rows.filter((_, j) => j !== i))}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="cset__typehour-add">
                    <FitSelect className="cset__select" value={chDay} onChange={(e) => setChDay(e.target.value)} aria-label="Day">
                      <option value="weekdays">Monday – Friday</option>
                      <option value="weekend">Saturday &amp; Sunday</option>
                      <option value="everyday">Every day</option>
                      {WEEKDAYS_FULL.map((d, i) => <option key={i} value={String(i)}>{d}</option>)}
                    </FitSelect>
                    <TimeField value={chStart} onChange={(m) => { setChStart(m); if (chEnd <= m) setChEnd(Math.min(m + 60, 1440)); }} ariaLabel="From" />
                    <span className="rec__lbl">to</span>
                    <TimeField value={chEnd} onChange={setChEnd} min={chStart} ariaLabel="Until" />
                    <button className="cedit__add cedit__add--sm"
                      onClick={() => {
                        const days = chDay === 'weekdays' ? [0, 1, 2, 3, 4]
                          : chDay === 'weekend' ? [5, 6]
                          : chDay === 'everyday' ? [0, 1, 2, 3, 4, 5, 6]
                          : [Number(chDay)];
                        setBkHours((rows) => [
                          ...rows,
                          ...days.filter((d) => !rows.some((r) => r.weekday === d && r.start_min === chStart && r.end_min === chEnd))
                            .map((d) => ({ weekday: d, start_min: chStart, end_min: chEnd })),
                        ]);
                      }}>
                      <Icon name="plus" size={12} /> Add
                    </button>
                  </div>
                  {bkHours.length === 0 && (
                    <p className="cedit__hint">No hours yet — this session can&rsquo;t be booked until it has some.</p>
                  )}
                </div>
              )}
              {/* PLACE & PEOPLE RULES (founder 2026-10-03: "9-5pm Monday-
                  Wednesday if 'this place' or 'this person' is also
                  available or isn't available"). A person's times reach a
                  booking page only as anonymous shapes, and only as far as
                  YOUR OWN calendar standing with them already sees. */}
              <div className="cset__rules">
                {bkConds.map((c, i) => (
                  <div className="cset__typehour" key={i}>
                    <span>{c.label ?? 'Someone'}</span>
                    <FitSelect className="cset__select" value={c.require} aria-label="Rule"
                      onChange={(e) => setBkConds((rows) => rows.map((r, j) => j === i ? { ...r, require: e.target.value as TypeCondition['require'] } : r))}>
                      <option value="available">must be available</option>
                      <option value="unavailable">must NOT be available</option>
                    </FitSelect>
                    <button className="cedit__remove" aria-label="Remove this rule"
                      onClick={() => setBkConds((rows) => rows.filter((_, j) => j !== i))}>
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                ))}
                <input
                  className="cedit__input cset__grow"
                  placeholder="Rule: only when a person or bookable area is free? Search…"
                  value={condQ}
                  onChange={(e) => {
                    const v = e.target.value; setCondQ(v);
                    void searchConditionTargets(v).then((hits) => setCondHits(
                      hits.filter((h) => !bkConds.some((c) => c.target_id === h.target_id))));
                  }}
                />
                {condQ.trim().length >= 2 && condHits.map((h) => (
                  <button className="cedit__add cedit__add--sm" key={h.target_id}
                    onClick={() => { setBkConds((rows) => [...rows, h]); setCondQ(''); setCondHits([]); }}>
                    <Icon name="plus" size={12} /> {h.label}
                  </button>
                ))}
              </div>
              {/* The vanity link name (founder 2026-10-03): an IDENTIFIER
                  field, so it declines autocorrect (the standing rule). */}
              <input
                className="cedit__input cset__grow"
                placeholder="Link name for a direct URL (e.g. care-coordination) — optional"
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={bkEdit.slug ?? ''}
                onChange={(e) => setBkEdit((c) => ({ ...c, slug: e.target.value }))}
              />
              <textarea
                className="cedit__input cset__questions"
                value={(bkEdit.questions ?? []).join('\n')}
                onChange={(e) => setBkEdit((c) => ({
                  ...c,
                  questions: e.target.value.split('\n').map((l) => l.slice(0, 200)).slice(0, 5),
                }))}
                placeholder={'Questions to ask when someone books — one per line, up to five.\ne.g. What would you like to focus on?'}
                rows={2}
              />
              <FitSelect className="cset__select" value={bkEdit.audience ?? 'everyone'}
                onChange={(e) => setBkEdit((c) => ({ ...c, audience: e.target.value as BookingType['audience'] }))} aria-label="Who can book">
                <option value="public">Anyone — even outside Lichen, via your link</option>
                <option value="everyone">Anyone on Lichen</option>
                <option value="mycelium">My-celium only</option>
                <option value="space">Members of one of your groups…</option>
              </FitSelect>
              {bkEdit.audience === 'space' && (
                <FitSelect className="cset__select" value={bkEdit.audience_space_id ?? ''}
                  onChange={(e) => setBkEdit((c) => ({ ...c, audience_space_id: e.target.value || null }))} aria-label="Which group">
                  <option value="">Pick the group…</option>
                  {mySpaces.map((sp) => <option key={sp.id} value={sp.id}>{sp.name}</option>)}
                </FitSelect>
              )}
              <button
                className="cedit__add cedit__add--sm"
                disabled={!(bkEdit.title ?? '').trim() || (bkEdit.audience === 'space' && !bkEdit.audience_space_id)}
                onClick={() => act(async () => {
                  const qs = (bkEdit.questions ?? []).map((s) => s.trim()).filter(Boolean);
                  const link = normalizeMeetingUrl(bkLink);
                  if (link.error) throw new Error(link.error);
                  // A video session with no "where" says which service in
                  // public ("· Zoom") — the service name, never the link.
                  const where = (bkEdit.location ?? '').trim()
                    || (bkZoom && zoomOk ? 'Zoom' : '')
                    || (link.url ? (videoServiceOf(link.url) ?? 'Online') : '');
                  let typeId: string;
                  try {
                    typeId = await saveBookingType(me, {
                      ...bkEdit, title: (bkEdit.title ?? '').trim(),
                      location: where,
                      questions: qs.length ? qs : null,
                      slug: slugify(bkEdit.slug ?? '') || null,
                      hours_kind: bkEdit.hours_kind ?? 'work',
                    } as Partial<BookingType> & { title: string });
                  } catch (e) {
                    const msg = (e as { message?: string } | null)?.message ?? '';
                    throw msg.includes('booking_types_slug_per_profile')
                      ? new Error('That link name is already on another of your sessions — pick a different one.')
                      : e;
                  }
                  // Its own hours live with it; switching away from custom
                  // clears the leftovers so nothing books from ghost hours.
                  await saveTypeHours(me, typeId, (bkEdit.hours_kind === 'custom') ? bkHours : []);
                  await saveTypeConditions(typeId, bkConds);
                  const wantZoom = bkZoom && zoomOk;
                  if ((link.url ?? null) !== (bkLinks[typeId]?.url ?? null)
                      || wantZoom !== (bkLinks[typeId]?.zoom_unique ?? false)) {
                    await saveMeetingLink(typeId, link.url, wantZoom);
                  }
                  setBkOpen(false); setBkEdit({}); setBkLink(''); setBkZoom(false); setBkHours([]); setBkConds([]);
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
              <button className="cedit__remove" aria-label="Close" onClick={() => { setBkOpen(false); setBkEdit({}); setBkLink(''); setBkZoom(false); }}>
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
