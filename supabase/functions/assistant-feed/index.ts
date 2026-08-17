// Supabase Edge Function: assistant-feed
//
// The assistant's voice in a member's Claude feed (supersedes claude-chat for
// this relationship — claude-chat/assistant_on_message stay running untouched
// for any pre-existing chat thread, this is a new parallel surface). Invoked
// by the assistant_on_feed_post trigger (pg_net + Vault, the push pattern)
// whenever a member posts into assistant_feed_posts. Always replies — this
// relationship is inherently 1:1, no "speak when spoken to" branch needed.
// When the triggering post references a shared platform post (source_post_id),
// that post's title/body is folded into the prompt so the reply is actually
// informed by what was shared, not just the member's added note.
//
// Per-member daily cap via assistant_queries (context 'feed') — its own
// budget, not shared with claude-chat's 'chat' context.
//
// ACTIONS (founder 2026-08-11, docs/ASSISTANT_ACTIONS.md): in the PROFILE
// thread, and only when the member has turned on profiles.assistant_can_edit,
// the assistant gets tools that actually WRITE their own public-page fields
// instead of only proposing. Every write is scoped server-side to the
// trigger's profile_id — the model never supplies a target — and every write
// is announced in the reply, with the previous value, so "put it back" works
// by conversation rather than an undo stack.
//
// Env: ANTHROPIC_API_KEY (set), PUSH_HOOK_SECRET, optional ASSISTANT_FEED_MODEL
// (default claude-sonnet-5) and ASSISTANT_FEED_CAP (default 20).

import { LICHEN_DOCTRINE } from '../_shared/doctrine.ts';

const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL = Deno.env.get('ASSISTANT_FEED_MODEL') ?? 'claude-sonnet-5';
const DAILY_CAP = Number(Deno.env.get('ASSISTANT_FEED_CAP') ?? '20');

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const sb = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

const BASE_RULES = `Ground rules, always:
- Reply in the language the member wrote in. Keep replies to a few warm sentences.
- You only see this one feed — never claim to know other members' private information.
- Don't invent platform features; if unsure how something works on Lichen, say so plainly.
- No medical, legal, or financial advice — warmly point to their care team, the Concierge tab, or a human.
- You are talking with a fellow Lichen member. Help, never sell.
- When a shared post is included below, actually respond to it — don't just acknowledge that something was shared.`;

// The eight keys of ContactInfo (src/components/ContactFields.tsx) — the whole
// surface set_contact_field may touch. Anything not in this list is refused by
// the executor, not by the prompt.
const CONTACT_FIELDS = ['website', 'email', 'phone', 'booking', 'hours', 'address', 'instagram', 'facebook'];

const TAGLINE_MAX = 90;

// The WHOLE list of operations (docs/ASSISTANT_ACTIONS.md). Public-page fields
// only: nothing here can reach location, care, financial position, another
// member, or a space — those are consequential in a way that wants a confirm
// step, not a chat message.
const EDIT_TOOLS = [
  {
    name: 'set_tagline',
    description: `Replace the member's public-page tagline — the one line under their name. Max ${TAGLINE_MAX} characters. Pass an empty string to clear it, which is how you put it back when it started out empty. Returns the previous value so you can tell them what it used to say.`,
    input_schema: {
      type: 'object',
      properties: { tagline: { type: 'string', description: 'The new tagline. One line, no trailing period needed. Empty string clears it.' } },
      required: ['tagline'],
    },
  },
  {
    name: 'set_home_summary',
    description: 'Replace the welcome paragraph(s) on the Home tab of their public page. Leave this alone unless they ask for the home page or the welcome specifically — when it is empty, Home opens with the first two paragraphs of their story, which is often what they want. Pass an empty string to clear it and go back to that.',
    input_schema: {
      type: 'object',
      properties: { summary: { type: 'string', description: 'The Home welcome, paragraphs separated by a blank line. Empty string clears it.' } },
      required: ['summary'],
    },
  },
  {
    name: 'set_story',
    description: 'Replace their whole story — the long-form About text. This is a full replace, not an append: read back what you are replacing before you use it on a story that already says something. The previous value comes back in the result, so say enough of it in your reply that they could ask for it back.',
    input_schema: {
      type: 'object',
      properties: { story: { type: 'string', description: 'The new story, a few short paragraphs separated by blank lines. Empty string clears it — only ever on an explicit ask.' } },
      required: ['story'],
    },
  },
  {
    name: 'set_contact_field',
    description: `Set one public contact field. Field must be one of: ${CONTACT_FIELDS.join(', ')}. Pass an empty value to clear the field. This is the PUBLIC contact block on their page — not their private account email or phone, which you cannot touch.`,
    input_schema: {
      type: 'object',
      properties: {
        field: { type: 'string', enum: CONTACT_FIELDS },
        value: { type: 'string', description: 'The new value, or an empty string to clear it.' },
      },
      required: ['field', 'value'],
    },
  },
  {
    name: 'add_categories',
    description: 'Add to what they offer, by category id from the list in your instructions. Adding a service category declares them a service provider, and a goods category a goods provider — that follows automatically, do not describe it as a separate step.',
    input_schema: {
      type: 'object',
      properties: {
        category_ids: { type: 'array', items: { type: 'string' }, description: 'Exact ids from the vocabulary you were given. Never invent one.' },
      },
      required: ['category_ids'],
    },
  },
  {
    name: 'remove_categories',
    description: 'Remove categories from what they offer. Their provider standing is left alone — removing every service does not un-declare them.',
    input_schema: {
      type: 'object',
      properties: { category_ids: { type: 'array', items: { type: 'string' } } },
      required: ['category_ids'],
    },
  },
];

/** What a tool call did, in one plain line — the fallback report if the model
 *  writes and then says nothing (a write with no report is a bug). */
type ToolOutcome = { ok: boolean; change?: string; [k: string]: unknown };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  let body: { feed_post_id?: string; profile_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const { feed_post_id, profile_id } = body;
  if (!feed_post_id || !profile_id) return json({ error: 'Missing fields' }, 400);

  // One assistant identity exists today (Claude) — no per-entity fabric yet.
  const idents = await (await sb(`assistant_identities?active=eq.true&select=profile_id,label,persona&limit=1`)).json();
  const ident = Array.isArray(idents) ? idents[0] : null;
  if (!ident) return json({ ok: true, skipped: 'no-identity' });

  const posts = await (await sb(`assistant_feed_posts?id=eq.${feed_post_id}&select=body,source_post_id,thread`)).json();
  const trigger = Array.isArray(posts) ? posts[0] : null;
  if (!trigger?.body?.trim()) return json({ ok: true, skipped: 'empty-post' });

  // Per-member daily cap (spend control; logged in the UVA seed ledger).
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const capRes = await sb(`assistant_queries?profile_id=eq.${profile_id}&context=eq.feed&created_at=gte.${since.toISOString()}&select=id`, { headers: { Prefer: 'count=exact' } });
  const used = Number(capRes.headers.get('content-range')?.split('/')[1] ?? '0');
  if (used >= DAILY_CAP) {
    await sb('assistant_feed_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      profile_id, author: 'claude', thread: trigger.thread ?? 'general',
      body: 'I’ve reached today’s limit with you — a small guardrail while the mycelium is young. Let’s pick this up tomorrow. 🌱',
    }) });
    return json({ ok: true, skipped: 'cap' });
  }

  // A shared post, if this entry came from "Share to Claude" — fold its
  // actual content in, not just the member's note about it.
  let sharedPostContext = '';
  if (trigger.source_post_id) {
    const shared = await (await sb(`posts?id=eq.${trigger.source_post_id}&select=title,body`)).json();
    const sp = Array.isArray(shared) ? shared[0] : null;
    if (sp) sharedPostContext = `\n\n[The member shared this post: "${sp.title ?? ''}" — ${sp.body ?? ''}]`;
  }

  // THREADS (founder 2026-08-11): the assistant keeps a thread per section, so
  // this reply reads THIS thread's history — marketplace work doesn't wander
  // into a care conversation. General is the exception: it's the thread for
  // whatever isn't one subject, so it gets a short glance at the others.
  const thread = trigger.thread ?? 'general';
  const feed = await (await sb(`assistant_feed_posts?profile_id=eq.${profile_id}&thread=eq.${thread}&select=id,author,body,source_post_id&order=created_at.desc&limit=20`)).json();
  const rows = (Array.isArray(feed) ? feed : []).reverse().filter((p: { body?: string }) => p.body?.trim());

  let elsewhere = '';
  if (thread === 'general') {
    const others = await (await sb(`assistant_feed_posts?profile_id=eq.${profile_id}&thread=neq.general&select=thread,body,created_at&order=created_at.desc&limit=12`)).json();
    const lines = (Array.isArray(others) ? others : [])
      .filter((p: { body?: string }) => p.body?.trim())
      .map((p: { thread: string; body: string }) => `[${p.thread}] ${p.body.slice(0, 180)}`);
    if (lines.length) {
      elsewhere = `\n\nFor context, recent work from their other threads (do not bring it up unless it's relevant to what they just asked):\n${lines.join('\n')}`;
    }
  }

  // WHERE THEY STAND (founder 2026-08-11): the thread is always the
  // MEMBER's, but what the assistant can usefully help with changes with
  // their role in each place. Galyn is a member of Melanie's Mentorship
  // Group and both member AND steward of WAG — so the assistant helps her
  // participate in the first and also run the second. This reads only her
  // OWN memberships; nobody else's standing is fetched.
  let standing = '';
  {
    const mem = await (await sb(
      `space_members?profile_id=eq.${profile_id}&select=role,duties,spaces(name,kind)&limit=60`,
    )).json();
    const rows = (Array.isArray(mem) ? mem : []) as {
      role: string; duties: string[] | null; spaces: { name: string; kind: string } | null;
    }[];
    const steward = rows.filter((r) => r.role === 'admin' || r.role === 'super_admin');
    const member = rows.filter((r) => r.role === 'member');
    const name = (r: typeof rows[number]) => {
      const s = r.spaces;
      if (!s) return null;
      // A duty-scoped admin stewards ONE part — say which, so the assistant
      // doesn't offer them doors they don't actually hold.
      const duties = Array.isArray(r.duties) && r.duties.length ? ` — ${r.duties.join(', ')} only` : '';
      return `${s.name} (${s.kind})${duties}`;
    };
    const stewardNames = steward.map(name).filter(Boolean);
    const memberNames = member.map(name).filter(Boolean);
    if (stewardNames.length || memberNames.length) {
      standing = '\n\nWhere this member stands today:'
        + (stewardNames.length
          ? `\n- They STEWARD (admin): ${stewardNames.join('; ')}. Here you can help both ways — running the place (approving who is waiting at the door, member roles, what is shared to the shelves, the public page, gatherings) AND taking part in it.`
          : '')
        + (memberNames.length
          ? `\n- They are a MEMBER of: ${memberNames.join('; ')}. Here you help them take part — finding what is happening, joining in, offering and asking. Do not offer to run these or suggest steward actions they cannot take; if they need something only a steward can do, say who to ask.`
          : '')
        + '\nNever assume a role they do not hold, and never describe another member\'s standing.';
    }
  }

  // Staying in the right thread is part of the job: if what they've asked
  // plainly belongs somewhere else, say so and point, rather than doing the
  // work in the wrong place (founder 2026-08-11).
  const threadRule = thread === 'general'
    ? '\n\nYou are in their GENERAL thread — anything goes here, and you may draw on their other threads when it helps.'
    : `\n\nYou are in their ${thread.toUpperCase()} thread, which keeps that work together. If what they have just asked clearly belongs to a different part of Lichen, answer briefly and say which thread it belongs in so it stays findable — one short sentence, never a lecture.`;

  // THE HAND THAT WRITES (docs/ASSISTANT_ACTIONS.md). Off unless the member
  // turned it on, and only in the thread this work belongs to — asked in
  // Marketplace, the threadRule above points them at Profile instead of
  // quietly rewriting their page from the wrong room.
  let canEdit = false;
  {
    const me = await (await sb(`profiles?id=eq.${profile_id}&select=assistant_can_edit`)).json();
    canEdit = thread === 'profile' && !!(Array.isArray(me) ? me[0]?.assistant_can_edit : false);
  }

  // The real taxonomy travels with the request, so a category can only ever be
  // one that exists (the profile-snapshot / listing-autofill pattern).
  let editRule = '';
  if (canEdit) {
    const cats = await (await sb('categories?select=id,name,domain&domain=in.(service,good)&order=sort')).json();
    const lines = (Array.isArray(cats) ? cats : [])
      .map((c: { id: string; name: string; domain: string }) => `${c.id} = ${c.name} (${c.domain})`);
    editRule = '\n\nYOU CAN ACTUALLY CHANGE THEIR PAGE. They have turned on "Let Claude edit my page directly", so the tools you have write straight to their own public page. How to hold that:'
      + '\n- Make the change when they ask for one. Do not hand back a draft to paste — that is what the tools are for.'
      + '\n- Say plainly what you changed, and what it said before, every single time. A change you did not name is a broken promise.'
      + '\n- Change only what they asked about. Leave the rest, and say so if it matters.'
      + '\n- These reach their PUBLIC page only. You cannot touch their location, care, means, another member, or a space — do not offer to.'
      + (lines.length ? `\n\nThe only category ids that exist:\n${lines.join('\n')}` : '');
  }

  const readPage = async () => {
    const cur = await (await sb(`profiles?id=eq.${profile_id}&select=page,contact`)).json();
    const r = Array.isArray(cur) ? cur[0] : null;
    return {
      page: (r?.page ?? {}) as Record<string, unknown>,
      contact: (r?.contact ?? {}) as Record<string, string>,
    };
  };
  const patchMe = (body: Record<string, unknown>) =>
    sb(`profiles?id=eq.${profile_id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body),
    });
  const catNames = async (ids: string[]) => {
    const found = await (await sb(`categories?select=id,name,domain&id=in.(${ids.map(encodeURIComponent).join(',')})`)).json();
    return (Array.isArray(found) ? found : []) as { id: string; name: string; domain: string }[];
  };

  // Every write is scoped to profile_id from the trigger — no tool takes a
  // target, so the model has no way to name someone else.
  async function runTool(name: string, input: Record<string, string & string[]>): Promise<ToolOutcome> {
    if (name === 'set_tagline' || name === 'set_home_summary' || name === 'set_story') {
      const key = name === 'set_tagline' ? 'tagline' : name === 'set_home_summary' ? 'homeSummary' : 'story';
      const next = String(input[name === 'set_tagline' ? 'tagline' : name === 'set_home_summary' ? 'summary' : 'story'] ?? '').trim();
      if (key === 'tagline' && next.length > TAGLINE_MAX) {
        return { ok: false, error: `A tagline is at most ${TAGLINE_MAX} characters; that one is ${next.length}. Shorten it and try again.` };
      }
      const { page } = await readPage();
      const previous = (page[key] as string | undefined) ?? null;
      const label = key === 'tagline' ? 'tagline' : key === 'homeSummary' ? 'home welcome' : 'story';
      // Empty CLEARS the field, the same way set_contact_field does. Without
      // this, "put it back" can't undo a write onto something that started
      // empty — which is most first edits, and exactly the promise the report
      // is making when it says what the value used to be.
      if (!next) {
        if (previous === null || previous === undefined) {
          return { ok: false, error: `Their ${label} is already empty — nothing to clear.` };
        }
        delete page[key];
        await patchMe({ page });
        return { ok: true, previous, change: `cleared their ${label}` };
      }
      page[key] = next;
      // A story with nowhere to show isn't published (applySnapshot's rule).
      if (key === 'story' && !((page.tabs as unknown[] | undefined)?.length)) {
        page.tabs = [{ id: 'about' }, { id: 'services' }];
      }
      await patchMe({ page });
      return {
        ok: true, previous,
        change: previous ? `rewrote their ${label}` : `wrote their ${label} (it was empty)`,
        note: previous ? 'Tell them what it said before, so they can ask for it back.' : undefined,
      };
    }

    if (name === 'set_contact_field') {
      const field = String(input.field ?? '');
      if (!CONTACT_FIELDS.includes(field)) {
        return { ok: false, error: `"${field}" is not a public contact field. Choose one of: ${CONTACT_FIELDS.join(', ')}.` };
      }
      const value = String(input.value ?? '').trim();
      const { contact } = await readPage();
      const previous = contact[field] ?? null;
      if (value) contact[field] = value; else delete contact[field];
      await patchMe({ contact: Object.keys(contact).length ? contact : null });
      return {
        ok: true, previous,
        change: value ? `set their public ${field} to ${value}` : `cleared their public ${field}`,
      };
    }

    if (name === 'add_categories' || name === 'remove_categories') {
      const ids = [...new Set((Array.isArray(input.category_ids) ? input.category_ids : []).map(String).filter(Boolean))];
      if (!ids.length) return { ok: false, error: 'No category ids given.' };
      const real = await catNames(ids);
      const unknown = ids.filter((id) => !real.some((c) => c.id === id));
      if (!real.length) {
        return { ok: false, unknown, error: 'None of those category ids exist. Use ids exactly as listed in your instructions.' };
      }
      const list = real.map((c) => c.id);
      if (name === 'add_categories') {
        await sb('profile_categories?on_conflict=profile_id,category_id', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify(list.map((category_id) => ({ profile_id, category_id }))),
        });
        // Picking what you offer IS declaring you offer it (applySnapshot).
        const domains = new Set(real.map((c) => c.domain));
        const caps = [
          ...(domains.has('service') ? ['service_provider'] : []),
          ...(domains.has('good') ? ['goods_provider'] : []),
        ];
        if (caps.length) {
          await sb('profile_capabilities?on_conflict=profile_id,capability', {
            method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(caps.map((capability) => ({ profile_id, capability }))),
          });
        }
      } else {
        await sb(`profile_categories?profile_id=eq.${profile_id}&category_id=in.(${list.map(encodeURIComponent).join(',')})`, {
          method: 'DELETE', headers: { Prefer: 'return=minimal' },
        });
      }
      const names = real.map((c) => c.name).join(', ');
      return {
        ok: true, unknown: unknown.length ? unknown : undefined,
        change: `${name === 'add_categories' ? 'added' : 'removed'} ${names}`,
      };
    }

    return { ok: false, error: `No such tool: ${name}` };
  }

  const messages: Record<string, unknown>[] = rows.map((p: { id: string; author: string; body: string; source_post_id: string | null }) =>
    p.author === 'claude'
      ? { role: 'assistant', content: p.body }
      : { role: 'user', content: p.id === feed_post_id ? `${p.body}${sharedPostContext}` : p.body });

  // Tool rounds run INSIDE one exchange: a multi-turn edit costs one entry in
  // the daily cap, the same as a conversation, and the usage is summed.
  const MAX_TOOL_ROUNDS = 4;
  const changes: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let round = 0;
  let data: {
    content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, string & string[]> }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  } = {};

  for (;;) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: canEdit ? 1000 : 400,
        system: [{ type: 'text', text: `${ident.persona}\n\n${BASE_RULES}${standing}${threadRule}${editRule}${elsewhere}\n\n${LICHEN_DOCTRINE}`, cache_control: { type: 'ephemeral' } }],
        messages,
        // Tools stay declared for the whole exchange — the history holds
        // tool_use blocks and the API rejects it otherwise. On the last round
        // tool_choice 'none' forces the report instead of another edit.
        ...(canEdit
          ? { tools: EDIT_TOOLS, ...(round >= MAX_TOOL_ROUNDS ? { tool_choice: { type: 'none' } } : {}) }
          : {}),
      }),
    });
    if (!res.ok) return json({ error: 'Anthropic call failed', detail: (await res.text()).slice(0, 300) }, 502);
    data = await res.json();
    inputTokens += data?.usage?.input_tokens ?? 0;
    outputTokens += data?.usage?.output_tokens ?? 0;

    const calls = (data?.content ?? []).filter((c) => c.type === 'tool_use');
    if (!calls.length) break;

    messages.push({ role: 'assistant', content: data.content });
    // Parallel calls come back in ONE user message — splitting them teaches
    // the model to stop batching.
    const results = [];
    for (const c of calls) {
      const out = await runTool(c.name ?? '', c.input ?? {} as Record<string, string & string[]>);
      if (out.ok && out.change) changes.push(out.change);
      results.push({
        type: 'tool_result', tool_use_id: c.id,
        content: JSON.stringify(out),
        ...(out.ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: 'user', content: results });
    round++;
  }

  // Parse EVERY text block, not content[0] — a non-text leading block silently
  // yielded an empty result in profile-snapshot.
  let reply = (data?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n').trim();
  // No silent edits: if it wrote and then said nothing, say it for them.
  if (!reply && changes.length) reply = `Done — I ${changes.join(', and ')}. Have a look, and tell me what to change.`;
  if (!reply) return json({ ok: true, skipped: 'empty-reply' });

  await sb('assistant_feed_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id, author: 'claude', body: reply, thread,
  }) });

  // UVA seed: record the silicon contribution with its exact cost.
  await sb('assistant_queries', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
    profile_id, context: 'feed', model: MODEL,
    input_tokens: inputTokens || null, output_tokens: outputTokens || null,
  }) });

  return json({ ok: true, replied: true });
});
