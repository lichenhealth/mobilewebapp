import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import CollapsibleSection from '../components/CollapsibleSection';
import AssistantDoor from '../components/AssistantDoor';
import SiteHeader from '../components/SiteHeader';
import FeedCard from '../components/FeedCard';
import OfferingChips from '../components/OfferingChips';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat, chatPathForPost } from '../lib/chatApi';
import { deletePost, loadAuthorFeed, loadPostsByIds, type FeedPost } from '../lib/postsApi';
import { postOpenPath, postToCard, weaveProps } from '../lib/feedMapping';
import {
  loadMyWeb, loadMyRecommendations, loadEndorsements, setTrust, setRecommend,
} from '../lib/myceliumApi';
import { loadMySaved, setSaved } from '../lib/savedApi';
import { setHidden } from '../lib/hiddenApi';
import {
  myDutiesIn, holdsDuty, createSpaceWithLocation, loadSpaceChatId, loadSpaceMembers,
  listCohorts, createCohort, type CohortRow,
} from '../lib/spacesApi';
import {
  loadCollection, updateCollection, deleteCollection, removeFromCollection, reorderItems,
  addToCollection, loadProgress, enroll, setLessonDone,
  suggestToCollection, listPendingSuggestions, resolveSuggestion,
  type CollectionRow, type OfferingMeta, type CollectionSuggestionRow,
  listCourseNotes, addCourseNote, updateCourseNote, deleteCourseNote, courseFolder,
  type CourseNote,
} from '../lib/collectionsApi';
import { useCollect } from '../collections/CollectPrompt';
import './CollectionPage.css';

const LEVELS = ['Intro', 'Deepening', 'Advanced'];
const FORMATS = ['Live', 'Self-paced', 'Mixed'];

// "Path" retired member-facing (founder 2026-07-24 — the Library trio is
// Search / Contribute / Organize): kind 'path' reads as an ordered collection.
const kindWord = (k: CollectionRow['kind']) => (k === 'course' ? 'Course' : k === 'path' ? 'Ordered collection' : 'Collection');
/** What one entry is called: course lessons vs collection pieces. */
const itemWord = (k: CollectionRow['kind']) => (k === 'course' ? 'lesson' : 'piece');

/** A collection — a private folder, a published playlist, or (with kind
 *  course/path) a structured offering: ordered lessons, a legible header, and
 *  per-learner progress. The curator arranges; learners enroll and tick along. */
export default function CollectionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { promptSaved, openPicker } = useCollect();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [meta, setMeta] = useState<CollectionRow | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [ready, setReady] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  // learner progress
  const [enrolled, setEnrolled] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  // owner editing
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newModuleName, setNewModuleName] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [form, setForm] = useState<OfferingMeta>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // curator lesson picker (add your own posts as lessons) — doubles as the
  // SUGGEST picker for everyone else (their pick becomes a pending suggestion)
  const [pickOpen, setPickOpen] = useState(false);
  const [myPosts, setMyPosts] = useState<FeedPost[]>([]);
  const [picksLoaded, setPicksLoaded] = useState(false);
  const [pickQ, setPickQ] = useState('');
  // scoped stewardship: a space collection is editable by its duty-holders
  const [spaceDuty, setSpaceDuty] = useState(false);
  // member suggestions (pieces + organizational notes)
  const [suggestions, setSuggestions] = useState<CollectionSuggestionRow[]>([]);
  const [suggPosts, setSuggPosts] = useState<FeedPost[]>([]);
  const [suggNote, setSuggNote] = useState('');
  const [suggSent, setSuggSent] = useState(false);

  const load = useCallback(async () => {
    setReady(false);
    const [col, prog, { web, vouched: myc }, recs, saves] = await Promise.all([
      loadCollection(id), loadProgress(id), loadMyWeb(), loadMyRecommendations(), loadMySaved(),
    ]);
    if (!col) { setMeta(null); setReady(true); return; }
    const ov = await loadEndorsements(col.posts, myc);
    let duty = false;
    if (col.meta.space_id && me) {
      const mine = await myDutiesIn(col.meta.space_id);
      duty = holdsDuty(mine?.role, mine?.duties, col.meta.kind === 'course' ? 'courses' : 'library');
    }
    const suggs = me ? await listPendingSuggestions(id) : [];
    const suggIds = suggs.map((s) => s.post_id).filter((p): p is string => !!p);
    setSuggestions(suggs);
    setSuggPosts(suggIds.length ? await loadPostsByIds(suggIds) : []);
    setSpaceDuty(duty);
    setMeta(col.meta); setPosts(col.posts);
    setName(col.meta.name); setDescription(col.meta.description ?? ''); setForm(col.meta.details ?? {});
    setEnrolled(prog.enrolled); setDone(prog.done);
    setMyWebSet(web); setMyMyc(myc); setMyRecs(recs); setMySaves(saves); setOverlays(ov);
    setReady(true);
  }, [id, me]);
  useEffect(() => { void load(); }, [load]);

  /** The three content promises. Absent = open; the legacy bundled
   *  `protectedTeaching` flag closes all three, so old courses keep the
   *  promise they were published under. */
  function promises(d: OfferingMeta) {
    const legacy = !!d.protectedTeaching;
    return {
      shareable:    legacy ? false : d.shareable !== false,
      downloadable: legacy ? false : d.downloadable !== false,
      aiReadable:   legacy ? false : d.aiReadable !== false,
    };
  }
  const isOwner = !!me && meta?.owner_id === me;
  // The curators: the human who made it + any space admin stewarding this duty.
  const canEdit = isOwner || spaceDuty;
  /** ADMIN VIEW vs PUBLIC VIEW (founder 2026-08-15): a course page used to
   *  wear its whole toolbox — Edit / Add lessons / New cohort / Make private /
   *  Delete — in front of every learner. Same split as Profile and a space's
   *  backstage now: `?manage=1` is where everything is edited, in the same
   *  CollapsibleSection accordion, and the page itself reads as the course.
   *  One "Manage this course" pill is the door. */
  const [pageParams] = useSearchParams();
  const managing = canEdit && pageParams.get('manage') === '1';
  // Accordion state — independent sections, same as Profile/SpaceProfile.
  const [openSects, setOpenSects] = useState<Set<string>>(new Set());
  const toggleSect = (k: string) => setOpenSects((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  // ── Canvas-style modules (founder + Melanie 2026-07-26): named groups of
  // lessons, stored in details.modules — display groups + owner assignment.
  const lessonGroups = useMemo(() => {
    const mods = meta?.details.modules ?? [];
    if (meta?.kind !== 'course' || mods.length === 0) {
      return [{ title: 'Lessons', posts }];
    }
    const byId = new Map(posts.map((p) => [p.id, p]));
    const used = new Set<string>();
    const gs = mods.map((m) => {
      const inMod = m.ids.map((pid) => byId.get(pid)).filter((p): p is FeedPost => !!p);
      inMod.forEach((p) => used.add(p.id));
      return { title: m.title, posts: inMod };
    });
    const rest = posts.filter((p) => !used.has(p.id));
    if (rest.length) gs.push({ title: 'More lessons', posts: rest });
    return gs.filter((g) => g.posts.length > 0 || true);
  }, [posts, meta]);
  const showModules = meta?.kind === 'course' && (meta?.details.modules?.length ?? 0) > 0;

  async function saveDetails(next: OfferingMeta) {
    await updateCollection(id, { details: next });
    setMeta((m) => (m ? { ...m, details: next } : m));
    setForm(next);
  }
  const moduleOf = (pid: string): string =>
    (meta?.details.modules ?? []).find((m) => m.ids.includes(pid))?.title ?? '';
  async function setLessonModule(pid: string, title: string) {
    if (!meta) return;
    const mods = (meta.details.modules ?? []).map((m) => ({
      title: m.title,
      ids: m.ids.filter((x) => x !== pid),
    }));
    if (title) mods.find((m) => m.title === title)?.ids.push(pid);
    await saveDetails({ ...meta.details, modules: mods });
  }
  async function addModule() {
    const nm = newModuleName.trim();
    if (!nm || !meta) return;
    if ((meta.details.modules ?? []).some((m) => m.title === nm)) { setNewModuleName(''); return; }
    await saveDetails({ ...meta.details, modules: [...(meta.details.modules ?? []), { title: nm, ids: [] }] });
    setNewModuleName('');
  }
  async function removeModule(title: string) {
    if (!meta) return;
    await saveDetails({
      ...meta.details,
      modules: (meta.details.modules ?? []).filter((m) => m.title !== title),
    });
  }
  // The course circle: a REAL Lichen group — chat, events, and find-a-time
  // come along for free; joining runs through the group's own consent flow.
  async function createCircle() {
    if (!meta || !me) return;
    const gid = await createSpaceWithLocation(me, `${meta.name} Circle`, 'group', '', null);
    await saveDetails({ ...meta.details, circleId: gid });
  }
  // Cohorts: many turns of one course, each a real group with its own chat,
  // calendar and consented membership (founder 2026-07-28).
  // YOUR NOTEBOOK ON THIS COURSE (founder 2026-08-15) — private, tied to the
  // course so it's waiting where you left it, and the course's own Drive
  // folder is named beside it so Drive organizes itself as you go.
  const [notes, setNotes] = useState<CourseNote[]>([]);
  // Which piece's notepad is open (null = none). Notes are per-lesson when
  // taken from a row, course-wide when taken from the summary at the top.
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [folder, setFolder] = useState<{ id: string; name: string } | null>(null);
  const notesOn = (postId: string | null) => notes.filter((n) => n.post_id === postId);
  useEffect(() => {
    if (!me || !id) return;
    let live = true;
    void listCourseNotes(id).then((n) => { if (live) setNotes(n); }).catch(console.error);
    void courseFolder(id).then((f) => { if (live) setFolder(f); }).catch(console.error);
    return () => { live = false; };
  }, [me, id, enrolled]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [cohortOpen, setCohortOpen] = useState(false);
  const [cohortTerm, setCohortTerm] = useState('');
  useEffect(() => {
    if (!id) return;
    let live = true;
    void listCohorts(id).then((c) => { if (live) setCohorts(c); });
    return () => { live = false; };
  }, [id]);
  // The cohort this learner actually belongs to (or the only one going) —
  // its chat, calendar and people are the course's real facilities.
  const [myCohort, setMyCohort] = useState<{ id: string; name: string; chatId: string | null; member: boolean } | null>(null);
  useEffect(() => {
    const cid = cohorts[0]?.id ?? meta?.details.circleId;
    if (!cid) { setMyCohort(null); return; }
    let live = true;
    void (async () => {
      const [chatId, members] = await Promise.all([
        loadSpaceChatId(cid).catch(() => null),
        loadSpaceMembers(cid).catch(() => []),
      ]);
      if (live) setMyCohort({
        id: cid,
        name: cohorts[0]?.term || cohorts[0]?.name || 'Cohort',
        chatId,
        member: !!me && members.some((m) => m.profile_id === me),
      });
    })();
    return () => { live = false; };
  }, [cohorts, meta?.details.circleId, me]);

  // Signed-out readers get the website chrome (founder 2026-07-30): the
  // persistent site nav instead of the app's bars — nobody gets marooned.
  useEffect(() => {
    if (me) return;
    document.documentElement.classList.add('is-public-page');
    return () => document.documentElement.classList.remove('is-public-page');
  }, [me]);

  async function startCohort() {
    if (!meta || !me) return;
    const gid = await createCohort(me, id, meta.name, cohortTerm);
    setCohortOpen(false); setCohortTerm('');
    setCohorts(await listCohorts(id));
    navigate(`/spaces/${gid}`);
  }

  const structured = meta?.kind === 'course' || meta?.kind === 'path';
  const firstUnfinished = useMemo(() => posts.find((p) => !done.has(p.id)) ?? posts[0], [posts, done]);
  const pct = posts.length ? Math.round((done.size / posts.length) * 100) : 0;

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError((e as Error)?.message || 'Something went wrong.'); }
    setBusy(false);
  }

  // One rule for every feed's chat door (founder 2026-08-17): a post in a
  // space's voice opens the conversation WITH that space, answered by the
  // admin who wrote it; a personal post opens the DM. The post rides along.
  async function messageAbout(post: { id: string; author_id: string; author_space_id?: string | null }) {
    try { navigate(await chatPathForPost(post)); }
    catch (e) { console.error(e); alert('Could not open the chat: ' + (e instanceof Error ? e.message : String(e))); }
  }

  // Start / Continue: enroll (once), then open the first unfinished lesson.
  async function startOrContinue() {
    if (!firstUnfinished) return;
    if (!enrolled) { await enroll(id); setEnrolled(true); }
    navigate(postOpenPath(firstUnfinished));
  }

  function toggleLesson(postId: string) {
    const next = !done.has(postId);
    setDone((cur) => { const s = new Set(cur); if (next) s.add(postId); else s.delete(postId); return s; });
    if (!enrolled && next) setEnrolled(true);
    void setLessonDone(id, postId, next).catch((e) => { console.error(e); void load(); });
  }

  // Owner reorder — swap a lesson with its neighbour and persist the new order.
  function move(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= posts.length) return;
    const next = posts.slice();
    [next[index], next[j]] = [next[j], next[index]];
    setPosts(next);
    void reorderItems(id, next.map((p) => p.id)).catch((e) => { console.error(e); void load(); });
  }

  // Curator: pull your own posts in as lessons. Non-curators use the same
  // picker to SUGGEST a piece instead.
  async function openLessonPicker() {
    const opening = !pickOpen;
    setPickOpen(opening);
    if (opening && !picksLoaded && me) {
      setMyPosts(await loadAuthorFeed({ profileId: me }));
      setPicksLoaded(true);
    }
  }
  const inCourse = useMemo(() => new Set(posts.map((p) => p.id)), [posts]);
  const suggested = useMemo(
    () => new Set(suggestions.filter((s) => s.post_id).map((s) => s.post_id as string)),
    [suggestions]);
  const pickable = useMemo(() => {
    const q = pickQ.trim().toLowerCase();
    return myPosts.filter((p) => !inCourse.has(p.id) && !suggested.has(p.id)
      && (!q || (p.title ?? '').toLowerCase().includes(q) || p.body.toLowerCase().includes(q)));
  }, [myPosts, inCourse, suggested, pickQ]);
  async function addLesson(p: FeedPost) {
    if (canEdit) {
      await addToCollection(id, p.id);
      setPosts((cur) => [...cur, p]);
    } else {
      await suggestToCollection(id, { postId: p.id });
      setSuggSent(true);
      void load();
    }
  }
  async function sendNote() {
    if (!suggNote.trim()) return;
    await suggestToCollection(id, { note: suggNote });
    setSuggNote(''); setSuggSent(true);
    void load();
  }
  async function decideSuggestion(sid: string, accept: boolean) {
    await resolveSuggestion(sid, accept);
    setSuggestions((cur) => cur.filter((s) => s.id !== sid));
    if (accept) void load();
  }
  const suggPostOf = (pid: string | null) => suggPosts.find((p) => p.id === pid);

  if (!ready) return <div className="colp"><p className="colp__muted">Loading…</p></div>;
  if (!meta) return <div className="colp"><p className="colp__muted">This page isn&rsquo;t available.</p></div>;

  // What the header says about the three promises — named plainly, so a
  // student reads exactly which door is shut rather than one blanket word.
  const pr = promises(meta.details);
  const closed = [
    !pr.shareable && 'Sharing',
    !pr.downloadable && 'Downloads',
    !pr.aiReadable && 'AI',
  ].filter(Boolean) as string[];
  const closedCount = closed.length;
  const closedLabel = closed.length === 3 ? 'Sharing, downloads & AI'
    : closed.join(' & ');

  const editing = managing;
  // ONE SAVE for the whole backstage (founder 2026-08-15: streamline the
  // controls) — sections edit local state, the bar at the foot commits it.
  const dirty = !!meta && (
    name !== meta.name
    || description !== (meta.description ?? '')
    || JSON.stringify(form) !== JSON.stringify(meta.details ?? {})
  );
  function resetForm() {
    if (!meta) return;
    setName(meta.name);
    setDescription(meta.description ?? '');
    setForm(meta.details ?? {});
  }
  async function saveMeta() {
    if (!meta) return;
    const patch = { name: name.trim(), description: description.trim() || null, details: form };
    await updateCollection(id, patch);
    setMeta((m) => (m ? { ...m, ...patch } : m));
  }

  return (
    <>
    {!me && <SiteHeader />}
    <div className="colp">
      {/* ONE TOP ROW (founder 2026-08-15): the view toggle sits where Profile
          and a space put theirs — top left, in BOTH views, so Admin is a
          place you switch to rather than a pill buried under the content —
          and the way into the course sits opposite it, top right. */}
      {(canEdit || (structured && me && posts.length > 0)) && (
        <div className="colp__topbar">
          {canEdit ? (
            <div className="colp__viewtoggle" role="tablist">
              <button className={'colp__viewtab' + (managing ? ' is-on' : '')} role="tab"
                aria-selected={managing}
                onClick={() => navigate(`/collections/${id}?manage=1`)}>Admin</button>
              <button className={'colp__viewtab' + (!managing ? ' is-on' : '')} role="tab"
                aria-selected={!managing}
                onClick={() => navigate(`/collections/${id}`)}>
                {kindWord(meta.kind)} view
              </button>
            </div>
          ) : <span />}
          {structured && !managing && me && posts.length > 0 && (
            <div className="colp__learn">
              {enrolled && (
                <span className="colp__progress-label">{done.size}/{posts.length}</span>
              )}
              <button className="btn btn-primary colp__start" onClick={() => void act(startOrContinue)} disabled={busy}>
                {!enrolled ? (meta.kind === 'course' ? 'Start course' : 'Start') : pct === 100 ? 'Revisit' : 'Continue'}
              </button>
            </div>
          )}
        </div>
      )}

      <header className="colp__head">
        {meta.details.coverUrl && (
          <img className="colp__cover" src={meta.details.coverUrl} alt="" />
        )}
        <p className="colp__crumb">
          <Icon name={meta.kind === 'course' ? 'book' : 'bookmark'} size={11} />
          <span>{kindWord(meta.kind)}</span>
          <em className={'colp__badge' + (meta.is_public ? ' is-public' : '')}>
            {meta.is_public ? 'Published' : 'Private'}
          </em>
        </p>
        <h1 className="colp__title display-italic">{meta.name}</h1>
        <p className="colp__by">
          {meta.space_id && (
            <><Link to={`/spaces/${meta.space_id}`}>{meta.space?.name ?? 'a space'}</Link>{' · '}</>
          )}
          {meta.kind === 'course' ? 'led by' : meta.kind === 'path' ? 'organized by' : 'curated by'}{' '}
          <Link to={`/members/${meta.owner_id}`}>{meta.owner?.full_name ?? 'a member'}</Link>
          {' · '}{posts.length} {itemWord(meta.kind)}{posts.length === 1 ? '' : 's'}
        </p>
        {meta.description && <p className="colp__desc">{meta.description}</p>}
        {structured && <OfferingChips meta={meta.details} lessonCount={posts.length} itemWord={itemWord(meta.kind)} />}
        {meta.kind === 'course' && closedCount > 0 && (
          /* One line by default; the WHY opens underneath — in the teacher's
             own words when they wrote some (founder 2026-08-05). */
          <div className="colp__protect">
            <button className="colp__protect-head" onClick={() => setWhyOpen((o) => !o)}
              aria-expanded={whyOpen}>
              <span><strong>{closedLabel}</strong> &mdash; held closed</span>
              <Icon name={whyOpen ? 'chevron-left' : 'chevron-right'} size={13} />
            </button>
            {whyOpen && (
              <p className="colp__protect-why">
                {meta.details.protectedNote?.trim()
                  || "This course stays in the room: no downloads, every recording watermarked with the viewer's name, and never read by any assistant — a standing promise, made by the teacher, kept by the platform."}
              </p>
            )}
          </div>
        )}
      </header>

      {error && <p className="colp__error">{error}</p>}

      {/* The course circle: chat, cohort, and scheduling — the integrated
          platform showing up inside the course (founder + Melanie 2026-07-26). */}
      {/* The cohort's facilities, in the platform's own circle vocabulary
          (founder 2026-07-28) — the same doors a learner meets everywhere
          else. Calendar/Find-a-time only means something inside the cohort,
          so it appears for members; everyone can knock on the cohort itself. */}
      {/* DOORS LEFT, ROOMS RIGHT (founder 2026-08-15) — the platform's one
          toolbar grammar: constant tools (search, post, the assistant) as
          icon-only circles on the left, a hairline, then this course's own
          rooms. The brain here is the update on THIS course's content. */}
      <div className="colp__doors colp__bar" role="toolbar" aria-label="Course">
        <button className="colp__door" onClick={() => navigate(`/search?area=courses&collection=${id}`)}>
          <span className="colp__door-circle"><Icon name="search" size={14} /></span>
        </button>
        {canEdit && (
          <button className="colp__door" onClick={() => navigate(`/compose?area=courses&collection=${id}`)}
            title={`Add a ${itemWord(meta.kind)}`}>
            <span className="colp__door-circle"><Icon name="plus" size={14} /></span>
          </button>
        )}
        <span className="colp__door colp__door--ai">
          <AssistantDoor section="courses" size={36} scope={`collection=${id}`}
            label="Your update on this course" />
        </span>
        {meta.kind === 'course' && myCohort && <span className="colp__bar-divider" aria-hidden />}
        {meta.kind === 'course' && myCohort && (
          <>
          {myCohort.member && myCohort.chatId && (
            <button className="colp__door" onClick={() => navigate(`/chat/${myCohort.chatId}?from=/collections/${id}`)}>
              <span className="colp__door-circle"><Icon name="chat" size={14} /></span>
              <span className="colp__door-label">Chat</span>
            </button>
          )}
          {myCohort.member && (
            <button className="colp__door" onClick={() => navigate(`/calendar?space=${myCohort.id}`)}>
              <span className="colp__door-circle"><Icon name="calendar" size={14} /></span>
              <span className="colp__door-label">Calendar</span>
            </button>
          )}
          <button className="colp__door" onClick={() => navigate(`/spaces/${myCohort.id}?tab=events`)}>
            <span className="colp__door-circle"><Icon name="rsvp" size={14} /></span>
            <span className="colp__door-label">Events</span>
          </button>
          <button className="colp__door" onClick={() => navigate(`/spaces/${myCohort.id}`)}>
            <span className="colp__door-circle"><Icon name="member-heart" size={14} /></span>
            <span className="colp__door-label">{cohorts.length > 1 ? myCohort.name : 'Cohort'}</span>
          </button>
          {cohorts.length > 1 && cohorts.slice(1).map((co) => (
            <button className="colp__door" key={co.id} onClick={() => navigate(`/spaces/${co.id}`)}>
              <span className="colp__door-circle"><Icon name="groups" size={14} /></span>
              <span className="colp__door-label">{co.term || 'Cohort'}</span>
            </button>
          ))}
          </>
        )}
      </div>


      {/* Members who don't curate can SUGGEST — a piece from their posts, or a note. */}
      {me && !canEdit && (
        <div className="colp__controls">
          <button className="btn colp__btn" onClick={() => void openLessonPicker()}>
            {pickOpen ? 'Close' : 'Suggest a piece or a change'}
          </button>
          {suggSent && <span className="colp__muted">Sent — the organizers will review it.</span>}
        </div>
      )}


      {/* PUBLISH TO ANY ROOM (founder 2026-08-14: "allow people to publish to
          whatever they want... then they are put through a posting process
          commensurate to the room they've chosen"): pick a room, the
          collection goes public, and Compose mints the post that carries it —
          shaped by that room's own flow. */}

      {/* Inline delete confirm — no browser dialog (founder 2026-07-24). */}


      {me && !canEdit && pickOpen && (
        <div className="colp__picker">
          {!canEdit && (
            <textarea
              className="prof__textarea colp__sugg-note"
              placeholder="Suggest a change — ordering, gaps, anything the organizers should hear…"
              value={suggNote}
              onChange={(e) => setSuggNote(e.target.value)}
            />
          )}
          {!canEdit && suggNote.trim() && (
            <button className="btn btn-primary colp__btn" disabled={busy}
              onClick={() => void act(sendNote)}>Send suggestion</button>
          )}
          <input
            className="prof__input"
            placeholder={canEdit
              ? `Search your posts to add as ${itemWord(meta.kind)}s…`
              : 'Or search your posts to suggest a piece…'}
            value={pickQ}
            onChange={(e) => setPickQ(e.target.value)}
          />
          {pickable.length === 0 ? (
            <p className="colp__muted">
              {!picksLoaded
                ? 'Loading your posts…'
                : meta.kind === 'course'
                  ? <>No posts to add — create one via <Link to="/compose?area=courses">Teach</Link>.</>
                  : <>No posts to add — create one via <Link to="/compose?area=library">Contribute</Link>.</>}
            </p>
          ) : (
            <div className="colp__picker-list">
              {pickable.map((p) => (
                <button key={p.id} className="colp__picker-row" onClick={() => void act(() => addLesson(p))}>
                  <span className="colp__picker-title">{p.title || p.body.slice(0, 64)}</span>
                  <Icon name="plus" size={15} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pending suggestions — the curators decide, quietly. */}

      {managing && (
        <div className="colp__backstage">
          <CollapsibleSection id="colp-build" title={`${kindWord(meta.kind)} Builder & Editor`}
            open={openSects.has('build')} onToggle={() => toggleSect('build')}>
            <input
              className="prof__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${kindWord(meta.kind)} name`}
            />
            <textarea
              className="prof__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this for? What will people come away with? (shown when published)"
            />
            {structured && (
              <div className="colp__meta-edit">
                <span className="colp__meta-label">Level</span>
                <div className="colp__chips">
                  {LEVELS.map((l) => (
                    <button key={l} type="button"
                      className={'colp__chip' + (form.level === l ? ' is-on' : '')}
                      onClick={() => setForm((f) => ({ ...f, level: f.level === l ? undefined : l }))}>{l}</button>
                  ))}
                </div>
                <span className="colp__meta-label">Format</span>
                <div className="colp__chips">
                  {FORMATS.map((l) => (
                    <button key={l} type="button"
                      className={'colp__chip' + (form.format === l ? ' is-on' : '')}
                      onClick={() => setForm((f) => ({ ...f, format: f.format === l ? undefined : l }))}>{l}</button>
                  ))}
                </div>
                <input className="prof__input" value={form.length ?? ''} placeholder={`Length (e.g. 6 weeks, 4 ${itemWord(meta.kind)}s)`}
                  onChange={(e) => setForm((f) => ({ ...f, length: e.target.value || undefined }))} />
                <input className="prof__input" value={form.forWhom ?? ''} placeholder="Who it's for (e.g. new practitioners)"
                  onChange={(e) => setForm((f) => ({ ...f, forWhom: e.target.value || undefined }))} />
                {meta.kind === 'course' && (
                  <>
                    <span className="colp__meta-label">Modules</span>
                    {(meta.details.modules ?? []).length > 0 && (
                      <div className="colp__chips">
                        {(meta.details.modules ?? []).map((m) => (
                          <span key={m.title} className="colp__chip is-on colp__modchip">
                            {m.title}
                            <button className="colp__modchip-x" aria-label={`Remove module ${m.title}`}
                              onClick={() => void act(() => removeModule(m.title))}>&times;</button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="colp__modadd">
                      <input className="prof__input" value={newModuleName}
                        onChange={(e) => setNewModuleName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void act(addModule); }}
                        placeholder="New module (e.g. Week 1 — Foundations)" />
                      <button className="btn colp__btn" disabled={busy || !newModuleName.trim()}
                        onClick={() => void act(addModule)}>Add module</button>
                    </div>
                    <p className="colp__addhint">Assign each lesson to a module with the selector beside it below.</p>
                  </>
                )}
              </div>
            )}
          </CollapsibleSection>

          {/* PRIVACY (founder 2026-08-15): the three content promises, each on
              its own switch — a teacher can close one door without closing
              all three, and students read exactly which one is shut. */}
          <CollapsibleSection id="colp-privacy" title="Privacy" active={closedCount > 0}
            open={openSects.has('privacy')} onToggle={() => toggleSect('privacy')}>
            {([
              { key: 'shareable',    label: 'Shareable',  hint: 'Others may weave these pieces into their own collections.' },
              { key: 'downloadable', label: 'Downloadable', hint: 'Recordings and files can be saved; when off, every recording is watermarked with the viewer\u2019s name.' },
              { key: 'aiReadable',   label: 'AI enabled', hint: 'Assistants may read this material when helping a member.' },
            ] as const).map(({ key, label, hint }) => (
              <label className="colp__promise" key={key}>
                <input type="checkbox" checked={promises(form)[key]}
                  onChange={(e) => setForm((f) => ({
                    ...f, protectedTeaching: undefined,
                    shareable:    key === 'shareable'    ? e.target.checked : promises(f).shareable,
                    downloadable: key === 'downloadable' ? e.target.checked : promises(f).downloadable,
                    aiReadable:   key === 'aiReadable'   ? e.target.checked : promises(f).aiReadable,
                  }))} />
                <span><strong>{label}</strong> — {hint}</span>
              </label>
            ))}
            {(!promises(form).shareable || !promises(form).downloadable || !promises(form).aiReadable) && (
              <textarea className="prof__input colp__protect-note" rows={3}
                value={form.protectedNote ?? ''}
                placeholder="Why this teaching is held closed — in your words. Students see this when they open the line."
                onChange={(e) => setForm((f) => ({ ...f, protectedNote: e.target.value || undefined }))} />
            )}
          </CollapsibleSection>

          {/* What it costs — a course's answer to a space's Current-cy
              section (founder 2026-08-15). */}
          <CollapsibleSection id="colp-cost" title="Cost &amp; access" active={!!form.price}
            open={openSects.has('cost')} onToggle={() => toggleSect('cost')}>
            <input className="prof__input" value={form.price ?? ''}
              placeholder="Free, $120, Sliding $40–$120, By donation…"
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value || undefined }))} />
            <p className="colp__addhint">
              Shown as a chip on the {kindWord(meta.kind).toLowerCase()}. Leave it empty and nothing is claimed
              about price; write &ldquo;Free&rdquo; to say so out loud.
            </p>
          </CollapsibleSection>

          {structured && (
            <CollapsibleSection id="colp-pieces" title={`${itemWord(meta.kind).charAt(0).toUpperCase()}${itemWord(meta.kind).slice(1)}s`}
              active={posts.length > 0}
              open={openSects.has('pieces')} onToggle={() => { toggleSect('pieces'); if (!picksLoaded) void openLessonPicker(); }}>
                <div className="colp__picker">
                  {!canEdit && (
                    <textarea
                      className="prof__textarea colp__sugg-note"
                      placeholder="Suggest a change — ordering, gaps, anything the organizers should hear…"
                      value={suggNote}
                      onChange={(e) => setSuggNote(e.target.value)}
                    />
                  )}
                  {!canEdit && suggNote.trim() && (
                    <button className="btn btn-primary colp__btn" disabled={busy}
                      onClick={() => void act(sendNote)}>Send suggestion</button>
                  )}
                  <input
                    className="prof__input"
                    placeholder={canEdit
                      ? `Search your posts to add as ${itemWord(meta.kind)}s…`
                      : 'Or search your posts to suggest a piece…'}
                    value={pickQ}
                    onChange={(e) => setPickQ(e.target.value)}
                  />
                  {pickable.length === 0 ? (
                    <p className="colp__muted">
                      {!picksLoaded
                        ? 'Loading your posts…'
                        : meta.kind === 'course'
                          ? <>No posts to add — create one via <Link to="/compose?area=courses">Teach</Link>.</>
                          : <>No posts to add — create one via <Link to="/compose?area=library">Contribute</Link>.</>}
                    </p>
                  ) : (
                    <div className="colp__picker-list">
                      {pickable.map((p) => (
                        <button key={p.id} className="colp__picker-row" onClick={() => void act(() => addLesson(p))}>
                          <span className="colp__picker-title">{p.title || p.body.slice(0, 64)}</span>
                          <Icon name="plus" size={15} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              <p className="colp__addhint">
                Order and modules are set on each {itemWord(meta.kind)} in the list below.
              </p>
            </CollapsibleSection>
          )}

          {meta.kind === 'course' && (
            <CollapsibleSection id="colp-cohorts" title="Cohorts" active={cohorts.length > 0}
              open={openSects.has('cohorts')} onToggle={() => toggleSect('cohorts')}>
              {cohorts.length > 0 && (
                <div className="colp__chips">
                  {cohorts.map((co) => (
                    <button key={co.id} className="colp__chip" onClick={() => navigate(`/spaces/${co.id}`)}>
                      {co.term || co.name}
                    </button>
                  ))}
                </div>
              )}
              {!cohortOpen && (
                <button className="btn colp__btn" disabled={busy}
                  onClick={() => setCohortOpen(true)}>
                  {cohorts.length ? 'New cohort' : 'Start a cohort'}
                </button>
              )}
              {cohortOpen && (
                  <div className="colp__cohortnew">
                    <input
                      className="colp__input"
                      value={cohortTerm}
                      onChange={(e) => setCohortTerm(e.target.value)}
                      placeholder="Name this turn — e.g. Colorado Kapulli 2026, Fall 2026, New hires Q3"
                      autoFocus
                    />
                    <button className="btn btn-primary colp__btn" disabled={busy} onClick={() => void act(startCohort)}>
                      Start it
                    </button>
                    <p className="colp__hint">
                      A cohort is a real group: its own chat, calendar and find-a-time. Members join
                      through the group&rsquo;s own consent flow, and the course keeps running after
                      this cohort finishes.
                    </p>
                  </div>
              )}
            </CollapsibleSection>
          )}

          <CollapsibleSection id="colp-publishing" title="Publishing" active={meta.is_public}
            open={openSects.has('publishing')} onToggle={() => toggleSect('publishing')}>
            {meta.is_public ? (
              <>
                <p className="colp__addhint">
                  Published — anyone who can see it may open it. Making it private closes it again;
                  any post that carries it stays up, pointing at a door that no longer opens.
                </p>
                <button className="btn colp__btn" disabled={busy}
                  onClick={() => void act(async () => {
                    await updateCollection(id, { is_public: false });
                    setMeta((m) => (m ? { ...m, is_public: false } : m));
                  })}>
                  Make private
                </button>
              </>
            ) : (
                <div className="colp__confirm colp__publish">
                  <span className="colp__confirm-text">
                    Where should it live? It becomes public, and you&rsquo;ll shape how it appears.
                  </span>
                  {([
                    { room: 'feed', label: 'Feed' },
                    { room: 'library', label: 'Library' },
                    { room: 'courses', label: 'Courses' },
                    { room: 'marketplace', label: 'Marketplace' },
                  ] as const).map(({ room, label }) => (
                    <button
                      key={room}
                      className="btn colp__btn"
                      disabled={busy}
                      onClick={() => void act(async () => {
                        await updateCollection(id, { is_public: true });
                        navigate(`/compose?collection=${id}${room === 'feed' ? '' : `&area=${room}`}`);
                      })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
            )}
          </CollapsibleSection>

          {suggestions.length > 0 && (
            <CollapsibleSection id="colp-suggs" title="Suggested by members" active
              open={openSects.has('suggs')} onToggle={() => toggleSect('suggs')}>
              <div className="colp__suggs">
                <p className="colp__suggs-label">Suggested by members</p>
                {suggestions.map((s) => (
                  <div className="colp__sugg" key={s.id}>
                    <span className="colp__sugg-text">
                      <em>{s.suggester?.full_name ?? 'A member'}</em>
                      {s.post_id ? (
                        <button className="colp__sugg-title"
                          onClick={() => { const p = suggPostOf(s.post_id); if (p) navigate(postOpenPath(p)); }}>
                          {suggPostOf(s.post_id)?.title || suggPostOf(s.post_id)?.body.slice(0, 64) || 'a piece'}
                        </button>
                      ) : (
                        <span className="colp__sugg-noteview">&ldquo;{s.note}&rdquo;</span>
                      )}
                    </span>
                    <span className="colp__sugg-actions">
                      {s.post_id && (
                        <button className="btn btn-primary colp__btn" disabled={busy}
                          onClick={() => void act(() => decideSuggestion(s.id, true))}>Add</button>
                      )}
                      {!s.post_id && (
                        <button className="btn btn-primary colp__btn" disabled={busy}
                          title="Mark taken on board — the suggester hears a thank-you"
                          onClick={() => void act(() => decideSuggestion(s.id, true))}>Noted</button>
                      )}
                      <button className="btn colp__btn" disabled={busy}
                        onClick={() => void act(() => decideSuggestion(s.id, false))}>Decline</button>
                    </span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          <CollapsibleSection id="colp-delete" title={`Delete this ${kindWord(meta.kind).toLowerCase()}`}
            open={openSects.has('delete')} onToggle={() => toggleSect('delete')}>
            {!confirmDelete ? (
              <button className="btn colp__btn colp__btn--danger" disabled={busy}
                onClick={() => setConfirmDelete(true)}>
                Delete {kindWord(meta.kind).toLowerCase()}
              </button>
            ) : (
                <div className="colp__confirm">
                  <span className="colp__confirm-text">
                    Delete <em>&ldquo;{meta.name}&rdquo;</em>? The pieces themselves are untouched.
                  </span>
                  <button
                    className="btn colp__btn colp__btn--danger"
                    disabled={busy}
                    onClick={() => void act(async () => { await deleteCollection(id); navigate('/saved'); })}
                  >
                    Yes, delete
                  </button>
                  <button className="btn colp__btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                </div>
            )}
          </CollapsibleSection>

          {/* One save for the whole backstage — no per-section buttons. */}
          {dirty && (
            <div className="colp__savebar">
              <span className="colp__savebar-text">Unsaved changes</span>
              <button className="btn colp__btn" disabled={busy} onClick={resetForm}>Discard</button>
              <button className="btn btn-primary colp__btn" disabled={busy || !name.trim()}
                onClick={() => void act(saveMeta)}>Save</button>
            </div>
          )}
        </div>
      )}

      {/* THE NOTES SUMMARY (founder 2026-08-15): every note you've taken on
          this course in one place at the top, each saying which piece it
          belongs to and each opening the Drive folder the course made for
          you. Per-piece notes are taken on the rows themselves, below. */}
      {me && structured && !managing && (
        <section className="colp__notes">
          <button className="colp__notes-head" onClick={() => setNotesOpen((o) => !o)}
            aria-expanded={notesOpen}>
            <span className="colp__notes-title">
              <Icon name="bookmark" size={13} />
              My notes
              {notes.length > 0 && <span className="colp__notes-n">{notes.length}</span>}
            </span>
            <Icon name={notesOpen ? 'chevron-left' : 'chevron-right'} size={13} />
          </button>
          {notesOpen && (
            <div className="colp__notes-body">
              <p className="colp__notes-hint">
                Yours alone — nobody on this course can see them, not the teacher, not the platform.
                {folder
                  ? <> They live in <Link to={`/collections/${folder.id}`}>your {folder.name} folder</Link> in Drive.</>
                  : <> Start the {kindWord(meta.kind).toLowerCase()} and Drive makes you a folder for it.</>}
              </p>
              {notes.length === 0 && (
                <p className="colp__muted">
                  Nothing yet — take a note on any {itemWord(meta.kind)} with the
                  {' '}<Icon name="bookmark" size={11} /> beside it, or write one about the
                  {' '}{kindWord(meta.kind).toLowerCase()} as a whole.
                </p>
              )}
              {notes.map((n) => {
                const on = n.post_id ? posts.find((p) => p.id === n.post_id) : null;
                return (
                  <div className="colp__note" key={n.id}>
                    <div className="colp__note-on">
                      {on
                        ? <button className="colp__note-where" onClick={() => navigate(postOpenPath(on))}>
                            {on.title || on.body.slice(0, 48)}
                          </button>
                        : <span className="colp__note-where colp__note-where--all">
                            The whole {kindWord(meta.kind).toLowerCase()}
                          </span>}
                      {folder && (
                        <Link className="colp__note-drive" to={`/collections/${folder.id}`}>
                          <Icon name="drive" size={12} /> Drive
                        </Link>
                      )}
                    </div>
                    <textarea
                      className="prof__textarea colp__note-body"
                      defaultValue={n.body}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (!v || v === n.body) return;
                        void updateCourseNote(n.id, v)
                          .then(() => setNotes((cur) => cur.map((x) => (x.id === n.id ? { ...x, body: v } : x))))
                          .catch(console.error);
                      }}
                    />
                    <div className="colp__note-foot">
                      <span className="colp__note-when">{n.created_at.slice(0, 10)}</span>
                      <button className="colp__note-x" aria-label="Delete note"
                        onClick={() => void deleteCourseNote(n.id)
                          .then(() => setNotes((cur) => cur.filter((x) => x.id !== n.id)))
                          .catch(console.error)}>&times;</button>
                    </div>
                  </div>
                );
              })}
              <NotePad
                notes={[]}
                busy={busy}
                onAdd={(body) => act(async () => {
                  const n = await addCourseNote(id, body, null);
                  setNotes((cur) => [n, ...cur]);
                })}
                onEdit={() => {}}
                onDelete={() => {}}
                placeholder={`A note about the whole ${kindWord(meta.kind).toLowerCase()}…`}
              />
            </div>
          )}
        </section>
      )}

      <section className="colp__list">
        {posts.length === 0 && (
          <p className="colp__muted">
            {structured ? `No ${itemWord(meta.kind)}s yet` : 'Nothing here yet'}
            {canEdit ? ' — add pieces from your posts (⋯ → Add to collection…).' : '.'}
          </p>
        )}
        {/* SYLLABUS (founder 2026-08-15): a course reads as a path you walk,
            not a stack of cards — modules in order, each lesson a row you
            check off, the next one marked so the platform is always pointing
            at what comes next. Curator affordances (reorder, module, remove)
            ride the same rows, but only in Admin view. */}
        {structured ? lessonGroups.map((g) => {
          const gdone = g.posts.filter((x) => done.has(x.id)).length;
          return (
            <div key={g.title} className="colp__modgroup">
              {showModules && (
                <div className="colp__module">
                  <span className="colp__module-title">{g.title}</span>
                  <span className="colp__module-count">
                    {gdone === g.posts.length && g.posts.length > 0
                      ? 'Complete'
                      : `${gdone}/${g.posts.length} done`}
                  </span>
                </div>
              )}
              <ol className="colp__syl">
                {g.posts.map((p) => {
                  const gi = posts.indexOf(p);
                  const isDone = done.has(p.id);
                  const isNext = !isDone && firstUnfinished?.id === p.id;
                  return (
                    <li key={p.id}
                      className={'colp__sylrow' + (isDone ? ' is-done' : '') + (isNext ? ' is-next' : '')}>
                      {me && !managing ? (
                        <button className="colp__tick" onClick={() => toggleLesson(p.id)}
                          aria-pressed={isDone} aria-label={isDone ? 'Mark not done' : 'Mark done'}>
                          {isDone ? <Icon name="check" size={14} /> : <span className="colp__tick-dot" />}
                        </button>
                      ) : (
                        <span className="colp__tick colp__tick--static" aria-hidden>
                          {isDone ? <Icon name="check" size={14} /> : <span className="colp__tick-dot" />}
                        </span>
                      )}
                      {/* The way IN sits left with the tick (founder
                          2026-08-15), which frees the right of the row for
                          your own notes on this piece. */}
                      <button className="colp__sylopen" onClick={() => navigate(postOpenPath(p))}>
                        <Icon name="chevron-right" size={13} />
                        <span className="colp__syl-n">{gi + 1}</span>
                        <span className="colp__syl-title">{p.title || p.body.slice(0, 72)}</span>
                        {isDone && <span className="colp__syl-mark">Completed</span>}
                        {isNext && <span className="colp__syl-mark colp__syl-mark--next">Up next</span>}
                      </button>
                      {me && !managing && (
                        <button
                          className={'colp__sylnote' + (noteFor === p.id ? ' is-on' : '') + (notesOn(p.id).length ? ' has-notes' : '')}
                          onClick={() => setNoteFor(noteFor === p.id ? null : p.id)}
                          aria-expanded={noteFor === p.id}
                          title={notesOn(p.id).length
                            ? `${notesOn(p.id).length} note${notesOn(p.id).length === 1 ? '' : 's'} on this ${itemWord(meta.kind)}`
                            : `Take a note on this ${itemWord(meta.kind)}`}>
                          <Icon name="bookmark" size={13} />
                          {notesOn(p.id).length > 0 && <span>{notesOn(p.id).length}</span>}
                        </button>
                      )}
                      {managing && (
                        <span className="colp__sylrow-admin">
                          {meta.kind === 'course' && (meta.details.modules?.length ?? 0) > 0 && (
                            <select className="colp__modsel" value={moduleOf(p.id)}
                              onChange={(e) => void act(() => setLessonModule(p.id, e.target.value))}
                              aria-label="Module">
                              <option value="">— module —</option>
                              {(meta.details.modules ?? []).map((m) => (
                                <option key={m.title} value={m.title}>{m.title}</option>
                              ))}
                            </select>
                          )}
                          <span className="colp__reorder">
                            <button onClick={() => move(gi, -1)} disabled={gi === 0} aria-label="Move up">
                              <Icon name="arrow-up" size={13} />
                            </button>
                            <button className="colp__reorder-down" onClick={() => move(gi, 1)}
                              disabled={gi === posts.length - 1} aria-label="Move down">
                              <Icon name="arrow-up" size={13} />
                            </button>
                          </span>
                          <button className="colp__sylremove" aria-label="Remove from this course"
                            onClick={() => {
                              void removeFromCollection(id, p.id)
                                .then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id)))
                                .catch(console.error);
                            }}>&times;</button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
              {g.posts.some((p) => p.id === noteFor) && (
                <NotePad
                  notes={notesOn(noteFor!)}
                  busy={busy}
                  onAdd={(body) => act(async () => {
                    const n = await addCourseNote(id, body, noteFor!);
                    setNotes((cur) => [n, ...cur]);
                  })}
                  onEdit={(nid, body) => { void updateCourseNote(nid, body)
                    .then(() => setNotes((cur) => cur.map((x) => (x.id === nid ? { ...x, body } : x))))
                    .catch(console.error); }}
                  onDelete={(nid) => { void deleteCourseNote(nid)
                    .then(() => setNotes((cur) => cur.filter((x) => x.id !== nid)))
                    .catch(console.error); }}
                  placeholder="What landed here? What do you want to come back to?"
                />
              )}
            </div>
          );
        }) : posts.map((p) => (
            <FeedCard
              key={p.id}
              {...postToCard(p, me || undefined)}
              {...weaveProps(p, myWebSet, me || undefined)}
              trusted={myMyc.has('profile:' + p.author_id)}
              recommended={myRecs.has('post:' + p.id)}
              saved={mySaves.has('post:' + p.id)}
              mycelium={overlays[p.id]}
              availability={{ trust: !!me && p.author_id !== me }}
              onTrust={(on) => { void setTrust('profile', p.author_id, on).catch(console.error); }}
              onRecommend={(on) => { void setRecommend('post', p.id, on).catch(console.error); }}
              onSave={me ? (on) => { void setSaved('post', p.id, on).then(() => { if (on) promptSaved(p.id); }).catch(console.error); } : undefined}
              extraMenuItems={[
                ...(me ? [{ label: 'Add to collection…', onClick: () => openPicker(p.id) }] : []),
                ...(canEdit ? [{
                  label: 'Remove from this collection',
                  onClick: () => {
                    void removeFromCollection(id, p.id)
                      .then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id)))
                      .catch(console.error);
                  },
                }] : []),
              ]}
              viewerIsAuthor={p.author_id === me}
              onManage={p.linked_event_id ? () => navigate(`/events/${p.id}`) : undefined}
              onEdit={!p.linked_event_id ? () => navigate(`/compose?post=${p.id}`) : undefined}
              onDelete={!p.linked_event_id ? () => { void deletePost(p.id).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
              onHide={me ? () => { void setHidden(p.id, true).then(() => setPosts((cur) => cur.filter((x) => x.id !== p.id))).catch(console.error); } : undefined}
              onMessage={me && p.author_id !== me ? () => messageAbout(p) : undefined}
              onOpen={() => navigate(postOpenPath(p))}
              onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
            />
        ))}
      </section>
    </div>
    </>
  );
}

/** One notepad, used twice: under a syllabus row for a note about that
 *  piece, and at the top for a note about the whole thing. Editing and
 *  deleting live with the note in the summary, so this stays a composer
 *  when `notes` is empty. */
function NotePad({ notes, busy, onAdd, onEdit, onDelete, placeholder }: {
  notes: CourseNote[];
  busy: boolean;
  onAdd: (body: string) => void | Promise<void>;
  onEdit: (id: string, body: string) => void;
  onDelete: (id: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="colp__notepad">
      {notes.map((n) => (
        <div className="colp__note" key={n.id}>
          <textarea
            className="prof__textarea colp__note-body"
            defaultValue={n.body}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== n.body) onEdit(n.id, v);
            }}
          />
          <div className="colp__note-foot">
            <span className="colp__note-when">{n.created_at.slice(0, 10)}</span>
            <button className="colp__note-x" aria-label="Delete note" onClick={() => onDelete(n.id)}>&times;</button>
          </div>
        </div>
      ))}
      <textarea
        className="prof__textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
      />
      <button className="btn btn-primary colp__btn" disabled={busy || !draft.trim()}
        onClick={() => { void Promise.resolve(onAdd(draft.trim())).then(() => setDraft('')); }}>
        Save note
      </button>
    </div>
  );
}
