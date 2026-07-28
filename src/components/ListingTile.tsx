import { Icon, IconName } from './Icon';
import type { FeedPost } from '../lib/postsApi';
import './ListingTile.css';

/** Photo-first browse tile — the marketplace-grid idiom, Lichen-voiced.
 *  Image leads; text pieces get a typographic cover (title in the display
 *  serif on bone — little book covers, not gray placeholders). The only
 *  overlay is the trust lens: a peach shield when someone YOU trust endorsed
 *  it. No counts, no ranks — relevance over volume, same as everywhere. */
export default function ListingTile({ post, offer, endorsed, trustLine, modeIcons, onOpen, onHide }: {
  post: FeedPost;
  /** The offer line ("Rent · $20/day", "Gift") — omitted when unlabeled. */
  offer?: string;
  /** Someone in your mycelium trusted/recommended this. */
  endorsed?: boolean;
  /** The viewer's path to the SELLER ("Trusted by Melanie — someone you trust"). */
  trustLine?: string;
  /** Every exchange door this listing opens — small glyphs, top-left, for
   *  scanning (founder 2026-07-28). */
  modeIcons?: IconName[];
  onOpen: () => void;
  /** The example bubble's × — hides this post for the viewer (hidden_posts). */
  onHide?: () => void;
}) {
  const media = Array.isArray(post.details?.media)
    ? (post.details.media as { type: string; url: string }[]) : [];
  const photo = media.find((m) => m.type === 'photo')?.url;
  let title = post.title || (post.body.length > 64 ? post.body.slice(0, 61) + '…' : post.body);
  // The offer line already says "In search of" — don't say it twice.
  if (offer?.toLowerCase().includes('in search of')) {
    const stripped = title.replace(/^in search of\s+/i, '');
    if (stripped !== title && stripped) title = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  }
  const by = post.author_space?.name || post.author?.full_name || 'Member';
  const demo = post.details?.demo === true;
  return (
    <button className={'ltile' + (demo ? ' ltile--demo' : '')} onClick={onOpen}>
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
      <span className={'ltile__media' + (photo ? '' : ' ltile__media--cover')}>
        {modeIcons && modeIcons.length > 0 && (
          <span className="ltile__modes" aria-hidden>
            {modeIcons.slice(0, 3).map((ic) => (
              <span className="ltile__mode" key={ic}><Icon name={ic} size={11} /></span>
            ))}
          </span>
        )}
        {photo
          ? <img src={photo} alt="" loading="lazy" />
          : <span className="ltile__cover-title">{title}</span>}
        {(endorsed || trustLine) && (
          <span className="ltile__shield" title={trustLine ?? 'Endorsed by someone you trust'}>
            <Icon name="shield-user" size={11} />
          </span>
        )}
      </span>
      {offer && <span className="ltile__offer">{offer}</span>}
      <span className="ltile__title">{title}</span>
      <span className="ltile__by">{by}</span>
      {trustLine && <span className="ltile__trust">{trustLine}</span>}
    </button>
  );
}
