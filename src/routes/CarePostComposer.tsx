import { useRef, useState, ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { DateRange } from '../components/DateRangeCalendar';
import RecurrencePicker from '../components/RecurrencePicker';
import { useAuth } from '../auth/AuthProvider';
import {
  CareKind, MediaKind, Dimension, WOW_DIMENSIONS,
  createCarePost, uploadCareMedia, isInternalUrl, resolvePreviews,
} from '../lib/conciergeApi';
import type { Recurrence } from '../lib/recurrence';
import { parseBodyUrls } from '../lib/linkify';
import './Concierge.css';

interface Pending { type: MediaKind; path: string; localUrl: string }
interface LinkRow { label: string; url: string }
const MAX_BYTES = 25 * 1024 * 1024;

/** Caregiver composer for a WOW or KOC care post (kind fixed by the route). */
export default function CarePostComposer({ kind }: { kind: CareKind }) {
  const { patientId = '' } = useParams();
  const { user } = useAuth();
  const me = user?.id ?? '';
  // No :patientId in the route = YOUR OWN board (founder 2026-08-14: you or
  // your care team can enter an updated score any time — same composer,
  // same dimension ticks, the entry just lands on your own web).
  const patient = patientId || me;
  const navigate = useNavigate();
  const back = () => navigate(patientId
    ? (kind === 'wow' ? `/concierge/client/${patientId}` : `/concierge/client/${patientId}/koc`)
    : (kind === 'wow' ? '/concierge' : '/concierge/koc'));

  const [body, setBody] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(false);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [dims, setDims] = useState<Set<Dimension>>(new Set());   // wow; empty = All
  const [score, setScore] = useState(70);                        // wow
  const [range, setRange] = useState<DateRange>({ start: null, end: null }); // koc
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);     // koc
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  async function addMedia(file: Blob, ext: string, type: MediaKind) {
    if (file.size > MAX_BYTES) { setError('That file is too large (max 25 MB).'); return; }
    setUploading(true); setError('');
    try {
      const path = await uploadCareMedia(patient, file, ext);
      setPending((p) => [...p, { type, path, localUrl: URL.createObjectURL(file) }]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); }
    setUploading(false);
  }
  function onFile(e: ChangeEvent<HTMLInputElement>, type: MediaKind) {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    addMedia(file, file.name.split('.').pop() || (type === 'photo' ? 'jpg' : 'mp4'), type);
  }
  async function toggleRecord() {
    if (recording) { recRef.current?.stop(); setRecording(false); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream); chunksRef.current = [];
      rec.ondataavailable = (ev) => { if (ev.data.size) chunksRef.current.push(ev.data); };
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); addMedia(new Blob(chunksRef.current, { type: 'audio/webm' }), 'webm', 'audio'); };
      rec.start(); recRef.current = rec; setRecording(true);
    } catch { setError('Mic unavailable.'); }
  }

  const toggleDim = (d: Dimension) => setDims((s) => { const n = new Set(s); n.has(d) ? n.delete(d) : n.add(d); return n; });

  async function save() {
    if (!me) return;
    const cleanedLinks = links.filter((l) => l.url.trim())
      .map((l) => ({ label: l.label.trim() || l.url.trim(), url: l.url.trim(), internal: isInternalUrl(l.url.trim()) }));
    if (!body.trim() && pending.length === 0 && cleanedLinks.length === 0) { setError('Add some text, media, or a link.'); return; }
    if (kind === 'koc') {
      if (!range.start) { setError('Pick a start day.'); return; }
      if (!recurrence && !range.end) { setError('Pick a day or a date range.'); return; }
    }
    if (uploading) return;
    setSaving(true); setError('');
    try {
      // Read links out of the body (Facebook-style) → rich previews stored on the post.
      const previews = await resolvePreviews(parseBodyUrls(body));
      await createCarePost(me, {
        patientId: patient, kind, body: body.trim(),
        dimensions: [...dims], score,
        startDate: range.start ?? undefined,
        endDate: recurrence ? undefined : (range.end ?? undefined),
        recurrence: kind === 'koc' ? recurrence : null,
        attachments: pending.map((p) => ({ type: p.type, path: p.path })),
        links: cleanedLinks, previews,
      });
      back();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save.'); setSaving(false); }
  }

  return (
    <div className="cedit">
      <header className="cedit__head">
        <button className="conc__back" onClick={back} aria-label="Back"><Icon name="arrow-left" size={18} /></button>
        <h1 className="cedit__title">{kind === 'wow' ? 'New wellbeing post' : 'New care plan post'}</h1>
        <button className="btn btn-primary cedit__save" onClick={save} disabled={saving || uploading}>
          {saving ? 'Posting…' : 'Post'}
        </button>
      </header>

      {error && <p className="cedit__error">{error}</p>}

      <div className="cedit__body">
        <textarea className="cedit__textarea" rows={4} placeholder="Write something…" value={body}
          onChange={(e) => setBody(e.target.value)} />

        {/* Media */}
        <div className="cedit__field">
          <div className="cpost-compose__media-btns">
            <button className="cedit__add" onClick={() => photoRef.current?.click()} disabled={uploading}><Icon name="image" size={14} /> Photo</button>
            <button className="cedit__add" onClick={() => videoRef.current?.click()} disabled={uploading}><Icon name="video" size={14} /> Video</button>
            <button className={'cedit__add' + (recording ? ' is-on' : '')} onClick={toggleRecord}><Icon name="mic" size={14} /> {recording ? 'Stop' : 'Audio'}</button>
            {uploading && <span className="cedit__hint">Uploading…</span>}
          </div>
          <input ref={photoRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e, 'photo')} />
          <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => onFile(e, 'video')} />
          {pending.length > 0 && (
            <div className="cpost-compose__tray">
              {pending.map((p, i) => (
                <div className="cpost-compose__thumb" key={i}>
                  {p.type === 'photo' ? <img src={p.localUrl} alt="" />
                    : p.type === 'video' ? <video src={p.localUrl} muted />
                    : <span className="cpost-compose__aud"><Icon name="mic" size={16} /></span>}
                  <button onClick={() => setPending((m) => m.filter((_, idx) => idx !== i))} aria-label="Remove">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Links */}
        <div className="cedit__field">
          <div className="cedit__row-head">
            <span className="cedit__label">Links</span>
            <button className="cedit__add cedit__add--sm" onClick={() => setLinks((l) => [...l, { label: '', url: '' }])}><Icon name="plus" size={12} /> Add link</button>
          </div>
          <p className="cedit__hint">Paste any web link, or an in-app path like <code>/market</code>.</p>
          {links.map((l, i) => (
            <div className="cpost-compose__link" key={i}>
              <input className="cedit__input" placeholder="Label" value={l.label}
                onChange={(e) => setLinks((ls) => ls.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
              <input className="cedit__input" placeholder="https://…  or  /market" value={l.url}
                onChange={(e) => setLinks((ls) => ls.map((x, idx) => idx === i ? { ...x, url: e.target.value } : x))} />
              <button className="cedit__remove" onClick={() => setLinks((ls) => ls.filter((_, idx) => idx !== i))} aria-label="Remove"><Icon name="close" size={13} /></button>
            </div>
          ))}
        </div>

        {/* WOW: dimensions + score */}
        {kind === 'wow' && (
          <>
            <div className="cedit__field">
              <span className="cedit__label">File under</span>
              <div className="cpost-compose__dims">
                <button className={'cpost-compose__dim' + (dims.size === 0 ? ' is-on' : '')} onClick={() => setDims(new Set())}>All</button>
                {WOW_DIMENSIONS.map((d) => (
                  <button key={d} className={'cpost-compose__dim' + (dims.has(d) ? ' is-on' : '')} onClick={() => toggleDim(d)}>{d}</button>
                ))}
              </div>
            </div>
            <div className="cedit__field">
              <span className="cedit__label">Wellbeing score — {score}%</span>
              <input type="range" min={0} max={100} value={score} onChange={(e) => setScore(Number(e.target.value))} />
              <p className="cedit__hint">100% = thriving here · 70% ≈ a “C-”.</p>
            </div>
          </>
        )}

        {/* KOC: schedule + recurrence */}
        {kind === 'koc' && (
          <div className="cedit__field">
            <span className="cedit__label">Schedule</span>
            <RecurrencePicker
              range={range} recurrence={recurrence}
              onRangeChange={setRange} onRecurrenceChange={setRecurrence}
            />
          </div>
        )}
      </div>
    </div>
  );
}
