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
export default function ListingRow({ post, offer, endorsed, onOpen }: {
  post: FeedPost;
  offer?: string;
  endorsed?: boolean;
  onOpen: () => void;
}) {
  const media = Array.isArray(post.details?.media)
    ? (post.details.media as { type: string; url: string }[]) : [];
  const photo = media.find((m) => m.type === 'photo')?.url;
  const title = post.title || (post.body.length > 72 ? post.body.slice(0, 69) + '…' : post.body);
  const by = post.author_space?.name || post.author?.full_name || 'Member';
  const loc = typeof post.details?.location === 'string' ? (post.details.location as string) : '';
  return (
    <button className="lrow" onClick={onOpen}>
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
