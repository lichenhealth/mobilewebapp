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
  /** Guest bookings (the public link): no member behind them — a name, an
   *  email, and an unguessable token that is their whole authorization. */
  guest_name?: string | null;
  guest_email?: string | null;
  guest_token?: string | null;
  type?: { title: string; price: string; location: string } | null;
  provider?: { full_name: string | null } | null;
  booker?: { full_name: string | null } | null;
}

const TYPE_COLS = 'id, profile_id, title, description, duration_min, buffer_min, price, location, approval, audience, audience_space_id, active';

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
): Promise<void> {
  const row = { ...t, profile_id: me };
  const { error } = t.id
    ? await supabase.from('booking_types').update(row).eq('id', t.id).eq('profile_id', me)
    : await supabase.from('booking_types').insert(row);
  if (error) throw error;
}

export async function deleteBookingType(me: string, id: string): Promise<void> {
  const { error } = await supabase.from('booking_types').delete().eq('id', id).eq('profile_id', me);
  if (error) throw error;
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
export interface BookingBoard {
  type: Pick<BookingType, 'id' | 'title' | 'description' | 'duration_min' | 'buffer_min' | 'price' | 'location' | 'approval'> & { provider_id: string };
  windows: BoardWindow[];
  busy: BoardBusy[];
}

export async function loadBookingBoard(typeId: string, from: string, to: string): Promise<BookingBoard | null> {
  const { data, error } = await supabase.rpc('booking_board', { p_type: typeId, p_from: from, p_to: to });
  if (error) { console.warn('booking_board:', error.message); return null; }
  return (data as BookingBoard | null) ?? null;
}

/** Open slot starts (minutes) for one day: inside a declared window, clear of
 *  every busy span (recurrence expanded with the calendar's own engine),
 *  buffered, and not in the past. Slots step by the session length. */
export function slotsForDay(board: BookingBoard, iso: string, now = new Date()): number[] {
  const d = new Date(iso + 'T00:00:00');
  const weekday = (d.getDay() + 6) % 7; // 0=Mon … 6=Sun, matching availability
  const { duration_min: dur, buffer_min: buf } = board.type;
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const minStart = iso === todayIso ? now.getHours() * 60 + now.getMinutes() + 60 : 0;
  if (iso < todayIso) return [];

  const busyToday = board.busy.filter((b) =>
    occursOn({ start_date: b.start_date, end_date: b.end_date, recurrence: b.recurrence } as Parameters<typeof occursOn>[0], iso));
  const blocked = (s: number, e: number) => busyToday.some((b) =>
    b.all_day || ((b.start_min ?? 0) < e + buf && (b.end_min ?? 1440) + buf > s));

  const out: number[] = [];
  for (const w of board.windows) {
    if (w.weekday !== weekday) continue;
    if (w.valid_from && w.valid_from > iso) continue;
    if (w.valid_to && w.valid_to < iso) continue;
    for (let t = w.start_min; t + dur <= w.end_min; t += dur) {
      if (t < minStart) continue;
      if (!blocked(t, t + dur)) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
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

export async function createBooking(typeId: string, date: string, startMin: number, note: string): Promise<void> {
  const { error } = await supabase.rpc('create_booking', {
    p_type: typeId, p_date: date, p_start: startMin, p_note: note,
  });
  if (error) throw error;
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
  types: Pick<BookingType, 'id' | 'title' | 'description' | 'duration_min' | 'buffer_min' | 'price' | 'location' | 'approval'>[];
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
): Promise<string> {
  const { data, error } = await supabase.rpc('guest_create_booking', {
    p_type: typeId, p_date: date, p_start: startMin,
    p_name: name, p_email: email, p_note: note,
  });
  if (error) throw error;
  return data as string;
}

export interface GuestBookingView {
  guest_name: string; status: string; on_date: string; start_min: number; end_min: number;
  note: string; type_title: string; type_location: string; duration_min: number;
  provider_name: string;
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
  'id, type_id, provider_id, booker_id, on_date, start_min, end_min, status, note, guest_name, guest_email, guest_token, ' +
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
