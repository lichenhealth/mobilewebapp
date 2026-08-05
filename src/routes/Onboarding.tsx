import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import { LichenMark } from '../components/LichenMark';
import { tidyName, tidyNote, tidySpaceName } from '../lib/spaceName';
import './Onboarding.css';

type SpaceKind = 'organization' | 'community' | 'group' | 'place';
type DraftSpace = { id: number; kind: SpaceKind; name: string };

const CAPS = [
  { id: 'service_provider', label: 'Service Provider', desc: 'You offer services — healing, coaching, facilitation.' },
  { id: 'goods_provider',  label: 'Goods Provider',  desc: 'You offer goods — remedies, crafts, food, wares.' },
];

const SPACE_SECTIONS: { kind: SpaceKind; q: string; desc: string; one: string }[] = [
  { kind: 'organization', q: 'Do you run any organizations?', desc: 'Clinics, nonprofits, businesses, or practices you lead.', one: 'organization' },
  { kind: 'community',    q: 'Do you run any communities?',   desc: 'People gathered around a shared purpose or place.',     one: 'community' },
  { kind: 'group',        q: 'Do you run any groups?',        desc: 'Smaller circles — cohorts, teams, or working groups.',  one: 'group' },
  { kind: 'place',        q: 'Do you run any places?',        desc: 'Stewarded locations — land, centers, sanctuaries, venues.', one: 'place' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading, markOnboarded } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [caps, setCaps] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<DraftSpace[]>([]);
  // Auto-corrected kind word ("… Group" when the section already says Group)
  const [nameNote, setNameNote] = useState<{ key: number; text: string } | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [serviceCats, setServiceCats] = useState<string[]>([]);
  const [goodCats, setGoodCats] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nextId = useRef(1);

  useEffect(() => {
    if (!loading && !user) navigate('/signup', { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    let active = true;
    supabase
      .from('categories')
      .select('*')
      .order('sort', { ascending: true })
      .then(({ data }) => {
        if (active && data) setCategories(data as Category[]);
      });
    return () => { active = false; };
  }, []);

  // Prefill first/last from the name collected at signup (splittable full_name).
  useEffect(() => {
    if (!user) return;
    let active = true;
    supabase.from('profiles').select('full_name').eq('id', user.id).single()
      .then(({ data }) => {
        if (!active) return;
        const full = ((data as { full_name: string | null } | null)?.full_name ?? '').trim();
        if (!full) return;
        const sp = full.indexOf(' ');
        setFirstName((cur) => cur || (sp > 0 ? full.slice(0, sp) : full));
        if (sp > 0) setLastName((cur) => cur || full.slice(sp + 1).trim());
      });
    return () => { active = false; };
  }, [user]);

  /** The required basics; both Enter Lichen and "later" gate on these. */
  function basicsError(): string {
    return firstName.trim() && lastName.trim() && phone.trim()
      ? ''
      : 'Please add your first name, last name, and phone number.';
  }
  function basicsPatch() {
    return { first_name: firstName.trim(), last_name: lastName.trim(), phone: phone.trim() };
  }

  function toggleCap(id: string) {
    setCaps((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }
  function addSpace(kind: SpaceKind) {
    setSpaces((s) => [...s, { id: nextId.current++, kind, name: '' }]);
  }
  function updateSpace(id: number, patch: Partial<DraftSpace>) {
    setSpaces((s) => s.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)));
  }
  function removeSpace(id: number) {
    setSpaces((s) => s.filter((sp) => sp.id !== id));
  }

  async function finish() {
    if (!user) return;
    setError('');
    const basicsErr = basicsError();
    if (basicsErr) { setError(basicsErr); return; }
    const named = spaces.filter((s) => s.name.trim());
    if (spaces.length !== named.length) {
      setError('Please name each one, or remove the blank ones.');
      return;
    }
    setSaving(true);
    try {
      if (caps.length) {
        const rows = caps.map((capability) => ({ profile_id: user.id, capability }));
        const { error: capErr } = await supabase
          .from('profile_capabilities')
          .upsert(rows, { onConflict: 'profile_id,capability', ignoreDuplicates: true });
        if (capErr) throw capErr;
      }

      const catIds = [
        ...(caps.includes('goods_provider') ? goodCats : []),
        ...(caps.includes('service_provider') ? serviceCats : []),
      ];
      if (catIds.length) {
        const rows = catIds.map((category_id) => ({ profile_id: user.id, category_id }));
        const { error: catErr } = await supabase
          .from('profile_categories')
          .upsert(rows, { onConflict: 'profile_id,category_id', ignoreDuplicates: true });
        if (catErr) throw catErr;
      }

      if (named.length) {
        const rows = named.map((s) => ({ kind: s.kind, name: tidySpaceName(s.name, s.kind), created_by: user.id }));
        const { error: spaceErr } = await supabase.from('spaces').insert(rows);
        if (spaceErr) throw spaceErr;
      }
      const { error: onbErr } = await supabase
        .from('profiles').update({ ...basicsPatch(), onboarded: true }).eq('id', user.id);
      if (onbErr) throw onbErr;
      markOnboarded();
      navigate('/home', { replace: true });
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Something went wrong. Please try again.';
      setError(msg);
      setSaving(false);
    }
  }

  async function skip() {
    if (!user) { navigate('/home', { replace: true }); return; }
    // "Later" still marks the profile onboarded, so the basics can't be skipped.
    setError('');
    const basicsErr = basicsError();
    if (basicsErr) { setError(basicsErr); return; }
    setSaving(true);
    await supabase.from('profiles').update({ ...basicsPatch(), onboarded: true }).eq('id', user.id);
    markOnboarded();
    navigate('/home', { replace: true });
  }

  if (loading || !user) {
    return <div className="onb"><p className="onb__sub" style={{ marginTop: 40 }}>Loading…</p></div>;
  }

  const showServices = caps.includes('service_provider');
  const showGoods = caps.includes('goods_provider');

  return (
    <div className="onb">
      <div className="onb__card">
        <header className="onb__head">
          <div className="onb__logo"><LichenMark size={60} /></div>
          <h1 className="onb__title">Welcome to Lichen</h1>
          <p className="onb__sub">
            You’re a member now. Start with the basics, then tell us how you’ll show up —
            the rest is optional, and you can change it anytime.
          </p>
        </header>

        <section className="onb__section">
          <h2 className="onb__h2">First, the basics</h2>
          <div className="onb__basics">
            <input
              className="onb__input"
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              autoComplete="given-name"
            />
            <input
              className="onb__input"
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Last name"
              autoComplete="family-name"
            />
            <input
              className="onb__input"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone number"
              autoComplete="tel"
            />
          </div>
          <p className="onb__lead" style={{ marginBottom: 0 }}>
            Your care team uses your phone to reach you — and to call you if you’re ever on call for someone.
          </p>
        </section>

        <section className="onb__section">
          <h2 className="onb__h2">Do you offer any goods or services?</h2>
          <div className="onb__chips">
            {CAPS.map((c) => (
              <button
                type="button"
                key={c.id}
                className={'onb__chip' + (caps.includes(c.id) ? ' is-on' : '')}
                onClick={() => toggleCap(c.id)}
              >
                <strong>{c.label}</strong>
                <span>{c.desc}</span>
              </button>
            ))}
          </div>

          {showServices && (
            <div className="onb__picker">
              <p className="onb__lead">What services do you offer?</p>
              <CategoryPicker
                domain="service"
                categories={categories}
                selected={serviceCats}
                onChange={setServiceCats}
                userId={user.id}
              />
            </div>
          )}
          {showGoods && (
            <div className="onb__picker">
              <p className="onb__lead">What goods do you offer?</p>
              <CategoryPicker
                domain="good"
                categories={categories}
                selected={goodCats}
                onChange={setGoodCats}
                userId={user.id}
              />
            </div>
          )}
        </section>

        {SPACE_SECTIONS.map((sec) => {
          const mine = spaces.filter((s) => s.kind === sec.kind);
          const article = /^[aeiou]/i.test(sec.one) ? 'an' : 'a';
          return (
            <section className="onb__section" key={sec.kind}>
              <h2 className="onb__h2">{sec.q}</h2>
              <p className="onb__lead">{sec.desc} You’ll be the super admin of each.</p>

              {mine.map((s) => (
                <div className="onb__draft" key={s.id}>
                  <input
                    className="onb__input"
                    type="text"
                    value={s.name}
                    onChange={(e) => { updateSpace(s.id, { name: e.target.value }); setNameNote(null); }}
                    onBlur={() => {
                      const t = tidyName(s.name, s.kind);
                      if (t.removed) {
                        updateSpace(s.id, { name: t.name });
                        setNameNote({ key: s.id, text: tidyNote(t.removed, s.kind) });
                      }
                    }}
                    placeholder={'Name your ' + sec.one}
                  />
                  <button
                    type="button"
                    className="onb__remove"
                    onClick={() => removeSpace(s.id)}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
              {nameNote && mine.some((s) => s.id === nameNote.key) && (
                <p className="name-tidy-note">{nameNote.text}</p>
              )}

              <button type="button" className="onb__add" onClick={() => addSpace(sec.kind)}>
                + Add {mine.length ? 'another' : `${article} ${sec.one}`}
              </button>
            </section>
          );
        })}

        {error && <p className="onb__error">{error}</p>}

        <div className="onb__actions">
          <button className="btn btn-primary onb__finish" onClick={finish} disabled={saving}>
            {saving ? 'Setting up…' : 'Enter Lichen'}
          </button>
          <button className="onb__skip" type="button" onClick={skip} disabled={saving}>
            I’ll do this later
          </button>
        </div>
      </div>
    </div>
  );
}
