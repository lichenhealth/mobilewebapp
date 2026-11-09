import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { supabase } from '../lib/supabase';
import { loadSpaceMembers } from '../lib/spacesApi';
import { InviteCard } from '../components/InviteCard';
import { InviteStudio, InvitePreview } from '../components/InviteStudio';
import { readInvite, invitePhotos, type InviteDesign } from '../lib/inviteDesign';
import { postAssistantHandoff, renameConvo } from '../lib/assistantFeedApi';
import AssistantDoor, { aiDoorOn } from '../components/AssistantDoor';
import { colorFor, monogramFor } from '../lib/chatApi';
import { Icon } from '../components/Icon';
import {
  createPost, updatePost, loadPost, postAreas, uploadMedia,
} from '../lib/postsApi';
import { uploadVideo, listMyReadyVideos, videoPublicUrl, type ReadyVideo } from '../lib/videoApi';
import { setSaved } from '../lib/savedApi';
import { savePostDraft, deletePostDraft, loadPostDraft, listMyPostDrafts } from '../lib/postDraftsApi';
import { listMyCollections, createCollection, addToCollection, loadCollection, type CollectionRow } from '../lib/collectionsApi';
import {
  SERVICE_AREAS, EVENT_CATEGORIES, EVENT_MODES,
  type ContentType, type ServiceArea, type EventCategory, type EventMode,
} from '../lib/postsApi';
import { createEvent, deleteEvent, updateEventDetails, myTimezone, syncDraftHold } from '../lib/calendarApi';
import TimeZonePick from '../components/TimeZonePick';
import { allTimeZones, viewerZone, zoomMintAllowed } from '../lib/bookingApi';
import { slugify } from '../lib/bookingApi';
import { classifyCareContact } from '../lib/careTeamApi';
import { inviteEventGuest, inviteEventGuestByPhone, mintEventLink } from '../lib/eventGuestsApi';
import LocationField from '../components/LocationField';
import type { GeoPoint } from '../lib/geoApi';
import { resolvePreviews } from '../lib/conciergeApi';
import { parseBodyUrls, hrefFor } from '../lib/linkify';
import DateRangeCalendar, { type DateRange } from '../components/DateRangeCalendar';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import TimeField from '../components/TimeField';
import { todayISO } from '../lib/conciergeApi';
import { useTopBackFor } from '../lib/topBack';
import './Compose.css';


type MediaType = 'photo' | 'video' | 'audio';
type Attached = { type: MediaType; url: string; jobId?: string };

// EVENT INVITEES picked in the composer (founder 2026-11-04: "You should be
// able to add people by email, phone or on the platform, it should smart
// fill in the audience"). Members ride createEvent's inviteeIds (seated +
// belled, the standing machinery); email/phone become event_guests invites
// on publish (the recruiting-door machinery).
type EvInvitee =
  | { kind: 'member'; id: string; name: string }
  | { kind: 'email'; value: string; name: string }
  | { kind: 'phone'; value: string; sms: string; name: string };

/** classifyCareContact reads a BARE phone, but the natural invite line is
 *  "Testy Phone 303-555-0123" — a name classifies the whole line as a name.
 *  So: the classifier first, then a phone-shaped TAIL pulled off the line
 *  (7–16 digits), the email-token-inside-any-line rule applied to phones. */
function classifyInviteLine(raw: string):
  | { kind: 'email'; email: string }
  | { kind: 'phone'; digits: string; sms: string }
  | { kind: 'other' } {
  const c = classifyCareContact(raw);
  if (c.kind === 'email' || c.kind === 'phone') return c;
  const m = /(\+?[\d(][\d\s().‐-―-]{5,})\s*$/.exec(raw);
  if (m) {
    const digits = m[1].replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 16) {
      return { kind: 'phone', digits, sms: m[1].replace(/[^\d+]/g, '') };
    }
  }
  return { kind: 'other' };
}

/** The name LEFT OVER when a contact token is pulled out of a typed line —
 *  "Rick Countryman rick@barn.com" invites Rick by name. */
function contactLineName(raw: string): string {
  return raw
    .replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/[\d()+.\-]+/g, ' ')
    .replace(/[<>,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ?area= may carry SEVERAL areas now, comma-separated (founder 2026-10-15:
// Home/My-celium's + follows the lit feed lenses — "all others should be
// actionable and have where you came from pre-loaded"). Validated here so a
// hand-typed URL can never tick an area that doesn't exist.
const COMPOSE_AREAS: ServiceArea[] = [
  'marketplace', 'courses', 'library', 'events', 'work', 'places', 'art', 'food', 'travel',
];
function areasFromParam(raw: string | null): ServiceArea[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ServiceArea => (COMPOSE_AREAS as string[]).includes(s));
}

/** The invitation's date line — a mirror of send-event-invite's whenLabel,
 *  so the composer's preview reads exactly like the mailed card. */
const INV_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function inviteWhen(startDate: string, allDay: boolean, startMin: number | null): string {
  const [y, m, d] = (startDate || '').split('-').map(Number);
  if (!y || !m || !d) return 'Pick a date';
  const date = `${INV_MONTHS[m - 1]} ${d}, ${y}`;
  if (allDay || startMin == null) return date;
  const h = Math.floor(startMin / 60), mm = startMin % 60;
  const ap = h < 12 ? 'am' : 'pm'; const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${date} · ${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}`;
}

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
  // THE SOCIAL/ACTIONABLE FORK IS RETIRED (founder 2026-11-04: "let's
  // definitely remove the social/actionable… this is redundant") — the
  // WHERE picker is the one driver now: no areas = a feed story (what
  // Social was), any area = actionable (the terms machinery reveals).
  // content_type stays in the DB, DERIVED at publish, so the marketplace
  // auto-add and the ISO matcher keep working untouched; legacy
  // content_types survive on old posts via contentType.
  const [contentType, setContentType] = useState<ContentType>(() =>
    areasFromParam(params.get('area')).length ? 'actionable' : 'social');
  // "Where": a post can live in several areas at once.
  const [areas, setAreas] = useState<Set<ServiceArea>>(() => {
    // A post lives where it was born (founder 2026-11-05: "Have each post
    // post to its section… and if you specify that its a paid piece of
    // content, it also auto populates marketplace") — no catch-all pre-check;
    // PAID is what carries a post into Marketplace (see publish).
    return new Set(areasFromParam(params.get('area')));
  });
  const [whereOpen, setWhereOpen] = useState(false);
  // The audience list outgrew the page (founder 2026-10-13: "audience is long
  // enough now that it should be a carrot that opens to a drop down") — it
  // folds behind a Where-shaped summary row whose shut face states the choice.
  const [audOpen, setAudOpen] = useState(false);

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
  // FOR AN IDENTITY (founder 2026-08-20/21, generalized from gift-only: "a
  // course for veterans and first responders… same goes for a marketplace
  // item"). Any actionable post can name who it's for — vocabulary names in
  // details.forIdentities, which is what an identity's gathering page reads.
  // A gift's free-text giftTo stays for phrasing the vocabulary can't hold.
  const [forIdents, setForIdents] = useState<string[]>([]);
  const [identOpen, setIdentOpen] = useState(false);
  const [identCats, setIdentCats] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (!identOpen || identCats !== null) return;
    void supabase.from('categories').select('id, name').eq('domain', 'identity').order('name')
      .then(({ data }) => setIdentCats((data as { id: string; name: string }[] | null) ?? []));
  }, [identOpen, identCats]);
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
  // CURRENT-CY ONLY (founder 2026-11-06: guests off Lichen default to paying
  // in DOLLARS, "or if the seller will only deal in current-cy, which means
  // they'd need to join the platform"): the seller's switch on a paid
  // listing. On, a private /p/ link shows the join door instead of Ask to
  // buy, and guest_request_purchase refuses server-side.
  const [currentcyOnly, setCurrentcyOnly] = useState(false);
  // THE INVITATION STUDIO (founder 2026-11-08): the event's invite design,
  // kept on the door-post as details.invite — read by the guest page /e/
  // and the emailed card. null = the Classic template.
  const [inviteDesign, setInviteDesign] = useState<InviteDesign | null>(null);
  // SCHEDULED SEND (the Paperless Post audit): '' = right when you post;
  // a datetime-local value = the emailed invitations wait for that moment.
  const [invSendAt, setInvSendAt] = useState('');
  // EVENT TIME ZONE (founder 2026-11-08): defaults to the zone the member's
  // calendar runs in; editable per event. '' until known.
  const [evTz, setEvTz] = useState('');
  const evTzTouched = useRef(false);
  useEffect(() => {
    if (!user?.id) return;
    let live = true;
    void myTimezone().then((z) => { if (live && !evTzTouched.current) setEvTz((cur) => cur || z || viewerZone()); });
    return () => { live = false; };
  }, [user?.id]);
  const tzZones = useMemo(() => allTimeZones(), []);
  // A UNIQUE ZOOM ROOM PER EVENT (founder 2026-11-09): Lichen's Zoom mints the
  // meeting; only hosts and guests ever see the link. Gated like bookings.
  const [evZoom, setEvZoom] = useState(false);
  // DRAFTS HOLD YOUR TIME + WHO SEES IT ON YOUR CALENDAR (founder 2026-11-09).
  // evHold (default on): a draft event with a date holds that time on the
  // member's Lichen calendar. evShare: the event's cap over calendar sharing.
  const [evHold, setEvHold] = useState(true);
  const [evShare, setEvShare] = useState<'' | 'busy' | 'hidden'>('');
  const [zoomOk, setZoomOk] = useState(false);
  useEffect(() => { void zoomMintAllowed(user?.id).then(setZoomOk); }, [user?.id]);
  const [studioOpen, setStudioOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Category tags — the real 63-category taxonomy, loaded when opened.
  const [tagsOpen, setTagsOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [allCats, setAllCats] = useState<Category[] | null>(null);
  const [catTags, setCatTags] = useState<string[]>([]);
  // TRAVEL IS AN EXCHANGE (founder 2026-10-06: "private citizens who drive
  // cars, trucks, airplanes and helicopters - as well as any companies"):
  // a ride or a stay carries its physical facts the way a listing carries
  // condition — route, vehicle and seats for a ride; sleeps for a stay.
  // The TERMS stay the universal modes (gift/trade/rent/Current-cy), which
  // is what makes "an apt in SF for a villa in France" just a Trade.
  const [travelKind, setTravelKind] = useState<'' | 'ride' | 'flight' | 'stay'>('');
  const [routeFrom, setRouteFrom] = useState('');
  const [routeTo, setRouteTo] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [seats, setSeats] = useState('');
  const [sleeps, setSleeps] = useState('');
  useEffect(() => {
    if (!tagsOpen || allCats !== null) return;
    void supabase.from('categories').select('*').order('sort')
      .then(({ data }) => setAllCats((data as Category[] | null) ?? []));
  }, [tagsOpen, allCats]);
  // THE CALENDAR'S "MAKE IT A FORMAL EVENT" DOOR (founder 2026-11-06: "the
  // compose flows are unified, with Events having a fancier, deeper set of
  // info and a pretty invite"): EventComposer carries what was typed —
  // ?date= &end= &start= &endmin= &allday=1 &where= &body= &invite=<json>.
  const isoParam = (k: string) => { const v = params.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
  const minParam = (k: string) => { const n = Number(params.get(k)); return params.get(k) != null && Number.isInteger(n) && n >= 0 && n <= 1440 ? n : null; };
  const [evRange, setEvRange] = useState<DateRange>(() => {
    const st = isoParam('date') ?? todayISO();
    return { start: st, end: isoParam('end') ?? st };
  });
  const [evAllDay, setEvAllDay] = useState(() => params.get('allday') === '1');
  const [evStartMin, setEvStartMin] = useState(() => minParam('start') ?? 18 * 60);
  const [evEndMin, setEvEndMin] = useState(() => minParam('endmin') ?? 20 * 60);
  const [bookingUrl, setBookingUrl] = useState('');
  const [tradeFor, setTradeFor] = useState('');
  const [sliding, setSliding] = useState(false);
  // Total vs PER-unit (founder 2026-10-02, two passes: "price here should
  // be total or per hour" → "have per be a drop down: hour… but also, day,
  // week, month, etc… you can enter in days, too - like hours"): a per
  // dropdown (hour/day/week/month/session/per…) + an optional COUNT so
  // "per 3 days" works like hours, + a free per-… word for anything else.
  // The stored price string itself ends "… per <unit>" so every surface
  // that renders details.price speaks the unit for free;
  // details.priceUnit holds the phrase as the structured twin. The empty
  // selection = total, the unlabeled legacy meaning.
  const [unitSel, setUnitSel] = useState('');   // '' | hour|day|week|month|session | other
  const [unitQty, setUnitQty] = useState('');   // optional count for time units ("3" → per 3 days)
  const [unitText, setUnitText] = useState(''); // the per-… free word (e.g. class, acre)
  const effPriceUnit = (): string => {
    if (!unitSel) return '';
    if (unitSel === 'other') {
      return unitText.trim().toLowerCase().replace(/[^a-z0-9 -]/g, '').slice(0, 24).trim();
    }
    const n = parseInt(unitQty, 10);
    return n >= 2 ? `${n} ${unitSel}s` : unitSel;
  };
  // In-kind DONATION: title passes to Lichen (the Goodwill move) — that's
  // what makes a tax acknowledgment legal. Offered under Lichen*; a steward
  // accepts on the routing desk, and the receipt email follows.
  // GOODS or SERVICES (founder 2026-10-02: "give away services (like free
  // therapy) or goods… a receipt, kinda like goodwill?") — the tax truth
  // splits: goods are deductible at the donor's own fair-market value, while
  // the IRS NEVER deducts the value of time or services — only the donor's
  // out-of-pocket costs of providing them, for which the receipt describing
  // the services is exactly the written acknowledgment the IRS requires
  // ($250+). The copy below never promises a services deduction.
  const [inkind, setInkind] = useState(false);
  const [inkindKind, setInkindKind] = useState<'goods' | 'services'>('goods');
  const [slideLow, setSlideLow] = useState('');
  const [slideHigh, setSlideHigh] = useState('');
  // ?title=/?body= prefill words carried in from another surface (the task
  // quick-add's ?title= precedent; the intake's give-back doors use ?body=
  // — founder 2026-09-23: an offer written there weaves into Marketplace).
  // An edit (?post=) overwrites these when the post loads.
  const [title, setTitle] = useState(() => params.get('title') ?? '');
  const [body, setBody] = useState(() => params.get('body') ?? '');
  // VANITY LINK NAME (founder 2026-11-04: "vanity url structure should be
  // deployed across platform, so you can share a link for anything") —
  // posts.slug, the booking link-name grammar: lowercase kebab, unique per
  // owner, shareable at lichen.health/<section>/<handle>/<link-name>.
  const [linkName, setLinkName] = useState('');
  const [ownHandle, setOwnHandle] = useState<string | null>(null);
  // The address the link name rides on follows the hat: a space's listing
  // shares at the SPACE's handle, a being's at its own, else yours.
  useEffect(() => {
    if (!user) return;
    let live = true;
    const table = actor.type === 'space' ? 'spaces' : 'profiles';
    const id = actor.type === 'self' ? user.id : actor.id;
    void supabase.from(table).select('handle').eq('id', id).maybeSingle()
      .then(({ data }) => { if (live) setOwnHandle((data as { handle: string | null } | null)?.handle ?? null); });
    return () => { live = false; };
  }, [user?.id, actor.type, actor.type === 'self' ? '' : actor.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // EVENT INVITES FROM THE COMPOSER (founder 2026-11-04: "audience for
  // events will need to be like booking… type in an audience… add people by
  // email, phone or on the platform, it should smart fill" + "add 'generate
  // link' as an invite and have the default be 'approve RSVP's outside of
  // invite list'"). One smart box: member names smart-fill (findable
  // type-ahead, the TodoView pattern), a circle's name ticks the audience
  // checkbox (the existing machinery IS the sub-audience), and an email or
  // phone (classifyCareContact — the one classifier) becomes an outside
  // guest invite on publish. genLink mints the shareable open URL, whose
  // standing default is the approval gate: off-list askers wait for the
  // host's yes (request_event_spot — built, now the named default).
  const [invitees, setInvitees] = useState<EvInvitee[]>(() => {
    try {
      const raw = JSON.parse(params.get('invite') ?? '[]') as EvInvitee[];
      return Array.isArray(raw) ? raw.filter((i) => i && (i.kind === 'member' || i.kind === 'email' || i.kind === 'phone')).slice(0, 200) : [];
    } catch { return []; }
  });
  // WHO'S INVITED — ON LICHEN / OFF LICHEN (founder 2026-11-04, two passes:
  // "visibility should be Open: Anyone, Anyone on Lichen, then subsets…
  // If you don't put an audience you have to choose one before it goes
  // live", then "'Off Lichen' and 'On Lichen' where it has checkboxes for
  // Everyone and Mycelium, then Communities, Groups, Etc"): the Everyone
  // checkboxes ARE the visibility rungs — On-Lichen Everyone = every member,
  // dark to the open web (visibility 'lichen'); Off-Lichen Anyone = the open
  // web too (is_public). Both default OFF — an event never posts on a silent
  // default; nothing checked and nobody invited = the Post button asks.
  const [evLichen, setEvLichen] = useState(false);
  const [evAnyone, setEvAnyone] = useState(false);
  const [invQ, setInvQ] = useState('');
  const [invHits, setInvHits] = useState<{ id: string; full_name: string | null }[]>([]);
  // A typed email/phone that BELONGS to a member (founder 2026-11-04: "if
  // you enter the phone number of a lichen member, it adds them … under
  // members on lichen"): member_by_contact — exact match, findable only.
  const [invContactHit, setInvContactHit] = useState<{ id: string; full_name: string | null } | null>(null);
  const [genLink, setGenLink] = useState(false);
  // REUSABLE GUEST LISTS (founder 2026-11-06: "build the reusable guest
  // lists next" — Paperless Post's address book): guest_lists is the
  // member's own private shelf of invitees (+ circles). Load merges a list
  // into the chips; Save writes the current chips under a name (same name =
  // update that list). Owner-only RLS; nothing else ever reads it.
  type GuestList = { id: string; name: string; entries: EvInvitee[]; space_ids: string[] };
  const [guestLists, setGuestLists] = useState<GuestList[]>([]);
  const [glSaving, setGlSaving] = useState(false);
  // Renaming an existing list in place (null = the save-new box).
  const [glRenaming, setGlRenaming] = useState<string | null>(null);
  // EDITING A LIST IN PLACE (founder 2026-11-08: "edit pulls all the names up
  // so you can edit each entry… the 'x' to remove a member, as well as a '+'
  // circle to add members. The changes are reflected everywhere, including
  // drive - so its one list in the cloud"): while a list is being edited, every
  // × under it and everything added through the smart box writes straight to
  // its guest_lists row — the same row Drive → Contacts edits.
  const [glEditing, setGlEditing] = useState<string | null>(null);
  const glEditingRef = useRef<string | null>(null);
  glEditingRef.current = glEditing;
  const invInputRef = useRef<HTMLInputElement | null>(null);
  const [glName, setGlName] = useState('');
  const [glMsg, setGlMsg] = useState<string | null>(null);
  const [glDel, setGlDel] = useState<string | null>(null);
  // WHERE EACH INVITEE CAME FROM (founder 2026-11-08: "a carrot when you add
  // more than one list, which expands to the individual members of the list
  // … so they can remove some members"): key → source ('gl:<list>' or
  // 'sp:<circle>'), so the chips render GROUPED under their list/circle.
  // Display only — publishing still reads the flat invitees.
  const [invSrc, setInvSrc] = useState<Record<string, string>>({});
  const [srcNames, setSrcNames] = useState<Record<string, string>>({});
  const [srcOpen, setSrcOpen] = useState<Record<string, boolean>>({});
  // A checked circle can be OPENED to see who it reaches (members of a
  // circle you're in are readable to you — space_members RLS). Removing one
  // person turns the circle into individual invitations for everyone else.
  const [circleOpen, setCircleOpen] = useState<string | null>(null);
  const [circleMembers, setCircleMembers] = useState<Record<string, { id: string; name: string }[] | 'loading'>>({});
  async function loadGuestLists() {
    if (!user) return;
    const { data } = await supabase.from('guest_lists').select('id, name, entries, space_ids')
      .eq('owner_id', user.id).order('updated_at', { ascending: false });
    setGuestLists((data as GuestList[] | null) ?? []);
  }
  useEffect(() => { void loadGuestLists(); }, [user?.id]);
  // Drive's "Invite them to an event ›" arrives with ?list=<id> — the list
  // loads into the chips once (circles wait for the member's spaces).
  const listPreloaded = useRef(false);
  useEffect(() => {
    const want = params.get('list');
    if (!want || listPreloaded.current) return;
    const gl = guestLists.find((g) => g.id === want);
    if (!gl) return;
    if (gl.space_ids.length > 0 && mySpaces.length === 0) return;
    listPreloaded.current = true;
    applyGuestList(gl);
  }, [guestLists, mySpaces]);
  function applyGuestList(gl: GuestList) {
    tagSource(`gl:${gl.id}`, gl.name, gl.entries);
    for (const inv of gl.entries) addInvitee(inv);
    const mine = new Set(mySpaces.map((sp) => sp.id));
    const add = gl.space_ids.filter((id) => mine.has(id));
    if (add.length) {
      setEvLichen(false);
      setAudienceSpaces((cur) => { const n = new Set(cur); add.forEach((id) => n.add(id)); return n; });
    }
    setGlMsg(`Added “${gl.name}” — ${gl.entries.length + add.length} on the list.`);
  }
  async function saveGuestList() {
    const name = glName.trim();
    if (!user || !name) return;
    const row = { owner_id: user.id, name, entries: invitees, space_ids: [...audienceSpaces], updated_at: new Date().toISOString() };
    const existing = guestLists.find((g) => g.name.trim().toLowerCase() === name.toLowerCase());
    const { data: savedRow, error } = existing
      ? await supabase.from('guest_lists').update(row).eq('id', existing.id).select('id').single()
      : await supabase.from('guest_lists').insert(row).select('id').single();
    if (error) { setGlMsg(`Couldn't save the list: ${error.message}`); return; }
    // The people on screen now ARE this list — group them under it, so the
    // foot names it instead of offering to save it again.
    const sid = (savedRow as { id: string } | null)?.id;
    if (sid) {
      setSrcNames((cur) => ({ ...cur, [`gl:${sid}`]: name }));
      setInvSrc((cur) => { const n = { ...cur }; invitees.forEach((x) => { n[invKey(x)] = `gl:${sid}`; }); return n; });
    }
    setGlMsg(existing ? `Updated “${name}” ✓` : `Saved “${name}” to your guest lists ✓`);
    setGlSaving(false); setGlName('');
    void loadGuestLists();
  }
  async function renameGuestList(id: string) {
    const name = glName.trim();
    if (!name) return;
    const clash = guestLists.find((g) => g.id !== id && g.name.trim().toLowerCase() === name.toLowerCase());
    if (clash) { setGlMsg(`You already have a list called “${name}”.`); return; }
    const { error } = await supabase.from('guest_lists').update({ name, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setGlMsg(`Couldn't rename it: ${error.message}`); return; }
    setSrcNames((cur) => ({ ...cur, [`gl:${id}`]: name }));
    setGlMsg(`Renamed to “${name}” ✓`);
    setGlRenaming(null); setGlName('');
    void loadGuestLists();
  }
  /** Write the chips now on screen back into the list they came from. */
  async function updateGuestList(gl: GuestList, people: EvInvitee[]) {
    const { error } = await supabase.from('guest_lists')
      .update({ entries: people, updated_at: new Date().toISOString() }).eq('id', gl.id);
    if (error) { setGlMsg(`Couldn't update the list: ${error.message}`); return; }
    setGlMsg(`Updated “${gl.name}” ✓`);
    void loadGuestLists();
  }
  async function deleteGuestList(id: string) {
    if (glDel !== id) { setGlDel(id); return; }
    await supabase.from('guest_lists').delete().eq('id', id);
    setGlDel(null);
    void loadGuestLists();
  }
  useEffect(() => {
    const q = invQ.trim();
    if (q.length < 2 || !user) { setInvHits([]); setInvContactHit(null); return; }
    const t = window.setTimeout(() => {
      void supabase.from('profiles').select('id, full_name')
        .eq('findable', true).ilike('full_name', `%${q}%`).neq('id', user.id).limit(4)
        .then(({ data }) => setInvHits((data as { id: string; full_name: string | null }[] | null) ?? []));
      const c = classifyInviteLine(q);
      if (c.kind === 'email' || c.kind === 'phone') {
        void supabase.rpc('member_by_contact', { p_contact: c.kind === 'email' ? c.email : c.digits })
          .then(({ data }) => {
            const row = (data as { id: string; full_name: string | null }[] | null)?.[0];
            setInvContactHit(row && row.id !== user.id ? row : null);
          });
      } else {
        setInvContactHit(null);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [invQ, user?.id]);
  const invKey = (x: EvInvitee) => x.kind === 'member' ? `m:${x.id}` : `${x.kind}:${x.value}`;
  /** Remember which list/circle brought these people in (first source wins —
   *  someone already on the list stays where they were). */
  function tagSource(src: string, name: string, list: EvInvitee[]) {
    setSrcNames((cur) => ({ ...cur, [src]: name }));
    setInvSrc((cur) => {
      const n = { ...cur };
      for (const inv of list) { const k = invKey(inv); if (!n[k] && !invitees.some((x) => invKey(x) === k)) n[k] = src; }
      return n;
    });
  }
  // A draft the BRAIN built with save_guest_list_as arrives as plain chips;
  // when every person on a saved list is already on the invite (and none of
  // them is grouped yet), group them under that list — so the screen knows
  // the list exists and never offers to save it again (founder 2026-11-08:
  // "since i asked the brain to save this as a guest list, it shouldn't ask
  // me again").
  useEffect(() => {
    if (!guestLists.length || !invitees.length) return;
    const have = new Set(invitees.map(invKey));
    for (const gl of guestLists) {
      if (!gl.entries.length) continue;
      const keys = gl.entries.map(invKey);
      if (keys.every((k) => have.has(k) && !invSrc[k])) {
        setSrcNames((cur) => ({ ...cur, [`gl:${gl.id}`]: gl.name }));
        setInvSrc((cur) => { const n = { ...cur }; keys.forEach((k) => { if (!n[k]) n[k] = `gl:${gl.id}`; }); return n; });
      }
    }
  }, [guestLists, invitees]);
  // The list being edited follows its people on screen, saved to the cloud
  // row a beat after each change (one list, edited anywhere).
  useEffect(() => {
    if (!glEditing) return;
    const gl = guestLists.find((g) => g.id === glEditing);
    if (!gl) return;
    const people = invitees.filter((x) => invSrc[invKey(x)] === `gl:${gl.id}`);
    const a = people.map(invKey).sort().join('|');
    const b = gl.entries.map(invKey).sort().join('|');
    if (a === b) return;
    const t = window.setTimeout(() => {
      void supabase.from('guest_lists')
        .update({ entries: people, updated_at: new Date().toISOString() }).eq('id', gl.id)
        .then(({ error }) => {
          if (error) { setGlMsg(`Couldn't save the list: ${error.message}`); return; }
          setGuestLists((cur) => cur.map((g) => (g.id === gl.id ? { ...g, entries: people } : g)));
        });
    }, 500);
    return () => window.clearTimeout(t);
  }, [glEditing, invitees, invSrc, guestLists]);
  async function openCircle(id: string) {
    if (circleOpen === id) { setCircleOpen(null); return; }
    setCircleOpen(id);
    if (circleMembers[id]) return;
    setCircleMembers((c) => ({ ...c, [id]: 'loading' }));
    const rows = await loadSpaceMembers(id);
    setCircleMembers((c) => ({ ...c, [id]: rows
      .filter((r) => r.profile_id !== user?.id)
      .map((r) => ({ id: r.profile_id, name: r.profile?.full_name ?? 'A member' })) }));
  }
  /** Leave one person out of a circle invite: the circle becomes individual
   *  invitations for everyone else, grouped under the circle's name. */
  function trimCircle(sp: { id: string; name: string }, dropId: string) {
    const ms = circleMembers[sp.id];
    if (!Array.isArray(ms)) return;
    const keep: EvInvitee[] = ms.filter((m) => m.id !== dropId).map((m) => ({ kind: 'member', id: m.id, name: m.name }));
    tagSource(`sp:${sp.id}`, sp.name, keep);
    keep.forEach(addInvitee);
    setAudienceSpaces((cur) => { const n = new Set(cur); n.delete(sp.id); return n; });
    setSrcOpen((o) => ({ ...o, [`sp:${sp.id}`]: true }));
    setCircleOpen(null);
  }
  function addInvitee(inv: EvInvitee) {
    const editingList = glEditingRef.current;
    if (editingList) {
      const k = inv.kind === 'member' ? `m:${inv.id}` : `${inv.kind}:${inv.value}`;
      setInvSrc((cur) => (cur[k] ? cur : { ...cur, [k]: `gl:${editingList}` }));
    }
    setInvitees((cur) => {
      const key = (x: EvInvitee) => x.kind === 'member' ? `m:${x.id}` : `${x.kind}:${x.value}`;
      return cur.some((x) => key(x) === key(inv)) ? cur : [...cur, inv];
    });
    setInvQ(''); setInvHits([]);
  }
  // ?popup=1 — this composer is a POP-UP flow over another screen (the WOW
  // intake's weave doors, founder 2026-09-23): publishing closes the window
  // so the member lands back on the form underneath. If the browser refuses
  // the close (e.g. the door fell back to plain navigation), the ordinary
  // after-post landing still runs.
  const isPopup = params.get('popup') === '1';
  // THE BACK RIDES THE TOPBAR (founder 2026-11-04, circling the bare
  // "← Back" pill: "for consistency, isn't this the wrong back button
  // functionality?" — the worded-chip sunset finally applied here):
  // Compose broadcasts its back beside the ☰ like every non-section
  // screen. The in-page chip survives ONLY in ?popup=1, where its words
  // carry close-this-window semantics.
  useTopBackFor(() => {
    if (isPopup) { window.close(); return; }
    if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
    else navigate(afterPostDestination(areas.has('events')));
  });
  const [price, setPrice] = useState('');
  const [location, setLocation] = useState(() => (/^https?:/i.test(params.get('where') ?? '') ? '' : params.get('where') ?? ''));
  // Where it happens (founder 2026-07-27): Online and In person are
  // CHECKBOXES — a hybrid offering carries a meeting link AND an address.
  const [online, setOnline] = useState(() => /^https?:/i.test(params.get('where') ?? ''));
  // A calendar hand-off's place arrives in person (a link rides as a meeting).
  const [inPerson, setInPerson] = useState(() => !!params.get('where') && !/^https?:/i.test(params.get('where') ?? ''));
  const [meetingUrl, setMeetingUrl] = useState(() => (/^https?:/i.test(params.get('where') ?? '') ? params.get('where') ?? '' : ''));
  // Coordinates from a picked LocationField suggestion (null = text-only).
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(null);

  // media
  const [media, setMedia] = useState<Attached[]>([]);
  // THE INVITATION, PAPERLESS-POST STYLE (founder 2026-11-05: "save the guest
  // list but do tests and previews for invites sent to myself via my email…
  // like paperless post — build that into the compose flow"): the event
  // composer shows the card guests receive, live, and can email a [Test]
  // copy to the host's OWN inbox (send-event-invite's test mode — the server
  // picks the recipient, never this client) before anyone else is invited.
  const [hostName, setHostName] = useState('');
  const [invTest, setInvTest] = useState<{ state: 'idle' | 'sending' | 'sent' | 'error'; msg?: string }>({ state: 'idle' });
  useEffect(() => {
    if (!user) return;
    void supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => setHostName((data as { full_name: string | null } | null)?.full_name ?? ''));
  }, [user]);
  // Organize-into (courses/library): file this post straight into one of your
  // courses/collections — or start a new one — right from Compose.
  const [myCols, setMyCols] = useState<CollectionRow[]>([]);
  const [organizeInto, setOrganizeInto] = useState<string | null>(null);
  const [newColName, setNewColName] = useState('');
  // External resources (founder 2026-08-10): "much of it will be hosted
  // outside of lichen, until we become a popular platform" — a Library
  // piece can point at something hosted elsewhere. Reuses the existing
  // rich-preview pipeline (resolvePreviews/link-preview edge fn), just
  // resolved from a dedicated field instead of requiring the URL be
  // pasted into the body. details.isResource marks it for a distinct
  // "external resource" badge in FeedCard/ListingTile.
  const [resourceUrl, setResourceUrl] = useState('');
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
  // ?collection=<id> — PUBLISHING A COLLECTION INTO A ROOM (founder
  // 2026-08-14): the post minted here carries the collection; the chosen
  // room's own flow shapes how it appears (price for Marketplace, etc).
  const collectionParam = params.get('collection');
  const [publishingCollection, setPublishingCollection] = useState<{ id: string; name: string; count: number } | null>(null);

  /** After posting, land back where the + was pressed: the space's profile,
   *  else the section (Library → /library), else Home. */
  const AREA_HOME: Partial<Record<ServiceArea, string>> = {
    marketplace: '/market', courses: '/courses', library: '/library',
    events: '/events', work: '/work', places: '/places',
    art: '/art', food: '/food', travel: '/travel',
  };
  function afterPostDestination(isEventPost: boolean): string {
    if (collectionParam) return `/collections/${collectionParam}`;
    if (presetSpace) return `/spaces/${presetSpace}`;
    if (isEventPost) return '/events';
    const a = areasFromParam(params.get('area'))[0] ?? null;
    return (a && AREA_HOME[a]) || '/home';
  }
  const editing = !!editPostId;

  // Content controls (founder 2026-08-05): AI-readable + downloadable, BOTH
  // on by default; a member's profile defaults pre-select them for new
  // posts, and each post can flip either. Stored in details only when OFF.
  const [aiReadable, setAiReadable] = useState(true);
  // QUIET POSTS (founder 2026-08-07: "a post compose option that says, don't
  // generate a feed story... you may not want to generate 45 stories when you
  // share a certain product set to marketplace"). The post is real everywhere
  // it belongs — its section, your profile, search, the matcher — it just
  // doesn't enter the Home and My-celium river.
  const [quiet, setQuiet] = useState(false);
  const [downloadable, setDownloadable] = useState(true);
  // WEAVEABLE (founder 2026-08-14): may others include this post in their
  // published collections? Weaving is by reference — their weave points at
  // your post, name attached — so the toggle is about association, not
  // copies. Same storage shape as the pair above: details.noWeave only when
  // OFF, and a DB trigger enforces it on every collection_items insert.
  const [weaveable, setWeaveable] = useState(true);
  useEffect(() => {
    // Edits prefill from the post itself; a reopened DRAFT is already the
    // member's own choices, so the profile defaults stand down there too.
    if (!user || editPostId || params.get('draft')) return;
    let live = true;
    void supabase.from('profiles')
      .select('content_ai_default, content_download_default, weaveable_default')
      .eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return;    // pre-migration: keep the true defaults
        const r = data as { content_ai_default?: boolean; content_download_default?: boolean; weaveable_default?: boolean };
        if (r.content_ai_default === false) setAiReadable(false);
        if (r.content_download_default === false) setDownloadable(false);
        if (r.weaveable_default === false) setWeaveable(false);
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, editPostId]);

  useEffect(() => {
    if (!collectionParam || editPostId) return;
    let live = true;
    void loadCollection(collectionParam).then((c) => {
      if (!live || !c) return;
      setPublishingCollection({ id: c.meta.id, name: c.meta.name, count: c.posts.length });
      setTitle((cur) => cur || c.meta.name);
      setBody((cur) => cur || (c.meta.description ?? ''));
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionParam, editPostId]);

  // POST DRAFTS (founder 2026-10-15: "can we have posts auto save and have a
  // save AND post button at the bottom, not just post, so we will also need
  // a drafts section"): everything typed into a NEW post autosaves into
  // post_drafts on the page_drafts idiom — 1.2s debounce, immediate flush on
  // tab-hide/pagehide, an empty draft DELETES its row (gated on hadDraft so
  // a failed read never destroys a real row), posting deletes it, and the
  // Drive's Drafts section reopens one via ?draft=<id>. The row id is minted
  // client-side so one compose session keeps upserting one row; edits
  // (?post=) are out of scope — the live post holds their words. ⚠ Like
  // wow_intake_drafts, NO assistant path may ever read post_drafts.
  const draftParam = params.get('draft');
  const draftIdRef = useRef<string>(draftParam ?? crypto.randomUUID());
  const hadDraft = useRef(false);
  const postedRef = useRef(false);        // the WowIntake `finished` lesson
  const touchedRef = useRef(false);
  const baselineRef = useRef<string | null>(null);
  const hydratedRef = useRef(!draftParam);
  const [draftNote, setDraftNote] = useState('');
  const [draftCount, setDraftCount] = useState(0);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

  function draftSnapshot(): Record<string, unknown> {
    return {
      contentType, title, body, linkName, invitees, genLink, evLichen, evAnyone,
      areas: [...areas], isPublic, toMycelium, audienceSpaces: [...audienceSpaces],
      evCategory, evMode, modes: [...modes], setTerms: [...setTerms],
      giftTo, forIdents, modeNotes, tradeFor,
      condition: [...condition], availFrom, availTo, fulfillment: [...fulfillment],
      deliverRadius, paymentPlan, currentcyOnly, catTags, inviteDesign, invSendAt, evTz, evZoom, evHold, evShare,
      travelKind, routeFrom, routeTo, vehicle, seats, sleeps,
      evRange, evAllDay, evStartMin, evEndMin, bookingUrl,
      sliding, slideLow, slideHigh, unitSel, unitQty, unitText,
      inkind, inkindKind, price, location, online, inPerson, meetingUrl, locGeo,
      media, organizeInto, resourceUrl,
      aiReadable, quiet, downloadable, weaveable,
    };
  }
  const draftEmpty = !title.trim() && !body.trim() && media.length === 0;

  async function writeDraft() {
    if (!user || editing || postedRef.current || !hydratedRef.current) return;
    if (draftEmpty) {
      if (hadDraft.current) {
        await deletePostDraft(draftIdRef.current).catch(console.error);
        hadDraft.current = false;
      }
      return;
    }
    try {
      await savePostDraft(draftIdRef.current, user.id, draftSnapshot());
      hadDraft.current = true;
      setDraftSavedAt(Date.now());
      // The draft's time-hold rides the same save (a personal event only —
      // a space's calendar isn't the member's to block).
      const holdOn = areas.has('events') && evHold && !!evRange.start && actor.type !== 'space';
      await syncDraftHold(user.id, draftIdRef.current, holdOn ? {
        title: title.trim() || body.trim().slice(0, 60) || 'Event',
        startDate: evRange.start!, endDate: evRange.end ?? evRange.start!,
        allDay: evAllDay, startMin: evStartMin, endMin: evEndMin,
        timezone: evTz || null, location: location.trim(), shareLevel: evShare || null,
      } : null).catch((e) => console.error('draft hold:', e));
    } catch (e) { console.error('post draft:', e); }
  }
  // Edit-with-AI for events: save the draft NOW (so the brain's tools find
  // it by title), then deliver the hand-off note into a fresh events
  // conversation and land the member on it.
  async function editEventWithAi() {
    touchedRef.current = true;
    await writeDraft();
    const t = title.trim();
    const photosN = media.filter((m) => m.type === 'photo').length;
    const parts: string[] = [];
    parts.push(t ? `The event is “${t}”, saved as a draft.` : 'An untitled event draft is open — give it a name first so I can find it.');
    if (evRange.start) parts.push(`Date: ${evRange.start}${evRange.end && evRange.end !== evRange.start ? ` to ${evRange.end}` : ''}${evAllDay ? ', all day' : `, ${inviteWhen(evRange.start, false, evStartMin)}`}.`);
    if (location.trim()) parts.push(`Place: ${location.trim()}.`);
    else if (evZoom) parts.push('Online — a unique Zoom room.');
    if (invitees.length) parts.push(`${invitees.length} people on the guest list.`);
    if (body.trim()) parts.push(`Description so far: “${body.trim().slice(0, 300)}”.`);
    parts.push(`Invitation: the ${inviteDesign?.template ?? 'classic'} design${photosN ? `, ${photosN} photo${photosN === 1 ? '' : 's'} uploaded` : ', no photos yet'}.`);
    const note = `Hand-off from manual mode — ${parts.join(' ')} Tell me what you’d like to change — the details, the guests, or the invitation’s look — and I’ll do it on this draft.`;
    try {
      const { convoId } = await postAssistantHandoff('events', note.slice(0, 1500));
      renameConvo(convoId, t ? `Event hand-off · ${t}`.slice(0, 80) : 'Event hand-off').catch(() => undefined);
      navigate(`/assistant/feed?thread=events&convo=${convoId}`);
    } catch {
      navigate(`/assistant/feed?thread=events&convo=new&ask=${encodeURIComponent(note.slice(0, 1500))}`);
    }
  }

  const writeDraftRef = useRef<() => void>(() => {});
  writeDraftRef.current = () => {
    if (touchedRef.current || hadDraft.current) void writeDraft();
  };

  // Reopen a draft: hydrate every captured field, then arm the autosave.
  useEffect(() => {
    if (!draftParam || !user) return;
    let live = true;
    void loadPostDraft(draftParam).then((row) => {
      if (!live) return;
      if (!row) { hydratedRef.current = true; return; }
      const d = row.draft as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      hadDraft.current = true;
      const s = <T,>(v: T | undefined | null, set: (x: T) => void) => { if (v !== undefined && v !== null) set(v); };
      s(d.contentType, setContentType);
      s(d.title, setTitle); s(d.body, setBody); s(d.linkName, setLinkName);
      if (Array.isArray(d.invitees)) setInvitees(d.invitees); s(d.genLink, setGenLink);
      s(d.evLichen, setEvLichen); s(d.evAnyone, setEvAnyone);
      if (Array.isArray(d.areas)) setAreas(new Set(d.areas));
      s(d.isPublic, setIsPublic); s(d.toMycelium, setToMycelium);
      if (Array.isArray(d.audienceSpaces)) setAudienceSpaces(new Set(d.audienceSpaces));
      s(d.evCategory, setEvCategory); s(d.evMode, setEvMode);
      if (Array.isArray(d.modes)) setModes(new Set(d.modes));
      if (Array.isArray(d.setTerms)) setSetTerms(new Set(d.setTerms));
      s(d.giftTo, setGiftTo);
      if (Array.isArray(d.forIdents)) setForIdents(d.forIdents);
      s(d.modeNotes, setModeNotes); s(d.tradeFor, setTradeFor);
      if (Array.isArray(d.condition)) setCondition(new Set(d.condition));
      s(d.availFrom, setAvailFrom); s(d.availTo, setAvailTo);
      if (Array.isArray(d.fulfillment)) setFulfillment(new Set(d.fulfillment));
      s(d.deliverRadius, setDeliverRadius); s(d.paymentPlan, setPaymentPlan); s(d.currentcyOnly, setCurrentcyOnly);
      if (d.inviteDesign) setInviteDesign(readInvite(d.inviteDesign));
      if (typeof d.invSendAt === 'string') setInvSendAt(d.invSendAt);
      if (typeof d.evTz === 'string' && d.evTz) { evTzTouched.current = true; setEvTz(d.evTz); }
      if (d.evZoom === true) { setEvZoom(true); setOnline(true); }
      if (d.evHold === false) setEvHold(false);
      if (d.evShare === 'busy' || d.evShare === 'hidden') setEvShare(d.evShare);
      if (Array.isArray(d.catTags)) setCatTags(d.catTags);
      s(d.travelKind, setTravelKind); s(d.routeFrom, setRouteFrom); s(d.routeTo, setRouteTo);
      s(d.vehicle, setVehicle); s(d.seats, setSeats); s(d.sleeps, setSleeps);
      s(d.evRange, setEvRange); s(d.evAllDay, setEvAllDay);
      s(d.evStartMin, setEvStartMin); s(d.evEndMin, setEvEndMin); s(d.bookingUrl, setBookingUrl);
      s(d.sliding, setSliding); s(d.slideLow, setSlideLow); s(d.slideHigh, setSlideHigh);
      s(d.unitSel, setUnitSel); s(d.unitQty, setUnitQty); s(d.unitText, setUnitText);
      s(d.inkind, setInkind); s(d.inkindKind, setInkindKind);
      s(d.price, setPrice); s(d.location, setLocation);
      s(d.online, setOnline); s(d.inPerson, setInPerson); s(d.meetingUrl, setMeetingUrl);
      s(d.locGeo, setLocGeo);
      if (Array.isArray(d.media)) setMedia(d.media);
      s(d.organizeInto, setOrganizeInto); s(d.resourceUrl, setResourceUrl);
      s(d.aiReadable, setAiReadable); s(d.quiet, setQuiet);
      s(d.downloadable, setDownloadable); s(d.weaveable, setWeaveable);
      // Arm autosave only after the hydration renders — the baseline must be
      // the restored state, or reopening would immediately re-write the row.
      window.setTimeout(() => { if (live) hydratedRef.current = true; }, 60);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftParam, user?.id]);

  // The debounced autosave — fires only once something actually changed from
  // the state the page opened with (URL prefills alone never mint a row).
  const draftSig = JSON.stringify(draftSnapshot());
  useEffect(() => {
    if (!user || editing || postedRef.current || !hydratedRef.current) return;
    if (baselineRef.current === null) { baselineRef.current = draftSig; return; }
    if (draftSig === baselineRef.current && !hadDraft.current) return;
    touchedRef.current = true;
    const t = window.setTimeout(() => { void writeDraft(); }, 1200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSig, user?.id]);

  // Flush straight away when the tab hides — the debounce window is exactly
  // when toggling away used to lose the last field typed (the WOW lesson).
  useEffect(() => {
    const flush = () => writeDraftRef.current();
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // A fresh composer quietly says how many drafts are waiting.
  useEffect(() => {
    if (!user || editing || draftParam) return;
    let live = true;
    void listMyPostDrafts().then((rows) => {
      if (live) setDraftCount(rows.filter((r) => r.id !== draftIdRef.current).length);
    });
    return () => { live = false; };
  }, [user?.id, editing, draftParam]);

  async function saveDraftNow() {
    if (draftEmpty) { setDraftNote('Nothing to save yet — add a few words or a photo first.'); return; }
    await writeDraft();
    setDraftNote('Saved to your drafts ✓');
  }

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
      setAreas(new Set(postAreas(p)));
      setTitle(p.title ?? '');
      setBody(p.body ?? '');
      setLinkName(p.slug ?? '');
      if (postAreas(p).includes('events')) {
        setEvLichen(p.visibility === 'lichen');
        setEvAnyone(p.is_public && p.visibility !== 'lichen');
      }
      if (p.event_category) setEvCategory(p.event_category);
      if (p.event_mode) setEvMode(p.event_mode);
      const ev = p.linked_event;
      if (ev) {
        setEvRange({ start: ev.start_date, end: ev.end_date });
        setEvAllDay(ev.all_day);
        if (ev.start_min != null) setEvStartMin(ev.start_min);
        if (ev.end_min != null) setEvEndMin(ev.end_min);
        if (ev.timezone) { evTzTouched.current = true; setEvTz(ev.timezone); }
        if (ev.zoom_unique) { setEvZoom(true); setOnline(true); }
        if (ev.share_level === 'busy' || ev.share_level === 'hidden') setEvShare(ev.share_level);
      }
      const d = p.details ?? {};
      setAiReadable(!d.aiExcluded);
      setDownloadable(!d.noDownload);
      setWeaveable(!(d.noWeave === true));
      setQuiet(d.quiet === true);   // editing must not silently un-quiet it
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
      {
        const fi = Array.isArray(d.forIdentities) ? d.forIdentities
          : Array.isArray(d.giftToIdentities) ? d.giftToIdentities : null;   // pre-rename posts
        if (fi) { setForIdents((fi as unknown[]).filter((x): x is string => typeof x === 'string')); setIdentOpen(true); }
      }
      if (d.modeNotes && typeof d.modeNotes === 'object') setModeNotes(d.modeNotes as Record<string, string>);
      if (Array.isArray(d.condition)) setCondition(new Set(d.condition as string[]));
      if (typeof d.availFrom === 'string') setAvailFrom(d.availFrom);
      if (typeof d.availTo === 'string') setAvailTo(d.availTo);
      if (Array.isArray(d.fulfillment)) setFulfillment(new Set(d.fulfillment as string[]));
      if (d.deliverRadiusMi != null) setDeliverRadius(String(d.deliverRadiusMi));
      if (typeof d.paymentPlan === 'string') setPaymentPlan(d.paymentPlan);
      if (d.currentcyOnly === true) setCurrentcyOnly(true);
      if (d.invite) setInviteDesign(readInvite(d.invite));
      if (Array.isArray(d.categories)) { setCatTags(d.categories as string[]); }
      if (d.travelKind === 'ride' || d.travelKind === 'flight' || d.travelKind === 'stay') setTravelKind(d.travelKind);
      if (typeof d.routeFrom === 'string') setRouteFrom(d.routeFrom);
      if (typeof d.routeTo === 'string') setRouteTo(d.routeTo);
      if (typeof d.vehicle === 'string') setVehicle(d.vehicle);
      if (d.seats != null) setSeats(String(d.seats));
      if (d.sleeps != null) setSleeps(String(d.sleeps));
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
        // "… per <unit>" round-trips into the per dropdown (+ count or
        // free word); the bare price goes back into its field (the sliding
        // round-trip's pattern).
        const um = d.price.match(/ per ([a-z0-9][a-z0-9 -]{0,23})$/i);
        if (um) {
          const phrase = um[1].toLowerCase().trim();
          const qm = phrase.match(/^(\d+)\s+(hour|day|week|month|session)s?$/);
          const single = phrase.match(/^(hour|day|week|month|session)$/);
          if (qm) { setUnitSel(qm[2]); setUnitQty(qm[1]); }
          else if (single) { setUnitSel(single[1]); }
          else { setUnitSel('other'); setUnitText(phrase); }
        }
        const bare = d.price.replace(/ per [a-z0-9][a-z0-9 -]{0,23}$/i, '');
        // "Sliding scale $20–$60" round-trips back into the two fields.
        const m = bare.match(/^Sliding scale (.*)–(.*)$/);
        if (d.sliding === true && m) {
          setSliding(true);
          setSlideLow(m[1] === '?' ? '' : m[1]);
          setSlideHigh(m[2] === '?' ? '' : m[2]);
        } else {
          setPrice(bare);
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
    setAreas((cur) => {
      const n = new Set(cur);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
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
        // Identity rows are member identities, not listing categories — keep
        // them out of the model's pickable vocabulary.
        body: { title: title.trim(), text: body.trim(), categories: cats.filter((c) => c.domain !== 'identity').map((c) => ({ id: c.id, name: c.name })) },
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

  const isMarket = areas.has('marketplace');
  // The one driver since the faces retired (2026-11-04): any area picked
  // makes the post actionable; none = a feed story.
  const isActionable = areas.size > 0;
  const isEvent = areas.has('events');
  // PAID CARRIES A POST INTO MARKETPLACE (founder 2026-11-05): a paid event,
  // course, stay… lists in Marketplace automatically, on top of its own
  // section. Explicitly ticking Marketplace still works for anything else.
  const paidChosen = isEvent ? evMode === 'paid' : modes.has('paid');
  const marketAuto = isActionable && paidChosen && !isMarket;
  // An EVENT's audience = an explicit visibility pick; the only-those-invited
  // rung additionally needs SOMEONE on the list (founder 2026-11-04: "you
  // could invite no one but have visibility be to anyone or anyone on
  // lichen. If you don't put an audience you have to choose one before it
  // goes live" — no silent default).
  const hasAudience = isEvent
    ? (evAnyone || evLichen || toMycelium || audienceSpaces.size > 0 || invitees.length > 0 || genLink)
    : (isPublic || toMycelium || audienceSpaces.size > 0);
  // Courses & Library posts are "targeted feed stories" (founder + Melanie,
  // 2026-07-26): no Type row (they're educational by nature), an Organize-into
  // picker, and — everything being an exchange — the offer block.
  const isCourse = areas.has('courses');
  const isTravel = areas.has('travel');
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

  // Photos select SEVERAL at once (founder 2026-10-15: "I want to be able to
  // select multiple photos at once, not just one") — uploads run in turn so
  // slow connections don't race themselves; video stays one at a time (each
  // one is a transcode job for the worker).
  async function onFile(e: ChangeEvent<HTMLInputElement>, type: MediaType) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const fallback = type === 'photo' ? 'jpg' : 'mp4';
    for (const file of files) {
      const ext = (file.name.split('.').pop() || fallback).toLowerCase();
      await addMedia(file, ext, type);
    }
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

  // Re-arrange attachments (founder 2026-10-15: "re-arrange the order of my
  // photos, video and audio") — the first slot is the COVER cards and tiles
  // lead with. The arrows are the quiet FALLBACK since the same day's second
  // pass ("I would prefer to be able to drag to re-arrange"): drag is the
  // primary gesture, below.
  function moveMedia(i: number, dir: -1 | 1) {
    setMedia((m) => {
      const j = i + dir;
      if (j < 0 || j >= m.length) return m;
      const next = [...m];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  // DRAG TO RE-ARRANGE (founder 2026-10-15, second pass). Pointer events, one
  // engine for mouse and touch: a mouse drags after a 6px threshold; a finger
  // long-presses (~220ms) then drags — movement BEFORE the timer fires means
  // the person is scrolling, so the arm stands down (the KOC pointercancel
  // posture). While a drag is live, the container's non-passive touchmove
  // preventDefault keeps the page still under the finger. The dragged tile is
  // tracked by URL, never index — tile keys are the media URLs, so the node
  // (and its pointer capture) survives each live re-splice of the array.
  const attachedRef = useRef<HTMLDivElement>(null);
  const dragArm = useRef<{ x: number; y: number; url: string; touch: boolean; timer: number | null } | null>(null);
  const dragUrlRef = useRef<string | null>(null);
  const [dragUrl, setDragUrl] = useState<string | null>(null);
  function beginDrag(url: string) {
    dragUrlRef.current = url;
    setDragUrl(url);
  }
  function endDrag() {
    const arm = dragArm.current;
    if (arm?.timer != null) window.clearTimeout(arm.timer);
    dragArm.current = null;
    dragUrlRef.current = null;
    setDragUrl(null);
  }
  function dragPointerDown(e: ReactPointerEvent<HTMLDivElement>, url: string) {
    if (media.length < 2) return;
    // The ×, the arrows: their tap is theirs — never the start of a drag.
    if ((e.target as HTMLElement).closest('button')) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    const touch = e.pointerType !== 'mouse';
    const arm: NonNullable<typeof dragArm.current> = { x: e.clientX, y: e.clientY, url, touch, timer: null };
    if (touch) arm.timer = window.setTimeout(() => { if (dragArm.current === arm) beginDrag(url); }, 220);
    dragArm.current = arm;
  }
  function dragPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const arm = dragArm.current;
    if (!arm) return;
    if (!dragUrlRef.current) {
      const dist = Math.hypot(e.clientX - arm.x, e.clientY - arm.y);
      if (arm.touch) { if (dist > 10) endDrag(); }       // scrolling, not dragging
      else if (dist > 6) beginDrag(arm.url);
      return;
    }
    // Live reorder: the tile under the pointer yields its slot.
    const host = attachedRef.current;
    if (!host) return;
    const tiles = Array.from(host.querySelectorAll<HTMLElement>('.cmp__attached-item'));
    const over = tiles.findIndex((t) => {
      const r = t.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    });
    if (over < 0) return;
    setMedia((m) => {
      const from = m.findIndex((x) => x.url === dragUrlRef.current);
      if (from < 0 || over >= m.length || over === from) return m;
      const next = [...m];
      const [it] = next.splice(from, 1);
      next.splice(over, 0, it);
      return next;
    });
  }
  // Non-passive: React's onTouchMove can't preventDefault a scroll. Rebinds
  // when the attachments strip mounts/unmounts (it only renders with media).
  useEffect(() => {
    const el = attachedRef.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (dragUrlRef.current) e.preventDefault(); };
    el.addEventListener('touchmove', block, { passive: false });
    return () => el.removeEventListener('touchmove', block);
  }, [media.length]);

  const canPost = !!(body.trim() || title.trim() || media.length > 0);

  async function submit() {
    if (!canPost) { setError('Add a few words, a title, or attach something first.'); return; }
    if (!hasAudience) {
      setError(isEvent
        ? 'Choose who this event is for before it goes live — check Anyone or All of Lichen, or invite people or circles.'
        : 'Pick at least one audience.');
      if (!isEvent) setAudOpen(true);
      return;
    }
    // Events: the Everyone checkboxes decide the legacy booleans + the tier.
    const effPublic = isEvent ? (evAnyone || evLichen) : isPublic;
    const evVisOut = isEvent ? (evAnyone ? 'anyone' as const : evLichen ? 'lichen' as const : 'invited' as const) : null;
    if (isEvent && !evRange.start) { setError('Pick a date for your event.'); return; }
    setBusy(true); setError('');
    try {
      // A post lives in the sections it was given; a PAID one also lists in
      // Marketplace (founder 2026-11-05) — said live under Where, never silent.
      const effAreas = new Set(areas);
      if (marketAuto) effAreas.add('marketplace');
      const details: Record<string, unknown> = {};
      // Invite-only event (2026-11-04): the label the bridge trigger and
      // honest copy read; the enforcement is RLS (the attendee arm).
      if (isEvent && !evAnyone && !evLichen) details.inviteOnly = true;
      if (isEvent) {
        // The photo slots are locked in at Post — the guest page and the
        // emails read the design, not the composer's photo list.
        const evPhotos = media.filter((m) => m.type === 'photo').map((m) => m.url);
        const slots = invitePhotos(inviteDesign, evPhotos);
        const base = inviteDesign ? readInvite(inviteDesign) : null;
        if (base || slots.env || slots.card) {
          details.invite = { ...(base ?? { template: 'classic' }), cardPhoto: slots.card ?? 'none', envPhoto: slots.env ?? 'none' };
        }
      }
      if (!aiReadable) details.aiExcluded = true;
      if (quiet) details.quiet = true;
      if (!downloadable) details.noDownload = true;
      if (!weaveable) details.noWeave = true;
      // Publishing a collection into a room: the post CARRIES the collection
      // (founder 2026-08-14) — the card opens the whole thing.
      if (publishingCollection) details.collectionId = publishingCollection.id;
      // Events' calendar rows show ONE location line — the address when in
      // person, else the meeting link (SmartLocation renders links as Join).
      const effLocation = inPerson && location.trim() ? location.trim()
        : online && meetingUrl.trim() ? meetingUrl.trim()
        : isEvent && evZoom && zoomOk ? 'Zoom' : location.trim();
      if (isActionable) {
        if (hasMode('paid')) {
          // The unit rides IN the price text ("$45 per hour", "$500 per 3
          // days") so older surfaces say it without new wiring; skip the
          // append when the member already typed a per-something themselves.
          const unit = effPriceUnit();
          const suffix = unit ? ` per ${unit}` : '';
          if (sliding && (slideLow.trim() || slideHigh.trim())) {
            details.price = `Sliding scale ${slideLow.trim() || '?'}–${slideHigh.trim() || '?'}${suffix}`;
            details.sliding = true;
          } else if (price.trim()) {
            const p = price.trim();
            details.price = unit && !/(\bper\s+[\w -]+|\/\s*hrs?\b|hourly|daily|weekly|monthly)\s*$/i.test(p)
              ? `${p} per ${unit}` : p;
          }
          if (unit && details.price) details.priceUnit = unit;
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
          if (forIdents.length) details.forIdentities = forIdents;
          if (condition.size) details.condition = [...condition];
          if (availFrom) details.availFrom = availFrom;
          if (availTo) details.availTo = availTo;
          if (fulfillment.size) details.fulfillment = [...fulfillment];
          if (fulfillment.has('deliver') && deliverRadius.trim()) {
            const mi = Number(deliverRadius);
            if (Number.isFinite(mi) && mi > 0) details.deliverRadiusMi = mi;
          }
          if (modes.has('paid') && paymentPlan.trim()) details.paymentPlan = paymentPlan.trim();
          if (modes.has('paid') && currentcyOnly) details.currentcyOnly = true;
          if (catTags.length) details.categories = catTags;
          // Travel facts (founder 2026-10-06): structured so the matcher,
          // the cards, and Maps can read them — never only prose.
          if (isTravel) {
            if (travelKind) details.travelKind = travelKind;
            if (routeFrom.trim()) details.routeFrom = routeFrom.trim();
            if (routeTo.trim()) details.routeTo = routeTo.trim();
            if (vehicle) details.vehicle = vehicle;
            const nSeats = Number(seats);
            if ((travelKind === 'ride' || travelKind === 'flight') && Number.isFinite(nSeats) && nSeats > 0) details.seats = nSeats;
            const nSleeps = Number(sleeps);
            if (travelKind === 'stay' && Number.isFinite(nSleeps) && nSleeps > 0) details.sleeps = nSleeps;
          }
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
      // A Library "resource" URL rides the same pipeline — just added to
      // the list explicitly rather than requiring it be pasted in the body.
      const resourceHref = isLibrary && resourceUrl.trim() ? hrefFor(resourceUrl.trim()) : null;
      const previewUrls = [...new Set([...parseBodyUrls(body), ...(resourceHref ? [resourceHref] : [])])];
      const previews = await resolvePreviews(previewUrls);
      if (previews.length) details.previews = previews;
      if (resourceHref) details.isResource = true;
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
            timezone: evTz || null,
            // Only a known provider answer may change the room — never a
            // still-loading gate silently switching an existing meeting off.
            zoomUnique: zoomOk ? evZoom : undefined,
            shareLevel: evShare || null,
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
          body, title, content_type: isActionable ? 'actionable' : contentType,
          isPublic: effPublic, toMycelium, audienceSpaceIds: [...audienceSpaces],
          serviceAreas: [...effAreas],
          authorSpaceId: actor.type === 'space' ? actor.id : null,
          eventCategory: isEvent ? evCategory : null,
          eventMode: isEvent ? (evMode as EventMode) : null,
          linkedEventId,
          image_url: firstPhoto, details,
          slug: linkName,
          eventVisibility: evVisOut,
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
          timezone: evTz || null,
          zoomUnique: evZoom && zoomOk,
          shareLevel: evShare || null,
          recurrence: null,
          // Members picked in the invite box are seated + belled the
          // standing way (event_attendees invited rows).
          inviteeIds: invitees.flatMap((i) => (i.kind === 'member' ? [i.id] : [])),
        });
      }
      let createdId: string | null = null;
      try {
        const created = await createPost({
          body, title, content_type: isActionable ? 'actionable' : contentType,
          isPublic: effPublic, toMycelium, audienceSpaceIds: [...audienceSpaces],
          serviceAreas: [...effAreas],
          authorSpaceId: actor.type === 'space' ? actor.id : null,
          authorBeingId: actor.type === 'being' ? actor.id : null,
          eventCategory: isEvent ? evCategory : null,
          eventMode: isEvent ? (evMode as EventMode) : null,
          linkedEventId,
          image_url: firstPhoto, details,
          slug: linkName,
          eventVisibility: evVisOut,
        });
        createdId = created?.id ?? null;
        // EVENT INVITES (founder 2026-11-04): emails send the pretty
        // invitation card now; phone invites mint tokened rows the host
        // texts from the event page (no SMS provider, standing doctrine);
        // Generate link mints the shareable open URL — off-list askers
        // wait for host approval, the standing default. None of these can
        // fail the post — the event page shows whatever landed.
        if (isEvent && linkedEventId) {
          const evId = linkedEventId;
          const sends: Promise<unknown>[] = [];
          for (const inv of invitees) {
            if (inv.kind === 'email') {
              const at = invSendAt ? new Date(invSendAt) : null;
              sends.push(inviteEventGuest(evId, inv.name || inv.value.split('@')[0], inv.value,
                at && !isNaN(at.getTime()) && at.getTime() > Date.now() + 60_000 ? at.toISOString() : undefined));
            } else if (inv.kind === 'phone') {
              sends.push(inviteEventGuestByPhone(evId, inv.name, inv.sms));
            }
          }
          if (genLink) sends.push(mintEventLink(evId));
          const settled = await Promise.allSettled(sends);
          settled.forEach((r) => { if (r.status === 'rejected') console.error('event invite:', r.reason); });
        }
        // In-kind donation offer: record it for the routing desk + the
        // donor's private My-giving dashboard. Fire-and-forget — the post
        // never fails over the record; pre-migration this quietly no-ops.
        // ⚠ Gate on modes, not evMode — evMode only tracks EVENT mode picks,
        // so the old evMode check meant a ticked box never filed a row
        // (found 2026-10-02; no live rows were affected).
        if (isMarket && modes.has('lichen') && inkind && created?.id && user) {
          void supabase.from('inkind_donations').insert({
            donor_profile_id: user.id,
            post_id: created.id,
            kind: inkindKind,
            description: title.trim() || body.trim().slice(0, 140)
              || (inkindKind === 'services' ? 'Donated services' : 'Donated item'),
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
      // The post holds the words now — the draft's job is done. postedRef
      // also stands the pagehide flush down, so navigating away from a
      // successful post can't resurrect the row (the WowIntake lesson).
      postedRef.current = true;
      if (hadDraft.current) void deletePostDraft(draftIdRef.current).catch(console.error);
      if (isPopup) window.close();
      // A new EVENT lands on its own page — the guest panel is right there
      // (phone invites' Text › buttons, the shareable link, the RSVP tab).
      navigate(isEvent && createdId ? `/events/${createdId}` : afterPostDestination(isEvent));
    } catch (e) {
      setBusy(false);
      const msg = (e as Error)?.message || '';
      setError(/posts_slug_per_owner|duplicate key/i.test(msg)
        ? 'That link name is already on one of your posts — pick another.'
        : msg || 'Couldn’t post. Please try again.');
    }
  }

  if (loading || !editReady) return <div className="cmp"><p className="cmp__muted">Loading…</p></div>;

  return (
    <div className="cmp">
      {/* The way back lives in the TopBar's arrow now (useTopBackFor above).
          The chip stands only in a pop-up, where Back means "never mind —
          close this window". */}
      {isPopup && (
        <button
          className="cmp__back"
          onClick={() => window.close()}
        >
          <Icon name="arrow-left" size={14} /> Back
        </button>
      )}
      <header className="cmp__head">
        <h1 className="cmp__title">{editing ? (isEvent ? 'Edit event' : 'Edit post') : (isEvent ? 'New event' : 'New post')}</h1>
        <p className="cmp__sub">
          {editing
            ? 'Changes save in place — guests keep their RSVPs.'
            : isEvent
              ? 'Invite people on (and off) Lichen — your My-celium, or specific members, communities, groups, organizations and places.'
              : 'Share with the whole network, or just your My-celium.'}
        </p>
      </header>

      {/* THE BRAIN AT THE TOP OF THE EVENT BUILDER (founder 2026-11-09:
          "the brain should be at the top of manual event building so you can
          switch to ai to give instructions mid build"): the Calendar-settings
          toggle — Edit with AI saves the draft and hands Claude a summary of
          everything built so far (the Claude-to-Claude hand-off note). */}
      {isEvent && !editing && actor.type !== 'space' && (
        aiDoorOn('events') ? (
          <div className="view-toggle-row cset__moderow cmp__moderow">
            <span className="view-toggle" role="group" aria-label="How to build this event">
              <button type="button" className="view-toggle__side is-on">Build manually</button>
              <button type="button" className="view-toggle__side" onClick={() => void editEventWithAi()}>Edit with AI</button>
            </span>
          </div>
        ) : (
          <div className="cmp__moderow cmp__moderow--off"><AssistantDoor section="events" /></div>
        )
      )}

      {error && <p className="cmp__error">{error}</p>}

      {/* The context receipt for a collection publish: what this post will
          carry. The card people meet opens the whole collection. */}
      {publishingCollection && (
        <p className="cmp__collection-banner">
          <Icon name="book" size={13} /> Publishing your collection{' '}
          <strong>{publishingCollection.name}</strong> — {publishingCollection.count}{' '}
          {publishingCollection.count === 1 ? 'piece' : 'pieces'}. This post is
          its door: wherever it lands, tapping it opens the whole collection.
        </p>
      )}

      {actor.type === 'space' && (
        <p className="cmp__acting">
          <span className="cmp__acting-avatar" style={{ background: colorFor(actor.id) }}>{monogramFor(actor.name)}</span>
          Posting as <strong>{actor.name}</strong>
        </p>
      )}

      {/* NON-EVENT posts keep the Audience fold. EVENTS merge Audience +
          invites into ONE "Who's invited?" section (founder 2026-11-04:
          "Audience and who's invited have enough overlap that we just have
          'Who's Invited'… Then visibility can be its own section") with
          Visibility — Open vs Invite-only — below it. */}
      {!isEvent && (<>
      <label className="cmp__label">Audience</label>
      <button className="cmp__input cmp__where-btn" onClick={() => setAudOpen((o) => !o)} aria-expanded={audOpen}>
        {hasAudience ? (
          <span className="cmp__where-sel">
            {[
              ...(isPublic ? ['Everyone'] : []),
              ...(toMycelium ? ['My-celium'] : []),
              ...mySpaces.filter((sp) => audienceSpaces.has(sp.id)).map((sp) => sp.name),
            ].map((name) => (
              <span key={name} className="cmp__where-tag">{name}</span>
            ))}
          </span>
        ) : (
          <span className="cmp__where-none">Nobody yet — pick an audience</span>
        )}
        <span className={'cmp__where-caret' + (audOpen ? ' is-open' : '')}><Icon name="chevron-right" size={14} /></span>
      </button>
      {audOpen && (<div className="cmp__aud-drop">
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
      </div>)}
      </>)}

      {/* WHO'S INVITED — the one section for events (founder 2026-11-04):
          typed people (members / email / phone), whole circles, the
          shareable link. VISIBILITY sits under it as its own choice — Open
          (anyone on Lichen can find & RSVP) vs Invite-only (only the people
          and circles invited can see the event at all; the posts RLS
          attendee arm + the 'invite' legacy value carry it). On an EDIT,
          people are managed on the event page's guest panel; circles and
          visibility still edit here. */}
      {isEvent && (() => {
        const q = invQ.trim();
        const contact = q ? classifyInviteLine(q) : { kind: 'other' as const };
        const spaceHits = q.length >= 2
          ? mySpaces.filter((sp) => !audienceSpaces.has(sp.id)
              && sp.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3)
          : [];
        const memberHits = invHits.filter((h) => !invitees.some((i) => i.kind === 'member' && i.id === h.id));
        // Your saved guest lists answer the same box (founder 2026-11-06:
        // "the type ahead for audiences … should include your lists").
        const listHits = q.length >= 2
          ? guestLists.filter((g) => g.name.toLowerCase().includes(q.toLowerCase())).slice(0, 3)
          : [];
        const ikey = (x: EvInvitee) => x.kind === 'member' ? `m:${x.id}` : `${x.kind}:${x.value}`;
        // Either/or pickers (founder 2026-11-04): a subset under Everyone is
        // a contradictory command — the LAST click wins, in both directions.
        const pickEvLichen = (on: boolean) => {
          setEvLichen(on);
          if (on) { setToMycelium(false); setAudienceSpaces(new Set()); setEvAnyone(false); }
        };
        const pickEvAnyone = (on: boolean) => {
          setEvAnyone(on);
          if (on) setEvLichen(false);
        };
        const pickMycelium = (on: boolean) => {
          setToMycelium(on);
          if (on) setEvLichen(false);
        };
        const pickCircle = (id: string) => {
          if (!audienceSpaces.has(id)) setEvLichen(false);
          toggleSpace(id);
        };
        // ONE chips row, color-coded (founder 2026-11-04: "peach for on
        // lichen and gray for phone numbers, etc"): member chips PEACH,
        // email/phone chips GRAY. Removal is by identity, never index.
        const chip = (inv: EvInvitee) => (
          <span key={ikey(inv)} className={'cmp__invchip' + (inv.kind === 'member' ? '' : ' cmp__invchip--off')}>
            <Icon name={inv.kind === 'member' ? 'profile' : inv.kind === 'email' ? 'send' : 'phone'} size={12} />
            {inv.kind === 'member' ? inv.name : (inv.name ? `${inv.name} · ${inv.value}` : inv.value)}
            <button className="cmp__invchip-x" aria-label="Remove"
              onClick={() => setInvitees((cur) => cur.filter((x) => ikey(x) !== ikey(inv)))}>×</button>
          </span>
        );
        // GROUPED BY WHERE THEY CAME FROM (founder 2026-11-08): each list or
        // trimmed circle is a header with a carrot; its people sit indented
        // under it. One group stands open; several fold shut (tap to open).
        const chipRow = (list: EvInvitee[]) => {
          if (editing || list.length === 0) return null;
          const order: string[] = [];
          const bySrc: Record<string, EvInvitee[]> = {};
          const loose: EvInvitee[] = [];
          for (const inv of list) {
            const src = invSrc[ikey(inv)];
            if (!src) { loose.push(inv); continue; }
            if (!bySrc[src]) { bySrc[src] = []; order.push(src); }
            bySrc[src].push(inv);
          }
          const glOpen = order.filter((src) => src.startsWith('gl:') && (srcOpen[src] ?? order.length === 1));
          return (
            <div className="cmp__invlist">
              {order.map((src) => {
                const open = srcOpen[src] ?? order.length === 1;
                const people = bySrc[src];
                // A SAVED LIST's header IS its chip above (founder 2026-11-08:
                // "we don't need to list it twice, put the arrow to the right
                // in the box") — only its people render here, indented.
                if (src.startsWith('gl:')) {
                  if (!open) return null;
                  const editingThis = glEditing === src.slice(3);
                  return (
                    <div className="cmp__invsrc" key={src}>
                      {glOpen.length > 1 && <span className="cmp__invsrc-lbl">{srcNames[src] ?? 'List'}</span>}
                      <div className="cmp__invchips cmp__invchips--sub">
                        {people.map(chip)}
                        {editingThis && (
                          <button className="cmp__invadd" aria-label={`Add someone to ${srcNames[src] ?? 'this list'}`}
                            data-tip="Add someone"
                            onClick={() => { invInputRef.current?.focus(); invInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }}>
                            <span aria-hidden="true">+</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="cmp__invsrc" key={src}>
                    <div className="cmp__invsrc-head">
                      <button className={'cmp__invsrc-fold' + (open ? ' is-open' : '')} aria-expanded={open}
                        onClick={() => setSrcOpen((o) => ({ ...o, [src]: !open }))}>
                        <Icon name="chevron-right" size={12} />
                        <Icon name="user-multiple" size={13} />
                        <span>{srcNames[src] ?? 'List'}</span>
                        <span className="cmp__gl-n">{people.length}</span>
                      </button>
                      <button className="cmp__invchip-x" aria-label={`Remove everyone from ${srcNames[src] ?? 'this list'}`}
                        onClick={() => setInvitees((cur) => cur.filter((x) => invSrc[ikey(x)] !== src))}>×</button>
                    </div>
                    {open && <div className="cmp__invchips cmp__invchips--sub">{people.map(chip)}</div>}
                  </div>
                );
              })}
              {loose.length > 0 && <div className="cmp__invchips">{loose.map(chip)}</div>}
            </div>
          );
        };
        return (
          <>
            <label className="cmp__label">Who&rsquo;s invited?</label>
            {!editing ? (
              <p className="cmp__hint-ev cmp__hint-ev--inv">Type a member&rsquo;s name, an email or a phone number — or invite whole circles below.</p>
            ) : (
              <p className="cmp__hint-ev">People are invited from the event page&rsquo;s guest panel — circles and visibility still edit here.</p>
            )}
            {!editing && (<>
            <input ref={invInputRef} className="cmp__input" value={invQ} onChange={(e) => setInvQ(e.target.value)}
              placeholder={glEditing ? `Add to ${guestLists.find((g) => g.id === glEditing)?.name ?? 'the list'} — name, email or phone` : 'Name, circle, email or phone'}
              autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            {(memberHits.length > 0 || spaceHits.length > 0 || listHits.length > 0 || contact.kind === 'email' || contact.kind === 'phone') && (
              <div className="cmp__invsug">
                {/* A typed email/phone that belongs to a member files them
                    under ON LICHEN — a seated invite, not a blind guest row
                    (founder 2026-11-04). The raw rows stay as the fallback. */}
                {invContactHit && !invitees.some((i) => i.kind === 'member' && i.id === invContactHit.id) && (
                  <button className="cmp__invsug-row" onClick={() => addInvitee({ kind: 'member', id: invContactHit.id, name: invContactHit.full_name ?? 'A member' })}>
                    <Icon name="profile" size={14} /> <strong>{invContactHit.full_name ?? 'A member'}</strong> · that&rsquo;s a member — invite them on Lichen
                  </button>
                )}
                {contact.kind === 'email' && (
                  <button className="cmp__invsug-row" onClick={() => addInvitee({ kind: 'email', value: contact.email, name: contactLineName(q) })}>
                    <Icon name="send" size={14} /> Email the invitation to <strong>{contact.email}</strong>{invContactHit ? ' · as an off-Lichen guest instead' : ''}
                  </button>
                )}
                {contact.kind === 'phone' && (
                  <button className="cmp__invsug-row" onClick={() => addInvitee({ kind: 'phone', value: contact.digits, sms: contact.sms, name: contactLineName(q) })}>
                    <Icon name="phone" size={14} /> Text the invitation to <strong>{q}</strong>{invContactHit ? ' · as an off-Lichen guest instead' : ''}
                  </button>
                )}
                {memberHits.map((h) => (
                  <button key={h.id} className="cmp__invsug-row" onClick={() => addInvitee({ kind: 'member', id: h.id, name: h.full_name ?? 'A member' })}>
                    <Icon name="profile" size={14} /> <strong>{h.full_name ?? 'A member'}</strong> · on Lichen
                  </button>
                ))}
                {listHits.map((g) => (
                  <button key={g.id} className="cmp__invsug-row" onClick={() => { applyGuestList(g); setInvQ(''); }}>
                    <Icon name="user-multiple" size={14} /> <strong>{g.name}</strong> · your guest list — adds {g.entries.length + g.space_ids.length}
                  </button>
                ))}
                {spaceHits.map((sp) => (
                  <button key={sp.id} className="cmp__invsug-row" onClick={() => { pickCircle(sp.id); setInvQ(''); }}>
                    <Icon name="user-multiple" size={14} /> <strong>{sp.name}</strong> · invites this {sp.kind}
                  </button>
                ))}
              </div>
            )}
            </>)}

            {/* ONE BLENDED LIST (founder 2026-11-04, superseding the same
                day's On|Off Lichen groups: "the audience UI can be
                simplified by blending on and off lichen? peach for on
                lichen and gray for phone numbers"): chips color-code the
                boundary — PEACH = on Lichen (members), GRAY = off-Lichen
                (emails/phones) — over one checkbox ladder, Anyone →
                Everyone on Lichen → My-celium → circles. The EITHER/OR
                pickers stand (a subset under Everyone is a contradiction,
                last click wins; circles coexist with My-celium and with
                Anyone). The shareable link INHERITS whatever the ladder
                says — the Drive-tier rule, no second setting. */}
            <div className="cmp__invgroup">
            {!editing && (<>
            {guestLists.length > 0 && (
              <div className="cmp__gl">
                <span className="cmp__gl-lbl">Your guest lists</span>
                {guestLists.map((gl) => (
                  <span key={gl.id} className={'cmp__gl-chip' + (invitees.some((x) => invSrc[ikey(x)] === `gl:${gl.id}`) ? ' is-on' : '')}>
                    <button className="cmp__gl-use" onClick={() => (invitees.some((x) => invSrc[ikey(x)] === `gl:${gl.id}`)
                      ? setInvitees((cur) => cur.filter((x) => invSrc[ikey(x)] !== `gl:${gl.id}`))
                      : applyGuestList(gl))}>
                      <Icon name="user-multiple" size={12} /> {gl.name}
                      <span className="cmp__gl-n">{invitees.some((x) => invSrc[ikey(x)] === `gl:${gl.id}`)
                        ? invitees.filter((x) => invSrc[ikey(x)] === `gl:${gl.id}`).length
                        : gl.entries.length + gl.space_ids.length}</span>
                    </button>
                    {invitees.some((x) => invSrc[ikey(x)] === `gl:${gl.id}`) && (() => {
                      const src = `gl:${gl.id}`;
                      const glCount = new Set(invitees.map((x) => invSrc[ikey(x)]).filter((v) => v?.startsWith('gl:') || v?.startsWith('sp:'))).size;
                      const open = srcOpen[src] ?? glCount === 1;
                      return (
                        <button className={'cmp__gl-fold' + (open ? ' is-open' : '')} aria-expanded={open}
                          aria-label={open ? `Hide who's on ${gl.name}` : `Show who's on ${gl.name}`}
                          onClick={() => setSrcOpen((o) => ({ ...o, [src]: !open }))}>
                          <Icon name="chevron-right" size={12} />
                        </button>
                      );
                    })()}
                    <button className={'cmp__gl-x' + (glDel === gl.id ? ' is-armed' : '')}
                      aria-label={`Delete ${gl.name}`} onClick={() => void deleteGuestList(gl.id)}>
                      {glDel === gl.id ? 'Delete?' : '×'}
                    </button>
                  </span>
                ))}
              </div>
            )}
            </>)}
              {chipRow(invitees)}
              {!editing && (invitees.length > 0 || audienceSpaces.size > 0) && (() => {
                // ONE LIST ON SCREEN = THAT LIST, NOT A NEW ONE (founder
                // 2026-11-08): when every chip came from a single saved list,
                // the foot says so and offers Rename — or Update when the
                // people changed — instead of "Save these people" again.
                const srcs = new Set(invitees.map((x) => invSrc[ikey(x)] ?? ''));
                const only = srcs.size === 1 ? [...srcs][0] : '';
                const gl = only.startsWith('gl:') ? guestLists.find((g) => `gl:${g.id}` === only) : undefined;
                const same = !!gl && gl.entries.length === invitees.length
                  && gl.entries.every((e) => invitees.some((x) => ikey(x) === ikey(e)));
                if (glRenaming && gl && glRenaming === gl.id) return (
                  <div className="cmp__gl-save">
                    <input className="cmp__input" value={glName} autoFocus maxLength={80}
                      onChange={(e) => setGlName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void renameGuestList(gl.id); } }}
                      placeholder={gl.name} />
                    <button className="cmp__gl-savebtn" disabled={!glName.trim()} onClick={() => void renameGuestList(gl.id)}>Rename</button>
                    <button className="cmp__gl-cancel" aria-label="Cancel" onClick={() => { setGlRenaming(null); setGlName(''); }}>×</button>
                  </div>
                );
                if (gl && glEditing === gl.id) return (
                  <p className="cmp__gl-saved">
                    <>Editing your guest list <strong>{gl.name}</strong> — changes save to the list everywhere it&rsquo;s used</>
                    <button className="cmp__gl-link cmp__gl-link--go" onClick={() => setGlEditing(null)}>Done</button>
                  </p>
                );
                if (gl && !glSaving) return (
                  <p className="cmp__gl-saved">
                    {same
                      ? <>Saved as your guest list <strong>{gl.name}</strong> ✓</>
                      : <>Changed from your guest list <strong>{gl.name}</strong></>}
                    {!same && (
                      <button className="cmp__gl-link" onClick={() => void updateGuestList(gl, invitees)}>Update the list</button>
                    )}
                    <button className="cmp__gl-link" onClick={() => { setGlRenaming(gl.id); setGlName(''); setGlMsg(null); }}>Rename</button>
                    {same && (
                      <button className="cmp__gl-link" onClick={() => {
                        setGlEditing(gl.id); setGlMsg(null);
                        setSrcOpen((o) => ({ ...o, [`gl:${gl.id}`]: true }));
                      }}>Edit</button>
                    )}
                    {!same && (
                      <button className="cmp__gl-link" onClick={() => { setGlSaving(true); setGlMsg(null); }}>Save as a new list</button>
                    )}
                  </p>
                );
                return glSaving ? (
                  <div className="cmp__gl-save">
                    <input className="cmp__input" value={glName} autoFocus maxLength={80}
                      onChange={(e) => setGlName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveGuestList(); } }}
                      placeholder="Name this list — e.g. Solstice regulars" />
                    <button className="cmp__gl-savebtn" disabled={!glName.trim()} onClick={() => void saveGuestList()}>Save</button>
                    <button className="cmp__gl-cancel" aria-label="Cancel" onClick={() => { setGlSaving(false); setGlName(''); }}>×</button>
                  </div>
                ) : (
                  <button className="cmp__gl-open" onClick={() => { setGlSaving(true); setGlMsg(null); }}>
                    ⊕ Save these people as a guest list
                  </button>
                );
              })()}
              {!editing && glMsg && <p className="cmp__gl-msg">{glMsg}</p>}
              {/* The rungs wear the circles' small-caps eyebrow (founder
                  2026-11-05: "a soft indicator that we're now talking
                  Lichen audiences"). */}
              {/* ANYONE ISN'T LICHEN (founder 2026-11-06, drawing it above
                  the eyebrow): the open web leads on its own; Lichen's two
                  rungs are All and My-celium. */}
              <label className="cmp__evrow">
                <input type="checkbox" checked={evAnyone} onChange={(e) => pickEvAnyone(e.target.checked)} />
                <span><strong>Anyone</strong> — the open web, on Lichen or off.</span>
              </label>
              <span className="cmp__aud-kind cmp__aud-kind--lichen">Lichen</span>
              <label className="cmp__evrow">
                <input type="checkbox" checked={evLichen} onChange={(e) => pickEvLichen(e.target.checked)} />
                <span><strong className="cmp__onlichen">All</strong> — every member can find it and RSVP; never the open web.</span>
              </label>
              <label className="cmp__evrow">
                <input type="checkbox" checked={toMycelium} onChange={(e) => pickMycelium(e.target.checked)} />
                <span><strong className="cmp__onlichen">My-celium</strong> — everyone in your web.</span>
              </label>
              <div className="cmp__aud-groups">
                {([['community', 'Communities'], ['group', 'Groups'], ['organization', 'Organizations'], ['place', 'Places']] as const)
                  .map(([kind, label]) => {
                    const of = mySpaces.filter((sp) => sp.kind === kind);
                    if (!of.length) return null;
                    return (
                      <div className="cmp__aud-group" key={kind}>
                        <span className="cmp__aud-kind">{label}</span>
                        {of.map((sp) => (
                          <div key={sp.id}>
                            <div className="cmp__aud-rowwrap">
                              <label className="cmp__aud-row">
                                <input type="checkbox" checked={audienceSpaces.has(sp.id)}
                                  onChange={() => pickCircle(sp.id)} />
                                <span>{sp.name}</span>
                              </label>
                              {audienceSpaces.has(sp.id) && !editing && (
                                <button className={'cmp__aud-peek' + (circleOpen === sp.id ? ' is-open' : '')}
                                  aria-expanded={circleOpen === sp.id} onClick={() => void openCircle(sp.id)}>
                                  Who <Icon name="chevron-right" size={11} />
                                </button>
                              )}
                            </div>
                            {circleOpen === sp.id && (() => {
                              const ms = circleMembers[sp.id];
                              if (ms === 'loading' || !ms) return <p className="cmp__aud-peeknote">Gathering who&rsquo;s in it…</p>;
                              if (!ms.length) return <p className="cmp__aud-peeknote">Nobody else is in this {sp.kind} yet.</p>;
                              if (ms.length > 150) return <p className="cmp__aud-peeknote">{ms.length} people — too many to trim one by one here.</p>;
                              return (
                                <div className="cmp__aud-peek-list">
                                  <p className="cmp__aud-peeknote">Taking someone off turns this {sp.kind} into individual invitations — everyone else stays invited.</p>
                                  <div className="cmp__invchips cmp__invchips--sub">
                                    {ms.map((m) => (
                                      <span key={m.id} className="cmp__invchip">
                                        <Icon name="profile" size={12} /> {m.name}
                                        <button className="cmp__invchip-x" aria-label={`Leave ${m.name} out`}
                                          onClick={() => trimCircle(sp, m.id)}>×</button>
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    );
                  })}
              </div>
              {!editing && (<>
              {/* THE LINK WEARS THE AUDIENCE'S TIER (founder 2026-11-04:
                  "generating a link would auto apply the restrictions of
                  audience to the link" — the Google Drive ladder): the copy
                  states the derived tier live; request_event_spot enforces
                  it off the post's visibility server-side. */}
              <label className="cmp__evrow cmp__genlink">
                <input type="checkbox" checked={genLink} onChange={(e) => setGenLink(e.target.checked)} />
                <span>
                  <strong>Generate a shareable link</strong> — it follows whoever
                  you picked above: {evAnyone
                    ? 'open to anyone — whoever opens it can RSVP straight away.'
                    : evLichen
                      ? 'members RSVP right away inside Lichen; anyone off Lichen asks to come and waits for your yes.'
                      : 'people on your invite list RSVP straight away; anyone else asks to come and waits for your yes.'}
                </span>
              </label>
              {invitees.some((i) => i.kind === 'phone') && (
                <p className="cmp__hint-ev">Phone invites are prepared here — after posting, tap <strong>Text ›</strong> beside each name on the event page to send from your own Messages.</p>
              )}
              </>)}
            </div>
            {!hasAudience && (
              <p className="cmp__hint-ev">Nothing picked yet — check a box or invite someone before this event goes live.</p>
            )}
            {(() => {
              const evTitle = title.trim() || body.trim().slice(0, 60) || 'Your event';
              // The SAME location line the event row stores (publish's effLocation)
              // — the preview never shows something prettier than the real mail.
              const where = inPerson && location.trim() ? location.trim()
                : online && meetingUrl.trim() ? meetingUrl.trim()
                : evZoom && zoomOk ? 'Zoom' : location.trim();
              const photo = media.find((m) => m.type === 'photo')?.url ?? null;
              const photos = media.filter((m) => m.type === 'photo').map((m) => m.url);
              const when = inviteWhen(evRange.start ?? '', evAllDay, evStartMin);
              const sendTest = async () => {
                setInvTest({ state: 'sending' });
                const { data, error } = await supabase.functions.invoke('send-event-invite', {
                  body: { test: { title: evTitle, start_date: evRange.start, all_day: evAllDay, start_min: evAllDay ? null : evStartMin, location: where, photo, invite: { ...(inviteDesign ?? { template: 'classic' }), cardPhoto: invitePhotos(inviteDesign, photos).card ?? 'none' } } },
                });
                const d = data as { ok?: boolean; to?: string; error?: string } | null;
                if (error || !d?.ok) setInvTest({ state: 'error', msg: d?.error ?? 'The test didn’t send — try again in a moment.' });
                else setInvTest({ state: 'sent', msg: d.to });
              };
              return (
                <div className="cmp__invprev">
                  <label className="cmp__label">The invitation</label>
                  <p className="cmp__hint-ev">What your guests receive — by email, and on their invitation link, where it arrives in an envelope. <strong>Edit design</strong> picks a template, the words, colours and envelope.</p>
                  <div className="cmp__invstage">
                    <InviteCard design={inviteDesign} facts={{ title: evTitle, when, where, host: hostName || 'you', photo, photos }} />
                  </div>
                  <div className="cmp__invtest">
                    <button type="button" className="cmp__invtest-btn" onClick={() => setPreviewOpen(true)}>
                      <Icon name="rsvp" size={14} /> Preview
                    </button>
                    <button type="button" className="cmp__invtest-btn" onClick={() => setStudioOpen(true)}>
                      <Icon name="palette" size={14} /> Edit design
                    </button>
                    <button type="button" className="cmp__invtest-btn" onClick={() => void sendTest()}
                      disabled={invTest.state === 'sending' || !evRange.start}>
                      <Icon name="send" size={14} /> {invTest.state === 'sending' ? 'Sending…' : invTest.state === 'sent' ? 'Send another test' : 'Send me a test'}
                    </button>
                    {invTest.state === 'sent' && <span className="cmp__invtest-note">Sent to {invTest.msg} ✓ — only you.</span>}
                    {invTest.state === 'error' && <span className="cmp__invtest-note cmp__invtest-note--err">{invTest.msg}</span>}
                  </div>
                  {studioOpen && (
                    <InviteStudio design={inviteDesign} facts={{ title: evTitle, when, where, host: hostName || 'you', photo, photos }}
                      uploaderId={user?.id}
                      onClose={() => setStudioOpen(false)}
                      onDone={(dz) => { setInviteDesign(dz); setStudioOpen(false); setInvTest({ state: 'idle' }); }} />
                  )}
                  {previewOpen && (
                    <InvitePreview design={inviteDesign} facts={{ title: evTitle, when, where, host: hostName || 'you', photo, photos }}
                      onClose={() => setPreviewOpen(false)} />
                  )}
                  {!editing && invitees.some((i) => i.kind === 'email') && (
                    <div className="cmp__invsched">
                      <label className="cmp__label">When the emails go out</label>
                      <label className="cmp__invsched-opt">
                        <input type="radio" checked={!invSendAt} onChange={() => setInvSendAt('')} /> Right when I post
                      </label>
                      <label className="cmp__invsched-opt">
                        <input type="radio" checked={!!invSendAt}
                          onChange={() => { const t = new Date(Date.now() + 86_400_000); t.setMinutes(0, 0, 0);
                            setInvSendAt(new Date(t.getTime() - t.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)); }} /> At a time I pick
                        {invSendAt && (
                          <input type="datetime-local" className="cmp__invsched-at" value={invSendAt}
                            onChange={(e) => setInvSendAt(e.target.value)} />
                        )}
                      </label>
                      {invSendAt && <p className="cmp__hint-ev">Emailed invitations wait for that moment. Texts are yours to send — tap <strong>Text ›</strong> on the event page when you’re ready.</p>}
                    </div>
                  )}
                  {editing
                    ? <p className="cmp__hint-ev">A new design reaches everyone who opens their invitation link once you save. Emails already sent keep the card they went out with.</p>
                    : <p className="cmp__hint-ev">Your guests are only invited when you press <strong>Post</strong>. Not ready? <strong>Save draft</strong> keeps the event, its design and your guest list together.</p>}
                </div>
              );
            })()}
          </>
        );
      })()}


      {/* WHERE is the one driver (founder 2026-11-04, retiring the
          Social|Actionable fork as redundant): no areas = a feed story,
          any area = actionable — the terms machinery reveals itself. */}
      <label className="cmp__label">Where</label>
      <button className="cmp__input cmp__where-btn" onClick={() => setWhereOpen((o) => !o)} aria-expanded={whereOpen}>
        {areas.size === 0 ? <span className="cmp__where-none">Just the feeds — a social story</span> : (
          <span className="cmp__where-sel">
            {SERVICE_AREAS.filter((a) => areas.has(a.value) || (a.value === 'marketplace' && marketAuto)).map((a) => (
              <span key={a.value} className="cmp__where-tag"><Icon name={a.icon} size={12} /> {a.label}</span>
            ))}
          </span>
        )}
        <span className={'cmp__where-caret' + (whereOpen ? ' is-open' : '')}><Icon name="chevron-right" size={14} /></span>
      </button>
      {(() => {
        const others = SERVICE_AREAS.filter((a) => a.value !== 'marketplace' && areas.has(a.value)).map((a) => a.label);
        const inMkt = areas.has('marketplace');
        const hint = marketAuto
          ? `Lives in ${others.join(' and ')} \u2014 and because it\u2019s paid, it lists in Marketplace too.`
          : inMkt && others.length
          ? `In Marketplace, plus ${others.join(' and ')}.`
          : inMkt
          ? 'In Marketplace \u2014 check Courses, Events, or others to shelve this there too.'
          : others.length
          ? `Lives in ${others.join(' and ')}. Mark it paid and it lists in Marketplace too.`
          : 'Pick an area to make this actionable \u2014 an offer, an event, a listing.';
        return <p className="cmp__hint cmp__where-hint">{hint}</p>;
      })()}
      {whereOpen && (
        <div className="cmp__where-list">
          {SERVICE_AREAS.map((a) => (
            <label key={a.value} className="cmp__where-row">
              <input
                type="checkbox"
                checked={areas.has(a.value) || (a.value === 'marketplace' && marketAuto)}
                onChange={() => toggleArea(a.value)}
                disabled={(editing && a.value === 'events' && areas.has('events') && !!editLinkedEvent.current)
                  || (a.value === 'marketplace' && marketAuto)}
              />
              <Icon name={a.icon} size={14} /> {a.label}
              {a.value === 'marketplace' && marketAuto && <span className="cmp__label-soft"> — added because it&rsquo;s paid</span>}
            </label>
          ))}
        </div>
      )}

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

      {isLibrary && (
        <>
          <label className="cmp__label" htmlFor="cmp-resource">Link to an external resource (optional)</label>
          <input
            id="cmp-resource" className="cmp__input" type="url" inputMode="url"
            value={resourceUrl} onChange={(e) => setResourceUrl(e.target.value)}
            placeholder="https://…"
          />
          <p className="cmp__hint-ev">
            Hosted outside Lichen — we’ll show a preview card and link straight out.
          </p>
        </>
      )}

      <label className="cmp__label" htmlFor="cmp-title">Title (optional)</label>
      <input id="cmp-title" className="cmp__input" value={title}
        onChange={(e) => setTitle(e.target.value)} placeholder="A short headline" />

      {/* VANITY LINK (founder 2026-11-04): a sendable address for this post —
          the booking link-name grammar on every section. Identifier field, so
          it declines autocorrect; slugify is the one sanitizer. */}
      {isActionable && (() => {
        const AREA_ROUTE: Record<string, string> = {
          marketplace: 'market', events: 'events', travel: 'travel',
          courses: 'courses', library: 'library', art: 'art', food: 'food',
          work: 'work', places: 'market',
        };
        const first = [...areas][0] ?? 'marketplace';
        const word = AREA_ROUTE[first] ?? 'market';
        return (
          <>
            <label className="cmp__label" htmlFor="cmp-linkname">Link name (optional)</label>
            <input id="cmp-linkname" className="cmp__input" value={linkName}
              onChange={(e) => setLinkName(slugify(e.target.value))}
              placeholder="e.g. review-zion"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            <p className="cmp__hint-ev">
              {linkName
                ? (ownHandle
                  ? <>Shareable at <strong>lichen.health/{word}/{ownHandle}/{linkName}</strong></>
                  : <>Needs an address first — set your handle in Profile → Public page (or just ask the brain).</>)
                : <>A sendable address — lichen.health/{word}/«your-handle»/«link-name».</>}
            </p>
          </>
        );
      })()}

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

      <input ref={photoRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => void onFile(e, 'photo')} />
      <input ref={videoRef} type="file" accept="video/*" hidden onChange={(e) => void onFile(e, 'video')} />

      {uploading && <p className="cmp__uploading">Uploading…</p>}
      {media.length > 0 && (
        <div className="cmp__attached" ref={attachedRef}>
          {media.map((m, i) => (
            <div
              key={m.url}
              className={'cmp__attached-item'
                + (media.length > 1 ? ' cmp__attached-item--drag' : '')
                + (dragUrl === m.url ? ' is-dragging' : '')}
              onPointerDown={(e) => dragPointerDown(e, m.url)}
              onPointerMove={dragPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onDragStart={(e) => e.preventDefault()}
            >
              {m.type === 'photo' && <img src={m.url} alt="attachment" draggable={false} />}
              {m.type === 'video' && <video src={m.url} muted />}
              {m.type === 'audio' && <span className="cmp__attached-audio"><Icon name="mic" size={14} /> Audio clip</span>}
              <button className="cmp__attached-remove" onClick={() => removeMedia(i)} aria-label="Remove">×</button>
              {media.length > 1 && i === 0 && <span className="cmp__attached-covertag">Cover</span>}
              {media.length > 1 && (
                <div className="cmp__attached-order">
                  <button onClick={() => moveMedia(i, -1)} disabled={i === 0} aria-label="Move earlier">‹</button>
                  <button onClick={() => moveMedia(i, 1)} disabled={i === media.length - 1} aria-label="Move later">›</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {isActionable && (
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
              if (m === 'free') {
                const parts = [forIdents.length ? `to ${forIdents.join(', ')}` : '', giftTo.trim() ? (forIdents.length ? `— ${giftTo.trim()}` : `to ${giftTo.trim()}`) : ''].filter(Boolean);
                return parts.length ? parts.join(' ') : 'freely, to anyone';
              }
              if (m === 'trade') return tradeFor.trim() ? `for ${tradeFor.trim()}` : 'open to offers';
              if (m === 'paid') {
                const unit = effPriceUnit();
                const suffix = unit ? ` per ${unit}` : '';
                if (sliding) return `sliding scale ${slideLow.trim() || '?'}–${slideHigh.trim() || '?'}${suffix}`;
                if (!price.trim()) return 'price to discuss';
                return /\bper\s+[\w -]+\s*$/i.test(price) ? price.trim() : price.trim() + suffix;
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
                            {/* per [unit ▾] + optional count ("per 3 days"),
                                then sliding AFTER the per (founder 2026-10-02,
                                three passes in one sitting). */}
                            <select
                              className="cmp__term-unit" value={unitSel} aria-label="Price unit"
                              onChange={(e) => setUnitSel(e.target.value)}
                            >
                              <option value="">total</option>
                              <option value="hour">per hour</option>
                              <option value="day">per day</option>
                              <option value="week">per week</option>
                              <option value="month">per month</option>
                              <option value="session">per session</option>
                              <option value="other">per …</option>
                            </select>
                            {unitSel !== '' && unitSel !== 'other' && (
                              <input
                                className="cmp__term-input cmp__term-qty" inputMode="numeric"
                                value={unitQty} placeholder="1" aria-label="How many"
                                title="How many — e.g. 3 makes it per 3 days"
                                onChange={(e) => setUnitQty(e.target.value.replace(/\D/g, '').slice(0, 3))}
                              />
                            )}
                            {unitSel === 'other' && (
                              <input
                                className="cmp__term-input cmp__term-unittext" value={unitText}
                                placeholder="what? e.g. class" aria-label="Per what"
                                onChange={(e) => setUnitText(e.target.value)}
                              />
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
                      {' '}Donate it to Lichen — your donation receipt follows when a steward accepts
                    </label>
                    {inkind && (
                      <div className="cmp__inkind-kind">
                        <div className="cmp__inkind-pick">
                          <label className="cmp__sliding">
                            <input type="radio" name="inkind-kind" checked={inkindKind === 'goods'}
                              onChange={() => setInkindKind('goods')} /> Goods
                          </label>
                          <label className="cmp__sliding">
                            <input type="radio" name="inkind-kind" checked={inkindKind === 'services'}
                              onChange={() => setInkindKind('services')} /> Services
                          </label>
                        </div>
                        {inkindKind === 'goods' ? (
                          <p className="cmp__hint-ev">
                            Donated goods are tax-deductible. Like Goodwill&rsquo;s, the
                            receipt describes what you gave without pricing it — fair
                            market value is yours to determine for your records.
                          </p>
                        ) : (
                          <p className="cmp__hint-ev">
                            An honest note: the IRS doesn&rsquo;t allow a deduction for the
                            value of your time. What may be deductible are your
                            out-of-pocket costs of providing donated services —
                            supplies, travel, space rented just for these sessions —
                            and the receipt describing your donated services is the
                            written acknowledgment the IRS asks for to claim them.
                          </p>
                        )}
                      </div>
                    )}
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

          {isTravel && !isEvent && (<>
            {/* TRAVEL FACTS (founder 2026-10-06): the exchange between private
                citizens who drive cars, trucks, airplanes and helicopters —
                and the companies that join in. A ride says its route; a stay
                says its roof. Terms stay the shared modes above. */}
            <label className="cmp__label">Travel <span className="cmp__label-soft">(the facts that help someone say yes)</span></label>
            <div className="cmp__chips">
              {/* Rides and flights split (founder 2026-10-06: "Travel should
                  have rides, flights, stays") — ground and air are different
                  asks; the vehicle list follows the chip. */}
              <button className={'cmp__chip' + (travelKind === 'ride' ? ' is-on' : '')}
                onClick={() => { setTravelKind((k) => k === 'ride' ? '' : 'ride'); setVehicle((v) => v === 'Plane' || v === 'Helicopter' ? '' : v); }}>Ride / transport</button>
              <button className={'cmp__chip' + (travelKind === 'flight' ? ' is-on' : '')}
                onClick={() => { setTravelKind((k) => k === 'flight' ? '' : 'flight'); setVehicle((v) => v === 'Plane' || v === 'Helicopter' ? v : ''); }}>Flight</button>
              <button className={'cmp__chip' + (travelKind === 'stay' ? ' is-on' : '')}
                onClick={() => setTravelKind((k) => k === 'stay' ? '' : 'stay')}>Stay / place</button>
            </div>
            {(travelKind === 'ride' || travelKind === 'flight') && (<>
              <div className="cmp__row">
                <input className="cmp__input" value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)}
                  placeholder={modes.has('iso') ? 'Leaving from…' : 'From (e.g. Conifer, CO)'} />
                <span className="cmp__to">→</span>
                <input className="cmp__input" value={routeTo} onChange={(e) => setRouteTo(e.target.value)}
                  placeholder={modes.has('iso') ? 'Headed to…' : 'To (e.g. Santa Fe, NM)'} />
              </div>
              <div className="cmp__chips">
                {(travelKind === 'flight' ? ['Plane', 'Helicopter'] : ['Car', 'Truck', 'Van', 'RV', 'Boat']).map((v) => (
                  <button key={v} className={'cmp__chip' + (vehicle === v ? ' is-on' : '')}
                    onClick={() => setVehicle((cur) => cur === v ? '' : v)}>{v}</button>
                ))}
              </div>
              <div className="cmp__row cmp__radius-row">
                <span className="cmp__label-soft">Seats or cargo room for</span>
                <input className="cmp__input cmp__radius-input" type="number" min={1} value={seats}
                  onChange={(e) => setSeats(e.target.value)} placeholder="3" aria-label="Seats" />
              </div>
              <p className="cmp__hint-ev">
                Cargo counts too — a refrigerated truck run, a flight with an empty seat.
                Looking rather than offering? Add the <strong>ISO</strong> mode — the matcher
                rings people going your way.
              </p>
            </>)}
            {travelKind === 'stay' && (<>
              <div className="cmp__row cmp__radius-row">
                <span className="cmp__label-soft">Sleeps</span>
                <input className="cmp__input cmp__radius-input" type="number" min={1} value={sleeps}
                  onChange={(e) => setSleeps(e.target.value)} placeholder="4" aria-label="Sleeps" />
              </div>
              <p className="cmp__hint-ev">
                Check <strong>In person</strong> below and give the town or address — a stay
                with a pin shows on Maps. A home swap is just the <strong>Trade</strong> mode
                (“open to trades for… a place in France”). Tag what kind of place it is
                under Category tags — hotel, retreat center, campground…
              </p>
            </>)}
            {!isMarket && (<>
              <label className="cmp__label">When <span className="cmp__label-soft">(optional — dates offered, or dates you need)</span></label>
              <div className="cmp__row cmp__avail-row">
                <input className="cmp__input" type="date" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} aria-label="Available from" />
                <span className="cmp__to">to</span>
                <input className="cmp__input" type="date" value={availTo} onChange={(e) => setAvailTo(e.target.value)} aria-label="Available until" />
              </div>
            </>)}
          </>)}

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
            {modes.has('paid') && (
              <label className="cmp__evrow cmp__ccyonly">
                <input type="checkbox" checked={currentcyOnly} onChange={(e) => setCurrentcyOnly(e.target.checked)} />
                <span>
                  <strong>Current-cy only</strong> — people you share it with off Lichen can&rsquo;t pay in dollars;
                  they&rsquo;d join Lichen to buy it. Unchecked, they can check out as a guest by card.
                </span>
              </label>
            )}
            <label className="cmp__label">When <span className="cmp__label-soft">(optional — available between, or needed by)</span></label>
            <div className="cmp__row cmp__avail-row">
              <input className="cmp__input" type="date" value={availFrom} onChange={(e) => setAvailFrom(e.target.value)} aria-label="Available from" />
              <span className="cmp__to">to</span>
              <input className="cmp__input" type="date" value={availTo} onChange={(e) => setAvailTo(e.target.value)} aria-label="Available until" />
            </div>
            <label className="cmp__label">How it changes hands</label>
            <div className="cmp__attend cmp__fulfill">
              {/* Digital (founder 2026-08-17): a lot of content is digital now, not
                  paper — a PDF, a recording, a course file — and it changes hands
                  by link, not by post. */}
              {([['pickup', 'Pickup'], ['deliver', 'Deliver'], ['ship', 'Ship'], ['in_store', 'In store'], ['digital', 'Digital']] as const).map(([v, l]) => (
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
            {fulfillment.has('digital') && (
              <p className="cmp__hint-ev">
                Digital hands over by link or file — send it in the exchange chat once it&rsquo;s agreed;
                nothing is uploaded here.
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
          </>)}

          {/* Category tags serve Marketplace AND Travel (founder 2026-10-06:
              the Places vocabulary — hotels, retreat centers, campgrounds —
              is how search finds a stay). One toggle, every tag domain. */}
          {(isMarket || isTravel) && !isEvent && (<>
            <button className="cmp__tags-toggle" onClick={() => setTagsOpen((o) => !o)} aria-expanded={tagsOpen}>
              Category tags {catTags.length > 0 && `· ${catTags.length}`}{' '}
              <span className="cmp__label-soft">— help search find this</span>
              <Icon name="chevron-right" size={12} />
            </button>
            {tagsOpen && (allCats === null ? (
              <p className="cmp__hint-ev">Loading categories…</p>
            ) : (
              // userId arms the picker's own suggest-a-new-one flow (founder
              // 2026-10-15: "suggest it straight from my post") — same admin
              // queue, same bell-when-decided receipt.
              <div className="cmp__tags-pickers">
                <CategoryPicker domain="good" categories={allCats} selected={catTags}
                  onChange={setCatTags} userId={user?.id} />
                <CategoryPicker domain="service" categories={allCats} selected={catTags}
                  onChange={setCatTags} userId={user?.id} />
                <CategoryPicker domain="place" categories={allCats} selected={catTags}
                  onChange={setCatTags} userId={user?.id} />
              </div>
            ))}
          </>)}

          {/* FOR AN IDENTITY (founder 2026-08-21): a course for veterans and
              first responders, a table gifted to firefighters — naming who
              it's for is what makes it appear on that identity's own page.
              Optional, any actionable post, same toggle grammar as tags. */}
          <button className="cmp__tags-toggle" onClick={() => setIdentOpen((o) => !o)} aria-expanded={identOpen}>
            For an identity {forIdents.length > 0 && `· ${forIdents.length}`}{' '}
            <span className="cmp__label-soft">— veterans, teachers, first responders…</span>
            <Icon name="chevron-right" size={12} />
          </button>
          {identOpen && (identCats === null ? (
            <p className="cmp__hint-ev">Loading identities…</p>
          ) : (
            <div className="cmp__gift-idents">
              {identCats.map((c) => {
                const on = forIdents.includes(c.name);
                return (
                  <button key={c.id} type="button"
                    className={'cmp__gift-ident' + (on ? ' is-on' : '')}
                    onClick={() => setForIdents((cur) =>
                      on ? cur.filter((n) => n !== c.name) : [...cur, c.name])}>
                    {on ? '✓ ' : ''}{c.name}
                  </button>
                );
              })}
            </div>
          ))}

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
          {online && isEvent && zoomOk && (
            <label className="cmp__evrow">
              <input type="checkbox" checked={evZoom} onChange={(e) => setEvZoom(e.target.checked)} />
              {' '}Create a unique Zoom meeting for this event
            </label>
          )}
          {online && isEvent && zoomOk && evZoom && (
            <p className="cmp__hint-ev">Lichen makes the Zoom room when you post. Only your hosts and guests see the link — on the event page and their invitation. Change the time and the meeting moves with it.</p>
          )}
          {online && !(isEvent && zoomOk && evZoom) && (
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
              // In person means a place (founder 2026-08-17: "a video link is
              // not in person") — the meeting link has its own box above.
              placeholder="Address or place"
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
              {!evAllDay && evTz && (
                <div className="cmp__evtz">
                  <span className="cmp__evtz-lab">Time zone</span>
                  <TimeZonePick value={evTz} zones={tzZones}
                    lead={[{ zone: evTz, label: 'this event' }, ...(viewerZone() && viewerZone() !== evTz ? [{ zone: viewerZone(), label: 'your device' }] : [])]}
                    onChange={(z) => { evTzTouched.current = true; setEvTz(z); }} />
                </div>
              )}
              <DateRangeCalendar value={evRange} onChange={setEvRange} />
              <div className="cmp__evcal">
                {!editing && actor.type !== 'space' && (
                  <label className="cmp__evrow">
                    <input type="checkbox" checked={evHold} onChange={(e) => setEvHold(e.target.checked)} />
                    Hold this time on my Lichen calendar while it&rsquo;s a draft
                  </label>
                )}
                <span className="cmp__evcal-lab">On my calendar, other members see</span>
                <div className="cmp__evshare" role="radiogroup" aria-label="Who sees this on your calendar">
                  {([['', 'What my calendar sharing allows'], ['busy', 'Only that I\u2019m busy'], ['hidden', 'Nothing']] as const).map(([v, label]) => (
                    <button key={v || 'rules'} type="button" role="radio" aria-checked={evShare === v}
                      className={'cmp__evshare-pill' + (evShare === v ? ' is-on' : '')} onClick={() => setEvShare(v)}>{label}</button>
                  ))}
                </div>
                <p className="cmp__hint-ev">
                  {evShare === 'hidden'
                    ? 'Hidden from every calendar but yours — your bookable time still stays blocked.'
                    : evShare === 'busy'
                      ? 'Anyone who can see your calendar sees a busy block, never the details.'
                      : 'Your calendar sharing decides who sees the details, who sees busy, and who sees nothing.'}
                  {' '}A draft only ever shows as busy. Guests can add it to Google, Apple or Outlook from the event page.
                </p>
              </div>
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
        <label className="cmp__cc">
          <input type="checkbox" checked={weaveable} onChange={(e) => setWeaveable(e.target.checked)} />
          <span>
            <strong>Weaveable</strong> — others may include this post in their
            published collections, always with your name on it. Off keeps it
            out of everyone else&rsquo;s weaves.
          </span>
        </label>
        <label className="cmp__cc">
          <input type="checkbox" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
          <span>
            <strong>Skip the feed</strong> — it still lives in its section, on
            your profile and in search; it just won&rsquo;t appear as a story on
            Home. Good for a back catalogue or a batch of listings.
          </span>
        </label>
      </div>

      {/* Rejections must be visible WHERE you clicked — a silent disabled
          button reads as a freeze (this hid 'add a few words' from an
          audio-only post until it was fixed). */}
      {error && <p className="cmp__error">{error}</p>}
      {uploading && <p className="cmp__error">Uploading media… one moment.</p>}
      {/* SAVE AND POST (founder 2026-10-15: "a save AND post button at the
          bottom, not just post"). Everything autosaves anyway — Save is the
          deliberate gesture, and the receipt names where drafts live. */}
      <div className="cmp__footrow">
        {!editing && (
          <button className="btn cmp__savedraft" onClick={() => void saveDraftNow()} disabled={busy}>
            Save draft
          </button>
        )}
        <button className="btn btn-primary cmp__post" onClick={submit} disabled={busy || uploading || !canPost}>
          {busy ? (editing ? 'Saving…' : 'Posting…') : (editing ? 'Save changes' : 'Post')}
        </button>
      </div>
      {!editing && (draftNote || draftSavedAt !== null) && (
        <p className="cmp__draftnote">
          {draftNote || 'Autosaved to your drafts ✓'}
          {(draftNote.startsWith('Saved') || (!draftNote && draftSavedAt !== null)) && (
            <> · <button className="cmp__draftlink" onClick={() => navigate(isEvent ? '/events/mine' : '/drive')}>
              <span className="link-cue">{isEvent ? 'Your event drafts' : 'Open your drafts'}</span> ›
            </button></>
          )}
        </p>
      )}
      {!editing && draftCount > 0 && (
        <p className="cmp__draftnote">
          {draftCount === 1 ? 'One earlier draft is waiting' : `${draftCount} earlier drafts are waiting`} in your {isEvent ? 'events' : 'Drive'} ·{' '}
          <button className="cmp__draftlink" onClick={() => navigate(isEvent ? '/events/mine' : '/drive')}>
            <span className="link-cue">Open drafts</span> ›
          </button>
        </p>
      )}
    </div>
  );
}
