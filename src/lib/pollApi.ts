import { supabase } from './supabase';

// TIME POLLS (founder 2026-11-09) — "Google doodles, but elegantly integrated
// into the event flow". Options + votes live server-side; members vote through
// member_poll_vote, guests through their invitation token (guest_poll_vote);
// the host decides with poll_decide (or the event-poll function auto-books).

export interface PollOption { id: string; start_date: string; all_day: boolean; start_min: number | null; end_min: number | null; position: number }
export interface PollDraftOption { date: string; start: number; end: number }
export interface PollSettings { deadline: string | null; waitAll: boolean; auto: boolean; rules: string }
export interface PollVote { option_id: string; name: string; mine: boolean }

export async function createPollOptions(eventId: string, opts: PollDraftOption[], allDay: boolean): Promise<void> {
  const rows = opts.map((o, i) => ({
    event_id: eventId, start_date: o.date, all_day: allDay,
    start_min: allDay ? null : o.start, end_min: allDay ? null : o.end, position: i,
  }));
  if (!rows.length) return;
  const { error } = await supabase.from('event_time_options').insert(rows);
  if (error) throw error;
}

export async function loadPollOptions(eventId: string): Promise<PollOption[]> {
  const { data } = await supabase.from('event_time_options')
    .select('id, start_date, all_day, start_min, end_min, position')
    .eq('event_id', eventId).order('position').order('start_date');
  return (data as PollOption[] | null) ?? [];
}

/** Every vote the viewer may see (a host sees all, with names; a guest-member
 *  sees their own). */
export async function loadPollVotes(eventId: string, me: string): Promise<PollVote[]> {
  const { data } = await supabase.from('event_time_votes')
    .select('option_id, profile_id, guest_id, profile:profiles(full_name), guest:event_guests(name, email)')
    .eq('event_id', eventId);
  type Row = { option_id: string; profile_id: string | null; guest_id: string | null;
    profile: { full_name: string | null } | null; guest: { name: string | null; email: string | null } | null };
  return ((data as unknown as Row[] | null) ?? []).map((r) => ({
    option_id: r.option_id,
    name: r.profile?.full_name || r.guest?.name || r.guest?.email || 'Someone',
    mine: r.profile_id === me,
  }));
}

export async function memberPollVote(eventId: string, optionIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('member_poll_vote', { p_event: eventId, p_options: optionIds });
  if (error) throw error;
}

export async function pollDecide(eventId: string, optionId: string): Promise<void> {
  const { error } = await supabase.rpc('poll_decide', { p_event: eventId, p_option: optionId });
  if (error) throw error;
}

/** Who still owes an answer (host view): invited members + guests with no vote yet. */
export async function loadPollPending(eventId: string, creatorId: string): Promise<string[]> {
  const [a, g] = await Promise.all([
    supabase.from('event_attendees').select('profile_id, status, poll_voted_at, profile:profiles!event_attendees_profile_id_fkey(full_name)').eq('event_id', eventId),
    supabase.from('event_guests').select('name, email, status, poll_voted_at').eq('event_id', eventId),
  ]);
  type A = { profile_id: string; status: string; poll_voted_at: string | null; profile: { full_name: string | null } | null };
  type G = { name: string | null; email: string | null; status: string; poll_voted_at: string | null };
  const out: string[] = [];
  for (const r of ((a.data as unknown as A[] | null) ?? [])) if (r.profile_id !== creatorId && r.status !== 'declined' && !r.poll_voted_at) out.push(r.profile?.full_name ?? 'A member');
  for (const r of ((g.data as G[] | null) ?? [])) if (['invited', 'going', 'tentative'].includes(r.status) && !r.poll_voted_at) out.push(r.name || r.email || 'A guest');
  return out;
}

export interface GuestPollRow { option_id: string; start_date: string; all_day: boolean; start_min: number | null; end_min: number | null; picked: boolean; poll_status: string; poll_deadline: string | null; voted: boolean }
export async function guestPoll(token: string): Promise<GuestPollRow[]> {
  const { data } = await supabase.rpc('guest_poll', { p_token: token });
  return (data as GuestPollRow[] | null) ?? [];
}
export async function guestPollVote(token: string, optionIds: string[]): Promise<void> {
  const { error } = await supabase.rpc('guest_poll_vote', { p_token: token, p_options: optionIds });
  if (error) throw error;
}
