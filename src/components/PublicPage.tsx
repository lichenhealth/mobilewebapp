import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appUrl } from '../lib/customDomain';
import { Icon, type IconName } from './Icon';
import Avatar from './Avatar';
import { ContactList, type ContactInfo } from './ContactFields';
import { tabById, tabHasContent, type PageTab } from '../lib/pageTabs';
import './PublicPage.css';

// One structure for every Lichen site (founder 2026-07-28): hero, story,
// offerings, practical, presence, join. Visitors learn to read one page and
// can read them all — and members never face a blank canvas, because most of
// it fills itself from what they already keep on Lichen.

export type ContactActionKind = 'call' | 'book' | 'email' | 'visit';

/** Handed to a render-function `feed` on every tab (see the prop's doc). */
export type FeedRenderCtx = { showing: boolean; open: () => void };

export interface PageMeta {
  tagline?: string;
  story?: string;
  cover?: string;
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
  sections?: Partial<Record<'about' | 'services' | 'goods' | 'facilities', { lead?: string; image?: string }>>;
  /** How loudly the page invites visitors into Lichen (founder 2026-07-29):
   *  'full' (default) = the peach doorway card; 'quiet' = one muted footer
   *  line — for pages whose owner prefers to invite people themselves once
   *  they've vetted them. */
  join?: 'full' | 'quiet';
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
  team?: { name: string; role?: string; note?: string }[];
  /** A few more images, shown as a quiet strip under the story. */
  photos?: string[];
  /** Images woven INTO the story (founder 2026-07-29): each renders after
   *  its 1-based paragraph number, so the picture sits beside the words
   *  that tell it. A template feature for every public page. */
  storyImages?: { after: number; src: string }[];
  showPosts?: boolean;
  /** The tabs this page's owner chose from the template library
   *  (founder 2026-08-05). When present, these drive the row. */
  tabs?: PageTab[];
}

export interface PublicPageProps {
  id: string;
  name: string;
  kindLabel?: string;          // "Place", "Organization", or a person's headline
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
}

export default function PublicPage(props: PublicPageProps) {
  const navigate = useNavigate();
  // Lichen doors cross back to Lichen's own origin when this page is served
  // from a member's custom domain.
  const go = (path: string) => {
    const u = appUrl(path);
    if (u.startsWith('http')) window.location.href = u; else navigate(u);
  };
  const { name, kindLabel, avatarUrl, description, location, contact, page } = props;
  const offerings = props.offerings?.length ? props.offerings : (page.offerings ?? []);
  const accent = page.accent || 'var(--peach)';
  const story = (page.story || description || '').trim();

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
  const showFeed = !!props.feed && (!!props.signedIn || page.showPosts === true);
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
  const navItems = showFeed && !feedInRow
    ? [{ id: 'feed', label: 'Feed' }, ...sectionItems]
    : sectionItems;
  const firstContentDoor = showFeed ? 'feed' : doors?.find((d) => !d.href)?.id;
  const [tab, setTab] = useState(firstContentDoor ?? navItems[0]?.id ?? 'about');
  const tabbed = navItems.length > 0;
  const showingFeed = showFeed && tab === 'feed';
  const show = (id: string) => !doors && !showingFeed && (!tabbed || tab === id);
  const activeDoor = doors?.find((d) => d.id === tab) ?? null;
  const activeChosen = liveChosen.find((t) => t.id === tab && !tabById(t.id)?.builtIn) ?? null;

  // Tap any image for a closer, uncropped look (founder 2026-07-29).
  const [lightbox, setLightbox] = useState<string | null>(null);

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
  const coverSrc = doors
    ? activeDoor?.image
    : (!tabbed || tab === 'about')
      ? page.cover
      : page.sections?.[tab as 'services' | 'facilities']?.image;

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
      {!props.preview && !props.signedIn && (
        <div className="ppage__corner">
          {page.join !== 'quiet' && (
            <button className="ppage__corner-cta" type="button" onClick={() => go('/signup')}>
              Request an invitation
            </button>
          )}
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
          {(page.tagline || kindLabel) && (
            <p className="ppage__tagline">
              {page.tagline || kindLabel}
              {!page.tagline && props.kindIcon && (
                <Icon name={props.kindIcon} size={16} />
              )}
            </p>
          )}
          {location && <p className="ppage__where"><Icon name="location" size={13} /> {location}</p>}
          {ctas.length > 0 && navItems.length === 0 && ctas.map((c) => (
            <a className="ppage__cta" key={c.kind} href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel="noopener">
              {c.label}
            </a>
          ))}
        </div>
        {navItems.length > 0 && (
          <nav className="ppage__nav">
            {navItems.map((n) => {
              const d = doors?.find((x) => x.id === n.id);
              // Feed reads as a door, not a template tab (founder 2026-08-09):
              // an icon, filled peach when it's the active tab — the same
              // "you are here" signal Home and My-celium already lead their
              // icon row with, not another text pill beside About/Services.
              if (n.id === 'feed') {
                return (
                  <button
                    className={'ppage__nav-icon' + (tab === n.id ? ' ppage__nav-icon--on' : '')}
                    onClick={() => setTab(n.id)} key={n.id} type="button" aria-label={n.label} title={n.label}
                  >
                    <Icon name="newsfeed" size={18} />
                  </button>
                );
              }
              return (
                <button
                  className={'ppage__nav-link' + (tab === n.id ? ' ppage__nav-link--on' : '')}
                  onClick={() => (d?.href ? go(d.href) : setTab(n.id))} key={n.id} type="button"
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
          </nav>
        )}
        {coverSrc && (
          <img className="ppage__cover" src={coverSrc} alt="" onClick={() => setLightbox(coverSrc)} key={coverSrc} />
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
            showing: showingFeed, open: () => setTab('feed'),
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
      {story && show('about') && (
        <section className="ppage__sec">
          {flavor('about')}
          <div className="ppage__story">
            {story.split(/\n{2,}/).map((para, i) => (
              <div key={i}>
                <p>{para}</p>
                {(page.storyImages ?? []).filter((si) => si.after === i + 1).map((si) => (
                  <img className="ppage__story-img" src={si.src} alt="" loading="lazy"
                    key={si.src} onClick={() => setLightbox(si.src)} />
                ))}
              </div>
            ))}
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
      {svcRows.length > 0 && show('services') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Services</h2>
          {flavor('services')}
          <ul className="ppage__offers">
            {svcRows.map((o) => (
              <li className="ppage__offer" key={o.id}>
                <span className="ppage__offer-name">{o.name}</span>
                {props.renderOfferingAction?.(o)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {goodRows.length > 0 && show('goods') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Goods</h2>
          {flavor('goods')}
          <ul className="ppage__offers">
            {goodRows.map((o) => (
              <li className="ppage__offer" key={o.id}>
                <span className="ppage__offer-name">{o.name}</span>
                {props.renderOfferingAction?.(o)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* A page that gave us plain strings (a space's hand-written offerings)
          keeps the old single list. */}
      {svcRows.length === 0 && goodRows.length === 0 && offerings.length > 0 && show('services') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">What we offer</h2>
          {flavor('services')}
          <ul className="ppage__offers">
            {offerings.map((o) => {
              const [head, ...rest] = o.split(' · ');
              return (
                <li className="ppage__offer" key={o}>
                  <span className="ppage__offer-name">{head}</span>
                  {rest.length > 0 && <span className="ppage__offer-terms">{rest.join(' · ')}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* 3b · Facilities — the grounds themselves */}
      {page.facilities && show('facilities') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">The facilities</h2>
          {flavor('facilities')}
          <div className="ppage__story">
            {page.facilities.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
          </div>
        </section>
      )}

      {/* 4 · Practical */}
      {hasContact && show('contact') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Practical</h2>
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
      {props.signedIn ? null : page.join === 'quiet' ? (
        <p className="ppage__join-quiet">
          This page lives on <button className="ppage__join-quiet-link" onClick={() => go('/about')}>Lichen</button>
          {' '}· members <button className="ppage__join-quiet-link" onClick={() => go('/login')}>sign in</button>
        </p>
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
