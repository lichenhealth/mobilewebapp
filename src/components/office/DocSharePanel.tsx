import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Avatar from '../Avatar';
import {
  listDocShares, shareDoc, unshareDoc, setDocLink, docShareUrl,
  type ChatDocRow, type DocShare, type ShareLevel,
} from '../../lib/chatDocsApi';
import './DocSharePanel.css';

/** SHARE, LIKE GOOGLE (founder 2026-11-26: "how do I share this from the doc
 *  itself like i can on google?"). People by name with Can view / Can edit,
 *  then the link: Restricted · Anyone on Lichen with the link · Anyone with
 *  the link (a read-only page on the open web). The owner alone changes any
 *  of it — the database refuses everyone else. */
export default function DocSharePanel({ doc, me, onClose, onLink }: {
  doc: ChatDocRow;
  me: string;
  onClose: () => void;
  onLink: (v: { link_access: 'lichen' | 'anyone' | null; share_token: string | null }) => void;
}) {
  const owner = doc.created_by === me;
  const [shares, setShares] = useState<DocShare[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; full_name: string | null; avatar_url: string | null }[]>([]);
  const [level, setLevel] = useState<ShareLevel>('view');
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (owner) void listDocShares(doc.id).then(setShares); }, [doc.id, owner]);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setHits([]); return; }
    const h = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, full_name, avatar_url')
        .eq('findable', true).eq('onboarded', true).ilike('full_name', `%${t}%`).neq('id', me).limit(6);
      setHits(((data ?? []) as { id: string; full_name: string | null; avatar_url: string | null }[])
        .filter((p) => !shares.some((s) => s.profile_id === p.id)));
    }, 220);
    return () => window.clearTimeout(h);
  }, [q, me, shares]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const add = async (p: { id: string; full_name: string | null; avatar_url: string | null }) => {
    setMsg('');
    try {
      await shareDoc(doc.id, p.id, level);
      setShares((cur) => [...cur, { profile_id: p.id, level, name: p.full_name ?? 'Member', avatar_url: p.avatar_url }]);
      setQ(''); setHits([]);
      setMsg(`Shared with ${(p.full_name ?? 'them').split(' ')[0]} — they'll get a bell.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t share.'); }
  };
  const change = async (s: DocShare, lv: ShareLevel | 'remove') => {
    setMsg('');
    try {
      if (lv === 'remove') { await unshareDoc(doc.id, s.profile_id); setShares((cur) => cur.filter((x) => x.profile_id !== s.profile_id)); }
      else { await shareDoc(doc.id, s.profile_id, lv); setShares((cur) => cur.map((x) => (x.profile_id === s.profile_id ? { ...x, level: lv } : x))); }
    } catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t save.'); }
  };
  const link = async (v: string) => {
    setMsg(''); setCopied(false);
    try { onLink(await setDocLink(doc.id, v === 'restricted' ? null : (v as 'lichen' | 'anyone'))); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'That didn’t save.'); }
  };
  const url = docShareUrl(doc);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { window.prompt('Copy this link', url); }
  };
  const send = async () => {
    if (navigator.share) { try { await navigator.share({ title: doc.title, url }); } catch { /* closed */ } }
    else void copy();
  };

  return (
    <div className="dshare" role="dialog" aria-label={`Share ${doc.title}`} onClick={onClose}>
      <div className="dshare__card" onClick={(e) => e.stopPropagation()}>
        <div className="dshare__head">
          <h2 className="dshare__title">Share «{doc.title || 'Untitled'}»</h2>
          <button className="dshare__x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {!owner ? (
          <p className="dshare__note">Only the person who made this can change who it’s shared with. You can still send the link to anyone it’s already open to.</p>
        ) : (
          <>
            <div className="dshare__add">
              <input className="dshare__input" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="Add people by name" aria-label="Add people by name" autoFocus />
              <select className="dshare__lv" value={level} onChange={(e) => setLevel(e.target.value as ShareLevel)} aria-label="What they can do">
                <option value="view">Can view</option>
                <option value="edit">Can edit</option>
              </select>
            </div>
            {hits.length > 0 && (
              <ul className="dshare__hits">
                {hits.map((p) => (
                  <li key={p.id}><button onClick={() => void add(p)}>
                    <Avatar id={p.id} name={p.full_name ?? 'Member'} url={p.avatar_url} size={26} /> {p.full_name}
                  </button></li>
                ))}
              </ul>
            )}
            <h3 className="dshare__h3">People with access</h3>
            <ul className="dshare__people">
              <li><span className="dshare__who">You</span><span className="dshare__role">Owner</span></li>
              {shares.map((s) => (
                <li key={s.profile_id}>
                  <span className="dshare__who"><Avatar id={s.profile_id} name={s.name} url={s.avatar_url} size={26} /> {s.name}</span>
                  <select className="dshare__lv" value={s.level} onChange={(e) => void change(s, e.target.value as ShareLevel | 'remove')} aria-label={`What ${s.name} can do`}>
                    <option value="view">Can view</option>
                    <option value="edit">Can edit</option>
                    <option value="remove">Remove access</option>
                  </select>
                </li>
              ))}
            </ul>
            <h3 className="dshare__h3">General access</h3>
            <select className="dshare__linksel" value={doc.link_access ?? 'restricted'} onChange={(e) => void link(e.target.value)} aria-label="Who the link lets in">
              <option value="restricted">Restricted — only the people above</option>
              <option value="lichen">Anyone on Lichen with the link can view</option>
              <option value="anyone">Anyone with the link can view — no account needed</option>
            </select>
          </>
        )}
        {msg && <p className="dshare__msg">{msg}</p>}
        <div className="dshare__foot">
          <button className="btn btn-secondary" onClick={() => void copy()}>{copied ? 'Link copied ✓' : 'Copy link'}</button>
          <button className="btn btn-primary" onClick={() => void send()}>Send the link…</button>
        </div>
        {owner && !doc.link_access && shares.length === 0 && (
          <p className="dshare__fine">Right now only you can open this link. Add people above, or open the link to Lichen or to anyone.</p>
        )}
      </div>
    </div>
  );
}
