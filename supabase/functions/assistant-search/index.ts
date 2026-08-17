// Supabase Edge Function: assistant-search
//
// The Assistant card above /search results (Figma 286-5477): one Claude API
// call that narrates the deterministic search's results conversationally —
// explains near-misses, suggests widening to second-degree trust or loosening
// a filter. The rule-based search does the finding; Claude only narrates.
//
// Spend controls:
//  - Caller must be a signed-in member with an active/past_due subscription
//    (or an admin) — the same population the membership gate admits.
//  - Per-member daily cap (ASSISTANT_DAILY_CAP, default 30) enforced via the
//    assistant_queries table (deny-all RLS; service role only).
//  - Without ANTHROPIC_API_KEY the function reports {available:false} and the
//    app hides the card — search works exactly as before (graceful degrade).
//
// Secrets: ANTHROPIC_API_KEY. Raw fetch to the Messages API (repo convention
// for Deno edge — same reason the Stripe functions use raw fetch).

import { assistantConsentOff } from '../_shared/consent.ts';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ASSISTANT_MODEL') ?? 'claude-opus-4-8';
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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const SYSTEM = `You are the member's Lichen assistant — a warm, plain-spoken guide inside
Lichen, a conscious ecosystem for healing, growing and creating in community.
Members find practitioners, goods, events, groups and places through the
people they trust; silicon intelligence (you) partners with carbon
intelligence (them) — you illuminate the web, they choose the path.

Membership on Lichen is more than human: plants, animals, land and places
hold member profiles as recognized participants in care. If a result is a
place or a beyond-human member, speak of it with the same respect and warmth
you would a person — a participant, never scenery or inventory.

You are given a member's search (their own words plus the filters the app
understood) and the results the search engine found. Your ONLY job is to
narrate those results helpfully. Rules:

- 2 to 4 short sentences, conversational, no headers, no markdown, no lists.
- Never invent results, people, or facts. Only speak about what you were given.
- If results are strong, point at the most promising one or two and say why
  (a recommender in their circle, close by, the right offer type).
- If results are thin or empty, name the likeliest reason (a tight filter,
  a narrow trust circle, a small radius) and suggest ONE concrete widening —
  e.g. "try widening to people trusted by someone you trust", a bigger
  distance, or dropping a filter.
- Trust vocabulary is sacred: say "someone you trust" or "trusted by someone
  you trust" — never "your mycelium" as a trust degree, never trust counts,
  scores, or rankings. Trust on Lichen is private and person-by-person.
- Refer to groups/communities/organizations/places — never "spaces".
- No greetings, no sign-offs, no "As an AI". Just the helpful observation.`;

interface Payload {
  q?: string;
  section?: string;   // which section's AI door governs this narration
  space_ids?: string[]; // spaces the search is scoped to — their consent governs too
  chips?: string[];
  counts?: { people: number; posts: number; spaces: number };
  trust_degree?: string | null;
  rec_degree?: string | null;
  radius_miles?: number | null;
  people?: unknown[];
  posts?: unknown[];
  spaces?: unknown[];
}

/** Resolve the caller and confirm they're gate-admitted (subscriber or admin). */
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

/** How many assistant calls this member has made since local midnight (UTC-approx). */
async function usedToday(profileId: string): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/assistant_queries?profile_id=eq.${profileId}` +
    `&created_at=gte.${dayStart.toISOString()}&select=id`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    },
  );
  const range = res.headers.get('content-range') ?? '';
  const total = Number(range.split('/')[1] ?? '0');
  return Number.isFinite(total) ? total : 0;
}

/** The ledger row: cap-counting today, Universal Value Attribution tomorrow —
 *  every silicon contribution recorded with its context and exact token cost. */
async function recordUse(
  profileId: string,
  usage: { input_tokens?: number; output_tokens?: number } | null,
): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/assistant_queries`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      profile_id: profileId,
      context: 'search',
      model: MODEL,
      input_tokens: usage?.input_tokens ?? null,
      output_tokens: usage?.output_tokens ?? null,
    }),
  }).catch(() => { /* the narration already happened; a lost ledger row is acceptable */ });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Not configured yet → the app hides the card. Search is unaffected.
  if (!ANTHROPIC_API_KEY) return json({ available: false });

  const caller = await resolveCaller(req);
  if (!caller) return json({ error: 'Not authorized.' }, 403);

  if ((await usedToday(caller)) >= DAILY_CAP) {
    return json({ available: true, capped: true });
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  // PER-IDENTITY AI CONSENT (founder 2026-08-17): a de-selection for the
  // section this search is scoped to (or for search itself) means no
  // narration — the card quietly steps aside, search itself is untouched.
  // A search scoped to specific spaces answers to them too: the member's own
  // per-space choice, and each space's own assistant_enabled switch.
  const section = String(body.section ?? 'search').slice(0, 60);
  const spaceIds = (Array.isArray(body.space_ids) ? body.space_ids : [])
    .filter((s): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s))
    .slice(0, 12);
  if (await assistantConsentOff(caller, [
    { type: 'section', id: section },
    { type: 'section', id: 'search' },
    ...spaceIds.map((id) => ({ type: 'space' as const, id })),
  ])) {
    return json({ available: false, consent: 'off' });
  }
  if (spaceIds.length) {
    const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };
    const spRes = await fetch(
      `${SUPABASE_URL}/rest/v1/spaces?id=in.(${spaceIds.join(',')})&assistant_enabled=eq.false&select=id&limit=1`,
      { headers: svc });
    const off = spRes.ok ? await spRes.json() : [];
    if (Array.isArray(off) && off.length) return json({ available: false, consent: 'off' });
  }

  const counts = body.counts ?? { people: 0, posts: 0, spaces: 0 };
  const brief = {
    member_search_sentence: (body.q ?? '').slice(0, 500),
    filters_understood: (body.chips ?? []).slice(0, 20),
    result_counts: counts,
    trust_filter_degree: body.trust_degree ?? null,   // 'mine' = someone you trust · 'second' = trusted by someone you trust
    recommend_filter_degree: body.rec_degree ?? null,
    radius_miles: body.radius_miles ?? null,
    people: (body.people ?? []).slice(0, 8),
    happenings_and_posts: (body.posts ?? []).slice(0, 8),
    organizations_and_places: (body.spaces ?? []).slice(0, 8),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY.replace(/[^\x21-\x7E]/g, ''),
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: 'Narrate this search for the member:\n' + JSON.stringify(brief),
      }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('anthropic:', res.status, detail.slice(0, 300));
    // Model hiccup → the card quietly steps aside; never break search.
    return json({ available: false });
  }

  const data = await res.json();
  if (data?.stop_reason === 'refusal') return json({ available: false });
  const text: string = (data?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('')
    .trim();
  if (!text) return json({ available: false });

  await recordUse(caller, data?.usage ?? null);
  return json({ available: true, text });
});
