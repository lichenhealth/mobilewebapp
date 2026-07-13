import { supabase } from './supabase';
import { geocodeSuggest, type GeoPoint } from './geoApi';
import { loadFeed, postAreas, type FeedPost, type ServiceArea, type ContentType } from './postsApi';
import { loadMyMycelium } from './myceliumApi';
import { loadMappableMembers, type MappableMember } from './locationApi';
import { occursOn } from './recurrence';
import { todayISO } from './conciergeApi';

// ─── Smart search (Figma 286-3407) ────────────────────────────────────────────
// One sentence in, structured criteria out. The parser is deliberately
// rule-based (no AI call): deterministic, instant, offline, and every match
// is explainable — the UI highlights exactly the phrases it understood.
// Privacy is inherited, not re-implemented: the runner only reads what the
// viewer can already see (RLS-scoped posts, per-viewer mappable_members).

export interface SearchCategory { id: string; name: string; domain: 'good' | 'service' }

export type SpanKind =
  | 'trust' | 'recommend' | 'price' | 'mode' | 'time' | 'place' | 'area' | 'content' | 'category';

/** A recognized phrase inside the raw query — drives the peach highlighting. */
export interface ParsedSpan { start: number; end: number; kind: SpanKind }

export interface SearchCriteria {
  trusted: boolean;         // authors/people in MY mycelium
  recommended: boolean;     // recommended by people in my mycelium
  free: boolean; trade: boolean; paid: boolean;
  online: boolean; inPerson: boolean;
  areas: ServiceArea[];
  contentTypes: ContentType[];
  categories: SearchCategory[];   // provider categories matched by name
  radiusMiles: number | null;
  anchorText: string | null;      // "98110", "Bainbridge Island" — geocoded at run time
  anchorGeo: GeoPoint | null;     // pre-resolved center (criteria panel picks skip geocoding)
  nearMe: boolean;
  monthsAhead: number | null;     // time window for events
  terms: string[];                // leftover meaningful words → free-text match
}

export function emptyCriteria(): SearchCriteria {
  return {
    trusted: false, recommended: false,
    free: false, trade: false, paid: false,
    online: false, inPerson: false,
    areas: [], contentTypes: [], categories: [],
    radiusMiles: null, anchorText: null, anchorGeo: null, nearMe: false, monthsAhead: null,
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

/** Parse a natural sentence into criteria + the spans that were understood. */
export function parseQuery(raw: string, categories: SearchCategory[]): {
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

  // Longest, most specific phrases first — order matters.
  scan(/\brecommended(?: by (?:(?:people|members|those|folks) i trust|my mycelium|people in my mycelium))?\b/g,
    'recommend', () => { c.recommended = true; });
  scan(/\b(?:(?:people|members|folks|those|providers|practitioners)\s+)?(?:that\s+|whom?\s+)?i trust\b|\bmy mycelium\b|\btrusted\b/g,
    'trust', () => { c.trusted = true; });

  scan(/\bfree or low[- ]?cost\b|\blow[- ]?cost\b|\bfree\b|\binexpensive\b/g, 'price', () => { c.free = true; });
  scan(/\btrade\b|\bbarter\b/g, 'price', () => { c.trade = true; });
  scan(/\bpaid\b/g, 'price', () => { c.paid = true; });

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
  scan(/\b(?:in the )?next[,\s]+(\d+|[a-z]+)\s+(weeks?|months?|years?)\b/g, 'time', (m) => {
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : WORD_NUMS[m[1]];
    if (!n) return;
    c.monthsAhead = /week/.test(m[2]) ? Math.max(1, Math.round(n / 4)) : /year/.test(m[2]) ? n * 12 : n;
  });
  scan(/\bthis (week|weekend|month)\b/g, 'time', () => { c.monthsAhead = 1; });
  scan(/\bupcoming\b|\bsoon\b/g, 'time', () => { c.monthsAhead = 3; });

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

  // Leftover words → free-text terms
  let word = ''; let start = -1;
  const flush = (end: number) => {
    if (word.length >= 3 && !STOPWORDS.has(word) && start >= 0 && !consumed[start]) c.terms.push(word);
    word = ''; start = -1;
  };
  for (let i = 0; i <= q.length; i++) {
    const ch = q[i] ?? ' ';
    if (/[a-z0-9']/.test(ch)) { if (!word) start = i; word += ch; }
    else flush(i);
  }

  spans.sort((a, b) => a.start - b.start);
  return { criteria: c, spans };
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export interface PersonHit {
  id: string; full_name: string | null; headline: string | null; avatar_url: string | null;
  categoryNames: string[];
  place: string | null; level: 'area' | 'exact' | null; distanceMi: number | null;
  recommenders: string[];   // names from MY mycelium who recommend them
  trusted: boolean;
}

export interface SpaceHit {
  id: string; name: string; kind: string; location: string | null;
  lat: number | null; lng: number | null; distanceMi: number | null;
  recommenders: string[]; trusted: boolean;
}

export interface SmartResults {
  people: PersonHit[];
  posts: FeedPost[];
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

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Does this post's event land inside [today, today+months]? */
function eventInWindow(p: FeedPost, months: number): boolean {
  const ev = p.linked_event;
  if (!ev) return false;
  const today = todayISO();
  const until = addMonths(today, months);
  if (ev.recurrence) {
    // walk the window day by day (≤ ~366 iterations, instant)
    for (let d = today; d <= until; d = nextDay(d)) {
      if (occursOn(ev, d)) return true;
    }
    return false;
  }
  return ev.start_date <= until && (ev.end_date ?? ev.start_date) >= today;
}
function nextDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function postGeo(p: FeedPost): GeoPoint | null {
  if (p.linked_event?.lat != null && p.linked_event?.lng != null) {
    return { lat: p.linked_event.lat, lng: p.linked_event.lng };
  }
  const g = p.details?.geo as { lat?: number; lng?: number } | undefined;
  return g?.lat != null && g?.lng != null ? { lat: g.lat, lng: g.lng } : null;
}

const hasText = (hay: (string | null | undefined)[], terms: string[]) => {
  if (terms.length === 0) return true;
  const s = hay.filter(Boolean).join(' ').toLowerCase();
  return terms.some((t) => s.includes(t));
};

export async function runSmartSearch(c: SearchCriteria, me: string): Promise<SmartResults> {
  // Resolve the radius center first (pre-picked, browser location, or geocode).
  let anchor: GeoPoint | null = c.anchorGeo;
  if (c.radiusMiles != null && !anchor) {
    if (c.nearMe) anchor = await browserLocation();
    if (!anchor && c.anchorText) anchor = (await geocodeSuggest(c.anchorText))[0] ?? null;
  }
  const anchorMissing = c.radiusMiles != null && !anchor;

  const wantPrice = c.free || c.trade || c.paid;
  const catIds = c.categories.map((x) => x.id);

  const [posts, myc, mappable, profRes, spaceRes, pcRes] = await Promise.all([
    loadFeed(200),
    loadMyMycelium(),
    loadMappableMembers().catch(() => [] as MappableMember[]),
    supabase.from('profiles').select('id, full_name, headline, bio, avatar_url').limit(500),
    supabase.from('spaces').select('id, name, kind, location, lat, lng').limit(500),
    catIds.length
      ? supabase.from('profile_categories').select('profile_id, category_id').in('category_id', catIds)
      : Promise.resolve({ data: [] as { profile_id: string; category_id: string }[] }),
  ]);

  const profiles = (profRes.data as { id: string; full_name: string | null; headline: string | null; bio: string | null; avatar_url: string | null }[] | null) ?? [];
  const spaces = (spaceRes.data as { id: string; name: string; kind: string; location: string | null; lat: number | null; lng: number | null }[] | null) ?? [];
  const pcRows = (pcRes.data as { profile_id: string; category_id: string }[] | null) ?? [];

  const mycProfileIds = [...myc].filter((k) => k.startsWith('profile:')).map((k) => k.slice(8));
  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.full_name || 'Someone you trust';

  // Recommendations BY my mycelium, for profiles and spaces (posts reuse the
  // same pattern as the feed's endorsement overlay).
  const [profRecs, spaceRecs, postRecs] = mycProfileIds.length
    ? await Promise.all([
      supabase.from('recommendations').select('recommender_id, target_id')
        .eq('target_type', 'profile').in('recommender_id', mycProfileIds),
      supabase.from('recommendations').select('recommender_id, target_id')
        .eq('target_type', 'space').in('recommender_id', mycProfileIds),
      supabase.from('recommendations').select('recommender_id, target_id')
        .eq('target_type', 'post').in('recommender_id', mycProfileIds),
    ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const recsFor = (rows: { data: unknown }, id: string): string[] =>
    ((rows.data as { recommender_id: string; target_id: string }[] | null) ?? [])
      .filter((r) => r.target_id === id)
      .map((r) => nameOf(r.recommender_id));

  const catNamesFor = (profileId: string): string[] =>
    pcRows.filter((r) => r.profile_id === profileId)
      .map((r) => c.categories.find((x) => x.id === r.category_id)?.name)
      .filter((n): n is string => !!n);

  const spot = (id: string) => mappable.find((m) => m.id === id) ?? null;

  // ── People ──────────────────────────────────────────────────────────────────
  let people: PersonHit[] = profiles
    .filter((p) => p.id !== me)
    .map((p) => {
      const s = spot(p.id);
      return {
        id: p.id, full_name: p.full_name, headline: p.headline, avatar_url: p.avatar_url,
        categoryNames: catNamesFor(p.id),
        place: s?.place ?? null, level: (s?.level as 'area' | 'exact' | undefined) ?? null,
        distanceMi: anchor && s ? milesBetween(anchor, { lat: s.lat, lng: s.lng }) : null,
        recommenders: recsFor(profRecs as { data: unknown }, p.id),
        trusted: myc.has('profile:' + p.id),
        _bio: p.bio,
      } as PersonHit & { _bio: string | null };
    })
    .filter((p) => {
      if (catIds.length && p.categoryNames.length === 0) return false;
      if (c.trusted && !p.trusted) return false;
      if (c.recommended && p.recommenders.length === 0) return false;
      if (anchor && c.radiusMiles != null) {
        if (p.distanceMi == null || p.distanceMi > c.radiusMiles) return false;
      }
      if (!catIds.length && !hasText([p.full_name, p.headline, (p as PersonHit & { _bio: string | null })._bio], c.terms)) return false;
      return true;
    });
  // Only surface people when the query points at people at all.
  const wantsPeople = catIds.length > 0 || c.areas.includes('people')
    || ((c.trusted || c.recommended) && c.areas.length === 0);
  if (!wantsPeople) people = [];
  people.sort((a, b) =>
    (b.recommenders.length - a.recommenders.length)
    || ((a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9))
    || (a.full_name ?? '').localeCompare(b.full_name ?? ''));

  // ── Posts ───────────────────────────────────────────────────────────────────
  const postAreaFilter: ServiceArea[] = c.areas.filter((a) => a !== 'people');
  const postHits = posts.filter((p) => {
    if (postAreaFilter.length && !postAreas(p).some((a) => postAreaFilter.includes(a))) return false;
    if (c.contentTypes.length && !c.contentTypes.includes(p.content_type)) return false;
    if (wantPrice) {
      if (!p.event_mode) return false;
      if (!((c.free && p.event_mode === 'free') || (c.trade && p.event_mode === 'trade') || (c.paid && p.event_mode === 'paid'))) return false;
    }
    // online XOR in-person only filters when exactly one is asked for
    if (c.online !== c.inPerson) {
      const inPerson = postGeo(p) != null;
      if (c.inPerson && !inPerson) return false;
      if (c.online && inPerson) return false;
    }
    if (c.monthsAhead != null && !eventInWindow(p, c.monthsAhead)) return false;
    if (c.trusted && !(myc.has('profile:' + p.author_id) || (p.author_space_id && myc.has('space:' + p.author_space_id)))) return false;
    if (c.recommended && recsFor(postRecs as { data: unknown }, p.id).length === 0
      && recsFor(profRecs as { data: unknown }, p.author_id).length === 0) return false;
    if (anchor && c.radiusMiles != null) {
      const g = postGeo(p);
      if (!g || milesBetween(anchor, g) > c.radiusMiles) return false;
    }
    if (!hasText([p.title, p.body, p.author?.full_name], c.terms)
      && !c.categories.some((cat) => hasText([p.title, p.body], [cat.name.toLowerCase()]))) return false;
    return true;
  });

  // ── Spaces ──────────────────────────────────────────────────────────────────
  let spaceHits: SpaceHit[] = spaces.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, location: s.location,
    lat: s.lat, lng: s.lng,
    distanceMi: anchor && s.lat != null && s.lng != null
      ? milesBetween(anchor, { lat: s.lat, lng: s.lng }) : null,
    recommenders: recsFor(spaceRecs as { data: unknown }, s.id),
    trusted: myc.has('space:' + s.id),
  })).filter((s) => {
    if (c.trusted && !s.trusted) return false;
    if (c.recommended && s.recommenders.length === 0) return false;
    if (anchor && c.radiusMiles != null) {
      if (s.distanceMi == null || s.distanceMi > c.radiusMiles) return false;
    }
    if (!hasText([s.name, s.location], c.terms.length ? c.terms : c.categories.map((x) => x.name.toLowerCase()))) return false;
    return true;
  });
  // Same relevance guard as people: only when the query points at places/orgs.
  const wantsSpaces = c.areas.includes('places') || c.terms.length > 0
    || ((c.trusted || c.recommended) && c.areas.length === 0);
  if (!wantsSpaces) spaceHits = [];
  spaceHits.sort((a, b) =>
    (b.recommenders.length - a.recommenders.length)
    || ((a.distanceMi ?? 1e9) - (b.distanceMi ?? 1e9))
    || a.name.localeCompare(b.name));

  return {
    people: people.slice(0, 25),
    posts: postHits.slice(0, 25),
    spaces: spaceHits.slice(0, 25),
    anchor, anchorMissing,
  };
}
