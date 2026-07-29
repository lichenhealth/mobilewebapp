import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { appUrl } from '../lib/customDomain';
import { Icon } from './Icon';
import Avatar from './Avatar';
import { ContactList, type ContactInfo } from './ContactFields';
import './PublicPage.css';

// One structure for every Lichen site (founder 2026-07-28): hero, story,
// offerings, practical, presence, join. Visitors learn to read one page and
// can read them all — and members never face a blank canvas, because most of
// it fills itself from what they already keep on Lichen.

export interface PageMeta {
  tagline?: string;
  story?: string;
  cover?: string;
  coverStyle?: 'photo' | 'tint' | 'plain';
  accent?: string;
  action?: { kind: 'call' | 'book' | 'email' | 'visit' | 'none'; label?: string; href?: string };
  practical?: { bring?: string; parking?: string; access?: string };
  /** The grounds themselves — arena, tack room, stalls. Its own section
   *  (and its own hero-nav door) when present. */
  facilities?: string;
  /** Per-door flavor (founder 2026-07-29): an optional summary sentence and
   *  an image between it and the body — uniform on every public page.
   *  Contact stays utilitarian on purpose. */
  sections?: Partial<Record<'about' | 'services' | 'facilities', { lead?: string; image?: string }>>;
  /** How loudly the page invites visitors into Lichen (founder 2026-07-29):
   *  'full' (default) = the peach doorway card; 'quiet' = one muted footer
   *  line — for pages whose owner prefers to invite people themselves once
   *  they've vetted them. */
  join?: 'full' | 'quiet';
  /** Services with their terms, for entities without Lichen categories yet
   *  ("Private lessons · 45 min · $60"). Members' offerings come from their
   *  categories instead. */
  offerings?: string[];
  /** The people behind it — a barn, a practice, a farm is its people. */
  team?: { name: string; role?: string; note?: string }[];
  /** A few more images, shown as a quiet strip under the story. */
  photos?: string[];
  showPosts?: boolean;
}

export interface PublicPageProps {
  id: string;
  name: string;
  kindLabel?: string;          // "Place", "Organization", or a person's headline
  avatarUrl?: string | null;
  description?: string | null; // the Lichen bio/description, used when story is empty
  location?: string | null;
  offerings?: string[];        // category names
  contact: ContactInfo;
  page: PageMeta;
  /** Rendered under Presence — events, posts. Optional. */
  children?: React.ReactNode;
  /** Owner previewing their own page. */
  preview?: boolean;
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

  // The single primary action — one, deliberately, not five.
  const act = page.action && page.action.kind !== 'none' ? page.action : undefined;
  const actHref = act
    ? act.href
      || (act.kind === 'call' && contact.phone ? `tel:${contact.phone.replace(/[^\d+]/g, '')}` : undefined)
      || (act.kind === 'email' && contact.email ? `mailto:${contact.email}` : undefined)
      || (act.kind === 'book' && contact.booking ? contact.booking : undefined)
      || undefined
    : undefined;
  const actLabel = act?.label
    || (act?.kind === 'call' ? 'Call us' : act?.kind === 'book' ? 'Book a time'
      : act?.kind === 'email' ? 'Get in touch' : act?.kind === 'visit' ? 'Visit us' : '');

  // Hero nav (founder 2026-07-29): section doors as clickable text on the
  // left, the one primary action far right — the same learn-once-read-all
  // structure on every Lichen site. Doors are PAGES, not scroll anchors:
  // only the active section renders below the hero. Only doors whose
  // section exists render; with no doors, everything shows inline.
  const hasContact = Object.keys(contact).length > 0 || !!page.practical;
  const navItems = [
    story ? { id: 'about', label: 'About' } : null,
    offerings.length > 0 ? { id: 'services', label: 'Services' } : null,
    page.facilities ? { id: 'facilities', label: 'Facilities' } : null,
    hasContact ? { id: 'contact', label: 'Contact' } : null,
  ].filter((n): n is { id: string; label: string } => !!n);
  const [tab, setTab] = useState(navItems[0]?.id ?? 'about');
  const tabbed = navItems.length > 0;
  const show = (id: string) => !tabbed || tab === id;

  // Tap any image for a closer, uncropped look (founder 2026-07-29).
  const [lightbox, setLightbox] = useState<string | null>(null);

  // A visitor from the open web isn't an app user — no Lichen top bar, no
  // bottom tabs (founder 2026-07-29). PublicPage only ever renders for
  // signed-out visitors or an owner's preview, so marking the shell here is
  // correct by construction; global.css hides the chrome.
  useEffect(() => {
    document.documentElement.classList.add('is-public-page');
    return () => document.documentElement.classList.remove('is-public-page');
  }, []);

  // Uniform door anatomy: summary sentence, then an image, then the body.
  const flavor = (id: 'about' | 'services' | 'facilities') => {
    const s = page.sections?.[id];
    if (!s?.lead && !s?.image) return null;
    return (
      <>
        {s.lead && <p className="ppage__lead">{s.lead}</p>}
        {s.image && (
          <img className="ppage__sec-img" src={s.image} alt="" loading="lazy"
            onClick={() => setLightbox(s.image!)} />
        )}
      </>
    );
  };

  return (
    <div className={'ppage ppage--' + (page.coverStyle ?? 'tint')} style={{ ['--ppage-accent' as string]: accent }}>
      {props.preview && (
        <p className="ppage__preview">Preview — this is what the open web sees.</p>
      )}

      {/* 1 · Hero — a proper masthead (founder 2026-07-29): identity first
          (logo, name, tagline, address), then the nav doors, then the cover
          image. The image stays put while doors switch the content below. */}
      <header className="ppage__hero">
        <div className="ppage__hero-body ppage__hero-body--top">
          <Avatar id={props.id} name={name} url={avatarUrl ?? undefined} size={64} />
          <h1 className="ppage__name">{name}</h1>
          {(page.tagline || kindLabel) && (
            <p className="ppage__tagline">{page.tagline || kindLabel}</p>
          )}
          {location && <p className="ppage__where"><Icon name="location" size={13} /> {location}</p>}
          {act && actHref && navItems.length === 0 && (
            <a className="ppage__cta" href={actHref} target={actHref.startsWith('http') ? '_blank' : undefined} rel="noopener">
              {actLabel}
            </a>
          )}
        </div>
        {navItems.length > 0 && (
          <nav className="ppage__nav">
            {navItems.map((n) => (
              <button
                className={'ppage__nav-link' + (tab === n.id ? ' ppage__nav-link--on' : '')}
                onClick={() => setTab(n.id)} key={n.id} type="button"
              >
                {n.label}
              </button>
            ))}
            {act && actHref && (
              <a className="ppage__cta ppage__cta--nav" href={actHref}
                target={actHref.startsWith('http') ? '_blank' : undefined} rel="noopener">
                {actLabel}
              </a>
            )}
          </nav>
        )}
        {page.cover && (
          <img className="ppage__cover" src={page.cover} alt="" onClick={() => setLightbox(page.cover!)} />
        )}
      </header>

      {/* 2 · Story */}
      {story && show('about') && (
        <section className="ppage__sec">
          {flavor('about')}
          <div className="ppage__story">
            {story.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
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

      {/* 3 · Offerings — straight from Lichen, so it never goes stale */}
      {offerings.length > 0 && show('services') && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">What we offer</h2>
          {flavor('services')}
          {/* A plain list, not chips — to a signed-out visitor these are
              information, not buttons. The same services become actionable
              inside Lichen once you're a member of the org (founder rule,
              2026-07-29: external face informs, the platform transacts). */}
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
          extend it themselves; their pages carry one quiet line instead. */}
      {page.join === 'quiet' ? (
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
        </section>
      )}
    </div>
  );
}
