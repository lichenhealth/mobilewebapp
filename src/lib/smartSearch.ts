import { supabase } from './supabase';
import { geocodeSuggest, type GeoPoint } from './geoApi';
import { loadFeed, postAreas, type FeedPost, type ServiceArea, type ContentType } from './postsApi';
import { loadMappableMembers, type MappableMember } from './locationApi';
import { freeBusy, type FreeBusyRow } from './calendarApi';
import { occursOn } from './recurrence';
import { todayISO } from './conciergeApi';

// ─── Smart search (Figma 286-3407 + criteria panel 286-2515) ─────────────────
// One sentence in, structured criteria out. The parser is deliberately
// rule-based (no AI call): deterministic, instant, offline, and every match
// is explainable — the UI highlights exactly the phrases it understood.
// Privacy is inherited, not re-implemented: the runner only reads what the
// viewer can already see (RLS-scoped posts, per-viewer mappable_members).

export interface SearchCategory { id: string; name: string; domain: 'good' | 'service' | 'place' }

export type SpanKind =
  | 'trust' | 'recommend' | 'price' | 'mode' | 'time' | 'place' | 'area' | 'content' | 'category'
  | 'person';   // a named member — "from melanie bright", "recommended by galyn" 

/** A recognized phrase inside the raw query — drives the peach highlighting. */
export interface ParsedSpan { start: number; end: number; kind: SpanKind }

/** Endorsement filters (mockup's Trusted by / Recommended by, per degree):
 *  'mine' = someone I trust · 'second' = someone trusted by someone I trust ·
 *  'any' = anyone on the platform · personId = one specific member.
 *  Founder vocabulary (2026-07-14): never say "my mycelium" as a trust
 *  degree — my-celium is your network, trust is a private per-person signal.
 *  The grammar accepts both spellings ("my-celium" is the member-facing name
 *  since 2026-07-25). */
export type EndorseDegree = 'any' | 'mine' | 'second';
export interface EndorseFilter { degree: EndorseDegree | null; personId: string | null }
const noEndorse = (): EndorseFilter => ({ degree: null, personId: null });

/** Offer modes (mockup's How): gift=free, buy=paid/sale/sliding. */
export type OfferKind = 'gift' | 'trade' | 'rent' | 'lend' | 'borrow' | 'iso' | 'buy';

export type WhoKind = 'people' | 'providers' | 'organizations';

export interface SearchCriteria {
  trust: EndorseFilter;
  rec: EndorseFilter;
  offers: OfferKind[];
  priceMin: number | null;
  priceMax: number | null;
  online: boolean; inPerson: boolean;
  who: WhoKind[];
  spaceScope: string[];           // limit to these organizations/communities/groups/places
  authorScope: string | null;     // limit to one member's own contributions (their profile's Search)
  areas: ServiceArea[];
  contentTypes: ContentType[];
  categories: SearchCategory[];   // provider categories (mockup's Topics)
  radiusMiles: number | null;
  anchorText: string | null;      // "98110", "Bainbridge Island" — geocoded at run time
  anchorGeo: GeoPoint | null;     // pre-resolved center (criteria panel picks skip geocoding)
  nearMe: boolean;
  dateFrom: string | null;        // ISO event window (mockup's When)
  dateTo: string | null;
  hideConflicts: boolean;         // drop events overlapping my calendar's busy times
  terms: string[];                // leftover meaningful words → free-text match
}

export function emptyCriteria(): SearchCriteria {
  return {
    trust: noEndorse(), rec: noEndorse(),
    offers: [], priceMin: null, priceMax: null,
    online: false, inPerson: false,
    who: [], spaceScope: [], authorScope: null,
    areas: [], contentTypes: [], categories: [],
    radiusMiles: null, anchorText: null, anchorGeo: null, nearMe: false,
    dateFrom: null, dateTo: null, hideConflicts: false,
    terms: [],
  };
}

const WORD_NUMS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
  // ordinals typed in a hurry still mean the number ("next, sixth months")
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
  seventh: 7, eighth: 8, ninth: 9, tenth: 10, twelfth: 12,
};

const AREA_WORDS: [RegExp, ServiceArea][] = [
  [/\b(events?|gatherings?|meetups?|ceremon(?:y|ies))\b/g, 'events'],
  [/\b(trainings?|courses?|classes|workshops?|learning|education)\b/g, 'courses'],
  [/\b(marketplace|goods|products?)\b/g, 'marketplace'],
  [/\b(work|jobs?|gigs?|charity|volunteer(?:ing)?)\b/g, 'work'],
  [/\b(food|meals?|nutrition)\b/g, 'food'],
  [/\b(art|artwork)\b/g, 'art'],
  [/\b(places?|venues?)\b/g, 'places'],
  [/\b(travel|trips?|rides?|ride\s*share|carpool(?:ing)?|lodging|stays?|lodge|accommodations?)\b/g, 'travel'],
  [/\b(library|books?|reading)\b/g, 'library'],
  [/\b(people|members?|providers?|practitioners?|healers?|workers?)\b/g, 'people'],
];

const CONTENT_WORDS: [RegExp, ContentType][] = [
  [/\beducational\b/g, 'educational'],
  [/\bsocial\b/g, 'social'],
  [/\bcreative\b/g, 'creative'],
  [/\bactionable\b/g, 'actionable'],
  [/\b(q&a|questions?)\b/g, 'qa'],
];

const STOPWORDS = new Set([
  'a', 'an', 'and', 'or', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'with',
  'i', 'me', 'my', 'that', 'who', 'whom', 'which', 'both', 'all', 'any', 'some',
  'is', 'are', 'be', 'was', 'were', 'am', 'do', 'does', 'next', 'this', 'these',
  'find', 'show', 'looking', 'look', 'want', 'need', 'please', 'from', 'near',
]);

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Parse a natural sentence into criteria + the spans that were understood. */
/** A member the sentence can name (founder 2026-07-28). */
export interface NamedMember { id: string; full_name: string | null }

export function parseQuery(
  raw: string, categories: SearchCategory[], people: NamedMember[] = [],
): {
  criteria: SearchCriteria; spans: ParsedSpan[];
} {
  const c = emptyCriteria();
  const spans: ParsedSpan[] = [];
  const q = raw.toLowerCase();
  // consumed[i] = true → char i belongs to a recognized phrase (skip for terms)
  const consumed = new Array<boolean>(q.length).fill(false);

  const claim = (start: number, end: number, kind: SpanKind) => {
    spans.push({ start, end, kind });
    for (let i = start; i < end; i++) consumed[i] = true;
  };
  const scan = (re: RegExp, kind: SpanKind, onHit: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(q)) !== null) {
      if (consumed[m.index]) continue;
      onHit(m);
      claim(m.index, m.index + m[0].length, kind);
    }
  };

  // Longest, most specific phrases first — order matters. The recommend-second
  // phrase CONTAINS the trust-second phrase, so it must scan before it.
  scan(/\brecommended by (?:(?:someone|people|members|those|folks) trusted by (?:someone|people|members|those|folks) i trust|people trusted by my my-?celium|(?:people|members|those|folks) my my-?celium trusts?)\b/g,
    'recommend', () => { c.rec.degree = 'second'; });
  scan(/\btrusted by (?:(?:people|members|those|folks|someone|anyone) i trust|my my-?celium)\b/g,
    'trust', () => { c.trust.degree = 'second'; });
  scan(/\brecommended(?: by (?:(?:people|members|those|folks|someone|anyone) i trust|my my-?celium|people in my my-?celium))?\b/g,
    'recommend', () => { c.rec.degree ??= 'mine'; });
  scan(/\b(?:(?:people|members|folks|those|providers|practitioners)\s+)?(?:that\s+|whom?\s+)?i trust\b|\bmy my-?celium\b|\btrusted\b/g,
    'trust', () => { c.trust.degree ??= 'mine'; });

  scan(/\bfree or low[- ]?cost\b|\blow[- ]?cost\b|\bfree\b|\binexpensive\b/g, 'price', () => {
    if (!c.offers.includes('gift')) c.offers.push('gift');
  });
  scan(/\btrade\b|\bbarter\b/g, 'price', () => { if (!c.offers.includes('trade')) c.offers.push('trade'); });
  scan(/\bpaid\b|\bfor sale\b/g, 'price', () => { if (!c.offers.includes('buy')) c.offers.push('buy'); });
  scan(/\bto rent\b|\brentals?\b/g, 'price', () => { if (!c.offers.includes('rent')) c.offers.push('rent'); });
  scan(/\bborrow(?:able)?\b|\bto lend\b/g, 'price', () => {
    if (!c.offers.includes('lend')) c.offers.push('lend');
    if (!c.offers.includes('borrow')) c.offers.push('borrow');
  });
  scan(/\biso\b|\bin search of\b/g, 'price', () => { if (!c.offers.includes('iso')) c.offers.push('iso'); });
  scan(/\bunder \$?(\d+)\b/g, 'price', (m) => { c.priceMax = parseInt(m[1], 10); });
  scan(/\bover \$?(\d+)\b/g, 'price', (m) => { c.priceMin = parseInt(m[1], 10); });

  scan(/\bonline\b|\bvirtual(?:ly)?\b|\bremote(?:ly)?\b/g, 'mode', () => { c.online = true; });
  scan(/\bin[- ]person\b|\boffline\b/g, 'mode', () => { c.inPerson = true; });

  // "within 25 miles of 98110" / "within 40 km of bainbridge island"
  scan(/\bwithin\s+(\d+)\s*(miles?|mi|kilometers?|km)\s+(?:of|from)\s+([\w][\w\s.,-]*?)(?=$|[.;!?]|\band\b|\bor\b|\bthat\b|\bwho\b|\brecommended\b|\bin the next\b)/g,
    'place', (m) => {
      const n = parseInt(m[1], 10);
      c.radiusMiles = /k/.test(m[2]) ? Math.round(n * 0.621) : n;
      c.anchorText = m[3].trim().replace(/[.,]$/, '');
    });
  scan(/\b(?:near|around|close to)\s+me\b/g, 'place', () => { c.nearMe = true; c.radiusMiles ??= 25; });
  scan(/\b(?:near|around)\s+([\w][\w\s.-]*?)(?=$|[.;!?,]|\band\b|\bor\b|\bthat\b|\bwho\b|\brecommended\b|\bin the next\b)/g,
    'place', (m) => {
      if (!c.anchorText) { c.anchorText = m[1].trim(); c.radiusMiles ??= 25; }
    });

  // "in the next six months" / "next 2 weeks" / "this month" / "upcoming"
  const window = (months: number) => {
    c.dateFrom = todayISO();
    c.dateTo = addMonths(todayISO(), months);
  };
  scan(/\b(?:in the )?next[,\s]+(\d+|[a-z]+)\s+(days?|weeks?|months?|years?)\b/g, 'time', (m) => {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUMS[m[1]];
    if (!n) return;
    if (/day/.test(m[2])) {
      c.dateFrom = todayISO();
      const d = new Date(todayISO() + 'T00:00:00');
      d.setDate(d.getDate() + n);
      c.dateTo = d.toISOString().slice(0, 10);
    } else window(/week/.test(m[2]) ? Math.max(1, Math.round(n / 4)) : /year/.test(m[2]) ? n * 12 : n);
  });
  scan(/\bthis (week|weekend|month)\b/g, 'time', () => window(1));
  scan(/\bupcoming\b|\bsoon\b/g, 'time', () => window(3));

  // Provider categories by name — whole category name, or any significant
  // word of it ("spiritual" finds Spiritual Counseling). OR-combined.
  for (const cat of categories) {
    const name = cat.name.toLowerCase();
    const idx = q.indexOf(name);
    if (idx >= 0 && !consumed[idx]) {
      c.categories.push(cat);
      claim(idx, idx + name.length, 'category');
      continue;
    }
    for (const w of name.split(/[^a-z]+/)) {
      if (w.length < 5) continue;
      const re = new RegExp(`\\b${w}(?:s|ers?)?\\b`, 'g');
      const m = re.exec(q);
      if (m && !consumed[m.index]) {
        c.categories.push(cat);
        claim(m.index, m.index + m[0].length, 'category');
        break;
      }
    }
  }

  for (const [re, area] of AREA_WORDS) scan(re, 'area', () => {
    if (!c.areas.includes(area)) c.areas.push(area);
  });
  for (const [re, ct] of CONTENT_WORDS) scan(re, 'content', () => {
    if (!c.contentTypes.includes(ct)) c.contentTypes.push(ct);
  });

  // ── Named members ────────────────────────────────────────────────────────
  // "from melanie bright" → her contributions; a name trailing a trust or
  // recommend phrase BINDS that filter to her instead of a degree. Longest
  // names first so "melanie bright" wins over "melanie".
  const named = people
    .filter((p) => (p.full_name ?? '').trim().length > 2)
    .map((p) => ({ id: p.id, name: (p.full_name ?? '').toLowerCase().trim() }))
    .sort((a, b) => b.name.length - a.name.length);
  for (const person of named) {
    const first = person.name.split(/\s+/)[0];
    for (const variant of [person.name, first]) {
      if (variant.length < 3) continue;
      let from = 0;
      let bound = false;
      while (!bound) {
        const at = q.indexOf(variant, from);
        if (at < 0) break;
        from = at + variant.length;
        const end = at + variant.length;
        const beforeOk = at === 0 || !/[a-z0-9]/.test(q[at - 1]);
        const afterOk = end >= q.length || !/[a-z0-9]/.test(q[end]);
        if (!beforeOk || !afterOk) continue;
        let free = true;
        for (let i = at; i < end; i++) if (consumed[i]) { free = false; break; }
        if (!free) continue;
        // What precedes the name decides what it means.
        const before = q.slice(0, at);
        const nearRec = /recommend(?:ed|s)?(?:\s+by)?\s*$/.test(before)
          || spans.some((sp) => sp.kind === 'recommend' && at >= sp.end && at - sp.end <= 4);
        const nearTrust = /trusted\s+by\s*$/.test(before)
          || spans.some((sp) => sp.kind === 'trust' && at >= sp.end && at - sp.end <= 4);
        if (nearRec) { c.rec.personId = person.id; c.rec.degree = null; }
        else if (nearTrust) { c.trust.personId = person.id; c.trust.degree = null; }
        else c.authorScope = person.id;
        claim(at, end, 'person');
        bound = true;
      }
      if (bound) break;
    }
  }

  // Leftover words → free-text terms
  let word = ''; let start = -1;
  const flush = () => {
    if (word.length >= 3 && !STOPWORDS.has(word) && start >= 0 && !consumed[start]) c.terms.push(word);
    word = ''; start = -1;
  };
  for (let i = 0; i <= q.length; i++) {
    const ch = q[i] ?? ' ';
    if (/[a-z0-9']/.test(ch)) { if (!word) start = i; word += ch; }
    else flush();
  }

  spans.sort((a, b) => a.start - b.start);
  return { criteria: c, spans };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export interface PersonHit {
  id: string; full_name: string | null; headline: string | null; avatar_url: string | null;
  categoryNames: string[];
  place: string | null; level: 'area' | 'exact' | null; distanceMi: number | null;
  recommenders: string[];   // names of qualifying recommenders
  trusted: boolean;         // in MY mycelium
}

export interface SpaceHit {
  id: string; name: string; kind: string; location: string | null;
  lat: number | null; lng: number | null; distanceMi: number | null;
  recommenders: string[]; trusted: boolean;
  /** The query matched this space's ADDRESS, not its name — present it
   *  address-first: "320 Rustlers Rd, Bailey — LICHEN HQ" (founder 2026-07-27). */
  addressMatch: boolean;
}

export interface SmartResults {
  people: PersonHit[];
  posts: FeedPost[];
  /** Near misses (founder 2026-07-28): matched SOME of your words, not all.
   *  Listed under the direct hits, best-matched first — precision without
   *  losing what's adjacent. */
  nearPosts: FeedPost[];
  spaces: SpaceHit[];
  anchor: GeoPoint | null;        // resolved center of the radius filter
  anchorMissing: boolean;         // a radius was asked for but no center resolved
}

const toRad = (d: number) => (d * Math.PI) / 180;
export function milesBetween(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3959 * 2 * Math.asin(Math.sqrt(h));
}

function browserLocation(): Promise<GeoPoint | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 6000, maximumAge: 300000 },
    );
  });
}

function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Does this post's event land inside [from, to]? */
function eventInWindow(p: FeedPost, from: string, to: string): boolean {
  const ev = p.linked_event;
  if (!ev) return false;
  if (ev.recurrence) {
    // walk the window day by day (bounded below, instant at these sizes)
    let days = 0;
    for (let d = from; d <= to && days < 400; d = nextDay(d), days++) {
      if (occursOn(ev, d)) return true;
    }
    return false;
  }
  return ev.start_date <= to && (ev.end_date ?? ev.start_date) >= from;
}

/** First day in [from, to] this event occurs on (for the conflict check). */
function firstOccurrence(p: FeedPost, from: string, to: string): string | null {
  const ev = p.linked_event;
  if (!ev) return null;
  if (!ev.recurrence) return ev.start_date >= from ? ev.start_date : from;
  let days = 0;
  for (let d = from; d <= to && days < 400; d = nextDay(d), days++) {
    if (occursOn(ev, d)) return d;
  }
  return null;
}

/** Does the event clash with any of MY busy blocks on its (first) day? */
function conflictsWithBusy(p: FeedPost, busy: FreeBusyRow[], from: string, to: string): boolean {
  const ev = p.linked_event;
  if (!ev) return false;
  const day = firstOccurrence(p, from, to);
  if (!day) return false;
  for (const b of busy) {
    if (!occursOn(b, day)) continue;
    if (b.all_day || ev.all_day || ev.start_min == null || b.start_min == null) return true;
    const bEnd = b.end_min ?? b.start_min + 60;
    const eEnd = ev.end_min ?? ev.start_min + 60;
    if (ev.start_min < bEnd && b.start_min < eEnd) return true;
  }
  return false;
}

function postGeo(p: FeedPost): GeoPoint | null {
  if (p.linked_event?.lat != null && p.linked_event?.lng != null) {
    return { lat: p.linked_event.lat, lng: p.linked_event.lng };
  }
  const g = p.details?.geo as { lat?: number; lng?: number } | undefined;
  return g?.lat != null && g?.lng != null ? { lat: g.lat, lng: g.lng } : null;
}

/** Which offer kinds does this post satisfy? (events: event_mode column;
 *  marketplace listings: details.mode — gift|sale|sliding|trade|lend|rent) */
function postOffers(p: FeedPost): OfferKind[] {
  const out = new Set<OfferKind>();
  if (p.event_mode === 'free') out.add('gift');
  if (p.event_mode === 'trade') out.add('trade');
  if (p.event_mode === 'paid') out.add('buy');
  const m = p.details?.mode as string | undefined;
  if (m === 'gift') out.add('gift');
  if (m === 'trade') out.add('trade');
  if (m === 'sale' || m === 'sliding') out.add('buy');
  if (m === 'rent') out.add('rent');
  if (m === 'lend') out.add('lend');
  if (m === 'borrow') out.add('borrow');
  if (m === 'iso') out.add('iso');
  return [...out];
}

/** First number in a price string — "$45", "Sliding scale $20–$50" → 45, 20. */
function postPrice(p: FeedPost): number | null {
  const s = p.details?.price;
  if (typeof s !== 'string') return null;
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/** EVERY term must appear (founder 2026-07-28: "fresh produce" was surfacing
 *  a chainsaw whose body says "fresh bar oil" — a single shared word isn't a
 *  match). Multi-word searches read as one thing, not a list of alternatives. */
const hasText = (hay: (string | null | undefined)[], terms: string[]) => {
  if (terms.length === 0) return true;
  const s = hay.filter(Boolean).join(' ').toLowerCase();
  return terms.every((t) => s.includes(t));
};
/** Any-term match — used only to offer near-misses when nothing matched at all. */
const hasAnyText = (hay: (string | null | undefined)[], terms: string[]) => {
  if (terms.length === 0) return true;
  const s = hay.filter(Boolean).join(' ').toLowerCase();
  return terms.some((t) => s.includes(t));
};

interface Edge { actor: string; target_type: string; target_id: string }

/** Given a filter + the full edge list, who qualifies as an endorser of a
 *  target key? Returns the qualifying actor ids (empty = doesn't pass). */
function endorsersOf(
  filter: EndorseFilter, edges: Edge[], type: string, id: string,
  me: string, myVouched: Set<string>,
): string[] {
  if (!filter.degree && !filter.personId) return [];
  const forTarget = edges.filter((e) => e.target_type === type && e.target_id === id);
  return forTarget.filter((e) => actorQualifies(filter, e.actor, edges, me, myVouched)).map((e) => e.actor);
}

/** Does this actor's endorsement count under the filter's degree? */
function actorQualifies(
  filter: EndorseFilter, actor: string, trustEdges: Edge[],
  me: string, myVouched: Set<string>,
): boolean {
  if (filter.personId) return actor === filter.personId;
  if (filter.degree === 'mine') return myVouched.has('profile:' + actor) || actor === me;
  if (filter.degree === 'second') {
    if (myVouched.has('profile:' + actor) || actor === me) return true;
    // someone trusted by someone I trust (vouched-of-vouched)
    return trustEdges.some((e) =>
      e.target_type === 'profile' && e.target_id === actor
      && (myVouched.has('profile:' + e.actor) || e.actor === me));
  }
  return true;   // 'any'
}

export async function runSmartSearch(c: SearchCriteria, me: string): Promise<SmartResults> {
  // Resolve the radius center first (pre-picked, browser location, or geocode).
  let anchor: GeoPoint | null = c.anchorGeo;
  if (c.radiusMiles != null && !anchor) {
    if (c.nearMe) anchor = await browserLocation();
    if (!anchor && c.anchorText) anchor = (await geocodeSuggest(c.anchorText))[0] ?? null;
  }
  const anchorMissing = c.radiusMiles != null && !anchor;

  const catIds = c.categories.map((x) => x.id);
  const wantProviders = c.who.includes('providers');

  const [posts, mappable, profRes, spaceRes, pcRes, trustRes, recRes] = await Promise.all([
    loadFeed(200),
    loadMappableMembers().catch(() => [] as MappableMember[]),
    supabase.from('profiles').select('id, full_name, headline, bio, avatar_url').eq('onboarded', true).limit(500),
    supabase.from('spaces').select('id, name, kind, location, lat, lng').limit(500),
    (catIds.length || wantProviders)
      ? supabase.from('profile_categories').select('profile_id, category_id').limit(3000)
      : Promise.resolve({ data: [] as { profile_id: string; category_id: string }[] }),
    // The whole visible trust/recommend web — beta-scale fine; the trust LENS
    // needs cross-member edges anyway (same reads as the feed's endorsement
    // overlay). Only VOUCHED edges are trust signals — web-only membership
    // speaks for nobody (founder: mycelium ≠ trust).
    supabase.from('mycelium').select('truster_id, target_type, target_id')
      .eq('vouched', true).limit(5000),
    supabase.from('recommendations').select('recommender_id, target_type, target_id').limit(5000),
  ]);

  const profiles = (profRes.data as { id: string; full_name: string | null; headline: string | null; bio: string | null; avatar_url: string | null }[] | null) ?? [];
  const spaces = (spaceRes.data as { id: string; name: string; kind: string; location: string | null; lat: number | null; lng: number | null }[] | null) ?? [];
  const pcRows = (pcRes.data as { profile_id: string; category_id: string }[] | null) ?? [];

  const trustEdges: Edge[] = ((trustRes.data as { truster_id: string; target_type: string; target_id: string }[] | null) ?? [])
    .map((r) => ({ actor: r.truster_id, target_type: r.target_type, target_id: r.target_id }));
  const recEdges: Edge[] = ((recRes.data as { recommender_id: string; target_type: string; target_id: string }[] | null) ?? [])
    .map((r) => ({ actor: r.recommender_id, target_type: r.target_type, target_id: r.target_id }));

  const myVouched = new Set(trustEdges.filter((e) => e.actor === me).map((e) => `${e.target_type}:${e.target_id}`));
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name || 'A member';

  // Space scope: members of the selected spaces (for the People section).
  let scopeMembers: Set<string> | null = null;
  if (c.spaceScope.length) {
    const { data } = await supabase.from('space_members')
      .select('profile_id, space_id').in('space_id', c.spaceScope);
    scopeMembers = new Set(((data as { profile_id: string }[] | null) ?? []).map((r) => r.profile_id));
  }

  // My busy blocks, once, if conflicts are hidden (needs a window to check).
  const winFrom = c.dateFrom ?? todayISO();
  const winTo = c.dateTo ?? addMonths(todayISO(), 12);
  const busy = (c.hideConflicts && me) ? await freeBusy([me], winFrom, winTo) : [];

  const trustFilterOn = !!(c.trust.degree || c.trust.personId);
  const recFilterOn = !!(c.rec.degree || c.rec.personId);
  const trustPass = (type: string, id: string): boolean =>
    !trustFilterOn || endorsersOf(c.trust, trustEdges, type, id, me, myVouched).length > 0;
  const recNames = (type: string, id: string): string[] =>
    [...new Set(endorsersOf(c.rec, recEdges, type, id, me, myVouched).map(nameOf))];
  const recPass = (type: string, id: string, extra = false): boolean =>
    !recFilterOn || recNames(type, id).length > 0 || extra;
  // Display recommenders even when no filter is on (mycelium lens: recs by people I trust).
  const displayFilter: EndorseFilter = recFilterOn ? c.rec : { degree: 'mine', personId: null };
  const displayRecs = (type: string, id: string): string[] =>
    [...new Set(endorsersOf(displayFilter, recEdges, type, id, me, myVouched).map(nameOf))];

  // People aren't recommended directly anymore (founder: recommend THINGS) —
  // a person's recommenders aggregate from recommendations of their POSTS.
  const postRecEdges = recEdges.filter((e) => e.target_type === 'post');
  const postAuthor = new Map<string, string>();
  for (const post of posts) postAuthor.set(post.id, post.author_id);
  const unknownPostIds = [...new Set(postRecEdges.map((e) => e.target_id))]
    .filter((id) => !postAuthor.has(id));
  if (unknownPostIds.length) {
    const { data } = await supabase.from('posts').select('id, author_id').in('id', unknownPostIds);
    for (const r of (data as { id: string; author_id: string }[] | null) ?? []) {
      postAuthor.set(r.id, r.author_id);
    }
  }
  const personRecNames = (profileId: string, f: EndorseFilter): string[] =>
    [...new Set(postRecEdges
      .filter((e) => postAuthor.get(e.target_id) === profileId
        && actorQualifies(f, e.actor, trustEdges, me, myVouched))
      .map((e) => nameOf(e.actor)))];

  const catNamesFor = (profileId: string): string[] =>
    pcRows.filter((r) => r.profile_id === profileId)
      .map((r) => c.categories.find((x) => x.id === r.category_id)?.name)
      .filter((n): n is string => !!n);
  const isProvider = (profileId: string): boolean => pcRows.some((r) => r.profile_id === profileId);

  const spot = (id: string) => mappable.find((m) => m.id === id) ?? null;

  // ── People ──────────────────────────────────────────────────────────────────
  let people: PersonHit[] = profiles
    .filter((p) => p.id !== me)
    .map((p) => {
      const s = spot(p.id);
      return {
        id: p.id, full_name: p.full_name, headline: p.headline, avatar_url: p.avatar_url,
        categoryNames: catNamesFor(p.id),
        place: s?.place ?? null, level: (s?.level as 'state' | 'county' | 'area' | 'exact' | undefined) ?? null,
        distanceMi: anchor && s && s.lat != null && s.lng != null ? milesBetween(anchor, { lat: s.lat, lng: s.lng }) : null,
        recommenders: personRecNames(p.id, displayFilter),
        trusted: myVouched.has('profile:' + p.id),
        _bio: p.bio,
      } as PersonHit & { _bio: string | null };
    })
    .filter((p) => {
      if (catIds.length && !p.categoryNames.length) return false;
      if (wantProviders && !c.who.includes('people') && !isProvider(p.id)) return false;
      if (scopeMembers && !scopeMembers.has(p.id)) return false;
      if (!trustPass('profile', p.id)) return false;
      if (recFilterOn && personRecNames(p.id, c.rec).length === 0) return false;
      if (anchor && c.radiusMiles != null) {
        if (p.distanceMi == null || p.distanceMi > c.radiusMiles) return false;
      }
      if (!catIds.length && !hasText([p.full_name, p.headline, (p as PersonHit & { _bio: string | null })._bio], c.terms)) return false;
      return true;
    });
  // Only surface people when the query points at people at all.
  const endorseOnly = (c.trust.degree || c.trust.personId || c.rec.degree || c.rec.personId) && c.areas.length === 0;
  const wantsPeople = !c.authorScope && (c.who.includes('people') || wantProviders
    || catIds.length > 0 || c.areas.includes('people') || (!c.who.length && !!endorseOnly));
  if (!wantsPeople) people = [];
  people.sort((a, b) =>
    (b.recommenders.length - a.recommenders.length)
    || ((a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9))
    || (a.full_name ?? '').localeCompare(b.full_name ?? ''));

  // ── Posts ───────────────────────────────────────────────────────────────────
  const postAreaFilter: ServiceArea[] = c.areas.filter((a) => a !== 'people');
  const nearIds = new Set<string>();
  let postHits = posts.filter((p) => {
    if (c.authorScope && !(p.author_id === c.authorScope && !p.author_space_id)) return false;
    if (postAreaFilter.length && !postAreas(p).some((a) => postAreaFilter.includes(a))) return false;
    if (c.contentTypes.length && !c.contentTypes.includes(p.content_type)) return false;
    if (c.spaceScope.length
      && !(p.author_space_id && c.spaceScope.includes(p.author_space_id))
      && !p.audience_space_ids?.some((id) => c.spaceScope.includes(id))) return false;
    if (c.offers.length && !postOffers(p).some((o) => c.offers.includes(o))) return false;
    if (c.priceMin != null || c.priceMax != null) {
      const price = postPrice(p) ?? (postOffers(p).includes('gift') ? 0 : null);
      if (price == null) return false;
      if (c.priceMin != null && price < c.priceMin) return false;
      if (c.priceMax != null && price > c.priceMax) return false;
    }
    // online XOR in-person only filters when exactly one is asked for
    if (c.online !== c.inPerson) {
      const inPerson = postGeo(p) != null;
      if (c.inPerson && !inPerson) return false;
      if (c.online && inPerson) return false;
    }
    if ((c.dateFrom || c.dateTo) && !eventInWindow(p, winFrom, winTo)) return false;
    if (c.hideConflicts && p.linked_event && conflictsWithBusy(p, busy, winFrom, winTo)) return false;
    if (!trustPass('profile', p.author_id)
      && !(p.author_space_id && trustPass('space', p.author_space_id) && (c.trust.degree || c.trust.personId))) return false;
    if (!recPass('post', p.id, personRecNames(p.author_id, c.rec).length > 0)) return false;
    if (anchor && c.radiusMiles != null) {
      const g = postGeo(p);
      if (!g || milesBetween(anchor, g) > c.radiusMiles) return false;
    }
    const taggedCats = Array.isArray(p.details?.categories)
      ? (p.details.categories as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const direct = hasText([p.title, p.body, p.author?.full_name], c.terms)
      || c.categories.some((cat) =>
        taggedCats.includes(cat.id) || hasText([p.title, p.body], [cat.name.toLowerCase()]));
    if (direct) return true;
    // Not every word — but some. Keep it as a near miss (multi-word searches
    // only; with one word there's no such thing as "partly").
    if (c.terms.length > 1 && hasAnyText([p.title, p.body, p.author?.full_name], c.terms)) {
      nearIds.add(p.id);
      return true;
    }
    return false;
  });
  // Split the tiers; near misses rank by how much of the search they matched.
  const termHits = (p: FeedPost) => {
    const hay = [p.title, p.body, p.author?.full_name].filter(Boolean).join(' ').toLowerCase();
    return c.terms.filter((t) => hay.includes(t)).length;
  };
  let nearHits = postHits.filter((p) => nearIds.has(p.id))
    .sort((a, b) => termHits(b) - termHits(a));
  postHits = postHits.filter((p) => !nearIds.has(p.id));
  if (c.who.length && !c.who.includes('organizations') && (c.who.includes('people') || wantProviders)
    && !postAreaFilter.length && !c.contentTypes.length) {
    // pure Who=People searches read as a member directory — keep posts out
    postHits = [];
    nearHits = [];
  }

  // ── Spaces ──────────────────────────────────────────────────────────────────
  // Address recognition (founder 2026-07-27): "320 Rustlers Rd, Bailey" often
  // parses into the ANCHOR, not terms — so match address tokens from both
  // against each space's stored location. Two token hits (one, if it's all we
  // have) reads as "you typed this place's address".
  const addrTokens = [...new Set([
    ...c.terms,
    ...((c.anchorText ?? '').toLowerCase().split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 || /^\d+$/.test(t))),
  ])];
  const looksLikeAddress = (loc: string | null, name: string): boolean => {
    if (!loc || addrTokens.length === 0) return false;
    const hay = loc.toLowerCase();
    const hits = addrTokens.filter((t) => hay.includes(t)).length;
    if (hits === 0) return false;
    // A name sharing ANY token means this is a name hit, not an address hit.
    if (hasAnyText([name], addrTokens)) return false;
    return hits >= Math.min(2, addrTokens.length);
  };
  let spaceHits: SpaceHit[] = spaces.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, location: s.location,
    addressMatch: looksLikeAddress(s.location, s.name),
    lat: s.lat, lng: s.lng,
    distanceMi: anchor && s.lat != null && s.lng != null
      ? milesBetween(anchor, { lat: s.lat, lng: s.lng }) : null,
    // Places are recommended (things); org/community/group are trusted
    // (relationships) — each kind carries only its own signal.
    recommenders: s.kind === 'place' ? displayRecs('space', s.id) : [],
    trusted: s.kind !== 'place' && myVouched.has('space:' + s.id),
  })).filter((s) => {
    if (c.spaceScope.length && !c.spaceScope.includes(s.id)) return false;
    if (s.kind === 'place') {
      // A place can't be trusted; a trust-only filter excludes places.
      if (trustFilterOn && !recFilterOn) return false;
      if (!recPass('space', s.id)) return false;
    } else {
      // Org/community/group can't be recommended; a rec-only filter excludes them.
      if (recFilterOn && !trustFilterOn) return false;
      if (!trustPass('space', s.id)) return false;
    }
    if (anchor && c.radiusMiles != null) {
      if (s.distanceMi == null || s.distanceMi > c.radiusMiles) return false;
    }
    if (!s.addressMatch
      && !hasText([s.name, s.location], c.terms.length ? c.terms : c.categories.map((x) => x.name.toLowerCase()))) return false;
    return true;
  });
  const wantsSpaces = !c.authorScope && (c.who.includes('organizations') || c.spaceScope.length > 0
    || c.areas.includes('places') || c.terms.length > 0 || (!c.who.length && !!endorseOnly));
  if (!wantsSpaces) spaceHits = spaceHits.filter((h) => h.addressMatch);
  spaceHits.sort((a, b) =>
    (Number(b.addressMatch) - Number(a.addressMatch))
    || (b.recommenders.length - a.recommenders.length)
    || ((a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9))
    || a.name.localeCompare(b.name));

  return {
    people: people.slice(0, 25),
    posts: postHits.slice(0, 25),
    nearPosts: nearHits.slice(0, 12),
    spaces: spaceHits.slice(0, 25),
    anchor, anchorMissing,
  };
}
