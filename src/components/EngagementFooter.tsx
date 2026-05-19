import { useState } from 'react';
import { Icon } from './Icon';
import './EngagementFooter.css';

export interface MyceliumMember {
  handle: string;
  name: string;
  monogram?: string;
  color?: string;
}

export interface MyceliumSignals {
  /** Members in your mycelium who have trusted this content */
  trusted?: MyceliumMember[];
  /** Members in your mycelium who have recommended this content */
  recommended?: MyceliumMember[];
}

interface Props {
  /** Network signals — peach-filled icons on the left side of the footer */
  mycelium?: MyceliumSignals;
  /** Has the current user trusted this content? */
  trusted?: boolean;
  /** Has the current user recommended this content? */
  recommended?: boolean;
  /** Has the current user saved this content? */
  saved?: boolean;
  onTrust?: () => void;
  onRecommend?: () => void;
  onShare?: () => void;
  onSave?: () => void;
  onChat?: () => void;
}

/** Engagement footer for posts, community cards, marketplace listings.
 *  Left: mycelium signals (peach-filled icons when someone in your network
 *  has trusted/recommended). Tap to reveal *who*.
 *  Right: your actions (Trust, Recommend, Share, Save, Chat).
 *  Deliberately no counts — relevance over volume. */
export default function EngagementFooter({
  mycelium,
  trusted, recommended, saved,
  onTrust, onRecommend, onShare, onSave, onChat,
}: Props) {
  const [myTrust, setMyTrust] = useState(trusted ?? false);
  const [myRec, setMyRec] = useState(recommended ?? false);
  const [mySaved, setMySaved] = useState(saved ?? false);

  // Which mycelium panel (if any) is currently expanded
  const [openPanel, setOpenPanel] = useState<'trust' | 'recommend' | null>(null);

  const trustedBy = mycelium?.trusted ?? [];
  const recommendedBy = mycelium?.recommended ?? [];
  const hasSignals = trustedBy.length > 0 || recommendedBy.length > 0;

  const togglePanel = (which: 'trust' | 'recommend') => {
    setOpenPanel((p) => (p === which ? null : which));
  };

  const handleTrust = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMyTrust((v) => !v);
    onTrust?.();
  };
  const handleRec = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMyRec((v) => !v);
    onRecommend?.();
  };
  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMySaved((v) => !v);
    onSave?.();
  };

  return (
    <div className="engage">
      <div className="engage__row">
        {/* LEFT: mycelium signals (peach when active) */}
        {hasSignals && (
          <div className="engage__signals">
            {trustedBy.length > 0 && (
              <button
                className={
                  'engage__signal' + (openPanel === 'trust' ? ' is-open' : '')
                }
                onClick={(e) => { e.stopPropagation(); togglePanel('trust'); }}
                aria-label={`Trusted by ${trustedBy.length} in your mycelium`}
                title="Trusted by your mycelium"
              >
                <Icon name="shield-user" size={14} />
              </button>
            )}
            {recommendedBy.length > 0 && (
              <button
                className={
                  'engage__signal' + (openPanel === 'recommend' ? ' is-open' : '')
                }
                onClick={(e) => { e.stopPropagation(); togglePanel('recommend'); }}
                aria-label={`Recommended by ${recommendedBy.length} in your mycelium`}
                title="Recommended by your mycelium"
              >
                <Icon name="thumbs-up" size={14} />
              </button>
            )}
          </div>
        )}

        {/* Vertical divider when there are signals to separate from */}
        {hasSignals && <div className="engage__divider" aria-hidden="true" />}

        {/* RIGHT: your actions */}
        <div className="engage__actions">
          <button
            className={'engage__action' + (myTrust ? ' is-active' : '')}
            onClick={handleTrust}
          >
            <Icon name="shield-user" size={12} />
            <span>Trust</span>
          </button>
          <button
            className={'engage__action' + (myRec ? ' is-active' : '')}
            onClick={handleRec}
          >
            <Icon name="thumbs-up" size={12} />
            <span>Recommend</span>
          </button>
          <button
            className="engage__action"
            onClick={(e) => { e.stopPropagation(); onShare?.(); }}
          >
            <Icon name="send" size={12} />
            <span>Share</span>
          </button>
          <button
            className={'engage__action' + (mySaved ? ' is-active' : '')}
            onClick={handleSave}
          >
            <Icon name="bookmark" size={12} />
            <span>Save</span>
          </button>
          <button
            className="engage__action"
            onClick={(e) => { e.stopPropagation(); onChat?.(); }}
          >
            <Icon name="message" size={12} />
            <span>Chat</span>
          </button>
        </div>
      </div>

      {/* Inline expansion: who in mycelium trusted/recommended */}
      {openPanel && (
        <div className="engage__panel">
          <p className="engage__panel-label">
            {openPanel === 'trust' ? 'Trusted by' : 'Recommended by'} in your mycelium:
          </p>
          <ul className="engage__members">
            {(openPanel === 'trust' ? trustedBy : recommendedBy).map((m) => (
              <li key={m.handle} className="engage__member">
                <span
                  className="engage__member-avatar"
                  style={{ background: m.color ?? 'var(--ink-soft)' }}
                >
                  {m.monogram ?? m.name.charAt(0)}
                </span>
                <span className="engage__member-id">
                  <span className="engage__member-name">{m.name}</span>
                  <span className="engage__member-handle">{m.handle}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
