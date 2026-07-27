import { supabase } from './supabase';

// ROOMS & THINGS (founder 2026-07-27): spaces and people steward bookable
// resources — the pavilion, the dinner plates, your truck. A resource has a
// calendar the way a person does; free/busy is visible to anyone who can see
// it, WHO booked is not (identity reveals only inside a DM the asker opens).
// Everything degrades gracefully before migration 20260830120000 runs.

export interface ResourceRow {
  id: string;
  space_id: string | null;
  owner_profile_id: string | null;
  name: string;
  kind: 'room' | 'thing';
  description: string | null;
  photo_url: string | null;
  bookable: boolean;
  approval: 'request' | 'instant';
}

export interface ResourceBusySpan {
  start_date: string; end_date: string;
  start_min: number | null; end_min: number | null;
}

export interface ResourceBookingRow {
  id: string;
  resource_id: string;
  requester_id: string;
  start_date: string; end_date: string;
  note: string | null;
  status: string;
  requester?: { full_name: string | null } | null;
  resource?: { name: string } | null;
}

export async function listSpaceResources(spaceId: string): Promise<ResourceRow[]> {
  const { data, error } = await supabase.from('resources')
    .select('*').eq('space_id', spaceId).order('created_at');
  if (error) return [];
  return (data as ResourceRow[] | null) ?? [];
}

export async function createResource(fields: {
  space_id?: string; owner_profile_id?: string;
  name: string; kind: 'room' | 'thing'; description?: string;
  bookable?: boolean; approval?: 'request' | 'instant';
}): Promise<void> {
  const { error } = await supabase.from('resources').insert(fields);
  if (error) throw error;
}

export async function deleteResource(id: string): Promise<void> {
  const { error } = await supabase.from('resources').delete().eq('id', id);
  if (error) throw error;
}

export async function resourceBusy(id: string): Promise<ResourceBusySpan[]> {
  const { data, error } = await supabase.rpc('resource_busy', { p_resource: id });
  if (error) return [];
  return (data as ResourceBusySpan[] | null) ?? [];
}

export async function requestResourceBooking(
  resourceId: string, start: string, end: string, note: string,
): Promise<void> {
  const { error } = await supabase.rpc('request_resource_booking', {
    p_resource: resourceId, p_start: start, p_end: end,
    p_note: note.trim() || null,
  });
  if (error) throw error;
}

/** Steward queue: pending asks on a space's rooms & things. */
export async function listPendingResourceBookings(spaceId: string): Promise<ResourceBookingRow[]> {
  const { data, error } = await supabase.from('resource_bookings')
    .select('id, resource_id, requester_id, start_date, end_date, note, status, requester:profiles!resource_bookings_requester_id_fkey(full_name), resource:resources!resource_bookings_resource_id_fkey(name, space_id)')
    .eq('status', 'pending')
    .eq('resource.space_id', spaceId)
    .order('created_at');
  if (error) return [];
  // The embed filter leaves non-matching rows with a null resource — drop them.
  return (((data as unknown as (ResourceBookingRow & { resource: { name: string; space_id: string } | null })[] | null) ?? [])
    .filter((r) => r.resource));
}

export async function decideResourceBooking(id: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc('decide_resource_booking', { p_booking: id, p_approve: approve });
  if (error) throw error;
}

/** Who holds a confirmed span — the deliberate "message who booked it" door. */
export async function resourceSpanContact(resourceId: string, date: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('resource_span_contact', { p_resource: resourceId, p_date: date });
  if (error) return null;
  return (data as string | null);
}
