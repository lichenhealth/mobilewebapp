import { useNavigate } from 'react-router-dom';
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

  return (
    <div className={'ppage ppage--' + (page.coverStyle ?? 'tint')} style={{ ['--ppage-accent' as string]: accent }}>
      {props.preview && (
        <p className="ppage__preview">Preview — this is what the open web sees.</p>
      )}

      {/* 1 · Hero */}
      <header className="ppage__hero">
        {page.cover && <img className="ppage__cover" src={page.cover} alt="" />}
        <div className="ppage__hero-body">
          <Avatar id={props.id} name={name} url={avatarUrl ?? undefined} size={64} />
          <h1 className="ppage__name">{name}</h1>
          {(page.tagline || kindLabel) && (
            <p className="ppage__tagline">{page.tagline || kindLabel}</p>
          )}
          {location && <p className="ppage__where"><Icon name="location" size={13} /> {location}</p>}
          {act && actHref && (
            <a className="ppage__cta" href={actHref} target={actHref.startsWith('http') ? '_blank' : undefined} rel="noopener">
              {actLabel}
            </a>
          )}
        </div>
      </header>

      {/* 2 · Story */}
      {story && (
        <section className="ppage__sec">
          <div className="ppage__story">
            {story.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
          </div>
        </section>
      )}

      {/* 2b · A few more images, if there are any */}
      {(page.photos?.length ?? 0) > 0 && (
        <div className="ppage__strip">
          {page.photos!.slice(0, 4).map((src) => (
            <img className="ppage__strip-img" src={src} alt="" loading="lazy" key={src} />
          ))}
        </div>
      )}

      {/* 3 · Offerings — straight from Lichen, so it never goes stale */}
      {offerings.length > 0 && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">What we offer</h2>
          <div className="ppage__chips">
            {offerings.map((o) => <span className="ppage__chip" key={o}>{o}</span>)}
          </div>
        </section>
      )}

      {/* 4 · Practical */}
      {(Object.keys(contact).length > 0 || page.practical) && (
        <section className="ppage__sec">
          <h2 className="ppage__h2">Practical</h2>
          <ContactList contact={contact} />
          {page.practical?.bring && <p className="ppage__note"><strong>What to bring</strong> {page.practical.bring}</p>}
          {page.practical?.parking && <p className="ppage__note"><strong>Parking</strong> {page.practical.parking}</p>}
          {page.practical?.access && <p className="ppage__note"><strong>Accessibility</strong> {page.practical.access}</p>}
        </section>
      )}

      {/* 4b · The people */}
      {(page.team?.length ?? 0) > 0 && (
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

      {/* 6 · Join — every visit is a soft invitation */}
      <section className="ppage__join">
        <p className="ppage__join-lead">This page lives on <strong>Lichen</strong>.</p>
        <p className="ppage__join-sub">
          A member-run network for care, work, offerings and a fairer economy — where trust is
          a path through real relationships, not a star rating. To recommend {name}, book, message,
          or join their events, you'll need an account. Lichen grows by invitation; introduce
          yourself and a real person writes back.
        </p>
        <div className="ppage__join-acts">
          <button className="btn btn-primary" onClick={() => navigate('/signup')}>Request an invitation</button>
          <button className="btn" onClick={() => navigate('/about')}>What is Lichen?</button>
        </div>
      </section>
    </div>
  );
}
