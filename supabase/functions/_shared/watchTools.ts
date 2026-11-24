// THE BRAIN AS AN EA — standing watches + connected services (founder
// 2026-11-24: "i want to make lichen's brain assistant the best EA out
// there… once twilio confirms the number is setup, cancel spruce").
//
// watch_for sets a standing watch from the member's words; assistant-watch
// checks it every 10 minutes and, when it comes true, the brain writes them
// a note + bell naming what they asked to have done next. my_watches lists
// and stops them. twilio reads the member's OWN connected Twilio account.
// Nothing here acts on its own: a watch only notices and tells.

import { twilioCreds, twilioNumbers, twilioHasNumber, e164 } from './twilio.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

type Out = { ok: boolean; [k: string]: unknown };
const CONNECTIONS_DOOR = { path: '/profile#connections', label: 'Open Connections' };

export const WATCH_TOOLS = [
  {
    name: 'watch_for',
    description: 'Set a STANDING WATCH from the member\'s words — "tell me when X happens" / "once X, help me do Y". Lichen checks every 10 minutes for up to 30 days; when it comes true they get a bell and a note from you in a new conversation, naming what they asked to have done next. kind "mail": query = a Gmail search for the email that would mean it happened (e.g. from:twilio.com subject:port, from:spruce subject:cancel) — only mail arriving AFTER the watch counts. kind "twilio_number": query = the phone number that will appear on their connected Twilio account (a port finishing). label = a short plain name ("Twilio number transfer done"). then = what they want done once it happens, in their words ("cancel Spruce for the prorated refund"). A watch only notices and tells — it never acts by itself; say so.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mail', 'twilio_number'] },
        label: { type: 'string' }, query: { type: 'string' }, then: { type: 'string' },
      },
      required: ['kind', 'label', 'query'],
    },
  },
  {
    name: 'my_watches',
    description: 'List the member\'s standing watches (active and recently come true). action "stop" + label (or id) stops one they ask to stop.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'stop'] }, label: { type: 'string' }, id: { type: 'string' } } },
  },
  {
    name: 'twilio',
    description: 'Read the member\'s OWN connected Twilio account (Profile → Connections). action "numbers" lists the phone numbers on it; action "check_number" + number says whether that number lives there yet (a number transfer/port shows up the moment it finishes). Read-only. If Twilio isn\'t connected, an Open Connections button rides your reply — say they paste their Twilio key there once.',
    input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['numbers', 'check_number'] }, number: { type: 'string' } }, required: ['action'] },
  },
  {
    name: 'suggest_connection',
    description: 'When the member wants their Brain to work with an outside service Lichen can\'t connect to yet (anything other than their Google inbox or Twilio), ask Lichen\'s team to connect it for them — only when they asked, in their own words. service = the service\'s name; why = what they want done with it, in their words. Lichen\'s stewards are belled and the member hears the answer by bell. Say plainly it isn\'t instant: each new service is built and checked by Lichen\'s team before anyone\'s keys go into it.',
    input_schema: { type: 'object', properties: { service: { type: 'string' }, why: { type: 'string' } }, required: ['service'] },
  },
];
export const WATCH_TOOL_NAMES = new Set(WATCH_TOOLS.map((t) => t.name));

export async function runWatchTool(profileId: string, name: string, input: Record<string, unknown>, canMail: boolean): Promise<Out & { door?: { path: string; label: string } }> {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string).trim() : '');
  try {
    if (name === 'twilio') {
      const c = await twilioCreds(profileId);
      if (!c) return { ok: false, error: 'Twilio isn’t connected yet. They paste their Twilio API key once in Profile → Connections; an Open Connections button is attached.', door: CONNECTIONS_DOOR };
      if (s('action') === 'check_number') {
        const n = e164(s('number'));
        if (!n) return { ok: false, error: 'That doesn’t read as a phone number.' };
        const hit = await twilioHasNumber(c, n);
        return hit ? { ok: true, on_twilio: true, number: hit } : { ok: true, on_twilio: false, number: n, note: 'Not on their Twilio account yet. Offer a standing watch (watch_for kind twilio_number) so they hear the moment it arrives.' };
      }
      return { ok: true, numbers: await twilioNumbers(c) };
    }

    if (name === 'watch_for') {
      const kind = s('kind');
      const label = s('label').slice(0, 200);
      let query = s('query').slice(0, 500);
      if (label.length < 2 || query.length < 2) return { ok: false, error: 'A watch needs a short label and what to look for.' };
      if (kind === 'mail') {
        if (!canMail) return { ok: false, error: 'A mail watch needs their connected inbox and Lichen Mail switched on for the assistant.' };
      } else if (kind === 'twilio_number') {
        const n = e164(query);
        if (!n) return { ok: false, error: 'That doesn’t read as a phone number.' };
        query = n;
        if (!(await twilioCreds(profileId))) return { ok: false, error: 'Twilio isn’t connected yet — a mail watch for Twilio’s confirmation email works meanwhile, or they connect Twilio in Profile → Connections (button attached).', door: CONNECTIONS_DOOR };
      } else return { ok: false, error: 'kind is mail or twilio_number.' };
      const live = await (await svc(`assistant_watches?profile_id=eq.${profileId}&status=eq.active&select=id`)).json();
      if (Array.isArray(live) && live.length >= 20) return { ok: false, error: 'They already have 20 watches running — stop one first (my_watches).' };
      const r = await svc('assistant_watches', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ profile_id: profileId, kind, label, query, then_note: s('then').slice(0, 1000) || null }),
      });
      const row = (await r.json().catch(() => []))?.[0];
      if (!row?.id) return { ok: false, error: 'Couldn’t set the watch — try again.' };
      return { ok: true, watching: { label, kind, query, expires: row.expires_at }, note: 'Checks every 10 minutes for 30 days. It only notices and tells them — nothing happens on its own. They can see or stop it in Profile → Connections.' };
    }

    if (name === 'suggest_connection') {
      const service = s('service').slice(0, 80);
      if (service.length < 2) return { ok: false, error: 'Which service should Lichen connect?' };
      const dup = await (await svc(`connection_suggestions?profile_id=eq.${profileId}&service=ilike.${encodeURIComponent(service)}&select=id,status`)).json();
      if (Array.isArray(dup) && dup.length) return { ok: true, already: true, status: dup[0].status, note: 'They already asked for this one — tell them where it stands.', door: CONNECTIONS_DOOR };
      const r = await svc('connection_suggestions', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ profile_id: profileId, service, why: s('why').slice(0, 1000) || null }),
      });
      if (!r.ok) return { ok: false, error: 'Couldn’t send that to Lichen — try again.' };
      return { ok: true, suggested: service, note: 'Sent to Lichen\'s stewards; the member gets a bell with the answer. Their asks are listed in Profile → Connections.', door: CONNECTIONS_DOOR };
    }

    if (name === 'my_watches') {
      const rows = await (await svc(`assistant_watches?profile_id=eq.${profileId}&status=in.(active,fired)&select=id,kind,label,query,then_note,status,created_at,fired_at,fired_detail&order=created_at.desc&limit=30`)).json();
      const list = Array.isArray(rows) ? rows as Record<string, string | null>[] : [];
      if (s('action') === 'stop') {
        const id = s('id');
        const lbl = s('label').toLowerCase();
        const hits = list.filter((w) => w.status === 'active' && (id ? w.id === id : (w.label ?? '').toLowerCase() === lbl));
        if (hits.length !== 1) return { ok: false, error: hits.length ? 'Several watches share that label — name it by id.' : 'No active watch by that name.', watches: list };
        await svc(`assistant_watches?id=eq.${hits[0].id}&profile_id=eq.${profileId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) });
        return { ok: true, stopped: hits[0].label };
      }
      return { ok: true, watches: list };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, error: 'Unknown tool.' };
}
