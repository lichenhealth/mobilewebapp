import { supabase } from './supabase';
import { call } from './mailApi';

/** CONNECTIONS (founder 2026-11-24): a member's own links to outside services
 *  their Brain can work with. Keys are pasted once into Lichen's form,
 *  checked with the service by service-connect, and never shown again. */

export type ServiceConnection = { id: string; service: 'twilio'; label: string | null; status: 'connected' | 'error'; last_error: string | null; connected_at: string };
export type TwilioNumber = { number: string; name: string; sms: boolean; voice: boolean; added: string };
export type AssistantWatch = {
  id: string; kind: 'mail' | 'twilio_number'; label: string; query: string; then_note: string | null;
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

export async function disconnectService(service: 'twilio'): Promise<void> {
  await call('service-connect', { action: 'disconnect', service });
}

export async function listWatches(): Promise<AssistantWatch[]> {
  const { data } = await supabase.from('assistant_watches')
    .select('id, kind, label, query, then_note, status, created_at, expires_at, fired_at, fired_detail, convo_id')
    .in('status', ['active', 'fired']).order('created_at', { ascending: false }).limit(30);
  return (data as AssistantWatch[] | null) ?? [];
}

export async function stopWatch(id: string): Promise<void> {
  const { error } = await supabase.from('assistant_watches').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw new Error(error.message);
}
