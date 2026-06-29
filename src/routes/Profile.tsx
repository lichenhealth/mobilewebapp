import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import './Profile.css';

type SpaceKind = 'organization' | 'community' | 'group' | 'place';
type SpaceRole = 'super_admin' | 'admin' | 'member';
type MySpace = { id: string; name: string; kind: SpaceKind; role: SpaceRole };
type ProfileRow = { email: string | null; created_at: string; full_name: string | null; headline: string | null; bio: string | null };
type MemberRow = { role: SpaceRole; spaces: { id: string; name: string; kind: SpaceKind } | null };

const CAPS = [
  { id: 'service_provider', label: 'Service Provider' },
  { id: 'goods_provider', label: 'Goods Provider' },
];
const SPACE_SECTIONS: { kind: SpaceKind; title: string; one: string }[] = [
  { kind: 'organization', title: 'Your organizations', one: 'organization' },
  { kind: 'community',    title: 'Your communities',   one: 'community' },
  { kind: 'group',        title: 'Your groups',        one: 'group' },
  { kind: 'place',        title: 'Your places',        one: 'place' },
];
const ROLE_LABEL: Record<SpaceRole, string> = {
  super_admin: 'super admin', admin: 'admin', member: 'member',
};

export default function Profile() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [caps, setCaps] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<MySpace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [serviceCats, setServiceCats] = useState<string[]>([]);
  const [goodCats, setGoodCats] = useState<string[]>([]);

  const [loadingData, setLoadingData] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [newNames, setNewNames] = useState<Record<SpaceKind, string>>({
    organization: '', community: '', group: '', place: '',
  });
  const [addingKind, setAddingKind] = useState<SpaceKind | null>(null);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);
    const [pRes, cRes, mRes, catRes, pcRes] = await Promise.all([
      supabase.from('profiles').select('email,created_at,full_name,headline,bio').eq('id', user.id).single(),
      supabase.from('profile_capabilities').select('capability').eq('profile_id', user.id),
      supabase.from('space_members').select('role, spaces(id,name,kind)').eq('profile_id', user.id),
      supabase.from('categories').select('id, domain, name, sort').order('sort', { ascending: true }),
      supabase.from('profile_categories').select('category_id, categories(domain)').eq('profile_id', user.id),
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
    setCategories(((catRes.data as Category[] | null) ?? []));
    const pcRows = (pcRes.data as { category_id: string; categories: { domain: 'good' | 'service' } | null }[] | null) ?? [];
    setServiceCats(pcRows.filter((r) => r.categories?.domain === 'service').map((r) => r.category_id));
    setGoodCats(pcRows.filter((r) => r.categories?.domain === 'good').map((r) => r.category_id));
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

  // Persist category changes immediately (added -> upsert, removed -> delete)
  async function setCatsForDomain(domain: 'good' | 'service', ids: string[]) {
    if (!user) return;
    setError('');
    const prev = domain === 'service' ? serviceCats : goodCats;
    const added = ids.filter((x) => !prev.includes(x));
    const removed = prev.filter((x) => !ids.includes(x));
    if (domain === 'service') setServiceCats(ids); else setGoodCats(ids);
    if (added.length) {
      const rows = added.map((category_id) => ({ profile_id: user.id, category_id }));
      const { error: e } = await supabase.from('profile_categories')
        .upsert(rows, { onConflict: 'profile_id,category_id', ignoreDuplicates: true });
      if (e) setError(e.message);
    }
    if (removed.length) {
      const { error: e } = await supabase.from('profile_categories')
        .delete().eq('profile_id', user.id).in('category_id', removed);
      if (e) setError(e.message);
    }
  }

  async function addSpace(kind: SpaceKind) {
    const name = (newNames[kind] || '').trim();
    if (!user || !name) return;
    setAddingKind(kind); setError('');
    const { error: e } = await supabase.from('spaces').insert({ kind, name, created_by: user.id });
    setAddingKind(null);
    if (e) { setError(e.message); return; }
    setNewNames((m) => ({ ...m, [kind]: '' }));
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

  const showServices = caps.includes('service_provider');
  const showGoods = caps.includes('goods_provider');

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

        {showServices && (
          <div className="prof__picker">
            <p className="prof__picker-lead">Services you offer</p>
            <CategoryPicker
              domain="service"
              categories={categories}
              selected={serviceCats}
              onChange={(ids) => setCatsForDomain('service', ids)}
              userId={user.id}
            />
          </div>
        )}
        {showGoods && (
          <div className="prof__picker">
            <p className="prof__picker-lead">Goods you offer</p>
            <CategoryPicker
              domain="good"
              categories={categories}
              selected={goodCats}
              onChange={(ids) => setCatsForDomain('good', ids)}
              userId={user.id}
            />
          </div>
        )}
      </section>

      {SPACE_SECTIONS.map((sec) => {
        const mine = spaces.filter((s) => s.kind === sec.kind);
        const article = /^[aeiou]/i.test(sec.one) ? 'an' : 'a';
        return (
          <section className="prof__section" key={sec.kind}>
            <h2 className="prof__h2">{sec.title}</h2>
            {mine.length === 0 && <p className="prof__empty">None yet.</p>}
            <div className="prof__spaces">
              {mine.map((s) => {
                const canEdit = s.role === 'admin' || s.role === 'super_admin';
                return (
                  <div className="prof__space" key={s.id}>
                    <input
                      className="prof__space-name"
                      value={s.name}
                      readOnly={!canEdit}
                      onChange={(e) => editLocalName(s.id, e.target.value)}
                      onBlur={(e) => { if (canEdit) renameSpace(s.id, e.target.value); }}
                    />
                    <span className="prof__space-role">{ROLE_LABEL[s.role]}</span>
                  </div>
                );
              })}
            </div>
            <div className="prof__add-row">
              <input
                className="prof__input"
                value={newNames[sec.kind]}
                onChange={(e) => setNewNames((m) => ({ ...m, [sec.kind]: e.target.value }))}
                placeholder={'Name your ' + sec.one}
              />
              <button
                className="btn btn-primary"
                onClick={() => addSpace(sec.kind)}
                disabled={addingKind === sec.kind || !newNames[sec.kind].trim()}
              >
                {addingKind === sec.kind ? 'Adding...' : `Add ${article} ${sec.one}`}
              </button>
            </div>
          </section>
        );
      })}

      <div className="prof__signout">
        <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
