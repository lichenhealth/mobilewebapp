// Supabase Edge Function: assistant-brief
//
// The assistant on every page (founder 2026-07-28): "like your assistant
// briefing you when you come back into the office after a vacation — not a
// play-by-play, just organized highlights filtered for what you need to
// know and do." The CLIENT gathers what it already holds (notifications for
// the section, desk queues, counts — all RLS-scoped reads it made anyway)
// and Claude turns it into a short, humane briefing framed for the section:
// Marketplace = helping you offer/find; a group = helping you tend it.
//
// Same spend controls as assistant-search: gate-admitted members only,
// shared daily cap via assistant_queries (context 'brief').
// Secrets: ANTHROPIC_API_KEY (set). Model: ASSISTANT_BRIEF_MODEL, default
// claude-sonnet-5 (briefs are longer than narrations; sonnet reads well
// and costs a fraction).

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ASSISTANT_BRIEF_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Number(Deno.env.get('ASSISTANT_DAILY_CAP') ?? '30');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const SYSTEM = `You are the member's Lichen assistant — a warm, plain-spoken partner inside
Lichen, a conscious ecosystem for healing, growing and creating in community.
Silicon intelligence (you) partners with carbon intelligence (them): you
organize what's waiting; they choose what matters.

You are given a snapshot of one SECTION of the member's Lichen life —
notifications, queues, counts — plus the section's name. Brief them the way
a trusted assistant briefs someone back from a vacation: organized
highlights, filtered for what they need to KNOW and what needs them to DO.
Rules:

- Short. 2-6 sentences, or a few short lines. No headers, no markdown
  syntax, no bullets unless there are 3+ action items (then use plain
  hyphens). Never a play-by-play.
- Lead with what needs their action; mention the rest only if it matters.
- Frame for the section: Marketplace = what they're offering/seeking and
  what moved; a group/community/organization/place = who's waiting at its
  door and what needs tending; Calendar = what's coming and what's
  unanswered; Home = the whole-life view, biggest things first.
- Never invent items — only speak of what's in the snapshot. If the
  snapshot is quiet, say so warmly and briefly ("All tended — nothing
  waiting on you here.") and stop.
- Trust vocabulary is sacred: "someone you trust" / "trusted by someone you
  trust" — never "your mycelium" as a degree, never counts as scores.
- Say groups/communities/organizations/places — never "spaces".
- No greetings, no sign-offs, no "As an AI". Just the briefing.`;

async function resolveCaller(req: Request): Promise<string | null> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;
  const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
  const [profRes, subRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=is_admin`, { headers: svc }),
    fetch(`${SUPABASE_URL}/rest/v1/subscriptions?profile_id=eq.${user.id}&select=status,current_period_end`, { headers: svc }),
  ]);
  const prof = profRes.ok ? await profRes.json() : [];
  if (prof?.[0]?.is_admin === true) return user.id;
  const subs = subRes.ok ? await subRes.json() : [];
  const now = new Date().toISOString();
  const active = (subs ?? []).some((s: { status: string; current_period_end: string | null }) =>
    (s.status === 'active' || s.status === 'past_due')
    && (!s.current_period_end || s.current_period_end > now));
  return active ? user.id : null;
}

async function usedToday(profileId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/assistant_queries?profile_id=eq.${profileId}` +
    `&created_at=gte.${dayStart.toISOString()}&select=id`,
    { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, Prefer: 'count=exact', Range: '0-0' } },
  );
  const total = Number((res.headers.get('content-range') ?? '').split('/')[1] ?? '0');
  return Number.isFinite(total) ? total : 0;
}

async function recordUse(profileId: string, usage: { input_tokens?: number; output_tokens?: number } | null): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/assistant_queries`, {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ profile_id: profileId, context: 'brief', model: MODEL, input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null }),
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!ANTHROPIC_API_KEY) return json({ available: false });

  const caller = await resolveCaller(req);
  if (!caller) return json({ error: 'Not authorized.' }, 403);
  if ((await usedToday(caller)) >= DAILY_CAP) return json({ available: true, capped: true });

  let body: { section?: string; frame?: string; snapshot?: unknown };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const section = String(body.section ?? 'home').slice(0, 60);
  const frame = String(body.frame ?? '').slice(0, 300);
  const snapshot = JSON.stringify(body.snapshot ?? {}).slice(0, 12000);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 500,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `SECTION: ${section}\n${frame ? `FRAMING: ${frame}\n` : ''}SNAPSHOT:\n${snapshot}\n\nBrief me.`,
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    const text: string = d?.content?.[0]?.text ?? '';
    await recordUse(caller, d?.usage ?? null);
    return json({ available: true, brief: text });
  } catch (err) {
    console.error('assistant-brief error:', err);
    return json({ available: false });
  }
});
