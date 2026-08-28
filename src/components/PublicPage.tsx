import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appUrl } from '../lib/customDomain';
import { Icon, type IconName } from './Icon';
import Avatar from './Avatar';
import { ContactList, type ContactInfo } from './ContactFields';
import { tabById, tabHasContent, type PageTab } from '../lib/pageTabs';
import { subjectPronoun } from '../lib/names';
import KnockForm from './KnockForm';
import './PublicPage.css';

// One structure for every Lichen site (founder 2026-07-28): hero, story,
// offerings, practical, presence, join. Visitors learn to read one page and
// can read them all — and members never face a blank canvas, because most of
// it fills itself from what they already keep on Lichen.

const posToObjectPos = (pos?: string | number): string => {
  if (pos === 'top') return '50% 0%';
  if (pos === 'bottom') return '50% 100%';
  if (typeof pos === 'number') return `50% ${pos}%`;
  // The drag editor stores real percents ("50% 37%") — pass them through.
  if (typeof pos === 'string' && pos.includes('%')) return pos;
  return '50% 50%'; // center or default
};

export type ContactActionKind = 'call' | 'book' | 'email' | 'visit';

/** Handed to a render-function `feed` on every tab (see the prop's doc).
 *  `guest` = render as the open web sees it (a real signed-out visitor, or
 *  the owner previewing) — no member doors, no member actions. */
export type FeedRenderCtx = {
  showing: boolean; open: () => void; guest: boolean;
  /** The template's word-tab row, handed INTO the stream so it can sit
   *  below the icon row — icons above, toggles below on every screen
   *  (founder 2026-08-14). Absent for guests (nav stays in the hero). */
  navSlot?: React.ReactNode;
  /** Switches to the page's Home tab — where an empty feed sends people.
   *  Offered ONLY when Home has something to show (founder 2026-08-17: the
   *  escape used to open a bare Home — a door into an empty room). */
  openHome?: () => void;
  /** Home exists but has nothing on it yet — the owner should build it. */
  homeBare?: boolean;
};

export interface PageMeta {
  tagline?: string;
  story?: string;
  /** A live page with the link, but search engines asked to leave it alone
   *  (founder 2026-08-20: "a functional web page to send to people" without
   *  "a presence on Google"). Rendered as meta robots noindex. */
  noindex?: boolean;
  /** What Home shows instead of the story's opening (founder 2026-08-11:
   *  "a smart summary… versus just the first part of the story"). Written
   *  by the owner or drafted by Claude; falls back to the first two
   *  paragraphs when empty, so Home is never blank. */
  homeSummary?: string;
  cover?: string;
  /** Vertical crop position for the cover, 0 (top) – 100 (bottom), default
   *  centered — "so I can move it up to see my dog's face" (founder
   *  2026-08-11). */
  coverPos?: number;
  coverStyle?: 'photo' | 'tint' | 'plain';
  accent?: string;
  /** Legacy single CTA — kept for old rows; new saves write `actions`. */
  action?: { kind: 'call' | 'book' | 'email' | 'visit' | 'none'; label?: string; href?: string };
  /** "How do you want people to get in touch" (founder 2026-08-11) —
   *  multi-select, one CTA pill each, hrefs derived from Contact & hours.
   *  Replaces the old one-action doctrine. */
  actions?: ContactActionKind[];
  practical?: { bring?: string; parking?: string; access?: string };
  /** The grounds themselves — arena, tack room, stalls. Its own section
   *  (and its own hero-nav door) when present. */
  facilities?: string;
  /** Per-door flavor (founder 2026-07-29): an optional summary sentence and
   *  an image between it and the body — uniform on every public page.
   *  Contact stays utilitarian on purpose. */
  /** EVERY tab may carry its own lead + photo (founder 2026-08-22: "all
   *  tabs should") — keyed by tab id, built-in or custom. `imagePos` is the
   *  vertical crop for THIS image — words, a bare 0–100 number, or the drag
   *  editor's '50% N%' — because the page-wide coverPos is tuned for the
   *  cover (founder 2026-08-21: Katie's face, cut off on Services).
   *  imageSize 'full' opts that photo out of the standard frame entirely. */
  sections?: Partial<Record<string, { lead?: string; image?: string; imagePos?: string | number; imageSize?: string; tabOff?: boolean }>>;
  /** How loudly the page invites visitors into Lichen (founder 2026-07-29):
   *  'full' (default) = the peach doorway card; 'quiet' = one muted footer
   *  line — for pages whose owner prefers to invite people themselves once
   *  they've vetted them; 'none' = no corner Sign in and no invitation card
   *  (founder 2026-08-28: a page can be published as somebody's website
   *  before its owner has been walked through the platform). ⚠ 'none' is
   *  NOT "no mention of Lichen" — the credit-and-invite floor line renders
   *  at every level (founder, same day, choosing reach over silence). If
   *  that ever changes, the page-builder copy promising what each level
   *  does must change WITH it. Members reach the app at lichen.health, so
   *  nobody is locked out. */
  join?: 'full' | 'quiet' | 'none';
  /** Custom doors (founder 2026-07-29, the front door): fully data-driven
   *  pages replacing the built-in About/Services/Facilities/Contact set.
   *  A door with `href` is a link out (to /about, a collection, /donate);
   *  a door with `body` renders lead → image → paragraphs; `contact: true`
   *  renders the contact list. */
  doors?: {
    id: string; label: string; lead?: string; image?: string;
    body?: string; href?: string; contact?: boolean;
    /** Real renderings of the real app (founder 2026-07-29) — phone-framed
     *  screenshots with captions, in place of the old site's mockups. */
    shots?: { src: string; caption?: string }[];
  }[];
  /** Services with their terms, for entities without Lichen categories yet
   *  ("Private lessons · 45 min · $60"). Members' offerings come from their
   *  categories instead. */
  offerings?: string[];
  /** The people behind it — a barn, a practice, a farm is its people. */
  team?: { name: string; role?: string; note?: string; photo?: string }[];
  /** A few more images, shown as a quiet strip under the story. */
  photos?: string[];
  /** Images woven INTO the story (founder 2026-07-29): each renders after
   *  its 1-based paragraph number, so the picture sits beside the words
   *  that tell it. A template feature for every public page. `pos` = the
   *  vertical crop (0 top – 100 bottom) when the frame crops; `full` shows
   *  the whole photo at its natural shape, no crop (founder 2026-08-21:
   *  "expand this pic down so you can see Katie"). */
  storyImages?: { after: number; src: string; pos?: number; full?: boolean }[];
  showPosts?: boolean;
  /** The tabs this page's owner chose from the template library
   *  (founder 2026-08-05). When present, these drive the row. */
  tabs?: PageTab[];
}

export interface PublicPageProps {
  id: string;
  name: string;
  kindLabel?: string;          // "Place", "Organization", or a person's headline
  /** Optional, stated by the member. Sits under the name — a fact about how
   *  to refer to someone, not a claim about them. */
  pronouns?: string | null;
  /** The page speaks as "we" (spaces) instead of she/he/they (members). */
  firstPerson?: boolean;
  /** The kind's mark, shown beside its word — spaces only (founder
   *  2026-08-05: the kind belongs under the name, not in the top bar). */
  kindIcon?: IconName;
  avatarUrl?: string | null;
  description?: string | null; // the Lichen bio/description, used when story is empty
  location?: string | null;
  offerings?: string[];        // category names
  contact: ContactInfo;
  page: PageMeta;
  /** Rendered under Presence — events, posts. Optional. */
  children?: React.ReactNode;
  /** Rendered ABOVE the masthead — the steward's own controls, which have to
   *  be reachable without scrolling past a full-bleed cover image (founder
   *  2026-08-07: "move admin/member view up to above the fold when you're
   *  acting as a page, so you can manage it easily if there is a hero image").
   *  Everything else a viewer sees belongs below, in beforeContent. */
  aboveHero?: React.ReactNode;
  /** Your relationship with this entity — weave, recommend, join. Rendered
   *  INSIDE the hero, under the nav and above the cover image, so it can't be
   *  pushed below a tall photo (founder 2026-08-07: "icons with text, as they
   *  appear in the directory, somewhere near the top of the profile"). */
  heroSignals?: React.ReactNode;
  /** Rendered right under the hero, above every other section — for
   *  navigational doors that shouldn't get lost below a long page
   *  (founder 2026-08-03). Optional. */
  beforeContent?: React.ReactNode;
  /** The entity's stream — member-only unless page.showPosts opens it to
   *  the web. Pass the render-function form to move the Feed door INTO the
   *  stream's own icon row (founder 2026-08-11: "move the newsfeed icon to
   *  where it appears on all profiles"): it's called on EVERY tab so the
   *  row persists as the section switcher — `showing` says whether the feed
   *  list itself is the active tab, `open` switches back to it. A plain
   *  node keeps the legacy Feed-icon-in-the-nav behavior. */
  feed?: React.ReactNode | ((ctx: FeedRenderCtx) => React.ReactNode);
  /** Offerings WITH ids and domains, so Services and Goods can be separate
   *  tabs and each row can carry its own recommend (founder 2026-08-06:
   *  "you don't recommend a person, you recommend their work"). */
  offeringRows?: { id: string; name: string; domain: string }[];
  /** Renders the thumb for one offering; omitted for guests. */
  renderOfferingAction?: (o: { id: string; name: string }) => React.ReactNode;
  /** A member's Goods & Services addresses marked show-on-profile
   *  (founder 2026-08-11) — rendered as extra Practical rows, each
   *  opening in maps. */
  bizLocations?: { label: string; location: string }[];
  /** Owner previewing their own page. */
  preview?: boolean;
  /** A signed-in Lichen member viewing this in-app (founder 2026-08-03) —
   *  they keep their normal app chrome and skip the guest-facing invite
   *  doors/section; their real join/trust controls arrive via `children`. */
  signedIn?: boolean;
  /** A SPACE's page is a gateway into Lichen (founder 2026-08-17): a
   *  signed-out visitor can knock right here — "Request to join «name»" —
   *  and the knock carries the space, so its stewards can answer it. */
  knockSpace?: { id: string; name: string; kindLabel: string };
  /** Page-owner-independent actions (e.g. a space's "See it on Maps") that
   *  belong BESIDE the page's own CTAs — one place for every action. */
  extraCtas?: { label: React.ReactNode; onClick: () => void }[];
}

export default function PublicPage(props: PublicPageProps) {
  const navigate = useNavigate();
  // Lichen doors cross back to Lichen's own origin when this page is served
  // from a member's custom domain.
  // Ask crawlers to leave a noindex page alone. Client-side meta is honored
  // by the major engines' renderers; api/page.ts adds it server-side too for
  // the share routes it covers.
  useEffect(() => {
    if (!props.page.noindex) return;
    const m = document.createElement('meta');
    m.name = 'robots'; m.content = 'noindex';
    document.head.appendChild(m);
    return () => { m.remove(); };
  }, [props.page.noindex]);

  const go = (path: string) => {
    const u = appUrl(path);
    if (u.startsWith('http')) window.location.href = u; else navigate(u);
  };
  const { name, kindLabel, avatarUrl, description, location, contact, page } = props;
  const offerings = props.offerings?.length ? props.offerings : (page.offerings ?? []);
  const accent = page.accent || 'var(--peach)';
  const story = (page.story || description || '').trim();
  // Is there anything on Home worth sending someone to? A tagline, a story
  // or an offering counts; the name and kind alone are the empty room.
  const homeHasContent = !!(page.tagline?.trim() || story || offerings.length);

  // "How do you want people to get in touch" (founder 2026-08-11) —
  // multi-select now; the old one-action doctrine is retired. New saves
  // write `page.actions`; old rows still carry the singular `page.action`,
  // read here as a one-item list so nothing re-saves before it renders.
  // Each pick resolves against Contact & hours; unresolvable ones (empty
  // contact field) simply don't render — the editor's hints say why.
  const actionKinds: ContactActionKind[] = page.actions
    ?? (page.action && page.action.kind !== 'none' ? [page.action.kind] : []);
  const ACTION_LABEL: Record<ContactActionKind, string> = {
    call: 'Call us', book: 'Book a time', email: 'Get in touch', visit: 'Visit us',
  };
  const actionHref = (kind: ContactActionKind): string | undefined =>
    kind === 'call' ? (contact.phone ? `tel:${contact.phone.replace(/[^\d+]/g, '')}` : undefined)
      : kind === 'email' ? (contact.email ? `mailto:${contact.email}` : undefined)
      : kind === 'book' ? (contact.booking || undefined)
      : (contact.address ? `https://maps.google.com/?q=${encodeURIComponent(contact.address)}` : undefined);
  const ctas = actionKinds
    .map((kind) => ({
      kind,
      // A legacy action's hand-set href/label still win for its own kind.
      href: (page.action?.kind === kind && page.action.href) || actionHref(kind),
      label: (page.action?.kind === kind && page.action.label) || ACTION_LABEL[kind],
    }))
    .filter((c): c is { kind: ContactActionKind; href: string; label: string } => !!c.href);

  // Hero nav (founder 2026-07-29): section doors as clickable text on the
  // left, the one primary action far right — the same learn-once-read-all
  // structure on every Lichen site. Doors are PAGES, not scroll anchors:
  // only the active section renders below the hero. Only doors whose
  // section exists render; with no doors, everything shows inline.
  const bizLocations = props.bizLocations ?? [];
  const hasContact = Object.keys(contact).length > 0 || !!page.practical || bizLocations.length > 0;
  // ONE tab row (founder 2026-08-05, merging the in-app profile with the web
  // page): Feed first, then whichever templated sections actually have
  // content. A person with nothing but posts sees no tabs at all — the right
  // amount of chrome for them.
  //
  // Feed is member-only unless the page opts in via page.showPosts, which was
  // declared in PageMeta from the start and never read until now.
  // "Public is what people outside of Lichen see" (founder 2026-08-11):
  // preview renders exactly what a signed-out visitor gets — the feed only
  // when the owner opted in via page.showPosts, and never as the landing
  // tab: tab content (About) greets the open web first.
  const asGuest = !props.signedIn || !!props.preview;
  const showFeed = !!props.feed && (!asGuest || page.showPosts === true);
  // The owner's own subject pronoun for tease-link copy — she/he/ze when the
  // member set pronouns, they otherwise (and always they for a space, which
  // passes no pronouns). Never inferred from a name.
  const subj = props.firstPerson ? { word: 'we', plural: true } : subjectPronoun(props.pronouns);
  // The render-function form carries its own Feed door inside the stream's
  // icon row (founder 2026-08-11: the newsfeed circle belongs with the other
  // circles, not beside the About/Services text tabs) — so the nav skips it.
  const feedInRow = typeof props.feed === 'function';
  // Custom doors (Countryman Stables) keep their own set; Feed joins in front.
  const doors = page.doors?.length ? page.doors : null;

  // TABS THE OWNER CHOSE, from the template library (founder 2026-08-05:
  // "create a bunch of tab options... and people can select those
  // templates"). Built-in ids draw on data Lichen already holds; the rest
  // carry their own lead and body. A chosen tab still only appears once it
  // has something to show — adding one is an invitation to write, not an
  // empty room for a visitor to walk into.
  const chosen: PageTab[] = page.tabs?.length ? page.tabs : [];
  const svcRows = (props.offeringRows ?? []).filter((o) => o.domain === 'service');
  const goodRows = (props.offeringRows ?? []).filter((o) => o.domain === 'good');
  const builtInHasContent = (id: string) =>
    id === 'about' ? !!story
      : id === 'goods' ? goodRows.length > 0
      : id === 'services' ? (svcRows.length > 0 || offerings.length > 0)
      : id === 'facilities' ? !!page.facilities
      : id === 'contact' ? hasContact
      : false;
  const liveChosen = chosen.filter((t) => {
    const tpl = tabById(t.id);
    return tpl?.builtIn ? builtInHasContent(t.id) : tabHasContent(t, tpl);
  });
  // CONTENT CREATES THE TAB (founder 2026-08-26: "a smart reading of the
  // situation"): a page holding facilities text grows a Facilities tab even
  // when the builder never picked one — X-able in the builder, which stores
  // the decline at sections.facilities.tabOff. Slotted before Contact, where
  // websites keep it.
  if (liveChosen.length > 0 && !!page.facilities?.trim()
      && !liveChosen.some((t) => t.id === 'facilities')
      && !page.sections?.facilities?.tabOff) {
    const at = liveChosen.findIndex((t) => t.id === 'contact');
    liveChosen.splice(at >= 0 ? at : liveChosen.length, 0, { id: 'facilities' });
  }

  const sectionItems = liveChosen.length
    ? liveChosen.map((t) => ({ id: t.id, label: t.label ?? tabById(t.id)?.label ?? t.id }))
    : doors
      ? doors.map((d) => ({ id: d.id, label: d.label }))
      : [
        story ? { id: 'about', label: 'About' } : null,
        offerings.length > 0 ? { id: 'services', label: 'Services' } : null,
        page.facilities ? { id: 'facilities', label: 'Facilities' } : null,
        hasContact ? { id: 'contact', label: 'Contact' } : null,
      ].filter((n): n is { id: string; label: string } => !!n);
  // EVERY public page has a Home to land on (founder 2026-08-11: "you
  // always have to have a homepage to land on"). Home is the front page —
  // the story, the offerings, the practical details, in the template's
  // own order — so a visitor never meets a blank tab; About/Services and
  // the rest are optional doors INTO those sections. Members skip it:
  // their landing is the feed in the icon row.
  // (A page driven by fully custom doors brings its own front door — Home
  // would render nothing there.)
  // Members get Home too now (founder 2026-08-14) — it was guest/preview
  // only, which meant Lichen View had no front page at all.
  const homeItem = !doors ? [{ id: 'home', label: 'Home' }] : [];
  const navItems = showFeed && !feedInRow
    ? [{ id: 'feed', label: 'Feed' }, ...homeItem, ...sectionItems]
    : [...homeItem, ...sectionItems];
  // Landing: guests always meet Home; members always land on Feed (founder
  // 2026-08-14, choosing one rule over the earlier feed-when-nonempty: "I
  // prefer consistency") — an EMPTY feed says so and kicks you up to the
  // Home tab instead of quietly landing you elsewhere.
  const firstContentDoor = asGuest
    ? 'home'
    : (showFeed ? 'feed' : doors?.find((d) => !d.href)?.id ?? (homeItem.length ? 'home' : undefined));
  const [tab, setTab] = useState(firstContentDoor ?? navItems[0]?.id ?? 'about');
  // Re-land when the VIEW ITSELF changes (Lichen View ⇄ Public View swaps
  // ?preview= in place): the old tab may not exist on the other side, which
  // used to leave a blank page until a hand refresh re-initialized state.
  const relandKey = asGuest ? 'guest' : 'member';
  const relandInit = useRef(relandKey);
  // A tab the VIEWER chose sticks; only automatic landings may be replaced.
  const touched = useRef(false);
  const chooseTab = (id: string) => { touched.current = true; setTab(id); };
  useEffect(() => {
    if (relandInit.current === relandKey) return;
    relandInit.current = relandKey;
    touched.current = false;
    setTab(firstContentDoor ?? navItems[0]?.id ?? 'about');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relandKey]);
  const tabbed = navItems.length > 0;
  const showingFeed = showFeed && tab === 'feed';
  // Home shows the lot — it IS the front page; a named tab narrows to its
  // own section.
  const show = (id: string) => !doors && !showingFeed && (tab === 'home' || !tabbed || tab === id);
  // ROOT AND BRANCHES (founder 2026-08-11): Home teases and routes. A section
  // that has a tab of its own gives a taste on Home with a way through; a
  // section with nowhere to route shows in full, so nothing is ever truncated
  // into a dead end.
  const teasing = (id: string) => tab === 'home' && navItems.some((n) => n.id === id);
  const More = ({ to, children }: { to: string; children: React.ReactNode }) => (
    <button className="ppage__more" type="button" onClick={() => chooseTab(to)}>
      {children} <span aria-hidden>&rarr;</span>
    </button>
  );
  // ICONS ABOVE, TOGGLES BELOW (founder 2026-08-14: "I would prefer
  // consistency"): for a signed-in member whose feed rides the icon row, the
  // word-tab nav moves OUT of the hero and into the stream's navSlot — right
  // under the icon row, like Home's filters. Guests and previews keep the
  // hero nav: the public website's masthead is its own design.
  const navInHero = !(feedInRow && !asGuest);
  const navNode = navItems.length > 0 ? (
    <nav className={'ppage__nav' + (navInHero ? '' : ' ppage__nav--below')}>
      {navItems.map((n) => {
        const d = doors?.find((x) => x.id === n.id);
        // Legacy plain-node feed keeps its nav-icon door (founder 2026-08-09);
        // render-function feeds never put 'feed' in navItems at all.
        if (n.id === 'feed') {
          return (
            <button
              className={'ppage__nav-icon' + (tab === n.id ? ' ppage__nav-icon--on' : '')}
              onClick={() => chooseTab(n.id)} key={n.id} type="button" aria-label={n.label} title={n.label}
            >
              <Icon name="newsfeed" size={18} />
            </button>
          );
        }
        return (
          <button
            className={'ppage__nav-link' + (tab === n.id ? ' ppage__nav-link--on' : '')}
            onClick={() => (d?.href ? go(d.href) : chooseTab(n.id))} key={n.id} type="button"
          >
            {n.label}
          </button>
        );
      })}
      {ctas.map((c) => (
        <a className="ppage__cta ppage__cta--nav" key={c.kind} href={c.href}
          target={c.href.startsWith('http') ? '_blank' : undefined} rel="noopener">
          {c.label}
        </a>
      ))}
      {/* Actions live in ONE place (founder 2026-08-14) — page-owner
          CTAs and app doors like "See it on Maps" sit side by side. */}
      {props.extraCtas?.map((c, i) => (
        <button className="ppage__cta ppage__cta--nav" key={'x' + i} type="button" onClick={c.onClick}>{c.label}</button>
      ))}
    </nav>
  ) : null;
  const activeDoor = doors?.find((d) => d.id === tab) ?? null;
  const activeChosen = liveChosen.find((t) => t.id === tab && !tabById(t.id)?.builtIn) ?? null;

  // Tap any image for a closer, uncropped look (founder 2026-07-29).
  const [lightbox, setLightbox] = useState<string | null>(null);
  // Sections a Home reader opened in place (summarized sections with no tab
  // of their own — the door expands instead of routing).
  const [openSecs, setOpenSecs] = useState<Set<string>>(new Set());

  // A visitor from the open web isn't an app user — no Lichen top bar, no
  // bottom tabs (founder 2026-07-29). Signed-in members keep their normal
  // app chrome instead (founder 2026-08-03) — this page renders for them
  // too now, alongside their real join/trust/feed controls in `children`.
  useEffect(() => {
    if (props.signedIn) return;
    document.documentElement.classList.add('is-public-page');
    return () => document.documentElement.classList.remove('is-public-page');
  }, [props.signedIn]);

  // Uniform door anatomy (founder 2026-07-29): each door owns the cover
  // slot — About wears the page cover, every other door wears its own
  // section image up top; the lead reads as the section's title below it.
  const flavor = (id: 'about' | 'services' | 'goods' | 'facilities') => {
    const lead = page.sections?.[id]?.lead;
    return lead ? <p className="ppage__lead">{lead}</p> : null;
  };
  // SMART SUMMARIES (founder 2026-08-26): Home used to tease a tab by
  // excerpting it (2 story paragraphs, 5 offering rows), which read as the
  // tab minus its ending. When the tab has a written summary — its Style
  // panel lead, or homeSummary for the story — Home now shows the summary
  // and the door instead of the dump. No summary written = the old excerpt,
  // so nothing goes blank.
  const hasTab = (id: string) => navItems.some((n) => n.id === id);
  const secLead = (id: 'about' | 'services' | 'goods' | 'facilities') =>
    page.sections?.[id]?.lead?.trim();
  const summarized = (id: 'about' | 'services' | 'goods' | 'facilities') =>
    tab === 'home' && !!secLead(id) && !openSecs.has(id);
  // The summary's door: routes to the tab when one exists; a section with
  // nowhere to route expands in place instead (the no-dead-end rule, kept).
  const SecDoor = ({ id, children }: { id: string; children: React.ReactNode }) => hasTab(id)
    ? <More to={id}>{children}</More>
    : (
      <button
        className="ppage__more" type="button"
        onClick={() => setOpenSecs((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id); else next.add(id);
          return next;
        })}
      >
        {openSecs.has(id) ? 'Show less' : children} <span aria-hidden>&rarr;</span>
      </button>
    );
  // ALTERNATING SPLIT CARDS (founder 2026-08-26, from her sketch): a
  // summarized section whose tab carries a photo renders copy beside the
  // photo, sides alternating down the page — copy left first, then right,
  // then left. Only at >=1024px (the app-shell column stays phone-width
  // until then — a media query can't see the column, so below that the
  // card stacks copy-then-photo).
  const splitOrder = (['about', 'services', 'goods', 'facilities'] as const)
    .filter((id) => summarized(id) && !!page.sections?.[id]?.image);
  const splitting = (id: 'about' | 'services' | 'goods' | 'facilities') =>
    splitOrder.includes(id) && !(id === 'about' && page.homeSummary?.trim());
  const SumSplit = ({ id, label, door }: { id: 'about' | 'services' | 'goods' | 'facilities'; label?: string; door: React.ReactNode }) => {
    const sec = page.sections![id]!;
    const pos = typeof sec.imagePos === 'number' ? `50% ${sec.imagePos}%` : (sec.imagePos ?? '50% 50%');
    return (
      <section className={'ppage__sec ppage__sec--split' + (splitOrder.indexOf(id) % 2 === 1 ? ' is-flip' : '')}>
        <div className="ppage__split-copy">
          {label && <h2 className="ppage__h2">{label}</h2>}
          <p className="ppage__lead">{secLead(id)}</p>
          <SecDoor id={id}>{door}</SecDoor>
        </div>
        <img
          className="ppage__split-img" src={sec.image} alt="" loading="lazy"
          style={{ objectPosition: pos }}
          onClick={() => setLightbox(sec.image!)}
        />
      </section>
    );
  };
  // Which image the hero wears on this tab (two builds converged here the
  // same day — merged): HOME and Feed wear the page cover (founder
  // 2026-08-21: "Home have the picture of Mary jumping as the cover" — it
  // used to have none, a relic of About-as-landing); every OTHER tab wears
  // its own section image, About falling back to the cover so older pages
  // keep their look. Each image crops for ITSELF: the section's own
  // imagePos wins over the page-wide coverPos (founder 2026-08-21: Katie's
  // face); imageSize 'full' opts the photo out of the frame entirely
  // (founder 2026-08-22).
  const activeSec = !doors && tabbed ? page.sections?.[tab] : undefined;
  const coverSrc = doors
    ? activeDoor?.image
    : (!tabbed || tab === 'home' || tab === 'feed')
      ? page.cover
      : activeSec?.image ?? (tab === 'about' ? page.cover : undefined);
  const usingSectionImage = !doors && !!activeSec?.image && coverSrc === activeSec.image;
  const coverPos = (usingSectionImage ? activeSec?.imagePos : undefined) ?? page.coverPos;
  const coverFull = usingSectionImage && activeSec?.imageSize === 'full';

  return (
    <div
      className={'ppage ppage--' + (page.coverStyle ?? 'plain') + (props.signedIn ? ' ppage--in-app' : '')}
      style={{ ['--ppage-accent' as string]: accent }}
    >
      {props.preview && (
        <p className="ppage__preview">Preview — this is what the open web sees.</p>
      )}

      {/* Platform doors, upper right — elegant and quiet (founder
          2026-07-29): Sign in for members everywhere; the invitation only
          where the page owner wants it (join !== quiet). Skipped for a
          signed-in viewer — they're already in. */}
      {!props.preview && !props.signedIn && page.join !== 'none' && (
        <div className="ppage__corner">
          {page.join === 'full' || page.join === undefined ? (
            <button className="ppage__corner-cta" type="button" onClick={() => go('/signup')}>
              Request an invitation
            </button>
          ) : null}
          <button className="ppage__corner-signin" type="button" onClick={() => go('/login')}>
            Sign in
          </button>
        </div>
      )}

      {/* THE TOP BAND IS YOURS, THE MASTHEAD IS THEIRS (founder 2026-08-07:
          "let's not have it between the nav and the hero image. Move it up the
          page"). Your view toggle and your relationship with this entity sit
          together above the page's own composition — logo, name, tagline,
          address, nav, cover — which now runs uninterrupted. */}
      {(props.aboveHero || props.heroSignals) && (
        <div className="ppage__utility">
          {props.aboveHero}
          {props.heroSignals}
        </div>
      )}

      {/* 1 · Hero — a proper masthead (founder 2026-07-29): identity first
          (logo, name, tagline, address), then the nav doors, then the cover
          image. The image stays put while doors switch the content below. */}
      <header className="ppage__hero">
        <div className="ppage__hero-body ppage__hero-body--top">
          <Avatar id={props.id} name={name} url={avatarUrl ?? undefined}
            size={props.signedIn ? 96 : 128} />
          <h1 className="ppage__name">{name}</h1>
          {props.pronouns && <p className="ppage__pronouns">{props.pronouns}</p>}
          {/* A space always names its kind — "Organization ·globe·" — the way
              the template-less space view does. The tagline used to occupy
              this slot exclusively, so any org WITH a tagline lost its kind
              line entirely (founder 2026-08-22: groups said "Group", orgs
              said nothing). kindIcon is only passed for spaces; a member's
              kindLabel is their headline and keeps riding the tagline slot. */}
          {props.kindIcon && kindLabel && !asGuest && (
            <p className="ppage__kind">
              {kindLabel}
              <Icon name={props.kindIcon} size={15} />
            </p>
          )}
          {(page.tagline || (!props.kindIcon && kindLabel)) && !(asGuest && tab === 'home' && page.tagline && coverSrc) && (
            <p className="ppage__tagline">
              {page.tagline || kindLabel}
            </p>
          )}
          {location && <p className="ppage__where"><Icon name="location" size={13} /> {location}</p>}
          {navItems.length === 0 && ctas.map((c) => (
            <a className="ppage__cta" key={c.kind} href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel="noopener">
              {c.label}
            </a>
          ))}
          {navItems.length === 0 && props.extraCtas?.map((c, i) => (
            <button className="ppage__cta" key={'x' + i} type="button" onClick={c.onClick}>{c.label}</button>
          ))}
        </div>
        {navInHero && navNode}
        {coverSrc && (
          <img
            className={'ppage__cover' + (coverFull ? ' ppage__cover--full' : '')}
            src={coverSrc} alt=""
            style={coverFull ? undefined : { objectPosition: posToObjectPos(coverPos) }}
            onClick={() => setLightbox(coverSrc)} key={coverSrc}
          />
        )}
        {asGuest && tab === 'home' && page.tagline && coverSrc && (
          <p className="ppage__tagline-under">{page.tagline}</p>
        )}
      </header>

      {/* A signed-in member's own navigational doors (search/add/chat/
          events/members) — kept right under the hero, above the page's
          own content, so they're never lost to scrolling (founder
          2026-08-03). Guests never pass this. */}
      {props.beforeContent}

      {/* The Feed tab — the entity's actual stream, the thing the in-app
          profile used to be entirely (founder 2026-08-05). The function form
          renders on EVERY tab: its icon row (with the lit Feed door) is the
          profile's section switcher and must survive a hop to About/Services,
          or there'd be no way back to the feed. */}
      {showFeed && (feedInRow
        ? (props.feed as (ctx: FeedRenderCtx) => React.ReactNode)({
            showing: showingFeed, open: () => chooseTab('feed'), guest: asGuest,
            navSlot: navInHero ? undefined : navNode,
            openHome: homeItem.length && homeHasContent ? () => chooseTab('home') : undefined,
            homeBare: !!homeItem.length && !homeHasContent,
          })
        : (showingFeed && (props.feed as React.ReactNode)))}

      {/* A chosen template tab — its lead, then its paragraphs. */}
      {activeChosen && (
        <section className="ppage__sec">
          <h2 className="ppage__sec-title">{activeChosen.label ?? tabById(activeChosen.id)?.label}</h2>
          {activeChosen.lead && <p className="ppage__lead">{activeChosen.lead}</p>}
          {(activeChosen.body ?? '').split(/\n{2,}/).filter(Boolean).map((para, i) => (
            <p className="ppage__para" key={i}>{para}</p>
          ))}
        </section>
      )}

      {/* Custom door content — lead, then paragraphs, then (optionally)
          the contact list. */}
      {activeDoor && !activeDoor.href && (
        <section className="ppage__sec">
          {activeDoor.lead && <p className="ppage__lead">{activeDoor.lead}</p>}
          {activeDoor.body && (
            <div className="ppage__story">
              {activeDoor.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
            </div>
          )}
          {(activeDoor.shots?.length ?? 0) > 0 && (
            <div className="ppage__shots">
              {activeDoor.shots!.map((s) => (
                <figure className="ppage__shot" key={s.src}>
                  <img src={s.src} alt="" loading="lazy" onClick={() => setLightbox(s.src)} />
                  {s.caption && <figcaption>{s.caption}</figcaption>}
                </figure>
              ))}
            </div>
          )}
          {activeDoor.contact && <ContactList contact={contact} />}
        </section>
      )}

      {/* 2 · Story */}
      {story && show('about') && splitting('about') && (
        <SumSplit id="about" door="Read the whole story" />
      )}
      {story && show('about') && !splitting('about') && (
        <section className="ppage__sec">
          {flavor('about')}
          <div className="ppage__story">
            {(tab !== 'home' || openSecs.has('about')
              ? story.split(/\n{2,}/)
              : page.homeSummary?.trim()
                ? page.homeSummary.split(/\n{2,}/)
                : summarized('about')
                  ? []
                  : teasing('about')
                    ? story.split(/\n{2,}/).slice(0, 2)
                    : story.split(/\n{2,}/)).map((para, i) => (
              <div key={i}>
                <p>{para}</p>
                {(page.storyImages ?? []).filter((si) => si.after === i + 1).map((si) => (
                  <img
                    className={'ppage__story-img' + (si.full ? ' ppage__story-img--full' : '')}
                    src={si.src} alt="" loading="lazy"
                    style={si.full ? undefined : { objectPosition: `50% ${si.pos ?? 0}%` }}
                    key={si.src} onClick={() => setLightbox(si.src)} />
                ))}
              </div>
            ))}
            {tab === 'home' && (page.homeSummary?.trim() || secLead('about') || (hasTab('about') && story.split(/\n{2,}/).length > 2)) && (
              <SecDoor id="about">Read the whole story</SecDoor>
            )}
          </div>
        </section>
      )}

      {/* 2b · A few more images, if there are any */}
      {(page.photos?.length ?? 0) > 0 && show('about') && (
        <div className="ppage__strip">
          {page.photos!.slice(0, 6).map((src) => (
            <img className="ppage__strip-img" src={src} alt="" loading="lazy" key={src}
              onClick={() => setLightbox(src)} />
          ))}
        </div>
      )}

      {/* 3 · Offerings — straight from Lichen, so they never go stale.
             Services and Goods are separate tabs (founder 2026-08-06), and
             each row carries its OWN recommend: you recommend the work, not
             the person. */}
      {svcRows.length > 0 && show('services') && splitting('services') && (
        <SumSplit id="services" label="Services" door={<>See everything {subj.word} {subj.plural ? 'offer' : 'offers'}</>} />
      )}
      {svcRows.length > 0 && show('services') && !splitting('services') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Services</h2>
          {flavor('services')}
          {!summarized('services') && (
            <ul className="ppage__offers">
              {(teasing('services') ? svcRows.slice(0, 5) : svcRows).map((o) => (
                <li className="ppage__offer" key={o.id}>
                  <span className="ppage__offer-name">{o.name}</span>
                  {props.renderOfferingAction?.(o)}
                </li>
              ))}
            </ul>
          )}
          {tab === 'home' && (secLead('services') || (hasTab('services') && svcRows.length > 5)) && (
            <SecDoor id="services">See everything {subj.word} {subj.plural ? 'offer' : 'offers'}</SecDoor>
          )}
        </section>
      )}

      {goodRows.length > 0 && show('goods') && splitting('goods') && (
        <SumSplit id="goods" label="Goods" door="See all the goods" />
      )}
      {goodRows.length > 0 && show('goods') && !splitting('goods') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Goods</h2>
          {flavor('goods')}
          {!summarized('goods') && (
            <ul className="ppage__offers">
              {(teasing('goods') ? goodRows.slice(0, 5) : goodRows).map((o) => (
                <li className="ppage__offer" key={o.id}>
                  <span className="ppage__offer-name">{o.name}</span>
                  {props.renderOfferingAction?.(o)}
                </li>
              ))}
            </ul>
          )}
          {tab === 'home' && secLead('goods') && <SecDoor id="goods">See all the goods</SecDoor>}
        </section>
      )}

      {/* A page that gave us plain strings (a space's hand-written offerings)
          keeps the old single list. */}
      {svcRows.length === 0 && goodRows.length === 0 && offerings.length > 0 && show('services') && splitting('services') && (
        <SumSplit id="services" label="What we offer" door={<>See everything {subj.word} {subj.plural ? 'offer' : 'offers'}</>} />
      )}
      {svcRows.length === 0 && goodRows.length === 0 && offerings.length > 0 && show('services') && !splitting('services') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">What we offer</h2>
          {flavor('services')}
          {!summarized('services') && (
          <ul className="ppage__offers">
            {(teasing('services') ? offerings.slice(0, 5) : offerings).map((o) => {
              const [head, ...rest] = o.split(' · ');
              return (
                <li className="ppage__offer" key={o}>
                  <span className="ppage__offer-name">{head}</span>
                  {rest.length > 0 && <span className="ppage__offer-terms">{rest.join(' · ')}</span>}
                </li>
              );
            })}
          </ul>
          )}
          {tab === 'home' && (secLead('services') || (hasTab('services') && offerings.length > 5)) && (
            <SecDoor id="services">See everything {subj.word} {subj.plural ? 'offer' : 'offers'}</SecDoor>
          )}
        </section>
      )}

      {/* 3b · Facilities — the grounds themselves */}
      {page.facilities && show('facilities') && splitting('facilities') && (
        <SumSplit id="facilities" label="The facilities" door="See the grounds" />
      )}
      {page.facilities && show('facilities') && !splitting('facilities') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">The facilities</h2>
          {flavor('facilities')}
          <div className="ppage__story">
            {(summarized('facilities')
              ? []
              : teasing('facilities')
                ? page.facilities.split(/\n{2,}/).slice(0, 1)
                : page.facilities.split(/\n{2,}/)).map((para, i) => <p key={i}>{para}</p>)}
            {tab === 'home' && (secLead('facilities') || (hasTab('facilities') && page.facilities.split(/\n{2,}/).length > 1)) && (
              <SecDoor id="facilities">See the grounds</SecDoor>
            )}
          </div>
        </section>
      )}

      {/* 4 · Practical */}
      {hasContact && show('contact') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Contact &amp; hours</h2>
          <ContactList contact={contact} />
          {bizLocations.length > 0 && (
            <div className="contactl">
              {bizLocations.map((b, i) => (
                <p className="contactl__row" key={`${b.location}-${i}`}>
                  <span className="contactl__label">{b.label || 'Find us'}</span>
                  <a href={`https://maps.google.com/?q=${encodeURIComponent(b.location)}`}
                    target="_blank" rel="noopener">{b.location}</a>
                </p>
              ))}
            </div>
          )}
          {page.practical?.bring && <p className="ppage__note"><strong>What to bring</strong> {page.practical.bring}</p>}
          {page.practical?.parking && <p className="ppage__note"><strong>Parking</strong> {page.practical.parking}</p>}
          {page.practical?.access && <p className="ppage__note"><strong>Accessibility</strong> {page.practical.access}</p>}
        </section>
      )}

      {/* 4b · The people — part of the story, so they live on About */}
      {(page.team?.length ?? 0) > 0 && show('about') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">The people</h2>
          <div className="ppage__team">
            {page.team!.map((t) => (
              <div className="ppage__person" key={t.name}>
                {t.photo && (
                  <img className="ppage__person-photo" src={t.photo} alt="" loading="lazy"
                    onClick={() => setLightbox(t.photo!)} />
                )}
                <p className="ppage__person-name">{t.name}</p>
                {t.role && <p className="ppage__person-role">{t.role}</p>}
                {t.note && <p className="ppage__person-note">{t.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5 · Presence — events, posts (passed in by the host page) */}
      {props.children}

      {/* Closer look — tap anywhere (or Esc) to close */}
      {lightbox && (
        <button
          className="ppage__lightbox" type="button" autoFocus
          onClick={() => setLightbox(null)}
          onKeyDown={(e) => { if (e.key === 'Escape') setLightbox(null); }}
          aria-label="Close image"
        >
          <img className="ppage__lightbox-img" src={lightbox} alt="" />
        </button>
      )}

      {/* 6 · Join — every visit is a soft invitation. Some owners prefer to
          extend it themselves; their pages carry one quiet line instead.
          Skipped entirely for a signed-in viewer — their real join/trust
          controls already rendered above, in `children`. */}
      {props.signedIn ? null : page.join === 'quiet' || page.join === 'none' ? (
        /* THE FLOOR (founder 2026-08-28): every public page carries the
           credit and the invitation, at whatever volume the owner chose.
           Turning the doors off turns them down to this line — it does not
           turn them off. The louder levels below already say both things in
           their own card, so this renders only when that card doesn't, and
           never to a signed-in member (they're already in). */
        <p className="ppage__join-quiet">
          Powered by <button className="ppage__join-quiet-link" onClick={() => go('/about')}>Lichen</button>
          {' '}· Want to join our community?{' '}
          <button className="ppage__join-quiet-link" onClick={() => go('/signup')}>Request an invite</button>
        </p>
      ) : props.knockSpace ? (
        /* A space's page is a GATEWAY (founder 2026-08-17): the ask is to
           join THIS group, and joining the group means joining Lichen — the
           person will be a member of the whole platform, not a user of one
           group's software, so they get told what they'd be joining. The
           knock carries the space; its stewards can send the invitation. */
        <section className="ppage__join">
          <p className="ppage__join-lead">Request to join <strong>{name}</strong></p>
          <p className="ppage__join-sub">
            {name} lives on <strong>Lichen</strong> — a member-run network for care, work,
            offerings and a fairer economy, where trust is a path through real relationships,
            not a star rating. Joining this {props.knockSpace.kindLabel.toLowerCase()} means becoming
            a Lichen member (there&rsquo;s a membership fee), so it&rsquo;s worth a look at
            what you&rsquo;d be part of. Introduce yourself below and {name}&rsquo;s stewards
            write back.
          </p>
          <KnockForm spaceId={props.knockSpace.id} spaceName={name} />
          <div className="ppage__join-acts">
            <button className="btn" onClick={() => go('/about')}>What is Lichen?</button>
          </div>
          <p className="ppage__join-member">
            Already a member?{' '}
            <button className="ppage__join-quiet-link" onClick={() => go('/login')}>Sign in</button>
          </p>
        </section>
      ) : (
        <section className="ppage__join">
          <p className="ppage__join-lead">This page lives on <strong>Lichen</strong>.</p>
          <p className="ppage__join-sub">
            A member-run network for care, work, offerings and a fairer economy — where trust is
            a path through real relationships, not a star rating. To recommend {name}, book, message,
            or join their events, you'll need an account. Lichen grows by invitation; introduce
            yourself and a real person writes back.
          </p>
          <div className="ppage__join-acts">
            <button className="btn btn-primary" onClick={() => go('/signup')}>Request an invitation</button>
            <button className="btn" onClick={() => go('/about')}>What is Lichen?</button>
          </div>
          <p className="ppage__join-member">
            Already a member?{' '}
            <button className="ppage__join-quiet-link" onClick={() => go('/login')}>Sign in</button>
          </p>
        </section>
      )}
    </div>
  );
}
