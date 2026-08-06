import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { WeaveMark } from '../components/WeaveMark';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { ensureDirectChat, colorFor, monogramFor } from '../lib/chatApi';
import {
  loadMyWeb, loadMyRecommendations, setInWeb, setVouch, setRecommend,
} from '../lib/myceliumApi';
import './Directory.css';

interface MemberRow { id: string; full_name: string | null; headline: string | null; }

/** Members directory — every registered member, searchable. The quickest way to
 *  find someone and start a direct message (also handy for testing with more users). */
export default function Directory() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);

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
        .select('id, full_name, headline')
        .or('onboarded.eq.true,kind.neq.person')  // beings have no signup to complete   // half-created accounts aren't members yet
        .neq('id', me)
        .order('full_name', { ascending: true })
        .limit(500);
      if (active) { setMembers((data as MemberRow[] | null) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [me]);

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      (m.full_name?.toLowerCase().includes(q) ?? false) ||
      (m.headline?.toLowerCase().includes(q) ?? false),
    );
  }, [query, members]);

  async function message(id: string) {
    setOpening(id);
    try {
      navigate(`/chat/${await ensureDirectChat(id)}`);
    } catch (e) {
      console.error(e);
      setOpening(null);
      alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e)));
    }
  }

  return (
    <div className="dir">
      <header className="dir__head">
        <span className="eyebrow">Directory · {members.length} {members.length === 1 ? 'member' : 'members'}</span>
        <h1 className="dir__title"><span className="display-italic">Members</span></h1>
        <p className="dir__sub">Everyone on Lichen. Find someone and start a direct message.</p>
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

        {hits.map((m) => {
          const name = m.full_name ?? 'Member';
          return (
            // Row opens the member's public profile; Message stays a shortcut.
            <div
              className="dir__row dir__row--link"
              key={m.id}
              onClick={() => navigate(`/members/${m.id}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/members/${m.id}`); }}
            >
              <span className="dir__avatar" style={{ background: colorFor(m.id) }}>{monogramFor(name)}</span>
              <span className="dir__row-body">
                <span className="dir__row-name">{name}</span>
                {m.headline && <span className="dir__row-sub">{m.headline}</span>}
              </span>
              <span className="dir__row-actions">
              <button
                className={'dir__sig' + (myVouched.has('profile:' + m.id) ? ' is-on' : '')}
                onClick={(e) => { e.stopPropagation(); toggleVouch(m.id, !myVouched.has('profile:' + m.id)); }}
                aria-pressed={myVouched.has('profile:' + m.id)}
                aria-label={myVouched.has('profile:' + m.id) ? `Stop trusting ${name}` : `Trust ${name}`}
                title={myVouched.has('profile:' + m.id) ? 'Someone you trust' : 'Trust (private)'}
              >
                <Icon name="shield-user" size={16} />
              </button>
              {/* No bare-profile thumb (founder 2026-08-06): recommending a
                  whole person implicitly endorsed everything they'd ever
                  listed. The thumb lives on their offerings instead — open
                  their page and recommend the work you actually know. */}
              <WeaveMark
                on={myWebSet.has('profile:' + m.id)}
                onToggle={(on) => toggleWeave(m.id, on)}
                entityName={name}
                size={20}
              />
              <button
                className="dir__msg"
                onClick={(e) => { e.stopPropagation(); message(m.id); }}
                disabled={opening === m.id}
              >
                <Icon name="message" size={15} />
                <span className="dir__msg-label">{opening === m.id ? '…' : 'Message'}</span>
              </button>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
