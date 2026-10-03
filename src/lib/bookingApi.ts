import { supabase } from './supabase';
import { occursOn } from './recurrence';
import type { Recurrence } from './recurrence';

// ─── Bookings — the Calendly layer (founder design, 2026-07-17) ──────────────
// Session types are the practitioner's offerings; slots come from declared
// hours minus ALL busy time (Lichen events, imported calendars, held
// bookings); a confirmed booking is a real events row on both calendars.
// No payments v1 — price is words, money moves as it already does.

export interface BookingType {
  id: string;
  profile_id: string;
  title: string;
  description: string;
  duration_min: number;
  buffer_min: number;
  price: string;
  location: string;
  approval: 'request' | 'instant';
  audience: 'everyone' | 'mycelium' | 'public' | 'space';
  /** When audience='space': only members of this space see and book it. */
  audience_space_id?: string | null;
  /** Calendly-parity scheduling rules (founder 2026-10-03). Minimum notice:
   *  a slot can't start sooner than this many minutes from now (server
   *  enforces it too, via the booking_notice_window trigger). */
  min_notice_min: number;
  /** How far out people may book, in days — null = no limit. */
  max_days_out: number | null;
  /** At most N sessions of this type per day (distinct start times, so a
   *  group seat joining an existing session never counts). null = no cap. */
  max_per_day: number | null;
  /** Group sessions (founder 2026-10-03): how many people share one slot.
   *  1 = classic 1:1. Seats at the same slot share ONE calendar event. */
  capacity: number;
  /** Questions asked at booking (array of strings); answers land on the
   *  booking row for the provider to read. */
  questions: string[] | null;
  /** The vanity link name (founder 2026-10-03, the Calendly shape):
   *  lichen.health/book/<handle>/<slug> → straight to this type. Lowercase
   *  kebab, unique per member, null = no vanity link. */
  slug: string | null;
  /** Which hours pool this type books from (founder 2026-10-03: "an event
   *  itself can have hour rules"): work (the default — yesterday's
   *  behavior), social, on_call, or custom = its own weekly windows
   *  (availability_windows rows bound by booking_type_id, never counted as
   *  the member's general availability). */
  hours_kind: 'work' | 'social' | 'on_call' | 'custom';
  active: boolean;
}

export interface BookingRow {
  id: string;
  type_id: string;
  provider_id: string;
  booker_id: string;
  on_date: string;
  start_min: number;
  end_min: number;
  status: 'pending' | 'confirmed' | 'declined' | 'cancelled';
  note: string;
  /** The booker's answers to the type's questions, [{q, a}]. */
  answers?: { q: string; a: string }[] | null;
  /** Guest bookings (the public link): no member behind them — a name, an
   *  email, and an unguessable token that is their whole authorization. */
  guest_name?: string | null;
  guest_email?: string | null;
  guest_token?: string | null;
  type?: { title: string; price: string; location: string } | null;
  provider?: { full_name: string | null } | null;
  booker?: { full_name: string | null } | null;
}

const TYPE_COLS = 'id, profile_id, title, description, duration_min, buffer_min, price, location, approval, audience, audience_space_id, min_notice_min, max_days_out, max_per_day, capacity, questions, slug, hours_kind, active';

export async function listMyBookingTypes(me: string): Promise<BookingType[]> {
  const { data, error } = await supabase.from('booking_types')
    .select(TYPE_COLS).eq('profile_id', me).order('created_at');
  if (error) { console.warn('listMyBookingTypes:', error.message); return []; }
  return (data as BookingType[] | null) ?? [];
}

/** Another member's bookable sessions — RLS shows only what you may see. */
export async function listBookableTypes(profileId: string): Promise<BookingType[]> {
  const { data, error } = await supabase.from('booking_types')
    .select(TYPE_COLS).eq('profile_id', profileId).eq('active', true).order('created_at');
  if (error) { console.warn('listBookableTypes:', error.message); return []; }
  return (data as BookingType[] | null) ?? [];
}

export async function saveBookingType(
  me: string,
  t: Partial<BookingType> & { title: string },
): Promise<string> {
  const row = { ...t, profile_id: me };
  if (t.id) {
    const { error } = await supabase.from('booking_types').update(row).eq('id', t.id).eq('profile_id', me);
    if (error) throw error;
    return t.id;
  }
  const { data, error } = await supabase.from('booking_types').insert(row).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteBookingType(me: string, id: string): Promise<void> {
  const { error } = await supabase.from('booking_types').delete().eq('id', id).eq('profile_id', me);
  if (error) throw error;
}

// ── A type's OWN hours + its place/people rules (founder 2026-10-03) ─────────

export interface TypeHourRow { weekday: number; start_min: number; end_min: number }

export async function listTypeHours(typeId: string): Promise<TypeHourRow[]> {
  const { data, error } = await supabase.from('availability_windows')
    .select('weekday, start_min, end_min')
    .eq('booking_type_id', typeId).order('weekday').order('start_min');
  if (error) { console.warn('listTypeHours:', error.message); return []; }
  return (data as TypeHourRow[] | null) ?? [];
}

/** Replace a type's custom windows wholesale — the editor's one save. */
export async function saveTypeHours(me: string, typeId: string, rows: TypeHourRow[]): Promise<void> {
  const del = await supabase.from('availability_windows')
    .delete().eq('booking_type_id', typeId).eq('profile_id', me);
  if (del.error) throw del.error;
  if (!rows.length) return;
  const { error } = await supabase.from('availability_windows').insert(
    rows.map((r) => ({ profile_id: me, booking_type_id: typeId, kind: 'custom', ...r })));
  if (error) throw error;
}

export interface TypeCondition {
  target_type: 'profile' | 'resource';
  target_id: string;
  require: 'available' | 'unavailable';
  /** Display only — resolved at load/pick time, never stored. */
  label?: string;
}

export async function listTypeConditions(typeId: string): Promise<TypeCondition[]> {
  const { data, error } = await supabase.from('booking_type_conditions')
    .select('target_type, target_id, require').eq('type_id', typeId).order('created_at');
  if (error) { console.warn('listTypeConditions:', error.message); return []; }
  const rows = (data as TypeCondition[] | null) ?? [];
  const pids = rows.filter((r) => r.target_type === 'profile').map((r) => r.target_id);
  const rids = rows.filter((r) => r.target_type === 'resource').map((r) => r.target_id);
  const [profs, ress] = await Promise.all([
    pids.length ? supabase.from('profiles').select('id, full_name').in('id', pids) : Promise.resolve({ data: [] }),
    rids.length ? supabase.from('resources').select('id, name').in('id', rids) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map<string, string>();
  for (const p of (profs.data as { id: string; full_name: string | null }[] | null) ?? []) names.set(p.id, p.full_name ?? 'A member');
  for (const r of (ress.data as { id: string; name: string }[] | null) ?? []) names.set(r.id, r.name);
  return rows.map((r) => ({ ...r, label: names.get(r.target_id) ?? 'Someone' }));
}

export async function saveTypeConditions(typeId: string, conds: TypeCondition[]): Promise<void> {
  const del = await supabase.from('booking_type_conditions').delete().eq('type_id', typeId);
  if (del.error) throw del.error;
  if (!conds.length) return;
  const { error } = await supabase.from('booking_type_conditions').insert(
    conds.map((c) => ({ type_id: typeId, target_type: c.target_type, target_id: c.target_id, require: c.require })));
  if (error) throw error;
}

/** Search people (findable) + bookable areas & things for a rule's target. */
export async function searchConditionTargets(q: string): Promise<TypeCondition[]> {
  const needle = q.trim();
  if (needle.length < 2) return [];
  const [profs, ress] = await Promise.all([
    supabase.from('profiles').select('id, full_name')
      .eq('findable', true).eq('kind', 'person').ilike('full_name', `%${needle}%`).limit(5),
    supabase.from('resources').select('id, name').ilike('name', `%${needle}%`).limit(5),
  ]);
  return [
    ...(((profs.data as { id: string; full_name: string | null }[] | null) ?? [])
      .map((p) => ({ target_type: 'profile' as const, target_id: p.id, require: 'available' as const, label: p.full_name ?? 'A member' }))),
    ...(((ress.data as { id: string; name: string }[] | null) ?? [])
      .map((r) => ({ target_type: 'resource' as const, target_id: r.id, require: 'available' as const, label: `${r.name} (bookable area/thing)` }))),
  ];
}

export interface OpenSession extends BookingType {
  provider?: { full_name: string | null; headline: string | null; avatar_url: string | null } | null;
}

/** Every session the network is offering YOU — RLS trims to what you may see
 *  (audience 'everyone', plus 'mycelium' types whose provider holds you in
 *  their web). Own types excluded: you can't book yourself. */
export async function listOpenSessions(me: string): Promise<OpenSession[]> {
  const { data, error } = await supabase.from('booking_types')
    .select(TYPE_COLS + ', provider:profiles(full_name, headline, avatar_url)')
    .eq('active', true)
    .neq('profile_id', me)
    .order('created_at');
  if (error) { console.warn('listOpenSessions:', error.message); return []; }
  return (data as unknown as OpenSession[] | null) ?? [];
}

// ─── The slot picker's raw materials + computation ───────────────────────────

interface BoardWindow { weekday: number; start_min: number; end_min: number; valid_from: string | null; valid_to: string | null }
interface BoardBusy { start_date: string; end_date: string; all_day: boolean; start_min: number | null; end_min: number | null; recurrence: Recurrence | null }
/** A place/people rule's raw materials (founder 2026-10-03): anonymous
 *  time-shapes only — no names, no titles. readable=false means the
 *  provider's own standing can't see that person; the picker skips it,
 *  exactly as the server does. */
export interface BoardCondition { require: 'available' | 'unavailable'; readable: boolean; windows: BoardWindow[]; busy: BoardBusy[] }
export interface BookingBoard {
  type: Pick<BookingType, 'id' | 'title' | 'description' | 'duration_min' | 'buffer_min' | 'price' | 'location' | 'approval'>
    & {
      provider_id: string; min_notice_min?: number | null; max_days_out?: number | null;
      max_per_day?: number | null; capacity?: number | null; questions?: string[] | null;
      /** The provider's IANA timezone — slots are THEIR wall time. */
      provider_tz?: string | null;
    };
  windows: BoardWindow[];
  busy: BoardBusy[];
  conditions?: BoardCondition[];
  /** Held sessions per date for this type (distinct start times) — the
   *  daily cap's raw material. */
  day_counts?: Record<string, number>;
  /** Seats held per (date, start) for this type — group fullness. */
  seat_counts?: { on_date: string; start_min: number; n: number }[];
}

export async function loadBookingBoard(typeId: string, from: string, to: string): Promise<BookingBoard | null> {
  const { data, error } = await supabase.rpc('booking_board', { p_type: typeId, p_from: from, p_to: to });
  if (error) { console.warn('booking_board:', error.message); return null; }
  return (data as BookingBoard | null) ?? null;
}

/** Open slot starts (minutes) for one day: inside a declared window, clear of
 *  every busy span (recurrence expanded with the calendar's own engine),
 *  buffered, past the type's minimum notice, and inside its booking window.
 *  Slots step by the session length. ⚠ The notice is a real datetime compare
 *  (slot's local midnight + minutes vs now + notice) — the old today-only
 *  minute compare let a 24h notice leak through at midnight. */
export function slotsForDay(board: BookingBoard, iso: string, now = new Date()): number[] {
  const d = new Date(iso + 'T00:00:00');
  const weekday = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun, matching availability
  const { duration_min: dur, buffer_min: buf } = board.type;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (iso < todayIso) return [];
  const maxOut = board.type.max_days_out ?? null;
  if (maxOut != null) {
    const limit = new Date(now); limit.setDate(limit.getDate() + maxOut);
    const limitIso = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-${String(limit.getDate()).padStart(2, '0')}`;
    if (iso > limitIso) return [];
  }
  // Daily cap: a day that already holds its max sessions offers nothing —
  // except, for a group type, the slots already running with seats left
  // (joining isn't a new session; the server counts the same way).
  const cap = board.type.max_per_day ?? null;
  const capacity = board.type.capacity ?? 1;
  const dayFull = cap != null && (board.day_counts?.[iso] ?? 0) >= cap;
  const heldStarts = new Set(
    (board.seat_counts ?? []).filter((s) => s.on_date === iso).map((s) => s.start_min));
  if (dayFull && capacity <= 1) return [];
  const cutoffMs = now.getTime() + (board.type.min_notice_min ?? 60) * 60000;

  const busyToday = board.busy.filter((b) =>
    occursOn({ start_date: b.start_date, end_date: b.end_date, recurrence: b.recurrence } as Parameters<typeof occursOn>[0], iso));
  const blocked = (s: number, e: number) => busyToday.some((b) =>
    b.all_day || ((b.start_min ?? 0) < e + buf && (b.end_min ?? 1440) + buf > s));

  // Place/people rules (founder 2026-10-03): each readable condition's
  // target counts as available when the slot sits inside their declared
  // hours (if they declared any) AND clear of their busy; 'unavailable'
  // is the inverse. Same math as the server's _target_available, with
  // recurrence expanded here — the engine lives client-side by doctrine.
  const conds = (board.conditions ?? []).filter((c) => c.readable !== false);
  const condBusyToday = conds.map((c) => c.busy.filter((b) =>
    occursOn({ start_date: b.start_date, end_date: b.end_date, recurrence: b.recurrence } as Parameters<typeof occursOn>[0], iso)));
  const condOK = (s: number, e: number) => conds.every((c, i) => {
    const inWin = c.windows.length === 0 || c.windows.some((w) =>
      w.weekday === weekday && w.start_min <= s && w.end_min >= e
      && (!w.valid_from || w.valid_from <= iso) && (!w.valid_to || w.valid_to >= iso));
    const busyHit = condBusyToday[i].some((b) =>
      b.all_day || ((b.start_min ?? 0) < e && (b.end_min ?? 1440) > s));
    const avail = inWin && !busyHit;
    return c.require === 'available' ? avail : !avail;
  });

  const out: number[] = [];
  for (const w of board.windows) {
    if (w.weekday !== weekday) continue;
    if (w.valid_from && w.valid_from > iso) continue;
    if (w.valid_to && w.valid_to < iso) continue;
    for (let t = w.start_min; t + dur <= w.end_min; t += dur) {
      if (d.getTime() + t * 60000 < cutoffMs) continue;
      if (dayFull && capacity > 1 && !heldStarts.has(t)) continue;
      if (capacity > 1 && seatsLeft(board, iso, t) <= 0) continue;
      if (!condOK(t, t + dur)) continue;
      if (!blocked(t, t + dur)) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Seats still open at one group slot (capacity minus held seats); a 1:1
 *  type always answers 1 — the conflict check is its fullness. */
export function seatsLeft(board: BookingBoard, iso: string, startMin: number): number {
  const capacity = board.type.capacity ?? 1;
  if (capacity <= 1) return 1;
  const held = (board.seat_counts ?? [])
    .find((s) => s.on_date === iso && s.start_min === startMin)?.n ?? 0;
  return Math.max(0, capacity - held);
}

// ─── Viewer-timezone display (the public link's logged follow-up, built
//     2026-10-03). Slot minutes are the PROVIDER's wall time by doctrine —
//     only LABELS convert; everything sent to the server stays provider-
//     local. The two-pass offset correction handles DST honestly. ──────────

export function viewerZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''; } catch { return ''; }
}

/** The absolute instant of a provider-local slot, or null when the zone is
 *  unknown/invalid (callers then show provider time with the honest label). */
export function slotInstant(iso: string, min: number, providerTz: string | null | undefined): Date | null {
  if (!providerTz) return null;
  try {
    const target = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), Math.floor(min / 60), min % 60);
    let guess = target;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: providerTz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date(guess));
      const get = (t: string) => +(parts.find((p) => p.type === t)?.value ?? '0');
      const asIf = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'));
      guess += target - asIf;
    }
    return new Date(guess);
  } catch { return null; }
}

/** A slot's label in the VIEWER's own clock, with how many days the viewer-
 *  local date shifts from the provider-local one (a 9am Denver slot is the
 *  same evening in London, the next morning in Tokyo). null = can't convert. */
export function viewerSlotLabel(
  iso: string, min: number, providerTz: string | null | undefined,
): { label: string; dayShift: number } | null {
  const at = slotInstant(iso, min, providerTz);
  if (!at) return null;
  const label = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .toLowerCase().replace(' ', '').replace(':00', '');
  const localIso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  const dayShift = Math.round((new Date(localIso + 'T00:00:00').getTime() - new Date(iso + 'T00:00:00').getTime()) / 86400000);
  return { label, dayShift };
}

/** Nobody is bookable by default (founder 2026-08-14): no declared hours means
 *  NOT available — unknown is never yes, same doctrine as presence and the
 *  find-a-time shading. When a booker hits that wall, this turns their demand
 *  into the provider's setup moment: a bell (which rides push) pointing at
 *  Calendar settings. The human ask travels separately, as a prefilled DM the
 *  booker sends in their own words — the platform has no voice in chat. */
export async function nudgeAvailability(provider: string, sessionTitle: string): Promise<void> {
  const { error } = await supabase.rpc('notify', {
    p_recipient: provider,
    p_section: 'calendar',
    p_space: null,
    p_type: 'booking_nudge',
    p_title: 'Someone wants to book time with you',
    p_body: `They tried to book “${sessionTitle}”, but you haven’t set up your availability hours yet. Set them in Calendar settings and they can pick a time.`,
    p_link: '/calendar/settings',
    p_actor: (await supabase.auth.getUser()).data.user?.id ?? null,
  });
  if (error) throw error;
}

// ─── Booking lifecycle (SECURITY DEFINER RPCs do the real work) ──────────────

export async function createBooking(
  typeId: string, date: string, startMin: number, note: string,
  answers?: { q: string; a: string }[],
): Promise<void> {
  const { error } = await supabase.rpc('create_booking', {
    p_type: typeId, p_date: date, p_start: startMin, p_note: note,
    p_answers: answers?.length ? answers : null,
  });
  if (error) throw error;
}

/** Move a live booking to a new open slot — either party; everything a
 *  fresh booking checks is re-checked server-side and the calendar event
 *  moves too. Returns the guest token when the PROVIDER moved a guest's
 *  booking, so the caller can send the state-derived mail. */
export async function rescheduleBooking(bookingId: string, date: string, startMin: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('reschedule_booking', {
    p_booking: bookingId, p_date: date, p_start: startMin,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

export async function respondBooking(bookingId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_booking', { p_booking: bookingId, p_accept: accept });
  if (error) throw error;
}

export async function cancelBooking(bookingId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_booking', { p_booking: bookingId });
  if (error) throw error;
}

// ─── The public booking link (founder 2026-08-14, the Calendly replacement) ──
// Anyone with lichen.health/book/<handle> — on Lichen or not — sees the
// member's PUBLIC session types against their real availability (declared
// hours minus Lichen events, imported calendars, and held bookings) and books
// as a guest: name + email, an unguessable token as their key.

export interface PublicBookingPage {
  provider: { id: string; full_name: string | null; avatar_url: string | null; headline: string | null; timezone: string | null };
  types: (Pick<BookingType, 'id' | 'title' | 'description' | 'duration_min' | 'buffer_min' | 'price' | 'location' | 'approval'>
    & { slug?: string | null })[];
}

/** The vanity link's one sanitizer — shared by the editor and anywhere a
 *  link name is read from typing: lowercase kebab, 48 chars, no edge dashes. */
export function slugify(raw: string): string {
  return raw.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
}

/** handle + link name → type id (null = nothing answers there). Anonymous
 *  callers resolve public types only; signed-in, whatever they may see. */
export async function resolveBookingVanity(handle: string, slug: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resolve_booking_vanity', {
    p_handle: handle, p_slug: slug.toLowerCase(),
  });
  if (error) { console.warn('resolve_booking_vanity:', error.message); return null; }
  return (data as string | null) ?? null;
}

export async function publicBookingPage(handle: string): Promise<PublicBookingPage | null> {
  const { data, error } = await supabase.rpc('public_booking_page', { p_handle: handle });
  if (error) { console.warn('public_booking_page:', error.message); return null; }
  return (data as PublicBookingPage | null) ?? null;
}

export async function publicBookingBoard(typeId: string, from: string, to: string): Promise<BookingBoard | null> {
  const { data, error } = await supabase.rpc('public_booking_board', { p_type: typeId, p_from: from, p_to: to });
  if (error) { console.warn('public_booking_board:', error.message); return null; }
  return (data as BookingBoard | null) ?? null;
}

export async function guestCreateBooking(
  typeId: string, date: string, startMin: number,
  name: string, email: string, note: string,
  answers?: { q: string; a: string }[],
): Promise<string> {
  const { data, error } = await supabase.rpc('guest_create_booking', {
    p_type: typeId, p_date: date, p_start: startMin,
    p_name: name, p_email: email, p_note: note,
    p_answers: answers?.length ? answers : null,
  });
  if (error) throw error;
  return data as string;
}

export async function guestRescheduleBooking(token: string, date: string, startMin: number): Promise<void> {
  const { error } = await supabase.rpc('guest_reschedule_booking', {
    p_token: token, p_date: date, p_start: startMin,
  });
  if (error) throw error;
}

export interface GuestBookingView {
  guest_name: string; status: string; on_date: string; start_min: number; end_min: number;
  note: string; type_title: string; type_location: string; duration_min: number;
  provider_name: string; type_id: string; capacity: number;
}

export async function loadGuestBooking(token: string): Promise<GuestBookingView | null> {
  const { data, error } = await supabase.rpc('guest_booking', { p_token: token });
  if (error) { console.warn('guest_booking:', error.message); return null; }
  return ((data as GuestBookingView[] | null) ?? [])[0] ?? null;
}

export async function guestCancelBooking(token: string): Promise<void> {
  const { error } = await supabase.rpc('guest_cancel_booking', { p_token: token });
  if (error) throw error;
}

/** Fire-and-forget guest email — content derives from the booking's current
 *  DB state server-side, so callers just point at the token. */
export function sendBookingMail(token: string): void {
  void supabase.functions.invoke('send-booking-mail', { body: { token } }).catch(console.error);
}

const BOOKING_EMBED =
  'id, type_id, provider_id, booker_id, on_date, start_min, end_min, status, note, answers, guest_name, guest_email, guest_token, ' +
  'type:booking_types(title, price, location), ' +
  'provider:profiles!bookings_provider_id_fkey(full_name), ' +
  'booker:profiles!bookings_booker_id_fkey(full_name)';

export async function listMyBookings(me: string): Promise<{ asProvider: BookingRow[]; asBooker: BookingRow[] }> {
  const [prov, book] = await Promise.all([
    supabase.from('bookings').select(BOOKING_EMBED).eq('provider_id', me)
      .order('on_date').order('start_min'),
    supabase.from('bookings').select(BOOKING_EMBED).eq('booker_id', me)
      .order('on_date').order('start_min'),
  ]);
  if (prov.error) console.warn('listMyBookings(provider):', prov.error.message);
  if (book.error) console.warn('listMyBookings(booker):', book.error.message);
  return {
    asProvider: (prov.data as unknown as BookingRow[] | null) ?? [],
    asBooker: (book.data as unknown as BookingRow[] | null) ?? [],
  };
}
