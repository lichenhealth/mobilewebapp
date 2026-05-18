/* ====================================================================
   LICHEN — Network data
   The data model behind the side navigation:
     Mycelium    = everyone you're connected to
                   (people, providers, organizations, places)
     Communities = communities you're a member of (each has its own feed)
     Groups      = smaller circles; can be standalone or nested in a community
==================================================================== */

import { CommunityCardProps } from '../components/CommunityCard';
import { IconName } from '../components/Icon';

// ─── Mycelium: people, providers, organizations, places ──────────────
export type NetworkType = 'person' | 'provider' | 'organization' | 'place';

export interface NetworkMember {
  id: string;
  name: string;
  handle: string;
  monogram: string;
  type: NetworkType;
  blurb: string;
  color?: string;
}

export const NETWORK_LABELS: Record<NetworkType, string> = {
  person: 'People',
  provider: 'Providers',
  organization: 'Organizations',
  place: 'Places',
};

export const NETWORK_MEMBERS: NetworkMember[] = [
  // ─ People ─
  { id: 'mara',    name: 'Mara Beckett',  handle: '@mara-cascadia',      monogram: 'M', type: 'person', blurb: 'Apple grafter, seed saver, brassicas correspondent', color: '#7C8A6D' },
  { id: 'rosa',    name: 'Rosa Inoue',    handle: '@rosa-quietlibrary',  monogram: 'R', type: 'person', blurb: 'Librarian and host of slow Sundays',                color: '#6B8A9C' },
  { id: 'june',    name: 'June Okafor',   handle: '@june-sundaysupper',  monogram: 'J', type: 'person', blurb: 'Sourdough, suppers, hospitality',                   color: '#C97B3F' },
  { id: 'joon',    name: 'Joon Park',     handle: '@joon-paints-slow',   monogram: 'J', type: 'person', blurb: 'Tempera painter, open studio Saturdays',            color: '#7C3F4F' },
  { id: 'marcus',  name: 'Marcus Liu',    handle: '@marcus-fieldnotes',  monogram: 'M', type: 'person', blurb: 'Field notes, ecology, row covers',                  color: '#3A4742' },
  { id: 'bailey',  name: 'Bailey Cole',   handle: '@lichen-bailey-CO',   monogram: 'B', type: 'person', blurb: 'Quiet showers Saturday painter',                    color: '#A89764' },
  // ─ Providers ─
  { id: 'mark',           name: 'Mark Sutter',          handle: '@mountainbeef',     monogram: 'M', type: 'provider', blurb: 'Grass-finished beef, quarter & half shares', color: '#4A5D3F' },
  { id: 'theo',           name: 'Theo Ramírez',         handle: '@theo-builds',      monogram: 'T', type: 'provider', blurb: 'Timber framer, barn raisings',                color: '#B8623C' },
  { id: 'equine-reiki',   name: 'Bailey @ Equine Reiki',handle: '@lichen-bailey-CO', monogram: 'E', type: 'provider', blurb: 'Energy work with horses, by appointment',     color: '#A89764' },
  // ─ Organizations ─
  { id: 'mons-sana-org',  name: 'Mons Sana Collective', handle: '@mons-sana',           monogram: 'M', type: 'organization', blurb: 'Bodywork and contemplative practice',     color: '#5C6B5A' },
  { id: 'heroes-journey', name: 'Heroes Journey Center',handle: '@heroesjourneycenter', monogram: 'H', type: 'organization', blurb: 'Free, online peer recovery support',      color: '#7E6B96' },
  { id: 'cascadia-coop',  name: 'Cascadia Seed Co-op',  handle: '@cascadia-seed',       monogram: 'C', type: 'organization', blurb: 'Open-pollinated seed library and swaps',  color: '#6A8155' },
  // ─ Places ─
  { id: 'back-garden',  name: 'The Back Garden', handle: '@back-garden', monogram: 'B', type: 'place', blurb: 'Seed swaps, Saturdays 10\u20132',           color: '#7A8C6A' },
  { id: 'studio-3',     name: 'Studio Three',    handle: '@studio-3',    monogram: 'S', type: 'place', blurb: 'Open painting, Saturday 2\u20136pm',        color: '#9C7355' },
  { id: 'long-table',   name: 'The Long Table',  handle: '@long-table',  monogram: 'L', type: 'place', blurb: 'Sunday suppers, rotating hosts',           color: '#B8855C' },
];

export function membersByType(type: NetworkType): NetworkMember[] {
  return NETWORK_MEMBERS.filter((m) => m.type === type);
}

// ─── Communities: the user is a member of these ──────────────────────
export interface CommunityMeta {
  id: string;
  name: string;
  handle: string;
  description: string;
  members: number;
  newThisWeek: number;
  /** Filter chips for the community feed */
  filters: string[];
  /** Round icon-button row shown above the feed */
  categoryIcons: { icon: IconName; label: string }[];
}

export const COMMUNITIES: CommunityMeta[] = [
  {
    id: 'mons-sana',
    name: 'Mons Sana',
    handle: '@mons-sana',
    description: 'A quiet circle of practitioners working at the intersection of bodywork, land care, and contemplative practice.',
    members: 248,
    newThisWeek: 3,
    filters: ['All', 'Social', 'Creative', 'Educational', 'Actionable'],
    categoryIcons: [
      { icon: 'search',         label: 'Search'   },
      { icon: 'plus',           label: 'Post'     },
      { icon: 'profile',        label: 'Members'  },
      { icon: 'store',          label: 'Goods'    },
      { icon: 'briefcase',      label: 'Work'     },
      { icon: 'graduation-cap', label: 'Learn'    },
      { icon: 'book',           label: 'Library'  },
      { icon: 'sparkle',        label: 'Events'   },
      { icon: 'location',       label: 'Places'   },
      { icon: 'palette',        label: 'Creative' },
    ],
  },
  {
    id: 'stargate',
    name: 'Stargate',
    handle: '@stargate',
    description: 'A small, deliberate circle of people exploring consciousness, plant medicine, and contemplative recovery.',
    members: 96,
    newThisWeek: 2,
    filters: ['All', 'Social', 'Educational', 'Actionable'],
    categoryIcons: [
      { icon: 'search',         label: 'Search'   },
      { icon: 'plus',           label: 'Post'     },
      { icon: 'profile',        label: 'Members'  },
      { icon: 'graduation-cap', label: 'Learn'    },
      { icon: 'book',           label: 'Library'  },
      { icon: 'sparkle',        label: 'Events'   },
      { icon: 'shield-user',    label: 'Stewards' },
    ],
  },
];

export function getCommunity(id: string): CommunityMeta | undefined {
  return COMMUNITIES.find((c) => c.id === id);
}

// ─── Community feeds ─────────────────────────────────────────────────
export const COMMUNITY_FEEDS: Record<string, CommunityCardProps[]> = {
  'mons-sana': [
    {
      title: 'Tuesday Sitting Circle',
      handle: '@mons-sana',
      avatarMonogram: 'M',
      categoryIcon: 'graduation-cap',
      display: { kind: 'group', count: 14, label: '14 sitting tonight' },
      loveCount: 28, commentCount: 6, loved: true,
    },
    {
      title: 'Land Tending Day \u2014 May 24',
      handle: '@mons-sana-fields',
      avatarMonogram: 'L',
      categoryIcon: 'sparkle',
      display: { kind: 'event', count: 22, label: 'attending' },
      loveCount: 41, commentCount: 12,
    },
    {
      title: 'New Member Welcome',
      handle: '@mons-sana',
      avatarMonogram: 'W',
      categoryIcon: 'profile',
      display: { kind: 'group', count: 3, label: 'new this week' },
      loveCount: 17, commentCount: 4, saved: true,
    },
    {
      title: 'Open Studio \u2014 Joon\u2019s Tempera',
      handle: '@joon-paints-slow',
      avatarMonogram: 'J',
      categoryIcon: 'palette',
      display: { kind: 'art', label: 'Saturday, 2\u20136pm' },
      loveCount: 9, commentCount: 2,
    },
  ],
  'stargate': [
    {
      title: 'Tuesday Integration Group',
      handle: '@stargate',
      avatarMonogram: 'S',
      categoryIcon: 'graduation-cap',
      display: { kind: 'group', count: 9, label: '9 attending this week' },
      loveCount: 22, commentCount: 7, loved: true,
    },
    {
      title: 'Reading: Iain McGilchrist',
      handle: '@stargate-library',
      avatarMonogram: 'R',
      categoryIcon: 'book',
      display: { kind: 'group', count: 14, label: '14 reading' },
      loveCount: 19, commentCount: 11,
    },
    {
      title: 'Quiet Day at the River \u2014 June 1',
      handle: '@stargate',
      avatarMonogram: 'Q',
      categoryIcon: 'sparkle',
      display: { kind: 'event', count: 7, label: 'attending' },
      loveCount: 12, commentCount: 3, saved: true,
    },
    {
      title: 'Stewards Office Hours',
      handle: '@stargate-stewards',
      avatarMonogram: 'O',
      categoryIcon: 'shield-user',
      display: { kind: 'group', count: 4, label: 'stewards on call' },
      loveCount: 8, commentCount: 1,
    },
  ],
};

// ─── Groups ──────────────────────────────────────────────────────────
export interface GroupMeta {
  id: string;
  name: string;
  handle: string;
  description: string;
  members: number;
  /** Optional parent community */
  communityId?: string;
  filters: string[];
  categoryIcons: { icon: IconName; label: string }[];
}

export const GROUPS: GroupMeta[] = [
  {
    id: 'cascadia-growers',
    name: 'Cascadia Growers',
    handle: '@cascadia-growers',
    description: 'Seasonal sowing, seed swaps, growing notes, mutual aid for brassicas season.',
    members: 184,
    filters: ['All', 'Notes', 'Swaps', 'Events'],
    categoryIcons: [
      { icon: 'search', label: 'Search'   },
      { icon: 'plus',   label: 'Post'     },
      { icon: 'profile',label: 'Members'  },
      { icon: 'sparkle',label: 'Events'   },
      { icon: 'store',  label: 'Swaps'    },
    ],
  },
  {
    id: 'sunday-suppers',
    name: 'Sunday Suppers',
    handle: '@sunday-suppers',
    description: 'Rotating dinners at members\u2019 tables. Bring something or just bring yourself.',
    members: 62,
    filters: ['All', 'Upcoming', 'Past'],
    categoryIcons: [
      { icon: 'search',     label: 'Search'   },
      { icon: 'plus',       label: 'Post'     },
      { icon: 'profile',    label: 'Members'  },
      { icon: 'sparkle',    label: 'Events'   },
      { icon: 'fork-spoon', label: 'Menus'    },
    ],
  },
  {
    id: 'mons-sana-bodywork',
    name: 'Bodywork Practitioners',
    handle: '@mons-sana-bodywork',
    description: 'Mons Sana members offering and receiving bodywork \u2014 craniosacral, somatic experiencing, and adjacent.',
    members: 38,
    communityId: 'mons-sana',
    filters: ['All', 'Notes', 'Cases', 'Events'],
    categoryIcons: [
      { icon: 'search',  label: 'Search'   },
      { icon: 'plus',    label: 'Post'     },
      { icon: 'profile', label: 'Members'  },
      { icon: 'health',  label: 'Cases'    },
      { icon: 'sparkle', label: 'Events'   },
    ],
  },
];

export function getGroup(id: string): GroupMeta | undefined {
  return GROUPS.find((g) => g.id === id);
}

// ─── Group feeds ─────────────────────────────────────────────────────
export const GROUP_FEEDS: Record<string, CommunityCardProps[]> = {
  'cascadia-growers': [
    {
      title: 'Flea beetle is early this year',
      handle: '@mara-cascadia',
      avatarMonogram: 'M',
      categoryIcon: 'sparkle',
      display: { kind: 'group', count: 6, label: '6 replies' },
      loveCount: 11, commentCount: 6,
    },
    {
      title: 'Seed swap Saturday \u2014 back garden',
      handle: '@cascadia-growers',
      avatarMonogram: 'S',
      categoryIcon: 'store',
      display: { kind: 'event', count: 28, label: 'bringing seeds' },
      loveCount: 34, commentCount: 9, loved: true,
    },
    {
      title: 'Ashmead\u2019s Kernel scions available',
      handle: '@mara-cascadia',
      avatarMonogram: 'M',
      categoryIcon: 'palette',
      display: { kind: 'group', count: 4, label: '4 takers so far' },
      loveCount: 12, commentCount: 4,
    },
  ],
  'sunday-suppers': [
    {
      title: 'This Sunday at June\u2019s \u2014 6pm',
      handle: '@june-sundaysupper',
      avatarMonogram: 'J',
      categoryIcon: 'fork-spoon',
      display: { kind: 'event', count: 9, label: 'coming' },
      loveCount: 18, commentCount: 5, loved: true,
    },
    {
      title: 'Hosts for July',
      handle: '@sunday-suppers',
      avatarMonogram: 'H',
      categoryIcon: 'profile',
      display: { kind: 'group', count: 5, label: 'tables open' },
      loveCount: 7, commentCount: 2,
    },
  ],
  'mons-sana-bodywork': [
    {
      title: 'Craniosacral peer practice \u2014 May 26',
      handle: '@mons-sana-bodywork',
      avatarMonogram: 'C',
      categoryIcon: 'health',
      display: { kind: 'event', count: 6, label: 'practitioners' },
      loveCount: 11, commentCount: 3,
    },
    {
      title: 'Case notes: chronic shoulder holding',
      handle: '@rosa-quietlibrary',
      avatarMonogram: 'R',
      categoryIcon: 'graduation-cap',
      display: { kind: 'group', count: 4, label: '4 reflections' },
      loveCount: 8, commentCount: 4,
    },
  ],
};
