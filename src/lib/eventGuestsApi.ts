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
  /** The linked door-post — a signed-in MEMBER opens the real event page
   *  from here ("if you are [a member], it auto fills your info"). */
  post_id: string | null;
  /** The event post's cover photo — what makes the invite pretty. */
  photo_url: string | null;
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

export interface EventGuest {
  id: string; name: string; email: string | null; phone: string | null;
  token: string; status: string;
}

/** Host-side: the external guests for an event (owner-only RLS). The token
 *  rides along so a PHONE row's "Text again ›" can rebuild the same sms —
 *  one token per person, it never re-mints. */
export async function loadEventGuests(eventId: string): Promise<EventGuest[]> {
  const { data, error } = await supabase.from('event_guests')
    .select('id, name, email, phone, token, status').eq('event_id', eventId).order('created_at');
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

/** Host-side PHONE invite (founder 2026-11-04, the Invite-to-Lichen
 *  pattern): mint the tokened guest row — the tightened RLS lets only the
 *  event's own creator insert — and the HOST texts the link from their own
 *  Messages. No SMS provider, by standing doctrine. Returns the token. */
export async function inviteEventGuestByPhone(eventId: string, name: string, phone: string): Promise<string> {
  const { data: u } = await supabase.auth.getUser();
  const me = u.user?.id;
  if (!me) throw new Error('Not signed in');
  const { data, error } = await supabase.from('event_guests')
    .insert({ event_id: eventId, invited_by: me, name: name.trim(), phone })
    .select('token').single();
  if (error) throw error;
  return (data as { token: string }).token;
}

/** The invite text a phone guest gets — short, tokened, sent from the
 *  host's own phone. `sms` is the cleaned +digits number. */
export function eventInviteSmsHref(sms: string, hostName: string, title: string, when: string, token: string): { href: string; body: string } {
  const body = `${hostName} invited you to "${title}" — ${when}. Details, RSVP & add it to your calendar (no account needed): https://lichen.health/e/${token}`;
  return { href: `sms:${sms}?&body=${encodeURIComponent(body)}`, body };
}
