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
  /** The host's invitation design (posts.details.invite) — the Studio. */
  invite: unknown;
}

export type GuestStatus = 'going' | 'tentative' | 'declined';

/** Guest-side: read the event by its invite token (works signed out). */
export async function loadGuestEvent(token: string): Promise<GuestEventInfo | null> {
  const { data, error } = await supabase.rpc('guest_event', { p_token: token });
  if (error) { console.warn('guest_event:', error.message); return null; }
  const rows = data as GuestEventInfo[] | null;
  return rows && rows.length ? rows[0] : null;
}

// ── THE OPEN EVENT URL (founder 2026-11-04: "An Event URL is really
// handy… if you're not also on an invite list, the request to attend
// prompts an approval from the host") ────────────────────────────────────

/** The same event shape, minus the guest fields, by the event's own
 *  shareable LINK token. */
export type OpenEventInfo = Omit<GuestEventInfo, 'guest_name' | 'guest_status'>;

/** Open-link landing: the event by its shareable token (anon-callable). */
export async function loadOpenEvent(linkToken: string): Promise<OpenEventInfo | null> {
  const { data, error } = await supabase.rpc('open_event', { p_link: linkToken });
  if (error) { console.warn('open_event:', error.message); return null; }
  const rows = data as OpenEventInfo[] | null;
  return rows && rows.length ? rows[0] : null;
}

/** Ask to come via the open link. A contact already ON the invite list is
 *  recognized and handed their own standing token (on_list true); an
 *  unknown person becomes a 'requested' row the host approves. */
export async function requestEventSpot(
  linkToken: string, name: string, contact: { email?: string; phone?: string },
): Promise<{ on_list: boolean; token: string }> {
  const { data, error } = await supabase.rpc('request_event_spot', {
    p_link: linkToken, p_name: name,
    p_email: contact.email ?? null, p_phone: contact.phone ?? null,
  });
  if (error) throw error;
  return data as { on_list: boolean; token: string };
}

/** Host-side: mint (or rotate — the kill switch for a leaked link) the
 *  event's shareable URL token. */
export async function mintEventLink(eventId: string, rotate = false): Promise<string> {
  const { data, error } = await supabase.rpc('mint_event_link', { p_event: eventId, p_rotate: rotate });
  if (error) throw error;
  return data as string;
}

/** Host-side: approve a link-born request — the row flips to going (the
 *  host policy's UPDATE covers it), and an email guest gets the "you're
 *  in" mail (a phone guest gets texted via the row's Text › door). */
export async function approveEventGuest(g: EventGuest): Promise<void> {
  const { error } = await supabase.from('event_guests')
    .update({ status: 'going' }).eq('id', g.id);
  if (error) throw error;
  if (g.email) {
    const { data, error: e2 } = await supabase.functions.invoke('send-event-invite', {
      body: { guest_id: g.id },
    });
    if (e2) throw e2;
    const err = (data as { error?: string } | null)?.error;
    if (err) throw new Error(err);
  }
}

/** Host-side: a request that isn't a fit — the row goes; a pest can
 *  re-ask, and the rotate above is the real kill switch. */
export async function declineEventGuest(id: string): Promise<void> {
  const { error } = await supabase.from('event_guests').delete().eq('id', id);
  if (error) throw error;
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
