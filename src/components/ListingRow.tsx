import { Icon } from './Icon';
import type { FeedPost } from '../lib/postsApi';
import './ListingRow.css';

/** Quiet relative recency — job boards live and die by freshness. */
function whenAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'now';
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Row-first browse (the job-board idiom — Indeed/TaskRabbit): title leads,
 *  who + where beneath, the pay/mode line in peach, recency on the right.
 *  Trust shield is the only endorsement signal — no counts, no ranks. */
export default function ListingRow({ post, offer, endorsed, onOpen, onHide }: {
  post: FeedPost;
  offer?: string;
  endorsed?: boolean;
  onOpen: () => void;
  /** The example bubble's × — hides this post for the viewer (hidden_posts). */
  onHide?: () => void;
}) {
  const media = Array.isArray(post.details?.media)
    ? (post.details.media as { type: string; url: string }[]) : [];
  const photo = media.find((m) => m.type === 'photo')?.url;
  const title = post.title || (post.body.length > 72 ? post.body.slice(0, 69) + '…' : post.body);
  const by = post.author_space?.name || post.author?.full_name || 'Member';
  const loc = typeof post.details?.location === 'string' ? (post.details.location as string) : '';
  const demo = post.details?.demo === true;
  return (
    <button className={'lrow' + (demo ? ' lrow--demo' : '')} onClick={onOpen}>
      {/* Half-out example bubble, same as feed cards (founder 2026-07-25). */}
      {demo && (
        <span className={'ex-bubble' + (onHide ? '' : ' ex-bubble--static')}>
          <span title="Example content — here to show how Lichen works">example</span>
          {onHide && (
            <span
              role="button" tabIndex={0}
              className="ex-bubble__x"
              aria-label="Remove this example post"
              title="Remove this example post"
              onClick={(e) => { e.stopPropagation(); onHide(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onHide(); } }}
            >
              ×
            </span>
          )}
        </span>
      )}
      {photo && <span className="lrow__thumb"><img src={photo} alt="" loading="lazy" /></span>}
      <span className="lrow__main">
        <span className="lrow__title">{title}</span>
        <span className="lrow__by">{by}{loc ? ` · ${loc}` : ''}</span>
        {offer && <span className="lrow__offer">{offer}</span>}
      </span>
      <span className="lrow__side">
        {endorsed && (
          <span className="lrow__shield" title="Endorsed by someone you trust">
            <Icon name="shield-user" size={11} />
          </span>
        )}
        <span className="lrow__when">{whenAgo(post.created_at)}</span>
      </span>
    </button>
  );
}
