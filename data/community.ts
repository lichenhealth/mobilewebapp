export interface Member {
  name: string;
  handle: string;
  monogram: string;
  bio: string;
  trustCount: number;
  inCommon: number;
  tags: string[];
}

export const MEMBERS: Member[] = [
  {
    name: 'Mara Beckett',
    handle: '@mara-cascadia',
    monogram: 'M',
    bio: 'Permaculture designer, mother of two, occasional fiddle player. Building soil and small economies in the Willamette.',
    trustCount: 312,
    inCommon: 14,
    tags: ['Growers', 'Music', 'Cascadia'],
  },
  {
    name: 'Theo Ramírez',
    handle: '@theo-builds',
    monogram: 'T',
    bio: 'Timber-frame and natural building. Workshops on weekends. Currently raising a barn in Trinity County.',
    trustCount: 198,
    inCommon: 8,
    tags: ['Builders', 'Workshops'],
  },
  {
    name: 'Joon Park',
    handle: '@joon-paints-slow',
    monogram: 'J',
    bio: 'Egg tempera, slow looking. I keep a studio in the converted granary and host one open day a month.',
    trustCount: 87,
    inCommon: 4,
    tags: ['Creative', 'Studios'],
  },
  {
    name: 'The Quiet Library',
    handle: '@the-quiet-library',
    monogram: 'Q',
    bio: 'A small lending library of essays, field guides, and zines on land, food, and care. Open Wed–Sat.',
    trustCount: 421,
    inCommon: 22,
    tags: ['Library', 'Spaces'],
  },
];

export interface Group {
  name: string;
  members: number;
  description: string;
  active: boolean;
}

export const GROUPS: Group[] = [
  { name: 'Cascadia Growers',  members: 184, description: 'Seasonal sowing, seed swaps, and growing notes.',          active: true  },
  { name: 'Sunday Suppers',    members: 62,  description: 'Rotating dinners at members\u2019 tables, family-style.', active: true  },
  { name: 'Slow Builders',     members: 91,  description: 'Natural building, repair culture, and barn raisings.',     active: false },
  { name: 'Library of Care',   members: 248, description: 'Mental-health peer support and resource sharing.',          active: true  },
];
