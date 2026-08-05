import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import SiteHeader from '../components/SiteHeader';
import FeedCard from '../components/FeedCard';
import OfferingChips from '../components/OfferingChips';
import type { MyceliumSignals } from '../components/EngagementFooter';
import { useAuth } from '../auth/AuthProvider';
import { ensureDirectChat } from '../lib/chatApi';
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
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myMyc, setMyMyc] = useState<Set<string>>(new Set());
  const [myRecs, setMyRecs] = useState<Set<string>>(new Set());
  const [mySaves, setMySaves] = useState<Set<string>>(new Set());
  const [overlays, setOverlays] = useState<Record<string, MyceliumSignals>>({});
  // learner progress
  const [enrolled, setEnrolled] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  // owner editing
  const [editOpen, setEditOpen] = useState(false);
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

  const isOwner = !!me && meta?.owner_id === me;
  // The curators: the human who made it + any space admin stewarding this duty.
  const canEdit = isOwner || spaceDuty;

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

  async function messageAuthor(otherId: string) {
    try { navigate(`/chat/${await ensureDirectChat(otherId)}`); }
    catch (e) { console.error(e); }
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

  const editing = canEdit && editOpen;

  return (
    <>
    {!me && <SiteHeader />}
    <div className="colp">
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
        {meta.kind === 'course' && meta.details.protectedTeaching && (
          <p className="colp__protect">
            <strong>Protected teaching.</strong> This course stays in the room: no downloads,
            every recording watermarked with the viewer's name, and never read by any
            assistant — a standing promise, made by the teacher, kept by the platform.
          </p>
        )}
      </header>

      {error && <p className="colp__error">{error}</p>}

      {/* The course circle: chat, cohort, and scheduling — the integrated
          platform showing up inside the course (founder + Melanie 2026-07-26). */}
      {/* The cohort's facilities, in the platform's own circle vocabulary
          (founder 2026-07-28) — the same doors a learner meets everywhere
          else. Calendar/Find-a-time only means something inside the cohort,
          so it appears for members; everyone can knock on the cohort itself. */}
      {meta.kind === 'course' && myCohort && (
        <div className="colp__doors" role="toolbar" aria-label="Cohort">
          {myCohort.member && myCohort.chatId && (
            <button className="colp__door" onClick={() => navigate(`/chat/${myCohort.chatId}`)}>
              <span className="colp__door-circle"><Icon name="chat" size={14} /></span>
              <span className="colp__door-label">Chat</span>
            </button>
          )}
          {myCohort.member && (
            <button className="colp__door" onClick={() => navigate('/calendar')}>
              <span className="colp__door-circle"><Icon name="calendar" size={14} /></span>
              <span className="colp__door-label">Find a time</span>
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
        </div>
      )}

      {cohortOpen && canEdit && (
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

      {/* Learner loop: enroll + progress (structured, signed-in non-curators, has lessons). */}
      {structured && !canEdit && me && posts.length > 0 && (
        <div className="colp__learn">
          {enrolled && (
            <div className="colp__progress">
              <div className="colp__progress-bar"><span style={{ width: `${pct}%` }} /></div>
              <span className="colp__progress-label">{pct}% · {done.size}/{posts.length}</span>
            </div>
          )}
          <button className="btn btn-primary colp__start" onClick={() => void act(startOrContinue)} disabled={busy}>
            {!enrolled ? (meta.kind === 'course' ? 'Start course' : 'Start') : pct === 100 ? 'Revisit' : 'Continue'}
          </button>
        </div>
      )}

      {/* Members who don't curate can SUGGEST — a piece from their posts, or a note. */}
      {me && !canEdit && (
        <div className="colp__controls">
          <button className="btn colp__btn" onClick={() => void openLessonPicker()}>
            {pickOpen ? 'Close' : 'Suggest a piece or a change'}
          </button>
          {suggSent && <span className="colp__muted">Sent — the organizers will review it.</span>}
        </div>
      )}

      {canEdit && (
        <div className="colp__controls">
          <button className="btn colp__btn" onClick={() => setEditOpen((o) => !o)}>
            {editOpen ? 'Done' : 'Edit'}
          </button>
          {structured && (
            <button className="btn colp__btn" onClick={() => void openLessonPicker()}>
              {pickOpen ? 'Close' : `Add ${itemWord(meta.kind)}s`}
            </button>
          )}
          {meta.kind === 'course' && (
            <button className="btn colp__btn" disabled={busy}
              title="A cohort is a real Lichen group — chat, events and find-a-time come with it"
              onClick={() => setCohortOpen((o) => !o)}>
              {cohortOpen ? 'Cancel' : cohorts.length ? 'New cohort' : 'Start a cohort'}
            </button>
          )}
          <button
            className="btn btn-primary colp__btn"
            disabled={busy}
            onClick={() => void act(async () => {
              await updateCollection(id, { is_public: !meta.is_public });
              setMeta((m) => (m ? { ...m, is_public: !m.is_public } : m));
            })}
          >
            {meta.is_public ? 'Make private' : `Publish to Lichen ${meta.kind === 'path' ? 'Library' : 'Courses'}`}
          </button>
          <button
            className="btn colp__btn colp__btn--danger"
            disabled={busy}
            onClick={() => setConfirmDelete((c) => !c)}
          >
            Delete
          </button>
        </div>
      )}

      {/* Inline delete confirm — no browser dialog (founder 2026-07-24). */}
      {canEdit && confirmDelete && (
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

      {editing && (
        <div className="colp__edit">
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
              <input className="prof__input" value={form.price ?? ''} placeholder="Price / access (e.g. Free, $120, Sliding $40–$120)"
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value || undefined }))} />
              {meta.kind === 'course' && (
                <label className="colp__protect-toggle">
                  <input type="checkbox" checked={!!form.protectedTeaching}
                    onChange={(e) => setForm((f) => ({ ...f, protectedTeaching: e.target.checked || undefined }))} />
                  <span>
                    <strong>Protected teaching</strong> — downloads off, recordings watermarked
                    with each viewer's name, and this course is never read by any assistant.
                    Shown to students as a standing promise.
                  </span>
                </label>
              )}
              {meta.kind === 'course' && (
                <>
                  <span className="colp__meta-label">Modules</span>
                  {(meta.details.modules ?? []).length > 0 && (
                    <div className="colp__chips">
                      {(meta.details.modules ?? []).map((m) => (
                        <span key={m.title} className="colp__chip is-on colp__modchip">
                          {m.title}
                          <button className="colp__modchip-x" aria-label={`Remove module ${m.title}`}
                            onClick={() => void act(() => removeModule(m.title))}>×</button>
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
          <button
            className="btn btn-primary colp__btn"
            disabled={busy || !name.trim()}
            onClick={() => void act(async () => {
              await updateCollection(id, { name: name.trim(), description: description.trim() || null, details: form });
              setMeta((m) => (m ? { ...m, name: name.trim(), description: description.trim() || null, details: form } : m));
              setEditOpen(false);
            })}
          >
            Save
          </button>
          {structured && (
            <p className="colp__addhint">
              Add {itemWord(meta.kind)}s: open any of your posts (or make one via{' '}
              {meta.kind === 'course'
                ? <Link to="/compose?area=courses">Teach</Link>
                : <Link to="/compose?area=library">Contribute</Link>}),
              tap ⋯ → “Add to collection…”, and pick this {kindWord(meta.kind).toLowerCase()}.
            </p>
          )}
        </div>
      )}

      {me && pickOpen && (
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
      {canEdit && suggestions.length > 0 && (
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
      )}

      <section className="colp__list">
        {posts.length === 0 && (
          <p className="colp__muted">
            {structured ? `No ${itemWord(meta.kind)}s yet` : 'Nothing here yet'}
            {canEdit ? ' — add pieces from your posts (⋯ → Add to collection…).' : '.'}
          </p>
        )}
        {lessonGroups.map((g) => (
          <div key={g.title} className="colp__modgroup">
            {showModules && (
              <div className="colp__module">
                <span className="colp__module-title">{g.title}</span>
                <span className="colp__module-count">{g.posts.length} {g.posts.length === 1 ? 'lesson' : 'lessons'}</span>
              </div>
            )}
            {g.posts.map((p, i) => {
          const gi = posts.indexOf(p);
          const card = (
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
              onMessage={me && p.author_id !== me ? () => messageAuthor(p.author_id) : undefined}
              onOpen={() => navigate(postOpenPath(p))}
              onAuthor={() => navigate(p.author_space_id ? `/spaces/${p.author_space_id}` : `/members/${p.author_id}`)}
            />
          );
          if (!structured) return card;
          return (
            <div className={'colp__lesson' + (done.has(p.id) ? ' is-done' : '')} key={p.id}>
              <div className="colp__lesson-rail">
                {me && !canEdit && (
                  <button className="colp__tick" onClick={() => toggleLesson(p.id)}
                    aria-pressed={done.has(p.id)} aria-label={done.has(p.id) ? 'Mark not done' : 'Mark done'}>
                    {done.has(p.id) ? <Icon name="check" size={14} /> : <span className="colp__tick-dot" />}
                  </button>
                )}
                <span className="colp__lesson-n">{i + 1}</span>
                {editing && meta.kind === 'course' && (meta.details.modules?.length ?? 0) > 0 && (
                  <select
                    className="colp__modsel"
                    value={moduleOf(p.id)}
                    onChange={(e) => void act(() => setLessonModule(p.id, e.target.value))}
                    aria-label="Module"
                  >
                    <option value="">— module —</option>
                    {(meta.details.modules ?? []).map((m) => (
                      <option key={m.title} value={m.title}>{m.title}</option>
                    ))}
                  </select>
                )}
                {editing && (
                  <span className="colp__reorder">
                    <button onClick={() => move(gi, -1)} disabled={gi === 0} aria-label="Move up"><Icon name="arrow-up" size={13} /></button>
                    <button className="colp__reorder-down" onClick={() => move(gi, 1)} disabled={gi === posts.length - 1} aria-label="Move down"><Icon name="arrow-up" size={13} /></button>
                  </span>
                )}
              </div>
              <div className="colp__lesson-body">{card}</div>
            </div>
          );
            })}
          </div>
        ))}
      </section>
    </div>
    </>
  );
}
