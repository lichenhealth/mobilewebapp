import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Onboarding.css';

type SpaceKind = 'organization' | 'community' | 'group';

const CAPS = [
  { id: 'service_provider', label: 'Service Provider', desc: 'You offer services — healing, coaching, facilitation.' },
  { id: 'goods_provider',  label: 'Goods Provider',  desc: 'You offer goods — remedies, crafts, food, wares.' },
];

const KINDS: { id: SpaceKind; label: string; desc: string }[] = [
  { id: 'organization', label: 'Organization', desc: 'A clinic, nonprofit, or business.' },
  { id: 'community',    label: 'Community',    desc: 'A place-based or affinity community.' },
  { id: 'group',        label: 'Group',        desc: 'A smaller circle within a community.' },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [caps, setCaps] = useState<string[]>([]);
  const [runsSpace, setRunsSpace] = useState(false);
  const [spaceKind, setSpaceKind] = useState<SpaceKind>('community');
  const [spaceName, setSpaceName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/signup', { replace: true });
  }, [loading, user, navigate]);

  function toggleCap(id: string) {
    setCaps((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  }

  async function finish() {
    if (!user) return;
    setError('');
    if (runsSpace && !spaceName.trim()) {
      setError('Please name your ' + spaceKind + ', or choose "I’ll do this later."');
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
      if (runsSpace && spaceName.trim()) {
        const { error: spaceErr } = await supabase
          .from('spaces')
          .insert({ kind: spaceKind, name: spaceName.trim(), created_by: user.id });
        if (spaceErr) throw spaceErr;
      }
      navigate('/home', { replace: true });
    } catch (e) {
      const msg = e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Something went wrong. Please try again.';
      setError(msg);
      setSaving(false);
    }
  }

  if (loading || !user) {
    return <div className="onb"><p className="onb__sub" style={{ marginTop: 40 }}>Loading…</p></div>;
  }

  return (
    <div className="onb">
      <div className="onb__card">
        <header className="onb__head">
          <span className="onb__leaf">🌱</span>
          <h1 className="onb__title">Welcome to Lichen</h1>
          <p className="onb__sub">
            You’re a member now. Tell us a little about how you’ll show up —
            all optional, and you can change it anytime.
          </p>
        </header>

        <section className="onb__section">
          <h2 className="onb__h2">Do you offer anything?</h2>
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
        </section>

        <section className="onb__section">
          <h2 className="onb__h2">Do you run a space?</h2>
          <label className="onb__toggle">
            <input
              type="checkbox"
              checked={runsSpace}
              onChange={(e) => setRunsSpace(e.target.checked)}
            />
            <span>Yes — I run an organization, community, or group</span>
          </label>
          {runsSpace && (
            <div className="onb__space">
              <div className="onb__kinds">
                {KINDS.map((k) => (
                  <button
                    type="button"
                    key={k.id}
                    className={'onb__kind' + (spaceKind === k.id ? ' is-on' : '')}
                    onClick={() => setSpaceKind(k.id)}
                  >
                    <strong>{k.label}</strong>
                    <span>{k.desc}</span>
                  </button>
                ))}
              </div>
              <input
                className="onb__input"
                type="text"
                value={spaceName}
                onChange={(e) => setSpaceName(e.target.value)}
                placeholder={'Name your ' + spaceKind}
              />
              <p className="onb__hint">
                You’ll be its admin. You can invite people and add more spaces later.
              </p>
            </div>
          )}
        </section>

        {error && <p className="onb__error">{error}</p>}

        <div className="onb__actions">
          <button className="btn btn-primary onb__finish" onClick={finish} disabled={saving}>
            {saving ? 'Setting up…' : 'Enter Lichen'}
          </button>
          <button className="onb__skip" type="button" onClick={() => navigate('/home', { replace: true })} disabled={saving}>
            I’ll do this later
          </button>
        </div>
      </div>
    </div>
  );
}
