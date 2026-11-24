// TWILIO, FOR ONE MEMBER (founder 2026-11-24: "let's do that for twilio").
// A member connects their OWN Twilio account by pasting an API key into
// Profile → Connections (service-connect checks it against Twilio before it
// is stored). Keys live in service_secrets (RLS on, no policies) and are only
// ever used for the member they belong to — every helper here takes the
// member's profile id and reads that member's row, nobody else's.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const svc = () => ({ apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json' });

export type TwilioCreds = { account_sid: string; key_sid: string; key_secret: string };

export const TWILIO_SHAPES = {
  account: /^AC[0-9a-f]{32}$/i,
  key: /^SK[0-9a-f]{32}$/i,
  secret: /^[A-Za-z0-9]{32}$/,
};

/** The member's own Twilio keys, or null when not connected. */
export async function twilioCreds(profileId: string): Promise<TwilioCreds | null> {
  const c = await (await fetch(`${SUPABASE_URL}/rest/v1/service_connections?profile_id=eq.${profileId}&service=eq.twilio&select=id`, { headers: svc() })).json();
  const id = Array.isArray(c) ? c[0]?.id : null;
  if (!id) return null;
  const s = await (await fetch(`${SUPABASE_URL}/rest/v1/service_secrets?connection_id=eq.${id}&select=secret`, { headers: svc() })).json();
  const sec = Array.isArray(s) ? s[0]?.secret : null;
  return sec?.account_sid && sec?.key_sid && sec?.key_secret ? sec as TwilioCreds : null;
}

/** One read against Twilio's REST API with these keys. Throws in plain words. */
export async function twilioGet(c: TwilioCreds, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.account_sid}${path}`, {
    headers: { Authorization: 'Basic ' + btoa(`${c.key_sid}:${c.key_secret}`) },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 401 || res.status === 403) throw new Error('Twilio didn’t accept those keys — the key may have been deleted or the Account SID doesn’t match.');
  if (!res.ok) throw new Error(`Twilio answered ${res.status}.`);
  return await res.json();
}

/** A phone number as Twilio writes it (+15551234567). Null if it isn't one. */
export function e164(raw: string): string | null {
  const d = String(raw ?? '').replace(/[^\d+]/g, '');
  const digits = d.replace(/\D/g, '');
  if (d.startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

export type TwilioNumber = { number: string; name: string; sms: boolean; voice: boolean; added: string };

/** The phone numbers that live on this account right now. */
export async function twilioNumbers(c: TwilioCreds): Promise<TwilioNumber[]> {
  const j = await twilioGet(c, '/IncomingPhoneNumbers.json?PageSize=50');
  const rows = Array.isArray(j.incoming_phone_numbers) ? j.incoming_phone_numbers as Record<string, unknown>[] : [];
  return rows.map((r) => {
    const cap = (r.capabilities ?? {}) as Record<string, boolean>;
    return {
      number: String(r.phone_number ?? ''), name: String(r.friendly_name ?? ''),
      sms: !!cap.sms, voice: !!cap.voice, added: String(r.date_created ?? ''),
    };
  });
}

/** Does this exact number live on the account yet? (A ported number shows
 *  up here the moment the port completes — the honest "it's done" signal.) */
export async function twilioHasNumber(c: TwilioCreds, number: string): Promise<TwilioNumber | null> {
  const n = e164(number);
  if (!n) return null;
  const j = await twilioGet(c, `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(n)}`);
  const rows = Array.isArray(j.incoming_phone_numbers) ? j.incoming_phone_numbers as Record<string, unknown>[] : [];
  if (!rows.length) return null;
  const r = rows[0];
  const cap = (r.capabilities ?? {}) as Record<string, boolean>;
  return { number: String(r.phone_number ?? n), name: String(r.friendly_name ?? ''), sms: !!cap.sms, voice: !!cap.voice, added: String(r.date_created ?? '') };
}
