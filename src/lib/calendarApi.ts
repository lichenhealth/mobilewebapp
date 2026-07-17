import { supabase } from './supabase';
import type { Recurrence } from './recurrence';

// ─── Types ────────────────────────────────────────────────────────────────────
export type RsvpStatus = 'invited' | 'going' | 'tentative' | 'declined';

export interface EventAttendee {
  profile_id: string;
  status: RsvpStatus;
  profile?: { full_name: string | null; avatar_url?: string | null } | null;
}

export interface EventRow {
  id: string;
  creator_id: string;
  owner_profile_id: string | null;
  owner_space_id: string | null;
  title: string;
  description: string;
  location: string;
  lat: number | null;              // set when the composer's autocomplete was picked
  lng: number | null;
  start_date: string;              // yyyy-mm-dd, local
  end_date: string;
  all_day: boolean;
  start_min: number | null;        // minutes since local midnight
  end_min: number | null;
  recurrence: Recurrence | null;
  created_at: string;
  attendees?: EventAttendee[];
  /** Synthetic row imported from an external calendar (owner's view only). */
  external?: boolean;
}

const EVENT_COLS =
  'id, creator_id, owner_profile_id, owner_space_id, title, description, location, lat, lng, ' +
  'start_date, end_date, all_day, start_min, end_min, recurrence, created_at';
// event_attendees has TWO FKs to profiles (profile_id + invited_by) — the
// embed must name the one it means (house rule; see CLAUDE.md).
const ATTENDEE_EMBED =
  'attendees:event_attendees(profile_id, status, profile:profiles!event_attendees_profile_id_fkey(full_name, avatar_url))';

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
  if (mineRes.error) console.warn('loadMyEvents (mine):', mineRes.error.message);
  if (attendingRes.error) console.warn('loadMyEvents (attending):', attendingRes.error.message);
  const byId = new Map<string, EventRow>();
  for (const row of [...((mineRes.data as unknown as EventRow[] | null) ?? []),
                     ...((attendingRes.data as unknown as EventRow[] | null) ?? [])]) {
    byId.set(row.id, row);
  }
  return [...byId.values()].sort((a, b) => a.start_date.localeCompare(b.start_date));
}

/** A space calendar's events in a window (member-only via RLS). */
export async function loadSpaceEvents(spaceId: string, from: string, to: string): Promise<EventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select(`${EVENT_COLS}, ${ATTENDEE_EMBED}`)
    .eq('owner_space_id', spaceId)
    .lte('start_date', to)
    .or(WINDOW_OR(from))
    .order('start_date');
  if (error) console.warn('loadSpaceEvents:', error.message);
  return (data as unknown as EventRow[] | null) ?? [];
}

// ─── Create / delete / RSVP ───────────────────────────────────────────────────
export interface EventInput {
  ownerProfileId?: string;         // exactly one of these two
  ownerSpaceId?: string;
  title: string;
  description: string;
  location: string;
  lat?: number | null;             // from a picked LocationField suggestion
  lng?: number | null;
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
    lat: input.lat ?? null,
    lng: input.lng ?? null,
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

/** One event with attendees (for the edit screen). */
export async function loadEvent(id: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('events')
    .select(`${EVENT_COLS}, ${ATTENDEE_EMBED}`)
    .eq('id', id)
    .maybeSingle();
  if (error) console.warn('loadEvent:', error.message);
  return (data as unknown as EventRow | null) ?? null;
}

/** Update ONLY the event's own fields — attendees and owner untouched.
 *  (updateEvent below syncs invitees, so handing it an empty list would wipe
 *  the guest list and everyone's RSVPs; Compose's event editing must not.) */
export async function updateEventDetails(
  id: string,
  input: Pick<EventInput, 'title' | 'description' | 'location' | 'lat' | 'lng' | 'startDate' | 'endDate' | 'allDay' | 'startMin' | 'endMin'>,
): Promise<void> {
  const { error } = await supabase.from('events').update({
    title: input.title,
    description: input.description,
    location: input.location,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    start_date: input.startDate,
    end_date: input.endDate,
    all_day: input.allDay,
    start_min: input.allDay ? null : input.startMin,
    end_min: input.allDay ? null : input.endMin,
  }).eq('id', id);
  if (error) throw error;
}

/** Update an event in place and sync invitees: newly added people are invited
 *  (their notification fires via the DB trigger), removed people are uninvited,
 *  everyone kept keeps their RSVP status. */
export async function updateEvent(me: string, id: string, input: EventInput): Promise<void> {
  const recurring = !!input.recurrence;
  const { error } = await supabase.from('events').update({
    owner_profile_id: input.ownerProfileId ?? null,
    owner_space_id: input.ownerSpaceId ?? null,
    title: input.title,
    description: input.description,
    location: input.location,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    start_date: input.startDate,
    end_date: recurring ? input.startDate : input.endDate,
    all_day: input.allDay,
    start_min: input.allDay ? null : input.startMin,
    end_min: input.allDay ? null : input.endMin,
    recurrence: input.recurrence ?? null,
  }).eq('id', id);
  if (error) throw error;

  const { data: curRows } = await supabase
    .from('event_attendees').select('profile_id').eq('event_id', id);
  const current = new Set(((curRows as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id));
  const wanted = new Set(input.inviteeIds);
  const toAdd = input.inviteeIds.filter((p) => !current.has(p));
  const toRemove = [...current].filter((p) => !wanted.has(p));
  if (toAdd.length) {
    const { error: aErr } = await supabase.from('event_attendees')
      .insert(toAdd.map((profile_id) => ({ event_id: id, profile_id, invited_by: me })));
    if (aErr) throw aErr;
  }
  if (toRemove.length) {
    const { error: rErr } = await supabase.from('event_attendees')
      .delete().eq('event_id', id).in('profile_id', toRemove);
    if (rErr) throw rErr;
  }
}

export async function rsvp(eventId: string, me: string, status: Exclude<RsvpStatus, 'invited'>): Promise<void> {
  const { error } = await supabase
    .from('event_attendees')
    .update({ status })
    .eq('event_id', eventId)
    .eq('profile_id', me);
  if (error) throw error;
}

// ─── Availability windows (declared hours; kind 'on_call' feeds Concierge) ───
export type AvailabilityKind = 'available' | 'on_call';
export interface AvailabilityWindow {
  id: string;
  profile_id: string;
  weekday: number;          // 0=Mon … 6=Sun (matches recurrence.ts)
  start_min: number;
  end_min: number;
  kind: AvailabilityKind;
  valid_from: string | null;
  valid_to: string | null;
}

export async function loadMyAvailability(me: string): Promise<AvailabilityWindow[]> {
  const { data, error } = await supabase
    .from('availability_windows')
    .select('id, profile_id, weekday, start_min, end_min, kind, valid_from, valid_to')
    .eq('profile_id', me)
    .order('weekday').order('start_min');
  if (error) console.warn('loadMyAvailability:', error.message);
  return (data as AvailabilityWindow[] | null) ?? [];
}

export async function addAvailability(me: string, w: { weekday: number; startMin: number; endMin: number; kind: AvailabilityKind }): Promise<void> {
  const { error } = await supabase.from('availability_windows')
    .insert({ profile_id: me, weekday: w.weekday, start_min: w.startMin, end_min: w.endMin, kind: w.kind });
  if (error) throw error;
}

export async function deleteAvailability(id: string): Promise<void> {
  const { error } = await supabase.from('availability_windows').delete().eq('id', id);
  if (error) throw error;
}

// ─── Visibility rules (who sees my calendar; most-specific wins) ─────────────
export type ShareLevel = 'hidden' | 'busy' | 'details';
export interface ShareRule {
  id: string;
  audience_type: 'everyone' | 'space' | 'profile';
  audience_space_id: string | null;
  audience_profile_id: string | null;
  level: ShareLevel;
  space?: { name: string } | null;
  profile?: { full_name: string | null } | null;
}

export async function loadMyShares(me: string): Promise<ShareRule[]> {
  const { data, error } = await supabase
    .from('calendar_shares')
    .select('id, audience_type, audience_space_id, audience_profile_id, level, space:spaces(name), profile:profiles!calendar_shares_audience_profile_id_fkey(full_name)')
    .eq('owner_id', me)
    .order('created_at');
  if (error) console.warn('loadMyShares:', error.message);
  return (data as unknown as ShareRule[] | null) ?? [];
}

export async function upsertShare(
  me: string,
  audience: { type: 'everyone' } | { type: 'space'; spaceId: string } | { type: 'profile'; profileId: string },
  level: ShareLevel,
): Promise<void> {
  const row = {
    owner_id: me,
    audience_type: audience.type,
    audience_space_id: audience.type === 'space' ? audience.spaceId : null,
    audience_profile_id: audience.type === 'profile' ? audience.profileId : null,
    level,
  };
  // Delete-then-insert keeps the "one rule per audience" unique index simple.
  let del = supabase.from('calendar_shares').delete().eq('owner_id', me).eq('audience_type', audience.type);
  if (audience.type === 'space') del = del.eq('audience_space_id', audience.spaceId);
  if (audience.type === 'profile') del = del.eq('audience_profile_id', audience.profileId);
  await del;
  const { error } = await supabase.from('calendar_shares').insert(row);
  if (error) throw error;
}

export async function deleteShare(id: string): Promise<void> {
  const { error } = await supabase.from('calendar_shares').delete().eq('id', id);
  if (error) throw error;
}

// ─── Group availability (find-a-time) ─────────────────────────────────────────
/** Sanitized event fragment from the free_busy RPC — satisfies Schedulable, so
 *  the client expands recurrence with occursOn(). */
export interface FreeBusyRow {
  profile_id: string;
  level: Exclude<ShareLevel, 'hidden'>;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_min: number | null;
  end_min: number | null;
  recurrence: import('./recurrence').Recurrence | null;
  title: string | null;   // only at 'details'
}

export async function freeBusy(profileIds: string[], from: string, to: string): Promise<FreeBusyRow[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await supabase.rpc('free_busy', { p_profiles: profileIds, p_from: from, p_to: to });
  if (error) console.warn('freeBusy:', error.message);
  return (data as FreeBusyRow[] | null) ?? [];
}

export interface MemberWindow {
  profile_id: string; weekday: number; start_min: number; end_min: number;
  kind: AvailabilityKind; valid_from: string | null; valid_to: string | null;
}
export async function availabilityOf(profileIds: string[]): Promise<MemberWindow[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await supabase.rpc('availability_of', { p_profiles: profileIds });
  if (error) console.warn('availabilityOf:', error.message);
  return (data as MemberWindow[] | null) ?? [];
}

// ─── External calendars (secret iCal import — calendar thread 7a) ────────────
// A member pastes their Google/Apple/Outlook secret iCal URL; the
// sync-external-calendar edge function expands it into per-day busy blocks
// (external_busy) which free_busy() unions in. Titles are owner-only.

export interface ExternalCalendar {
  id: string;
  name: string;
  url: string;
  last_synced_at: string | null;
  last_error: string | null;
  event_count: number;
}

export async function listExternalCalendars(me: string): Promise<ExternalCalendar[]> {
  const { data, error } = await supabase
    .from('external_calendars')
    .select('id, name, url, last_synced_at, last_error, event_count')
    .eq('profile_id', me)
    .order('created_at');
  if (error) { console.warn('listExternalCalendars:', error.message); return []; }
  return (data as ExternalCalendar[] | null) ?? [];
}

export async function addExternalCalendar(me: string, name: string, url: string): Promise<void> {
  const { error } = await supabase.from('external_calendars')
    .insert({ profile_id: me, name: name.trim() || 'Calendar', url: url.trim() });
  if (error) throw error;
}

export async function removeExternalCalendar(id: string): Promise<void> {
  const { error } = await supabase.from('external_calendars').delete().eq('id', id);
  if (error) throw error;
}

/** Ask the edge function to refresh imported busy blocks. Fire-and-forget on
 *  Calendar load (the function skips calendars synced <30 min ago); pass
 *  force for the settings "Sync now" button. */
export async function syncExternalCalendars(opts: { force?: boolean; calendarId?: string } = {}): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { error } = await supabase.functions.invoke('sync-external-calendar', {
    body: { timezone, ...opts },
  });
  if (error) throw error;
}

export interface ExternalBusyRow {
  id: string;
  calendar_id: string;
  on_date: string;
  all_day: boolean;
  start_min: number | null;
  end_min: number | null;
  title: string | null;
}

/** The owner's own imported blocks (titles included) for the calendar grid. */
export async function loadMyExternalBusy(me: string, from: string, to: string): Promise<ExternalBusyRow[]> {
  const { data, error } = await supabase
    .from('external_busy')
    .select('id, calendar_id, on_date, all_day, start_min, end_min, title')
    .eq('profile_id', me)
    .gte('on_date', from)
    .lte('on_date', to);
  if (error) { console.warn('loadMyExternalBusy:', error.message); return []; }
  return (data as ExternalBusyRow[] | null) ?? [];
}
