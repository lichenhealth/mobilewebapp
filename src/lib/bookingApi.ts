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
  audience: 'everyone' | 'mycelium';
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
  type?: { title: string; price: string; location: string } | null;
  provider?: { full_name: string | null } | null;
  booker?: { full_name: string | null } | null;
}

const TYPE_COLS = 'id, profile_id, title, description, duration_min, buffer_min, price, location, approval, audience, active';

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

const BOOKING_EMBED =
  'id, type_id, provider_id, booker_id, on_date, start_min, end_min, status, note, ' +
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
