import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { listSpacesByKind } from '../lib/spacesApi';
import { Icon } from '../components/Icon';
import AssistantComposer from '../components/AssistantComposer';
import { threadForSection } from '../lib/assistantFeedApi';
import { useAuth } from '../auth/AuthProvider';
import { useNotifications } from '../notifications/NotificationsProvider';
import {
  listMyAdminDeskCounts, listMyMemberSpaces,
  listPendingRequests, listPendingSectionShares,
} from '../lib/spacesApi';
import { listPendingResourceBookings } from '../lib/resourcesApi';
import { listReminders, remindersOn } from '../lib/remindersApi';
import { occursOn } from '../lib/recurrence';
import { postToAssistantFeed } from '../lib/assistantFeedApi';
import { type Scope, type Section } from '../lib/sections';
import { aiDoorOn, setAiDoor } from '../components/AssistantDoor';
import './AssistantBrief.css';
import './Snapshot.css';
import { loadChatList, recentMessagesAcross } from '../lib/chatApi';
import { loadMyWeb, loadMyRecommendations } from '../lib/myceliumApi';
import { listBookableTypes } from '../lib/bookingApi';

// The assistant on every page (founder 2026-07-28): tap the brain, get the
// back-from-vacation briefing for WHERE YOU ARE — organized highlights,
// filtered for what needs you. The client gathers what it already holds
// (RLS-scoped reads it made anyway); Claude organizes; the member decides.

/** Turn the entity names the CLIENT gathered into real doors inside the
 *  brief's prose. Deterministic: only labels we already hold become links, so
 *  the assistant can never invent a destination (founder 2026-08-05). */
function linkify(text: string, refs: { label: string; to: string }[]): React.ReactNode[] {
  if (!refs.length) return [text];
  let parts: React.ReactNode[] = [text];
  for (const ref of refs) {
    const next: React.ReactNode[] = [];
    for (const part of parts) {
      if (typeof part !== 'string') { next.push(part); continue; }
      let rest = part;
      let at = rest.toLowerCase().indexOf(ref.label.toLowerCase());
      while (at >= 0) {
        if (at > 0) next.push(rest.slice(0, at));
        next.push(
          <Link key={`${ref.to}-${next.length}`} className="abrief__ref" to={ref.to}>
            {rest.slice(at, at + ref.label.length)}
          </Link>,
        );
        rest = rest.slice(at + ref.label.length);
        at = rest.toLowerCase().indexOf(ref.label.toLowerCase());
      }
      if (rest) next.push(rest);
    }
    parts = next;
  }
  return parts;
}

const FRAMES: Record<string, { title: string; frame: string }> = {
  home: { title: 'Your Lichen life', frame: 'The whole-life view: surface the biggest things across care, exchanges, groups and calendar.' },
  market: { title: 'The Marketplace', frame: 'You help them offer, seek, buy, sell, trade and gift within the web of people they trust.' },
  calendar: { title: 'Your calendar', frame: 'You help them tend time: what is coming, what is unanswered, what needs scheduling.' },
  chat: { title: 'Conversations', frame: 'You help them stay in real relationship. You are given recent exchanges across their rooms: say who is waiting on a reply, what each live thread is actually about, and anything that looks time-sensitive. Summarize in your own words — do not quote at length, and treat what people share as theirs.' },
  concierge: { title: 'Care', frame: 'You help them tend care — their own and the people they care for.' },
  communities: { title: 'Your communities', frame: 'You help them tend belonging: what their groups and communities need from them.' },
  groups: { title: 'Your groups', frame: 'You help them tend belonging: what their groups need from them. Lead with activity across the groups they are IN; then, for any they STEWARD, one concrete piece of stewardship worth doing — a queue waiting, a quiet room, a member at the door. Practical, never a lecture on running groups.' },
  organizations: { title: 'Your organizations', frame: 'You help them tend belonging: what the organizations they steward or belong to need from them.' },
  places: { title: 'Your places', frame: 'You help them tend the places they steward or gather in.' },
  events: { title: 'Events', frame: 'You help them gather: invitations, RSVPs, what is coming up.' },
  membership: { title: 'Membership', frame: 'You help them steward their stake in the commons.' },
  maps: { title: 'The map', frame: 'You help them see what has appeared around them: places newly pinned, gatherings with a location coming up, and members who have put themselves on the map. Lead with what is NEW since they last looked, then what is worth going to. Never guess at distances you were not given.' },
  saved: { title: 'Your shelf', frame: 'You help them return to what they kept: saved pieces, collections worth organizing.' },
  profile: { title: 'Your presence', frame: 'You help them tend how they show up: profile, offerings, identity.' },
  // ONE PERSON, not a section (founder 2026-08-14: "like getting a briefing
  // on someone you're meeting with from your assistant"). Reached from the
  // brain on another member's profile, with ?member=<id>.
  course: { title: 'This course', frame: 'You are briefing the member on ONE course they are walking or teaching. The snapshot holds the course itself (what it is, who leads it, its modules and the lessons in order), where THIS member stands in it (what they have completed, what is next), and its cohort life if there is any. If they teach it, speak to the shape of the material and what is thin or missing; if they are learning it, pick up where they left off — name the next lesson and what it covers, in a sentence. Never invent a lesson that is not in the outline.' },
  // ONE SPACE, not a section (founder 2026-08-22: the brain on Countryman
  // Stables' page said "Your organizations", which briefed everything except
  // the place the member was standing in). Reached with ?space=<id>.
  space: { title: 'This space', frame: 'You are briefing the member on ONE space — an organization, community, group or place. The snapshot holds what it is in its own words, where THIS member stands with it (member or steward, their own web and recommendation signals — never anyone else\'s), its recent activity, and — when they steward it — what is waiting at its desks and the state of its public page. Lead with what is alive and what needs them; for a steward, name one concrete act of tending worth doing. Never invent activity, never score the space, and never describe another member\'s standing.' },
  member: { title: 'A briefing', frame: 'You are preparing the member to meet ONE person — a relationship briefing, the way a trusted assistant preps you before a meeting. The snapshot holds who they are in their own words, where the relationship stands (web/trust/recommendation signals — the member\'s own, never anyone else\'s), spaces you share, what they\'ve been offering lately, their bookable sessions, and recent conversation if there is any. Lead with where things stand and anything alive between you; then what\'s new with them worth knowing. Warm, factual, short. Use the pronouns given in the snapshot and never infer them from a name. Never invent, never score the person, and if their messages are withheld from assistants say so plainly.' },
};

// One brief per section, kept until the notifications feeding it actually
// change — never re-billed on a plain revisit, but never allowed to go
// stale either (founder report 2026-08-09: briefs were showing old news).
interface CachedBrief {
  text: string;
  refs: { label: string; to: string }[];
  fingerprint: string;
  at: number;
}
const cache = new Map<string, CachedBrief>();

function timeAgo(at: number): string {
  const mins = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hrs = Math.round(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

export default function AssistantBrief() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Entities the brief may name, with where they live. Built from what the
  // CLIENT already gathered — never from the model — so a link can't be
  // invented (founder 2026-08-05: "can all of the linkable content within
  // the AI update show up with a blue link?").
  const [refs, setRefs] = useState<{ label: string; to: string }[]>(() => cache.get(params.get('section') ?? 'home')?.refs ?? []);
  const section = params.get('section') ?? 'home';
  // ?member=<id> — the relationship briefing for one person.
  const memberId = params.get('member');
  // ?space=<id> — the briefing on one space (founder 2026-08-22): the brain
  // on a space's page briefs THAT space, not the whole section.
  const spaceParam = params.get('space');
  // ?back= — the way home to whatever sent you here (a builder's "Back to
  // manual mode"); ?intent=build — you came from a Build-with-Claude door,
  // so the page leads with the build card (founder 2026-08-17: the same
  // brain door as anywhere, with the context that you're here to build).
  const backTo = params.get('back') || '';
  const buildIntent = params.get('intent') === 'build';
  // ?collection=<id> — the update on one course's content (founder 2026-08-15).
  const collectionId = params.get('collection');
  // ?mine=0 — the ALL-of-them view of a spaces section (founder 2026-08-15).
  // Different subject, different briefing: yours is activity + stewardship,
  // all is what's new and what might fit you.
  const allScope = params.get('mine') === '0';
  const SPACE_SECTIONS = ['communities', 'groups', 'organizations', 'places'];
  const spacesAll = allScope && SPACE_SECTIONS.includes(section);
  const briefKey = memberId ? `member:${memberId}`
    : spaceParam ? `space:${spaceParam}`
    : collectionId ? `course:${collectionId}`
    : spacesAll ? `${section}:all` : section;
  const { user } = useAuth();
  const me = user?.id ?? '';
  const { rows } = useNotifications();
  const [doorOn, setDoorOn] = useState(() => aiDoorOn(section));
  const cached = cache.get(briefKey);
  const [brief, setBrief] = useState<string | null>(cached?.text ?? null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(cached?.at ?? null);
  const [state, setState] = useState<'thinking' | 'ready' | 'quietly-unavailable' | 'capped'>(
    cached ? 'ready' : 'thinking');
  const [refreshTick, setRefreshTick] = useState(0);

  const meta = memberId ? FRAMES.member
    : spaceParam ? FRAMES.space
    : collectionId ? FRAMES.course
    : spacesAll ? { title: `All ${section}`, frame: `You are looking at EVERY ${section.replace(/s$/, '')} on Lichen, not just the member's own. Two jobs: say what has newly appeared or grown, and flag the few that look like a genuine fit for THIS member — name why, from what you were given (their web, what they already belong to, what they offer). Never pad the list to look useful: two real suggestions beat eight. Never imply they should join anything.` }
    : (FRAMES[section] ?? FRAMES.home);
  // The person's name arrives fast and cheap so the header reads right even
  // on a cache hit.
  const [briefWho, setBriefWho] = useState<string | null>(null);
  useEffect(() => {
    if (!memberId && !spaceParam) { setBriefWho(null); return; }
    let live = true;
    if (memberId) {
      void supabase.from('profiles').select('full_name').eq('id', memberId).maybeSingle()
        .then(({ data }) => { if (live) setBriefWho((data as { full_name: string | null } | null)?.full_name ?? null); });
    } else if (spaceParam) {
      void supabase.from('spaces').select('name').eq('id', spaceParam).maybeSingle()
        .then(({ data }) => { if (live) setBriefWho((data as { name: string | null } | null)?.name ?? null); });
    }
    return () => { live = false; };
  }, [memberId, spaceParam]);

  const { snapshot, fingerprint } = useMemo(() => {
    if (memberId) {
      return { snapshot: {}, fingerprint: `member:${memberId}:${new Date().toISOString().slice(0, 10)}` };
    }
    if (spaceParam) {
      return { snapshot: {}, fingerprint: `space:${spaceParam}:${new Date().toISOString().slice(0, 10)}` };
    }
    if (collectionId) {
      return { snapshot: {}, fingerprint: `course:${collectionId}:${new Date().toISOString().slice(0, 10)}` };
    }
    if (spacesAll) {
      return { snapshot: {}, fingerprint: `${section}:all:${new Date().toISOString().slice(0, 10)}` };
    }
    const scope: Scope = section === 'home'
      ? { kind: 'global' } : { kind: 'section', section: section as Section };
    // ONLY WHAT THEY HAVEN'T SEEN (founder 2026-08-19: "the assistant is
    // aware in real time of what their member hasn't seen and needs to
    // know"). A read bell is a seen bell — it never re-enters a brief, no
    // matter how recent; an unread one does, no matter how old. Reading
    // your bells shrinks this set, the fingerprint moves, and the next
    // brief regenerates — that's the real-time part. Live queue truth
    // (the admin desks) rides in as extras below.
    const scoped = rows.filter((r) => (scope.kind === 'global'
      || (r.space_id == null && r.section === section))
      && !r.read_at);
    const relevant = scoped
      .slice(0, 25)
      .map((r) => ({
        type: r.type, title: r.title, body: (r.body ?? '').slice(0, 120),
        when: r.created_at.slice(0, 10),
      }));
    // Every bell here is UNSEEN — that's the contract; say so to the model.
    // What the cache is invalidated against: which notifications feed this
    // section's brief. A new or removed one means the world has moved since
    // the cached text was written — refetch instead of showing old news.
    return { snapshot: { unseen_notifications: relevant }, fingerprint: scoped.slice(0, 25).map((r) => r.id).join(',') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, section, memberId, spaceParam, collectionId, spacesAll]);

  function refresh() {
    cache.delete(briefKey);
    setState('thinking');
    setRefreshTick((t) => t + 1);
  }

  useEffect(() => {
    if (!me || !doorOn || cache.get(briefKey)?.fingerprint === fingerprint) return;
    let live = true;
    void (async () => {
      // Stewarding load joins the snapshot (duty-scoped, invites excluded).
      const found: { label: string; to: string }[] = [];
      let desk: Record<string, number> | undefined;
      let deskNames: Record<string, string> | undefined;
      try {
        if (memberId || collectionId || spacesAll || spaceParam) throw new Error('scoped brief — no desks');
        const d = await listMyAdminDeskCounts(me);
        if (Object.keys(d.counts).length) {
          const spaces = await listMyMemberSpaces(me);
          desk = d.counts;
          deskNames = Object.fromEntries(spaces
            .filter((s) => d.counts[s.id])
            .map((s) => [s.id, s.name]));
          found.push(...spaces.map((sp) => ({ label: sp.name, to: `/spaces/${sp.id}` })));
        }
      } catch { /* snapshot stays lighter */ }

      // ── Stage 2 (founder 2026-07-28): each section's brain gets real eyes.
      //    Every extra is best-effort — a failed read just means a lighter
      //    brief, never a broken one. All reads are RLS-scoped as the member.
      const extras: Record<string, unknown> = {};
      const today = new Date().toISOString().slice(0, 10);
      try {
        if (memberId) {
          // ── The relationship briefing (founder 2026-08-14) ──────────────
          // Every read is RLS-scoped as the viewer: their profile as you may
          // see it, YOUR signals about them, the spaces you share (their
          // memberships are only visible where yours overlap), their recent
          // public posts (per-post AI consent respected), their bookable
          // sessions, and your direct thread — content included only if they
          // let assistants read their messages.
          const [{ data: prof }, mine, recs, { data: shared }, { data: theirPosts }, bookables] = await Promise.all([
            supabase.from('profiles').select('full_name, pronouns, headline, bio, identity_tags, assistant_readable').eq('id', memberId).maybeSingle(),
            loadMyWeb(),
            loadMyRecommendations(),
            supabase.from('space_members').select('spaces(id, name)').eq('profile_id', memberId),
            supabase.from('posts').select('id, title, body, service_areas, created_at, details').eq('author_id', memberId).order('created_at', { ascending: false }).limit(8),
            listBookableTypes(memberId).catch(() => []),
          ]);
          const who = prof as { full_name: string | null; pronouns: string | null; headline: string | null; bio: string | null; identity_tags: string[] | null; assistant_readable: boolean | null } | null;
          const name = who?.full_name ?? 'This member';
          extras.who = {
            name,
            // Stated, or they/them — NEVER inferred from the name.
            pronouns: who?.pronouns?.trim() || 'they/them (not stated — do not guess from their name)',
            headline: who?.headline ?? undefined,
            bio: (who?.bio ?? '').slice(0, 400) || undefined,
            identity_tags: who?.identity_tags?.length ? who.identity_tags : undefined,
          };
          found.push({ label: name, to: `/members/${memberId}` });
          extras.where_you_stand = {
            in_your_web: mine.web.has(`profile:${memberId}`),
            you_trust_them: mine.vouched.has(`profile:${memberId}`),
            you_recommend_their_work: [...recs].some((k) => k.includes(memberId)),
          };
          const sharedNames = ((shared as unknown as { spaces: { id: string; name: string } | null }[] | null) ?? [])
            .map((r) => r.spaces).filter((x): x is { id: string; name: string } => !!x);
          if (sharedNames.length) {
            extras.spaces_you_share = sharedNames.map((x) => x.name);
            sharedNames.forEach((x) => found.push({ label: x.name, to: `/spaces/${x.id}` }));
          }
          const posts = ((theirPosts as { id: string; title: string | null; body: string; service_areas: string[] | null; created_at: string; details: { aiExcluded?: boolean } | null }[] | null) ?? [])
            .filter((p) => !p.details?.aiExcluded);
          if (posts.length) {
            extras.their_recent_posts = posts.slice(0, 6).map((p) => ({
              title: p.title || p.body.slice(0, 60), areas: p.service_areas ?? [], on: p.created_at.slice(0, 10),
            }));
            posts.slice(0, 6).forEach((p) => { if (p.title) found.push({ label: p.title, to: `/posts/${p.id}` }); });
          }
          if (bookables.length) {
            extras.their_bookable_sessions = bookables.map((b) => `${b.title} (${b.duration_min} min)`);
          }
          // The direct thread, if one exists — a read-only key lookup.
          const key = [me, memberId].sort().join(':');
          const { data: dm } = await supabase.from('chats').select('id').eq('direct_key', key).maybeSingle();
          if (dm) {
            const { data: msgs } = await supabase.from('chat_messages')
              .select('sender_id, body, created_at')
              .eq('chat_id', (dm as { id: string }).id)
              .order('created_at', { ascending: false }).limit(12);
            const rows2 = (msgs as { sender_id: string; body: string | null; created_at: string }[] | null) ?? [];
            if (rows2.length) {
              if (who?.assistant_readable === false) {
                extras.your_conversation = {
                  messages_exchanged_recently: rows2.length,
                  last_message: rows2[0].created_at.slice(0, 10),
                  note: `${name} keeps their messages private from assistants — you can read the thread in the app, I can't.`,
                };
              } else {
                extras.your_conversation = rows2.reverse().map((m) => `${m.sender_id === me ? 'me' : name}: ${(m.body ?? '').slice(0, 200)}`);
              }
            }
          }
        }
        if (spaceParam) {
          // ── The space briefing (founder 2026-08-22) ─────────────────────
          // One space, as the VIEWER may see it — every read RLS-scoped:
          // the space's own words, where I stand with it, its recent posts
          // (per-post AI consent respected), and — for a steward — what is
          // waiting at its desks.
          const [{ data: sp }, { data: myRow }, mine, recs, { data: spPosts }] = await Promise.all([
            supabase.from('spaces')
              .select('name, kind, description, page, contact, findable, public_page')
              .eq('id', spaceParam).maybeSingle(),
            supabase.from('space_members').select('role')
              .eq('space_id', spaceParam).eq('profile_id', me).maybeSingle(),
            loadMyWeb(),
            loadMyRecommendations(),
            supabase.from('posts')
              .select('id, title, body, service_areas, created_at, details')
              .or(`author_space_id.eq.${spaceParam},space_id.eq.${spaceParam}`)
              .order('created_at', { ascending: false }).limit(8),
          ]);
          const s = sp as { name: string; kind: string; description: string | null;
            page: { tagline?: string; story?: string; tabs?: { id: string; label?: string }[] } | null;
            contact: Record<string, string> | null; findable: boolean | null; public_page: boolean | null } | null;
          if (s) {
            const role = (myRow as { role?: string } | null)?.role ?? null;
            const isSteward = role === 'admin' || role === 'super_admin';
            const page = s.page ?? {};
            extras.the_space = {
              name: s.name, kind: s.kind,
              description: (s.description ?? '').slice(0, 400) || undefined,
              tagline: page.tagline || undefined,
              page_tabs: page.tabs?.length ? page.tabs.map((t) => t.label ?? t.id) : undefined,
              public_page_live: s.public_page === true,
              findable: s.findable !== false,
            };
            found.push({ label: s.name, to: `/spaces/${spaceParam}` });
            extras.where_you_stand = {
              your_role: role ?? 'not a member',
              in_your_web: mine.web.has(`space:${spaceParam}`),
              you_recommend_it: [...recs].some((k) => k.includes(spaceParam)),
            };
            const posts = ((spPosts as { id: string; title: string | null; body: string; service_areas: string[] | null; created_at: string; details: { aiExcluded?: boolean } | null }[] | null) ?? [])
              .filter((p) => !p.details?.aiExcluded);
            if (posts.length) {
              extras.its_recent_posts = posts.slice(0, 6).map((p) => ({
                title: p.title || p.body.slice(0, 60), areas: p.service_areas ?? [], on: p.created_at.slice(0, 10),
              }));
              posts.slice(0, 6).forEach((p) => { if (p.title) found.push({ label: p.title, to: `/posts/${p.id}` }); });
            }
            if (isSteward) {
              // The desks, for this one space — best-effort, duty truth
              // rides the shared counter.
              try {
                const d = await listMyAdminDeskCounts(me);
                if (d.counts[spaceParam]) extras.waiting_at_its_desks = d.counts[spaceParam];
              } catch { /* lighter */ }
            }
          }
        }
        if (collectionId) {
          // ── The course update (founder 2026-08-15) ──────────────────────
          // What the course IS, its outline in order, and where this member
          // stands in it. All RLS-scoped as the viewer; per-post AI consent
          // is respected the same way it is everywhere else.
          // `collection_items.target_id` is polymorphic — no FK, so no embed.
          // Ids first, then the posts, in the collection's own order.
          const [{ data: col }, { data: items }, { data: prog }] = await Promise.all([
            supabase.from('collections')
              .select('name, description, kind, details, owner_id, owner:profiles!collections_owner_id_fkey(full_name)')
              .eq('id', collectionId).maybeSingle(),
            supabase.from('collection_items')
              .select('position, target_id')
              .eq('collection_id', collectionId).eq('target_type', 'post')
              .order('position', { ascending: true }),
            supabase.from('collection_progress')
              .select('post_id').eq('collection_id', collectionId).eq('profile_id', me),
          ]);
          const order = ((items as { target_id: string }[] | null) ?? []).map((r) => r.target_id);
          const { data: lessonRows } = order.length
            ? await supabase.from('posts').select('id, title, body, details').in('id', order)
            : { data: [] };
          const c = col as { name: string; description: string | null; kind: string;
            details: Record<string, unknown> | null; owner_id: string;
            owner: { full_name: string | null } | null } | null;
          if (c) {
            const doneIds = new Set(((prog as { post_id: string }[] | null) ?? []).map((r) => r.post_id));
            const byId = new Map(((lessonRows as {
              id: string; title: string | null; body: string;
              details: Record<string, unknown> | null }[] | null) ?? []).map((p) => [p.id, p]));
            const lessons = order.map((x) => byId.get(x)).filter(Boolean) as {
              id: string; title: string | null; body: string; details: Record<string, unknown> | null }[];
            extras.the_course = {
              name: c.name,
              what_it_is: c.description ?? undefined,
              led_by: c.owner?.full_name ?? undefined,
              you_lead_it: c.owner_id === me,
              modules: (c.details?.modules as { title: string }[] | undefined)?.map((m) => m.title),
              level: c.details?.level, format: c.details?.format, price: c.details?.price,
            };
            extras.the_outline = lessons.map((l, i) => ({
              n: i + 1,
              title: l.title || l.body.slice(0, 60),
              about: l.details?.aiExcluded ? undefined : l.body.slice(0, 200),
              module: (l.details?.module as string | undefined),
              you_completed: doneIds.has(l.id),
            }));
            const next = lessons.find((l) => !doneIds.has(l.id));
            extras.where_you_are = {
              completed: doneIds.size, of: lessons.length,
              up_next: next ? (next.title || next.body.slice(0, 60)) : 'nothing — you have finished it',
            };
            found.push({ label: c.name, to: `/collections/${collectionId}` });
            lessons.forEach((l) => { if (l.title) found.push({ label: l.title, to: `/posts/${l.id}` }); });
          }
        }
        if (spacesAll) {
          // EVERY one of the kind, plus enough about the member to judge fit
          // — their own memberships and their web. RLS-scoped throughout;
          // `findable` is honoured by listSpacesByKind itself.
          const KIND = section === 'communities' ? 'community'
            : section === 'groups' ? 'group'
            : section === 'organizations' ? 'organization' : 'place';
          const [all, { data: mineRows }, { web }] = await Promise.all([
            listSpacesByKind(KIND as 'community' | 'group' | 'organization' | 'place'),
            supabase.from('space_members').select('space_id').eq('profile_id', me),
            loadMyWeb(),
          ]);
          const mineIds = new Set(((mineRows as { space_id: string }[] | null) ?? []).map((r) => r.space_id));
          extras.every_one_of_them = all.map((sp) => ({
            name: sp.name,
            about: sp.description ?? undefined,
            members: sp.member_count,
            nested_in: sp.parent?.name ?? undefined,
            where: sp.location ?? undefined,
            you_belong: mineIds.has(sp.id),
            in_your_web: web.has('space:' + sp.id),
          }));
          extras.where_you_already_are = all.filter((sp) => mineIds.has(sp.id)).map((sp) => sp.name);
          all.forEach((sp) => found.push({ label: sp.name, to: `/spaces/${sp.id}` }));
        }
        if (section === 'home' || section === 'profile') {
          // The LIVE state of the admin desks — so the model reports the
          // queue's truth, never a bell's memory. RLS returns nothing to
          // non-admins; zeroes are stated so "all clear" is sayable.
          const [sugg, knocks] = await Promise.all([
            supabase.from('category_suggestions').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
            supabase.from('join_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
          ]);
          if (sugg.count !== null || knocks.count !== null) {
            extras.admin_desks_right_now = {
              note: 'This is the CURRENT queue state, checked just now. If a notification mentions an item not counted here, it was already handled — never present it as waiting.',
              pending_category_suggestions: sugg.count ?? 0,
              people_knocking_to_join: knocks.count ?? 0,
            };
          }
        }
        if (section === 'market' || section === 'home') {
          const { data: mine } = await supabase.from('posts')
            .select('id, title, body, details, created_at')
            .eq('author_id', me)
            .contains('service_areas', ['marketplace'])
            .order('created_at', { ascending: false }).limit(8);
          const listings = ((mine as { title: string | null; body: string; details: Record<string, unknown> | null; created_at: string }[] | null) ?? [])
            // Per-post consent: not-AI-readable posts never reach the brief,
            // even the author's own — one uniform rule (founder 2026-08-05).
            .filter((p) => !p.details?.aiExcluded)
            .map((p) => ({
              title: p.title || p.body.slice(0, 48),
              modes: (p.details?.modes as string[] | undefined) ?? [p.details?.mode as string ?? 'unlabeled'],
              since: p.created_at.slice(0, 10),
            }));
          if (listings.length) extras.my_open_listings_and_seeks = listings;
          ((mine as { id?: string; title: string | null }[] | null) ?? [])
            .forEach((p) => { if (p.id && p.title) found.push({ label: p.title, to: `/posts/${p.id}` }); });
          const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
          const { count } = await supabase.from('posts')
            .select('id', { count: 'exact', head: true })
            .contains('service_areas', ['marketplace'])
            .neq('author_id', me)
            .gte('created_at', weekAgo);
          if (count) extras.new_marketplace_listings_this_week = count;
        }
        if (section === 'calendar' || section === 'home') {
          // Recurring events keep their FIRST occurrence in start/end_date —
          // expand with the real engine, don't date-range them (the booking
          // board's lesson).
          const { data: evs } = await supabase.from('events')
            .select('*')
            .or(`end_date.gte.${today},recurrence.not.is.null`)
            .limit(200);
          const rows3 = (evs as ({ title: string; start_date: string; end_date: string } & Record<string, unknown>)[] | null) ?? [];
          const coming: { title: string; on: string }[] = [];
          for (let d = 0; d < 14 && coming.length < 15; d++) {
            const iso = new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
            for (const e of rows3) {
              if (coming.length >= 15) break;
              const hit = e.recurrence
                ? occursOn(e as never, iso)
                : (e.start_date <= iso && e.end_date >= iso && d === 0) || e.start_date === iso;
              if (hit && !coming.some((c) => c.title === e.title && c.on === iso)) {
                coming.push({ title: e.title, on: iso });
              }
            }
          }
          if (coming.length) extras.next_two_weeks = coming;
          if (section === 'calendar') {
            const rem = await listReminders(me);
            const due = remindersOn(rem, today).map((r) => r.title).slice(0, 8);
            if (due.length) extras.reminders_today = due;
          }
        }
        if (section === 'maps') {
          // What has appeared on the map lately — all RLS-scoped, so this is
          // only ever what this member may already see.
          const monthAgo = new Date(Date.now() - 30 * 864e5).toISOString();
          const { data: newSpaces } = await supabase.from('spaces')
            .select('id, name, kind, location, created_at')
            .not('lat', 'is', null).eq('findable', true)
            .gte('created_at', monthAgo).order('created_at', { ascending: false }).limit(10);
          const sp = (newSpaces as { id: string; name: string; kind: string; location: string | null; created_at: string }[] | null) ?? [];
          if (sp.length) {
            extras.newly_pinned_places = sp.map((x) => ({ name: x.name, kind: x.kind, where: x.location ?? undefined, since: x.created_at.slice(0, 10) }));
            sp.forEach((x) => found.push({ label: x.name, to: `/spaces/${x.id}` }));
          }
          const { data: locEvents } = await supabase.from('posts')
            .select('id, title, details, created_at')
            .contains('service_areas', ['events'])
            .gte('created_at', monthAgo).order('created_at', { ascending: false }).limit(20);
          const withPlace = ((locEvents as { id: string; title: string | null; details: { location?: string; geo?: unknown; aiExcluded?: boolean } | null }[] | null) ?? [])
            .filter((p) => !p.details?.aiExcluded && (p.details?.geo || p.details?.location));
          if (withPlace.length) {
            extras.gatherings_with_a_place = withPlace.slice(0, 8)
              .map((p) => ({ title: p.title || 'A gathering', where: p.details?.location ?? 'mapped' }));
            withPlace.slice(0, 8).forEach((p) => { if (p.title) found.push({ label: p.title, to: `/events/${p.id}` }); });
          }
        }
        if (section === 'events') {
          // The Events brain's real eyes (founder 2026-08-14): your answered
          // invitations, what you're hosting, and how alive the section is.
          const { data: att } = await supabase.from('event_attendees')
            .select('status, events(id, title, start_date)')
            .eq('profile_id', me).in('status', ['going', 'tentative']).limit(50);
          const rsvps = ((att as unknown as { status: string; events: { id: string; title: string; start_date: string } | null }[] | null) ?? [])
            .filter((r) => r.events && r.events.start_date >= today)
            .sort((a, b) => a.events!.start_date.localeCompare(b.events!.start_date))
            .slice(0, 10);
          if (rsvps.length) {
            extras.your_rsvps = rsvps.map((r) => ({ title: r.events!.title, on: r.events!.start_date, answer: r.status }));
            rsvps.forEach((r) => found.push({ label: r.events!.title, to: `/events/${r.events!.id}` }));
          }
          const { data: hosting } = await supabase.from('events')
            .select('id, title, start_date')
            .eq('creator_id', me).gte('start_date', today)
            .order('start_date').limit(8);
          const hostRows = (hosting as { id: string; title: string; start_date: string }[] | null) ?? [];
          if (hostRows.length) {
            extras.you_are_hosting = hostRows.map((e) => ({ title: e.title, on: e.start_date }));
            hostRows.forEach((e) => found.push({ label: e.title, to: `/events/${e.id}` }));
          }
          const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
          const { count } = await supabase.from('posts')
            .select('id', { count: 'exact', head: true })
            .contains('service_areas', ['events'])
            .neq('author_id', me)
            .gte('created_at', weekAgo);
          if (count) extras.new_gatherings_posted_this_week = count;
        }
        if (section === 'chat' || section === 'home') {
          const { data: unread } = await supabase.rpc('chat_unread_counts');
          const rows2 = (unread as { chat_id: string; unread: number }[] | null) ?? [];
          const waiting = rows2.filter((r) => r.unread > 0);
          if (waiting.length) {
            extras.conversations_waiting = {
              conversations: waiting.length,
              messages: waiting.reduce((a, b) => a + b.unread, 0),
            };
            if (section === 'chat') {
              const vms = await loadChatList(me).catch(() => []);
              const byId = new Map(vms.map((v) => [v.id, v]));
              extras.waiting_on_you = waiting.slice(0, 10).map((w) => {
                const room = byId.get(w.chat_id);
                return { room: room?.title ?? 'a conversation', unread: w.unread };
              });
              // The deeper read (founder 2026-07-28): recent exchanges across
              // your rooms, so the brief can say what threads are actually
              // about — not just who's waiting. Newest first, capped, and
              // still only rooms RLS lets you read.
              const msgs = await recentMessagesAcross(120).catch(() => []);
              const perRoom = new Map<string, { room: string; lines: string[]; withheld: Set<string> }>();
              for (const m of msgs) {
                const room = byId.get(m.chat_id)?.title ?? 'a conversation';
                const slot = perRoom.get(m.chat_id) ?? { room, lines: [], withheld: new Set<string>() };
                // Consent travels with the words: a member who switched off
                // "readable by others' assistants" still counts as present in
                // the thread — the FACT that they wrote is the viewer's — but
                // their words never leave (founder 2026-07-28).
                const mine = m.sender_id === me;
                if (!mine && m.assistantReadable === false) {
                  slot.withheld.add(m.senderName ?? 'someone');
                } else if (slot.lines.length < 12) {
                  slot.lines.push(`${mine ? 'me' : (m.senderName ?? 'someone')}: ${(m.body ?? '').slice(0, 240)}`);
                }
                perRoom.set(m.chat_id, slot);
              }
              extras.recent_conversations = [...perRoom.values()].slice(0, 8).map((r) => ({
                room: r.room,
                recent: r.lines.reverse(),
                ...(r.withheld.size
                  ? { private_participants: `${[...r.withheld].join(', ')} keep their messages private from assistants — you can see them in the app, I can't.` }
                  : {}),
              }));
            }
          }
        }
        if ((section === 'communities' || section === 'groups' || section === 'organizations' || section === 'places') && desk && deskNames) {
          // The actual queue rows, for up to three busiest desks.
          const busiest = Object.entries(desk).sort((a, b) => b[1] - a[1]).slice(0, 3);
          const queues: unknown[] = [];
          for (const [sid] of busiest) {
            const [reqs, shares, bookings] = await Promise.all([
              listPendingRequests(sid).catch(() => []),
              listPendingSectionShares(sid).catch(() => []),
              listPendingResourceBookings(sid).catch(() => []),
            ]);
            reqs.forEach((r) => {
              if (r.profile?.full_name) found.push({ label: r.profile.full_name, to: `/members/${r.profile_id}` });
            });
            queues.push({
              space: deskNames[sid] ?? 'a space',
              at_the_door: reqs.filter((r) => r.initiated_by === r.profile_id)
                .map((r) => r.profile?.full_name ?? 'a member').slice(0, 6),
              shelf_shares: shares.map((r) => `${r.requester?.full_name ?? 'a member'} (${r.area})`).slice(0, 6),
              booking_requests: bookings.map((b) => `${b.requester?.full_name ?? 'someone'} wants ${b.resource?.name ?? 'a resource'}`).slice(0, 6),
            });
          }
          if (queues.length) extras.desk_queues = queues;
        }
      } catch { /* lighter brief */ }
      const { data, error } = await supabase.functions.invoke('assistant-brief', {
        body: {
          section,
          frame: meta.frame,
          snapshot: {
            ...snapshot,
            ...extras,
            stewarding: desk && deskNames
              ? Object.entries(desk).map(([id, n]) => ({ space: deskNames[id] ?? 'a space', waiting: n }))
              : undefined,
          },
        },
      });
      if (!live) return;
      const d2 = (data ?? {}) as { available?: boolean; capped?: boolean; brief?: string };
      if (error || d2.available === false) { setState('quietly-unavailable'); return; }
      if (d2.capped) { setState('capped'); return; }
      // Longest first so "Pine Valley Grange" wins over "Pine Valley".
      const sortedRefs = found
        .filter((r) => r.label && r.label.length > 3)
        .sort((a, b) => b.label.length - a.label.length);
      const at = Date.now();
      cache.set(briefKey, { text: d2.brief ?? '', refs: sortedRefs, fingerprint, at });
      setBrief(d2.brief ?? '');
      setRefs(sortedRefs);
      setUpdatedAt(at);
      setState('ready');
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, section, doorOn, fingerprint, refreshTick]);

  // A space briefing's conversation belongs in that space's own thread
  // (founder 2026-08-22), not the section's.
  const feedThread = spaceParam ? `space:${spaceParam}` : threadForSection(section);

  function talkToClaude() {
    // Land in the room this work belongs to (founder 2026-08-11), so the
    // work logs where it lives instead of in one flat feed.
    navigate(`/assistant/feed?thread=${feedThread}`);
  }

  /** The composer at the foot of the brief (founder 2026-08-05): reply to
   *  what you just read without hunting for a door. It really lands in the
   *  member's Claude feed (founder, 2026-08-09 — chat felt redundant with a
   *  relationship that's about gathering context over time) — the same
   *  daily cap, the same answering trigger — and we land you there to read
   *  the reply. */
  async function sendToClaude(text: string) {
    if (!me) return;
    await postToAssistantFeed(text, undefined, feedThread);
    navigate(`/assistant/feed?thread=${feedThread}`);
  }

  // The build door on the profile brief (founder 2026-08-17: Build with
  // Claude is the brain's own page, arriving with the context that you came
  // to build). Leads the page when that's why you came; sits under the
  // briefing otherwise. Lands in the profile thread with the builder open.
  const buildCard = (
    <button
      className="snap__invite abrief__build"
      onClick={() => navigate(`/assistant/feed?thread=profile${backTo ? `&back=${encodeURIComponent(backTo)}` : ''}&build=1`)}
    >
      <strong>Build your page from what you&rsquo;ve already got</strong>
      <em>Tell me about yourself, or paste your website — I&rsquo;ll draft the whole thing.</em>
    </button>
  );

  return (
    <div className="abrief">
      {buildIntent && backTo ? (
        /* The SAME segmented toggle the builder shows, from this side — Build
           with Claude is where you stand, Build manually is the way back
           (founder 2026-08-20: "the other button doesn't go away, it just
           signifies a toggle"). */
        <div className="view-toggle-row">
          <span className="view-toggle" role="group" aria-label="How to build this page">
            <button className="view-toggle__side" onClick={() => navigate(backTo)}>Build manually</button>
            <button className="view-toggle__side is-on"><Icon name="brain" size={12} /> Build with Claude</button>
          </span>
        </div>
      ) : (
        <button className="cmp__back calp__backchip" onClick={() => (backTo ? navigate(backTo) : navigate(-1))}>
          ← {backTo ? 'Back to manual mode' : 'Back'}
        </button>
      )}
      {/* Shaped like every other profile on Lichen (founder 2026-08-05):
          picture, then the name under it. The mark wears an Si badge in the
          silicon blue the About page already gives it — the assistant is a
          partner with an identity, not a feature with an icon. */}
      <div className="abrief__head">
        <span className="abrief__avatar-wrap">
          {/* The brain as a glyph, not the peach-filled avatar file — it has
              to take the silicon blue, not fight it. */}
          <span className="abrief__avatar"><Icon name="brain" size={38} /></span>
          <span className="abrief__el" aria-hidden="true">Si</span>
        </span>
        <h1 className="abrief__title">AI Assistant</h1>
        {/* Name, then role — the section it's briefing on moves into the
            line below, so context survives (founder 2026-08-05). */}
        <p className="abrief__scope">Your Lichen Partner</p>
        <p className="abrief__sub">
          {memberId
            ? `${briefWho ?? 'This member'}: your relationship to date, gathered before you meet.`
            : spaceParam
            ? `${briefWho ?? 'This space'}: what's alive here and what needs you, gathered and filtered.`
            : `${meta.title}: what needs your attention, gathered and filtered for you.`}
        </p>
      </div>

      {/* The consent switch sits ABOVE what it governs (founder 2026-08-17:
          "move the toggle up the page") — you see the door before the room. */}
      <label className="abrief__consent">
        <input
          type="checkbox"
          checked={doorOn}
          onChange={(e) => {
            const on = e.target.checked;
            setAiDoor(section, on);
            setDoorOn(on);
            if (!on) cache.delete(section);
          }}
        />
        <span>Let the assistant see this section <em>— off means its data never reaches the assistant</em></span>
      </label>

      {section === 'profile' && buildIntent && buildCard}

      <div className="abrief__card">
        {!doorOn && (
          <p className="abrief__text">
            The assistant is <strong>off</strong> for this part of your Lichen life — nothing
            here is gathered or shared with it. You lose its briefings and help in this
            section; everything still lives in your bell and queues. Your choice, always.
          </p>
        )}
        {doorOn && state === 'thinking' && <p className="abrief__thinking">Reading what&rsquo;s waiting…</p>}
        {doorOn && state === 'ready' && (
          <>
            <p className="abrief__text">{linkify(brief ?? '', refs)}</p>
            <p className="abrief__updated">
              {updatedAt != null && <>Updated {timeAgo(updatedAt)} · </>}
              <button type="button" className="abrief__refresh" onClick={refresh}>Refresh</button>
            </p>
          </>
        )}
        {doorOn && state === 'capped' && (
          <p className="abrief__text">You&rsquo;ve leaned on me a lot today — which I love. The briefing rests until tomorrow; everything&rsquo;s still in your bell and queues.</p>
        )}
        {doorOn && state === 'quietly-unavailable' && (
          <p className="abrief__text">The briefing isn&rsquo;t available right now — your bell and queues hold everything in the meantime.</p>
        )}
      </div>

      {section === 'profile' && !buildIntent && buildCard}

      <div className="abrief__acts">
        <button className="btn" onClick={() => talkToClaude()}>Open your feed</button>
        <button className="btn" onClick={() => navigate('/search')}>Search instead</button>
      </div>

      {/* Always-there composer — answer the brief in place (founder
          2026-08-05), lands in the feed (founder 2026-08-09). A door can
          arrive with its errand via ?ask= (founder 2026-08-11: "Draft it
          with Claude" shouldn't forget why you came) — press enter to send
          it, or add more first (a website to read, a length, a tone).
          Keyed so a new ?ask always lands even if the composer is mounted. */}
      <AssistantComposer
        key={params.get('ask') ?? 'blank'}
        onSend={sendToClaude}
        initialText={params.get('ask') ?? undefined}
      />

      <p className="abrief__foot">
        Carbon decides; silicon organizes. Nothing here is a score, and nothing leaves your view.
      </p>
    </div>
  );
}
