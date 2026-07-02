import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { colorFor, monogramFor, formatRelative } from '../lib/chatApi';
import { CarePostRow, CareAttachment, CareLink, rangeLabel } from '../lib/conciergeApi';
import './CarePostCard.css';

function CareMedia({ a, url }: { a: CareAttachment; url?: string }) {
  if (!url) return <div className="cpost__media-loading" aria-hidden="true" />;
  if (a.type === 'photo') return <img className="cpost__media-img" src={url} alt="" />;
  if (a.type === 'video') return <video className="cpost__media-vid" src={url} controls playsInline />;
  return <audio className="cpost__media-aud" src={url} controls />;
}

function CareLinkChip({ link }: { link: CareLink }) {
  const navigate = useNavigate();
  const inner = (
    <>
      <Icon name={link.internal ? 'arrow-right' : 'globe'} size={12} />
      <span>{link.label || link.url}</span>
    </>
  );
  return link.internal ? (
    <button className="cpost__link" onClick={() => navigate(link.url)}>{inner}</button>
  ) : (
    <a className="cpost__link" href={link.url} target="_blank" rel="noopener noreferrer">{inner}</a>
  );
}

export default function CarePostCard({
  post, mediaUrls, canDelete, onDelete,
}: {
  post: CarePostRow;
  mediaUrls: Record<string, string>;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const name = post.author?.full_name ?? 'Care team';
  return (
    <article className="cpost">
      <header className="cpost__head">
        <span className="cpost__avatar" style={{ background: colorFor(post.author_id) }}>{monogramFor(name)}</span>
        <span className="cpost__head-text">
          <span className="cpost__author">{name}</span>
          <span className="cpost__time">{formatRelative(post.created_at)}</span>
        </span>
        {post.kind === 'wow' && post.score != null && (
          <span className="cpost__score">{post.score}%</span>
        )}
        {canDelete && (
          <button className="cpost__del" onClick={() => onDelete(post.id)} aria-label="Delete post">
            <Icon name="close" size={14} />
          </button>
        )}
      </header>

      {post.body && <p className="cpost__body">{post.body}</p>}

      {post.attachments.length > 0 && (
        <div className="cpost__media">
          {post.attachments.map((a, i) => <CareMedia key={i} a={a} url={mediaUrls[a.path]} />)}
        </div>
      )}

      {post.links.length > 0 && (
        <div className="cpost__links">
          {post.links.map((l, i) => <CareLinkChip key={i} link={l} />)}
        </div>
      )}

      <footer className="cpost__foot">
        {post.kind === 'wow' && (
          <div className="cpost__tags">
            {post.dimensions.length === 0
              ? <span className="cpost__tag">All</span>
              : post.dimensions.map((d) => <span key={d} className="cpost__tag">{d}</span>)}
          </div>
        )}
        {post.kind === 'koc' && post.start_date && post.end_date && (
          <span className="cpost__range"><Icon name="calendar" size={12} /> {rangeLabel(post.start_date, post.end_date)}</span>
        )}
      </footer>
    </article>
  );
}
