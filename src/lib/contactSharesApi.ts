import { supabase } from './supabase';

// PER-GROUP CONTACT PERMISSION (founder 2026-11-06). Each member chooses,
// per space, who there may see their email and their phone. No row = nobody.
export type ShareLevel = 'nobody' | 'stewards' | 'members';
export type ContactShare = { space_id: string; email_level: ShareLevel; phone_level: ShareLevel };

export const SHARE_LABEL: Record<ShareLevel, string> = {
  nobody: 'Nobody',
  stewards: 'Stewards only',
  members: 'Everyone in the group',
};

export async function loadMyContactShares(me: string): Promise<Map<string, ContactShare>> {
  const { data } = await supabase.from('contact_shares')
    .select('space_id, email_level, phone_level').eq('profile_id', me);
  return new Map(((data as ContactShare[] | null) ?? []).map((r) => [r.space_id, r]));
}

export async function setContactShare(me: string, spaceId: string, email: ShareLevel, phone: ShareLevel) {
  const { error } = await supabase.from('contact_shares').upsert(
    { profile_id: me, space_id: spaceId, email_level: email, phone_level: phone, updated_at: new Date().toISOString() },
    { onConflict: 'profile_id,space_id' });
  if (error) throw error;
}

export type MemberContact = {
  profile_id: string; full_name: string | null; handle: string | null; role: string;
  email: string | null; phone: string | null; shared: boolean;
};

/** The member list as the caller may see it — contact details only where
 *  each member's own level admits the caller (enforced server-side). */
export async function loadSpaceMemberContacts(spaceId: string): Promise<MemberContact[]> {
  const { data, error } = await supabase.rpc('space_member_contacts', { p_space: spaceId });
  if (error) throw error;
  return (data as MemberContact[] | null) ?? [];
}
