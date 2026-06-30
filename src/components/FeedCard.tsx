import { Icon, IconName } from './Icon';
import EngagementFooter, { MyceliumSignals, ActionAvailability } from './EngagementFooter';
import './FeedCard.css';

export interface FeedCardProps {
  avatar?: string;       // image URL — falls back to monogram circle
  avatarMonogram?: string;
  title: string;
  handle: string;
  category?: 'social' | 'creative' | 'educational' | 'actionable' | 'qa' | 'commerce';
  categoryIcons?: IconName[];    // small icons in the upper-right of card
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
  // Eyebrow tag (optional)
  eyebrow?: string;
  // Inline media (photos / videos / audio uploaded with a post)
  media?: { type: 'photo' | 'video' | 'audio'; url: string }[];
}

export default function FeedCard({
  avatar,
  avatarMonogram,
  title,
  handle,
  categoryIcons = [],
  body,
  image,
  mycelium,
  trusted,
  recommended,
  saved,
  availability,
  onTrust,
  onRecommend,
  eyebrow,
  media,
}: FeedCardProps) {
  return (
    <article className="feed-card">
      {/* HEADER */}
      <header className="feed-card__head">
        <div className="feed-card__avatar" aria-hidden="true">
          {avatar ? (
            <img src={avatar} alt="" />
          ) : (
            <span className="feed-card__monogram">
              {avatarMonogram ?? title.charAt(0)}
            </span>
          )}
        </div>
        <div className="feed-card__head-text">
          <h3 className="feed-card__title">{title}</h3>
          <div className="feed-card__handle">
            {handle}
            {eyebrow && <span className="feed-card__eyebrow"> · {eyebrow}</span>}
          </div>
        </div>
        {categoryIcons.length > 0 && (
          <div className="feed-card__cat-icons">
            {categoryIcons.map((n) => (
              <span key={n} className="feed-card__cat-icon">
                <Icon name={n} size={14} />
              </span>
            ))}
          </div>
        )}
      </header>

      {/* BODY */}
      <div className="feed-card__body">
        <p className="feed-card__text">{body}</p>
        {image && (
          <ImageBadge
            pattern={image.pattern}
            src={image.src}
            topLabel={image.topLabel}
            bottomLabel={image.bottomLabel}
            tone={image.tone ?? 'peach'}
          />
        )}
      </div>

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
      />
    </article>
  );
}

// ─── Image badge ────────────────────────────────────────────────────
interface ImageBadgeProps {
  src?: string;
  pattern?: 'beef' | 'support' | 'reiki' | 'sky';
  topLabel: string;
  bottomLabel: string;
  tone: 'peach' | 'moss' | 'ink';
}

function ImageBadge({ src, pattern, topLabel, bottomLabel, tone }: ImageBadgeProps) {
  return (
    <div className={`badge badge--${tone}`}>
      <div className="badge__top">{topLabel}</div>
      <div className="badge__image">
        {src ? (
          <img src={src} alt="" />
        ) : (
          <PatternArt name={pattern ?? 'sky'} />
        )}
      </div>
      <button className="badge__bottom">{bottomLabel}</button>
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
