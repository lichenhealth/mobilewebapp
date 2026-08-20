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
import { assistantConsentOff } from '../_shared/consent.ts';

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
  {
    name: 'set_page_tab',
    description: 'Create or rewrite a TAB on their public page — any tab they can name ("My horses", "Retreats 2027"), not just the standard set. Matches an existing tab by its title (case-insensitive); otherwise creates a new custom tab. lead is the first line under the heading; body is the rest, paragraphs separated by blank lines. Passing an empty body AND empty lead REMOVES a written tab (built-in tabs like About/Services/Contact fill themselves and cannot be written or removed here). Everything you write appears in their manual editor too — it is the same page.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The tab name as shown to visitors.' },
        lead: { type: 'string', description: 'One first line. Optional.' },
        body: { type: 'string', description: 'The tab text, blank lines between paragraphs. Empty (with empty lead) removes the tab.' },
      },
      required: ['title', 'body'],
    },
  },
];

// CALENDAR TOOLS (founder 2026-08-19, rung 1 of "Claude codes with members"):
// the member's OWN hours and bookable sessions, by conversation. Same doctrine
// as the page tools: armed only in the CALENDAR thread, only behind the same
// opt-in flag, every write scoped to the sender, no tool takes a target.
// Weekdays are 0=Monday … 6=Sunday. Times are minutes since midnight
// (9am = 540). "work" maps to the DB kind 'available'.
const CALENDAR_TOOLS = [
  {
    name: 'my_calendar_setup',
    description: 'Read their current hours and bookable session types. Always call this FIRST before changing anything, and use it to confirm what you did.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'add_hours',
    description: 'Add one weekly hours window. kind: "work" (bookable, meeting-findable), "social" (their web sees them as available), or "on_call" (care-team urgent coverage — ONLY offer or use this if the setup read says they are an active caregiver; for anyone else it will refuse). weekday: 0=Monday … 6=Sunday. start_min/end_min: minutes since midnight (9am=540, 5pm=1020).',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['work', 'social', 'on_call'] },
        weekday: { type: 'number' },
        start_min: { type: 'number' },
        end_min: { type: 'number' },
      },
      required: ['kind', 'weekday', 'start_min', 'end_min'],
    },
  },
  {
    name: 'remove_hours',
    description: 'Remove hours windows. Removes every window matching the given weekday + kind (and start_min when given, to single one out). Read the setup first so you remove exactly what they mean.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['work', 'social', 'on_call'] },
        weekday: { type: 'number' },
        start_min: { type: 'number', description: 'Optional — the exact window to remove.' },
      },
      required: ['kind', 'weekday'],
    },
  },
  {
    name: 'add_booking_type',
    description: 'Create a bookable session type on their profile. Open slots come from their WORK hours minus their calendar, so if the setup read shows no work hours, say so — a session type with no hours can never be booked. price is words, not billing ("$90", "Free", "sliding $20–60"). audience: everyone = any Lichen member, mycelium = their web only, public = the open web via their booking link.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        duration_min: { type: 'number', description: '15–480 minutes.' },
        price: { type: 'string' },
        approval: { type: 'string', enum: ['request', 'instant'], description: 'request = they approve each booking; instant = it books straight in.' },
        audience: { type: 'string', enum: ['everyone', 'mycelium', 'public'] },
      },
      required: ['title', 'duration_min', 'approval', 'audience'],
    },
  },
  {
    name: 'set_booking_type_active',
    description: 'Switch one of their session types off (or back on) by its exact title from the setup read. Off means nobody can book it; its history is untouched. You cannot delete a type — deleting takes its booking history with it, so that stays a by-hand act in Calendar settings.',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, active: { type: 'boolean' } },
      required: ['title', 'active'],
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

  // PER-IDENTITY AI CONSENT (founder 2026-08-17). The member wrote into this
  // thread deliberately, so silence would be the failure mode: answer ONCE
  // with the honest state and where to change it, never again until they do.
  if (await assistantConsentOff(profile_id, [{ type: 'section', id: trigger.thread ?? 'general' }])) {
    const note = 'You’ve switched the assistant off for this part of your Lichen life, so I won’t work here. The brain on that section’s page is where you can change that, anytime.';
    const last = await (await sb(`assistant_feed_posts?profile_id=eq.${profile_id}&thread=eq.${trigger.thread ?? 'general'}&author=eq.claude&select=body&order=created_at.desc&limit=1`)).json();
    if (Array.isArray(last) && last[0]?.body === note) return json({ ok: true, skipped: 'consent-off' });
    await sb('assistant_feed_posts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
      profile_id, author: 'claude', thread: trigger.thread ?? 'general', body: note,
    }) });
    return json({ ok: true, skipped: 'consent-off' });
  }

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

  // BUILDING WHAT DOESN'T EXIST YET (founder 2026-08-19): shape it here,
  // loop Galyn in at the help room — this thread is private by construction,
  // so SHE CANNOT SEE IT; the member carries the idea over, by choice.
  const featureRule = '\n\nWHEN THEY WANT SOMETHING LICHEN DOES NOT HAVE YET: think it through WITH them — what are they actually trying to do, what would the smallest good version be. When the idea has a real shape, tell them plainly: this thread is private, so Galyn (who builds Lichen with Claude) has not seen it — and invite them to bring the shaped idea to their Lichen Help room, where she reads every conversation and the three of you can take it further. Offer to summarize the idea in a few crisp lines they can paste there. Never claim she can see this thread, never promise a feature will be built or when, and never submit anything anywhere on their behalf.';

  // THE HAND THAT WRITES (docs/ASSISTANT_ACTIONS.md). Off unless the member
  // turned it on, and only in the thread this work belongs to — asked in
  // Marketplace, the threadRule above points them at Profile instead of
  // quietly rewriting their page from the wrong room.
  let canEdit = false;
  let canCalendar = false;
  {
    const me = await (await sb(`profiles?id=eq.${profile_id}&select=assistant_can_edit`)).json();
    const flag = !!(Array.isArray(me) ? me[0]?.assistant_can_edit : false);
    canEdit = thread === 'profile' && flag;
    // Rung 1 of "Claude codes with members" (founder 2026-08-19): the same
    // hand-that-writes flag arms CALENDAR tools in the calendar thread.
    canCalendar = thread === 'calendar' && flag;
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

  let calendarRule = '';
  if (canCalendar) {
    calendarRule = '\n\nYOU CAN ACTUALLY CHANGE THEIR CALENDAR SETTINGS. They have turned on "Let Claude edit my page directly", which arms your calendar tools here. How to hold it:'
      + '\n- Read my_calendar_setup FIRST, act, then read again if needed and report plainly what changed.'
      + '\n- Make the change when they ask; never hand back instructions to click through instead.'
      + '\n- Change only what they asked about. Name every change; a change you did not name is a broken promise.'
      + '\n- No hours means NOT available and NOT bookable — unknown is never yes on Lichen. If they want to be bookable, work hours come first.'
      + '\n- on_call belongs to active caregivers only; the tool refuses otherwise — do not offer it to anyone else.';
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

    if (name === 'set_page_tab') {
      const title = String(input.title ?? '').trim().slice(0, 60);
      if (!title) return { ok: false, error: 'A tab needs a name.' };
      const lead = String(input.lead ?? '').trim();
      const bodyText = String(input.body ?? '').trim();
      const BUILT_IN = ['about', 'services', 'goods', 'contact', 'gallery'];
      const { page } = await readPage();
      const tabs = (Array.isArray(page.tabs) ? page.tabs : []) as { id: string; label?: string; lead?: string; body?: string }[];
      const norm = (x: string) => x.toLowerCase().trim();
      const hit = tabs.find((t) => norm(t.label ?? '') === norm(title) || norm(t.id) === norm(title));
      if (hit && BUILT_IN.includes(hit.id)) {
        return { ok: false, error: `"${title}" is a built-in tab — it fills itself from their profile and cannot be written or removed here.` };
      }
      if (!bodyText && !lead) {
        if (!hit) return { ok: false, error: `No tab named "${title}" to remove.` };
        page.tabs = tabs.filter((t) => t !== hit);
        await patchMe({ page });
        return { ok: true, previous: hit.body ?? null, change: `removed the "${hit.label ?? hit.id}" tab` };
      }
      if (hit) {
        const previous = { lead: hit.lead ?? null, body: hit.body ?? null };
        hit.label = title; hit.lead = lead || undefined; hit.body = bodyText || undefined;
        await patchMe({ page });
        return { ok: true, previous, change: `rewrote the "${title}" tab`, note: 'Tell them what it said before if it held anything.' };
      }
      const id = 'custom-' + Math.random().toString(36).slice(2, 8);
      page.tabs = [...tabs, { id, label: title, lead: lead || undefined, body: bodyText || undefined }];
      await patchMe({ page });
      return { ok: true, previous: null, change: `created the "${title}" tab and put it on their page` };
    }

    // ── Calendar tools (rung 1, founder 2026-08-19) — sender-scoped, no targets.
    const minLabel = (m: number) => {
      const h = Math.floor(m / 60) % 24, mm = m % 60;
      const ap = h < 12 ? 'am' : 'pm'; const hh = h % 12 === 0 ? 12 : h % 12;
      return `${hh}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
    };
    const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const kindIn = (k: string) => k === 'work' ? 'available' : k;
    const kindOut = (k: string) => k === 'available' ? 'work' : k;

    if (name === 'my_calendar_setup') {
      const [hours, types, care] = await Promise.all([
        (await sb(`availability_windows?profile_id=eq.${profile_id}&select=weekday,start_min,end_min,kind&order=weekday,start_min`)).json(),
        (await sb(`booking_types?profile_id=eq.${profile_id}&select=title,duration_min,price,approval,audience,active&order=created_at`)).json(),
        (await sb(`care_team_members?caregiver_id=eq.${profile_id}&status=eq.active&select=id&limit=1`)).json(),
      ]);
      const hs = (Array.isArray(hours) ? hours : []) as { weekday: number; start_min: number; end_min: number; kind: string }[];
      return {
        ok: true,
        hours: hs.length
          ? hs.map((h) => `${kindOut(h.kind)}: ${DAYS[h.weekday]} ${minLabel(h.start_min)}–${minLabel(h.end_min)}`)
          : 'none set — they are not bookable and never counted available',
        booking_types: (Array.isArray(types) ? types : []).map((t: { title: string; duration_min: number; price: string | null; approval: string; audience: string; active: boolean }) =>
          `${t.title} (${t.duration_min}min, ${t.price || 'no price words'}, ${t.approval}, ${t.audience}${t.active ? '' : ', OFF'})`),
        is_active_caregiver: Array.isArray(care) && care.length > 0,
      };
    }

    if (name === 'add_hours') {
      const kind = String(input.kind ?? '');
      const weekday = Number(input.weekday), start = Number(input.start_min), end = Number(input.end_min);
      if (!['work', 'social', 'on_call'].includes(kind)) return { ok: false, error: 'kind must be work, social, or on_call.' };
      if (!(weekday >= 0 && weekday <= 6)) return { ok: false, error: 'weekday must be 0 (Monday) through 6 (Sunday).' };
      if (!(start >= 0 && end > start && end <= 1440)) return { ok: false, error: 'Times must satisfy 0 <= start < end <= 1440 (minutes since midnight).' };
      if (kind === 'on_call') {
        const care = await (await sb(`care_team_members?caregiver_id=eq.${profile_id}&status=eq.active&select=id&limit=1`)).json();
        if (!Array.isArray(care) || care.length === 0) {
          return { ok: false, error: 'On call is a care-team duty — they are not an active caregiver on anyone\'s team, so this kind is not theirs to set. Offer work or social instead.' };
        }
      }
      const r = await sb('availability_windows', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ profile_id, weekday, start_min: start, end_min: end, kind: kindIn(kind) }),
      });
      if (!r.ok) return { ok: false, error: `The database refused: ${(await r.text()).slice(0, 140)}` };
      return { ok: true, change: `added ${kind} hours: ${DAYS[weekday]} ${minLabel(start)}–${minLabel(end)}` };
    }

    if (name === 'remove_hours') {
      const kind = String(input.kind ?? '');
      const weekday = Number(input.weekday);
      const start = input.start_min !== undefined ? Number(input.start_min) : null;
      if (!['work', 'social', 'on_call'].includes(kind) || !(weekday >= 0 && weekday <= 6)) {
        return { ok: false, error: 'Give a valid kind and weekday (0=Monday … 6=Sunday).' };
      }
      const q = `availability_windows?profile_id=eq.${profile_id}&weekday=eq.${weekday}&kind=eq.${kindIn(kind)}` + (start !== null ? `&start_min=eq.${start}` : '');
      const rows = await (await sb(q + '&select=id')).json();
      const n = Array.isArray(rows) ? rows.length : 0;
      if (!n) return { ok: false, error: 'No matching hours window — read my_calendar_setup and match exactly what is there.' };
      const r = await sb(q, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      if (!r.ok) return { ok: false, error: 'The delete failed — try again.' };
      return { ok: true, change: `removed ${n} ${kind} window${n === 1 ? '' : 's'} on ${DAYS[weekday]}` };
    }

    if (name === 'add_booking_type') {
      const title = String(input.title ?? '').trim().slice(0, 80);
      const duration = Number(input.duration_min);
      const approval = String(input.approval ?? '');
      const audience = String(input.audience ?? '');
      if (!title) return { ok: false, error: 'A session needs a title.' };
      if (!(duration >= 15 && duration <= 480)) return { ok: false, error: 'duration_min must be 15–480.' };
      if (!['request', 'instant'].includes(approval) || !['everyone', 'mycelium', 'public'].includes(audience)) {
        return { ok: false, error: 'approval must be request|instant; audience everyone|mycelium|public.' };
      }
      const r = await sb('booking_types', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ profile_id, title, duration_min: duration, price: String(input.price ?? '').trim() || null, approval, audience, active: true }),
      });
      if (!r.ok) return { ok: false, error: `The database refused: ${(await r.text()).slice(0, 140)}` };
      const hours = await (await sb(`availability_windows?profile_id=eq.${profile_id}&kind=eq.available&select=id&limit=1`)).json();
      return {
        ok: true, change: `created the bookable session "${title}" (${duration}min, ${approval}, ${audience})`,
        note: (Array.isArray(hours) && hours.length) ? undefined : 'They have NO work hours — nothing is bookable until they add some. Say so.',
      };
    }

    if (name === 'set_booking_type_active') {
      const title = String(input.title ?? '').trim();
      const active = !!input.active;
      const rows = await (await sb(`booking_types?profile_id=eq.${profile_id}&title=eq.${encodeURIComponent(title)}&select=id,active`)).json();
      if (!Array.isArray(rows) || rows.length === 0) return { ok: false, error: `No session type titled "${title}" — read my_calendar_setup and use the exact title.` };
      const r = await sb(`booking_types?profile_id=eq.${profile_id}&title=eq.${encodeURIComponent(title)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ active }),
      });
      if (!r.ok) return { ok: false, error: 'The update failed — try again.' };
      return { ok: true, change: `${active ? 'switched on' : 'switched off'} the session "${title}"` };
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
        // 400 silently starved long asks into 'empty-reply' (the wow-window
        // lesson, again — 2026-08-20: a multi-part message got no reply at
        // all). Headroom is cheap; silence is not.
        max_tokens: (canEdit || canCalendar) ? 1600 : 1000,
        system: [{ type: 'text', text: `${ident.persona}\n\n${BASE_RULES}${standing}${threadRule}${editRule}${calendarRule}${featureRule}${elsewhere}\n\n${LICHEN_DOCTRINE}`, cache_control: { type: 'ephemeral' } }],
        messages,
        // Tools stay declared for the whole exchange — the history holds
        // tool_use blocks and the API rejects it otherwise. On the last round
        // tool_choice 'none' forces the report instead of another edit.
        ...((canEdit || canCalendar)
          ? { tools: canEdit ? EDIT_TOOLS : CALENDAR_TOOLS, ...(round >= MAX_TOOL_ROUNDS ? { tool_choice: { type: 'none' } } : {}) }
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
