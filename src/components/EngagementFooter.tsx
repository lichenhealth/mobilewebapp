import { useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './EngagementFooter.css';

export interface MyceliumMember {
  handle: string;
  name: string;
  monogram?: string;
  color?: string;
}

export interface MyceliumSignals {
  /** People in your web (mycelium) who trust this post's creator */
  trusted?: MyceliumMember[];
  /** People in your network (your web + fellow space members) who recommend
   *  this post or its creator */
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

/** THE SIGNALS LIVE BESIDE THE NAME (founder 2026-10-23, superseding the
 *  2026-10-12 lower-left slot: "move the trust and recommend icons next to
 *  the name of the person" + "light peach when selects, not opaque"):
 *  shield = your web trusts the creator, thumb = your network recommends
 *  this — LIGHT peach (tint) when lit, gray when quiet, hover or tap a lit
 *  chip to see WHO (never how many). Rendered by FeedCard's header; the
 *  footer below is actions only now. */
export function SignalChips({ mycelium }: { mycelium?: MyceliumSignals }) {
  const [openPanel, setOpenPanel] = useState<'trust' | 'recommend' | null>(null);
  const [pinned, setPinned] = useState(false);
  // The card clips horizontally (overflow-x: clip), so the pop must stay
  // inside it — on open, shift it left until its right edge clears the
  // card's (or the viewport's, wherever these chips end up without a card).
  const popRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    el.style.left = '0px';
    const card = el.closest('.feed-card');
    const bound = card
      ? card.getBoundingClientRect().right - 10
      : window.innerWidth - 12;
    const over = el.getBoundingClientRect().right - bound;
    if (over > 0) el.style.left = `-${Math.ceil(over)}px`;
  }, [openPanel]);
  const trustedBy = mycelium?.trusted ?? [];
  const recommendedBy = mycelium?.recommended ?? [];
  const hasTrust = trustedBy.length > 0;
  const hasRec = recommendedBy.length > 0;
  const toggle = (which: 'trust' | 'recommend', has: boolean) => {
    if (!has) return;
    if (openPanel === which && pinned) { setOpenPanel(null); setPinned(false); }
    else { setOpenPanel(which); setPinned(true); }
  };
  return (
    <span className="sigchips" onMouseLeave={() => { if (!pinned) setOpenPanel(null); }}>
      <button
        type="button"
        className={'sigchips__chip' + (hasTrust ? ' is-lit' : '') + (openPanel === 'trust' ? ' is-open' : '')}
        onClick={(e) => { e.stopPropagation(); toggle('trust', hasTrust); }}
        onMouseEnter={() => { if (hasTrust && !pinned) setOpenPanel('trust'); }}
        tabIndex={hasTrust ? 0 : -1}
        aria-label={hasTrust
          ? `Trusted by ${trustedBy.length} ${trustedBy.length === 1 ? 'person' : 'people'} in your web`
          : 'No one in your web has trusted this member yet'}
        title={hasTrust ? 'People in your web trust this member' : 'No trust signals from your web yet'}
      >
        <Icon name="shield-user" size={11} />
      </button>
      <button
        type="button"
        className={'sigchips__chip' + (hasRec ? ' is-lit' : '') + (openPanel === 'recommend' ? ' is-open' : '')}
        onClick={(e) => { e.stopPropagation(); toggle('recommend', hasRec); }}
        onMouseEnter={() => { if (hasRec && !pinned) setOpenPanel('recommend'); }}
        tabIndex={hasRec ? 0 : -1}
        aria-label={hasRec
          ? `Recommended by ${recommendedBy.length} ${recommendedBy.length === 1 ? 'person' : 'people'} in your network`
          : 'No one in your network has recommended this yet'}
        title={hasRec ? 'People in your network recommend this' : 'No recommendations from your network yet'}
      >
        <Icon name="thumbs-up" size={11} />
      </button>
      {openPanel && (
        <span className="sigchips__pop" ref={popRef} onClick={(e) => e.stopPropagation()}>
          <p className="engage__panel-label">
            {openPanel === 'trust'
              ? 'In your web, trusting this member:'
              : 'In your network, recommending this:'}
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
        </span>
      )}
    </span>
  );
}

interface Props {
  /** THE POST PAGE'S SIGNALS SIT AT THE BOTTOM (founder 2026-10-23, second
   *  pass on the same day's header move: on the expanded post "the trust and
   *  recommend architecture should be at the bottom, so you hover there and
   *  it does the drop down") — pass the signals here and the footer leads
   *  with the chips + a divider, home's old balanced shape. Stream cards
   *  keep their chips beside the name and leave this out. */
  signals?: MyceliumSignals;
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
  /** BUDGET (founder 2026-10-21, replacing PostPage's top-right bolt circle:
   *  "the recommend is at the bottom, so is the drive, so they don't need to
   *  be top right?" + "is current-cy supposed to mean I purchased it?"):
   *  a labeled bolt action — puts the listing on YOUR private Budget
   *  planning list in Current-cy (never a purchase; buying stays the
   *  exchange flow). Opt-in: only the expanded post page passes it. */
  budgeted?: boolean;
  onBudget?: (active: boolean) => void;
}

/** Engagement footer for every post / card / listing across the app —
 *  YOUR ACTIONS only (Recommend, Share, Save, Chat; Budget on the post's own
 *  page). The network SIGNALS moved up beside the author's name 2026-10-23
 *  (founder; see SignalChips above) — the old left slot and its divider are
 *  gone. Unavailable actions show lighter-gray and can't be tapped. */
export default function EngagementFooter({
  signals,
  trusted, recommended, saved,
  availability,
  onTrust, onRecommend, onShare, onSave, onChat,
  budgeted, onBudget,
}: Props) {
  const [myTrust, setMyTrust] = useState(trusted ?? false);
  const [myRec, setMyRec] = useState(recommended ?? false);
  const [mySaved, setMySaved] = useState(saved ?? false);
  const [myBudget, setMyBudget] = useState(budgeted ?? false);

  const can = {
    trust: availability?.trust !== false,
    recommend: availability?.recommend !== false,
    share: availability?.share !== false,
    save: availability?.save !== false,
    chat: availability?.chat !== false,
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
    <div className="engage">
      <div className="engage__row">
        {/* On stream cards the signals live beside the author's name; the
            EXPANDED post page passes them back down here (founder 2026-10-23)
            — same chips, same hover drop-down, home's balanced bar shape. */}
        {signals !== undefined && (
          <>
            <div className="engage__signals-slot">
              <SignalChips mycelium={signals} />
            </div>
            <div className="engage__divider" aria-hidden="true" />
          </>
        )}
        <div className="engage__actions">
          {/* NO TRUST BUTTON HERE — and none in the card header anymore
              either (founder 2026-10-12 retired the shield by the name; the
              2026-08-07 placement is superseded). The footer is what you do
              with the CONTENT; trusting is what you think of the PERSON, so
              the gesture lives on their profile's Trust door. The lower-left
              shield SIGNAL is the architecture on cards now. */}
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
          {onBudget && (
            <button
              className={'engage__action' + (myBudget ? ' is-active' : '')}
              onClick={(e) => {
                e.stopPropagation();
                const next = !myBudget;
                setMyBudget(next);
                onBudget(next);
              }}
              title={myBudget
                ? 'On your Budget planning list — tap to remove'
                : 'Add to your Budget planning list in Current-cy (not a purchase)'}
            >
              <Icon name="currentcy" size={13} />
              <span>Budget</span>
            </button>
          )}
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
    </div>
  );
}
