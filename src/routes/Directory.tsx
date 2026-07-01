import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import { supabase } from '../lib/supabase';
import { ensureDirectChat, colorFor, monogramFor } from '../lib/chatApi';
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

  useEffect(() => {
    if (!me) return;
    let active = true;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, headline')
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
    try { navigate(`/chat/${await ensureDirectChat(id)}`); }
    catch (e) { console.error(e); setOpening(null); }
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
            <div className="dir__row" key={m.id}>
              <span className="dir__avatar" style={{ background: colorFor(m.id) }}>{monogramFor(name)}</span>
              <span className="dir__row-body">
                <span className="dir__row-name">{name}</span>
                {m.headline && <span className="dir__row-sub">{m.headline}</span>}
              </span>
              <button
                className="dir__msg"
                onClick={() => message(m.id)}
                disabled={opening === m.id}
              >
                <Icon name="message" size={15} />
                <span>{opening === m.id ? '…' : 'Message'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
