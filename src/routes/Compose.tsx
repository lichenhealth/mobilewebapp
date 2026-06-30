import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import {
  createPost, uploadMedia, CONTENT_TYPES, SERVICE_AREAS,
  type ContentType, type ServiceArea, type Visibility,
} from '../lib/postsApi';
import './Compose.css';

const MARKET_MODES = ['gift', 'trade', 'rent', 'lend', 'sliding', 'sale'] as const;

type MediaType = 'photo' | 'video' | 'audio';
type Attached = { type: MediaType; url: string };

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
  const [price, setPrice] = useState('');
  const [mode, setMode] = useState<typeof MARKET_MODES[number]>('sale');
  const [location, setLocation] = useState('');

  // media
  const [media, setMedia] = useState<Attached[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true });
  }, [loading, user, navigate]);

  const isMarket = serviceArea === 'marketplace';

  async function addMedia(file: Blob, ext: string, type: MediaType) {
    setUploading(true); setError('');
    try {
      const url = await uploadMedia(file, ext);
      setMedia((m) => [...m, { type, url }]);
    } catch {
      setError('Upload failed — please try again.');
    }
    setUploading(false);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>, type: MediaType) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const fallback = type === 'photo' ? 'jpg' : 'mp4';
    const ext = (file.name.split('.').pop() || fallback).toLowerCase();
    addMedia(file, ext, type);
  }

  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        addMedia(new Blob(chunksRef.current, { type: 'audio/webm' }), 'webm', 'audio');
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError('Microphone access was denied or is unavailable.');
    }
  }

  function removeMedia(i: number) {
    setMedia((m) => m.filter((_, idx) => idx !== i));
  }

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
      if (media.length) details.media = media;
      const firstPhoto = media.find((m) => m.type === 'photo')?.url ?? null;
      await createPost({
        body, title, content_type: contentType, visibility,
        service_area: serviceArea || null, image_url: firstPhoto, details,
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

      {/* Add context — media */}
      <label className="cmp__label">Add context</label>
      <div className="cmp__media-btns">
        <button className="cmp__media-btn" onClick={() => photoRef.current?.click()} disabled={uploading}>
          <Icon name="image" size={20} /><span>Photo</span>
        </button>
        <button className="cmp__media-btn" onClick={() => videoRef.current?.click()} disabled={uploading}>
          <Icon name="video" size={20} /><span>Video</span>
        </button>
        <button className={'cmp__media-btn' + (recording ? ' is-recording' : '')} onClick={toggleRecord} disabled={uploading && !recording}>
          <Icon name="mic" size={20} /><span>{recording ? 'Stop' : 'Audio'}</span>
        </button>
      </div>
      <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e, 'photo')} />
      <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => onFile(e, 'video')} />

      {uploading && <p className="cmp__uploading">Uploading…</p>}
      {media.length > 0 && (
        <div className="cmp__attached">
          {media.map((m, i) => (
            <div key={i} className="cmp__attached-item">
              {m.type === 'photo' && <img src={m.url} alt="attachment" />}
              {m.type === 'video' && <video src={m.url} muted />}
              {m.type === 'audio' && <span className="cmp__attached-audio"><Icon name="mic" size={14} /> Audio clip</span>}
              <button className="cmp__attached-remove" onClick={() => removeMedia(i)} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      )}

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

      <button className="btn btn-primary cmp__post" onClick={submit} disabled={busy || uploading || !body.trim()}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </div>
  );
}
