import { supabase } from './supabase';

// External event guests (founder 2026-07-23): invite non-members to an event you
// host. The guest reads/RSVPs by token (no account) via SECURITY DEFINER RPCs;
// the host manages the list under owner-only RLS.

export interface GuestEventInfo {
  guest_name: string;
  guest_status: string;
  title: string;
  description: string;
  location: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  start_min: number | null;
  end_min: number | null;
  recurrence: unknown;
  host_name: string;
}

export type GuestStatus = 'going' | 'tentative' | 'declined';

/** Guest-side: read the event by its invite token (works signed out). */
export async function loadGuestEvent(token: string): Promise<GuestEventInfo | null> {
  const { data, error } = await supabase.rpc('guest_event', { p_token: token });
  if (error) { console.warn('guest_event:', error.message); return null; }
  const rows = data as GuestEventInfo[] | null;
  return rows && rows.length ? rows[0] : null;
}

/** Guest-side: RSVP by token. */
export async function guestRsvp(token: string, status: GuestStatus): Promise<void> {
  const { error } = await supabase.rpc('guest_rsvp', { p_token: token, p_status: status });
  if (error) throw error;
}

export interface EventGuest { id: string; name: string; email: string; status: string }

/** Host-side: the external guests for an event (owner-only RLS). */
export async function loadEventGuests(eventId: string): Promise<EventGuest[]> {
  const { data, error } = await supabase.from('event_guests')
    .select('id, name, email, status').eq('event_id', eventId).order('created_at');
  if (error) { console.warn('loadEventGuests:', error.message); return []; }
  return (data as EventGuest[] | null) ?? [];
}

/** Host-side: email an outside person an invite (server mints the token). */
export async function inviteEventGuest(eventId: string, name: string, email: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-event-invite', {
    body: { event_id: eventId, name, email },
  });
  if (error) throw error;
  const err = (data as { error?: string } | null)?.error;
  if (err) throw new Error(err);
}
