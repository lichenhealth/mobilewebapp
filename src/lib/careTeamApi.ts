import { supabase } from './supabase';

// Care-team management — one implementation shared by Profile and the
// Concierge Care Team tab. Either party initiates a link; the OTHER approves.
// Non-members are invited by email (care_invitations) and claimed on signup.

export type CareStatus = 'pending' | 'active';

export interface CareLink {
  id: string;
  patient_id: string;
  caregiver_id: string;
  status: CareStatus;
  initiated_by: string;
  patientName: string;
  caregiverName: string;
}

export interface CareInvite {
  id: string;
  email: string | null;
  phone: string | null;
  role: 'caregiver' | 'patient';
}

/** THE ONE CLASSIFIER for anything typed into a care add box (founder
 *  2026-09-26: "a smart, type ahead (no copy and paste), so no errors").
 *  Found live: a pasted contact line — "galyn burke <galynburke@gmail.com>"
 *  — passed the loose email test and was stored whole, unclaimable forever.
 *  So: invisible bidi/format chars stripped (the Invite box's 09-22 lesson),
 *  the address pulled out of a "Name <email>" line, a strict email test on
 *  the extracted core, and the forgiving no-letters-and-7-digits phone read. */
export type CareContact =
  | { kind: 'email'; email: string }
  | { kind: 'phone'; digits: string; sms: string }
  | { kind: 'name'; name: string }
  | { kind: 'empty' };

export function classifyCareContact(raw: string): CareContact {
  const stripped = raw.replace(/[​-‏‪-‮⁠﻿]/g, '').trim();
  if (!stripped) return { kind: 'empty' };
  // A pasted contact line carries its address somewhere inside — "Name
  // <email>" and "Name, email" both arrived live. The first email-shaped
  // token IS the datum, whatever wrapped it.
  const emtok = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.exec(stripped);
  if (emtok) return { kind: 'email', email: emtok[0].toLowerCase() };
  const angled = /<([^<>]+)>/.exec(stripped);
  const core = (angled ? angled[1] : stripped).trim();
  const digits = core.replace(/\D/g, '');
  const phoneShaped = /^[\d\s()+.\-‐-―]{7,}$/.test(core)
    || (digits.length >= 7 && digits.length <= 16 && !/[a-zA-Z@]/.test(core));
  if (phoneShaped && digits.length >= 7 && digits.length <= 16) {
    return { kind: 'phone', digits, sms: core.replace(/[^\d+]/g, '') };
  }
  return { kind: 'name', name: stripped };
}

/** All my care links (both directions) + my pending email invitations. */
export async function loadCareLinks(): Promise<{ links: CareLink[]; invites: CareInvite[] }> {
  // turn any invitations addressed to my email into pending care connections
  await supabase.rpc('claim_care_invitations');
  const [careRes, invRes] = await Promise.all([
    supabase
      .from('care_team_members')
      .select('id, patient_id, caregiver_id, status, initiated_by, patient:profiles!care_team_members_patient_id_fkey(full_name), caregiver:profiles!care_team_members_caregiver_id_fkey(full_name)'),
    supabase
      .from('care_invitations')
      .select('id, invitee_email, invitee_phone, role')
      .eq('status', 'pending'),
  ]);
  const raw = (careRes.data as unknown as {
    id: string; patient_id: string; caregiver_id: string; status: CareStatus; initiated_by: string;
    patient: { full_name: string | null } | null; caregiver: { full_name: string | null } | null;
  }[]) ?? [];
  // Resolve display names server-side so members with no full_name fall back to
  // their email (revealed only for our own care-team counterparties).
  const ids = [...new Set(raw.flatMap((r) => [r.patient_id, r.caregiver_id]))];
  const nameMap = new Map<string, string>();
  if (ids.length) {
    const { data: disp } = await supabase.rpc('care_member_display', { p_ids: ids });
    for (const d of (disp as { id: string; display: string }[] | null) ?? []) nameMap.set(d.id, d.display);
  }
  const links = raw.map((r) => ({
    id: r.id, patient_id: r.patient_id, caregiver_id: r.caregiver_id,
    status: r.status, initiated_by: r.initiated_by,
    // || (not ??) so a blank-string name also falls through to "Member".
    patientName: nameMap.get(r.patient_id) || r.patient?.full_name || 'Member',
    caregiverName: nameMap.get(r.caregiver_id) || r.caregiver?.full_name || 'Member',
  }));
  const invites = (((invRes.data as { id: string; invitee_email: string | null; invitee_phone: string | null; role: 'caregiver' | 'patient' }[] | null) ?? [])
    .map((i) => ({ id: i.id, email: i.invitee_email, phone: i.invitee_phone, role: i.role })));
  return { links, invites };
}

/** Invite by email: existing member → pending link; non-member → standing
 *  care_invitation. Returns ok=true when the input should clear. */
export async function inviteCare(
  role: 'caregiver' | 'patient', emailRaw: string,
): Promise<{ ok: boolean; message: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  // Only a clean, extracted address is ever stored — a pasted
  // "Name <email>" line becomes the email, anything else is refused
  // honestly instead of sitting unclaimable.
  const c = classifyCareContact(emailRaw);
  if (!user || c.kind === 'empty') return { ok: false, message: '' };
  if (c.kind !== 'email') {
    return { ok: false, message: 'That doesn’t read as an email address — check it and try again.' };
  }
  const em = c.email;
  // Look up a member by exact email via a SECURITY DEFINER function. Members
  // can't read the email column directly, so this returns id + name for a
  // match (and nothing for a non-match) without exposing emails.
  const { data: foundRows } = await supabase.rpc('find_member_by_email', { p_email: em });
  const found = (foundRows as { id: string; full_name: string | null }[] | null)?.[0] ?? null;
  if (!found) {
    const { error: invErr } = await supabase.from('care_invitations')
      .insert({ inviter_id: user.id, invitee_email: em.toLowerCase(), role });
    if (invErr) {
      return {
        ok: false,
        message: /duplicate|unique/i.test(invErr.message) ? 'You already invited that email.' : invErr.message,
      };
    }
    return { ok: true, message: `Invited ${em} to Lichen — they'll join your care circle when they sign up. Use “Copy invite” to send them the link.` };
  }
  if (found.id === user.id) return { ok: false, message: 'That email is you!' };
  const row = role === 'caregiver'
    ? { patient_id: user.id, caregiver_id: found.id, initiated_by: user.id, status: 'pending' as const }
    : { patient_id: found.id, caregiver_id: user.id, initiated_by: user.id, status: 'pending' as const };
  const { error: e } = await supabase.from('care_team_members').insert(row);
  if (e) {
    return {
      ok: false,
      message: /duplicate|unique/i.test(e.message) ? 'That care connection already exists.' : e.message,
    };
  }
  return { ok: true, message: 'Request sent — pending their approval.' };
}

/** Add an EXISTING member as your caregiver by id (the type-ahead path) —
 *  a pending request they approve, same as the email flow's found-member arm. */
export async function addCareCaregiverById(caregiverId: string): Promise<{ ok: boolean; message: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in.' };
  if (caregiverId === user.id) return { ok: false, message: 'That one is you!' };
  const { error } = await supabase.from('care_team_members')
    .insert({ patient_id: user.id, caregiver_id: caregiverId, initiated_by: user.id, status: 'pending' });
  if (error) {
    return { ok: false, message: /duplicate|unique/i.test(error.message) ? 'That care connection already exists.' : error.message };
  }
  return { ok: true, message: 'Request sent — pending their approval.' };
}

export async function approveCare(id: string): Promise<void> {
  const { error } = await supabase.from('care_team_members').update({ status: 'active' }).eq('id', id);
  if (error) throw error;
}

export async function removeCare(id: string): Promise<void> {
  const { error } = await supabase.from('care_team_members').delete().eq('id', id);
  if (error) throw error;
}

export async function cancelCareInvite(id: string): Promise<void> {
  const { error } = await supabase.from('care_invitations').delete().eq('id', id);
  if (error) throw error;
}

export function careInviteText(email: string): string {
  return `Join me on Lichen — sign up with this email (${email}) and we'll be connected: https://lichen.health/signup`;
}

/** Copy the invite blurb; returns the message to show the member. */
export async function copyCareInvite(email: string): Promise<string> {
  const msg = careInviteText(email);
  try {
    await navigator.clipboard.writeText(msg);
    return 'Invite link copied — paste it into a text or email to them.';
  } catch {
    return `Copy this and send it to them: ${msg}`;
  }
}

/** Email the invite via the send-care-invite edge function (Resend). */
export async function sendCareInviteEmail(
  email: string, role: 'caregiver' | 'patient', inviterName: string,
): Promise<string> {
  const { error } = await supabase.functions.invoke('send-care-invite', {
    body: { email, role, inviterName: inviterName || 'A Lichen member' },
  });
  if (error) return 'Couldn’t send automatically yet — use Copy invite to share the link.';
  return `Invite emailed to ${email}.`;
}

export type PreparedCareText = { href: string; body: string };

/** A tokened text for a phone invite, ready to send from the inviter's own
 *  Messages — the platform Invite box's grammar (no SMS provider,
 *  deliberately; a token claims once, and a bare /signup link would drop
 *  them at the knock form instead of a real invitation). */
export async function prepareCareText(
  role: 'caregiver' | 'patient', sms: string, inviterName: string, inviteeName?: string,
): Promise<PreparedCareText> {
  let link = 'https://lichen.health/signup';
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data } = await supabase.from('invite_tokens')
      .insert({ created_by: user.id, invitee_phone: sms.replace(/\D/g, '') })
      .select('token').maybeSingle();
    const tok = (data as { token: string } | null)?.token;
    if (tok) link = `https://lichen.health/signup?invite=${tok}`;
  }
  const who = inviterName || 'A Lichen member';
  const hi = inviteeName ? `Hi ${inviteeName} — ` : '';
  const body = role === 'caregiver'
    ? `${hi}${who} invited you to join their care team on Lichen — a corrective social network for the whole of a life. Join: ${link}`
    : `${hi}${who} offered to help care for you on Lichen — a corrective social network for the whole of a life. Join: ${link}`;
  return { href: `sms:${sms}?&body=${encodeURIComponent(body)}`, body };
}

/** Invite a non-member to the care circle by PHONE (founder 2026-09-26):
 *  a standing care_invitations row (digits only — so the inviter can watch
 *  "waiting for them to sign up", and claim_care_invitations links the team
 *  against their onboarding phone) plus a prepared, tokened text. */
export async function inviteCareByPhone(
  role: 'caregiver' | 'patient', phoneRaw: string, inviterName: string, inviteeName?: string,
): Promise<{ ok: boolean; message: string; text?: PreparedCareText }> {
  const { data: { user } } = await supabase.auth.getUser();
  const c = classifyCareContact(phoneRaw);
  if (!user) return { ok: false, message: 'Not signed in.' };
  if (c.kind !== 'phone') return { ok: false, message: 'That doesn’t read as a phone number — check it and try again.' };
  const { error } = await supabase.from('care_invitations')
    .insert({ inviter_id: user.id, invitee_phone: c.digits, role });
  if (error) {
    return { ok: false, message: /duplicate|unique/i.test(error.message) ? 'You already invited that number.' : error.message };
  }
  const text = await prepareCareText(role, c.sms, inviterName, inviteeName);
  return { ok: true, message: 'Invitation ready — send it from your Messages. They’ll appear here until they join.', text };
}

/** Offer to care for someone (founder 2026-07-28): the caregiver side of the
 *  same consented handshake — they approve before anything is real. The
 *  insert trigger notifies them: "{You} wants to become a member of your
 *  care team." */
export async function offerCareFor(patientId: string): Promise<{ ok: boolean; message: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, message: 'Not signed in.' };
  if (patientId === user.id) return { ok: false, message: 'That one is you!' };
  const { error } = await supabase.from('care_team_members')
    .insert({ patient_id: patientId, caregiver_id: user.id, initiated_by: user.id, status: 'pending' });
  if (error) {
    return { ok: false, message: /duplicate|unique/i.test(error.message)
      ? 'That care connection already exists.' : error.message };
  }
  return { ok: true, message: 'Offered — they’ll approve before it’s real.' };
}
