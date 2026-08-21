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
  if (p.linked_event_id) return `/events/${p.id}`;
  // A collection's door-post opens the whole collection (founder 2026-08-14).
  const col = (p.details as { collectionId?: string } | null)?.collectionId;
  return typeof col === 'string' && col ? `/collections/${col}` : `/posts/${p.id}`;
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
export function postToCard(
  p: FeedPost, viewerId?: string, spaceNames?: Map<string, string>,
): FeedCardProps {
  // Attribution: a space-authored post ("acting as") displays as the entity.
  // Your own nameless posts read "Me", never the anonymous "Member".
  const isMine = !p.author_space && viewerId != null && p.author_id === viewerId;
  const name = p.author_space?.name || p.author?.full_name || (isMine ? 'Me' : 'Member');
  const handle = p.author_space
    ? '@' + p.author_space.name.toLowerCase().replace(/\s+/g, '-')
    : '@' + (p.author?.handle || name.toLowerCase().replace(/\s+/g, '-'));
  // Every area the post lives in -> a DOOR, top-right: tap the Library icon
  // on Melanie's post and land in Melanie's Library — the real section scoped
  // to her presence (founder 2026-07-24; marketplace/events joined 2026-07-25),
  // never a search page. Only sectionless areas (places) keep the
  // author-scoped search (PR #53).
  const scope = p.author_space_id ? `space=${p.author_space_id}` : `member=${p.author_id}`;
  const SECTION_DOORS: Record<string, string> = {
    courses: '/courses', library: '/library', work: '/work', art: '/art',
    food: '/food', marketplace: '/market', events: '/events', travel: '/travel',
  };
  const areaDoors = postAreas(p)
    .map((a) => {
      const icon = serviceAreaIcon(a);
      if (!icon) return null;
      const areaLabel = SERVICE_AREAS.find((s) => s.value === a)?.label ?? a;
      const to = SECTION_DOORS[a] ? `${SECTION_DOORS[a]}?${scope}` : `/search?${scope}&area=${a}`;
      return { icon, to, label: `${name}'s ${areaLabel}` };
    })
    .filter((d): d is { icon: IconName; to: string; label: string } => d != null);
  const title = p.title || (p.body.length > 64 ? p.body.slice(0, 61) + '\u2026' : p.body);
  const media = Array.isArray(p.details?.media)
    ? (p.details.media as FeedCardProps['media'])
    : undefined;
  const noDownload = p.details?.noDownload === true;
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
  // Multi-mode offers (founder 2026-07-27): details.modes lists every door —
  // "Gift to Veterans · For sale · $40". Singles fall back to details.mode.
  const rawModes: string[] = Array.isArray(p.details?.modes)
    ? (p.details.modes as unknown[]).filter((m): m is string => typeof m === 'string')
    : rawMode ? [rawMode] : [];
  const isWork = postAreas(p).includes('work');
  const rawIdents = p.details?.forIdentities ?? p.details?.giftToIdentities;   // pre-rename posts
  const forIdents = Array.isArray(rawIdents)
    ? (rawIdents as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const giftFree = typeof p.details?.giftTo === 'string' ? (p.details.giftTo as string) : undefined;
  // Identities lead ("Gift to Firefighters, Nurses"); free text carries what
  // the vocabulary can't.
  const giftTo = [forIdents.join(', '), giftFree].filter(Boolean).join(' · ') || undefined;
  const labels = [...new Set(rawModes.map((m) => {
    const base = isWork ? WORK_MODE_LABEL[m] : MODE_LABEL[m];
    return m === 'gift' && giftTo ? `${base} to ${giftTo}` : base;
  }).filter(Boolean))];
  // A non-gift offering still says who it's for ("For Veterans, Teachers").
  if (forIdents.length && !rawModes.includes('gift')) labels.push(`For ${forIdents.join(', ')}`);
  const mode = labels.length ? labels.join(' · ') : undefined;
  const rawPrice = typeof p.details?.price === 'string' ? (p.details.price as string) : undefined;
  const price = rawModes.includes('sliding') && rawPrice
    ? 'sliding ' + rawPrice.replace(/^sliding scale\s*/i, '')
    : rawPrice;
  // Entrusted gifts say so: the giver handed allocation to the mycelium.
  const entrusted = rawModes.includes('gift') && p.details?.allocation === 'lichen';
  const offerLine = mode
    ? (price ? `${mode} · ${price}` : entrusted ? `${mode} · Lichen routes` : mode)
    : undefined;
  const previews = Array.isArray(p.details?.previews)
    ? (p.details.previews as FeedCardProps['previews'])
    : undefined;
  // ── Provenance (founder 2026-07-28): who made it, and where they put it.
  //    "Melanie Bright → Melanie Bright Community". Acting AS the space you
  //    posted into is redundant — the identity row already says it, so the
  //    route stays silent. A second admin posting into a space they steward
  //    still shows their own name beside it, and so does a member whose
  //    suggestion was approved onto the shelf: attribution follows the person.
  const routeIds = (p.audience_space_ids ?? []).filter((id) => id !== p.author_space_id);
  const routeNames = spaceNames
    ? routeIds.map((id) => spaceNames.get(id)).filter((n): n is string => !!n)
    : [];
  const route = routeNames.length
    ? { to: routeIds.find((id) => spaceNames?.get(id)) ?? '', names: routeNames.slice(0, 2) }
    : undefined;

  return {
    title,
    handle,
    route,
    // Personal posts show the author's photo when they have one; space-authored
    // posts keep the monogram until spaces get their own images.
    avatar: p.author_space ? undefined : (p.author?.avatar_url ?? undefined),
    avatarMonogram: name.charAt(0).toUpperCase(),
    body: p.body,
    // Example content wears a small badge so nobody mistakes it for the real
    // economy (founder 2026-07-24 — demo posts teach how the platform works).
    demo: p.details?.demo === true,
    // A Library piece hosted outside Lichen (founder 2026-08-10).
    isResource: p.details?.isResource === true,
    isCollection: typeof (p.details as { collectionId?: unknown } | null)?.collectionId === 'string',
    // COURSE MATERIAL IS NOT A STORY (founder 2026-08-15). A lesson published
    // to Courses reaches the feed as the event that it arrived — "Galyn posted
    // … to the course library" — and opens the lesson. A post that CARRIES a
    // collection (the door-post a publish mints) is the announcement itself,
    // so it keeps its card.
    activity: (p.service_areas ?? []).includes('courses')
      && typeof (p.details as { collectionId?: unknown } | null)?.collectionId !== 'string'
      ? 'posted to the course library'
      : undefined,
    activityWho: name,
    authorIsSpace: !!p.author_space,
    areaDoors,
    // The My-celium eyebrow tells you WHY a post reached you — someone shared
    // it with their web rather than publicly. On your OWN post it answers a
    // question you never asked, and reads as if the post came FROM My-celium
    // instead of going to it (founder 2026-08-07: "I guess I'm in my own
    // Mycelium, but it feels wonky"). Offer lines still show — what you're
    // asking for something is worth seeing on your own listing.
    eyebrow: offerLine ?? (!isMine && (p.to_mycelium || p.visibility === 'mycelium')
      ? 'Mycelium' : undefined),
    media,
    noDownload,
    previews,
  };
}
