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
  /** Network member ids in this community (people, providers, orgs, places) */
  memberIds: string[];
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
    memberIds: ['joon', 'rosa', 'bailey', 'marcus', 'mara', 'theo', 'equine-reiki', 'studio-3'],
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
    memberIds: ['bailey', 'marcus', 'rosa', 'heroes-journey'],
    filters: ['All', 'Social', 'Educational', 'Actionable'],
    categoryIcons: [
      { icon: 'search',         label: 'Search'   },
      { icon: 'plus',           label: 'Post'     },
      { icon: 'profile',        label: 'Members'  },
      { icon: 'store',          label: 'Goods'    },
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
      display: { kind: 'group', count: 14, label: 'sitting tonight' },
      mycelium: {
        trusted: [
          { handle: '@mara-cascadia', name: 'Mara Beckett', monogram: 'M', color: '#7C8A6D' },
        ],
        recommended: [
          { handle: '@mara-cascadia', name: 'Mara Beckett', monogram: 'M', color: '#7C8A6D' },
          { handle: '@bailey-co', name: 'Bailey Carr', monogram: 'B', color: '#7E6B96' },
        ],
      },
    },
    {
      title: 'Land Tending Day \u2014 May 24',
      handle: '@mons-sana-fields',
      avatarMonogram: 'L',
      categoryIcon: 'sparkle',
      display: { kind: 'event', count: 22, label: 'attending' },
      mycelium: {
        trusted: [
          { handle: '@theo-meridian', name: 'Theo Albright', monogram: 'T', color: '#9C7355' },
          { handle: '@rosa-quietlibrary', name: 'Rosa Glenn', monogram: 'R', color: '#6B8A9C' },
        ],
      },
    },
    {
      title: 'New Member Welcome',
      handle: '@mons-sana',
      avatarMonogram: 'W',
      categoryIcon: 'profile',
      display: { kind: 'group', count: 3, label: 'new this week' },
      saved: true,
    },
    {
      title: 'Open Studio \u2014 Joon\u2019s Tempera',
      handle: '@joon-paints-slow',
      avatarMonogram: 'J',
      categoryIcon: 'palette',
      display: { kind: 'art', label: 'Saturday, 2\u20136pm' },
      
    },
  ],
  'stargate': [
    {
      title: 'Tuesday Integration Group',
      handle: '@stargate',
      avatarMonogram: 'S',
      categoryIcon: 'graduation-cap',
      display: { kind: 'group', count: 9, label: 'attending this week' },
      
    },
    {
      title: 'Reading: Iain McGilchrist',
      handle: '@stargate-library',
      avatarMonogram: 'R',
      categoryIcon: 'book',
      display: { kind: 'group', count: 14, label: 'reading' },
      
    },
    {
      title: 'Quiet Day at the River \u2014 June 1',
      handle: '@stargate',
      avatarMonogram: 'Q',
      categoryIcon: 'sparkle',
      display: { kind: 'event', count: 7, label: 'attending' },
      saved: true,
    },
    {
      title: 'Stewards Office Hours',
      handle: '@stargate-stewards',
      avatarMonogram: 'O',
      categoryIcon: 'shield-user',
      display: { kind: 'group', count: 4, label: 'stewards on call' },
      
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
  /** Network member ids in this group */
  memberIds: string[];
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
    memberIds: ['mara', 'theo', 'rosa', 'marcus', 'june', 'bailey', 'cascadia-coop', 'back-garden'],
    filters: ['All', 'Notes', 'Swaps', 'Events'],
    categoryIcons: [
      { icon: 'search',  label: 'Search'   },
      { icon: 'plus',    label: 'Post'     },
      { icon: 'profile', label: 'Members'  },
      { icon: 'store',   label: 'Swaps'    },
      { icon: 'sparkle', label: 'Events'   },
    ],
  },
  {
    id: 'sunday-suppers',
    name: 'Sunday Suppers',
    handle: '@sunday-suppers',
    description: 'Rotating dinners at members\u2019 tables. Bring something or just bring yourself.',
    members: 62,
    memberIds: ['june', 'theo', 'rosa', 'mara', 'long-table'],
    filters: ['All', 'Upcoming', 'Past'],
    categoryIcons: [
      { icon: 'search',     label: 'Search'   },
      { icon: 'plus',       label: 'Post'     },
      { icon: 'profile',    label: 'Members'  },
      { icon: 'sparkle',    label: 'Events'   },
      { icon: 'fork-spoon', label: 'Menus'    },
      { icon: 'store',      label: 'Goods'    },
    ],
  },
  {
    id: 'mons-sana-bodywork',
    name: 'Bodywork Practitioners',
    handle: '@mons-sana-bodywork',
    description: 'Mons Sana members offering and receiving bodywork \u2014 craniosacral, somatic experiencing, and adjacent.',
    members: 38,
    memberIds: ['bailey', 'rosa', 'equine-reiki'],
    communityId: 'mons-sana',
    filters: ['All', 'Notes', 'Cases', 'Events'],
    categoryIcons: [
      { icon: 'search',  label: 'Search'   },
      { icon: 'plus',    label: 'Post'     },
      { icon: 'profile', label: 'Members'  },
      { icon: 'health',  label: 'Cases'    },
      { icon: 'sparkle', label: 'Events'   },
      { icon: 'store',   label: 'Services' },
    ],
  },
];

export function getGroup(id: string): GroupMeta | undefined {
  return GROUPS.find((g) => g.id === id);
}

// ─── Scope resolution ───────────────────────────────────────────────
// Given a scope expression like "community:mons-sana", "group:cascadia-growers",
// or "type:provider", returns the set of @handles that belong to that scope.
// Used by the Marketplace (and future sections) to filter listings by context.

export type ScopeKind = 'community' | 'group' | 'type';

export interface Scope {
  kind: ScopeKind;
  id: string;          // community id, group id, or NetworkType
  label: string;       // human-readable name for the chip
}

/** Parse a "kind:id" string into a Scope, returning null if unrecognized. */
export function parseScope(raw: string | null): Scope | null {
  if (!raw) return null;
  const [kind, id] = raw.split(':');
  if (kind === 'community') {
    const c = COMMUNITIES.find((x) => x.id === id);
    if (!c) return null;
    return { kind: 'community', id, label: c.name };
  }
  if (kind === 'group') {
    const g = GROUPS.find((x) => x.id === id);
    if (!g) return null;
    return { kind: 'group', id, label: g.name };
  }
  if (kind === 'type') {
    const label = NETWORK_LABELS[id as NetworkType];
    if (!label) return null;
    return { kind: 'type', id, label };
  }
  return null;
}

/** Set of @handles belonging to a given scope (used to filter listings, etc). */
export function handlesInScope(scope: Scope): Set<string> {
  const handles = new Set<string>();
  const addMember = (memberId: string) => {
    const member = NETWORK_MEMBERS.find((m) => m.id === memberId);
    if (member) handles.add(member.handle);
  };
  if (scope.kind === 'community') {
    const c = COMMUNITIES.find((x) => x.id === scope.id);
    c?.memberIds.forEach(addMember);
  } else if (scope.kind === 'group') {
    const g = GROUPS.find((x) => x.id === scope.id);
    g?.memberIds.forEach(addMember);
  } else if (scope.kind === 'type') {
    NETWORK_MEMBERS.filter((m) => m.type === scope.id).forEach((m) => handles.add(m.handle));
  }
  return handles;
}
export const GROUP_FEEDS: Record<string, CommunityCardProps[]> = {
  'cascadia-growers': [
    {
      title: 'Flea beetle is early this year',
      handle: '@mara-cascadia',
      avatarMonogram: 'M',
      categoryIcon: 'sparkle',
      display: { kind: 'group', count: 6, label: 'replies' },
      
    },
    {
      title: 'Seed swap Saturday \u2014 back garden',
      handle: '@cascadia-growers',
      avatarMonogram: 'S',
      categoryIcon: 'store',
      display: { kind: 'event', count: 28, label: 'bringing seeds' },
      
    },
    {
      title: 'Ashmead\u2019s Kernel scions available',
      handle: '@mara-cascadia',
      avatarMonogram: 'M',
      categoryIcon: 'palette',
      display: { kind: 'group', count: 4, label: 'takers so far' },
      
    },
  ],
  'sunday-suppers': [
    {
      title: 'This Sunday at June\u2019s \u2014 6pm',
      handle: '@june-sundaysupper',
      avatarMonogram: 'J',
      categoryIcon: 'fork-spoon',
      display: { kind: 'event', count: 9, label: 'coming' },
      
    },
    {
      title: 'Hosts for July',
      handle: '@sunday-suppers',
      avatarMonogram: 'H',
      categoryIcon: 'profile',
      display: { kind: 'group', count: 5, label: 'tables open' },
      
    },
  ],
  'mons-sana-bodywork': [
    {
      title: 'Craniosacral peer practice \u2014 May 26',
      handle: '@mons-sana-bodywork',
      avatarMonogram: 'C',
      categoryIcon: 'health',
      display: { kind: 'event', count: 6, label: 'practitioners' },
      
    },
    {
      title: 'Case notes: chronic shoulder holding',
      handle: '@rosa-quietlibrary',
      avatarMonogram: 'R',
      categoryIcon: 'graduation-cap',
      display: { kind: 'group', count: 4, label: 'reflections' },
      
    },
  ],
};
