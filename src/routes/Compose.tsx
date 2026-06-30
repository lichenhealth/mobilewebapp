import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import {
  createPost, CONTENT_TYPES, SERVICE_AREAS,
  type ContentType, type ServiceArea, type Visibility,
} from '../lib/postsApi';
import './Compose.css';

const MARKET_MODES = ['gift', 'trade', 'rent', 'lend', 'sliding', 'sale'] as const;

export default function Compose() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [visibility, setVisibility] = useState<Visibility>('public');
  const [contentType, setContentType] = useState<ContentType>('social');
  const [serviceArea, setServiceArea] = useState<ServiceArea | ''>(
    (params.get('area') as ServiceArea) || ''
  );
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // marketplace-specific
  const [price, setPrice] = useState('');
  const [mode, setMode] = useState<typeof MARKET_MODES[number]>('sale');
  const [location, setLocation] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true });
  }, [loading, user, navigate]);

  const isMarket = serviceArea === 'marketplace';

  async function submit() {
    if (!body.trim()) { setError('Add a few words first.'); return; }
    setBusy(true); setError('');
    try {
      const details: Record<string, unknown> = {};
      if (isMarket) {
        if (price.trim()) details.price = price.trim();
        details.mode = mode;
        if (location.trim()) details.location = location.trim();
      }
      await createPost({
        body, title, content_type: contentType, visibility,
        service_area: serviceArea || null, details,
      });
      navigate('/home');
    } catch (e) {
      setBusy(false);
      setError((e as Error)?.message || 'Couldn’t post. Please try again.');
    }
  }

  if (loading) return <div className="cmp"><p className="cmp__muted">Loading…</p></div>;

  return (
    <div className="cmp">
      <header className="cmp__head">
        <h1 className="cmp__title">New post</h1>
        <p className="cmp__sub">Share with the whole network, or just your mycelium.</p>
      </header>

      {error && <p className="cmp__error">{error}</p>}

      <label className="cmp__label">Audience</label>
      <div className="cmp__chips">
        {([['public', 'Everyone'], ['mycelium', 'My Mycelium']] as const).map(([v, label]) => (
          <button key={v} className={'cmp__chip' + (visibility === v ? ' is-on' : '')}
            onClick={() => setVisibility(v)}>{label}</button>
        ))}
      </div>

      <label className="cmp__label">Type</label>
      <div className="cmp__chips">
        {CONTENT_TYPES.map((t) => (
          <button key={t.value} className={'cmp__chip' + (contentType === t.value ? ' is-on' : '')}
            onClick={() => setContentType(t.value)}>{t.label}</button>
        ))}
      </div>

      <label className="cmp__label" htmlFor="cmp-area">Area (optional)</label>
      <select id="cmp-area" className="cmp__input" value={serviceArea}
        onChange={(e) => setServiceArea(e.target.value as ServiceArea | '')}>
        <option value="">— None (just a post) —</option>
        {SERVICE_AREAS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
      </select>

      <label className="cmp__label" htmlFor="cmp-title">Title (optional)</label>
      <input id="cmp-title" className="cmp__input" value={title}
        onChange={(e) => setTitle(e.target.value)} placeholder="A short headline" />

      <label className="cmp__label" htmlFor="cmp-body">Post</label>
      <textarea id="cmp-body" className="cmp__input cmp__textarea" value={body}
        onChange={(e) => setBody(e.target.value)} placeholder="What would you like to share?" />

      {isMarket && (
        <div className="cmp__market">
          <p className="cmp__market-head">Marketplace details</p>
          <div className="cmp__row">
            <input className="cmp__input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (e.g. $425)" />
            <select className="cmp__input" value={mode} onChange={(e) => setMode(e.target.value as typeof MARKET_MODES[number])}>
              {MARKET_MODES.map((m) => <option key={m} value={m}>{m[0].toUpperCase() + m.slice(1)}</option>)}
            </select>
          </div>
          <input className="cmp__input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Location (e.g. Wallowa, OR)" />
        </div>
      )}

      <button className="btn btn-primary cmp__post" onClick={submit} disabled={busy || !body.trim()}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </div>
  );
}
