// Supabase Edge Function: assistant-watch
//
// STANDING WATCHES (founder 2026-11-24: "once twilio confirms the number is
// setup, cancel spruce so i can get a prorated refund… relying on emails
// from spruce, etc, to get me alerts about things and make things happen").
// pg_cron 'tick-assistant-watches' calls this every 10 minutes. For each
// active watch it looks ONCE, in the member's own data only:
//   kind 'mail'          → a Gmail search (their query, only mail newer than
//                          the watch) across their connected inboxes
//   kind 'twilio_number' → does that number live on their Twilio account yet?
// When one comes true, _assistant_watch_fire writes the brain's note (its
// own conversation, named "Watch: …") and rings a bell. The note names what
// happened and what they asked to have done next — it never acts on its own.
//
// verify_jwt = false; gated by x-webhook-secret == PUSH_HOOK_SECRET.

import { mailAccountsOf, mailTester, listThreads } from '../_shared/gmail.ts';
import { twilioCreds, twilioHasNumber, wireNumber } from '../_shared/twilio.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const svc = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

type Watch = { id: string; profile_id: string; kind: 'mail' | 'twilio_number'; label: string; query: string; then_note: string | null; created_at: string };

function noteFor(w: Watch, detail: string): string {
  const lines = [`Your watch came true: **${w.label}**.`, detail];
  if (w.then_note) lines.push(`You asked me to help with this next: ${w.then_note}`, 'Want me to start on that now?');
  else lines.push('Want me to do anything with it?');
  return lines.join('\n\n');
}

async function mailOff(profileId: string): Promise<boolean> {
  const r = await (await svc(`assistant_consent?profile_id=eq.${profileId}&scope_type=eq.section&scope_id=eq.mail&enabled=eq.false&select=scope_id`)).json();
  return Array.isArray(r) && r.length > 0;
}

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  const rows = await (await svc('assistant_watches?status=eq.active&expires_at=gt.now()&select=id,profile_id,kind,label,query,then_note,created_at&order=created_at&limit=200')).json();
  const watches: Watch[] = Array.isArray(rows) ? rows : [];
  let fired = 0;
  for (const w of watches) {
    let detail: string | null = null;
    try {
      if (w.kind === 'mail') {
        // Reading mail is the member's Mail switch; off = the watch waits.
        if (await mailOff(w.profile_id) || !(await mailTester(w.profile_id))) { /* skip */ }
        else {
          const after = Math.floor(new Date(w.created_at).getTime() / 1000);
          const q = `${w.query} after:${after}`;
          for (const a of await mailAccountsOf(w.profile_id)) {
            const t = await listThreads(w.profile_id, a, q, 3).catch(() => []);
            if (t.length) {
              const first = t[0];
              detail = `It arrived in ${a.email}: “${first.subject}” from ${first.from.replace(/<[^>]+>/, '').trim() || first.from}.`;
              break;
            }
          }
        }
      } else if (w.kind === 'twilio_number') {
        const c = await twilioCreds(w.profile_id);
        if (c) {
          const n = await twilioHasNumber(c, w.query);
          if (n) {
            // The moment it lands, it answers through Lichen — no dead air.
            let wired = false;
            try { wired = (await wireNumber(c, w.profile_id, n.number)).wired; } catch (e) { console.error('watch-wire', e instanceof Error ? e.message : e); }
            detail = `${n.number} now lives on your Twilio account. ${wired
              ? 'I connected it to Lichen: calls ring your cell for 20 seconds, then go to voicemail, and texts wait for me to read. Give it one test call and one test text before you cancel the old service.'
              : 'I couldn’t connect it to Lichen automatically — ask me to "connect my Twilio number" and I’ll try again.'}`;
          }
        }
      }
    } catch (e) {
      console.error('watch-check', w.id, e instanceof Error ? e.message : e);
    }
    if (detail) {
      await svc('rpc/_assistant_watch_fire', { method: 'POST', body: JSON.stringify({ p_watch: w.id, p_detail: detail, p_body: noteFor(w, detail) }) });
      fired++;
    } else {
      await svc(`assistant_watches?id=eq.${w.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_checked_at: new Date().toISOString() }) });
    }
  }
  return json({ ok: true, checked: watches.length, fired });
});
