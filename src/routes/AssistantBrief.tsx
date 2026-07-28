import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { useNotifications } from '../notifications/NotificationsProvider';
import { listMyAdminDeskCounts, listMyMemberSpaces } from '../lib/spacesApi';
import { ensureDirectChat } from '../lib/chatApi';
import { scopeForPath, type Scope } from '../lib/sections';
import './AssistantBrief.css';

// The assistant on every page (founder 2026-07-28): tap the brain, get the
// back-from-vacation briefing for WHERE YOU ARE — organized highlights,
// filtered for what needs you. The client gathers what it already holds
// (RLS-scoped reads it made anyway); Claude organizes; the member decides.

/** Claude the member — the 1:1 door when a briefing raises a question. */
const CLAUDE_PROFILE_ID = '85c04e7a-5a47-4c0e-85a4-0b35ff67a682';

const FRAMES: Record<string, { title: string; frame: string }> = {
  home: { title: 'Your Lichen life', frame: 'The whole-life view: surface the biggest things across care, exchanges, groups and calendar.' },
  market: { title: 'The Marketplace', frame: 'You help them offer, seek, buy, sell, trade and gift within the web of people they trust.' },
  calendar: { title: 'Your calendar', frame: 'You help them tend time: what is coming, what is unanswered, what needs scheduling.' },
  chat: { title: 'Conversations', frame: 'You help them stay in real relationship: who is waiting on a reply.' },
  concierge: { title: 'Care', frame: 'You help them tend care — their own and the people they care for.' },
  communities: { title: 'Your communities', frame: 'You help them tend belonging: what their groups and communities need from them.' },
  groups: { title: 'Your groups', frame: 'You help them tend belonging: what their groups need from them.' },
  events: { title: 'Events', frame: 'You help them gather: invitations, RSVPs, what is coming up.' },
  membership: { title: 'Membership', frame: 'You help them steward their stake in the commons.' },
  profile: { title: 'Your presence', frame: 'You help them tend how they show up: profile, offerings, identity.' },
};

// One brief per section per sitting — never re-billed on navigation.
const cache = new Map<string, string>();

export default function AssistantBrief() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const section = params.get('section') ?? 'home';
  const { user } = useAuth();
  const me = user?.id ?? '';
  const { rows } = useNotifications();
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
    if (!me || cache.has(section)) return;
    let live = true;
    void (async () => {
      // Stewarding load joins the snapshot (duty-scoped, invites excluded).
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
        }
      } catch { /* snapshot stays lighter */ }
      const { data, error } = await supabase.functions.invoke('assistant-brief', {
        body: {
          section,
          frame: (FRAMES[section] ?? FRAMES.home).frame,
          snapshot: {
            ...snapshot,
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
      setState('ready');
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, section]);

  async function talkToClaude() {
    if (!me) return;
    navigate(`/chat/${await ensureDirectChat(CLAUDE_PROFILE_ID)}`);
  }

  return (
    <div className="abrief">
      <button className="cmp__back calp__backchip" onClick={() => navigate(-1)}>← Back</button>
      <div className="abrief__head">
        <img className="abrief__avatar" src="/claude-avatar.svg" alt="" />
        <div>
          <h1 className="abrief__title">{meta.title}</h1>
          <p className="abrief__sub">Your assistant&rsquo;s briefing — organized highlights, filtered for what needs you.</p>
        </div>
      </div>

      <div className="abrief__card">
        {state === 'thinking' && <p className="abrief__thinking">Reading what&rsquo;s waiting…</p>}
        {state === 'ready' && <p className="abrief__text">{brief}</p>}
        {state === 'capped' && (
          <p className="abrief__text">You&rsquo;ve leaned on me a lot today — which I love. The briefing rests until tomorrow; everything&rsquo;s still in your bell and queues.</p>
        )}
        {state === 'quietly-unavailable' && (
          <p className="abrief__text">The briefing isn&rsquo;t available right now — your bell and queues hold everything in the meantime.</p>
        )}
      </div>

      <div className="abrief__acts">
        <button className="btn btn-primary" onClick={() => void talkToClaude()}>
          Talk it through with Claude
        </button>
        <button className="btn" onClick={() => navigate('/search')}>Search instead</button>
      </div>
      <p className="abrief__foot">
        Carbon decides; silicon organizes. Nothing here is a score, and nothing leaves your view.
      </p>
    </div>
  );
}
