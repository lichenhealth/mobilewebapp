import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { colorFor, monogramFor } from '../lib/chatApi';
import { Icon } from '../components/Icon';
import {
  createPost, updatePost, loadPost, postAreas, uploadMedia,
} from '../lib/postsApi';
import { uploadVideo, listMyReadyVideos, videoPublicUrl, type ReadyVideo } from '../lib/videoApi';
import { setSaved } from '../lib/savedApi';
import { listMyCollections, createCollection, addToCollection, type CollectionRow } from '../lib/collectionsApi';
import {
  SERVICE_AREAS, EVENT_CATEGORIES, EVENT_MODES,
  type ContentType, type ServiceArea, type EventCategory, type EventMode,
} from '../lib/postsApi';
import { createEvent, deleteEvent, updateEventDetails } from '../lib/calendarApi';
import LocationField from '../components/LocationField';
import type { GeoPoint } from '../lib/geoApi';
import { resolvePreviews } from '../lib/conciergeApi';
import { parseBodyUrls } from '../lib/linkify';
import DateRangeCalendar, { type DateRange } from '../components/DateRangeCalendar';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import TimeField from '../components/TimeField';
import { todayISO } from '../lib/conciergeApi';
import './Compose.css';


type MediaType = 'photo' | 'video' | 'audio';
type Attached = { type: MediaType; url: string; jobId?: string };

export default function Compose() {
  const { loading, user } = useAuth();
  const { actor } = useActing();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Audiences: Everyone is exclusive; Mycelium + spaces combine freely.
  // ?space=<id> = the + button on a space profile: post INTO that space.
  const presetSpace = params.get('space');
  const [isPublic, setIsPublic] = useState(!presetSpace);
  const [toMycelium, setToMycelium] = useState(false);
  const [audienceSpaces, setAudienceSpaces] = useState<Set<string>>(() => new Set(presetSpace ? [presetSpace] : []));
  const [mySpaces, setMySpaces] = useState<{ id: string; name: string; kind: string }[]>([]);
  const [myAdminSpaces, setMyAdminSpaces] = useState<Set<string>>(new Set());
  // The choice point (founder + Melanie, 2026-07-27): every post is either
  // SOCIAL — it flows through a Space feed — or ACTIONABLE — it flows through
  // the Lichen Economy (every actionable post rides the Marketplace; a gift
  // is simply an offer open to anyone). The old five-way Type row is gone;
  // legacy content_types survive on old posts (contentType preserves them
  // through an edit unless the member taps a face).
  const [face, setFace] = useState<'social' | 'actionable'>(() =>
    params.get('area') ? 'actionable' : 'social');
  const [contentType, setContentType] = useState<ContentType>(() =>
    params.get('area') ? 'actionable' : 'social');
  // "Where": a post can live in several areas at once.
  const [areas, setAreas] = useState<Set<ServiceArea>>(() => {
    const a = params.get('area') as ServiceArea | null;
    // The Marketplace is the Commons' catch-all — pre-checked wherever an
    // offer starts, but a CHECKBOX: deselect it to keep goods off the open
    // square and shelve them only in Courses/Library/etc (founder 2026-07-27).
    return new Set(a ? (a === 'marketplace' ? [a] : [a, 'marketplace']) : []);
  });
  const [whereOpen, setWhereOpen] = useState(false);

  // Event details (when Where includes 'events'): the post gets a REAL
  // calendar event behind it — the RSVP container.
  const [evCategory, setEvCategory] = useState<EventCategory>('experiences');
  // Unified offer mode: events use free|trade|paid; marketplace-only listings
  // additionally get lend|rent (you can't rent someone an event).
  // 'lichen' = the entrusted mode: a gift whose allocation is handed to the
  // Lichen Economy Algorithm (details.mode='gift' + allocation='lichen').
  type OfferMode = EventMode | 'lend' | 'rent' | 'borrow' | 'iso' | 'lichen';
  const [evMode, setEvMode] = useState<OfferMode>(
    params.get('entrust') === '1' ? 'lichen' : 'free');
  // Multi-select modes (non-event offers): one thing can be a gift to some
  // and paid for others. Lichen* stays exclusive — it hands allocation over.
  const [modes, setModes] = useState<Set<OfferMode>>(
    () => new Set([params.get('entrust') === '1' ? 'lichen' : 'free'] as OfferMode[]));
  const [giftTo, setGiftTo] = useState('');
  // Lend/rent/borrow/ISO each keep their own terms line (they used to fight
  // over one shared field). details.modeNotes carries the map.
  const [modeNotes, setModeNotes] = useState<Record<string, string>>({});
  // A SET term freezes into a sentence that follows the post (founder
  // 2026-07-27) — presentation only; typed values save either way.
  const [setTerms, setSetTerms] = useState<Set<OfferMode>>(new Set());
  // Listing details (Figma 286-4961): the physical facts of a thing offered.
  const [condition, setCondition] = useState<Set<string>>(new Set());
  const [availFrom, setAvailFrom] = useState('');
  const [availTo, setAvailTo] = useState('');
  const [fulfillment, setFulfillment] = useState<Set<string>>(new Set());
  const [deliverRadius, setDeliverRadius] = useState('');
  const [paymentPlan, setPaymentPlan] = useState('');
  // Category tags — the real 63-category taxonomy, loaded when opened.
  const [tagsOpen, setTagsOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [allCats, setAllCats] = useState<Category[] | null>(null);
  const [catTags, setCatTags] = useState<string[]>([]);
  useEffect(() => {
    if (!tagsOpen || allCats !== null) return;
    void supabase.from('categories').select('*').order('sort')
      .then(({ data }) => setAllCats((data as Category[] | null) ?? []));
  }, [tagsOpen, allCats]);
  const [evRange, setEvRange] = useState<DateRange>({ start: todayISO(), end: todayISO() });
  const [evAllDay, setEvAllDay] = useState(false);
  const [evStartMin, setEvStartMin] = useState(18 * 60);
  const [evEndMin, setEvEndMin] = useState(20 * 60);
  const [bookingUrl, setBookingUrl] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [sliding, setSliding] = useState(false);
  // In-kind DONATION: title passes to Lichen (the Goodwill move) — that's
  // what makes a tax acknowledgment legal. Offered under Lichen*; a steward
  // accepts on the routing desk, and the receipt email follows.
  const [inkind, setInkind] = useState(false);
  const [slideLow, setSlideLow] = useState('');
  const [slideHigh, setSlideHigh] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState('');
  // Where it happens (founder 2026-07-27): Online and In person are
  // CHECKBOXES — a hybrid offering carries a meeting link AND an address.
  const [online, setOnline] = useState(false);
  const [inPerson, setInPerson] = useState(false);
  const [meetingUrl, setMeetingUrl] = useState('');
  // Coordinates from a picked LocationField suggestion (null = text-only).
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(null);

  // media
  const [media, setMedia] = useState<Attached[]>([]);
  // Organize-into (courses/library): file this post straight into one of your
  // courses/collections — or start a new one — right from Compose.
  const [myCols, setMyCols] = useState<CollectionRow[]>([]);
  const [organizeInto, setOrganizeInto] = useState<string | null>(null);
  const [newColName, setNewColName] = useState('');
  const [uploading, setUploading] = useState(false);
  // Video picker: upload from this device, or attach a big file the studio
  // Mac already ingested (worker/ingest.js — Zoom recordings skip the cap).
  const [vidPickOpen, setVidPickOpen] = useState(false);
  const [readyVids, setReadyVids] = useState<ReadyVideo[] | null>(null);
  const [recording, setRecording] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Edit mode: ?post=<id> loads an existing post (author only) and submit
  // updates in place instead of creating.
  const editPostId = params.get('post');

  /** After posting, land back where the + was pressed: the space's profile,
   *  else the section (Library → /library), else Home. */
  const AREA_HOME: Partial<Record<ServiceArea, string>> = {
    marketplace: '/market', courses: '/courses', library: '/library',
    events: '/events', work: '/work', places: '/places',
    art: '/art', food: '/food', travel: '/travel',
  };
  function afterPostDestination(isEventPost: boolean): string {
    if (presetSpace) return `/spaces/${presetSpace}`;
    if (isEventPost) return '/events';
    const a = params.get('area') as ServiceArea | null;
    return (a && AREA_HOME[a]) || '/home';
  }
  const editing = !!editPostId;

  // Content controls (founder 2026-08-05): AI-readable + downloadable, BOTH
  // on by default; a member's profile defaults pre-select them for new
  // posts, and each post can flip either. Stored in details only when OFF.
  const [aiReadable, setAiReadable] = useState(true);
  const [downloadable, setDownloadable] = useState(true);
  useEffect(() => {
    if (!user || editPostId) return;   // edits prefill from the post itself
    let live = true;
    void supabase.from('profiles')
      .select('content_ai_default, content_download_default')
      .eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return;    // pre-migration: keep the true defaults
        const r = data as { content_ai_default?: boolean; content_download_default?: boolean };
        if (r.content_ai_default === false) setAiReadable(false);
        if (r.content_download_default === false) setDownloadable(false);
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, editPostId]);

  const [editReady, setEditReady] = useState(!editing);
  const editLinkedEvent = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!editPostId || !user) return;
    let live = true;
    (async () => {
      const p = await loadPost(editPostId);
      if (!live) return;
      if (!p || p.author_id !== user.id) { navigate('/events', { replace: true }); return; }
      editLinkedEvent.current = p.linked_event_id;
      setIsPublic(p.is_public);
      setToMycelium(p.to_mycelium);
      setAudienceSpaces(new Set(p.audience_space_ids ?? []));
      setContentType(p.content_type);
      setFace(p.content_type === 'actionable' || postAreas(p).length > 0 ? 'actionable' : 'social');
      setAreas(new Set(postAreas(p)));
      setTitle(p.title ?? '');
      setBody(p.body ?? '');
      if (p.event_category) setEvCategory(p.event_category);
      if (p.event_mode) setEvMode(p.event_mode);
      const ev = p.linked_event;
      if (ev) {
        setEvRange({ start: ev.start_date, end: ev.end_date });
        setEvAllDay(ev.all_day);
        if (ev.start_min != null) setEvStartMin(ev.start_min);
        if (ev.end_min != null) setEvEndMin(ev.end_min);
      }
      const d = p.details ?? {};
      setAiReadable(!d.aiExcluded);
      setDownloadable(!d.noDownload);
      const back: Record<string, OfferMode> = {
        gift: 'free', sale: 'paid', sliding: 'paid',
        trade: 'trade', lend: 'lend', rent: 'rent', borrow: 'borrow', iso: 'iso',
      };
      if (!p.event_mode) {
        const stored = Array.isArray(d.modes)
          ? (d.modes as string[]).map((m) => back[m]).filter(Boolean)
          : typeof d.mode === 'string' && back[d.mode] ? [back[d.mode]] : [];
        if (d.allocation === 'lichen') {
          setModes(new Set(['lichen'] as OfferMode[])); setEvMode('lichen');
        } else if (stored.length) {
          setModes(new Set(stored)); setEvMode(stored[0]);
        }
      }
      if (typeof d.giftTo === 'string') setGiftTo(d.giftTo);
      if (d.modeNotes && typeof d.modeNotes === 'object') setModeNotes(d.modeNotes as Record<string, string>);
      if (Array.isArray(d.condition)) setCondition(new Set(d.condition as string[]));
      if (typeof d.availFrom === 'string') setAvailFrom(d.availFrom);
      if (typeof d.availTo === 'string') setAvailTo(d.availTo);
      if (Array.isArray(d.fulfillment)) setFulfillment(new Set(d.fulfillment as string[]));
      if (d.deliverRadiusMi != null) setDeliverRadius(String(d.deliverRadiusMi));
      if (typeof d.paymentPlan === 'string') setPaymentPlan(d.paymentPlan);
      if (Array.isArray(d.categories)) { setCatTags(d.categories as string[]); }
      if (typeof d.meetingUrl === 'string' && d.meetingUrl) { setMeetingUrl(d.meetingUrl); setOnline(true); }
      if (typeof d.online === 'boolean') setOnline(d.online);
      if (typeof d.inPerson === 'boolean') setInPerson(d.inPerson);
      if (typeof d.location === 'string' && d.location) {
        if (/^https?:\/\//i.test(d.location) && !d.meetingUrl) {
          // Legacy posts kept the video link IN the location field.
          setMeetingUrl(d.location); setOnline(true);
        } else {
          setLocation(d.location); setInPerson(true);
        }
      }
      const g = d.geo as { lat?: number; lng?: number } | undefined;
      if (g && typeof g.lat === 'number' && typeof g.lng === 'number') setLocGeo({ lat: g.lat, lng: g.lng });
      if (typeof d.bookingUrl === 'string') setBookingUrl(d.bookingUrl);
      if (typeof d.trade === 'string') setTradeFor(d.trade);
      if (typeof d.price === 'string') {
        // "Sliding scale $20–$60" round-trips back into the two fields.
        const m = d.price.match(/^Sliding scale (.*)–(.*)$/);
        if (d.sliding === true && m) {
          setSliding(true);
          setSlideLow(m[1] === '?' ? '' : m[1]);
          setSlideHigh(m[2] === '?' ? '' : m[2]);
        } else {
          setPrice(d.price);
        }
      }
      if (Array.isArray(d.media)) setMedia(d.media as Attached[]);
      setEditReady(true);
    })();
    return () => { live = false; };
  }, [editPostId, user, navigate]);

  // Every space I belong to (any role) is an audience option.
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('space_members').select('role, spaces(id, name, kind)').eq('profile_id', user.id);
      const rows = (data as unknown as { role: string; spaces: { id: string; name: string; kind: string } | null }[] | null) ?? [];
      setMySpaces(rows.map((r) => r.spaces).filter((s): s is { id: string; name: string; kind: string } => !!s));
      setMyAdminSpaces(new Set(rows.filter((r) => r.spaces && (r.role === 'admin' || r.role === 'super_admin'))
        .map((r) => r.spaces!.id)));
    })();
  }, [user]);

  // Courses/Library: 'Everyone' and space chips COEXIST — a public course can
  // still land on a space's shelf (audience ids drive the curated sections).
  const curated = areas.has('courses') || areas.has('library');
  const pickEveryone = () => {
    if (curated) { setIsPublic((v) => !v); return; }
    setIsPublic(true); setToMycelium(false); setAudienceSpaces(new Set());
  };
  const toggleMycelium = () => { setIsPublic(false); setToMycelium((v) => !v); };
  const toggleSpace = (id: string) => {
    if (!curated) setIsPublic(false);
    setAudienceSpaces((cur) => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleArea = (a: ServiceArea) => {
    // Editing an event post: it's anchored to a real calendar event, so
    // 'events' can't be unchecked (cancel the event instead).
    if (editing && a === 'events' && areas.has('events') && editLinkedEvent.current) return;
    setAreas((cur) => { const n = new Set(cur); n.has(a) ? n.delete(a) : n.add(a); return n; });
  };
  const hasMode = (m: OfferMode) => (isEvent ? evMode === m : modes.has(m));
  const toggleMode = (m: OfferMode) => {
    if (isEvent) { setEvMode(m); return; }
    setModes((cur) => {
      const n = new Set(cur);
      if (n.has(m)) {
        if (n.size > 1) {
          n.delete(m);          // an offer keeps at least one mode
          setSetTerms((c) => { const t = new Set(c); t.delete(m); return t; });
        }
      } else {
        if (m === 'lichen') return new Set(['lichen'] as OfferMode[]);
        n.delete('lichen');                    // Lichen* doesn't combine
        n.add(m);
      }
      return n;
    });
  };
  // The mockup's AI toggle (Figma 286-4961): Claude reads the words and
  // pre-checks category tags, condition, and trade tags — every suggestion
  // stays an ordinary chip the member can uncheck. Never blocks anything.
  async function suggestDetails() {
    if (aiBusy) return;
    setAiBusy(true); setAiNote('');
    try {
      let cats = allCats;
      if (cats === null) {
        const { data } = await supabase.from('categories').select('*').order('sort');
        cats = (data as Category[] | null) ?? [];
        setAllCats(cats);
      }
      const { data, error } = await supabase.functions.invoke('listing-autofill', {
        body: { title: title.trim(), text: body.trim(), categories: cats.map((c) => ({ id: c.id, name: c.name })) },
      });
      if (error) throw error;
      const d = (data ?? {}) as { categories?: string[]; condition?: string[]; tradeTags?: string[] };
      let touched = 0;
      if (d.categories?.length) {
        setCatTags((cur) => [...new Set([...cur, ...d.categories!])]);
        setTagsOpen(true); touched += d.categories.length;
      }
      if (d.condition?.length) {
        setCondition((cur) => new Set([...cur, ...d.condition!]));
        touched += d.condition.length;
      }
      if (d.tradeTags?.length && modes.has('trade') && !tradeFor.trim()) {
        setTradeFor(d.tradeTags.join(', ')); touched += d.tradeTags.length;
      }
      setAiNote(touched
        ? 'Suggested — uncheck anything that\u2019s wrong.'
        : 'Nothing to suggest from the words so far.');
    } catch {
      setAiNote('Couldn\u2019t suggest right now — fill by hand.');
    }
    setAiBusy(false);
  }

  const pickSocial = () => {
    // An event post can't demote to social — its calendar event anchors it.
    if (editing && editLinkedEvent.current) return;
    setFace('social'); setContentType('social'); setAreas(new Set()); setWhereOpen(false);
  };
  const pickActionable = () => {
    setFace('actionable'); setContentType('actionable');
    setAreas((cur) => (cur.size === 0 ? new Set(['marketplace' as ServiceArea]) : cur));
    setWhereOpen(true);
  };
  const hasAudience = isPublic || toMycelium || audienceSpaces.size > 0;

  const isMarket = areas.has('marketplace');
  const isEvent = areas.has('events');
  // Courses & Library posts are "targeted feed stories" (founder + Melanie,
  // 2026-07-26): no Type row (they're educational by nature), an Organize-into
  // picker, and — everything being an exchange — the offer block.
  const isCourse = areas.has('courses');
  const isLibrary = areas.has('library');
  // Default a fresh course/library story to Everyone + the spaces you ADMIN
  // (founder: "when Melanie posts a course it goes to her own profile, the
  // Communities and Groups she runs, and the whole network"). Chips stay
  // removable; sharing into a space you DON'T steward files a request.
  const curatedDefaultDone = useRef(false);
  useEffect(() => {
    if (!(isCourse || isLibrary) || curatedDefaultDone.current) return;
    if (editing || presetSpace) { curatedDefaultDone.current = true; return; }
    if (myAdminSpaces.size === 0) return; // admin list may still be loading
    curatedDefaultDone.current = true;
    setIsPublic(true);
    setAudienceSpaces((cur) => new Set([...cur, ...myAdminSpaces]));
  }, [isCourse, isLibrary, editing, presetSpace, myAdminSpaces]);
  useEffect(() => {
    if (!isCourse && !isLibrary) { setOrganizeInto(null); return; }
    let live = true;
    void listMyCollections().then((cols) => {
      if (live) setMyCols(cols.filter((c) => c.kind === (isCourse ? 'course' : 'path')));
    });
    return () => { live = false; };
  }, [isCourse, isLibrary]);
  // Events narrow the mode set — clamp lend/rent if events joins the areas.
  useEffect(() => {
    if (isEvent && (evMode === 'lend' || evMode === 'rent')) setEvMode('paid');
  }, [isEvent, evMode]);

  async function addMedia(file: Blob, ext: string, type: MediaType) {
    setUploading(true); setError('');
    try {
      if (type === 'video') {
        // Lichen-hosted video: original to the videos bucket + a transcode
        // job for the self-run worker (adaptive HLS lands when it's done).
        const { url, jobId } = await uploadVideo(file, ext);
        setMedia((m) => [...m, { type, url, jobId }]);
      } else {
        const url = await uploadMedia(file, ext);
        setMedia((m) => [...m, { type, url }]);
      }
    } catch (e) {
      setError((e as Error)?.message || 'Upload failed — please try again.');
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

  const canPost = !!(body.trim() || title.trim() || media.length > 0);

  async function submit() {
    if (!canPost) { setError('Add a few words, a title, or attach something first.'); return; }
    if (!hasAudience) { setError('Pick at least one audience.'); return; }
    if (isEvent && !evRange.start) { setError('Pick a date for your event.'); return; }
    setBusy(true); setError('');
    try {
      // "Everything is an exchange": a course offered for pay/trade/Lichen*
      // belongs in the Marketplace too (founder + Melanie, 2026-07-26).
      // The checkboxes are the truth: Marketplace arrives pre-checked with
      // every offer, but deselecting it is a real choice (quieter shelves
      // only) — no silent re-add here.
      const effAreas = new Set(areas);
      const details: Record<string, unknown> = {};
      if (!aiReadable) details.aiExcluded = true;
      if (!downloadable) details.noDownload = true;
      // Events' calendar rows show ONE location line — the address when in
      // person, else the meeting link (SmartLocation renders links as Join).
      const effLocation = inPerson && location.trim() ? location.trim()
        : online && meetingUrl.trim() ? meetingUrl.trim() : location.trim();
      if (face === 'actionable') {
        if (hasMode('paid')) {
          if (sliding && (slideLow.trim() || slideHigh.trim())) {
            details.price = `Sliding scale ${slideLow.trim() || '?'}–${slideHigh.trim() || '?'}`;
            details.sliding = true;
          } else if (price.trim()) {
            details.price = price.trim();
          }
          if (isEvent && bookingUrl.trim()) details.bookingUrl = bookingUrl.trim();
        }
        if (hasMode('trade') && tradeFor.trim()) details.trade = tradeFor.trim();
        if (online) details.online = true;
        if (inPerson) details.inPerson = true;
        if (online && meetingUrl.trim()) details.meetingUrl = meetingUrl.trim();
        if (inPerson && location.trim()) {
          details.location = location.trim();
          if (locGeo) details.geo = locGeo;
        } else if (online && meetingUrl.trim()) {
          // Older surfaces render location — an online-only offer shows its
          // Join link there (SmartLocation already turns it into a button).
          details.location = meetingUrl.trim();
        }
        if (!isEvent) {
          const notes = Object.fromEntries(
            (['lend', 'rent', 'borrow', 'iso'] as OfferMode[])
              .filter((m) => modes.has(m) && modeNotes[m]?.trim())
              .map((m) => [m, modeNotes[m].trim()]));
          if (Object.keys(notes).length) details.modeNotes = notes;
          // Older surfaces show ONE terms line via details.price — keep it
          // when Paid didn't already claim it.
          if (!hasMode('paid') && !details.price) {
            const firstNote = Object.values(notes)[0];
            if (firstNote) details.price = firstNote;
          }
          // Marketplace vocabulary, PLURAL: details.modes = every selected
          // mode; details.mode = the primary (gift-first — the Lichen economy
          // answers first) so older surfaces and the matcher keep working.
          const canon = (m: OfferMode) => m === 'free' || m === 'lichen' ? 'gift'
            : m === 'paid' ? (sliding ? 'sliding' : 'sale') : m;
          const order: OfferMode[] = ['lichen', 'free', 'trade', 'lend', 'rent', 'borrow', 'iso', 'paid'];
          const chosen = order.filter((m) => modes.has(m));
          details.modes = [...new Set(chosen.map(canon))];
          details.mode = canon(chosen[0]);
          if ((modes.has('free') || modes.has('lichen')) && giftTo.trim()) details.giftTo = giftTo.trim();
          if (condition.size) details.condition = [...condition];
          if (availFrom) details.availFrom = availFrom;
          if (availTo) details.availTo = availTo;
          if (fulfillment.size) details.fulfillment = [...fulfillment];
          if (fulfillment.has('deliver') && deliverRadius.trim()) {
            const mi = Number(deliverRadius);
            if (Number.isFinite(mi) && mi > 0) details.deliverRadiusMi = mi;
          }
          if (modes.has('paid') && paymentPlan.trim()) details.paymentPlan = paymentPlan.trim();
          if (catTags.length) details.categories = catTags;
          if (modes.has('trade') && tradeFor.trim()) {
            const tags = tradeFor.split(',').map((t) => t.trim()).filter(Boolean);
            if (tags.length > 1) details.tradeTags = tags;
          }
          if (modes.has('lichen')) details.allocation = 'lichen';
          if (modes.has('lichen') && inkind) details.inkind = true;
        }
      }
      if (media.length) details.media = media;
      // Rich previews for any pasted links, resolved once at compose time
      // (YouTube parsed locally; other links via the link-preview function).
      const previews = await resolvePreviews(parseBodyUrls(body));
      if (previews.length) details.previews = previews;
      const firstPhoto = media.find((m) => m.type === 'photo')?.url ?? null;

      if (editing && editPostId) {
        // Edit in place. The event's own fields update via updateEventDetails
        // (NOT updateEvent — its invitee sync would wipe the guest list).
        let linkedEventId = editLinkedEvent.current;
        if (isEvent && evRange.start) {
          const evFields = {
            title: title.trim() || body.trim().slice(0, 60) || 'Event',
            description: body.trim(),
            location: effLocation,
            lat: locGeo?.lat ?? null,
            lng: locGeo?.lng ?? null,
            startDate: evRange.start,
            endDate: evRange.end ?? evRange.start,
            allDay: evAllDay,
            startMin: evStartMin, endMin: evEndMin,
          };
          if (linkedEventId) {
            await updateEventDetails(linkedEventId, evFields);
          } else {
            linkedEventId = await createEvent(user!.id, {
              ownerProfileId: actor.type === 'space' ? undefined : user!.id,
              ownerSpaceId: actor.type === 'space' ? actor.id : undefined,
              ...evFields, recurrence: null, inviteeIds: [],
            });
          }
        }
        await updatePost(editPostId, {
          body, title, content_type: face === 'actionable' ? 'actionable' : contentType,
          isPublic, toMycelium, audienceSpaceIds: [...audienceSpaces],
          serviceAreas: [...effAreas],
          authorSpaceId: actor.type === 'space' ? actor.id : null,
          eventCategory: isEvent ? evCategory : null,
          eventMode: isEvent ? (evMode as EventMode) : null,
          linkedEventId,
          image_url: firstPhoto, details,
        });
        navigate(isEvent ? `/events/${editPostId}` : '/home');
        return;
      }

      // Events first create their calendar event (the RSVP container); if the
      // post insert then fails, the orphan event is cleaned up below.
      let linkedEventId: string | null = null;
      if (isEvent && evRange.start) {
        linkedEventId = await createEvent(user!.id, {
          ownerProfileId: actor.type === 'space' ? undefined : user!.id,
          ownerSpaceId: actor.type === 'space' ? actor.id : undefined,
          title: title.trim() || body.trim().slice(0, 60) || 'Event',
          description: body.trim(),
          location: effLocation,
          lat: locGeo?.lat ?? null,
          lng: locGeo?.lng ?? null,
          startDate: evRange.start,
          endDate: evRange.end ?? evRange.start,
          allDay: evAllDay,
          startMin: evStartMin, endMin: evEndMin,
          recurrence: null,
          inviteeIds: [],
        });
      }
      try {
        const created = await createPost({
          body, title, content_type: face === 'actionable' ? 'actionable' : contentType,
          isPublic, toMycelium, audienceSpaceIds: [...audienceSpaces],
          serviceAreas: [...effAreas],
          authorSpaceId: actor.type === 'space' ? actor.id : null,
          eventCategory: isEvent ? evCategory : null,
          eventMode: isEvent ? (evMode as EventMode) : null,
          linkedEventId,
          image_url: firstPhoto, details,
        });
        // In-kind donation offer: record it for the routing desk + the
        // donor's private My-giving dashboard. Fire-and-forget — the post
        // never fails over the record; pre-migration this quietly no-ops.
        if (isMarket && evMode === 'lichen' && inkind && created?.id && user) {
          void supabase.from('inkind_donations').insert({
            donor_profile_id: user.id,
            post_id: created.id,
            description: title.trim() || body.trim().slice(0, 140) || 'Donated item',
          }).then(() => {}, () => {});
        }
        // Visual style, stage 1: marketplace listings with a photo get style
        // tags (Claude vision, controlled vocabulary) written back into
        // details — fire-and-forget, a post never waits on or fails over this.
        if (isMarket && firstPhoto && created?.id) {
          const postId = created.id;
          void supabase.functions.invoke('style-tags', { body: { image: firstPhoto } })
            .then(({ data }) => {
              const tags = (data as { tags?: string[] } | null)?.tags;
              if (!tags?.length) return;
              return supabase.from('posts')
                .update({ details: { ...details, styleTags: tags } })
                .eq('id', postId);
            })
            .then(() => {}, () => {});
        }
        // Organize-into: file the fresh post as a piece of the chosen (or
        // brand-new) course/collection. Post never fails over this.
        // Posted from your shelf (?save=1): it lands there too, without
        // changing where else you sent it (founder 2026-07-28).
        if (created?.id && params.get('save') === '1') {
          await setSaved('post', created.id, true).catch(console.error);
        }
        if (created?.id && (isCourse || isLibrary) && (organizeInto || newColName.trim())) {
          try {
            const target = organizeInto
              ?? await createCollection(newColName.trim(), isCourse ? 'course' : 'path');
            await addToCollection(target, created.id);
          } catch (e) { console.error('organize-into:', e); }
        }
      } catch (postErr) {
        if (linkedEventId) await deleteEvent(linkedEventId).catch(() => {});
        throw postErr;
      }
      navigate(afterPostDestination(isEvent));
    } catch (e) {
      setBusy(false);
      setError((e as Error)?.message || 'Couldn’t post. Please try again.');
    }
  }

  if (loading || !editReady) return <div className="cmp"><p className="cmp__muted">Loading…</p></div>;

  return (
    <div className="cmp">
      {/* Way back without posting — real history when we came from inside
          the app, else the section this composer would land in anyway. */}
      <button
        className="cmp__back"
        onClick={() => {
          if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
          else navigate(afterPostDestination(isEvent));
        }}
      >
        <Icon name="arrow-left" size={14} /> Back
      </button>
      <header className="cmp__head">
        <h1 className="cmp__title">{editing ? (isEvent ? 'Edit event' : 'Edit post') : 'New post'}</h1>
        <p className="cmp__sub">
          {editing
            ? 'Changes save in place — guests keep their RSVPs.'
            : 'Share with the whole network, or just your My-celium.'}
        </p>
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
        <button className={'cmp__chip' + (toMycelium ? ' is-on' : '')} onClick={toggleMycelium}>My-celium</button>
        {mySpaces.length <= 6 && mySpaces.map((sp) => (
          <button key={sp.id} className={'cmp__chip' + (audienceSpaces.has(sp.id) ? ' is-on' : '')}
            onClick={() => toggleSpace(sp.id)}>{sp.name}</button>
        ))}
      </div>
      {mySpaces.length > 6 && (
        <div className="cmp__aud-groups">
          {([['community', 'Communities'], ['group', 'Groups'], ['organization', 'Organizations'], ['place', 'Places']] as const)
            .map(([kind, label]) => {
              const of = mySpaces.filter((sp) => sp.kind === kind);
              if (!of.length) return null;
              return (
                <div className="cmp__aud-group" key={kind}>
                  <span className="cmp__aud-kind">{label}</span>
                  {of.map((sp) => (
                    <label className="cmp__aud-row" key={sp.id}>
                      <input type="checkbox" checked={audienceSpaces.has(sp.id)}
                        onChange={() => toggleSpace(sp.id)} />
                      <span>{sp.name}</span>
                    </label>
                  ))}
                </div>
              );
            })}
        </div>
      )}

      {/* The choice point: a post is Social (a feed story) or Actionable
          (an exchange — it enters the Lichen Economy and rides the
          Marketplace). Where-to-post lives beneath the actionable door. */}
      <label className="cmp__label">What is this?</label>
      <div className="cmp__faces">
        <button
          className={'cmp__face' + (face === 'social' ? ' is-on' : '')}
          onClick={pickSocial}
          disabled={editing && !!editLinkedEvent.current}
          title={editing && editLinkedEvent.current ? 'An event post stays actionable — cancel the event to retire it' : undefined}
        >
          <strong>Social</strong>
          <em>Flows through a Space feed</em>
        </button>
        <button
          className={'cmp__face' + (face === 'actionable' ? ' is-on' : '')}
          onClick={pickActionable}
        >
          <strong>Actionable</strong>
          <em>Flows through the Lichen Economy</em>
        </button>
      </div>

      {face === 'actionable' && (<>
      <label className="cmp__label">Where</label>
      <button className="cmp__input cmp__where-btn" onClick={() => setWhereOpen((o) => !o)} aria-expanded={whereOpen}>
        {areas.size === 0 ? <span className="cmp__where-none">Nowhere yet — it would only flow through feeds</span> : (
          <span className="cmp__where-sel">
            {SERVICE_AREAS.filter((a) => areas.has(a.value)).map((a) => (
              <span key={a.value} className="cmp__where-tag"><Icon name={a.icon} size={12} /> {a.label}</span>
            ))}
          </span>
        )}
        <span className={'cmp__where-caret' + (whereOpen ? ' is-open' : '')}><Icon name="chevron-right" size={14} /></span>
      </button>
      {(() => {
        const others = SERVICE_AREAS.filter((a) => a.value !== 'marketplace' && areas.has(a.value)).map((a) => a.label);
        const inMkt = areas.has('marketplace');
        const hint = inMkt && others.length
          ? `In the open Marketplace, plus ${others.join(' and ')}.`
          : inMkt
          ? 'The Marketplace is the Commons\u2019 open square \u2014 check Courses, Library, or others to shelve this there too.'
          : others.length
          ? `Skipping the open Marketplace \u2014 this lives only in ${others.join(' and ')}.`
          : 'Not placed anywhere \u2014 consider the Marketplace, or a quieter shelf.';
        return <p className="cmp__hint cmp__where-hint">{hint}</p>;
      })()}
      {whereOpen && (
        <div className="cmp__where-list">
          {SERVICE_AREAS.map((a) => (
            <label key={a.value} className="cmp__where-row">
              <input
                type="checkbox"
                checked={areas.has(a.value)}
                onChange={() => toggleArea(a.value)}
                disabled={editing && a.value === 'events' && areas.has('events') && !!editLinkedEvent.current}
              />
              <Icon name={a.icon} size={14} /> {a.label}
            </label>
          ))}
        </div>
      )}
      </>)}

      {(isCourse || isLibrary) && (
        <>
          <label className="cmp__label">Organize into (optional)</label>
          <div className="cmp__chips">
            {myCols.map((c) => (
              <button
                key={c.id}
                className={'cmp__chip' + (organizeInto === c.id ? ' is-on' : '')}
                onClick={() => { setOrganizeInto((cur) => (cur === c.id ? null : c.id)); setNewColName(''); }}
              >
                {c.name}
              </button>
            ))}
          </div>
          <input
            className="cmp__input"
            value={newColName}
            onChange={(e) => { setNewColName(e.target.value); if (e.target.value.trim()) setOrganizeInto(null); }}
            placeholder={isCourse ? 'Or start a new course…' : 'Or start a new collection…'}
          />
          <p className="cmp__hint-ev">
            This post becomes a piece of that {isCourse ? 'course — you\u2019ll arrange lessons on its page' : 'collection — you\u2019ll arrange the order on its page'}.
          </p>
        </>
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
        <button
          className="cmp__media-btn"
          disabled={uploading}
          onClick={() => {
            if (vidPickOpen) { setVidPickOpen(false); return; }
            if (readyVids === null) {
              void listMyReadyVideos().then((v) => {
                setReadyVids(v);
                if (v.length) setVidPickOpen(true); else videoRef.current?.click();
              });
            } else if (readyVids.length) {
              setVidPickOpen(true);
            } else {
              videoRef.current?.click();
            }
          }}
        >
          <Icon name="video" size={20} /><span>Video</span>
        </button>
        <button className={'cmp__media-btn' + (recording ? ' is-recording' : '')} onClick={toggleRecord} disabled={uploading && !recording}>
          <Icon name="mic" size={20} /><span>{recording ? 'Stop' : 'Audio'}</span>
        </button>
      </div>
      {vidPickOpen && (
        <div className="cmp__vidpick">
          <button
            className="cmp__vidpick-upload"
            onClick={() => { setVidPickOpen(false); videoRef.current?.click(); }}
          >
            <Icon name="video" size={16} /> Upload from this device
          </button>
          <p className="cmp__vidpick-hint">Or attach a video Lichen already compressed:</p>
          <div className="cmp__vidpick-grid">
            {(readyVids ?? []).map((v) => (
              <button
                key={v.id}
                className="cmp__vidpick-item"
                onClick={() => {
                  setMedia((m) => [...m, { type: 'video', url: videoPublicUrl(v.hls_path), jobId: v.id }]);
                  setVidPickOpen(false);
                }}
              >
                {v.poster_path
                  ? <img src={videoPublicUrl(v.poster_path)} alt="" />
                  : <span className="cmp__vidpick-blank" />}
                <em>
                  {v.duration_secs
                    ? `${Math.floor(v.duration_secs / 60)}:${String(v.duration_secs % 60).padStart(2, '0')}`
                    : 'video'}
                </em>
              </button>
            ))}
          </div>
        </div>
      )}

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

      {face === 'actionable' && (
        <div className="cmp__market">
          <p className="cmp__market-head">{isEvent ? 'Event details' : 'Modes of exchange'}</p>
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
          <label className="cmp__label">{isEvent ? 'Free, trade, or paid?' : isCourse ? 'Lichen, gift, trade, paid — every mode that applies' : 'Lichen, gift, trade, lend, rent, borrow, paid, ISO — every mode that applies'}</label>
          <div className="cmp__chips">
            {!isEvent && (
              <button
                className={'cmp__chip' + (hasMode('lichen') ? ' is-on' : '')}
                onClick={() => toggleMode('lichen')}
                title="An entrusted gift — the Lichen Economy Algorithm decides where it goes (doesn't combine with other modes)"
              >
                Lichen*
              </button>
            )}
            <button className={'cmp__chip' + (hasMode('free') ? ' is-on' : '')} onClick={() => toggleMode('free')}>{isEvent ? 'Free' : 'Gift'}</button>
            <button className={'cmp__chip' + (hasMode('trade') ? ' is-on' : '')} onClick={() => toggleMode('trade')}>Trade</button>
            {!isEvent && !isCourse && (
              <>
                <button className={'cmp__chip' + (hasMode('lend') ? ' is-on' : '')} onClick={() => toggleMode('lend')}>Lend</button>
                <button className={'cmp__chip' + (hasMode('rent') ? ' is-on' : '')} onClick={() => toggleMode('rent')}>Rent</button>
                <button className={'cmp__chip' + (hasMode('borrow') ? ' is-on' : '')} onClick={() => toggleMode('borrow')}>Borrow</button>
                <button className={'cmp__chip' + (hasMode('iso') ? ' is-on' : '')} onClick={() => toggleMode('iso')} title="In search of — you're looking to buy or find this">ISO</button>
              </>
            )}
            <button className={'cmp__chip' + (hasMode('paid') ? ' is-on' : '')} onClick={() => toggleMode('paid')}>Paid</button>
          </div>
          {!isEvent && modes.size > 1 && (
            <p className="cmp__hint-ev">One offer, several doors — a gift for some can be paid or traded for others.</p>
          )}
          {!isEvent && (() => {
            const TERM_LABEL: Partial<Record<OfferMode, string>> = {
              lichen: 'Lichen*', free: 'Gift', trade: 'Trade', lend: 'Lend',
              rent: 'Rent', borrow: 'Borrow', iso: 'ISO', paid: 'Paid',
            };
            const order: OfferMode[] = ['lichen', 'free', 'trade', 'lend', 'rent', 'borrow', 'iso', 'paid'];
            const sentence = (m: OfferMode): string => {
              if (m === 'lichen') return 'routing entrusted to the Lichen Economy Algorithm';
              if (m === 'free') return giftTo.trim() ? `to ${giftTo.trim()}` : 'freely, to anyone';
              if (m === 'trade') return tradeFor.trim() ? `for ${tradeFor.trim()}` : 'open to offers';
              if (m === 'paid') {
                if (sliding) return `sliding scale ${slideLow.trim() || '?'}–${slideHigh.trim() || '?'}`;
                return price.trim() || 'price to discuss';
              }
              return modeNotes[m]?.trim()
                || (m === 'rent' ? 'rate to discuss' : m === 'borrow' ? 'timing to arrange'
                  : m === 'iso' ? 'open budget' : 'terms to arrange');
            };
            const PLACEHOLDER: Partial<Record<OfferMode, string>> = {
              free: 'to whom? — a person, a group, or an identity: Veterans, First Responders',
              trade: 'for what? — e.g. eggs, firewood, bodywork',
              lend: 'terms — e.g. return within a week',
              rent: 'rate — e.g. $20/day',
              borrow: 'for how long? — e.g. just the weekend',
              iso: 'budget — e.g. up to $200',
            };
            const commit = (m: OfferMode) => setSetTerms((c) => new Set(c).add(m));
            const uncommit = (m: OfferMode) => setSetTerms((c) => { const t = new Set(c); t.delete(m); return t; });
            const onKey = (m: OfferMode) => (e: React.KeyboardEvent) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(m); }
            };
            return (
              <div className="cmp__terms">
                {order.filter((m) => modes.has(m)).map((m) => (
                  <div className={'cmp__term' + (setTerms.has(m) || m === 'lichen' ? ' is-set' : '')} key={m}>
                    <span className="cmp__term-mode">{TERM_LABEL[m]}</span>
                    {setTerms.has(m) || m === 'lichen' ? (
                      <button className="cmp__term-frozen" onClick={() => m !== 'lichen' && uncommit(m)}
                        title={m === 'lichen' ? undefined : 'Tap to edit this term'}>
                        {sentence(m)}
                        {m !== 'lichen' && <span className="cmp__term-editmark">✎</span>}
                      </button>
                    ) : (
                      <>
                        {m === 'free' && (
                          <input className="cmp__term-input" value={giftTo} onKeyDown={onKey(m)}
                            onChange={(e) => setGiftTo(e.target.value)} placeholder={PLACEHOLDER[m]} />
                        )}
                        {m === 'trade' && (
                          <input className="cmp__term-input" value={tradeFor} onKeyDown={onKey(m)}
                            onChange={(e) => setTradeFor(e.target.value)} placeholder={PLACEHOLDER[m]} />
                        )}
                        {(m === 'lend' || m === 'rent' || m === 'borrow' || m === 'iso') && (
                          <input className="cmp__term-input" value={modeNotes[m] ?? ''} onKeyDown={onKey(m)}
                            onChange={(e) => setModeNotes((c) => ({ ...c, [m]: e.target.value }))}
                            placeholder={PLACEHOLDER[m]} />
                        )}
                        {m === 'paid' && (
                          <span className="cmp__term-paid">
                            {!sliding ? (
                              <input className="cmp__term-input" value={price} onKeyDown={onKey(m)}
                                onChange={(e) => setPrice(e.target.value)} placeholder="price — e.g. $45" />
                            ) : (
                              <>
                                <input className="cmp__term-input" value={slideLow} onKeyDown={onKey(m)}
                                  onChange={(e) => setSlideLow(e.target.value)} placeholder="from $" />
                                <input className="cmp__term-input" value={slideHigh} onKeyDown={onKey(m)}
                                  onChange={(e) => setSlideHigh(e.target.value)} placeholder="to $" />
                              </>
                            )}
                            <label className="cmp__term-slide">
                              <input type="checkbox" checked={sliding} onChange={(e) => setSliding(e.target.checked)} /> sliding
                            </label>
                          </span>
                        )}
                        <button className="cmp__term-btn" onClick={() => commit(m)}
                          title="Set this term — it follows the post wherever it goes">
                          Set ⏎
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {modes.has('lichen') && (
                  <>
                    <p className="cmp__hint-ev cmp__lichen-hint">
                      * The Lichen Economy Algorithm assesses how to optimize your
                      contribution — allocated where it closes the most need.{' '}
                      <a href="/donate/how#economy" target="_blank" rel="noopener">Learn more</a>
                    </p>
                    <label className="cmp__sliding" title="Ownership passes to Lichen Health, a 501(c)(3) — once a steward accepts, your donation acknowledgment is emailed for your tax records">
                      <input type="checkbox" checked={inkind} onChange={(e) => setInkind(e.target.checked)} />
                      {' '}Donate it to Lichen — tax-deductible; a donation receipt follows when accepted
                    </label>
                  </>
                )}
              </div>
            );
          })()}

          {/* Events keep the simple single-mode fields. */}
          {isEvent && evMode === 'paid' && (
            <label className="cmp__sliding">
              <input type="checkbox" checked={sliding} onChange={(e) => setSliding(e.target.checked)} /> Sliding scale
            </label>
          )}
          {isEvent && evMode === 'paid' && !sliding && (
            <div className="cmp__row">
              <input className="cmp__input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (e.g. $45)" />
              <input className="cmp__input" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="Booking link (https://…)" />
            </div>
          )}
          {isEvent && evMode === 'paid' && sliding && (
            <>
              <div className="cmp__row">
                <input className="cmp__input" value={slideLow} onChange={(e) => setSlideLow(e.target.value)} placeholder="From (e.g. $20)" />
                <input className="cmp__input" value={slideHigh} onChange={(e) => setSlideHigh(e.target.value)} placeholder="To (e.g. $60)" />
              </div>
              <input className="cmp__input" value={bookingUrl} onChange={(e) => setBookingUrl(e.target.value)} placeholder="Booking link (https://…)" />
            </>
          )}
          {isEvent && evMode === 'trade' && (
            <input className="cmp__input" value={tradeFor} onChange={(e) => setTradeFor(e.target.value)} placeholder="Open to trades for… (optional)" />
          )}

          {areas.has('travel') && (
            <p className="cmp__hint-ev">
              Travel: a <strong>stay</strong> reads best with dates and what&rsquo;s included;
              a <strong>ride</strong> with where you&rsquo;re leaving from, where you&rsquo;re headed,
              and seats. Looking rather than offering? Add the <strong>ISO</strong> mode — the
              matcher rings people going your way.
            </p>
          )}

          {/* Listing details (Figma 286-4961) — the physical facts. Shown for
              Marketplace listings; courses/library/events don't have a
              condition or a shipping option. */}
          {isMarket && !isEvent && (<>
            <div className="cmp__ai-row">
              <button
                className="cmp__ai-btn"
                onClick={() => void suggestDetails()}
                disabled={aiBusy || (!title.trim() && !body.trim())}
                title="Claude reads your words and pre-checks the details — you stay the editor"
              >
                ✨ {aiBusy ? 'Reading your listing…' : 'Suggest details from my words'}
              </button>
              {aiNote && <span className="cmp__ai-note">{aiNote}</span>}
            </div>
            <label className="cmp__label">Condition <span className="cmp__label-soft">(for things — pick what applies, or what you'd accept)</span></label>
            <div className="cmp__chips">
              {([['new', 'New'], ['like_new', 'Used — like new'], ['good', 'Used — good'], ['fair', 'Used — fair']] as const).map(([v, l]) => (
                <button key={v} className={'cmp__chip' + (condition.has(v) ? ' is-on' : '')}
                  onClick={() => setCondition((cur) => { const n = new Set(cur); n.has(v) ? n.delete(v) : n.add(v); return n; })}>{l}</button>
              ))}
            </div>
            {modes.has('paid') && (
              <input className="cmp__input" value={paymentPlan} onChange={(e) => setPaymentPlan(e.target.value)}
                placeholder="Payment plan (optional — e.g. 6 monthly payments)" />
            )}
            <label className="cmp__label">When <span className="cmp__label-soft">(optional — available between, or needed by)</span></label>
            <div className="cmp__row cmp__avail-row">
              <input className="cmp__input" type="date" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} aria-label="Available from" />
              <span className="cmp__to">to</span>
              <input className="cmp__input" type="date" value={availTo} onChange={(e) => setAvailTo(e.target.value)} aria-label="Available until" />
            </div>
            <label className="cmp__label">How it changes hands</label>
            <div className="cmp__attend cmp__fulfill">
              {([['pickup', 'Pickup'], ['deliver', 'Deliver'], ['ship', 'Ship'], ['in_store', 'In store']] as const).map(([v, l]) => (
                <label className="cmp__sliding" key={v}>
                  <input type="checkbox" checked={fulfillment.has(v)}
                    onChange={() => setFulfillment((cur) => { const n = new Set(cur); n.has(v) ? n.delete(v) : n.add(v); return n; })} />
                  {' '}{l}
                </label>
              ))}
            </div>
            {(fulfillment.has('pickup') || fulfillment.has('in_store')) && (
              <p className="cmp__hint-ev">
                Meeting someone new? A <a href="/places" target="_blank" rel="noopener">Lichen place</a> —
                a known community spot — makes good ground for the handoff.
              </p>
            )}
            {fulfillment.has('deliver') && (
              <div className="cmp__row cmp__radius-row">
                <span className="cmp__label-soft">within</span>
                <input className="cmp__input cmp__radius-input" type="number" min={1} value={deliverRadius}
                  onChange={(e) => setDeliverRadius(e.target.value)} placeholder="20" />
                <span className="cmp__label-soft">miles</span>
              </div>
            )}
            <button className="cmp__tags-toggle" onClick={() => setTagsOpen((o) => !o)} aria-expanded={tagsOpen}>
              Category tags {catTags.length > 0 && `· ${catTags.length}`}{' '}
              <span className="cmp__label-soft">— help search find this</span>
              <Icon name="chevron-right" size={12} />
            </button>
            {tagsOpen && (allCats === null ? (
              <p className="cmp__hint-ev">Loading categories…</p>
            ) : (
              <div className="cmp__tags-pickers">
                <CategoryPicker domain="good" categories={allCats} selected={catTags}
                  onChange={setCatTags} />
                <CategoryPicker domain="service" categories={allCats} selected={catTags}
                  onChange={setCatTags} />
                <CategoryPicker domain="place" categories={allCats} selected={catTags}
                  onChange={setCatTags} />
              </div>
            ))}
          </>)}

          <label className="cmp__label">Where it happens</label>
          <div className="cmp__attend">
            <label className="cmp__sliding">
              <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
              {' '}Online <em className="cmp__attend-hint">Zoom, Meet, a call</em>
            </label>
            <label className="cmp__sliding">
              <input type="checkbox" checked={inPerson} onChange={(e) => setInPerson(e.target.checked)} />
              {' '}In person
            </label>
          </div>
          {online && (
            <input
              className="cmp__input"
              value={meetingUrl}
              onChange={(e) => setMeetingUrl(e.target.value)}
              placeholder="Meeting link (https://zoom.us/… — optional, can come later)"
            />
          )}
          {inPerson && (
            <LocationField
              className="cmp__input"
              value={location}
              geo={locGeo}
              onChange={(text, g) => { setLocation(text); setLocGeo(g); }}
            />
          )}

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

      {/* Content controls — on by default (the uniform rule); profile
          defaults pre-select them, this post can flip either. */}
      <div className="cmp__content-controls">
        <label className="cmp__cc">
          <input type="checkbox" checked={aiReadable} onChange={(e) => setAiReadable(e.target.checked)} />
          <span><strong>AI-readable</strong> — assistants may read and surface this post</span>
        </label>
        <label className="cmp__cc">
          <input type="checkbox" checked={downloadable} onChange={(e) => setDownloadable(e.target.checked)} />
          <span><strong>Downloadable</strong> — people can save this post&rsquo;s media</span>
        </label>
      </div>

      {/* Rejections must be visible WHERE you clicked — a silent disabled
          button reads as a freeze (this hid 'add a few words' from an
          audio-only post until it was fixed). */}
      {error && <p className="cmp__error">{error}</p>}
      {uploading && <p className="cmp__error">Uploading media… one moment.</p>}
      <button className="btn btn-primary cmp__post" onClick={submit} disabled={busy || uploading || !canPost}>
        {busy ? (editing ? 'Saving…' : 'Posting…') : (editing ? 'Save changes' : 'Post')}
      </button>
    </div>
  );
}
