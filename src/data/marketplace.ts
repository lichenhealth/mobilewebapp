/* ====================================================================
   LICHEN — Marketplace data
   Listings span four kinds: goods, services, spaces, and ISO (in-search-of).
   Each listing carries an exchange mode (sale / gift / rent / lend / trade
   / sliding) so members can filter by what they're looking to do.
==================================================================== */

import { IconName } from '../components/Icon';
import { MyceliumSignals } from '../components/EngagementFooter';

export type ListingKind = 'good' | 'service' | 'space' | 'iso';
export type ListingMode = 'sale' | 'gift' | 'rent' | 'lend' | 'trade' | 'sliding';

export const KIND_LABELS: Record<ListingKind, string> = {
  good: 'Goods',
  service: 'Services',
  space: 'Spaces',
  iso: 'ISO',
};

export const MODE_LABELS: Record<ListingMode, string> = {
  sale: 'For sale',
  gift: 'Gift',
  rent: 'Rent',
  lend: 'Lend',
  trade: 'Trade',
  sliding: 'Sliding scale',
};

/** Icon shown in the top-right of each listing card, indicating its mode/type */
export const MODE_ICONS: Record<ListingMode, IconName> = {
  sale: 'store',
  gift: 'heart-line',
  rent: 'rent',
  lend: 'lend',
  trade: 'trade',
  sliding: 'sparkle',
};

export interface Listing {
  id: string;
  kind: ListingKind;
  mode: ListingMode;
  title: string;
  handle: string;
  monogram: string;
  body: string;
  /** Free-form price label: '$425', 'Pay what you can', 'Trade welcome', 'Free' */
  price: string;
  /** Where the listing is located (city, region, "remote") */
  location?: string;
  /** Legacy count fields — no longer shown in UI (relevance over volume) but
   *  kept on the type so existing mock data still validates. */
  trust: number;
  recommends: number;
  comments: number;
  /** Network signals: who in your mycelium has trusted / recommended this */
  mycelium?: MyceliumSignals;
  /** Your own state */
  trusted?: boolean;
  recommended?: boolean;
  saved?: boolean;
  /** Visual: monogram background color */
  color?: string;
}

// ─── Mock listings ────────────────────────────────────────────────────
export const LISTINGS: Listing[] = [
  // ─ Goods ─
  {
    id: 'mountainbeef-quarter',
    kind: 'good',
    mode: 'sale',
    title: 'Quarter share grass-fed beef',
    handle: '@mountainbeef',
    monogram: 'M',
    body: 'Pasture-raised, dry-aged, custom cuts. About 100 lbs cut & wrapped. Pickup or delivery in Oregon & Washington.',
    price: '$425',
    location: 'Wallowa, OR',
    trust: 47, recommends: 22, comments: 8,
    trusted: true,
    mycelium: {
      trusted: [
        { handle: '@mara-cascadia',   name: 'Mara Beckett',  monogram: 'M', color: '#7C8A6D' },
        { handle: '@theo-meridian',   name: 'Theo Albright', monogram: 'T', color: '#9C7355' },
      ],
      recommended: [
        { handle: '@mara-cascadia',   name: 'Mara Beckett',  monogram: 'M', color: '#7C8A6D' },
      ],
    },
    color: '#4A5D3F',
  },
  {
    id: 'mara-scions',
    kind: 'good',
    mode: 'trade',
    title: 'Ashmead\u2019s Kernel apple scions',
    handle: '@mara-cascadia',
    monogram: 'M',
    body: 'Cuttings from a 40-year-old tree. Sharp acid, honey sweet. Trade for elderflower cordial or seeds you love.',
    price: 'Trade welcome',
    location: 'Hood River, OR',
    trust: 18, recommends: 14, comments: 6,
    mycelium: {
      recommended: [
        { handle: '@rosa-quietlibrary', name: 'Rosa Glenn',  monogram: 'R', color: '#6B8A9C' },
      ],
    },
    color: '#7C8A6D',
  },
  {
    id: 'rosa-seeds',
    kind: 'good',
    mode: 'gift',
    title: 'Orange Brandywine tomato seeds',
    handle: '@rosa-quietlibrary',
    monogram: 'R',
    body: 'Last year\u2019s seed save \u2014 plenty to share. Bring your own envelope at Saturday\u2019s swap.',
    price: 'Free',
    location: 'The Back Garden',
    trust: 12, recommends: 9, comments: 3,
    mycelium: {
      trusted: [
        { handle: '@bailey-co', name: 'Bailey Carr', monogram: 'B', color: '#7E6B96' },
        { handle: '@mara-cascadia', name: 'Mara Beckett', monogram: 'M', color: '#7C8A6D' },
        { handle: '@theo-meridian', name: 'Theo Albright', monogram: 'T', color: '#9C7355' },
      ],
      recommended: [
        { handle: '@bailey-co', name: 'Bailey Carr', monogram: 'B', color: '#7E6B96' },
      ],
    },
    color: '#6B8A9C',
  },
  {
    id: 'june-sourdough',
    kind: 'good',
    mode: 'gift',
    title: 'Sourdough starter (\u201CHilde\u201D)',
    handle: '@june-sundaysupper',
    monogram: 'J',
    body: 'Lively, well-fed, six years old. I can deliver a jar to your supper, or hand it off at June\u2019s table.',
    price: 'Free',
    location: 'Portland, OR',
    trust: 22, recommends: 18, comments: 5,
    color: '#C97B3F',
  },
  {
    id: 'joon-tempera',
    kind: 'good',
    mode: 'sliding',
    title: 'Hand-mixed egg tempera',
    handle: '@joon-paints-slow',
    monogram: 'J',
    body: 'Twelve colors, mineral pigments, ground by hand. Cures slow. Best for icon panels and small studies.',
    price: '$35\u2013$80 sliding',
    trust: 9, recommends: 5, comments: 2,
    color: '#7C3F4F',
  },

  // ─ Services ─
  {
    id: 'bailey-craniosacral',
    kind: 'service',
    mode: 'sliding',
    title: 'Craniosacral bodywork sessions',
    handle: '@lichen-bailey-CO',
    monogram: 'B',
    body: 'Trauma-informed, slow-paced sessions for nervous system regulation. 90 min, at the studio or your home.',
    price: '$80\u2013$150 sliding',
    location: 'Denver, CO',
    trust: 31, recommends: 24, comments: 11,
    trusted: true,
    color: '#A89764',
  },
  {
    id: 'theo-timber',
    kind: 'service',
    mode: 'sale',
    title: 'Timber framing & barn raisings',
    handle: '@theo-builds',
    monogram: 'T',
    body: 'Old-method joinery, sustainably sourced. Available for barns, sheds, and pavilions in Cascadia.',
    price: 'Bid by project',
    location: 'Olympia, WA',
    trust: 19, recommends: 12, comments: 4,
    color: '#B8623C',
  },
  {
    id: 'equine-reiki',
    kind: 'service',
    mode: 'sale',
    title: 'Equine reiki & energy work',
    handle: '@lichen-bailey-CO',
    monogram: 'E',
    body: 'For horses with anxiety, recovery from injury, or just deep stillness. By appointment, small herds only.',
    price: '$120/session',
    location: 'Bailey Ranch, CO',
    trust: 14, recommends: 11, comments: 3,
    color: '#A89764',
  },
  {
    id: 'joon-workshops',
    kind: 'service',
    mode: 'sliding',
    title: 'Tempera painting workshop',
    handle: '@joon-paints-slow',
    monogram: 'J',
    body: 'Two-day intensive in the studio. Grinding pigments, panel prep, your first small work to take home.',
    price: '$185 (scholarships available)',
    location: 'Studio Three',
    trust: 7, recommends: 6, comments: 1,
    color: '#7C3F4F',
  },

  // ─ Spaces ─
  {
    id: 'studio-3-open',
    kind: 'space',
    mode: 'gift',
    title: 'Open studio Saturdays',
    handle: '@studio-3',
    monogram: 'S',
    body: 'Bring whatever you\u2019re working on. Coffee, light, quiet hours. Two to six pm, no agenda.',
    price: 'Free, donations welcome',
    location: 'Studio Three',
    trust: 26, recommends: 21, comments: 7,
    saved: true,
    color: '#9C7355',
  },
  {
    id: 'long-table-host',
    kind: 'space',
    mode: 'gift',
    title: 'Sunday Suppers \u2014 hosts welcome',
    handle: '@long-table',
    monogram: 'L',
    body: 'Looking for July & August hosts. We bring food, you set the table. Eight to twelve seats.',
    price: 'Free \u2014 sign up to host',
    location: 'Rotating member tables',
    trust: 15, recommends: 12, comments: 5,
    color: '#B8855C',
  },
  {
    id: 'spare-room-pdx',
    kind: 'space',
    mode: 'rent',
    title: 'Spare room \u2014 quiet Portland house',
    handle: '@june-sundaysupper',
    monogram: 'J',
    body: 'Private room with garden view, shared kitchen, two cats. Members and friends-of-members, two-week min.',
    price: '$45/night',
    location: 'Portland, OR',
    trust: 8, recommends: 6, comments: 2,
    color: '#C97B3F',
  },

  // ─ ISO (In Search Of) ─
  {
    id: 'iso-freezer',
    kind: 'iso',
    mode: 'sale',
    title: 'ISO: used chest freezer, ~5 cu ft',
    handle: '@galyn',
    monogram: 'G',
    body: 'Picking up a quarter share of beef. Looking for a small chest freezer (around 5 cubic feet) in working condition.',
    price: 'Up to $200',
    location: 'Denver, CO',
    trust: 4, recommends: 2, comments: 7,
    color: '#5B6166',
  },
  {
    id: 'iso-lumber-haul',
    kind: 'iso',
    mode: 'trade',
    title: 'ISO: someone driving Eugene → Portland',
    handle: '@theo-builds',
    monogram: 'T',
    body: 'Have a load of reclaimed timber to move on the weekend of June 8. Will trade a day of timber framing labor.',
    price: 'Trade welcome',
    location: 'Eugene → Portland',
    trust: 3, recommends: 1, comments: 4,
    color: '#B8623C',
  },
  {
    id: 'iso-fig-cuttings',
    kind: 'iso',
    mode: 'trade',
    title: 'ISO: Chicago Hardy fig cuttings',
    handle: '@mara-cascadia',
    monogram: 'M',
    body: 'Starting a small fig grove. Looking for 3\u20135 cuttings of Chicago Hardy or similar cold-hardy varieties.',
    price: 'Trade or pay shipping',
    trust: 2, recommends: 1, comments: 2,
    color: '#7C8A6D',
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────
export function listingsByKind(kind: ListingKind | 'all'): Listing[] {
  if (kind === 'all') return LISTINGS;
  return LISTINGS.filter((l) => l.kind === kind);
}

export function listingsByMode(mode: ListingMode | 'all'): Listing[] {
  if (mode === 'all') return LISTINGS;
  return LISTINGS.filter((l) => l.mode === mode);
}
