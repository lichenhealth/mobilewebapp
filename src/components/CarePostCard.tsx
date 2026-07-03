import { useState, SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { colorFor, monogramFor, formatRelative } from '../lib/chatApi';
import { CarePostRow, CareAttachment, CareLink, CarePostPreview, rangeLabel } from '../lib/conciergeApi';
import { linkify, hrefFor } from '../lib/linkify';
import { recurrenceLabel } from '../lib/recurrence';
import './CarePostCard.css';

/** Render body text with pasted URLs turned into clickable links. */
function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((s, i) =>
        'url' in s ? (
          <a key={i} className="cpost__inlink" href={hrefFor(s.url)} target="_blank" rel="noopener noreferrer">{s.url}</a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Rich preview of a link pasted in the body: inline YouTube, or an OG card. */
function CarePreview({ p }: { p: CarePostPreview }) {
  if (p.kind === 'youtube' && p.videoId) {
    return (
      <div className="cpost__yt">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${p.videoId}`}
          title={p.title || 'YouTube video'} loading="lazy" allowFullScreen
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        />
      </div>
    );
  }
  // Only worth a card if we resolved something; otherwise the body link suffices.
  if (!p.title && !p.image) return null;
  return (
    <a className="cpost__ogcard" href={p.url} target="_blank" rel="noopener noreferrer">
      {p.image && <img className="cpost__ogimg" src={p.image} alt="" loading="lazy" />}
      <span className="cpost__ogmeta">
        <span className="cpost__ogtitle">{p.title || p.url}</span>
        {p.description && <span className="cpost__ogdesc">{p.description}</span>}
        {p.siteName && <span className="cpost__ogsite">{p.siteName}</span>}
      </span>
    </a>
  );
}

function CareMedia({ a, url, onLoad }: { a: CareAttachment; url?: string; onLoad?: (e: SyntheticEvent<HTMLImageElement>) => void }) {
  if (!url) return <div className="cpost__media-loading" aria-hidden="true" />;
  if (a.type === 'photo') return <img className="cpost__media-img" src={url} alt="" onLoad={onLoad} />;
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
  const [portrait, setPortrait] = useState(false);

  // A single tall photo → lay text beside it; otherwise stack (text above media).
  const onImgLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const el = e.currentTarget;
    setPortrait(el.naturalHeight > el.naturalWidth * 1.2);
  };
  const single = post.attachments.length === 1 && post.attachments[0].type === 'photo';
  const side = single && portrait;

  return (
    <article className={'cpost' + (side ? ' cpost--side' : '')}>
      <header className="cpost__head">
        <span className="cpost__avatar" style={{ background: colorFor(post.author_id) }}>{monogramFor(name)}</span>
        <span className="cpost__head-text">
          <span className="cpost__author">{name}</span>
          <span className="cpost__time">{formatRelative(post.created_at)}</span>
        </span>
        {post.kind === 'wow' && post.score != null && <span className="cpost__score">{post.score}%</span>}
        {canDelete && (
          <button className="cpost__del" onClick={() => onDelete(post.id)} aria-label="Delete post">
            <Icon name="close" size={14} />
          </button>
        )}
      </header>

      <div className="cpost__content">
        <div className="cpost__text">
          {post.body && <p className="cpost__body"><LinkifiedText text={post.body} /></p>}
          {post.links.length > 0 && (
            <div className="cpost__links">
              {post.links.map((l, i) => <CareLinkChip key={i} link={l} />)}
            </div>
          )}
        </div>
        {post.attachments.length > 0 && (
          <div className="cpost__media">
            {post.attachments.map((a, i) => (
              <CareMedia key={i} a={a} url={mediaUrls[a.path]} onLoad={a.type === 'photo' ? onImgLoad : undefined} />
            ))}
          </div>
        )}
      </div>

      {post.previews?.length > 0 && (
        <div className="cpost__previews">
          {post.previews.map((p, i) => <CarePreview key={i} p={p} />)}
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
        {post.kind === 'koc' && post.start_date && (
          <span className="cpost__range">
            <Icon name={post.recurrence ? 'repeat' : 'calendar'} size={12} />{' '}
            {post.recurrence
              ? recurrenceLabel(post.recurrence, post.start_date)
              : rangeLabel(post.start_date, post.end_date ?? post.start_date)}
          </span>
        )}
      </footer>
    </article>
  );
}
