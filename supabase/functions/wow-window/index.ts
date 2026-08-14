// Supabase Edge Function: wow-window
//
// THE SELF-DRIVING WINDOW (founder 2026-08-14): a member may hand their WOW
// score window to Claude — "let's allow humans to trust you automating it,
// if/when that feels right. Kinda like self driving cars." Claude reads the
// RHYTHM of their board (entry dates, cadence, score volatility — for their
// own board only, which they already see) and picks a window between 14 and
// 120 days, with a one-sentence reason shown verbatim to the member. The
// choice is stored in care_settings; the client's computeWowScores uses it.
//
// Consent chain: the caller must be the patient themselves (the function
// always operates on the CALLER's own board — no target parameter), and
// care_settings.wow_window_auto must already be true (the client sets it,
// through the member's own RLS, when they press the button). Re-tunes are
// throttled server-side: a window set less than 7 days ago is returned
// as-is without a model call, so this needs no daily-cap bookkeeping.
// Secrets: ANTHROPIC_API_KEY (set). Model: WOW_WINDOW_MODEL, default
// claude-sonnet-5 (a small judgment call; sonnet is plenty).

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('WOW_WINDOW_MODEL') ?? 'claude-sonnet-5';
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

const RETUNE_DAYS = 7;
const MIN_DAYS = 14, MAX_DAYS = 120, DEFAULT_DAYS = 60;

const SYSTEM = `You tune one number for a member of Lichen: the window (in days) over which
their Web of Wellbeing score is computed. The score is a NOW-reading of six
wellbeing dimensions; each dimension averages the entries inside the window,
and a dimension with no entries in the window carries its latest entry
forward.

You are given the member's entry history: dates, which dimensions, and
scores where present. Choose a window between ${MIN_DAYS} and ${MAX_DAYS} days:

- Frequent entries and fast-moving scores → shorter (their life is moving;
  the reading should keep up).
- Sparse or steady entries → longer (one entry shouldn't own the number;
  a longer window smooths without going stale).
- Little or no history → ${DEFAULT_DAYS}, the platform default.

Reply with ONLY a JSON object, no other text:
{"days": <integer>, "reason": "<one short plain sentence addressed to the
member, explaining the choice from their own rhythm — no jargon, no
percentages, warm but concrete>"}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  try {
    // ── Caller = patient. Always their own board. ─────────────────────────
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ error: 'Sign in first.' }, 401);
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth },
    });
    if (!userRes.ok) return json({ error: 'Sign in first.' }, 401);
    const user = await userRes.json();
    if (!user?.id) return json({ error: 'Sign in first.' }, 401);
    const me: string = user.id;
    const svc = { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` };

    // ── Consent + throttle ────────────────────────────────────────────────
    const setRes = await fetch(
      `${SUPABASE_URL}/rest/v1/care_settings?patient_id=eq.${me}&select=wow_window_auto,wow_window_days,wow_window_reason,wow_window_set_at`,
      { headers: svc },
    );
    const settings = setRes.ok ? (await setRes.json())?.[0] : null;
    if (!settings?.wow_window_auto) {
      return json({ error: 'The window is in your hands — switch on Claude tuning first.' }, 403);
    }
    if (settings.wow_window_set_at
      && Date.now() - new Date(settings.wow_window_set_at).getTime() < RETUNE_DAYS * 86400_000
      && settings.wow_window_days) {
      return json({ days: settings.wow_window_days, reason: settings.wow_window_reason ?? '', fresh: false });
    }

    // ── The rhythm of the board (dates/dims/scores only — not the words) ──
    const postsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/care_posts?patient_id=eq.${me}&kind=eq.wow&select=created_at,dimensions,score&order=created_at.desc&limit=200`,
      { headers: svc },
    );
    const posts: { created_at: string; dimensions: string[]; score: number | null }[] =
      postsRes.ok ? await postsRes.json() : [];
    const history = posts.map((p) => ({
      on: p.created_at.slice(0, 10), dims: p.dimensions, score: p.score,
    }));

    // ── Claude picks ──────────────────────────────────────────────────────
    let days = DEFAULT_DAYS;
    let reason = 'Starting at the platform default until your rhythm has more to say.';
    if (ANTHROPIC_API_KEY && history.length > 0) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY.replace(/[^\x21-\x7E]/g, ''),
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 600,
          system: SYSTEM,
          messages: [{
            role: 'user',
            content: `Today is ${new Date().toISOString().slice(0, 10)}. Entry history, newest first:\n${JSON.stringify(history)}`,
          }],
        }),
      });
      if (!r.ok) console.error('wow-window model:', r.status, (await r.text()).slice(0, 200));
      else {
        const data = await r.json();
        // Read EVERY text block — a non-text leading block once silently
        // emptied profile-snapshot's proposal.
        const text = (data?.content ?? [])
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text).join('\n');
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            if (Number.isFinite(parsed.days)) {
              days = Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(parsed.days)));
            }
            if (typeof parsed.reason === 'string' && parsed.reason.trim()) reason = parsed.reason.trim();
          } catch { /* fall through to defaults */ }
        }
      }
    }

    // ── Store the choice where both the member and their care team read ───
    const up = await fetch(`${SUPABASE_URL}/rest/v1/care_settings?patient_id=eq.${me}`, {
      method: 'PATCH',
      headers: { ...svc, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        wow_window_days: days, wow_window_reason: reason,
        wow_window_set_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
    });
    if (!up.ok) return json({ error: 'Could not save the window.' }, 500);
    return json({ days, reason, fresh: true });
  } catch (e) {
    console.error('wow-window:', e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});
