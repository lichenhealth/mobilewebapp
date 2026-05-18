import { CommunityCardProps } from '../components/CommunityCard';

export interface CommunityMeta {
  name: string;
  members: number;
  description: string;
}

export const MONS_SANA: CommunityMeta = {
  name: 'Mons Sana',
  members: 248,
  description: 'A quiet circle of practitioners working at the intersection of bodywork, land care, and contemplative practice.',
};

export const COMMUNITY_FEED: CommunityCardProps[] = [
  {
    title: 'Tuesday Sitting Circle',
    handle: '@mons-sana',
    avatarMonogram: 'M',
    categoryIcon: 'graduation-cap',
    display: { kind: 'group', count: 14, label: '14 sitting tonight' },
    loveCount: 28,
    commentCount: 6,
    loved: true,
  },
  {
    title: 'Land Tending Day — May 24',
    handle: '@mons-sana-fields',
    avatarMonogram: 'L',
    categoryIcon: 'sparkle',
    display: { kind: 'event', count: 22, label: 'attending' },
    loveCount: 41,
    commentCount: 12,
  },
  {
    title: 'New Member Welcome',
    handle: '@mons-sana',
    avatarMonogram: 'W',
    categoryIcon: 'profile',
    display: { kind: 'group', count: 3, label: 'new this week' },
    loveCount: 17,
    commentCount: 4,
    saved: true,
  },
  {
    title: 'Open Studio — Joon\u2019s Tempera',
    handle: '@joon-paints-slow',
    avatarMonogram: 'J',
    categoryIcon: 'palette',
    display: { kind: 'art', label: 'Saturday, 2\u20136pm' },
    loveCount: 9,
    commentCount: 2,
  },
];
