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
  /** Whose wall clock the times are (IANA). */
  event_tz?: string | null;
  /** This guest's saved RSVP extras (null until they answer). */
  guest_plus_ones?: number | null;
  guest_meal?: string | null;
  guest_answers?: { q: string; a: string }[] | null;
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
export type OpenEventInfo = Omit<GuestEventInfo, 'guest_name' | 'guest_status' | 'guest_plus_ones' | 'guest_meal' | 'guest_answers'>;

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
export interface RsvpExtras { plus_ones: number; meal: string | null; answers: { q: string; a: string }[] }
export async function guestRsvp(token: string, status: GuestStatus, extras?: RsvpExtras): Promise<void> {
  const { error } = await supabase.rpc('guest_rsvp', {
    p_token: token, p_status: status,
    p_plus_ones: extras ? extras.plus_ones : null,
    p_meal: extras ? extras.meal : null,
    p_answers: extras ? extras.answers : null,
  });
  if (error) throw error;
}

/** Guest page: say the invitation was opened (the host's per-guest view). */
export async function markGuestOpened(token: string): Promise<void> {
  await supabase.rpc('mark_guest_opened', { p_token: token });
}

/** Guest page: the host's messages to everyone, newest first. */
export async function loadGuestMessages(token: string): Promise<{ body: string; author_name: string; created_at: string }[]> {
  const { data, error } = await supabase.rpc('guest_event_messages', { p_token: token });
  if (error) return [];
  return (data as { body: string; author_name: string; created_at: string }[] | null) ?? [];
}

export interface EventGuest {
  id: string; name: string; email: string | null; phone: string | null;
  token: string; status: string;
  send_at?: string | null; emailed_at?: string | null;
  opened_at?: string | null; last_opened_at?: string | null; responded_at?: string | null;
}

// ── THE HOST'S SIDE OF THE REPLIES (2026-11-08) ─────────────────────────
export interface ExtrasRow { id: string; profile_id: string | null; guest_id: string | null; plus_ones: number; meal: string | null; answers: { q: string; a: string }[] }
/** Hosts: every reply's extras for the event (RLS: hosts see all, others their own). */
export async function loadRsvpExtras(eventId: string): Promise<ExtrasRow[]> {
  const { data, error } = await supabase.from('event_rsvp_extras')
    .select('id, profile_id, guest_id, plus_ones, meal, answers').eq('event_id', eventId);
  if (error) { console.warn('loadRsvpExtras:', error.message); return []; }
  return (data as ExtrasRow[] | null) ?? [];
}
/** A member saves their own extras alongside their RSVP. */
export async function saveMyRsvpExtras(eventId: string, me: string, x: RsvpExtras): Promise<void> {
  const { error } = await supabase.from('event_rsvp_extras')
    .upsert({ event_id: eventId, profile_id: me, plus_ones: x.plus_ones, meal: x.meal, answers: x.answers },
      { onConflict: 'event_id,profile_id' });
  if (error) throw error;
}

/** Host messages: write the row (RLS: hosts only; members are belled by
 *  trigger), then ask the edge fn to mail every emailed guest. */
export async function sendHostMessage(eventId: string, me: string, body: string): Promise<{ sent: number }> {
  const { data, error } = await supabase.from('event_messages')
    .insert({ event_id: eventId, author_id: me, body: body.trim() }).select('id').single();
  if (error) throw error;
  const { data: r, error: e2 } = await supabase.functions.invoke('send-event-invite', { body: { announce: (data as { id: string }).id } });
  if (e2) throw e2;
  return { sent: (r as { sent?: number } | null)?.sent ?? 0 };
}
export async function loadHostMessages(eventId: string): Promise<{ id: string; body: string; created_at: string; author_id: string }[]> {
  const { data } = await supabase.from('event_messages')
    .select('id, body, created_at, author_id').eq('event_id', eventId).order('created_at', { ascending: false }).limit(20);
  return (data as { id: string; body: string; created_at: string; author_id: string }[] | null) ?? [];
}

/** Co-hosts. Only the creator adds/removes; a co-host may step down. */
export async function loadCohosts(eventId: string): Promise<{ profile_id: string; name: string; avatar_url: string | null }[]> {
  const { data } = await supabase.from('event_cohosts')
    .select('profile_id, profile:profiles!event_cohosts_profile_id_fkey(full_name, avatar_url)').eq('event_id', eventId).order('created_at');
  return ((data as unknown as { profile_id: string; profile: { full_name: string | null; avatar_url: string | null } | null }[] | null) ?? [])
    .map((r) => ({ profile_id: r.profile_id, name: r.profile?.full_name ?? 'Member', avatar_url: r.profile?.avatar_url ?? null }));
}
export async function addCohost(eventId: string, me: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('event_cohosts').insert({ event_id: eventId, profile_id: profileId, added_by: me });
  if (error && error.code !== '23505') throw error;
}
export async function removeCohost(eventId: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('event_cohosts').delete().eq('event_id', eventId).eq('profile_id', profileId);
  if (error) throw error;
}

/** Host-side: the external guests for an event (owner-only RLS). The token
 *  rides along so a PHONE row's "Text again ›" can rebuild the same sms —
 *  one token per person, it never re-mints. */
export async function loadEventGuests(eventId: string): Promise<EventGuest[]> {
  const { data, error } = await supabase.from('event_guests')
    .select('id, name, email, phone, token, status, send_at, emailed_at, opened_at, last_opened_at, responded_at').eq('event_id', eventId).order('created_at');
  if (error) { console.warn('loadEventGuests:', error.message); return []; }
  return (data as EventGuest[] | null) ?? [];
}

/** Host-side: email an outside person an invite (server mints the token). */
export async function inviteEventGuest(eventId: string, name: string, email: string, sendAt?: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-event-invite', {
    body: { event_id: eventId, name, email, ...(sendAt ? { send_at: sendAt } : {}) },
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
