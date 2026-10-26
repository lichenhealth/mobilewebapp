import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import './EngagementFooter.css';

export interface MyceliumMember {
  handle: string;
  name: string;
  monogram?: string;
  color?: string;
  /** What this recommendation is OF (founder 2026-10-26): 'post' = this
   *  specific listing/post; 'creator' = the poster and all they offer.
   *  Post recs list first; absent reads as a post rec (legacy rows). */
  about?: 'post' | 'creator';
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

/** THE SIGNALS LIVE AT THE FOOTER'S BOTTOM LEFT, on every card (founder
 *  2026-10-26, pointing at the Figma mock 286-19122 whose footer leads with
 *  the two bare signal icons + a divider — retiring the 10-23 beside-the-
 *  name placement after three days): shield = your web trusts the POSTER
 *  (always the person/entity who posted), thumb = your network recommends —
 *  LIGHT peach (tint) when lit, gray when quiet, hover or tap a lit chip to
 *  see WHO (never how many).
 *
 *  THE POP IS ALSO THE ACT (founder 2026-10-26, same day: "have the
 *  resulting pop up prompt you by confirming the act, e.g. Trust Galyn…
 *  and recommend is about the product or service listed in the post"):
 *  tapping a chip — lit or quiet — opens the pop, which lists who in your
 *  network has spoken AND carries the confirm button: the shield's acts on
 *  the POSTER ("Trust @galyn"), the thumb's on THIS POST ("Recommend this
 *  post" — the same write as the labeled Recommend action; several doors,
 *  one truth). The recommend list groups POST recs first, then recs of the
 *  poster ("Recommends are first for the specific post, and then we have
 *  recommends of the person" — so a barely-seen post still shows the
 *  creator's network validation). ORGS ARE TRUSTABLE since 2026-10-26
 *  (founder: "I like the ability to trust an org. You can take that trust
 *  away, too") — a space-authored post's shield acts on the SPACE, the same
 *  gesture as trusting a person; the old person-to-person honest line is
 *  superseded. */
export function SignalChips({
  mycelium, subjectName,
  myTrust, onTrustAct, myRec, onRecAct,
  openPanel, pinned, onPanel,
}: {
  mycelium?: MyceliumSignals;
  /** Who posted — e.g. "@galyn" or "@pine-valley-grange" — named in labels
   *  and on the trust act. */
  subjectName?: string;
  myTrust?: boolean;
  /** Toggle YOUR trust of the poster (absent = no act button renders). */
  onTrustAct?: () => void;
  myRec?: boolean;
  /** Toggle YOUR recommendation of this post. */
  onRecAct?: () => void;
  /** THE POP IS CONTROLLED BY THE FOOTER (founder 2026-10-26, the labeled
   *  Trust action: "add trust back to the actions on each post, with the pop
   *  up confirming") — the parent owns which panel is open so its own Trust
   *  button opens the same confirm pop the shield chip does. */
  openPanel: 'trust' | 'recommend' | null;
  pinned: boolean;
  onPanel: (panel: 'trust' | 'recommend' | null, pinned: boolean) => void;
}) {
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
  // Post recs lead, creator recs follow (absent `about` reads as post — legacy).
  const postRecs = recommendedBy.filter((m) => m.about !== 'creator');
  const creatorRecs = recommendedBy.filter((m) => m.about === 'creator');
  const subject = subjectName || 'this member';
  // A tap always opens — the pop is where the ACT lives now, so a quiet chip
  // still answers with the honest empty state + the confirm button.
  const toggle = (which: 'trust' | 'recommend') => {
    if (openPanel === which && pinned) onPanel(null, false);
    else onPanel(which, true);
  };
  const memberList = (list: MyceliumMember[]) => (
    <ul className="engage__members">
      {list.map((m) => (
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
  );
  return (
    <span className="sigchips" onMouseLeave={() => { if (!pinned) onPanel(null, false); }}>
      <button
        type="button"
        className={'sigchips__chip' + (hasTrust ? ' is-lit' : '') + (openPanel === 'trust' ? ' is-open' : '')}
        onClick={(e) => { e.stopPropagation(); toggle('trust'); }}
        onMouseEnter={() => { if (hasTrust && !pinned) onPanel('trust', false); }}
        aria-label={hasTrust
          ? `Trusted by ${trustedBy.length} ${trustedBy.length === 1 ? 'person' : 'people'} in your web — open to see who, or add your trust`
          : `No one in your web has trusted ${subject} yet — open to add your trust`}
        title={hasTrust ? `People in your web trust ${subject}` : `Trust ${subject}`}
      >
        <Icon name="shield-user" size={11} />
      </button>
      <button
        type="button"
        className={'sigchips__chip' + (hasRec ? ' is-lit' : '') + (openPanel === 'recommend' ? ' is-open' : '')}
        onClick={(e) => { e.stopPropagation(); toggle('recommend'); }}
        onMouseEnter={() => { if (hasRec && !pinned) onPanel('recommend', false); }}
        aria-label={hasRec
          ? `Recommended by ${recommendedBy.length} ${recommendedBy.length === 1 ? 'person' : 'people'} in your network — open to see who, or add yours`
          : 'No one in your network has recommended this yet — open to recommend it'}
        title={hasRec ? 'People in your network recommend this' : 'Recommend this post'}
      >
        <Icon name="thumbs-up" size={11} />
      </button>
      {openPanel === 'trust' && (
        <span className="sigchips__pop" ref={popRef} onClick={(e) => e.stopPropagation()}>
          {hasTrust ? (
            <>
              <p className="engage__panel-label">In your web, trusting {subject}:</p>
              {memberList(trustedBy)}
            </>
          ) : (
            <p className="sigchips__note">No one in your web has trusted {subject} yet.</p>
          )}
          {onTrustAct && (
            <>
              {/* THE CONFIRM NAMES WHAT IS TRUSTED (founder 2026-10-26: "the
                  pop up confirming that you're trusting the person, not the
                  shirts"): trust is of the poster and all they offer, never
                  one listing. */}
              <p className="sigchips__note">This is trust in {subject} — them and all they offer, not just this post.</p>
              <button
                type="button"
                className={'sigchips__act' + (myTrust ? ' is-on' : '')}
                onClick={(e) => { e.stopPropagation(); onTrustAct(); }}
              >
                {myTrust ? `You trust ${subject} ✓ — withdraw` : `Trust ${subject}`}
              </button>
            </>
          )}
        </span>
      )}
      {openPanel === 'recommend' && (
        <span className="sigchips__pop" ref={popRef} onClick={(e) => e.stopPropagation()}>
          {postRecs.length > 0 && (
            <>
              <p className="engage__panel-label">Recommending this post:</p>
              {memberList(postRecs)}
            </>
          )}
          {creatorRecs.length > 0 && (
            <>
              <p className="engage__panel-label">Recommending {subject}:</p>
              {memberList(creatorRecs)}
            </>
          )}
          {!hasRec && (
            <p className="sigchips__note">No recommendations from your network yet.</p>
          )}
          {onRecAct && (
            <button
              type="button"
              className={'sigchips__act' + (myRec ? ' is-on' : '')}
              onClick={(e) => { e.stopPropagation(); onRecAct(); }}
            >
              {myRec ? 'You recommend this ✓ — withdraw' : 'Recommend this post'}
            </button>
          )}
        </span>
      )}
    </span>
  );
}

interface Props {
  /** The network signals (see SignalChips above) — every card passes them
   *  since 2026-10-26 (the Figma mock's footer shape): chips bottom-left, a
   *  full-height divider, then the actions. */
  signals?: MyceliumSignals;
  /** Who posted (e.g. "@galyn", "@pine-valley-grange") — named by the signal
   *  pops and the trust act. Trust follows the poster: person OR space
   *  (founder 2026-10-26 — orgs are trustable). */
  subjectName?: string;
  /** The viewer wrote this post (founder 2026-10-26: "For your own posts,
   *  trust and recommend should be absent") — no signal chips, no Trust, no
   *  Recommend; the bar is Share · Save · (Budget) · Chat, where Chat is the
   *  self text. */
  ownPost?: boolean;
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

/** Engagement footer for every post / card / listing across the app: the
 *  network SIGNAL chips bottom-left (who trusts the poster / recommends
 *  this — and, since 2026-10-26, where trusting and recommending are
 *  confirmed, in the chip's own pop), a divider, then YOUR ACTIONS
 *  (Recommend, Share, Save, Chat; Budget on the post's own page).
 *  Unavailable actions show lighter-gray and can't be tapped. */
export default function EngagementFooter({
  signals, subjectName, ownPost,
  trusted, recommended, saved,
  availability,
  onTrust, onRecommend, onShare, onSave, onChat,
  budgeted, onBudget,
}: Props) {
  // The signal pop — owned here so the labeled Trust ACTION opens the same
  // confirm pop the shield chip does (founder 2026-10-26).
  const [panel, setPanel] = useState<'trust' | 'recommend' | null>(null);
  const [panelPinned, setPanelPinned] = useState(false);
  const onPanel = (p: 'trust' | 'recommend' | null, pin: boolean) => { setPanel(p); setPanelPinned(pin); };
  const [myTrust, setMyTrust] = useState(trusted ?? false);
  const [myRec, setMyRec] = useState(recommended ?? false);
  const [mySaved, setMySaved] = useState(saved ?? false);
  const [myBudget, setMyBudget] = useState(budgeted ?? false);
  // Several surfaces load the viewer's own trust/rec/save sets AFTER the
  // cards first render — adopt a prop when its VALUE changes, or the pop's
  // act button (and the lit actions) would lie until a remount.
  useEffect(() => { if (trusted !== undefined) setMyTrust(trusted); }, [trusted]);
  useEffect(() => { if (recommended !== undefined) setMyRec(recommended); }, [recommended]);
  useEffect(() => { if (saved !== undefined) setMySaved(saved); }, [saved]);
  useEffect(() => { if (budgeted !== undefined) setMyBudget(budgeted); }, [budgeted]);

  const can = {
    trust: availability?.trust !== false,
    recommend: availability?.recommend !== false,
    share: availability?.share !== false,
    save: availability?.save !== false,
    chat: availability?.chat !== false,
  };

  // One truth per act: the shield pop's trust button and (someday) any other
  // trust door share this toggle; the thumb pop's recommend button shares the
  // labeled Recommend action's — several doors, one write.
  const actTrust = () => {
    if (!can.trust) return;
    const next = !myTrust;
    setMyTrust(next);
    onTrust?.(next);
  };
  const actRec = () => {
    if (!can.recommend) return;
    const next = !myRec;
    setMyRec(next);
    onRecommend?.(next);
  };
  const handleRec = (e: React.MouseEvent) => {
    e.stopPropagation();
    actRec();
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
        {/* Signals lead the bar (founder 2026-10-26, the Figma mock's shape)
            — chips, divider, then the actions — EXCEPT on your own post,
            where trust and recommend are ABSENT entirely (founder, same day:
            "For your own posts, trust and recommend should be absent, versus
            showing you everyone you trust or recommend"). */}
        {signals !== undefined && !ownPost && (
          <>
            <div className="engage__signals-slot">
              <SignalChips
                mycelium={signals}
                subjectName={subjectName}
                myTrust={myTrust}
                onTrustAct={can.trust && onTrust ? actTrust : undefined}
                myRec={myRec}
                onRecAct={can.recommend && onRecommend ? actRec : undefined}
                openPanel={panel}
                pinned={panelPinned}
                onPanel={onPanel}
              />
            </div>
            <div className="engage__divider" aria-hidden="true" />
          </>
        )}
        <div className="engage__actions">
          {/* TRUST IS BACK IN THE ACTIONS ROW (founder 2026-10-26: "we need
              to add trust back to the actions on each post, with the pop up
              confirming that you're trusting the person, not the shirts") —
              the button OPENS the shield's confirm pop rather than toggling
              silently, so the act always says WHO it lands on. One pop, one
              write, several doors. */}
          {!ownPost && (
            <button
              className={'engage__action' + (myTrust && can.trust ? ' is-active' : '')}
              onClick={(e) => {
                e.stopPropagation();
                if (!can.trust) return;
                if (panel === 'trust' && panelPinned) onPanel(null, false);
                else onPanel('trust', true);
              }}
              disabled={!can.trust}
              title={can.trust ? undefined : 'Not available for this content'}
            >
              <Icon name="shield-user" size={13} />
              <span>Trust</span>
            </button>
          )}
          {!ownPost && (
            <button
              className={'engage__action' + (myRec && can.recommend ? ' is-active' : '')}
              onClick={handleRec}
              disabled={!can.recommend}
              title={can.recommend ? undefined : 'Not available for this content'}
            >
              <Icon name="thumbs-up" size={13} />
              <span>Recommend</span>
            </button>
          )}
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
