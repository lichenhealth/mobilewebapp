import { useState, SyntheticEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { colorFor, monogramFor, formatRelative } from '../lib/chatApi';
import { CarePostRow, CareAttachment, CareLink, CarePostPreview, rangeLabel, kocLinkKind } from '../lib/conciergeApi';
import { createReminder } from '../lib/remindersApi';
import { linkify, hrefFor } from '../lib/linkify';
import { recurrenceLabel } from '../lib/recurrence';
import './CarePostCard.css';

/** Render body text with pasted URLs turned into clickable links. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((s, i) =>
        'url' in s ? (
          <a key={i} className="cpost__inlink" href={hrefFor(s.url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{s.url}</a>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Rich preview of a link pasted in the body: inline YouTube, or an OG card. */
export function CarePreview({ p }: { p: CarePostPreview }) {
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
  post, mediaUrls, canDelete, onDelete, onAsk, me,
}: {
  post: CarePostRow;
  mediaUrls: Record<string, string>;
  canDelete: boolean;
  onDelete: (id: string) => void;
  /** "Ask about this entry" (founder 2026-09-14): opens the Concierge chat
   *  with this entry pinned and its author tagged — pass only when the
   *  viewer isn't the author (you don't tag yourself). */
  onAsk?: (post: CarePostRow) => void;
  /** The VIEWER — powers the plan card's "Add to calendar" door (a private
   *  reminder on their own calendar, never anyone else's). */
  me?: string;
}) {
  const name = post.author?.full_name ?? 'Care team';
  const navigate = useNavigate();
  const [portrait, setPortrait] = useState(false);
  // Add-to-calendar state for the plan card (per mount is honest enough —
  // the reminder itself is the durable record).
  const [onCal, setOnCal] = useState(false);
  const [calBusy, setCalBusy] = useState(false);

  // ── The PLAN ENTRY card (founder 2026-09-23, built from the marketing
  //    mocks): title leads and opens the linked thing, the byline says how
  //    it's held in the mock's grammar ("Camille Reyes recommends this
  //    retreat" / "Galyn Burke prescribed this course"), the linked kind's
  //    mark sits in the corner, the schedule reads as a fine line, and the
  //    doors are ghost pills. WOW entries keep the feed-card shape below.
  if (post.kind === 'koc') {
    const kindInfo = kocLinkKind(post.links);
    const noun = kindInfo?.noun || '';
    const held = post.intent === 'recommended'
      ? `recommends this${noun ? ' ' + noun : ''}`
      : post.intent === 'prescribed'
        ? `prescribed this${noun ? ' ' + noun : ''}`
        : `added this${noun ? ' ' + noun : ''}`;
    const schedule = post.start_date
      ? (post.recurrence
        ? recurrenceLabel(post.recurrence, post.start_date)
        : rangeLabel(post.start_date, post.end_date ?? post.start_date))
      : null;
    const addToCal = async () => {
      if (!me || !post.start_date || calBusy) return;
      setCalBusy(true);
      try {
        await createReminder(me, {
          title: post.title?.trim() || post.body.trim().slice(0, 80) || 'Care plan',
          date: post.start_date, atMin: null, leadMin: 0,
          recurrence: post.recurrence,
        });
        setOnCal(true);
      } catch { /* the button simply stays offered */ }
      setCalBusy(false);
    };
    return (
      <article className="cpost cpost--plan">
        <header className="cpost__planhead">
          <span className="cpost__plantit">
            {post.title?.trim() && (
              kindInfo ? (
                <button className="cpost__ktitle link-cue" onClick={() => navigate(kindInfo.link.url)}>
                  {post.title}
                </button>
              ) : (
                <span className="cpost__ktitle">{post.title}</span>
              )
            )}
            <span className="cpost__byline">
              <span className="cpost__avatar cpost__avatar--xs" style={{ background: colorFor(post.author_id) }}>
                {monogramFor(name)}
              </span>
              <button className="cpost__author-btn link-cue" onClick={() => navigate(`/members/${post.author_id}`)}>
                {name}
              </button>
              <em className={'cpost__bywhat' + (post.intent === 'prescribed' ? ' cpost__bywhat--prescribed' : '')}>
                {held}
              </em>
            </span>
          </span>
          {kindInfo && (
            <span className="cpost__kicon" aria-hidden>
              <Icon name={kindInfo.icon} size={16} />
            </span>
          )}
          {canDelete && (
            <button className="cpost__del" onClick={() => onDelete(post.id)} aria-label="Delete post">
              <Icon name="close" size={14} />
            </button>
          )}
        </header>

        {(schedule || post.ai_omit || post.sensitive) && (
          <p className="cpost__planfine">
            {schedule && (
              <>
                <Icon name={post.recurrence ? 'repeat' : 'calendar'} size={11} /> {schedule}
              </>
            )}
            {post.ai_omit && (
              <em className="cpost__omit" title="Held back from every assistant — only the humans on the care team read this entry">
                {schedule ? ' · ' : ''}no AI{post.ai_omit !== 'other' ? ` · sensitive ${post.ai_omit}` : ''}
              </em>
            )}
            {post.sensitive && (
              <em className="cpost__omit" title="Marked as sensitive financial and/or medical information">
                {(schedule || post.ai_omit) ? ' · ' : ''}sensitive info
              </em>
            )}
          </p>
        )}

        {post.body && <p className="cpost__plannote"><LinkifiedText text={post.body} /></p>}

        {post.attachments.length > 0 && (
          <div className="cpost__media">
            {post.attachments.map((a, i) => (
              <CareMedia key={i} a={a} url={mediaUrls[a.path]} />
            ))}
          </div>
        )}
        {post.previews?.length > 0 && (
          <div className="cpost__previews">
            {post.previews.map((p, i) => <CarePreview key={i} p={p} />)}
          </div>
        )}

        {(post.links.length > 0 || (me && post.start_date)) && (
          <div className="cpost__doors">
            {me && post.start_date && (
              <button className="cpost__door" onClick={addToCal} disabled={calBusy || onCal}>
                {onCal ? 'On your calendar ✓' : 'Add to calendar ›'}
              </button>
            )}
            {post.links.map((l, i) => l.internal ? (
              <button key={i} className="cpost__door" onClick={() => navigate(l.url)}>
                {l.label && l.label !== l.url ? l.label : (noun ? `${noun[0].toUpperCase()}${noun.slice(1)} details` : 'Open')} ›
              </button>
            ) : (
              <a key={i} className="cpost__door" href={l.url} target="_blank" rel="noopener noreferrer">
                {l.label && l.label !== l.url ? l.label : 'Open link'} ›
              </a>
            ))}
          </div>
        )}

        {onAsk && (
          <footer className="cpost__foot cpost__foot--plan">
            <button className="cpost__ask" onClick={() => onAsk(post)}>
              <Icon name="message" size={12} />
              Ask {(name.split(' ')[0]) || 'them'}
            </button>
          </footer>
        )}
      </article>
    );
  }

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
          <span className="cpost__author">
            {/* The author's name goes to their profile and says so (the
                link-cue rule, founder 2026-09-21). */}
            <button className="cpost__author-btn link-cue" onClick={() => navigate(`/members/${post.author_id}`)}>
              {name}
            </button>
            {/* Recommended vs prescribed (founder 2026-09-14): how the plan
                entry is held, said on the byline — the mock's grammar
                ("Galyn Burke prescribed this course"). */}
            {post.intent && (
              <em className={'cpost__intent' + (post.intent === 'prescribed' ? ' cpost__intent--prescribed' : '')}>
                {' · '}{post.intent}
              </em>
            )}
          </span>
          <span className="cpost__time">
            {formatRelative(post.created_at)}
            {/* The promise this entry is keeping, said on its face
                (founder 2026-08-20). */}
            {post.ai_omit && (
              <em className="cpost__omit" title="Held back from every assistant — only the humans on the care team read this entry">
                {' · '}no AI{post.ai_omit !== 'other' ? ` · sensitive ${post.ai_omit}` : ''}
              </em>
            )}
            {post.sensitive && (
              <em className="cpost__omit" title="Marked as sensitive financial and/or medical information">
                {' · '}sensitive info
              </em>
            )}
          </span>
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
        {onAsk && (
          <button className="cpost__ask" onClick={() => onAsk(post)}>
            <Icon name="message" size={12} />
            Ask {(name.split(' ')[0]) || 'them'}
          </button>
        )}
      </footer>
    </article>
  );
}
