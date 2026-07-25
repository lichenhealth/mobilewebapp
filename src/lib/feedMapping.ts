import type { FeedCardProps } from '../components/FeedCard';
import { serviceAreaIcon, postAreas, SERVICE_AREAS, type FeedPost } from './postsApi';
import { setInWeb } from './myceliumApi';
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

/** Where a tapped post opens: its event page when it's an event post, else
 *  the post's own page (Figma 286-6331 — every post has a home). */
export function postOpenPath(p: FeedPost): string {
  return p.linked_event_id ? `/events/${p.id}` : `/posts/${p.id}`;
}

/** The entity a card's weave mark acts on: the DISPLAYED author — the space
 *  when posted acting-as, else the person. */
export function weaveTarget(p: FeedPost): { type: 'profile' | 'space'; id: string } {
  return p.author_space_id
    ? { type: 'space', id: p.author_space_id }
    : { type: 'profile', id: p.author_id };
}

/** Card props for the 1-click weave mark. Empty for signed-out viewers and
 *  for the viewer's own person-authored posts (you're not in your own web). */
export function weaveProps(
  p: FeedPost,
  myWeb: Set<string>,
  viewerId?: string,
): Pick<FeedCardProps, 'inWeb' | 'onWeave'> {
  if (!viewerId) return {};
  const t = weaveTarget(p);
  if (t.type === 'profile' && t.id === viewerId) return {};
  return {
    inWeb: myWeb.has(`${t.type}:${t.id}`),
    onWeave: (on) => { void setInWeb(t.type, t.id, on).catch(console.error); },
  };
}

// Map a real DB post into the existing FeedCard shape. Shared by Home + Mycelium.
export function postToCard(p: FeedPost, viewerId?: string): FeedCardProps {
  // Attribution: a space-authored post ("acting as") displays as the entity.
  // Your own nameless posts read "Me", never the anonymous "Member".
  const isMine = !p.author_space && viewerId != null && p.author_id === viewerId;
  const name = p.author_space?.name || p.author?.full_name || (isMine ? 'Me' : 'Member');
  const handle = p.author_space
    ? '@' + p.author_space.name.toLowerCase().replace(/\s+/g, '-')
    : '@' + (p.author?.handle || name.toLowerCase().replace(/\s+/g, '-'));
  // Every area the post lives in -> a DOOR, top-right: tap the Library icon
  // on Melanie's post and land in Melanie's Library — the real section scoped
  // to her presence (founder 2026-07-24), not a search page. Areas without a
  // section of their own keep the author-scoped search (PR #53).
  const scope = p.author_space_id ? `space=${p.author_space_id}` : `member=${p.author_id}`;
  const AREAFEED_DOORS = new Set(['courses', 'library', 'work', 'art', 'food']);
  const areaDoors = postAreas(p)
    .map((a) => {
      const icon = serviceAreaIcon(a);
      if (!icon) return null;
      const areaLabel = SERVICE_AREAS.find((s) => s.value === a)?.label ?? a;
      const to = AREAFEED_DOORS.has(a) ? `/${a}?${scope}` : `/search?${scope}&area=${a}`;
      return { icon, to, label: `${name}'s ${areaLabel}` };
    })
    .filter((d): d is { icon: IconName; to: string; label: string } => d != null);
  const title = p.title || (p.body.length > 64 ? p.body.slice(0, 61) + '\u2026' : p.body);
  const media = Array.isArray(p.details?.media)
    ? (p.details.media as FeedCardProps['media'])
    : undefined;
  // Listings wear their offer: "Rent · $20/day", "Gift", "Sliding scale $20–$60".
  // Sliding scale is a pricing style within For sale, not its own category:
  // fixed price → "For sale · $50", sliding → "For sale · sliding $20–$60".
  const MODE_LABEL: Record<string, string> = {
    gift: 'Gift', sale: 'For sale', sliding: 'For sale',
    trade: 'Trade', rent: 'Rent', lend: 'Lend', borrow: 'Looking to borrow', iso: 'In search of',
  };
  // Work speaks work (founder 2026-07-24): a paid gig says "Pays $30/hr",
  // never "For sale"; freely-offered work reads as what it is.
  const WORK_MODE_LABEL: Record<string, string> = {
    ...MODE_LABEL, sale: 'Pays', sliding: 'Pays', gift: 'Offered freely',
  };
  const rawMode = typeof p.details?.mode === 'string' ? (p.details.mode as string) : undefined;
  const isWork = postAreas(p).includes('work');
  const mode = rawMode ? (isWork ? WORK_MODE_LABEL[rawMode] : MODE_LABEL[rawMode]) : undefined;
  const rawPrice = typeof p.details?.price === 'string' ? (p.details.price as string) : undefined;
  const price = rawMode === 'sliding' && rawPrice
    ? 'sliding ' + rawPrice.replace(/^sliding scale\s*/i, '')
    : rawPrice;
  // Entrusted gifts say so: the giver handed allocation to the mycelium.
  const entrusted = rawMode === 'gift' && p.details?.allocation === 'lichen';
  const offerLine = mode
    ? (price ? `${mode} · ${price}` : entrusted ? `${mode} · Lichen routes` : mode)
    : undefined;
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
    // Example content wears a small badge so nobody mistakes it for the real
    // economy (founder 2026-07-24 — demo posts teach how the platform works).
    demo: p.details?.demo === true,
    areaDoors,
    eyebrow: offerLine ?? ((p.to_mycelium || p.visibility === 'mycelium') ? 'Mycelium' : undefined),
    media,
    previews,
  };
}
