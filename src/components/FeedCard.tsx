import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Icon, IconName } from './Icon';
import EngagementFooter, { MyceliumSignals, ActionAvailability } from './EngagementFooter';
import { LinkifiedText, CarePreview } from './CarePostCard';
import { WeaveMark } from './WeaveMark';
import './FeedCard.css';

export interface FeedCardProps {
  avatar?: string;       // image URL — falls back to monogram circle
  avatarMonogram?: string;
  title: string;
  handle: string;
  category?: 'social' | 'creative' | 'educational' | 'actionable' | 'qa' | 'commerce';
  categoryIcons?: IconName[];    // small icons in the upper-right of card (decorative)
  /** Live area doors, upper-right: tap the Library icon on Melanie's post to
   *  browse Melanie's Library (author-scoped search). Wins over categoryIcons. */
  areaDoors?: { icon: IconName; to: string; label: string }[];
  /** Example content (details.demo) — wears a small badge so nobody mistakes
   *  it for the real economy; it's there to teach how the platform works. */
  demo?: boolean;
  body: string;
  // Image-badge column on the right
  image?: {
    src?: string;             // image URL (or pattern fallback)
    pattern?: 'beef' | 'support' | 'reiki' | 'sky';
    topLabel: string;
    bottomLabel: string;
    tone?: 'peach' | 'moss' | 'ink';
  };
  // Engagement
  mycelium?: MyceliumSignals;  // network signals (peach icons on left)
  trusted?: boolean;            // your own state
  recommended?: boolean;
  saved?: boolean;
  availability?: ActionAvailability;
  onTrust?: (active: boolean) => void;
  onRecommend?: (active: boolean) => void;
  onSave?: (active: boolean) => void;
  // Eyebrow tag (optional)
  eyebrow?: string;
  // Inline media (photos / videos / audio uploaded with a post)
  media?: { type: 'photo' | 'video' | 'audio'; url: string }[];
  // Message the author (omit / undefined hides the button — e.g. your own post)
  onMessage?: () => void;
  /** Tap handler for the image badge's bottom button (e.g. Book / RSVP). */
  onBadgeAction?: () => void;
  /** Open the full page for this card (post/event page) — title/body become links. */
  onOpen?: () => void;
  /** The post page's full-bleed rendering: no body clamp, full-height media. */
  expanded?: boolean;
  /** Open the author's profile (member or space) — avatar/handle become links. */
  onAuthor?: () => void;
  /** The author entity is in the viewer's web (mycelium membership). */
  inWeb?: boolean;
  /** 1-click weave/unweave the author — renders the mark beside the name.
   *  Omit for the viewer's own posts. */
  onWeave?: (next: boolean) => void;
  /** Rich link previews (YouTube embed / OG card) resolved at compose time. */
  previews?: { url: string; kind: 'youtube' | 'link'; videoId?: string; title?: string; description?: string; image?: string; siteName?: string }[];
  // ⋯ menu: author controls vs viewer controls. Renders only when a handler fits.
  /** Screen-specific rows rendered at the top of the ⋯ menu (e.g. the Saved
   *  shelf's "Add to collection…"). */
  extraMenuItems?: { label: string; hint?: string; onClick: () => void }[];
  viewerIsAuthor?: boolean;
  onEdit?: () => void;      // author, non-event posts
  onDelete?: () => void;    // author, non-event posts (confirmed inside)
  onManage?: () => void;    // author, event posts → the event page's tested flow
  onHide?: () => void;      // everyone else — hides it for THEM only
}

export default function FeedCard({
  avatar,
  avatarMonogram,
  title,
  handle,
  categoryIcons = [],
  areaDoors = [],
  demo,
  body,
  image,
  mycelium,
  trusted,
  recommended,
  saved,
  availability,
  onTrust,
  onRecommend,
  onSave,
  eyebrow,
  media,
  onMessage,
  onBadgeAction,
  onOpen,
  expanded,
  onAuthor,
  inWeb,
  onWeave,
  previews,
  extraMenuItems,
  viewerIsAuthor,
  onEdit,
  onDelete,
  onManage,
  onHide,
}: FeedCardProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const hasMenu = !!(extraMenuItems && extraMenuItems.length)
    || (viewerIsAuthor ? !!(onEdit || onDelete || onManage) : !!onHide);
  // Whole-card click-through: anywhere that isn't itself interactive opens
  // the post/event page. Inner buttons, links, and media keep their own
  // behavior via the closest() guard.
  const onCardClick = onOpen
    ? (e: MouseEvent) => {
        if ((e.target as HTMLElement).closest('a, button, input, textarea, video, audio')) return;
        onOpen();
      }
    : undefined;

  const avatarEl = (
    <div className="feed-card__avatar" aria-hidden="true">
      {avatar ? (
        <img src={avatar} alt="" />
      ) : (
        <span className="feed-card__monogram">
          {avatarMonogram ?? title.charAt(0)}
        </span>
      )}
    </div>
  );

  return (
    // The shell exists for the example bubble: the card itself clips overflow
    // (overflow-x: clip + border-radius), and iOS Safari clips BOTH axes on
    // such a box — a half-out child gets its top sliced off. The bubble
    // therefore lives on an unclipped wrapper, not inside the card.
    <div className={'feed-card-shell' + (demo ? ' feed-card-shell--demo' : '')}>
      {/* EXAMPLE bubble — straddles the card's top-right edge (half in, half
          out — founder 2026-07-25) so demo content reads as a label ON the
          post, not part of it. The × hides the example for this viewer via
          the same hidden_posts mechanism as "Hide this post". */}
      {demo && (
        <div className="feed-card__demo" onClick={(e: MouseEvent) => e.stopPropagation()}>
          <span title="Example content — here to show how Lichen works">example</span>
          {onHide && !viewerIsAuthor && (
            <button
              className="feed-card__demo-x"
              onClick={onHide}
              aria-label="Remove this example post"
              title="Remove this example post"
            >
              ×
            </button>
          )}
        </div>
      )}
    <article className={'feed-card' + (onOpen ? ' feed-card--clickable' : '') + (expanded ? ' feed-card--expanded' : '')} onClick={onCardClick}>
      {/* HEADER — identity (avatar + handle) opens the author's profile; the
          TITLE opens the post itself. It used to sit inside the author button,
          so tapping a post's title landed on the profile instead of the post. */}
      <header className="feed-card__head">
        {onAuthor ? (
          <button className="feed-card__avatar-btn" onClick={onAuthor} aria-label={`Open ${handle}'s profile`}>
            {avatarEl}
          </button>
        ) : avatarEl}
        <div className="feed-card__head-text">
          {onOpen && !expanded ? (
            <button className="feed-card__title feed-card__title--btn" onClick={onOpen}>{title}</button>
          ) : (
            <h3 className="feed-card__title">{title}</h3>
          )}
          <div className="feed-card__handle-row">
            {onAuthor ? (
              <button className="feed-card__handle feed-card__handle--btn" onClick={onAuthor}>
                {handle}
              </button>
            ) : (
              <span className="feed-card__handle">{handle}</span>
            )}
            {eyebrow && (
              <span className="feed-card__eyebrow">
                {' · '}
                {eyebrow === 'Mycelium' ? (
                  // the lens the post reached you through — YOUR mycelium's door
                  <button className="feed-card__eyebrow-link" onClick={() => navigate('/mycelium')}>
                    Mycelium
                  </button>
                ) : eyebrow}
              </span>
            )}
          </div>
        </div>
        {(onWeave || categoryIcons.length > 0 || areaDoors.length > 0 || onMessage || hasMenu) && (
          <div className="feed-card__head-actions">
            {onWeave && (
              <WeaveMark on={inWeb ?? false} onToggle={onWeave} entityName={title} size={20} />
            )}
            {areaDoors.length > 0 ? (
              <div className="feed-card__cat-icons">
                {areaDoors.map((d) => (
                  <button
                    key={d.to}
                    className="feed-card__cat-icon feed-card__cat-icon--door"
                    title={d.label}
                    aria-label={d.label}
                    onClick={() => navigate(d.to)}
                  >
                    <Icon name={d.icon} size={14} />
                  </button>
                ))}
              </div>
            ) : categoryIcons.length > 0 && (
              <div className="feed-card__cat-icons">
                {categoryIcons.map((n) => (
                  <span key={n} className="feed-card__cat-icon">
                    <Icon name={n} size={14} />
                  </span>
                ))}
              </div>
            )}
            {onMessage && (
              <button
                className="feed-card__message"
                onClick={onMessage}
                aria-label={`Message ${title}`}
              >
                <Icon name="message" size={16} />
              </button>
            )}
            {hasMenu && (
              <div className="feed-card__more-wrap">
                <button
                  className="feed-card__message"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
                  aria-label="Post options"
                  aria-expanded={menuOpen}
                >
                  <Icon name="more-horizontal" size={16} />
                </button>
                {menuOpen && (
                  <>
                    <div className="feed-card__more-scrim" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); }} />
                    <div className="feed-card__more" role="menu">
                      {(extraMenuItems ?? []).map((item) => (
                        <button key={item.label} role="menuitem"
                          onClick={(e) => { e.stopPropagation(); setMenuOpen(false); item.onClick(); }}>
                          {item.label}
                          {item.hint && <em>{item.hint}</em>}
                        </button>
                      ))}
                      {viewerIsAuthor && onManage && (
                        <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onManage(); }}>
                          Manage on event page
                        </button>
                      )}
                      {viewerIsAuthor && onEdit && (
                        <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(); }}>
                          Edit post
                        </button>
                      )}
                      {viewerIsAuthor && onDelete && (
                        <button
                          role="menuitem"
                          className="feed-card__more-danger"
                          onClick={(e) => {
                            e.stopPropagation(); setMenuOpen(false);
                            if (window.confirm('Delete this post? This can\'t be undone.')) onDelete();
                          }}
                        >
                          Delete post
                        </button>
                      )}
                      {!viewerIsAuthor && onHide && (
                        <button role="menuitem" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onHide(); }}>
                          Hide this post
                          <em>Only hides it for you</em>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      {/* BODY */}
      <div className="feed-card__body">
        {onOpen
          ? (
            // Mouse clicks are handled by the card itself; this keeps the
            // page reachable by keyboard (Tab + Enter).
            <p
              className="feed-card__text feed-card__text--link"
              role="link"
              tabIndex={0}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') onOpen(); }}
            >
              <LinkifiedText text={body} />
            </p>
          )
          : <p className="feed-card__text"><LinkifiedText text={body} /></p>}
        {image && (
          <ImageBadge
            pattern={image.pattern}
            src={image.src}
            topLabel={image.topLabel}
            bottomLabel={image.bottomLabel}
            tone={image.tone ?? 'peach'}
            onAction={onBadgeAction}
          />
        )}
      </div>

      {/* LINK PREVIEWS (YouTube inline, OG cards) */}
      {previews && previews.length > 0 && (
        <div className="cpost__previews" onClick={(e) => e.stopPropagation()}>
          {previews.map((pv, i) => <CarePreview key={i} p={pv} />)}
        </div>
      )}

      {/* INLINE MEDIA */}
      {media && media.length > 0 && (
        <div className="feed-card__media">
          {media.map((m, i) =>
            m.type === 'photo' ? (
              <img key={i} src={m.url} alt="" />
            ) : m.type === 'video' ? (
              <video key={i} src={m.url} controls playsInline />
            ) : (
              <audio key={i} src={m.url} controls />
            )
          )}
        </div>
      )}

      {/* ENGAGEMENT */}
      <EngagementFooter
        mycelium={mycelium}
        trusted={trusted}
        recommended={recommended}
        saved={saved}
        availability={availability}
        onTrust={onTrust}
        onRecommend={onRecommend}
        onSave={onSave}
      />
    </article>
    </div>
  );
}

// ─── Image badge ────────────────────────────────────────────────────
interface ImageBadgeProps {
  src?: string;
  pattern?: 'beef' | 'support' | 'reiki' | 'sky';
  topLabel: string;
  bottomLabel: string;
  tone: 'peach' | 'moss' | 'ink';
  onAction?: () => void;
}

function ImageBadge({ src, pattern, topLabel, bottomLabel, tone, onAction }: ImageBadgeProps) {
  return (
    <div className={`badge badge--${tone}`}>
      <div className="badge__top">{topLabel}</div>
      {(src || pattern) && (
        <div className="badge__image">
          {src ? <img src={src} alt="" /> : <PatternArt name={pattern!} />}
        </div>
      )}
      <button className="badge__bottom" onClick={onAction}>{bottomLabel}</button>
    </div>
  );
}

/* Tiny placeholder SVG art — fits the lichen aesthetic, no external images */
function PatternArt({ name }: { name: 'beef' | 'support' | 'reiki' | 'sky' }) {
  if (name === 'beef') {
    return (
      <svg viewBox="0 0 100 80" width="100%" height="100%" fill="none" stroke="currentColor" strokeWidth="1.4">
        {/* Stylized cow silhouette with butcher-chart lines */}
        <path d="M18 50c-3-2-5-6-2-9 1-1 3-1 4 0M20 45c-1-4 1-7 4-8s4 0 5 3M30 28c-1-4 2-8 6-8 3 0 5 2 6 5M82 32c-1-6-7-8-12-8h-32c-8 0-14 5-16 12-1 5 0 11 4 16 3 4 7 5 12 5h32c8 0 14-4 16-11l2-6c1-3-1-7-6-8Z" fill="currentColor" fillOpacity="0.85" stroke="none" />
        <path d="M22 64v6M32 65v8M52 65v8M68 64v6M75 64v5" />
        {/* Subtle chart lines */}
        <g stroke="white" strokeOpacity="0.5">
          <path d="M30 32v22M45 28v28M60 28v28M75 30v22M22 42h62" />
        </g>
      </svg>
    );
  }
  if (name === 'support') {
    return (
      <svg viewBox="0 0 100 80" width="100%" height="100%" fill="none">
        <rect width="100" height="80" fill="#3A4742" />
        {/* Two embracing figures, abstract */}
        <g fill="#E8D9A6">
          <circle cx="38" cy="32" r="9" />
          <circle cx="60" cy="34" r="8" />
          <path d="M22 78c0-14 8-22 18-22s10 5 18 5 8-5 18-5c10 0 18 8 18 22Z" />
        </g>
        <circle cx="78" cy="18" r="2" fill="#F5A36D" />
        <circle cx="24" cy="20" r="1.5" fill="#F5A36D" />
      </svg>
    );
  }
  if (name === 'reiki') {
    return (
      <svg viewBox="0 0 100 80" width="100%" height="100%" fill="none">
        <rect width="100" height="80" fill="#7C8A6D" />
        {/* Horse silhouette */}
        <path
          fill="#2D3328"
          d="M20 60c2-8 6-16 12-22 4-4 9-8 16-9 5-1 10 1 14 4l4 5c2 2 5 3 8 3l4 1c1 1 1 3 0 4l-3 2c-2 1-3 3-3 5l-1 6c-1 4-3 7-6 8l-4 1c-3 1-6 0-9-1l-2-1-2 8H35l-1-6c-1-3-3-5-6-6l-5-1c-2 0-3-2-3-4Z"
        />
        <path fill="#2D3328" d="M62 33l4-8 2 1-3 8Z" />
      </svg>
    );
  }
  // sky default
  return (
    <svg viewBox="0 0 100 80" width="100%" height="100%" fill="none">
      <defs>
        <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FBD9C0" />
          <stop offset="100%" stopColor="#F5A36D" />
        </linearGradient>
      </defs>
      <rect width="100" height="80" fill="url(#sky-grad)" />
      <circle cx="50" cy="45" r="14" fill="#FBF8F2" opacity="0.95" />
    </svg>
  );
}

// ─── (Engagement footer moved to shared EngagementFooter component) ──
