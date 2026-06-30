import type { FeedCardProps } from '../components/FeedCard';
import { serviceAreaIcon, type FeedPost } from './postsApi';

// Map a real DB post into the existing FeedCard shape. Shared by Home + Mycelium.
export function postToCard(p: FeedPost): FeedCardProps {
  const name = p.author?.full_name || 'Member';
  const icon = serviceAreaIcon(p.service_area);
  const title = p.title || (p.body.length > 64 ? p.body.slice(0, 61) + '…' : p.body);
  const media = Array.isArray(p.details?.media)
    ? (p.details.media as FeedCardProps['media'])
    : undefined;
  return {
    title,
    handle: '@' + (p.author?.handle || name.toLowerCase().replace(/\s+/g, '-')),
    avatarMonogram: name.charAt(0).toUpperCase(),
    body: p.body,
    categoryIcons: icon ? [icon] : [],
    eyebrow: p.visibility === 'mycelium' ? 'Mycelium' : undefined,
    media,
  };
}
