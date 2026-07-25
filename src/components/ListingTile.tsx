import { Icon } from './Icon';
import type { FeedPost } from '../lib/postsApi';
import './ListingTile.css';

/** Photo-first browse tile — the marketplace-grid idiom, Lichen-voiced.
 *  Image leads; text pieces get a typographic cover (title in the display
 *  serif on bone — little book covers, not gray placeholders). The only
 *  overlay is the trust lens: a peach shield when someone YOU trust endorsed
 *  it. No counts, no ranks — relevance over volume, same as everywhere. */
export default function ListingTile({ post, offer, endorsed, onOpen }: {
  post: FeedPost;
  /** The offer line ("Rent · $20/day", "Gift") — omitted when unlabeled. */
  offer?: string;
  /** Someone in your mycelium trusted/recommended this. */
  endorsed?: boolean;
  onOpen: () => void;
}) {
  const media = Array.isArray(post.details?.media)
    ? (post.details.media as { type: string; url: string }[]) : [];
  const photo = media.find((m) => m.type === 'photo')?.url;
  const title = post.title || (post.body.length > 64 ? post.body.slice(0, 61) + '…' : post.body);
  const by = post.author_space?.name || post.author?.full_name || 'Member';
  const demo = post.details?.demo === true;
  return (
    <button className="ltile" onClick={onOpen}>
      <span className={'ltile__media' + (photo ? '' : ' ltile__media--cover')}>
        {photo
          ? <img src={photo} alt="" loading="lazy" />
          : <span className="ltile__cover-title">{title}</span>}
        {demo && <span className="demo-badge ltile__demo" title="Example content — here to show how Lichen works">example</span>}
        {endorsed && (
          <span className="ltile__shield" title="Endorsed by someone you trust">
            <Icon name="shield-user" size={11} />
          </span>
        )}
      </span>
      {offer && <span className="ltile__offer">{offer}</span>}
      <span className="ltile__title">{title}</span>
      <span className="ltile__by">{by}</span>
    </button>
  );
}
