// Supabase Edge Function: event-poll
//
// THE TIME POLL'S CHOOSER (founder 2026-11-09: "the Ai on the platform
// chooses the time that works for the most people; and, you can have a
// section with additional instructions… works for the most people + this
// mandatory person"). Called by tick_event_polls when a poll is ready
// (deadline passed, or everyone answered with wait-for-all on). Counts the
// votes; with host rules, Claude weighs them and explains the pick; without
// rules, the most votes wins (ties → the earliest). Then either books it
// (the host chose auto-book) or bells the host to confirm with one tap.
// verify_jwt OFF; gated by x-webhook-secret == PUSH_HOOK_SECRET.

import { restClient, whenLabel } from '../_shared/eventMail.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const MODEL = Deno.env.get('ASSISTANT_FEED_MODEL') ?? 'claude-sonnet-5';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const sb = restClient(SUPABASE_URL, SERVICE_KEY);
const rpc = (fn: string, args: unknown) => sb(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });

type Opt = { id: string; start_date: string; all_day: boolean; start_min: number | null; end_min: number | null };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  let body: { event_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const id = body.event_id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Bad request' }, 400);

  const evs = await (await sb(`events?id=eq.${id}&select=id,title,creator_id,poll_status,poll_auto,poll_rules,timezone`)).json();
  const ev = Array.isArray(evs) ? evs[0] : null;
  if (!ev || ev.poll_status !== 'open') return json({ ok: true, skipped: 'not_open' });

  const opts: Opt[] = await (await sb(`event_time_options?event_id=eq.${id}&select=id,start_date,all_day,start_min,end_min&order=position,start_date,start_min`)).json();
  if (!Array.isArray(opts) || !opts.length) return json({ ok: true, skipped: 'no_options' });
  const votes = await (await sb(`event_time_votes?event_id=eq.${id}&select=option_id,profile_id,guest_id`)).json() as { option_id: string; profile_id: string | null; guest_id: string | null }[];
  const pids = [...new Set(votes.map((v) => v.profile_id).filter(Boolean))] as string[];
  const gids = [...new Set(votes.map((v) => v.guest_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (pids.length) for (const p of await (await sb(`profiles?id=in.(${pids.join(',')})&select=id,full_name`)).json()) names.set(p.id, p.full_name ?? 'A member');
  if (gids.length) for (const g of await (await sb(`event_guests?id=in.(${gids.join(',')})&select=id,name,email`)).json()) names.set(g.id, g.name || g.email || 'A guest');
  const label = (o: Opt) => whenLabel({ ...o, timezone: ev.timezone });
  const tallies = opts.map((o, i) => {
    const who = votes.filter((v) => v.option_id === o.id).map((v) => names.get((v.profile_id ?? v.guest_id)!) ?? 'Someone');
    return { i, o, who };
  });

  // Deterministic default: most votes, ties → earliest.
  const ranked = [...tallies].sort((a, b) => b.who.length - a.who.length || a.i - b.i);
  let pick = ranked[0];
  let reason = pick.who.length
    ? `${pick.who.length} ${pick.who.length === 1 ? 'person' : 'people'} can make it (${pick.who.join(', ')}) — the most of any time offered.`
    : 'Nobody has picked a time yet.';

  const rules = (ev.poll_rules ?? '').trim();
  if (rules && ANTHROPIC_API_KEY && votes.length) {
    try {
      const table = tallies.map((t) => `${t.i + 1}. ${label(t.o)} — can make it: ${t.who.length ? t.who.join(', ') : 'nobody'}`).join('\n');
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: MODEL, max_tokens: 400,
          system: 'You choose the time for an event from a poll. Apply the host\'s rules exactly (a "must be there" person must be able to make it). Among the times that satisfy the rules, prefer the most people; ties go to the earliest. If a rule cannot be checked from the poll (e.g. a place\'s availability you cannot see), say so in the reason and decide on what you can see. If no time satisfies a hard rule, pick the best available and say plainly which rule it misses. Reply ONLY with JSON: {"option": <number>, "reason": "<one or two warm, plain sentences for the host>"}',
          messages: [{ role: 'user', content: `Event: ${ev.title}\nHost's rules: ${rules}\n\nOptions:\n${table}` }],
        }),
      });
      if (res.ok) {
        const out = await res.json();
        const text = (out.content ?? []).filter((c: { type: string }) => c.type === 'text').map((c: { text: string }) => c.text).join('');
        const m = /\{[\s\S]*\}/.exec(text);
        if (m) {
          const j = JSON.parse(m[0]);
          const n = Number(j.option);
          if (Number.isInteger(n) && n >= 1 && n <= tallies.length) {
            pick = tallies[n - 1];
            if (typeof j.reason === 'string' && j.reason.trim()) reason = j.reason.trim().slice(0, 500);
          }
        }
      }
    } catch (e) { console.error('poll-ai', e); }
  }

  await sb(`events?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ poll_suggested: pick.o.id, poll_reason: reason }) });
  const posts = await (await sb(`posts?linked_event_id=eq.${id}&select=id&limit=1`)).json();
  const link = Array.isArray(posts) && posts[0] ? `/events/${posts[0].id}` : '/calendar';

  if (!votes.length) {
    await rpc('notify', { p_recipient: ev.creator_id, p_section: 'calendar', p_actor: null, p_type: 'event_poll_ready',
      p_title: `Nobody has voted on a time for ${ev.title}`, p_body: 'You can pick a time yourself, or give it longer.', p_link: link, p_space: null }).catch(() => null);
    return json({ ok: true, waiting: true });
  }
  if (ev.poll_auto) {
    const r = await rpc('_poll_decide', { p_event: id, p_option: pick.o.id });
    if (!r.ok) return json({ error: 'decide failed', detail: await r.text() }, 500);
    await rpc('notify', { p_recipient: ev.creator_id, p_section: 'calendar', p_actor: null, p_type: 'event_poll_ready',
      p_title: `${ev.title} is set for ${label(pick.o)}`, p_body: `${reason} Everyone's been told.`, p_link: link, p_space: null }).catch(() => null);
    return json({ ok: true, decided: pick.o.id });
  }
  await rpc('notify', { p_recipient: ev.creator_id, p_section: 'calendar', p_actor: null, p_type: 'event_poll_ready',
    p_title: `Time poll ready: ${ev.title}`, p_body: `Suggested: ${label(pick.o)}. ${reason} Tap to confirm.`, p_link: link, p_space: null }).catch(() => null);
  return json({ ok: true, suggested: pick.o.id });
});
