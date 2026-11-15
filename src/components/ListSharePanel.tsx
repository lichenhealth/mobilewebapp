import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listMyMemberSpaces } from '../lib/spacesApi';
import { listShares, addShare, setShareLevel, removeShare, type ListShare, type ShareAudience, type ShareLevel } from '../lib/contactsApi';

// SHARE A LIST ON LICHEN'S OWN LADDER (founder 2026-11-15: "with this group,
// but not these 3 members of that group"). A person rule beats a circle rule
// beats your web beats everyone — so "Kapulli · can see" plus three people at
// "not them" does exactly what she said.

const LEVEL_WORDS: Record<ShareLevel, string> = { see: 'Can see', edit: 'Can edit', hidden: 'Not them' };

export default function ListSharePanel({ me, listId }: { me: string; listId: string }) {
  const [rules, setRules] = useState<ListShare[]>([]);
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [aud, setAud] = useState<ShareAudience | ''>('');
  const [spaceId, setSpaceId] = useState('');
  const [level, setLevel] = useState<ShareLevel>('see');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; full_name: string }[]>([]);
  const [person, setPerson] = useState<{ id: string; full_name: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    const r = await listShares(listId); setRules(r);
    const ids = r.map((x) => x.audience_profile_id).filter(Boolean) as string[];
    if (ids.length) {
      const { data } = await supabase.from('profiles').select('id, full_name').in('id', ids);
      setNames(new Map(((data as { id: string; full_name: string }[] | null) ?? []).map((p) => [p.id, p.full_name])));
    }
  }
  useEffect(() => { void refresh(); void listMyMemberSpaces(me).then((s) => setSpaces(s.map((x) => ({ id: x.id, name: x.name })))); }, [listId, me]);

  useEffect(() => {
    if (aud !== 'profile' || q.trim().length < 2 || person) { setHits([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').eq('findable', true).neq('id', me)
        .ilike('full_name', `%${q.trim()}%`).limit(6);
      setHits((data as { id: string; full_name: string }[] | null) ?? []);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q, aud, person, me]);

  const spaceName = (id: string | null) => spaces.find((s) => s.id === id)?.name ?? 'a circle';
  const who = (r: ListShare) => r.audience_type === 'everyone' ? 'Everyone on Lichen'
    : r.audience_type === 'mycelium' ? 'Your My-celium'
    : r.audience_type === 'space' ? spaceName(r.audience_space_id)
    : names.get(r.audience_profile_id ?? '') ?? 'A member';

  async function add() {
    if (!aud) return;
    try {
      await addShare(me, listId, {
        audience_type: aud, level,
        audience_space_id: aud === 'space' ? spaceId : null,
        audience_profile_id: aud === 'profile' ? person?.id : null,
      });
      setAud(''); setSpaceId(''); setPerson(null); setQ(''); setLevel('see'); setNote(null);
      await refresh();
    } catch (e) { setNote((e as Error).message); }
  }

  const ready = aud === 'everyone' || aud === 'mycelium' || (aud === 'space' && spaceId) || (aud === 'profile' && person);
  return (
    <div className="lshare">
      <p className="lshare__head">Who can see this list</p>
      {rules.length === 0 && <p className="lshare__fine">Only you. Share it with a circle, your My-celium, or particular people — and leave out anyone with “Not them”.</p>}
      {rules.map((r) => (
        <div key={r.id} className="lshare__rule">
          <span className="lshare__who">{who(r)}</span>
          <select className="lshare__sel" value={r.level} onChange={(e) => void setShareLevel(r.id, e.target.value as ShareLevel).then(refresh)}>
            {(r.audience_type === 'profile' ? ['see', 'edit', 'hidden'] : ['see', 'edit', 'hidden']).map((l) => <option key={l} value={l}>{LEVEL_WORDS[l as ShareLevel]}</option>)}
          </select>
          <button className="dcon__x" aria-label="Remove this rule" onClick={() => void removeShare(r.id).then(refresh)}>×</button>
        </div>
      ))}
      <div className="lshare__add">
        <select className="lshare__sel" value={aud} onChange={(e) => { setAud(e.target.value as ShareAudience | ''); setPerson(null); setQ(''); }}>
          <option value="">Add who…</option>
          <option value="space">A community, group, organization or place</option>
          <option value="profile">A particular person</option>
          <option value="mycelium">My My-celium</option>
          <option value="everyone">Everyone on Lichen</option>
        </select>
        {aud === 'space' && (
          <select className="lshare__sel" value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
            <option value="">Which one?</option>
            {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {aud === 'profile' && (person
          ? <span className="lshare__who">{person.full_name} <button className="dcon__x" aria-label="Change" onClick={() => setPerson(null)}>×</button></span>
          : <input className="lshare__sel" placeholder="Their name" value={q} onChange={(e) => setQ(e.target.value)} />)}
        {aud && (
          <select className="lshare__sel" value={level} onChange={(e) => setLevel(e.target.value as ShareLevel)}>
            <option value="see">Can see</option>
            <option value="edit">Can edit</option>
            {(aud === 'profile') && <option value="hidden">Not them</option>}
          </select>
        )}
        {aud && <button className="dcon__addbtn" disabled={!ready} onClick={() => void add()}>Share</button>}
      </div>
      {hits.length > 0 && (
        <div className="lshare__sugg">{hits.map((h) => <button key={h.id} onClick={() => { setPerson(h); setHits([]); }}>{h.full_name}</button>)}</div>
      )}
      {note && <p className="dcon__note">{note}</p>}
      <p className="lshare__fine">A person’s rule beats a circle’s, so you can share with a group and still leave out a few of its members. Sharing shows what you typed on these cards; a card linked to a Lichen member shows only their profile.</p>
    </div>
  );
}
