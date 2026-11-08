import { supabase } from './supabase';

// CONFIRM, WITH AN ALWAYS-ALLOW (founder 2026-11-08). A proposal is a row the
// assistant wrote; the PERSON's tap runs it (confirm_assistant_proposal), and
// Always allow stores a standing allowance for that kind of act. Allowances
// are listed — and revoked — in Profile → Privacy.

export type ProposalKind = 'send_currentcy' | 'trust' | 'recommend' | 'weave' | 'join_space' | 'leave_space';

export interface Proposal {
  id: string; kind: ProposalKind; summary: string; amount: number | null;
  status: 'pending' | 'held' | 'done' | 'cancelled' | 'failed';
  execute_after: string | null; result: string | null;
}

export const ALLOWANCE_LABELS: Record<ProposalKind, string> = {
  send_currentcy: 'Send Current-cy for me',
  trust: 'Trust people and spaces for me',
  recommend: 'Recommend for me',
  weave: 'Weave into my web for me',
  join_space: 'Ask to join communities and groups for me',
  leave_space: 'Leave communities and groups for me',
};

/** The ceilings under the money allowance (founder 2026-11-08). */
export const MONEY_CEILING_NOTE = 'Purchases over ⚡100, or more than ⚡300 in a day, will still ask you first.';

export async function loadProposals(ids: string[]): Promise<Record<string, Proposal>> {
  if (!ids.length) return {};
  const { data } = await supabase.from('assistant_proposals')
    .select('id, kind, summary, amount, status, execute_after, result').in('id', ids);
  const out: Record<string, Proposal> = {};
  ((data as Proposal[] | null) ?? []).forEach((p) => { out[p.id] = p; });
  return out;
}

export async function confirmProposal(id: string, always: boolean): Promise<{ status: string; result?: string; execute_after?: string }> {
  const { data, error } = await supabase.rpc('confirm_assistant_proposal', { p_id: id, p_always: always });
  if (error) throw new Error(error.message);
  return data as { status: string; result?: string; execute_after?: string };
}

export async function cancelProposal(id: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_assistant_proposal', { p_id: id });
  if (error) throw new Error(error.message);
}

export async function listAllowances(me: string): Promise<{ kind: ProposalKind; created_at: string }[]> {
  const { data } = await supabase.from('assistant_allowances')
    .select('kind, created_at').eq('profile_id', me).order('created_at');
  return (data as { kind: ProposalKind; created_at: string }[] | null) ?? [];
}

export async function revokeAllowance(me: string, kind: ProposalKind): Promise<void> {
  const { error } = await supabase.from('assistant_allowances').delete().eq('profile_id', me).eq('kind', kind);
  if (error) throw new Error(error.message);
}
