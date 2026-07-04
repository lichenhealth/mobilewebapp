import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { colorFor, monogramFor } from '../lib/chatApi';
import { Icon } from '../components/Icon';
import {
  createPost, uploadMedia, CONTENT_TYPES, SERVICE_AREAS, EVENT_CATEGORIES, EVENT_MODES,
  type ContentType, type ServiceArea, type EventCategory, type EventMode,
} from '../lib/postsApi';
import { createEvent, deleteEvent } from '../lib/calendarApi';
import { resolvePreviews } from '../lib/conciergeApi';
import { parseBodyUrls } from '../lib/linkify';
import DateRangeCalendar, { type DateRange } from '../components/DateRangeCalendar';
import TimeField from '../components/TimeField';
import { todayISO } from '../lib/conciergeApi';
import './Compose.css';


type MediaType = 'photo' | 'video' | 'audio';
type Attached = { type: MediaType; url: string };

export default function Compose() {
  const { loading, user } = useAuth();
  const { actor } = useActing();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Audiences: Everyone is exclusive; Mycelium + spaces combine freely.
  const [isPublic, setIsPublic] = useState(true);
  const [toMycelium, setToMycelium] = useState(false);
  const [audienceSpaces, setAudienceSpaces] = useState<Set<string>>(new Set());
  const [mySpaces, setMySpaces] = useState<{ id: string; name: string }[]>([]);
  const [contentType, setContentType] = useState<ContentType>('social');
  // "Where": a post can live in several areas at once.
  const [areas, setAreas] = useState<Set<ServiceArea>>(() => {
    const a = params.get('area') as ServiceArea | null;
    return new Set(a ? [a] : []);
  });
  const [whereOpen, setWhereOpen] = useState(false);

  // Event details (when Where includes 'events'): the post gets a REAL
  // calendar event behind it — the RSVP container.
  const [evCategory, setEvCategory] = useState<EventCategory>('experiences');
  // Unified offer mode: events use free|trade|paid; marketplace-only listings
  // additionally get lend|rent (you can't rent someone an event).
  type OfferMode = EventMode | 'lend' | 'rent';
  const [evMode, setEvMode] = useState<OfferMode>('free');
  const [evRange, setEvRange] = useState<DateRange>({ start: todayISO(), end: todayISO() });
  const [evAllDay, setEvAllDay] = useState(false);
  const [evStartMin, setEvStartMin] = useState(18 * 60);
  const [evEndMin, setEvEndMin] = useState(20 * 60);
  const [bookingUrl, setBookingUrl] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [sliding, setSliding] = useState(false);
  const [slideLow, setSlideLow] = useState('');
  const [slideHigh, setSlideHigh] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [price, setPrice] = useState('');
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

  // Every space I belong to (any role) is an audience option.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('space_members').select('spaces(id, name)').eq('profile_id', user.id);
      setMySpaces(((data as unknown as { spaces: { id: string; name: string } | null }[] | null) ?? [])
        .map((r) => r.spaces).filter((s): s is { id: string; name: string } => !!s));
    })();
  }, [user]);

  const pickEveryone = () => { setIsPublic(true); setToMycelium(false); setAudienceSpaces(new Set()); };
  const toggleMycelium = () => { setIsPublic(false); setToMycelium((v) => !v); };
  const toggleSpace = (id: string) => {
    setIsPublic(false);
    setAudienceSpaces((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleArea = (a: ServiceArea) =>
    setAreas((cur) => { const n = new Set(cur); n.has(a) ? n.delete(a) : n.add(a); return n; });
  const hasAudience = isPublic || toMycelium || audienceSpaces.size > 0;

  const isMarket = areas.has('marketplace');
  const isEvent = areas.has('events');
  // Events narrow the mode set — clamp lend/rent if events joins the areas.
  useEffect(() => {
    if (isEvent && (evMode === 'lend' || evMode === 'rent')) setEvMode('paid');
  }, [isEvent, evMode]);

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
    if (!hasAudience) { setError('Pick at least one audience.'); return; }
    if (isEvent && !evRange.start) { setError('Pick a date for your event.'); return; }
    setBusy(true); setError('');
    try {
      const details: Record<string, unknown> = {};
      if (isMarket || isEvent) {
        if (evMode === 'paid') {
          if (sliding && (slideLow.trim() || slideHigh.trim())) {
            details.price = `Sliding scale ${slideLow.trim() || '?'}–${slideHigh.trim() || '?'}`;
            details.sliding = true;
          } else if (price.trim()) {
            details.price = price.trim();
          }
          if (isEvent && bookingUrl.trim()) details.bookingUrl = bookingUrl.trim();
        }
        if (evMode === 'trade' && tradeFor.trim()) details.trade = tradeFor.trim();
        if (location.trim()) details.location = location.trim();
        if (isMarket) {
          // Marketplace-compatible mode vocabulary.
          details.mode = evMode === 'free' ? 'gift'
            : evMode === 'paid' ? (sliding ? 'sliding' : 'sale')
            : evMode;
        }
      }
      if (media.length) details.media = media;
      // Rich previews for any pasted links, resolved once at compose time
      // (YouTube parsed locally; other links via the link-preview function).
      const previews = await resolvePreviews(parseBodyUrls(body));
      if (previews.length) details.previews = previews;
      const firstPhoto = media.find((m) => m.type === 'photo')?.url ?? null;

      // Events first create their calendar event (the RSVP container); if the
      // post insert then fails, the orphan event is cleaned up below.
      let linkedEventId: string | null = null;
      if (isEvent && evRange.start) {
        linkedEventId = await createEvent(user!.id, {
          ownerProfileId: actor.type === 'space' ? undefined : user!.id,
          ownerSpaceId: actor.type === 'space' ? actor.id : undefined,
          title: title.trim() || body.trim().slice(0, 60) || 'Event',
          description: body.trim(),
          location: location.trim(),
          startDate: evRange.start,
          endDate: evRange.end ?? evRange.start,
          allDay: evAllDay,
          startMin: evStartMin, endMin: evEndMin,
          recurrence: null,
          inviteeIds: [],
        });
      }
      try {
        await createPost({
          body, title, content_type: isEvent ? 'actionable' : contentType,
          isPublic, toMycelium, audienceSpaceIds: [...audienceSpaces],
          serviceAreas: [...areas],
          authorSpaceId: actor.type === 'space' ? actor.id : null,
          eventCategory: isEvent ? evCategory : null,
          eventMode: isEvent ? (evMode as EventMode) : null,
          linkedEventId,
          image_url: firstPhoto, details,
        });
      } catch (postErr) {
        if (linkedEventId) await deleteEvent(linkedEventId).catch(() => {});
        throw postErr;
      }
      navigate(isEvent ? '/events' : '/home');
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

      {actor.type === 'space' && (
        <p className="cmp__acting">
          <span className="cmp__acting-avatar" style={{ background: colorFor(actor.id) }}>{monogramFor(actor.name)}</span>
          Posting as <strong>{actor.name}</strong>
        </p>
      )}

      <label className="cmp__label">Audience</label>
      <div className="cmp__chips">
        <button className={'cmp__chip' + (isPublic ? ' is-on' : '')} onClick={pickEveryone}>Everyone</button>
        <button className={'cmp__chip' + (toMycelium ? ' is-on' : '')} onClick={toggleMycelium}>My Mycelium</button>
        {mySpaces.map((sp) => (
          <button key={sp.id} className={'cmp__chip' + (audienceSpaces.has(sp.id) ? ' is-on' : '')}
            onClick={() => toggleSpace(sp.id)}>{sp.name}</button>
        ))}
      </div>

      {/* Type is a posts concept — an event's type IS its category (and an
          event post files as 'actionable' automatically). */}
      {!isEvent && (
        <>
          <label className="cmp__label">Type</label>
          <div className="cmp__chips">
            {CONTENT_TYPES.map((t) => (
              <button key={t.value} className={'cmp__chip' + (contentType === t.value ? ' is-on' : '')}
                onClick={() => setContentType(t.value)}>{t.label}</button>
            ))}
          </div>
        </>
      )}

      <label className="cmp__label">Where (optional)</label>
      <button className="cmp__input cmp__where-btn" onClick={() => setWhereOpen((o) => !o)} aria-expanded={whereOpen}>
        {areas.size === 0 ? <span className="cmp__where-none">— Anywhere (just a post) —</span> : (
          <span className="cmp__where-sel">
            {SERVICE_AREAS.filter((a) => areas.has(a.value)).map((a) => (
              <span key={a.value} className="cmp__where-tag"><Icon name={a.icon} size={12} /> {a.label}</span>
            ))}
          </span>
        )}
        <span className={'cmp__where-caret' + (whereOpen ? ' is-open' : '')}><Icon name="chevron-right" size={14} /></span>
      </button>
      {whereOpen && (
        <div className="cmp__where-list">
          {SERVICE_AREAS.map((a) => (
            <label key={a.value} className="cmp__where-row">
              <input type="checkbox" checked={areas.has(a.value)} onChange={() => toggleArea(a.value)} />
              <Icon name={a.icon} size={14} /> {a.label}
            </label>
          ))}
        </div>
      )}

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

      {(isEvent || isMarket) && (
        <div className="cmp__market">
          <p className="cmp__market-head">{isEvent ? 'Event details' : 'Marketplace details'}</p>
          {isEvent && (
            <>
              <label className="cmp__label">Category</label>
              <div className="cmp__chips">
                {EVENT_CATEGORIES.map((c) => (
                  <button key={c.value} className={'cmp__chip' + (evCategory === c.value ? ' is-on' : '')}
                    onClick={() => setEvCategory(c.value)}>{c.label}</button>
                ))}
              </div>
            </>
          )}
          <label className="cmp__label">{isEvent ? 'Free, trade, or paid?' : 'Gift, trade, lend, rent, or paid?'}</label>
          <div className="cmp__chips">
            <button className={'cmp__chip' + (evMode === 'free' ? ' is-on' : '')} onClick={() => setEvMode('free')}>{isEvent ? 'Free' : 'Gift'}</button>
            <button className={'cmp__chip' + (evMode === 'trade' ? ' is-on' : '')} onClick={() => setEvMode('trade')}>Trade</button>
            {!isEvent && (
              <>
                <button className={'cmp__chip' + (evMode === 'lend' ? ' is-on' : '')} onClick={() => setEvMode('lend')}>Lend</button>
                <button className={'cmp__chip' + (evMode === 'rent' ? ' is-on' : '')} onClick={() => setEvMode('rent')}>Rent</button>
              </>
            )}
            <button className={'cmp__chip' + (evMode === 'paid' ? ' is-on' : '')} onClick={() => setEvMode('paid')}>Paid</button>
          </div>
          {evMode === 'paid' && (
            <label className="cmp__sliding">
              <input type="checkbox" checked={sliding} onChange={(e) => setSliding(e.target.checked)} /> Sliding scale
            </label>
          )}
          {evMode === 'paid' && !sliding && (
            <div className="cmp__row">
              <input className="cmp__input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (e.g. $45)" />
              {isEvent && <input className="cmp__input" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="Booking link (https://…)" />}
            </div>
          )}
          {evMode === 'paid' && sliding && (
            <>
              <div className="cmp__row">
                <input className="cmp__input" value={slideLow} onChange={(e) => setSlideLow(e.target.value)} placeholder="From (e.g. $20)" />
                <input className="cmp__input" value={slideHigh} onChange={(e) => setSlideHigh(e.target.value)} placeholder="To (e.g. $60)" />
              </div>
              {isEvent && <input className="cmp__input" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="Booking link (https://…)" />}
            </>
          )}
          {(evMode === 'lend' || evMode === 'rent') && (
            <input className="cmp__input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={evMode === 'rent' ? 'Rate (e.g. $20/day)' : 'Terms (e.g. return within a week)'} />
          )}
          {evMode === 'trade' && (
            <input className="cmp__input" value={tradeFor} onChange={(e) => setTradeFor(e.target.value)} placeholder="Open to trades for… (optional)" />
          )}

          <label className="cmp__label">Location</label>
          <input className="cmp__input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Address, place, or video link" />

          {isEvent && (
            <>
              <label className="cmp__label">When</label>
              <label className="cmp__evrow"><input type="checkbox" checked={evAllDay} onChange={(e) => setEvAllDay(e.target.checked)} /> All day</label>
              {!evAllDay && (
                <div className="cmp__row cmp__row--times">
                  <TimeField value={evStartMin} onChange={(m) => { setEvStartMin(m); if (evEndMin <= m) setEvEndMin(Math.min(m + 60, 1440)); }} ariaLabel="Start time" />
                  <span className="cmp__to">to</span>
                  <TimeField value={evEndMin} onChange={setEvEndMin} min={evRange.start === (evRange.end ?? evRange.start) ? evStartMin : undefined} ariaLabel="End time" />
                </div>
              )}
              <DateRangeCalendar value={evRange} onChange={setEvRange} />
              <p className="cmp__hint-ev">Booking a free or trade event RSVPs through Lichen and lands it on people's calendars. Paid events send people to your booking link.</p>
            </>
          )}
        </div>
      )}

      <button className="btn btn-primary cmp__post" onClick={submit} disabled={busy || uploading || !body.trim()}>
        {busy ? 'Posting…' : 'Post'}
      </button>
    </div>
  );
}
