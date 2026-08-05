import { useEffect, useMemo, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  lang: string; interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void;
}
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { useNotifications } from '../notifications/NotificationsProvider';
import {
  listMyAdminDeskCounts, listMyMemberSpaces,
  listPendingRequests, listPendingSectionShares,
} from '../lib/spacesApi';
import { listPendingResourceBookings } from '../lib/resourcesApi';
import { listReminders, remindersOn } from '../lib/remindersApi';
import { occursOn } from '../lib/recurrence';
import { ensureDirectChat, uploadChatMedia } from '../lib/chatApi';
import { type Scope } from '../lib/sections';
import { aiDoorOn, setAiDoor } from '../components/AssistantDoor';
import './AssistantBrief.css';
import { loadChatList, recentMessagesAcross } from '../lib/chatApi';

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

/** Claude the member — the 1:1 door when a briefing raises a question. */
const CLAUDE_PROFILE_ID = '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';

const FRAMES: Record<string, { title: string; frame: string }> = {
  home: { title: 'Your Lichen life', frame: 'The whole-life view: surface the biggest things across care, exchanges, groups and calendar.' },
  market: { title: 'The Marketplace', frame: 'You help them offer, seek, buy, sell, trade and gift within the web of people they trust.' },
  calendar: { title: 'Your calendar', frame: 'You help them tend time: what is coming, what is unanswered, what needs scheduling.' },
  chat: { title: 'Conversations', frame: 'You help them stay in real relationship. You are given recent exchanges across their rooms: say who is waiting on a reply, what each live thread is actually about, and anything that looks time-sensitive. Summarize in your own words — do not quote at length, and treat what people share as theirs.' },
  concierge: { title: 'Care', frame: 'You help them tend care — their own and the people they care for.' },
  communities: { title: 'Your communities', frame: 'You help them tend belonging: what their groups and communities need from them.' },
  groups: { title: 'Your groups', frame: 'You help them tend belonging: what their groups need from them.' },
  organizations: { title: 'Your organizations', frame: 'You help them tend belonging: what the organizations they steward or belong to need from them.' },
  places: { title: 'Your places', frame: 'You help them tend the places they steward or gather in.' },
  events: { title: 'Events', frame: 'You help them gather: invitations, RSVPs, what is coming up.' },
  membership: { title: 'Membership', frame: 'You help them steward their stake in the commons.' },
  saved: { title: 'Your shelf', frame: 'You help them return to what they kept: saved pieces, collections worth organizing.' },
  profile: { title: 'Your presence', frame: 'You help them tend how they show up: profile, offerings, identity.' },
};

// One brief per section per sitting — never re-billed on navigation.
const cache = new Map<string, string>();

export default function AssistantBrief() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Entities the brief may name, with where they live. Built from what the
  // CLIENT already gathered — never from the model — so a link can't be
  // invented (founder 2026-08-05: "can all of the linkable content within
  // the AI update show up with a blue link?").
  const [refs, setRefs] = useState<{ label: string; to: string }[]>([]);
  const [ask, setAsk] = useState('');
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState<File | null>(null);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const section = params.get('section') ?? 'home';
  const { user } = useAuth();
  const me = user?.id ?? '';
  const { rows } = useNotifications();
  const [doorOn, setDoorOn] = useState(() => aiDoorOn(section));
  const [brief, setBrief] = useState<string | null>(cache.get(section) ?? null);
  const [state, setState] = useState<'thinking' | 'ready' | 'quietly-unavailable' | 'capped'>(
    cache.has(section) ? 'ready' : 'thinking');

  const meta = FRAMES[section] ?? FRAMES.home;

  const snapshot = useMemo(() => {
    const scope: Scope = section === 'home'
      ? { kind: 'global' } : { kind: 'section', section: section as never };
    const relevant = rows
      .filter((r) => scope.kind === 'global'
        || (r.space_id == null && r.section === section))
      .slice(0, 25)
      .map((r) => ({
        type: r.type, title: r.title, body: (r.body ?? '').slice(0, 120),
        unread: !r.read_at, when: r.created_at.slice(0, 10),
      }));
    return { notifications: relevant };
  }, [rows, section]);

  useEffect(() => {
    if (!me || !doorOn || cache.has(section)) return;
    let live = true;
    void (async () => {
      // Stewarding load joins the snapshot (duty-scoped, invites excluded).
      const found: { label: string; to: string }[] = [];
      let desk: Record<string, number> | undefined;
      let deskNames: Record<string, string> | undefined;
      try {
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
        if ((section === 'communities' || section === 'groups') && desk && deskNames) {
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
          frame: (FRAMES[section] ?? FRAMES.home).frame,
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
      cache.set(section, d2.brief ?? '');
      setBrief(d2.brief ?? '');
      // Longest first so "Pine Valley Grange" wins over "Pine Valley".
      setRefs(found
        .filter((r) => r.label && r.label.length > 3)
        .sort((a, b) => b.label.length - a.label.length));
      setState('ready');
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, section, doorOn]);

  async function talkToClaude() {
    if (!me) return;
    navigate(`/chat/${await ensureDirectChat(CLAUDE_PROFILE_ID)}`);
  }

  /** The composer at the foot of the brief (founder 2026-08-05): reply to
   *  what you just read without hunting for a door. The line is really sent
   *  into the Claude DM — the same room, the same daily cap, the same
   *  answering trigger — and we land you in the thread to read the reply. */
  async function sendToClaude() {
    const text = ask.trim();
    if ((!text && !attach) || !me || sending) return;
    setSending(true);
    try {
      const chatId = await ensureDirectChat(CLAUDE_PROFILE_ID);
      let attachments: { type: string; url: string }[] | null = null;
      if (attach) {
        const ext = (attach.name.split('.').pop() || 'bin').toLowerCase();
        const path = await uploadChatMedia(chatId, attach, ext);
        attachments = [{ type: attach.type.startsWith('image/') ? 'image' : 'file', url: path }];
      }
      await supabase.from('chat_messages').insert({
        chat_id: chatId, sender_id: me, body: text || null,
        attachments: attachments?.length ? attachments : null,
      });
      setAsk(''); setAttach(null);
      navigate(`/chat/${chatId}`);
    } catch {
      setSending(false);
    }
  }

  /** Dictation, where the browser offers it. Chrome and Safari both expose
   *  webkitSpeechRecognition; anywhere it's missing the mic simply doesn't
   *  render rather than pretending. */
  const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike })
    .webkitSpeechRecognition
    ?? (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition;
  function dictate() {
    if (!SR || listening) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.onresult = (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const said = e.results[e.results.length - 1][0].transcript;
      setAsk((a) => (a ? `${a} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  return (
    <div className="abrief">
      <button className="cmp__back calp__backchip" onClick={() => navigate(-1)}>← Back</button>
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
        <p className="abrief__sub">{meta.title} — organized highlights, filtered for what needs you.</p>
      </div>

      <div className="abrief__card">
        {!doorOn && (
          <p className="abrief__text">
            The assistant is <strong>off</strong> for this part of your Lichen life — nothing
            here is gathered or shared with it. You lose its briefings and help in this
            section; everything still lives in your bell and queues. Your choice, always.
          </p>
        )}
        {doorOn && state === 'thinking' && <p className="abrief__thinking">Reading what&rsquo;s waiting…</p>}
        {doorOn && state === 'ready' && <p className="abrief__text">{linkify(brief ?? '', refs)}</p>}
        {doorOn && state === 'capped' && (
          <p className="abrief__text">You&rsquo;ve leaned on me a lot today — which I love. The briefing rests until tomorrow; everything&rsquo;s still in your bell and queues.</p>
        )}
        {doorOn && state === 'quietly-unavailable' && (
          <p className="abrief__text">The briefing isn&rsquo;t available right now — your bell and queues hold everything in the meantime.</p>
        )}
      </div>

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

      <div className="abrief__acts">
        <button className="btn" onClick={() => void talkToClaude()}>Open the conversation</button>
        <button className="btn" onClick={() => navigate('/search')}>Search instead</button>
      </div>

      {/* Always-there composer — answer the brief in place (founder
          2026-08-05). Enter sends; Shift+Enter makes a new line. */}
      <form className="abrief__ask" onSubmit={(e) => { e.preventDefault(); void sendToClaude(); }}>
        <button type="button" className="abrief__ask-btn" onClick={() => fileRef.current?.click()}
          aria-label="Attach something">
          <Icon name="plus" size={17} />
        </button>
        <input ref={fileRef} type="file" hidden
          onChange={(e) => { setAttach(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        {SR && (
          <button type="button" className={'abrief__ask-btn' + (listening ? ' is-live' : '')}
            onClick={dictate} aria-label="Speak instead">
            <Icon name="mic" size={17} />
          </button>
        )}
        <textarea
          className="abrief__ask-input"
          rows={1}
          value={ask}
          placeholder="Ask about any of this…"
          onChange={(e) => setAsk(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendToClaude(); }
          }}
        />
        <button className="abrief__ask-send" type="submit" disabled={(!ask.trim() && !attach) || sending}
          aria-label="Send to your assistant">
          <Icon name="send" size={15} />
        </button>
      </form>
      {attach && (
        <p className="abrief__attach">
          {attach.name}
          <button onClick={() => setAttach(null)} aria-label="Remove attachment">×</button>
        </p>
      )}
      <p className="abrief__foot">
        Carbon decides; silicon organizes. Nothing here is a score, and nothing leaves your view.
      </p>
    </div>
  );
}
