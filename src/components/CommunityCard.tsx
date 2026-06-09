import { Icon, IconName } from './Icon';
import EngagementFooter, { MyceliumSignals, ActionAvailability } from './EngagementFooter';
import './CommunityCard.css';

export interface CommunityCardProps {
  avatarMonogram?: string;
  avatar?: string;
  title: string;
  handle: string;
  categoryIcon?: IconName;        // upper-right corner icon (e.g. graduation-cap)
  // Centered display element inside the card body
  display?: {
    kind: 'group' | 'event' | 'art';
    count?: number;               // (legacy — no longer rendered; kept for back-compat)
    label?: string;
  };
  // Engagement
  mycelium?: MyceliumSignals;     // network signals (peach icons on left)
  trusted?: boolean;
  recommended?: boolean;
  saved?: boolean;
  availability?: ActionAvailability;
}

export default function CommunityCard({
  avatar,
  avatarMonogram,
  title,
  handle,
  categoryIcon,
  display,
  mycelium,
  trusted,
  recommended,
  saved,
  availability,
}: CommunityCardProps) {
  return (
    <article className="cmty-card">
      {/* HEADER — avatar | centered title block | category icon */}
      <header className="cmty-card__head">
        <div className="cmty-card__avatar">
          {avatar ? (
            <img src={avatar} alt="" />
          ) : (
            <span className="cmty-card__monogram">{avatarMonogram ?? title.charAt(0)}</span>
          )}
        </div>
        <div className="cmty-card__head-text">
          <h3 className="cmty-card__title">{title}</h3>
          <p className="cmty-card__handle">{handle}</p>
        </div>
        {categoryIcon && (
          <span className="cmty-card__cat" aria-hidden="true">
            <Icon name={categoryIcon} size={18} />
          </span>
        )}
      </header>

      {/* BODY — large center-stage display */}
      {display && (
        <div className="cmty-card__body">
          <CenterDisplay {...display} />
        </div>
      )}

      {/* ENGAGEMENT */}
      <EngagementFooter
        mycelium={mycelium}
        trusted={trusted}
        recommended={recommended}
        saved={saved}
        availability={availability}
      />
    </article>
  );
}

// ─── Center display: large icon + optional count ────────────────────
function CenterDisplay({
  kind,
  label,
}: NonNullable<CommunityCardProps['display']>) {
  return (
    <div className="cmty-display">
      <div className="cmty-display__icon" aria-hidden="true">
        {kind === 'group' && <UserGroupArt />}
        {kind === 'event' && <EventArt />}
        {kind === 'art' && <ArtArt />}
      </div>
      {label && <div className="cmty-display__label">{label}</div>}
    </div>
  );
}

// Small SVGs — match the "user-group" silhouette seen in the wireframe
function UserGroupArt() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" fill="none"
         stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      {/* Three figures, central larger */}
      <circle cx="32" cy="14" r="6" />
      <path d="M20 38c1-6 5-10 12-10s11 4 12 10" />
      <circle cx="14" cy="16" r="4.5" />
      <path d="M5 38c.5-4 3-7 9-7" />
      <circle cx="50" cy="16" r="4.5" />
      <path d="M59 38c-.5-4-3-7-9-7" />
    </svg>
  );
}

function EventArt() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" fill="none"
         stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="14" y="10" width="36" height="32" rx="3" />
      <path d="M14 20h36M22 6v8M42 6v8" />
      <circle cx="32" cy="30" r="2" fill="currentColor" />
    </svg>
  );
}

function ArtArt() {
  return (
    <svg viewBox="0 0 64 48" width="100%" height="100%" fill="none"
         stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M32 6c-12 0-22 8-22 19 0 4 3 7 7 7 3 0 3-2 3-4 0-3 2-4 5-4h5c5 0 9-4 9-9 0-5-3-9-7-9Z" />
      <circle cx="20" cy="20" r="2" fill="currentColor" />
      <circle cx="28" cy="14" r="2" fill="currentColor" />
      <circle cx="40" cy="16" r="2" fill="currentColor" />
    </svg>
  );
}

// (Engagement footer moved to shared EngagementFooter component;
//  CenterDisplay no longer renders a numeric count — no volume signaling.)
