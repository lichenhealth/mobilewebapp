import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import AssistantDoor from '../components/AssistantDoor';
import AreaFeed from './AreaFeed';
import OfferingChips from '../components/OfferingChips';
import { useAuth } from '../auth/AuthProvider';
import {
  createCollection, listMyEnrolledCourses, listPublicCollections,
  type CollectionRow, type EnrolledCourse,
} from '../lib/collectionsApi';
import './Courses.css';

/** THE COURSES CATALOG (founder 2026-10-05: "audit all the UIs for Courses
 *  platforms (Kajabi, Canvas, etc.) and build out the courses UI to combine
 *  all the best features… adapted to Lichen"). What the platforms converge
 *  on, spoken in Lichen's grammar:
 *   - Canvas's dashboard → a CONTINUE WEAVING rail: every course you're
 *     enrolled in, your progress, one tap back in. Progress is yours alone
 *     — no counts, no leaderboards (the standing doctrine).
 *   - Kajabi/Teachable's storefront → a card CATALOG of published courses:
 *     cover, leader, and the legible offering chips (level · format ·
 *     length · price) the course page already speaks.
 *   - Skool's courses-beside-community → nothing to build: a cohort IS a
 *     real Lichen group, and each card's course page carries its doors.
 *  The old posts stream stays one word-toggle away (Catalog | Feed — the
 *  SpacesDirectory Your/All grammar), and every SCOPED arrival
 *  (?space=/?member=/?identity=) keeps the AreaFeed machinery untouched —
 *  ScopeEmpty/ScopeMore/ScopeBack live there. */
export default function Courses() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const [params] = useSearchParams();

  // Scoped sections are the platform through a filter (standing rule) —
  // those arrivals keep the stream and its scope machinery whole. The plain
  // room shows the catalog unless the member chose the Feed toggle.
  const scoped = !!(params.get('space') || params.get('member') || params.get('identity'));
  const feedView = scoped || params.get('view') === 'feed';

  const [mine, setMine] = useState<EnrolledCourse[]>([]);
  const [catalog, setCatalog] = useState<CollectionRow[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (feedView) return;
    let live = true;
    void (async () => {
      const [enrolled, pub] = await Promise.all([
        me ? listMyEnrolledCourses() : Promise.resolve([]),
        listPublicCollections(24, 'course'),
      ]);
      if (!live) return;
      setMine(enrolled);
      setCatalog(pub);
      setReady(true);
    })();
    return () => { live = false; };
  }, [me, feedView]);

  // The rail points at unfinished work first (finished courses sink to the
  // end — "Revisit" is real, but it isn't what the rail is for).
  const rail = useMemo(() => {
    const going = mine.filter((c) => c.total > 0);
    return going.sort((a, b) => Number(a.done >= a.total) - Number(b.done >= b.total));
  }, [mine]);
  const enrolledIds = useMemo(() => new Set(mine.map((c) => c.meta.id)), [mine]);
  const browse = useMemo(() => catalog.filter((c) => !enrolledIds.has(c.id)), [catalog, enrolledIds]);

  async function newCourse() {
    if (!me || busy) return;
    setBusy(true);
    try {
      const cid = await createCollection('Untitled course', 'course');
      navigate(`/collections/${cid}?manage=1`);
    } finally { setBusy(false); }
  }

  if (feedView) {
    return (
      <AreaFeed area="courses" icon="graduation-cap" crumb="Courses"
        title="Lichen" italic="Courses."
        sub="Trainings, workshops, apprenticeships — taught by people your web can vouch for."
        addLabel="Teach" emptyHint="Be the first — tap Teach and offer a course or training."
        mediaLenses structuredKind="course" browse />
    );
  }

  return (
    <div className="crs">
      {/* The section-landing header grammar (Drive's centered title +
          explanation — founder 2026-10-02: "that makes the platform design
          consistent"). */}
      <header className="myc__head">
        <h1 className="myc__title">Lichen <em className="display-italic">Courses.</em></h1>
        <p className="myc__sub">
          Trainings, workshops, apprenticeships — taught by people your web can vouch for.
        </p>
      </header>

      {/* Doors left, platform grammar: constant tools as icon circles. */}
      <div className="crs__bar" role="toolbar" aria-label="Courses">
        <button className="crs__door" aria-label="Search courses"
          onClick={() => navigate('/search?area=courses')}>
          <span className="crs__door-circle"><Icon name="search" size={14} /></span>
          <em>Search</em>
        </button>
        {me && (
          <button className="crs__door" aria-label="Create a course" disabled={busy}
            onClick={() => void newCourse()}>
            <span className="crs__door-circle"><Icon name="plus" size={14} /></span>
            <em>Teach</em>
          </button>
        )}
        <span className="crs__door crs__door--ai">
          <AssistantDoor section="courses" size={36} />
          <em>AI</em>
        </span>
      </div>

      {/* Catalog | Feed — the word-toggle grammar. Feed is the old stream of
          course-area posts; the catalog is the room's new front. */}
      <div className="crs__views" role="tablist" aria-label="Courses view">
        <span className="crs__viewtab is-on" role="tab" aria-selected="true">Catalog</span>
        <Link className="crs__viewtab" role="tab" aria-selected="false" to="/courses?view=feed">Feed</Link>
      </div>

      {!ready && <p className="crs__muted">Loading…</p>}

      {/* CONTINUE WEAVING — the Canvas-dashboard rail: your courses, your
          progress, one tap back into the next unfinished lesson (the course
          page's own Continue button carries it from there). */}
      {ready && me && rail.length > 0 && (
        <section className="crs__section">
          <h2 className="crs__h2">Continue weaving</h2>
          <div className="crs__rail">
            {rail.map(({ meta, total, done }) => {
              const pct = total ? Math.round((done / total) * 100) : 0;
              const finished = total > 0 && done >= total;
              return (
                <button key={meta.id} className="crs__railcard" onClick={() => navigate(`/collections/${meta.id}`)}>
                  {meta.details.coverUrl
                    ? <img className="crs__railcover" src={meta.details.coverUrl} alt="" loading="lazy" />
                    : <span className="crs__railcover crs__railcover--type" aria-hidden>{meta.name.slice(0, 1)}</span>}
                  <span className="crs__railbody">
                    <span className="crs__railname">{meta.name}</span>
                    <span className="crs__railby">{meta.owner?.full_name ?? 'a member'}</span>
                    <span className="crs__railprog" role="img"
                      aria-label={`${done} of ${total} lessons complete`}>
                      <span className="crs__railbar"><span style={{ width: `${pct}%` }} /></span>
                      <em>{done}/{total}</em>
                    </span>
                  </span>
                  <span className={'crs__railgo' + (finished ? ' is-done' : '')}>
                    {finished ? 'Revisit' : 'Continue'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* THE CATALOG — published courses as cards: cover, leader, and the
          same offering chips the course page speaks. */}
      {ready && (
        <section className="crs__section">
          <h2 className="crs__h2">{rail.length > 0 ? 'All courses' : 'Courses'}</h2>
          {browse.length === 0 && rail.length === 0 ? (
            <p className="crs__muted">
              No published courses yet — be the first: tap Teach and shape one.
            </p>
          ) : browse.length === 0 ? (
            <p className="crs__muted">You&rsquo;re woven into everything published so far.</p>
          ) : (
            <div className="crs__grid">
              {browse.map((c) => (
                <button key={c.id} className="crs__card" onClick={() => navigate(`/collections/${c.id}`)}>
                  {c.details.coverUrl
                    ? <img className="crs__cover" src={c.details.coverUrl} alt="" loading="lazy" />
                    : <span className="crs__cover crs__cover--type" aria-hidden>
                        <Icon name="graduation-cap" size={26} />
                      </span>}
                  <span className="crs__cardbody">
                    <span className="crs__cardname">{c.name}</span>
                    <span className="crs__cardby">
                      led by {c.owner?.full_name ?? 'a member'}
                      {c.space?.name ? ` · ${c.space.name}` : ''}
                    </span>
                    {c.description && <span className="crs__carddesc">{c.description}</span>}
                    <OfferingChips meta={c.details} lessonCount={c.item_count} />
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
