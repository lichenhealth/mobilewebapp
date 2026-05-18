import { FeedCardProps } from '../components/FeedCard';

export const FEED: FeedCardProps[] = [
  {
    title: "It's Beef Ordering Time!",
    handle: '@mountainbeef',
    avatarMonogram: 'M',
    categoryIcons: ['store', 'fork-spoon'],
    body:
      "Time to order your whole, half and quarter shares of grass-fed, grass-finished beef for delivery to our Oregon and Washington State locations, or via our nation-wide shipping options. Pricing based on projected order volumes is available on our booking page. Please reach out to Mark with any questions.",
    image: {
      pattern: 'beef',
      topLabel: 'Buy',
      bottomLabel: 'Order',
      tone: 'peach',
    },
    trustCount: 124,
    recommendCount: 38,
    trusted: true,
  },
  {
    title: 'Support Recovery',
    handle: '@heroesjourneycenter',
    avatarMonogram: 'H',
    categoryIcons: ['graduation-cap', 'book'],
    body:
      "Hello fellow warriors. We're excited to announce a FREE, online course that teaches loved ones how to best support our brothers and sisters seeking treatment for addiction. Facilitated by certified peer support professionals, we're also offering an online consultation group on Thursdays via Zoom with a rotating team of certified peer support specialists.",
    image: {
      pattern: 'support',
      topLabel: 'Zoom',
      bottomLabel: 'Join',
      tone: 'peach',
    },
    trustCount: 64,
    recommendCount: 22,
  },
  {
    title: 'Equine Assisted Reiki',
    handle: '@lichen-bailey-CO',
    avatarMonogram: 'B',
    categoryIcons: ['health', 'location'],
    body:
      "We are thrilled to announce the addition of equine-assisted Reiki sessions at the Bailey ranch — a slow, embodied practice that pairs traditional energy work with the steady presence of our resident horses. Sessions are 90 minutes and held weekly.",
    image: {
      pattern: 'reiki',
      topLabel: 'Book',
      bottomLabel: 'Visit',
      tone: 'peach',
    },
    trustCount: 41,
    recommendCount: 17,
  },
  {
    title: 'Spring Seed Swap',
    handle: '@neighborhood-garden',
    avatarMonogram: 'G',
    categoryIcons: ['palette', 'sparkle'],
    body:
      "Bring what you have, take what you need. We'll be in the back garden of the community house from 10 to 2 on Saturday — heirloom tomatoes, native flowers, herbs, and the usual brassicas. Coffee provided.",
    trustCount: 89,
    recommendCount: 31,
    saved: true,
  },
];
