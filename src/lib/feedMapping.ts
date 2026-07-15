import type { FeedCardProps } from '../components/FeedCard';
import { serviceAreaIcon, postAreas, type FeedPost } from './postsApi';
import type { IconName } from '../components/Icon';

/** How you'd consume a post — derived, never declared: video (or a YouTube
 *  preview) → watch · audio (or Spotify/SoundCloud/Bandcamp links) → listen ·
 *  images → look · plain text → read. Priority: watch > listen > look > read. */
export type PostMedium = 'read' | 'look' | 'listen' | 'watch';
export function postMedium(p: FeedPostLike): PostMedium {
  const media = Array.isArray(p.details?.media)
    ? (p.details.media as { type: string; url: string }[]) : [];
  const previews = Array.isArray(p.details?.previews)
    ? (p.details.previews as { url: string; kind: string }[]) : [];
  if (media.some((m) => m.type === 'video')
    || previews.some((v) => v.kind === 'youtube' || /vimeo\.com/i.test(v.url))) return 'watch';
  if (media.some((m) => m.type === 'audio')
    || previews.some((v) => /spotify\.com|soundcloud\.com|bandcamp\.com/i.test(v.url))) return 'listen';
  if (media.some((m) => m.type === 'photo') || p.image_url) return 'look';
  return 'read';
}
interface FeedPostLike { details: Record<string, unknown>; image_url: string | null }

// Map a real DB post into the existing FeedCard shape. Shared by Home + Mycelium.
export function postToCard(p: FeedPost, viewerId?: string): FeedCardProps {
  // Attribution: a space-authored post ("acting as") displays as the entity.
  // Your own nameless posts read "Me", never the anonymous "Member".
  const isMine = !p.author_space && viewerId != null && p.author_id === viewerId;
  const name = p.author_space?.name || p.author?.full_name || (isMine ? 'Me' : 'Member');
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
  // Listings wear their offer: "Rent · $20/day", "Gift", "Sliding scale $20–$60".
  const MODE_LABEL: Record<string, string> = {
    gift: 'Gift', sale: 'For sale', sliding: 'Sliding scale',
    trade: 'Trade', rent: 'Rent', lend: 'Lend', borrow: 'Looking to borrow', iso: 'In search of',
  };
  const mode = typeof p.details?.mode === 'string' ? MODE_LABEL[p.details.mode as string] : undefined;
  const price = typeof p.details?.price === 'string' ? (p.details.price as string) : undefined;
  const offerLine = mode ? (price && !price.toLowerCase().startsWith('sliding') ? `${mode} · ${price}` : mode === 'Sliding scale' && price ? price : mode) : undefined;
  const previews = Array.isArray(p.details?.previews)
    ? (p.details.previews as FeedCardProps['previews'])
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
    eyebrow: offerLine ?? ((p.to_mycelium || p.visibility === 'mycelium') ? 'Mycelium' : undefined),
    media,
    previews,
  };
}
