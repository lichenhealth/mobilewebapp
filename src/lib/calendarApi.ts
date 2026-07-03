import { supabase } from './supabase';
import type { Recurrence } from './recurrence';

// ─── Types ────────────────────────────────────────────────────────────────────
export type RsvpStatus = 'invited' | 'going' | 'declined';

export interface EventAttendee {
  profile_id: string;
  status: RsvpStatus;
  profile?: { full_name: string | null } | null;
}

export interface EventRow {
  id: string;
  creator_id: string;
  owner_profile_id: string | null;
  owner_space_id: string | null;
  title: string;
  description: string;
  location: string;
  start_date: string;              // yyyy-mm-dd, local
  end_date: string;
  all_day: boolean;
  start_min: number | null;        // minutes since local midnight
  end_min: number | null;
  recurrence: Recurrence | null;
  created_at: string;
  attendees?: EventAttendee[];
}

const EVENT_COLS =
  'id, creator_id, owner_profile_id, owner_space_id, title, description, location, ' +
  'start_date, end_date, all_day, start_min, end_min, recurrence, created_at';
const ATTENDEE_EMBED = 'attendees:event_attendees(profile_id, status, profile:profiles(full_name))';

// ─── Time helpers (minutes since midnight ↔ labels) ──────────────────────────
export function minToLabel(min: number): string {
  const h24 = Math.floor(min / 60), m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'am' : 'pm';
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
}
/** 15-minute steps across the day, for TimeField options. */
export const TIME_STEPS: number[] = Array.from({ length: 96 }, (_, i) => i * 15);

// ─── Load ─────────────────────────────────────────────────────────────────────
// Window filter: candidate if it starts on/before the window's end AND either
// ends on/after its start OR recurs (open-ended); the view decides exact days
// via occursOn().
const WINDOW_OR = (from: string) => `end_date.gte.${from},recurrence.not.is.null`;

/** My calendar in a date window: events I own/created + events I'm invited to.
 *  Two queries (PostgREST can't OR across an attendee join), merged by id. */
export async function loadMyEvents(me: string, from: string, to: string): Promise<EventRow[]> {
  const [mineRes, attendingRes] = await Promise.all([
    supabase.from('events')
      .select(`${EVENT_COLS}, ${ATTENDEE_EMBED}`)
      .or(`owner_profile_id.eq.${me},creator_id.eq.${me}`)
      .lte('start_date', to)
      .or(WINDOW_OR(from)),
    supabase.from('events')
      .select(`${EVENT_COLS}, ${ATTENDEE_EMBED}, my:event_attendees!inner(profile_id)`)
      .eq('my.profile_id', me)
      .lte('start_date', to)
      .or(WINDOW_OR(from)),
  ]);
  const byId = new Map<string, EventRow>();
  for (const row of [...((mineRes.data as unknown as EventRow[] | null) ?? []),
                     ...((attendingRes.data as unknown as EventRow[] | null) ?? [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => a.start_date.localeCompare(b.start_date));
}

/** A space calendar's events in a window (member-only via RLS). */
export async function loadSpaceEvents(spaceId: string, from: string, to: string): Promise<EventRow[]> {
  const { data } = await supabase
    .from('events')
    .select(`${EVENT_COLS}, ${ATTENDEE_EMBED}`)
    .eq('owner_space_id', spaceId)
    .lte('start_date', to)
    .or(WINDOW_OR(from))
    .order('start_date');
  return (data as unknown as EventRow[] | null) ?? [];
}

// ─── Create / delete / RSVP ───────────────────────────────────────────────────
export interface EventInput {
  ownerProfileId?: string;         // exactly one of these two
  ownerSpaceId?: string;
  title: string;
  description: string;
  location: string;
  startDate: string;
  endDate: string;
  allDay: boolean;
  startMin?: number;
  endMin?: number;
  recurrence?: Recurrence | null;
  inviteeIds: string[];
}

export async function createEvent(me: string, input: EventInput): Promise<string> {
  const recurring = !!input.recurrence;
  const { data, error } = await supabase.from('events').insert({
    creator_id: me,
    owner_profile_id: input.ownerProfileId ?? null,
    owner_space_id: input.ownerSpaceId ?? null,
    title: input.title,
    description: input.description,
    location: input.location,
    start_date: input.startDate,
    end_date: recurring ? input.startDate : input.endDate,
    all_day: input.allDay,
    start_min: input.allDay ? null : input.startMin,
    end_min: input.allDay ? null : input.endMin,
    recurrence: input.recurrence ?? null,
  }).select('id').single();
  if (error) throw error;
  const id = (data as { id: string }).id;
  if (input.inviteeIds.length) {
    const rows = input.inviteeIds.map((profile_id) => ({ event_id: id, profile_id, invited_by: me }));
    const { error: aErr } = await supabase.from('event_attendees').insert(rows);
    if (aErr) throw aErr;
  }
  return id;
}

export async function deleteEvent(id: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', id);
  if (error) throw error;
}

export async function rsvp(eventId: string, me: string, status: Exclude<RsvpStatus, 'invited'>): Promise<void> {
  const { error } = await supabase
    .from('event_attendees')
    .update({ status })
    .eq('event_id', eventId)
    .eq('profile_id', me);
  if (error) throw error;
}
