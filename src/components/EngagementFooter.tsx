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

/** Which actions this content supports. Anything omitted defaults to available.
 *  An action set to `false` renders lighter-gray and non-interactive — the
 *  content isn't meta-tracked in a way that makes that action possible. */
export interface ActionAvailability {
  trust?: boolean;
  recommend?: boolean;
  share?: boolean;
  save?: boolean;
  chat?: boolean;
}

interface Props {
  /** Network signals — peach when someone in your mycelium has engaged */
  mycelium?: MyceliumSignals;
  trusted?: boolean;
  recommended?: boolean;
  saved?: boolean;
  /** Per-action availability (see ActionAvailability) */
  availability?: ActionAvailability;
  onTrust?: (active: boolean) => void;
  onRecommend?: (active: boolean) => void;
  onShare?: () => void;
  onSave?: (active: boolean) => void;
  onChat?: () => void;
}

/** Engagement footer for every post / card / listing across the app.
 *  Left: mycelium signals (shield = trusted, thumb = recommended). Peach +
 *  interactive when your network has engaged; gray + inert when not. Hover or
 *  tap a peach signal to reveal *who*.
 *  Right: your actions (Trust, Recommend, Share, Save, Chat). Unavailable
 *  actions show lighter-gray and can't be tapped. No counts — relevance over volume. */
export default function EngagementFooter({
  mycelium,
  trusted, recommended, saved,
  availability,
  onTrust, onRecommend, onShare, onSave, onChat,
}: Props) {
  const [myTrust, setMyTrust] = useState(trusted ?? false);
  const [myRec, setMyRec] = useState(recommended ?? false);
  const [mySaved, setMySaved] = useState(saved ?? false);

  const [openPanel, setOpenPanel] = useState<'trust' | 'recommend' | null>(null);
  const [pinned, setPinned] = useState(false);

  const trustedBy = mycelium?.trusted ?? [];
  const recommendedBy = mycelium?.recommended ?? [];
  const hasTrust = trustedBy.length > 0;
  const hasRec = recommendedBy.length > 0;

  const can = {
    trust: availability?.trust !== false,
    recommend: availability?.recommend !== false,
    share: availability?.share !== false,
    save: availability?.save !== false,
    chat: availability?.chat !== false,
  };

  const hoverOpen = (which: 'trust' | 'recommend', has: boolean) => {
    if (has && !pinned) setOpenPanel(which);
  };
  const hoverClose = () => {
    if (!pinned) setOpenPanel(null);
  };
  const clickSignal = (which: 'trust' | 'recommend', has: boolean) => {
    if (!has) return;
    if (openPanel === which) { setOpenPanel(null); setPinned(false); }
    else { setOpenPanel(which); setPinned(true); }
  };

  const handleTrust = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!can.trust) return;
    const next = !myTrust;
    setMyTrust(next);
    onTrust?.(next);
  };
  const handleRec = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!can.recommend) return;
    const next = !myRec;
    setMyRec(next);
    onRecommend?.(next);
  };
  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!can.save) return;
    const next = !mySaved;
    setMySaved(next);
    onSave?.(next);
  };

  return (
    <div className="engage" onMouseLeave={hoverClose}>
      <div className="engage__row">
        {/* LEFT: mycelium signals — always shown; peach when engaged, gray when not */}
        <div className="engage__signals">
          <button
            type="button"
            className={
              'engage__signal engage__signal--shield' +
              (hasTrust ? '' : ' is-empty') +
              (openPanel === 'trust' ? ' is-open' : '')
            }
            onClick={(e) => { e.stopPropagation(); clickSignal('trust', hasTrust); }}
            onMouseEnter={() => hoverOpen('trust', hasTrust)}
            tabIndex={hasTrust ? 0 : -1}
            aria-label={hasTrust ? `Trusted by ${trustedBy.length} ${trustedBy.length === 1 ? 'person' : 'people'} you trust` : 'No one you trust has trusted this yet'}
            title={hasTrust ? 'Trusted by people you trust' : 'No trust signals from people you trust yet'}
          >
            <Icon name="shield-user" size={11} />
          </button>
          <button
            type="button"
            className={
              'engage__signal' +
              (hasRec ? '' : ' is-empty') +
              (openPanel === 'recommend' ? ' is-open' : '')
            }
            onClick={(e) => { e.stopPropagation(); clickSignal('recommend', hasRec); }}
            onMouseEnter={() => hoverOpen('recommend', hasRec)}
            tabIndex={hasRec ? 0 : -1}
            aria-label={hasRec ? `Recommended by ${recommendedBy.length} ${recommendedBy.length === 1 ? 'person' : 'people'} you trust` : 'No one you trust has recommended this yet'}
            title={hasRec ? 'Recommended by people you trust' : 'No recommendations from people you trust yet'}
          >
            <Icon name="thumbs-up" size={11} />
          </button>
        </div>

        <div className="engage__divider" aria-hidden="true" />

        {/* RIGHT: your actions */}
        <div className="engage__actions">
          {/* TRUST MOVED UP TO THE NAME (founder 2026-08-07: "a recommend
              button at the bottom with the share and save buttons, and a
              little shield by the member name at the top of the post to trust
              the person"). The footer is what you do with the CONTENT; trusting
              is what you think of the PERSON, so it belongs beside them. */}
          <button
            className={'engage__action' + (myRec && can.recommend ? ' is-active' : '')}
            onClick={handleRec}
            disabled={!can.recommend}
            title={can.recommend ? undefined : 'Not available for this content'}
          >
            <Icon name="thumbs-up" size={13} />
            <span>Recommend</span>
          </button>
          <button
            className="engage__action"
            onClick={(e) => { e.stopPropagation(); if (can.share) onShare?.(); }}
            disabled={!can.share}
            title={can.share ? undefined : 'Not available for this content'}
          >
            <Icon name="send" size={13} />
            <span>Share</span>
          </button>
          <button
            className={'engage__action' + (mySaved && can.save ? ' is-active' : '')}
            onClick={handleSave}
            disabled={!can.save}
            title={can.save ? undefined : 'Not available for this content'}
          >
            {/* Save wears the DRIVE glyph (founder 2026-08-28): the gesture
                saves TO Drive, so it shows where things land — the bookmark
                stays the glyph for folders and notes, different acts. */}
            <Icon name="drive" size={13} />
            <span>Save</span>
          </button>
          <button
            className="engage__action"
            onClick={(e) => { e.stopPropagation(); if (can.chat) onChat?.(); }}
            disabled={!can.chat}
            title={can.chat ? undefined : 'Not available for this content'}
          >
            <Icon name="message" size={13} />
            <span>Chat</span>
          </button>
        </div>
      </div>

      {/* Inline expansion: who in your mycelium trusted / recommended */}
      {openPanel && (
        <div className="engage__panel">
          <p className="engage__panel-label">
            {openPanel === 'trust' ? 'Trusted' : 'Recommended'} by people you trust:
          </p>
          <ul className="engage__members">
            {(openPanel === 'trust' ? trustedBy : recommendedBy).map((m) => (
              <li key={m.handle} className="engage__member">
                <span className="engage__member-avatar" style={{ background: m.color ?? 'var(--ink-soft)' }}>
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
