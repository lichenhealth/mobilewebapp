import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Profile.css';

type SpaceKind = 'organization' | 'community' | 'group';
type MySpace = { id: string; name: string; kind: SpaceKind; role: 'admin' | 'member' };
type ProfileRow = { email: string | null; created_at: string; full_name: string | null; headline: string | null; bio: string | null };
type MemberRow = { role: 'admin' | 'member'; spaces: { id: string; name: string; kind: SpaceKind } | null };

const CAPS = [
  { id: 'service_provider', label: 'Service Provider' },
  { id: 'goods_provider', label: 'Goods Provider' },
];
const KINDS: { id: SpaceKind; label: string }[] = [
  { id: 'organization', label: 'Organization' },
  { id: 'community', label: 'Community' },
  { id: 'group', label: 'Group' },
];

export default function Profile() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [caps, setCaps] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<MySpace[]>([]);

  const [loadingData, setLoadingData] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [newKind, setNewKind] = useState<SpaceKind>('community');
  const [newName, setNewName] = useState('');
  const [addingSpace, setAddingSpace] = useState(false);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);
    const [pRes, cRes, mRes] = await Promise.all([
      supabase.from('profiles').select('email,created_at,full_name,headline,bio').eq('id', user.id).single(),
      supabase.from('profile_capabilities').select('capability').eq('profile_id', user.id),
      supabase.from('space_members').select('role, spaces(id,name,kind)').eq('profile_id', user.id),
    ]);
    const p = pRes.data as ProfileRow | null;
    if (p) {
      setEmail(p.email ?? user.email ?? '');
      setFullName(p.full_name ?? '');
      setHeadline(p.headline ?? '');
      setBio(p.bio ?? '');
    } else {
      setEmail(user.email ?? '');
    }
    const cRows = (cRes.data as { capability: string }[] | null) ?? [];
    setCaps(cRows.map((r) => r.capability));
    const mRows = (mRes.data as MemberRow[] | null) ?? [];
    setSpaces(mRows.filter((r) => r.spaces).map((r) => ({
      id: r.spaces!.id, name: r.spaces!.name, kind: r.spaces!.kind, role: r.role,
    })));
    setLoadingData(false);
  }, [user]);

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (user) loadAll();
  }, [user, loading, navigate, loadAll]);

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true); setProfileMsg(''); setError('');
    const { error: e } = await supabase.from('profiles')
      .update({ full_name: fullName.trim(), headline: headline.trim() || null, bio: bio.trim() || null })
      .eq('id', user.id);
    setSavingProfile(false);
    if (e) { setError(e.message); return; }
    setProfileMsg('Saved');
    setTimeout(() => setProfileMsg(''), 2000);
  }

  async function toggleCap(cap: string) {
    if (!user) return;
    setError('');
    const on = caps.includes(cap);
    setCaps((cur) => (on ? cur.filter((x) => x !== cap) : [...cur, cap]));
    if (on) {
      const { error: e } = await supabase.from('profile_capabilities').delete().eq('profile_id', user.id).eq('capability', cap);
      if (e) { setError(e.message); setCaps((cur) => [...cur, cap]); }
    } else {
      const { error: e } = await supabase.from('profile_capabilities').insert({ profile_id: user.id, capability: cap });
      if (e) { setError(e.message); setCaps((cur) => cur.filter((x) => x !== cap)); }
    }
  }

  async function addSpace() {
    if (!user || !newName.trim()) return;
    setAddingSpace(true); setError('');
    const { error: e } = await supabase.from('spaces').insert({ kind: newKind, name: newName.trim(), created_by: user.id });
    setAddingSpace(false);
    if (e) { setError(e.message); return; }
    setNewName('');
    loadAll();
  }

  function editLocalName(id: string, name: string) {
    setSpaces((cur) => cur.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  async function renameSpace(id: string, name: string) {
    if (!name.trim()) { loadAll(); return; }
    setError('');
    const { error: e } = await supabase.from('spaces').update({ name: name.trim() }).eq('id', id);
    if (e) setError(e.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  if (loading || (user && loadingData)) {
    return <div className="prof"><p className="prof__muted">Loading...</p></div>;
  }
  if (!user) return null;

  return (
    <div className="prof">
      <div className="prof__head">
        <h1 className="prof__name">{fullName || 'Your profile'}</h1>
        <p className="prof__email">{email}</p>
      </div>

      {error && <p className="prof__error">{error}</p>}

      <section className="prof__section">
        <h2 className="prof__h2">About you</h2>
        <div className="prof__field">
          <label className="prof__label">Name</label>
          <input className="prof__input" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="prof__field">
          <label className="prof__label">Headline</label>
          <input className="prof__input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Somatic practitioner & land steward" />
        </div>
        <div className="prof__field">
          <label className="prof__label">Bio</label>
          <textarea className="prof__textarea" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A few words about you and your work" />
        </div>
        <div className="prof__save-row">
          <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save'}
          </button>
          {profileMsg && <span className="prof__msg">{profileMsg}</span>}
        </div>
      </section>

      <section className="prof__section">
        <h2 className="prof__h2">What you offer</h2>
        <div className="prof__caps">
          {CAPS.map((c) => (
            <button key={c.id} type="button"
              className={'prof__cap' + (caps.includes(c.id) ? ' is-on' : '')}
              onClick={() => toggleCap(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
      </section>

      <section className="prof__section">
        <h2 className="prof__h2">Your spaces</h2>
        {spaces.length === 0 && <p className="prof__empty">You don't run or belong to any spaces yet.</p>}
        <div className="prof__spaces">
          {spaces.map((s) => (
            <div className="prof__space" key={s.id}>
              <span className="prof__space-kind">{s.kind}</span>
              <input
                className="prof__space-name"
                value={s.name}
                readOnly={s.role !== 'admin'}
                onChange={(e) => editLocalName(s.id, e.target.value)}
                onBlur={(e) => { if (s.role === 'admin') renameSpace(s.id, e.target.value); }}
              />
              <span className="prof__space-role">{s.role}</span>
            </div>
          ))}
        </div>

        <div className="prof__add">
          <div className="prof__add-seg">
            {KINDS.map((k) => (
              <button key={k.id} type="button"
                className={newKind === k.id ? 'is-on' : ''}
                onClick={() => setNewKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="prof__add-row">
            <input className="prof__input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={'Name your ' + newKind} />
            <button className="btn btn-primary" onClick={addSpace} disabled={addingSpace || !newName.trim()}>
              {addingSpace ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      </section>

      <div className="prof__signout">
        <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
