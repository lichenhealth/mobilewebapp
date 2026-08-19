import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import MemberRow from '../components/MemberRow';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { sortClaudeFirst } from '../lib/chatApi';
import { hasClaudeFeedActivity } from '../lib/assistantFeedApi';
import {
  loadMyWeb, loadMyRecommendations, setInWeb, setVouch, setRecommend, recommendKey,
} from '../lib/myceliumApi';
import ConsentBubble from '../components/ConsentBubble';
import { loadPrompts, promptSeen, markPrompt } from '../lib/promptsApi';
import './Directory.css';

interface DirRow { id: string; full_name: string | null; headline: string | null; avatar_url: string | null; kind: string | null; jurisdiction: string | null; }
interface SpaceRow { id: string; name: string; kind: string; avatar_url: string | null; description: string | null; }
// Section order mirrors My-celium's directory (founder 2026-08-14: "they're
// in someone's Mycelium, organized by type" — the whole-network directory
// reads the same way).
const SPACE_SECTIONS: { kind: string; title: string }[] = [
  { kind: 'organization', title: 'Organizations' },
  { kind: 'community', title: 'Communities' },
  { kind: 'group', title: 'Groups' },
  { kind: 'place', title: 'Places' },
];

/** The Directory — everyone on Lichen, searchable and grouped by type:
 *  members first, then beings & collectives, organizations, communities,
 *  groups and places (founder 2026-08-14). People carry the private trust
 *  shield; everything else carries the public recommend thumb — trust is
 *  person-to-person only, by doctrine. */
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
  const [spaces, setSpaces] = useState<SpaceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [claudeInUse, setClaudeInUse] = useState<boolean | undefined>(undefined);

  // Relationship signals, all toggleable in place: weave (web membership),
  // shield (private trust), thumb (recommend). Trust and recommend are
  // deliberately independent (founder, 2026-07-17): you might trust someone
  // but not recommend their offering — or the reverse.
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myVouched, setMyVouched] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  // THE WEB FOLLOWS WHOEVER YOU'RE ACTING AS (founder 2026-08-18: acting as
  // Lichen, the Directory lit Galyn's weave marks and showed trust shields —
  // "when logged in as Lichen I haven't done my mycelium vetting yet"). A
  // space reads and writes ITS OWN web (mycelium.truster_space_id), starts
  // empty until its admins weave, and holds no trust at all — the shield is
  // a person's, so it doesn't render while you wear a space's hat.
  const { actor } = useActing();
  const asSpace = actor.type === 'space' ? actor.id : undefined;
  useEffect(() => {
    if (!me) return;
    setMyWebSet(new Set()); setMyVouched(new Set()); setMyRecs(new Set());
    void loadMyWeb(asSpace).then(({ web, vouched }) => { setMyWebSet(web); setMyVouched(vouched); });
    void loadMyRecommendations().then(setMyRecs);
  }, [me, asSpace]);

  const withKey = (set: Set<string>, key: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(key); else next.delete(key);
    return next;
  };
  const toggleWeave = (id: string, on: boolean) => {
    setMyWebSet((s) => withKey(s, 'profile:' + id, on));
    if (!on) setMyVouched((s) => withKey(s, 'profile:' + id, false)); // unweave withdraws trust
    void setInWeb('profile', id, on, asSpace).catch(console.error);
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
      const [profs, sps] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, full_name, headline, avatar_url, kind, jurisdiction')
          .or('onboarded.eq.true,kind.neq.person')  // beings have no signup to complete   // half-created accounts aren't members yet
          // Honours the findable switch. RLS is the floor — it hides quiet
          // members from strangers — but anyone with a public post stays
          // readable, so the browse surfaces respect the choice themselves.
          .eq('findable', true)
          .neq('id', me)
          .order('full_name', { ascending: true })
          .limit(500),
        supabase
          .from('spaces')
          .select('id, name, kind, avatar_url, description')
          .eq('findable', true)
          .order('name', { ascending: true })
          .limit(500),
      ]);
      if (!active) return;
      setMembers((profs.data as DirRow[] | null) ?? []);
      setSpaces((sps.data as SpaceRow[] | null) ?? []);
      setLoading(false);
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
  const people = useMemo(() => hits.filter((m) => !m.kind || m.kind === 'person'), [hits]);
  // Non-person profiles — a collective, a place-being, someday a horse.
  const beings = useMemo(() => hits.filter((m) => m.kind && m.kind !== 'person'), [hits]);
  const spaceHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    return !q ? spaces : spaces.filter((sp) =>
      sp.name.toLowerCase().includes(q) || (sp.description?.toLowerCase().includes(q) ?? false));
  }, [query, spaces]);
  const anyHits = hits.length > 0 || spaceHits.length > 0;

  return (
    <div className="dir">
      <header className="dir__head">
        <span className="eyebrow">Directory · {members.length} {members.length === 1 ? 'member' : 'members'}{spaces.length > 0 ? ` · ${spaces.length} more` : ''}</span>
        <h1 className="dir__title" ref={setHeadEl}><span className="display-italic">Members</span></h1>
        <p className="dir__sub">Everyone on Lichen — members, then the organizations, communities, groups and places they've grown.</p>
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

        {!loading && members.length === 0 && spaces.length === 0 && (
          <div className="dir__empty">
            <Icon name="user-multiple" size={20} />
            <p>No other members yet</p>
            <p className="dir__empty-sub">As people join Lichen, they'll appear here.</p>
          </div>
        )}

        {!loading && (members.length > 0 || spaces.length > 0) && !anyHits && (
          <div className="dir__empty">
            <Icon name="search" size={20} />
            <p>No matches for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {/* No bare-profile thumb for PEOPLE (founder 2026-08-06):
            recommending a whole person implicitly endorsed everything they'd
            ever listed — the thumb lives on their offerings. People carry
            the shield only; beings and spaces carry the thumb only (trust is
            person-to-person, founder 2026-08-14). */}
        {people.map((m) => {
          const name = m.full_name ?? 'Member';
          return (
            <MemberRow
              key={m.id}
              id={m.id}
              name={name}
              sub={m.headline ?? undefined}
              avatarUrl={m.avatar_url}
              kind="person"
              trusted={asSpace ? false : myVouched.has('profile:' + m.id)}
              onTrust={asSpace ? undefined : (on) => toggleVouch(m.id, on)}
              weaveOn={myWebSet.has('profile:' + m.id)}
              onWeave={(on) => toggleWeave(m.id, on)}
              onOpen={() => navigate(`/members/${m.id}`)}
              claudeInUse={claudeInUse}
            />
          );
        })}
        {/* STEWARDED MEMBERS (founder 2026-08-14, choosing the literal name
            over a prettier one: "per our desire to be literal versus sound
            beautiful but not really communicate clearly") — every non-person
            profiles.kind row: plants, animals, places, elements, collectives.
            Each has a steward who answers for it; each carries the thumb,
            never a shield. */}
        {beings.length > 0 && (
          <>
            <h2 className="dir__section">Stewarded members</h2>
            {beings.map((m) => (
              <MemberRow
                key={m.id}
                id={m.id}
                name={m.full_name ?? 'A being'}
                sub={[m.headline, m.jurisdiction ? `tended within ${m.jurisdiction}` : null].filter(Boolean).join(' · ') || undefined}
                avatarUrl={m.avatar_url}
                kind="space"
                recommended={myRecs.has(recommendKey('profile', m.id, undefined, asSpace))}
                onRecommend={(on) => {
                  setMyRecs((s) => withKey(s, recommendKey('profile', m.id, undefined, asSpace), on));
                  void setRecommend('profile', m.id, on, undefined, asSpace).catch(console.error);
                }}
                weaveOn={myWebSet.has('profile:' + m.id)}
                onWeave={(on) => toggleWeave(m.id, on)}
                onOpen={() => navigate(`/members/${m.id}`)}
              />
            ))}
          </>
        )}
        {SPACE_SECTIONS.map(({ kind, title }) => {
          const rows = spaceHits.filter((sp) => sp.kind === kind);
          if (rows.length === 0) return null;
          return (
            <div key={kind}>
              <h2 className="dir__section">{title}</h2>
              {rows.map((sp) => (
                <MemberRow
                  key={sp.id}
                  id={sp.id}
                  name={sp.name}
                  sub={sp.description?.slice(0, 90) || undefined}
                  avatarUrl={sp.avatar_url}
                  kind="space"
                  recommended={myRecs.has(recommendKey('space', sp.id, undefined, asSpace))}
                  onRecommend={(on) => {
                    setMyRecs((s) => withKey(s, recommendKey('space', sp.id, undefined, asSpace), on));
                    void setRecommend('space', sp.id, on, undefined, asSpace).catch(console.error);
                  }}
                  weaveOn={myWebSet.has('space:' + sp.id)}
                  onWeave={(on) => {
                    setMyWebSet((s) => withKey(s, 'space:' + sp.id, on));
                    void setInWeb('space', sp.id, on, asSpace).catch(console.error);
                  }}
                  onOpen={() => navigate(`/spaces/${sp.id}`)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
