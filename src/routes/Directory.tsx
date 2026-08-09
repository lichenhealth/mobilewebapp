import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import MemberRow from '../components/MemberRow';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { sortClaudeFirst } from '../lib/chatApi';
import { hasClaudeFeedActivity } from '../lib/assistantFeedApi';
import {
  loadMyWeb, loadMyRecommendations, setInWeb, setVouch, setRecommend,
} from '../lib/myceliumApi';
import ConsentBubble from '../components/ConsentBubble';
import { loadPrompts, promptSeen, markPrompt } from '../lib/promptsApi';
import './Directory.css';

interface DirRow { id: string; full_name: string | null; headline: string | null; avatar_url: string | null; }

/** Members directory — every registered member, searchable. The quickest way to
 *  find someone and start a direct message (also handy for testing with more users). */
export default function Directory() {
  const { user } = useAuth();
  // FINDABILITY MEETS YOU HERE (founder 2026-08-07: the bubble should arrive
  // "if/when the person gets to the pertinent decision"). Browsing the member
  // list is the moment you realise you're on one — so that's when we say so,
  // once, pointing at the heading that just told you.
  const [headEl, setHeadEl] = useState<HTMLHeadingElement | null>(null);
  const [askFindable, setAskFindable] = useState(false);
  const [findable, setFindable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    void (async () => {
      await loadPrompts(user.id);
      if (!live || promptSeen('findable')) return;
      const { data } = await supabase.from('profiles')
        .select('findable').eq('id', user.id).maybeSingle();
      const v = (data as { findable?: boolean } | null)?.findable;
      if (!live || typeof v !== 'boolean') return;   // pre-migration: silent
      setFindable(v);
      setAskFindable(true);
    })();
    return () => { live = false; };
  }, [user]);
  const closeFindable = () => {
    if (user) void markPrompt(user.id, 'findable');
    setAskFindable(false);
  };
  const setMyFindable = async (next: boolean) => {
    if (!user) return;
    setFindable(next);
    await supabase.from('profiles').update({ findable: next }).eq('id', user.id);
    closeFindable();
  };
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<DirRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [claudeInUse, setClaudeInUse] = useState<boolean | undefined>(undefined);

  // Relationship signals, all toggleable in place: weave (web membership),
  // shield (private trust), thumb (recommend). Trust and recommend are
  // deliberately independent (founder, 2026-07-17): you might trust someone
  // but not recommend their offering — or the reverse.
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myVouched, setMyVouched] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!me) return;
    void loadMyWeb().then(({ web, vouched }) => { setMyWebSet(web); setMyVouched(vouched); });
    void loadMyRecommendations().then(setMyRecs);
  }, [me]);

  const withKey = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key); else next.delete(key);
    return next;
  };
  const toggleWeave = (id: string, on: boolean) => {
    setMyWebSet((s) => withKey(s, 'profile:' + id, on));
    if (!on) setMyVouched((s) => withKey(s, 'profile:' + id, false)); // unweave withdraws trust
    void setInWeb('profile', id, on).catch(console.error);
  };
  const toggleVouch = (id: string, on: boolean) => {
    setMyVouched((s) => withKey(s, 'profile:' + id, on));
    if (on) setMyWebSet((s) => withKey(s, 'profile:' + id, true)); // trusting auto-weaves
    void setVouch('profile', id, on).catch(console.error);
  };

  useEffect(() => {
    if (!me) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, headline, avatar_url')
        .or('onboarded.eq.true,kind.neq.person')  // beings have no signup to complete   // half-created accounts aren't members yet
        // Honours the findable switch. RLS is the floor — it hides quiet
        // members from strangers — but anyone with a public post stays
        // readable, so the browse surfaces respect the choice themselves.
        .eq('findable', true)
        .neq('id', me)
        .order('full_name', { ascending: true })
        .limit(500);
      if (active) { setMembers((data as DirRow[] | null) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [me]);

  // Claude's row is grayed out until the viewer has actually talked to
  // them — a real chat, not just seeing the row.
  useEffect(() => {
    if (!me) return;
    void hasClaudeFeedActivity(me).then(setClaudeInUse);
  }, [me]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = !q ? members : members.filter((m) =>
      (m.full_name?.toLowerCase().includes(q) ?? false) ||
      (m.headline?.toLowerCase().includes(q) ?? false),
    );
    return sortClaudeFirst(matches);
  }, [query, members]);

  return (
    <div className="dir">
      <header className="dir__head">
        <span className="eyebrow">Directory · {members.length} {members.length === 1 ? 'member' : 'members'}</span>
        <h1 className="dir__title" ref={setHeadEl}><span className="display-italic">Members</span></h1>
        <p className="dir__sub">Everyone on Lichen. Find someone and start a direct message.</p>
        {askFindable && findable !== null && (
          <ConsentBubble
            anchor={headEl}
            onClose={closeFindable}
            editLabel="who can find you"
            editTo="/profile#privacy"
            title={findable ? 'You’re listed here too.' : 'You’re not listed here.'}
            actions={
              <>
                <button className="btn btn-primary"
                  onClick={() => (findable ? closeFindable() : void setMyFindable(true))}>
                  {findable ? 'Stay listed' : 'List me'}
                </button>
                <button className="btn cbub__out"
                  onClick={() => (findable ? void setMyFindable(false) : closeFindable())}>
                  {findable ? 'Hide me' : 'Stay hidden'}
                </button>
              </>
            }
          >
            <p>
              Being listed is the default, so people can find you by name here
              and in search.
            </p>
            <p className="cbub__quiet">
              Hide and you drop out of both. People you already share a space,
              a chat, a care team or your web with still see you, and your name
              still shows on anything you post publicly.
            </p>
          </ConsentBubble>
        )}
      </header>

      <div className="dir__search">
        <Icon name="search" size={16} />
        <input
          className="dir__search-input"
          placeholder="Search by name or what they do"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="dir__search-clear" onClick={() => setQuery('')} aria-label="Clear">
            <Icon name="close" size={14} />
          </button>
        )}
      </div>

      <div className="dir__list">
        {loading && <div className="dir__empty"><p>Loading members…</p></div>}

        {!loading && members.length === 0 && (
          <div className="dir__empty">
            <Icon name="user-multiple" size={20} />
            <p>No other members yet</p>
            <p className="dir__empty-sub">As people join Lichen, they'll appear here.</p>
          </div>
        )}

        {!loading && members.length > 0 && hits.length === 0 && (
          <div className="dir__empty">
            <Icon name="search" size={20} />
            <p>No matches for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {/* No bare-profile thumb (founder 2026-08-06): recommending a whole
            person implicitly endorsed everything they'd ever listed. The
            thumb lives on their offerings instead — open their page and
            recommend the work you actually know. So every row here is
            kind="person" (shield only, no thumb). */}
        {hits.map((m) => {
          const name = m.full_name ?? 'Member';
          return (
            <MemberRow
              key={m.id}
              id={m.id}
              name={name}
              sub={m.headline ?? undefined}
              avatarUrl={m.avatar_url}
              kind="person"
              trusted={myVouched.has('profile:' + m.id)}
              onTrust={(on) => toggleVouch(m.id, on)}
              weaveOn={myWebSet.has('profile:' + m.id)}
              onWeave={(on) => toggleWeave(m.id, on)}
              onOpen={() => navigate(`/members/${m.id}`)}
              claudeInUse={claudeInUse}
            />
          );
        })}
      </div>
    </div>
  );
}
