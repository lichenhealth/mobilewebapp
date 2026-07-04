import type { FeedCardProps } from '../components/FeedCard';
import { serviceAreaIcon, postAreas, type FeedPost } from './postsApi';
import type { IconName } from '../components/Icon';

// Map a real DB post into the existing FeedCard shape. Shared by Home + Mycelium.
export function postToCard(p: FeedPost): FeedCardProps {
  // Attribution: a space-authored post ("acting as") displays as the entity.
  const name = p.author_space?.name || p.author?.full_name || 'Member';
  const handle = p.author_space
    ? '@' + p.author_space.name.toLowerCase().replace(/\s+/g, '-')
    : '@' + (p.author?.handle || name.toLowerCase().replace(/\s+/g, '-'));
  // Every area the post lives in -> every icon, top-right.
  const icons = postAreas(p)
    .map((a) => serviceAreaIcon(a))
    .filter((i): i is IconName => i != null);
  const title = p.title || (p.body.length > 64 ? p.body.slice(0, 61) + '\u2026' : p.body);
  const media = Array.isArray(p.details?.media)
    ? (p.details.media as FeedCardProps['media'])
    : undefined;
  return {
    title,
    handle,
    // Personal posts show the author's photo when they have one; space-authored
    // posts keep the monogram until spaces get their own images.
    avatar: p.author_space ? undefined : (p.author?.avatar_url ?? undefined),
    avatarMonogram: name.charAt(0).toUpperCase(),
    body: p.body,
    categoryIcons: icons,
    eyebrow: (p.to_mycelium || p.visibility === 'mycelium') ? 'Mycelium' : undefined,
    media,
  };
}
