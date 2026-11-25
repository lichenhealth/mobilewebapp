import { supabase } from './supabase';
import { call } from './mailApi';

/** CONNECTIONS (founder 2026-11-24): a member's own links to outside services
 *  their Brain can work with. Keys are pasted once into Lichen's form,
 *  checked with the service by service-connect, and never shown again. */

export type ServiceConnection = { id: string; service: 'twilio'; label: string | null; status: 'connected' | 'error'; last_error: string | null; connected_at: string };
export type TwilioNumber = { number: string; name: string; sms: boolean; voice: boolean; added: string; wired?: boolean };
export type AssistantWatch = {
  id: string; kind: 'mail' | 'twilio_number' | 'important' | 'wish'; label: string; query: string; then_note: string | null;
  status: 'active' | 'fired' | 'cancelled' | 'expired'; created_at: string; expires_at: string;
  fired_at: string | null; fired_detail: string | null; convo_id: string | null;
};

export async function listConnections(): Promise<ServiceConnection[]> {
  const { data } = await supabase.from('service_connections').select('id, service, label, status, last_error, connected_at');
  return (data as ServiceConnection[] | null) ?? [];
}

export async function connectTwilio(accountSid: string, keySid: string, keySecret: string): Promise<{ label: string; numbers: TwilioNumber[] }> {
  return call('service-connect', { action: 'connect', service: 'twilio', account_sid: accountSid, key_sid: keySid, key_secret: keySecret });
}

export async function twilioStatus(): Promise<{ connected: boolean; numbers?: TwilioNumber[] }> {
  return call('service-connect', { action: 'status', service: 'twilio' });
}

/** Point a number's calls (ring your cell, then voicemail) and texts at Lichen. */
export async function wireTwilioNumber(number: string): Promise<void> {
  await call('service-connect', { action: 'wire', service: 'twilio', number });
}

export async function disconnectService(service: 'twilio'): Promise<void> {
  await call('service-connect', { action: 'disconnect', service });
}

export async function listWatches(): Promise<AssistantWatch[]> {
  const { data } = await supabase.from('assistant_watches')
    .select('id, kind, label, query, then_note, status, created_at, expires_at, fired_at, fired_detail, convo_id')
    .in('status', ['active', 'fired']).order('created_at', { ascending: false }).limit(30);
  return (data as AssistantWatch[] | null) ?? [];
}

/** THE IMPORTANT-MAIL WATCH (founder 2026-11-24) — the manual switch; the
 *  Brain's watch_for kind "important" is the same row. One per member. */
export async function startImportantWatch(): Promise<void> {
  const { error } = await supabase.rpc('start_important_watch');
  if (error) throw new Error(error.message);
}

export async function stopWatch(id: string): Promise<void> {
  const { error } = await supabase.from('assistant_watches').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw new Error(error.message);
}

/** SUGGEST A SERVICE (founder 2026-11-24): a member asks Lichen to connect a
 *  service it doesn't yet; the platform stewards are belled and answer. */
export type ConnectionSuggestion = {
  id: string; profile_id: string; service: string; why: string | null;
  status: 'new' | 'planned' | 'built' | 'declined'; created_at: string; decided_at: string | null;
  who?: string | null;
};

export async function suggestConnection(service: string, why: string): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Sign in first.');
  const { error } = await supabase.from('connection_suggestions')
    .insert({ profile_id: u.user.id, service: service.trim(), why: why.trim() || null });
  if (error) throw new Error(error.message);
}

/** Own suggestions — or, for platform admins, everyone's (RLS decides). */
export async function listConnectionSuggestions(): Promise<ConnectionSuggestion[]> {
  const { data } = await supabase.from('connection_suggestions')
    .select('id, profile_id, service, why, status, created_at, decided_at, who:profiles!connection_suggestions_profile_id_fkey(full_name)')
    .order('created_at', { ascending: false }).limit(60);
  return ((data ?? []) as unknown as (ConnectionSuggestion & { who: { full_name: string | null } | null })[])
    .map((r) => ({ ...r, who: r.who?.full_name ?? null }));
}

export async function decideConnectionSuggestion(id: string, status: ConnectionSuggestion['status']): Promise<void> {
  const { error } = await supabase.rpc('decide_connection_suggestion', { p_id: id, p_status: status });
  if (error) throw new Error(error.message);
}
