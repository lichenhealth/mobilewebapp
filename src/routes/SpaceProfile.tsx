import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { setTopIdentity } from '../lib/topIdentity';
import { domainsForHandle } from '../lib/customDomain';
import { SURFACES, readableAccent, type PageSurface } from '../lib/pageColors';
import { brandSchemeFromLogo } from '../lib/avatarApi';
import Avatar from '../components/Avatar';
import LocationField from '../components/LocationField';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import ContributionsFeed from '../components/ContributionsFeed';
import { SmartLocation } from './Calendar';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { colorFor, monogramFor, sortClaudeFirst } from '../lib/chatApi';
import { hasClaudeFeedActivity } from '../lib/assistantFeedApi';
import MemberRow from '../components/MemberRow';
import type { GeoPoint } from '../lib/geoApi';
import {
  loadSpaceProfile, loadSpaceMembers, loadSpaceChatId, updateSpaceProfile, uploadSpaceAvatar,
  loadMyRequestFor, requestToJoin, removeRequest, listPendingRequests, inviteMember,
  approveJoin, acceptInvite, leaveSpace, deleteSpace, takeSpaceOffline, listChildGroups,
  listSpaceKnocks, inviteKnocker, decideSpaceKnock, type SpaceKnock, removeSpaceMember, createSpaceWithLocation,
  amIAdminOf, proposeNesting, loadNestingFor, listNestingProposals, approveNesting, removeNesting, ejectGroup,
  suggestMember, endorseSuggestion, setMemberRole, holdsDuty, SPACE_DUTIES,
  listPendingSectionShares, decideSectionShare, type SectionShareRow, type SectionArea,
  type NestingRequestRow,
  type SpaceProfileRow, type SpaceMemberRow, type SpaceKind,
  type MyRequestState, type PendingRequestRow, type SpaceDirectoryRow,
  cohortInfo,
} from '../lib/spacesApi';
import { supabase } from '../lib/supabase';
import { possessive } from '../lib/names';
import { loadPostsByIds, loadAuthorFeed, postAreas, spaceHasEvents, type FeedPost } from '../lib/postsApi';
import {
  listSpaceResources, createResource, deleteResource, resourceBusy,
  requestResourceBooking, listPendingResourceBookings, decideResourceBooking,
  resourceSpanContact, type ResourceRow, type ResourceBusySpan, type ResourceBookingRow,
} from '../lib/resourcesApi';
import { ensureDirectChat, ensureSpaceChat, ensureSuggestionChat } from '../lib/chatApi';
import DateRangeCalendar, { type DateRange } from '../components/DateRangeCalendar';
import { todayISO } from '../lib/conciergeApi';
import { loadMyWeb, setInWeb, setVouch, loadMyRecommendations, setRecommend } from '../lib/myceliumApi';
import { useNotifications } from '../notifications/NotificationsProvider';
import './Profile.css';
import './SpaceProfile.css';
import './MemberProfile.css';   // shares the mprof action-button styles
import { useConfirm } from '../components/ConfirmDialog';
import ContactFields, { ContactList, type ContactInfo } from '../components/ContactFields';
import PublicPage, { type PageMeta, type FeedRenderCtx } from '../components/PublicPage';
import PageTabsEditor from '../components/PageTabsEditor';
import CollapsibleSection from '../components/CollapsibleSection';
import ContactActionsPicker from '../components/ContactActionsPicker';
import BuildModeSplit, { FillWithClaude } from '../components/BuildModeSplit';
import HomeSummaryButton from '../components/HomeSummaryButton';
import CurrentcyCard from '../components/CurrentcyCard';
import { spacePresentCount, spacePresentList, type PresentMember } from '../lib/presenceApi';

const KIND_LABEL: Record<SpaceKind, string> = {
  organization: 'Organization', community: 'Community', group: 'Group', place: 'Place',
};
// The kind's mark rides beside its word under the name — never in the top bar
// (founder 2026-08-05: the section mark belongs to where you ARE, not to what
// kind of room you're standing in).
const KIND_ICON: Record<SpaceKind, IconName> = {
  organization: 'globe', community: 'user-multiple', group: 'groups', place: 'location',
};
// Which assistant frame a space page briefs from — its own kind.
const ASSISTANT_SECTION: Record<SpaceKind, string> = {
  organization: 'organizations', community: 'communities', group: 'groups', place: 'places',
};
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'super admin', admin: 'admin', member: 'member',
};

/** A space's own profile — organizations, communities, groups, and places get
 *  the same treatment people do. Everyone sees who/what it is; its admins
 *  edit name, story, photo, and location (a picked address pins it on Maps). */
/** Members wears the accordion backstage and stands open on its own tab —
 *  one body, two frames (founder 2026-08-11). */
function MembersShell({ backstage, open, onToggle, sectionRef, children, meta, onAdd }: {
  backstage: boolean;
  open: boolean;
  onToggle: () => void;
  sectionRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  /** "3 members" on the header line; + opens the row and lands you in the
   *  invite box (founder 2026-08-17). */
  meta?: string;
  onAdd?: () => void;
}) {
  if (backstage) {
    return (
      <CollapsibleSection id="members" title="Members" meta={meta} open={open} onToggle={onToggle}
        action={onAdd ? { label: 'Add a member', onClick: onAdd } : undefined}>
        {children}
      </CollapsibleSection>
    );
  }
  return (
    <section className="prof__section" ref={sectionRef as React.RefObject<HTMLElement>}>
      <h2 className="prof__h2">Members</h2>
      {children}
    </section>
  );
}

export default function SpaceProfile({ spaceId, forcePublic }: { spaceId?: string; forcePublic?: boolean } = {}) {
  const { actor, setActor } = useActing();
  const { id: paramId = '' } = useParams();
  const id = spaceId || paramId;
  const navigate = useNavigate();
  const confirmDialog = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const { deskRowsForSpace } = useNotifications();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [space, setSpace] = useState<SpaceProfileRow | null>(null);
  const [members, setMembers] = useState<SpaceMemberRow[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [inWeb, setInWebState] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [recommended, setRecommended] = useState(false);
  const [loading, setLoading] = useState(true);
  const membersRef = useRef<HTMLElement>(null);
  const groupsRef = useRef<HTMLElement>(null);

  // membership machinery (request + approval / admin invites)
  const [myRequest, setMyRequest] = useState<MyRequestState>(null);
  const [pendingReqs, setPendingReqs] = useState<PendingRequestRow[]>([]);
  // Knocks from the public page (founder 2026-08-17: a gateway) — strangers
  // who asked to join THIS space; the steward can send the invitation.
  const [knocks, setKnocks] = useState<SpaceKnock[]>([]);
  const [knockNote, setKnockNote] = useState<Record<string, string>>({});
  const [knockBusy, setKnockBusy] = useState<string | null>(null);
  const [knockErr, setKnockErr] = useState('');
  // Every space nested here (parent_space_id), any kind — split by kind below.
  const [childSpaces, setChildSpaces] = useState<SpaceDirectoryRow[]>([]);
  const childGroups = childSpaces.filter((c) => c.kind === 'group');
  const childPlaces = childSpaces.filter((c) => c.kind === 'place');
  const [memBusy, setMemBusy] = useState(false);
  // admin invite type-ahead
  const [invQ, setInvQ] = useState('');
  const [invHits, setInvHits] = useState<{ id: string; full_name: string | null }[]>([]);
  const invInputRef = useRef<HTMLInputElement | null>(null);
  // + New group (admins of a community/organization)
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  // Places nest too (founder 2026-08-17) — same machinery, admin-created.
  const [newPlaceOpen, setNewPlaceOpen] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState('');
  // "Part of" picker: a group can join (or leave) a community/org home later.
  // Setting a parent you don't admin becomes a PROPOSAL its admins approve.
  const [parentPick, setParentPick] = useState<{ id: string; name: string } | null>(null);
  const [myProposal, setMyProposal] = useState<{ parent_id: string; parentName: string } | null>(null);
  const [proposals, setProposals] = useState<NestingRequestRow[]>([]);
  const [proposeOpen, setProposeOpen] = useState(false);
  const [proposeName, setProposeName] = useState('');
  // the + circle asks WHAT you're adding (Figma 286-14250)
  const [plusOpen, setPlusOpen] = useState(false);
  // super admin's role editor: pick admin/member + the duties they steward
  const [manage, setManage] = useState<{ id: string; name: string } | null>(null);
  // Curated-section shares awaiting stewards (courses/library)
  const [shares, setShares] = useState<SectionShareRow[]>([]);
  const [sharePosts, setSharePosts] = useState<FeedPost[]>([]);
  // Bookable areas & things: the space's bookable resources + the steward
  // queue. Distinct from Goods (marketplace items that change hands) and
  // from Places (a venue's category) — these are LENT and come back.
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [resBookings, setResBookings] = useState<ResourceBookingRow[]>([]);
  const [bookOpen, setBookOpen] = useState<string | null>(null);       // resource id
  const [bookRange, setBookRange] = useState<DateRange>({ start: todayISO(), end: todayISO() });
  const [bookNote, setBookNote] = useState('');
  const [bookBusy, setBookBusy] = useState<ResourceBusySpan[]>([]);
  const [bookMsg, setBookMsg] = useState('');
  const [newResOpen, setNewResOpen] = useState(false);
  const [newResName, setNewResName] = useState('');
  const [newResKind, setNewResKind] = useState<'room' | 'thing'>('room');
  const [newResDesc, setNewResDesc] = useState('');
  const [newResInstant, setNewResInstant] = useState(false);
  const [mAdmin, setMAdmin] = useState(false);
  const [mAll, setMAll] = useState(true);
  const [mDuties, setMDuties] = useState<string[]>([]);
  const [parentQ, setParentQ] = useState('');
  const [parentHits, setParentHits] = useState<{ id: string; name: string; kind: string }[]>([]);

  // edit state (admins)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locText, setLocText] = useState('');
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(null);
  // Public-page facts (founder 2026-07-28): a space's profile IS its website.
  const [contact, setContact] = useState<ContactInfo>({});
  const [publicPage, setPublicPage] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(true);
  const [handle, setHandle] = useState('');
  // Privacy toggles mirroring Profile's own (founder 2026-08-10 profile-
  // features spreadsheet).
  const [findable, setFindable] = useState(true);
  const [assistantReadable, setAssistantReadable] = useState(true);
  const [contentAiDefault, setContentAiDefault] = useState(true);
  const [contentDownloadDefault, setContentDownloadDefault] = useState(true);
  // A community can be identity-based, not just local (founder 2026-08-20) —
  // same governed vocabulary + suggest flow as a member's own Identity field.
  const [idCats, setIdCats] = useState<Category[]>([]);
  const [identityIds, setIdentityIds] = useState<string[]>([]);
  const [identityLegacy, setIdentityLegacy] = useState<string[]>([]);
  // Each backstage section opens inline to edit, then collapses back down
  // (founder 2026-08-10 profile-features spreadsheet — same interaction as
  // Profile's own sections, lifted from the manual-search criteria panel).
  // Backstage opens quiet (founder 2026-08-11: an expanded Public Profile
  // Builder is "info overload") — every section closed, you open what you
  // came for. Deep links like ?manage=1#privacy still open their target.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // The deep-link promise, kept (2026-08-17: the comment above said
  // ?manage=1#about opened its target; nothing ever read the hash, so
  // "Back to manual mode" and "Build the homepage" landed on a closed
  // accordion). Same handler Profile.tsx uses.
  const { hash: sectionHash } = useLocation();
  useEffect(() => {
    if (!sectionHash) return;
    const id = sectionHash.slice(1);
    setOpenSections((s) => (s.has(id) ? s : new Set(s).add(id)));
    let tries = 0;
    const tick = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.clearInterval(tick); }
      if (++tries > 20) window.clearInterval(tick);
    }, 100);
    return () => window.clearInterval(tick);
  }, [sectionHash]);
  const [pageEdit, setPageEdit] = useState<PageMeta>({});
  // Who among THIS layer's members is around (founder 2026-08-06).
  const [present, setPresent] = useState<number | null>(null);
  const [presentWho, setPresentWho] = useState<PresentMember[]>([]);
  // Presence and my relationship with each member — the Members tab is the one
  // place people are listed, so it carries the same gestures the directory has
  // (founder 2026-08-07: "it should allow me to trust and add those members to
  // my mycelium, as well as chat with them, just like the member icon does").
  const [myWebSet, setMyWebSet] = useState<Set<string>>(new Set());
  const [myVouchedSet, setMyVouchedSet] = useState<Set<string>>(new Set());
  // Claude's row (when Claude is a member here) is grayed out until the
  // viewer has actually talked to them.
  const [claudeInUse, setClaudeInUse] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!me) return;
    void hasClaudeFeedActivity(me).then(setClaudeInUse);
  }, [me]);
  const [pageMeta, setPageMeta] = useState<PageMeta>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [retireMode, setRetireMode] = useState<'offline' | 'delete' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const savedHandle = useRef('');
  const [handleFree, setHandleFree] = useState<'idle' | 'checking' | 'free' | 'taken'>('idle');
  const [hueBusy, setHueBusy] = useState(false);
  const [hueProposal, setHueProposal] = useState<{ accent: string | null; raw: string | null; ground: PageSurface } | null>(null);
  const [hueNote, setHueNote] = useState('');
  // View-first: everyone (admins included) lands on the public presentation.
  // ALL admin machinery lives behind ?manage=1 — the "backstage" (founder
  // 2026-07-27: queues and edit tools on the public page are distracting).
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, m, c, mine, recs, req, kids] = await Promise.all([
      loadSpaceProfile(id), loadSpaceMembers(id), loadSpaceChatId(id),
      me ? loadMyWeb() : Promise.resolve({ web: new Set<string>(), vouched: new Set<string>() }),
      me ? loadMyRecommendations() : Promise.resolve(new Set<string>()),
      me ? loadMyRequestFor(id, me) : Promise.resolve(null as MyRequestState),
      listChildGroups(id),
    ]);
    setMyProposal(s?.kind === 'group' ? await loadNestingFor(id) : null);
    setResources(await listSpaceResources(id));
    setSpace(s);
    setMembers(m);
    setChatId(c);
    setMyRequest(req);
    setChildSpaces(kids);
    setInWebState(mine.web.has(`space:${id}`));
    setMyWebSet(mine.web);
    setMyVouchedSet(mine.vouched);
    setTrusted(mine.vouched.has(`space:${id}`));
    setRecommended(recs.has(`space:${id}`));
    if (s) {
      setName(s.name);
      setHandle(s.handle ?? '');
      savedHandle.current = (s.handle ?? '').toLowerCase();
      setParentPick(s.parent);
      setDescription(s.description ?? '');
      setLocText(s.location ?? '');
      setLocGeo(s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
      const sx = s as unknown as { contact?: ContactInfo | null; public_page?: boolean };
      setContact(sx.contact ?? {});
      setPublicPage(sx.public_page !== false);
      setAiEnabled((sx as { assistant_enabled?: boolean }).assistant_enabled !== false);
      setFindable(s.findable !== false);
      setAssistantReadable(s.assistant_readable !== false);
      setContentAiDefault(s.content_ai_default !== false);
      setContentDownloadDefault(s.content_download_default !== false);
      setPageEdit(((sx as { page?: PageMeta }).page ?? {}) as PageMeta);
      setPageMeta(((s as unknown as { page?: PageMeta | null }).page) ?? {});
      if (s.kind === 'community') {
        // Identity vocabulary — names stored on the row map onto picker ids;
        // anything unmatched stays as a legacy chip, never silently dropped.
        const { data: cats } = await supabase.from('categories')
          .select('*').eq('domain', 'identity').order('name');
        const pool = ((cats as Category[] | null) ?? []);
        setIdCats(pool);
        const byName = new Map(pool.map((c) => [c.name.trim().toLowerCase(), c.id]));
        const ids: string[] = []; const legacy: string[] = [];
        for (const t of s.identity_tags ?? []) {
          const cid = byName.get(t.trim().toLowerCase());
          if (cid) { if (!ids.includes(cid)) ids.push(cid); }
          else legacy.push(t);
        }
        setIdentityIds(ids); setIdentityLegacy(legacy);
      }
    }
    setLoading(false);
  }, [id, me]);
  useEffect(() => { load(); }, [load]);

  // De-branding (founder 2026-07-30): this profile's mark takes the top bar.
  useEffect(() => {
    if (!space) return;
    setTopIdentity({ id: space.id, name: space.name, avatarUrl: space.avatar_url, kind: 'space' });
    return () => setTopIdentity(null);
  }, [space]);

  async function toggleWeb() {
    if (!me) return;
    const next = !inWeb;
    setInWebState(next);                      // optimistic
    if (!next && trusted) setTrusted(false);  // leaving the web withdraws the vouch
    try { await setInWeb('space', id, next); }
    catch (e) { console.error(e); setInWebState(!next); }
  }

  async function toggleRecommend() {
    if (!me) return;
    const next = !recommended;
    setRecommended(next);
    try { await setRecommend('space', id, next); } catch (e) { console.error(e); setRecommended(!next); }
  }

  async function decideShare(r: SectionShareRow, approve: boolean, promote = false) {
    await decideSectionShare(id, r.post_id, r.area as SectionArea, approve);
    if (approve && promote) {
      // Course-provider on-ramp: grant the sharer this section's duty.
      const m = members.find((x) => x.profile_id === r.requested_by);
      if (m && m.role !== 'super_admin' && !(m.role === 'admin' && m.duties === null)) {
        const duty = r.area === 'courses' ? 'courses' : 'library';
        const duties = m.role === 'admin'
          ? [...new Set([...(m.duties ?? []), duty])]
          : [duty];
        await setMemberRole(id, r.requested_by, 'admin', duties);
      }
    }
    setShares((cur) => cur.filter((x) => !(x.post_id === r.post_id && x.area === r.area)));
    if (approve) await load();
  }

  async function openBooking(r: ResourceRow) {
    if (bookOpen === r.id) { setBookOpen(null); return; }
    setBookOpen(r.id); setBookMsg(''); setBookNote('');
    setBookRange({ start: todayISO(), end: todayISO() });
    setBookBusy(await resourceBusy(r.id));
  }
  async function sendBooking(r: ResourceRow) {
    if (!bookRange.start) return;
    try {
      await requestResourceBooking(r.id, bookRange.start, bookRange.end ?? bookRange.start, bookNote);
      setBookMsg(r.approval === 'instant' ? 'Booked — it\u2019s on your calendar.' : 'Asked — the steward will confirm.');
    } catch (e) { setBookMsg((e as Error).message); }
  }
  async function messageHolder(r: ResourceRow, date: string) {
    const who = await resourceSpanContact(r.id, date);
    if (who) navigate(`/chat/${await ensureDirectChat(who)}`);
  }

  const myRow = members.find((m) => m.profile_id === me);
  const myRole = myRow?.role;
  const isMember = !!myRole;

  useEffect(() => {
    if (!id || !isMember) { setPresent(null); return; }
    let live = true;
    void spacePresentCount(id).then((n) => { if (live) setPresent(n); });
    return () => { live = false; };
  }, [id, isMember]);
  const isAdmin = myRole === 'admin' || myRole === 'super_admin';
  const backstage = isAdmin && searchParams.get('manage') === '1';
  // Members and Groups open as their own views rather than scrolling the feed
  // to its bottom (founder 2026-07-28: "a directory tab, for consistency").
  const tab = searchParams.get('tab');
  // The space's own gatherings — what's coming up, then what's past.
  const [spaceEvents, setSpaceEvents] = useState<FeedPost[]>([]);
  // A door only appears once the space walks through it (founder 2026-08-07).
  const [hasEvents, setHasEvents] = useState(false);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void spaceHasEvents(id).then((yes) => { if (live) setHasEvents(yes); });
    return () => { live = false; };
  }, [id]);
  // THE COURSE THIS GROUP IS A COHORT OF (founder 2026-08-15: "the Course
  // created the cohort, but the Group has a course assigned to it") — the
  // `cohort_of` FK already lives on the space, so the door is just reading
  // it. The course side has had a Cohort door all along; this makes the
  // toggle go both ways.
  const [ofCourse, setOfCourse] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (!id) { setOfCourse(null); return; }
    let live = true;
    void cohortInfo(id).then(async (info) => {
      if (!live || !info) { if (live) setOfCourse(null); return; }
      const { data } = await supabase.from('collections').select('name').eq('id', info.courseId).maybeSingle();
      if (live) setOfCourse({ id: info.courseId, name: (data as { name: string } | null)?.name ?? 'the course' });
    });
    return () => { live = false; };
  }, [id]);
  // Who's present, ready for the Members tab to sort by.
  useEffect(() => {
    if (!id || !isMember) return;
    let live = true;
    void spacePresentList(id).then((rows) => { if (live) setPresentWho(rows); });
    return () => { live = false; };
  }, [id, isMember, present]);
  useEffect(() => {
    if (tab !== 'events' || !id) return;
    let live = true;
    void loadAuthorFeed({ spaceId: id }).then((rows) => {
      if (live) setSpaceEvents(rows.filter((p) => postAreas(p).includes('events') && p.linked_event));
    });
    return () => { live = false; };
  }, [tab, id]);
  const openTab = (t: string) => setSearchParams(t ? { tab: t } : {});
  const adminTools = backstage;
  // Scoped stewardship: membership machinery (approve/invite/endorse) belongs
  // to admins holding the 'members' duty; full admins hold everything.
  const memberTools = holdsDuty(myRole, myRow?.duties, 'members') && backstage;
  const sharesForMe = shares.filter((r) => holdsDuty(myRole, myRow?.duties, r.area));
  // What's waiting on this admin — the Manage button wears it as a badge.
  // Only what's OURS to decide: invites awaiting the invitee don't badge.
  const actionableReqs = pendingReqs.filter((r) => {
    if (r.initiated_by === r.profile_id) return true;      // join request
    const initRole = members.find((m) => m.profile_id === r.initiated_by)?.role;
    return !(initRole === 'admin' || initRole === 'super_admin'); // suggestion
  });
  const deskCount = sharesForMe.length
    + (holdsDuty(myRole, myRow?.duties, 'members') ? actionableReqs.length : 0)
    + proposals.length + resBookings.length;

  useEffect(() => {
    if (!isAdmin) { setPendingReqs([]); setProposals([]); return; }
    let live = true;
    (async () => {
      const [rows, props, shr, rbk, kn] = await Promise.all([
        listPendingRequests(id),
        (space?.kind === 'community' || space?.kind === 'organization')
          ? listNestingProposals(id) : Promise.resolve([]),
        listPendingSectionShares(id),
        listPendingResourceBookings(id),
        listSpaceKnocks(id),
      ]);
      const shrPosts = shr.length ? await loadPostsByIds(shr.map((r) => r.post_id)) : [];
      if (live) { setPendingReqs(rows); setProposals(props); setShares(shr); setSharePosts(shrPosts); setResBookings(rbk); setKnocks(kn); }
    })();
    return () => { live = false; };
  }, [id, isAdmin, members.length, space?.kind]);

  // admin invite type-ahead (members + already-pending filtered out)
  useEffect(() => {
    const q = invQ.trim();
    if (q.length < 2) { setInvHits([]); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name').ilike('full_name', `%${q}%`)
        .eq('findable', true).limit(8);   // inviting a stranger is discovery
      if (!live) return;
      const taken = new Set([
        ...members.map((m) => m.profile_id),
        ...pendingReqs.map((r) => r.profile_id),
      ]);
      setInvHits((((data as { id: string; full_name: string | null }[] | null) ?? [])
        .filter((h) => !taken.has(h.id)).slice(0, 5)));
    })();
    return () => { live = false; };
  }, [invQ, members, pendingReqs]);

  // "Part of" type-ahead: communities + organizations a group could call home.
  useEffect(() => {
    const q = parentQ.trim();
    if (q.length < 2) { setParentHits([]); return; }
    let live = true;
    (async () => {
      const { data } = await supabase.from('spaces')
        .select('id, name, kind')
        .in('kind', ['community', 'organization'])
        .neq('id', id)
        .ilike('name', `%${q}%`)
        .limit(5);
      if (live) setParentHits(((data as { id: string; name: string; kind: string }[] | null) ?? []));
    })();
    return () => { live = false; };
  }, [parentQ, id]);

  async function act(fn: () => Promise<void>) {
    setMemBusy(true); setError('');
    try { await fn(); await load(); }
    catch (e) { setError((e as Error)?.message || 'Something went wrong.'); }
    setMemBusy(false);
  }

  const onMembershipTap = async () => {
    if (isMember) {
      if (myRole === 'super_admin') return;   // owners can't leave their own space
      if (await confirmDialog({ message: `Leave ${space?.name ?? 'this space'}? You'll also leave its chat.`, confirmLabel: 'Leave', danger: true })) {
        void act(() => leaveSpace(id, me));
      }
    } else if (myRequest === 'requested') {
      void act(() => removeRequest(id, me));
    } else if (!myRequest) {
      void act(() => requestToJoin(id, me));
    }
  };

  async function createChildGroup() {
    const nm = newGroupName.trim();
    if (!nm) return;
    setMemBusy(true); setError('');
    try {
      const gid = await createSpaceWithLocation(me, nm, 'group', '', null, id);
      navigate(`/spaces/${gid}`);
    } catch (e) {
      setError((e as Error)?.message || 'Could not create the group.');
      setMemBusy(false);
    }
  }
  async function createChildPlace() {
    const nm = newPlaceName.trim();
    if (!nm) return;
    setMemBusy(true); setError('');
    try {
      const pid = await createSpaceWithLocation(me, nm, 'place', '', null, id);
      navigate(`/spaces/${pid}`);
    } catch (e) {
      setError((e as Error)?.message || 'Could not create the place.');
      setMemBusy(false);
    }
  }

  /** Anyone can PROPOSE a group: it's created standalone (theirs to run) and
   *  a nesting proposal goes to this community's admins. */
  async function proposeNewGroup() {
    const nm = proposeName.trim();
    if (!nm) return;
    setMemBusy(true); setError('');
    try {
      const gid = await createSpaceWithLocation(me, nm, 'group', '', null, null);
      await proposeNesting(gid, id, me);
      navigate(`/spaces/${gid}`);
    } catch (e) {
      setError((e as Error)?.message || 'Could not propose the group.');
      setMemBusy(false);
    }
  }

  async function onAvatarFile(file: File | undefined) {
    if (!file || !me || !space) return;
    setAvatarBusy(true); setError('');
    try {
      const url = await uploadSpaceAvatar(me, space.id, file);
      await updateSpaceProfile(space.id, { avatar_url: url });
      setSpace((s) => (s ? { ...s, avatar_url: url } : s));
    } catch (e) {
      setError((e as { message?: string } | null)?.message || 'Could not upload that photo.');
    }
    setAvatarBusy(false);
  }

  // IS THIS ADDRESS TAKEN (founder 2026-08-28: "is the page smart enough to
  // know if a url is taken and to say 'this is taken'?"). It was not. Worse:
  // the handle write is part of a single .update() whose result was never
  // checked, so a collision silently discarded the WHOLE save — colours,
  // contact, everything in that call — while the form said it had saved.
  //
  // Checks BOTH tables. The DB has a unique index per table, but a space and
  // a person can each hold the same handle, and SpaceByHandle resolves spaces
  // first — so the person's page would just quietly stop being reachable.
  useEffect(() => {
    const h = handle.trim().toLowerCase();
    if (!h || h === savedHandle.current || !/^[a-z0-9-]+$/.test(h)) { setHandleFree('idle'); return; }
    setHandleFree('checking');
    let live = true;
    const t = setTimeout(async () => {
      const [sp, pr] = await Promise.all([
        supabase.from('spaces').select('id').eq('handle', h).maybeSingle(),
        supabase.from('profiles').select('id').eq('handle', h).maybeSingle(),
      ]);
      if (!live) return;
      const bySpace = sp.data ? (sp.data as { id: string }).id !== id : false;
      setHandleFree(bySpace || !!pr.data ? 'taken' : 'free');
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [handle, id]);

  async function save() {
    if (!space) return;
    setSaving(true); setMsg(''); setError('');
    try {
      let note = 'Saved';
      const patch: Parameters<typeof updateSpaceProfile>[1] = {
        name: name.trim() || space.name,
        description: description.trim() || null,
        location: locText.trim() || null,
        lat: locGeo?.lat ?? null,
        lng: locGeo?.lng ?? null,
      };
      // Public-page facts ride the same Save (harmless if the columns are new).
      const { error: spaceErr } = await supabase.from('spaces')
        .update({
          handle: handle.trim() || null,
          contact: Object.keys(contact).length ? contact : null,
          public_page: publicPage,
          assistant_enabled: aiEnabled,
          findable,
          assistant_readable: assistantReadable,
          content_ai_default: contentAiDefault,
          content_download_default: contentDownloadDefault,
          // Only ever WRITE a page, never null one out: this form didn't touch
          // `page` before today, and a mis-seeded save would wipe a built page
          // (Countryman Stables lives in this column).
          ...(Object.keys(pageEdit).length ? { page: pageEdit } : {}),
          ...(space.kind === 'community' ? {
            identity_tags: (() => {
              const names = new Map(idCats.map((c) => [c.id, c.name]));
              const all = [
                ...identityIds.map((cid) => names.get(cid)).filter((n): n is string => !!n),
                ...identityLegacy,
              ];
              return all.length ? all : null;
            })(),
          } : {}),
        })
        .eq('id', id);
      // A unique-violation here used to be swallowed whole (founder
      // 2026-08-28). Everything in this update travels together, so a taken
      // address loses the colours and the contact details with it.
      if (spaceErr) {
        throw new Error(
          spaceErr.code === '23505'
            ? `lichen.health/${handle.trim()} is already taken — pick another address. Nothing was saved.`
            : (spaceErr.message || 'Could not save. Please try again.'),
        );
      }
      if (space.kind === 'group' && (parentPick?.id ?? null) !== (space.parent?.id ?? null)) {
        if (!parentPick) {
          patch.parent_space_id = null;   // going standalone is always the group's right
        } else if (await amIAdminOf(parentPick.id, me)) {
          patch.parent_space_id = parentPick.id;
        } else {
          // Consensual nesting: their admins decide.
          await proposeNesting(space.id, parentPick.id, me);
          note = `Proposed — waiting for ${parentPick.name}'s admins`;
        }
      }
      await updateSpaceProfile(space.id, patch);
      setMsg(note);
      setTimeout(() => setMsg(''), 2000);
      await load();
    } catch (e) {
      setError((e as Error)?.message || 'Could not save. Please try again.');
    }
    setSaving(false);
  }

  if (loading) return <div className="prof"><p className="sprof__muted">Loading…</p></div>;
  if (!space) {
    // Signed-out arrivals (e.g. a notification email opened in a fresh
    // browser) get the door, with the destination remembered through login.
    return (
      <div className="prof">
        {!me ? (
          <div className="sprof__signin">
            <p className="sprof__muted">Sign in to see this page.</p>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/login?next=${encodeURIComponent(location.pathname)}`)}
            >
              Sign in
            </button>
          </div>
        ) : (
          <p className="sprof__muted">This page isn&rsquo;t available.</p>
        )}
      </div>
    );
  }

  const kindLabel = KIND_LABEL[space.kind];
  const pinned = space.lat != null && space.lng != null;

  // Member-facing controls, hoisted so both the rich page template (the
  // default signed-in view, below) and the backstage/tab views (further
  // down) can render the SAME markup rather than duplicating it (founder
  // 2026-08-03 — "show members the page template too").
  const noticeBanners = (
    <>
      {error && <p className="prof__error">{error}</p>}
      {myRequest === 'invited' && !backstage && (
        <div className="sprof__invite">
          <span>You&rsquo;re invited to join {space.name}.</span>
          <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
            onClick={() => void act(() => acceptInvite(id))}>Accept</button>
          <button className="btn sprof__invite-btn" disabled={memBusy}
            onClick={() => void act(() => removeRequest(id, me))}>Decline</button>
        </div>
      )}
    </>
  );
  const actionRow = me && !backstage && (
    <div className="mprof__actions mprof__actions--signals">
      {myRequest !== 'invited' && (
        <button
          className={'btn mprof__btn mprof__btn--trust' + (isMember || myRequest === 'requested' ? ' is-on' : '')}
          onClick={onMembershipTap}
          disabled={memBusy}
          title={isMember
            ? (myRole === 'super_admin' ? 'You run this space' : 'Member — tap to leave')
            : myRequest === 'requested' ? 'Waiting for an admin — tap to cancel'
            : 'Ask the admins to let you in'}
        >
          <Icon name={isMember ? 'check' : 'plus'} size={14} />{' '}
          {isMember ? 'Member ✓' : myRequest === 'requested' ? 'Requested ✓' : 'Request to join'}
        </button>
      )}
      <button
        className={'btn mprof__btn mprof__btn--trust' + (inWeb ? ' is-on' : '')}
        onClick={toggleWeb}
        title={inWeb ? 'In your my-celium — its doings flow to you' : 'Weave it into your my-celium (no trust implied)'}
      >
        <Icon name="user-multiple" size={14} /> {inWeb ? 'In your My-celium ✓' : 'Add to My-celium'}
      </button>
      {/* NO TRUST ON A SPACE (founder 2026-08-07: "you can trust a person, but
          recommend an org, group or community... shouldn't trust not be an
          option for them?"). Trust is the private signal between people;
          an organisation is something you vouch FOR, in public, which is
          exactly recommend. This supersedes the both-on-everything rule from
          PR #77 — existing space vouches stay in the data, they just can't be
          made or unmade here any more. */}
      <button
        className={'btn mprof__btn mprof__btn--trust' + (recommended ? ' is-on' : '')}
        onClick={toggleRecommend}
        title={recommended ? 'Recommended to those who trust you' : 'Recommend to those who trust you'}
      >
        <Icon name="thumbs-up" size={14} /> {recommended ? 'Recommended ✓' : 'Recommend'}
      </button>
    </div>
  );
  const plusMenu = plusOpen && !backstage && (
    <div className="sprof__plus">
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}`)}>
        <Icon name="sparkle" size={14} /> Post to {space.name}
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=marketplace`)}>
        <Icon name="store" size={14} /> Marketplace listing
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=events`)}>
        <Icon name="rsvp" size={14} /> Event
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=courses`)}>
        <Icon name="graduation-cap" size={14} /> Course or training
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=library`)}>
        <Icon name="book" size={14} /> Library piece
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=work`)}>
        <Icon name="briefcase" size={14} /> Work — help wanted or offered
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=food`)}>
        <Icon name="fork-spoon" size={14} /> Food
      </button>
      <button className="sprof__plus-row" onClick={() => navigate(`/compose?space=${space.id}&area=art`)}>
        <Icon name="palette" size={14} /> Art
      </button>
      {(space.kind === 'community' || space.kind === 'organization') && me && (
        isAdmin ? (
          <button
            className="sprof__plus-row"
            onClick={() => {
              // Creation is admin work — it happens backstage.
              setPlusOpen(false); setNewGroupOpen(true); setSearchParams({ manage: '1' });
              setTimeout(() => groupsRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
            }}
          >
            <Icon name="user-multiple" size={14} /> New group
          </button>
        ) : (
          <button
            className="sprof__plus-row"
            onClick={() => {
              setPlusOpen(false); setProposeOpen(true);
              setTimeout(() => groupsRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
            }}
          >
            <Icon name="user-multiple" size={14} /> Propose a group
          </button>
        )
      )}
    </div>
  );
  // The profile IS a feed — the space's wall (posted AS it or TO it), with
  // the space-anatomy circles (Chat for members, Members) leading the icon
  // row. Identical for all four kinds. Render-function form (founder
  // 2026-08-11): the Feed door rides the icon row, lit when the feed is the
  // active tab, and the row stays up on template tabs as the way back.
  const feedSection = (ctx: FeedRenderCtx) => (
    <ContributionsFeed
      spaceId={space.id}
      me={me}
      entityName={space.name}
      // The open web gets the stream, not the workshop (founder
      // 2026-08-11) — member tools drop away for a guest (or the steward
      // previewing as one).
      leading={ctx.guest ? [] : [
        // Every section carries its own doors: + posts INTO this space,
        // Search searches WITHIN it (Figma 286-11770). Search-then-+ mirrors
        // Home's icon row (founder 2026-07-25 — one order everywhere).
        { icon: 'search' as const, label: 'Search', onClick: () => navigate(`/search?space=${space.id}`) },
        { icon: 'plus' as const, label: 'Add', onClick: () => setPlusOpen((o) => !o) },
      ]}
      // The brain closes the acting-doors group, just before the hairline
      // (founder 2026-08-05) — quiet when this section's consent is off.
      assistantSection={ctx.guest ? undefined : ASSISTANT_SECTION[space.kind]}
      // The brain briefs THIS space, not the whole section (founder
      // 2026-08-22: "Your organizations" from Countryman Stables' own page).
      assistantSpace={ctx.guest ? undefined : space.id}
      assistantOff={space.assistant_enabled === false}
      // …and the space's own rooms open the group after it.
      afterGap={ctx.guest ? []
        : [
          ...(chatId ? [{ icon: 'chat' as const, label: 'Chat', onClick: () => navigate(`/chat/${chatId}`) }]
            // Not a member: a MESSAGE door to the space itself (founder 2026-08-17:
            // a space can be a chat party) — the general thread, any admin replies.
            : me && !isAdmin ? [{ icon: 'chat' as const, label: 'Message', onClick: () => {
                void ensureSpaceChat(space.id).then((cid) => navigate(`/chat/${cid}`))
                  .catch((e: Error) => alert(e.message));
              } }]
            : []),
          // SUGGEST (founder 2026-08-22): any signed-in non-steward can open
          // their suggestions room for this page — them, the stewards, and
          // Claude, "different than a help chat, but similar".
          ...(me && !isAdmin ? [{ icon: 'sparkle' as const, label: 'Suggest', onClick: () => {
              void ensureSuggestionChat(space.id).then((cid) => navigate(`/chat/${cid}`))
                .catch((e: Error) => alert(e.message));
            } }] : []),
        ]}
      trailing={ctx.guest ? [] : [
        // The founder's Marketplace-icon analogy: a Groups door appears only
        // when this space actually has groups nested under it.
        // A cohort's way back to what it's a cohort OF.
        ...(ofCourse
          ? [{ icon: 'graduation-cap' as const, label: 'Course',
               onClick: () => navigate(`/collections/${ofCourse.id}`) }]
          : []),
        ...(childGroups.length > 0
          ? [{ icon: 'groups' as const, label: 'Groups', onClick: () => openTab('groups') }]
          : []),
        // Members closes the row — the space's Directory, far right like
        // Home's (founder 2026-07-25).
        // Same rule as Groups above: no gatherings yet, no Events door. An
        // icon that opens an empty room teaches the space is broken, not empty.
        ...(hasEvents
          ? [{ icon: 'rsvp' as const, label: 'Events', onClick: () => openTab('events') }]
          : []),
        // Pinned on the map? Then Places is one of this space's rooms, and it
        // earns a door like any other (founder 2026-08-15) — no separate CTA.
        ...(pinned
          ? [{ icon: 'location' as const, label: 'Place', onClick: () => navigate(`/maps?space=${space.id}`) }]
          : []),
        { icon: 'member-heart' as const, label: 'Members', onClick: () => openTab('members') },
      ]}
      // The Events door below opens the real gatherings list — an
      // events-only feed lens beside it was the same circle twice.
      hideAreas={hasEvents ? ['events'] : []}
      feedDoor={{ here: ctx.showing, onClick: ctx.open }}
      navSlot={ctx.navSlot}
      signals={ctx.guest ? undefined : actionRow}
      // Honest escape (founder 2026-08-17): a homepage with something on it,
      // or — for a steward — the builder; a visitor to a bare page gets
      // ScopeEmpty's own door to Lichen's feed instead of an empty room.
      emptyEscape={ctx.openHome
        ? { label: 'Visit the homepage to engage', onGo: ctx.openHome }
        : ctx.homeBare && isAdmin
          ? { label: `Build ${possessive(space.name)} homepage`, onGo: () => navigate(`/spaces/${id}?manage=1#about`) }
          : undefined}
      listHidden={!ctx.showing}
      interactive={!ctx.guest}
    />
  );
  const roomsSection = !backstage && resources.length > 0 && (
    <section className="prof__section">
      <h2 className="prof__h2">Bookable areas &amp; things</h2>
      <div className="sprof__members">
        {resources.map((r) => (
          <div className="sprof__resource" key={r.id}>
            <div className="sprof__grouprow">
              <span className="sprof__res-main">
                <Icon name={r.kind === 'room' ? 'location' : 'store'} size={16} />
                <span className="sprof__res-name">{r.name}</span>
                {r.description && <span className="sprof__res-desc">{r.description}</span>}
              </span>
              {r.bookable && me && (
                <button className="btn sprof__invite-btn" onClick={() => void openBooking(r)}>
                  {bookOpen === r.id ? 'Close' : r.approval === 'instant' ? 'Book' : 'Request'}
                </button>
              )}
            </div>
            {bookOpen === r.id && (
              <div className="sprof__res-book">
                {bookBusy.length > 0 && (
                  <p className="prof__hint">
                    Booked:{' '}
                    {bookBusy.slice(0, 6).map((b, i) => (
                      <button
                        key={i}
                        className="sprof__res-busy"
                        title="Message whoever holds these dates — they may be open to another time"
                        onClick={() => void messageHolder(r, b.start_date)}
                      >
                        {b.start_date === b.end_date ? b.start_date : `${b.start_date} – ${b.end_date}`}
                      </button>
                    ))}
                  </p>
                )}
                <DateRangeCalendar value={bookRange} onChange={setBookRange} />
                <input
                  className="prof__input"
                  value={bookNote}
                  onChange={(e) => setBookNote(e.target.value)}
                  placeholder="What for? (optional — helps the steward say yes)"
                />
                <div className="sprof__rolepills">
                  <button className="btn btn-primary sprof__invite-btn" onClick={() => void sendBooking(r)}>
                    {r.approval === 'instant' ? 'Book it' : 'Ask for these dates'}
                  </button>
                  {bookMsg && <span className="prof__msg">{bookMsg}</span>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );

  // The open web (and the owner previewing) sees the shared page template —
  // one structure across every Lichen site (founder 2026-07-28). Widened
  // 2026-08-03 to be the DEFAULT signed-in landing view too — the rich page
  // members see is the same one guests see, with their own controls above
  // riding along as children. Backstage (?manage=1) and any ?tab= subview
  // keep the familiar plain shell, unchanged, further down.
  const previewing = searchParams.get('preview') === '1';
  // forcePublic: on a custom domain (countrymanstables.com) EVERYONE gets
  // the website — even signed-in members; the app lives on Lichen's domain.
  const showTemplate = !me || previewing || forcePublic || (!backstage && !tab);
  // The way into backstage has to exist on the page an admin actually lands
  // on (founder 2026-08-06: "I don't see the admin versus public view, so I'm
  // not sure where to edit the page"). It lived only in the non-template
  // shell, which a signed-in admin never reaches.
  const presenceLine = isMember && present !== null ? (
    <div className="sprof__presence">
      <button className="sprof__presence-line" onClick={() => openTab('members')}>
        {present === 0
          ? `${space.name} is out living.`
          : present === 1
            ? `One in ${space.name} is present.`
            : `${present} in ${space.name} are present.`}
        {present > 0 && <Icon name="chevron-right" size={13} />}
      </button>
    </div>
  ) : null;

  // THE TOGGLE *IS* THE IDENTITY SWITCH (founder 2026-08-07: "it will show you
  // admin view for any space you're an admin of, even if logged in to another.
  // But when you click admin view, it will switch you to that account").
  //
  // Better than hiding it, which was the first attempt: you keep the reminder
  // that you steward this place, and taking the controls is what changes who
  // you are — rather than a rule you have to remember before you arrive.
  //
  // It also keeps authorship honest. Acting-as already decides who a post is
  // BY (Compose reads the actor, not the space you post into), so anything
  // published while managing goes out in the space's voice, which is what you
  // meant. The pair is symmetric: Member view hands you back to yourself, so
  // nobody wanders off still speaking as the organisation.
  const actingAsThis = actor.type === 'space' && actor.id === space.id;
  const beThisSpace = () =>
    setActor({ type: 'space', id: space.id, name: space.name, kind: space.kind });
  const beMyself = () => { if (actingAsThis) setActor({ type: 'self' }); };
  // The same three-way every profile wears now (founder 2026-08-11):
  // Admin manages, Lichen View is the internal experience, Public View is
  // the website layer (?preview=1 renders the open-web template).
  const adminBar = isAdmin ? (
    <div className="view-toggle-row">
      {/* No visible subject label (founder 2026-08-22, same day it shipped:
          it squeezed the toggle off the column) — the acting chip's real
          logo and the hat-following platform carry whose views these are;
          the aria-label still names it for screen readers. */}
      <span className="view-toggle" role="group" aria-label={`Views of ${space.name}`}>
        <button
          className={'view-toggle__side view-toggle__side--admin' + (backstage ? ' is-on' : '')}
          onClick={() => { beThisSpace(); setSearchParams({ manage: '1' }); }}
        >
          Admin
          {deskCount > 0 && <span className="view-toggle__badge">{deskCount}</span>}
        </button>
        <button
          className={'view-toggle__side' + (!backstage && !previewing ? ' is-on' : '')}
          onClick={() => { beMyself(); setSearchParams({}); }}
        >
          Lichen View
        </button>
        <button
          className={'view-toggle__side' + (!backstage && previewing ? ' is-on' : '')}
          onClick={() => { beMyself(); setSearchParams({ preview: '1' }); }}
        >
          Public View
        </button>
      </span>
    </div>
  ) : null;

  if (showTemplate) {
    return (
      <PublicPage
        id={space.id}
        name={space.name}
        firstPerson
        kindLabel={kindLabel}
        kindIcon={KIND_ICON[space.kind]}
        avatarUrl={space.avatar_url}
        description={space.description}
        location={space.location}
        contact={contact}
        page={pageMeta}
        preview={previewing}
        signedIn={!!me}
        // A space's page is a gateway into Lichen (founder 2026-08-17): a
        // signed-out visitor knocks right here, and the knock names us.
        knockSpace={{ id: space.id, name: space.name, kindLabel }}
        // Actions in ONE place (founder 2026-08-14): the maps door sits
        // beside the page's own CTAs instead of floating at the page's foot.
        // The steward's switch sits above the masthead, so a page with a big
        // cover image doesn't bury the way to manage it.
        aboveHero={adminBar}
        // Your relationship with this place sits in the masthead — a tall
        // cover photo used to bury it (founder 2026-08-07).
        // Member ✓ / My-celium ✓ / Recommended ✓ are Lichen relationships,
        // not website furniture — Public View is what the open web sees, so
        // they step out of it (founder 2026-08-11).
        beforeContent={me ? (
          <>
            {/* Join / my-celium / trust ride ABOVE the page, not below every
                section of it (founder 2026-08-06: "it gets pushed to the
                bottom... seems important enough to keep at the top").
                NOT in Public View (founder 2026-08-21: presence leaked onto
                the website preview) — same rule as the relationship signals:
                member chrome steps out of what the open web sees. */}
            {!backstage && !tab && !previewing && !forcePublic && (
              <>
                {noticeBanners}
                {presenceLine}
              </>
            )}
          </>
        ) : undefined}
        // The feed, selected by default — parity with MemberProfile.tsx.
        // The function form puts the Feed door in the icon row itself
        // (founder 2026-08-11), so the nav stays all-text template tabs.
        feed={!backstage && !tab ? feedSection : undefined}
      >
        {/* PublicPage's `children` slot renders unconditionally regardless of
            which tab is active (it doesn't gate on `tab` at all) — so this
            content, which belongs to the space's own home view, needs its
            own `!backstage && !tab` guard, same as `feed`/`beforeContent`
            above, or it leaks onto every template tab (About, Services…). */}
        {!backstage && !tab && childGroups.length > 0 && (
          <section className="ppage__sec">
            <h2 className="ppage__h2">Groups</h2>
            <div className="ppage__chips">
              {childGroups.map((g) => <span className="ppage__chip" key={g.id}>{g.name}</span>)}
            </div>
          </section>
        )}
        {me && !backstage && !tab && (
          <>
            {plusMenu}
            {roomsSection}
          </>
        )}
      </PublicPage>
    );
  }

  return (
    <div className={'prof is-space' + (backstage ? ' is-adminview' : '')}>
      {adminBar}
      <div className="prof__head">
        <div className="sprof__avatar-wrap">
          {space.avatar_url ? (
            <img className="sprof__avatar-img" src={space.avatar_url} alt="" />
          ) : (
            <span className="sprof__avatar-mono" style={{ background: colorFor(space.id) }}>
              {monogramFor(space.name)}
            </span>
          )}
          {adminTools && openSections.has('about') && (
            <button
              className="sprof__avatar-edit"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              aria-label={`Change ${space.name}'s photo`}
            >
              <Icon name="image" size={13} />
            </button>
          )}
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => { onAvatarFile(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
        <h1 className="prof__name">{space.name}</h1>
        <p className="sprof__kind">
          {kindLabel}
          <Icon name={KIND_ICON[space.kind]} size={15} />
          {space.parent && (
            <>
              {' · '}
              <Link className="sprof__parent" to={`/spaces/${space.parent.id}`}>
                part of {space.parent.name}
              </Link>
            </>
          )}
          {!space.parent && myProposal && isAdmin && (
            <> · proposed to {myProposal.parentName}</>
          )}
        </p>
        {space.description && <p className="sprof__desc">{space.description}</p>}
        {!backstage && <ContactList contact={contact} />}
        {space.location && (
          <p className="sprof__loc">
            <SmartLocation loc={space.location} className="sprof__loc-link" />
            {pinned && (
              <Link className="sprof__onmap" to="/maps">On the map ✓</Link>
            )}
          </p>
        )}
        {!me && (
          <div className="sprof__guest">
            <p className="sprof__guest-lead">
              This page lives on <strong>Lichen</strong> — a member-run network for care,
              work and a fairer economy.
            </p>
            <p className="sprof__guest-sub">
              To recommend {space.name}, book a time, message them, or join their events,
              you&rsquo;ll need a Lichen account. Lichen grows by invitation — introduce
              yourself and a real person writes back.
            </p>
            <div className="sprof__guest-acts">
              <button className="btn btn-primary" onClick={() => navigate('/signup')}>
                Request an invitation
              </button>
              <button className="btn" onClick={() => navigate('/about')}>What is Lichen?</button>
            </div>
            <p className="sprof__guest-sub">
              Already a member?{' '}
              <button className="prof__inline-link" onClick={() => navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`)}>
                Sign in
              </button>
            </p>
          </div>
        )}
        {actionRow}
      </div>

      {noticeBanners}

      {adminTools && (
        <CollapsibleSection id="about" title="Public Profile Builder" open={openSections.has('about')} onToggle={() => toggleSection('about')}>
          <BuildModeSplit back={`/spaces/${id}?manage=1#about`} space={{ id: space.id, name: space.name }} />
          <div className="prof__field">
            <label className="prof__label">Name</label>
            <input className="prof__input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {/* Home's welcome + cover moved into the Home row's Style panel in
              the tabs list below (founder 2026-08-22: "the cover photo is
              still outside the home editor") — everything Home lives there. */}
          <div className="prof__field">
            <label className="prof__label">Description</label>
            <textarea
              className="prof__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`A few words about this ${kindLabel.toLowerCase()} — what it is, who it's for`}
            />
            <FillWithClaude
              back={`/spaces/${id}?manage=1#about`}
              label="Fill out with Claude"
              space={{ id: space.id, name: space.name }}
              ask={`Help me write ${possessive(space.name)} description — what it is, who it's for.`}
            />
          </div>
          {space.kind === 'community' && (
            <div className="prof__field">
              <label className="prof__label">Identity</label>
              {/* A community can be local OR identity-based (founder
                  2026-08-20: the community of founders). Same vocabulary and
                  suggest-to-Lichen flow as a member's own Identity field. */}
              <CategoryPicker
                domain="identity"
                categories={idCats}
                selected={identityIds}
                onChange={setIdentityIds}
                userId={me || undefined}
              />
              {identityLegacy.length > 0 && (
                <div className="prof__legacy-tags">
                  {identityLegacy.map((t) => (
                    <button
                      key={t} type="button" className="cat__chip"
                      title="From before the identity list existed — tap to remove"
                      onClick={() => setIdentityLegacy((l) => l.filter((x) => x !== t))}
                    >
                      {t} <span className="cat__chip-x">&times;</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="prof__hint">Communities can be local, or identity-based — say which identities this one gathers.</p>
            </div>
          )}
          {space.kind === 'group' && (
            <div className="prof__field">
              <label className="prof__label">Part of</label>
              {parentPick ? (
                <span className="sprof__parentpick">
                  {parentPick.name}
                  <button className="sprof__parentpick-x" onClick={() => setParentPick(null)} aria-label="Remove from its community">
                    <Icon name="close" size={11} />
                  </button>
                </span>
              ) : (
                <input
                  className="prof__input"
                  value={parentQ}
                  onChange={(e) => setParentQ(e.target.value)}
                  placeholder="A community or organization this group belongs to (optional)"
                />
              )}
              {!parentPick && parentHits.length > 0 && (
                <div className="sprof__invhits">
                  {parentHits.map((h) => (
                    <button key={h.id} className="sprof__invhit" onClick={() => { setParentPick({ id: h.id, name: h.name }); setParentQ(''); }}>
                      {h.name} <em>{h.kind}</em>
                    </button>
                  ))}
                </div>
              )}
              {myProposal && (
                <p className="prof__hint">
                  Proposed to {myProposal.parentName} — waiting on their admins.{' '}
                  <button className="sprof__withdraw" onClick={() => void act(async () => { await removeNesting(id); setMyProposal(null); })}>
                    Withdraw
                  </button>
                </p>
              )}
              <p className="prof__hint">A group can stand alone — propose it to a community whenever it finds a home (their admins approve). Save to apply.</p>
            </div>
          )}
          <div className="prof__field">
            <label className="prof__label">Location</label>
            <LocationField
              className="prof__input"
              value={locText}
              geo={locGeo}
              onChange={(t, g) => { setLocText(t); setLocGeo(g); }}
            />
            <p className="prof__hint">Pick a suggestion to put it on the map — free text saves, but won&rsquo;t pin.</p>
          </div>
          {/* Contact & hours moved INTO the Contact tab's Style panel in the
              tabs list (founder 2026-08-22: "contact and hours is supposed
              to be a tab that you select, not a default part of the page
              builder"). */}
          <label className="sprof__duty">
            <input type="checkbox" checked={publicPage} onChange={(e) => setPublicPage(e.target.checked)} />
            <span>
              Serve this page to the open web
              <em>Anyone can see the identity, story, contact and hours above — no account needed.
                Recommending, booking, messaging and events still require joining Lichen.</em>
            </span>
          </label>

          {/* HOW LOUDLY THE PAGE RECRUITS (founder 2026-08-28). A page can go
              live as somebody's actual website before its owner has been
              walked through Lichen — Countryman Stables went up on its own
              domain that way. Until that conversation happens the page
              shouldn't be selling the platform to the barn's customers. The
              `join` levels existed since 2026-07-29 but had no control; an
              owner had to be edited into the database. Now they choose.
              Nobody is locked out by 'none': the app lives at lichen.health
              and members sign in there. */}
          {publicPage && (
            <div className="prof__field">
              <label className="prof__label">How much should this page mention Lichen?</label>
              {([
                ['full', 'Invite people in',
                 'Visitors get an invitation to request an account, and members can sign in from the page.'],
                ['quiet', 'Keep it quiet',
                 'One small line at the foot of the page. Members can still sign in from it.'],
                ['none', 'Just my website',
                 "No sign-in and no invitation card — the page reads as this place's own site. One small \u201cPowered by Lichen\u201d line stays at the very bottom. You can turn it back up whenever you're ready."],
              ] as const).map(([value, title, note]) => (
                <label className="prof__consent" key={value}>
                  <input
                    type="radio"
                    name="page-join"
                    checked={(pageEdit.join ?? 'full') === value}
                    onChange={() => setPageEdit((pm) => ({
                      ...pm, join: value === 'full' ? undefined : value,
                    }))}
                  />
                  <span><strong>{title}</strong><em>{note}</em></span>
                </label>
              ))}
            </div>
          )}

          <div className="prof__field">
            <label className="prof__label">Address</label>
            <div className="prof__handle">
              <span className="prof__handle-prefix">lichen.health/</span>
              <input className="prof__input" value={handle} onChange={(e) => setHandle(e.target.value)}
                placeholder={kindLabel.toLowerCase().replace(/\s+/g, '-')} />
            </div>
            <p className="prof__hint">
              {handleFree === 'taken'
                ? <strong style={{ color: 'var(--red, #B3261E)' }}>
                    That address is taken — try another.
                  </strong>
                : handleFree === 'free'
                  ? <strong style={{ color: 'var(--green-deep, #2E6B4F)' }}>
                      lichen.health/{handle.trim()} is free.
                    </strong>
                  : handleFree === 'checking'
                    ? 'Checking…'
                    : <>Letters, numbers and dashes only. Leave it blank and this page lives at{' '}
                        <code>/spaces/{id.slice(0, 8)}…</code> instead.</>}
            </p>
            {/* WHERE THIS PAGE ACTUALLY LIVES (founder 2026-08-28). The
                Address field only ever showed the lichen.health handle, so a
                space whose site answers on its own domain — Countryman
                Stables — had no way to see that from the builder. Custom
                domains come from HOST_SPACES; wiring a NEW one is still a
                code + Vercel change, not something this screen can do yet. */}
            {handle.trim() && (
              <p className="prof__hint">
                Live at{' '}
                {[`lichen.health/${handle.trim()}`, ...domainsForHandle(handle)].map((addr, i) => (
                  <span key={addr}>
                    {i > 0 ? ' · ' : null}
                    <a href={`https://${addr}`} target="_blank" rel="noreferrer">{addr}</a>
                  </span>
                ))}
              </p>
            )}
          </div>
          <p className="prof__privacy-sub">This page</p>
          <div className="prof__field">
            <label className="prof__label">One line — what this {kindLabel.toLowerCase()} does, for whom</label>
            <input className="prof__input" value={pageEdit.tagline ?? ''}
              onChange={(e) => setPageEdit((pm) => ({ ...pm, tagline: e.target.value }))}
              placeholder="A grange for the whole valley" />
          </div>

          {/* THIS PAGE'S COLOURS (founder 2026-08-28: "can they choose a
              white background and to pull their dark red in instead of our
              peach?"). Background is three grounds, not a colour picker — a
              free background field is how someone ends up with an unreadable
              site. The accent is theirs and comes off their own logo, but is
              forced readable on whichever ground they picked, so nobody can
              quietly wreck their own page. */}
          <div className="prof__field">
            <label className="prof__label">Background</label>
            {(Object.keys(SURFACES) as PageSurface[]).map((key) => (
              <label className="prof__consent" key={key}>
                <input
                  type="radio"
                  name="page-surface"
                  checked={(pageEdit.surface ?? 'warm') === key}
                  onChange={() => setPageEdit((pm) => ({
                    ...pm, surface: key === 'warm' ? undefined : key,
                  }))}
                />
                <span>
                  <strong>{SURFACES[key].label}</strong>
                  <em>{SURFACES[key].note}</em>
                </span>
              </label>
            ))}
          </div>

          {/* TRY IT ON THE WHOLE PAGE (founder 2026-08-28: "the preview is
              too small — open a new tab where they can see the entire thing
              rendered with their branding"). Reading the logo changes
              nothing; it offers a link that opens the real page with the
              colours applied for that view only, via ?brand/?ground. The
              owner looks, closes the tab, and decides here. */}
          <div className="prof__field">
            <label className="prof__label">Accent colour</label>
            <div className="sprof__hue-row">
              <span
                aria-hidden
                className="sprof__hue-dot"
                style={{
                  background: pageEdit.accent
                    ? (readableAccent(pageEdit.accent, pageEdit.surface ?? 'warm') ?? 'var(--peach)')
                    : 'var(--peach)',
                }}
              />
              <button
                type="button" className="btn" disabled={hueBusy || !space?.avatar_url}
                onClick={async () => {
                  if (!space?.avatar_url) return;
                  setHueBusy(true); setHueNote(''); setHueProposal(null);
                  const found = await brandSchemeFromLogo(space.avatar_url);
                  setHueBusy(false);
                  if (!found) { setHueNote("Couldn't read a colour scheme from the logo."); return; }
                  const ground: PageSurface = found.ground;
                  const safe = found.accent ? readableAccent(found.accent, ground) : null;
                  setHueProposal({ accent: safe, raw: found.accent, ground });
                }}
              >
                {hueBusy ? 'Reading your logo…' : '✦ Use my branding'}
              </button>
              {(pageEdit.accent || pageEdit.surface) && !hueProposal && (
                <button
                  type="button" className="btn"
                  onClick={() => {
                    setPageEdit((pm) => ({ ...pm, accent: undefined, surface: undefined }));
                    setHueNote('');
                  }}
                >
                  Back to Lichen&rsquo;s colours
                </button>
              )}
            </div>

            {hueProposal && (
              <div className="sprof__hue-try">
                <p className="sprof__hue-lead">
                  {hueProposal.accent
                    ? <>Your logo reads as <strong>{hueProposal.raw}</strong> on a{' '}
                        {SURFACES[hueProposal.ground].label.toLowerCase()} background.</>
                    : <>Your logo is black and white, so this just proposes a{' '}
                        {SURFACES[hueProposal.ground].label.toLowerCase()} background.</>}
                  {' '}Nothing has changed yet.
                </p>
                <div className="sprof__hue-acts">
                  <button
                    type="button" className="btn"
                    disabled={!handle.trim()}
                    onClick={() => {
                      const q = new URLSearchParams();
                      if (hueProposal.accent) q.set('brand', hueProposal.accent);
                      q.set('ground', hueProposal.ground);
                      window.open(`/${handle.trim()}?${q.toString()}`, '_blank', 'noopener');
                    }}
                  >
                    ↗ Preview the whole page
                  </button>
                  <button
                    type="button" className="btn btn-primary"
                    onClick={() => {
                      setPageEdit((pm) => ({
                        ...pm,
                        accent: hueProposal.accent ?? undefined,
                        surface: hueProposal.ground === 'warm' ? undefined : hueProposal.ground,
                      }));
                      setHueNote(
                        hueProposal.accent && hueProposal.raw
                          && hueProposal.accent.toLowerCase() !== hueProposal.raw.toLowerCase()
                          ? `Using ${hueProposal.raw} from your logo, deepened so it stays readable.`
                          : 'Using your logo\u2019s colours. Remember to Save.',
                      );
                      setHueProposal(null);
                    }}
                  >
                    Use these colours
                  </button>
                  <button type="button" className="btn" onClick={() => setHueProposal(null)}>
                    No thanks
                  </button>
                </div>
                {!handle.trim() && (
                  <p className="prof__hint">Give this page an address above and you can preview it.</p>
                )}
              </div>
            )}

            {!hueProposal && (
              <p className="prof__hint">
                {hueNote || (space?.avatar_url
                  ? 'Used for links, buttons and section labels. Anything too pale to read on your background is deepened until it is.'
                  : 'Add a logo above and this can take its colours from it.')}
              </p>
            )}
          </div>

          <div className="prof__field">
            <label className="prof__label">How do you want people to get in touch</label>
            <ContactActionsPicker
              value={pageEdit.actions
                ?? (pageEdit.action && pageEdit.action.kind !== 'none' ? [pageEdit.action.kind] : [])}
              onChange={(actions) => setPageEdit((pm) => ({ ...pm, actions }))}
              contact={contact}
              onContact={(patch) => setContact((c) => ({ ...c, ...patch }))}
            />
          </div>
          {/* The feed is a Lichen thing; the open web only sees it if this
              space says so (founder 2026-08-11). */}
          <label className="prof__consent">
            <input
              type="checkbox"
              checked={pageEdit.showPosts === true}
              onChange={(e) => setPageEdit((pm) => ({ ...pm, showPosts: e.target.checked }))}
            />
            <span>
              <strong>Show this feed on the public page</strong>
              <em>
                Off, the stream stays inside Lichen and visitors see the tabs.
                On, they can read public posts too — as a page to read, not to
                act on: joining, recommending and messaging need an account.
                Either way, visitors land on About first.
              </em>
            </span>
          </label>

          {/* Spaces build their page's tabs from the same library people do
              (founder 2026-08-06) — this form never wrote `page` until now. */}
          <p className="prof__privacy-sub">This page&rsquo;s tabs</p>
          <PageTabsEditor
            tabs={pageEdit.tabs ?? []}
            onChange={(tabs) => setPageEdit((pm) => ({ ...pm, tabs }))}
            photos={pageEdit.photos ?? []}
            onPhotos={(photos) => setPageEdit((pm) => ({ ...pm, photos }))}
            uploaderId={me}
            sections={pageEdit.sections}
            onSections={(sections) => setPageEdit((pm) => ({ ...pm, sections: sections as PageMeta['sections'] }))}
            hasFacilities={!!pageEdit.facilities?.trim()}
            team={pageEdit.team ?? []}
            onTeam={(team) => setPageEdit((pm) => ({ ...pm, team }))}
            homeSummary={pageEdit.homeSummary}
            onHomeSummary={(text) => setPageEdit((pm) => ({ ...pm, homeSummary: text }))}
            coverStyle={pageEdit.coverStyle}
            onCoverStyle={(coverStyle) => setPageEdit((pm) => ({ ...pm, coverStyle }))}
            cover={pageEdit.cover}
            onCover={(cover) => setPageEdit((pm) => ({ ...pm, cover }))}
            coverPos={pageEdit.coverPos}
            onCoverPos={(coverPos) => setPageEdit((pm) => ({ ...pm, coverPos }))}
            spaceId={space.id}
            entityName={name}
            contact={contact}
            onContact={setContact}
            homeExtra={
              <HomeSummaryButton
                story={pageEdit.story ?? description ?? ''}
                entityName={name}
                onWritten={(t) => setPageEdit((pm) => ({ ...pm, homeSummary: t }))}
              />
            }
          />

          {/* A community can decide it works without the assistant — the AI
              door then reads slashed for everyone who visits (founder
              2026-08-05: "AI is off at the admin level for the group"). */}
          <label className="sprof__duty">
            <input type="checkbox" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
            <span>
              Work with the assistant here
              <em>Off means this {kindLabel.toLowerCase()} carries a slashed AI mark, and nothing
                here is gathered for anyone&rsquo;s briefing. Members always reach their own
                assistant elsewhere.</em>
            </span>
          </label>
          <div className="prof__save-row">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span className="prof__msg">{msg}</span>}
          </div>
        </CollapsibleSection>
      )}

      {adminTools && (
        <CollapsibleSection id="privacy" title="Privacy" open={openSections.has('privacy')} onToggle={() => toggleSection('privacy')}>
          {/* Founder's wording, 2026-08-11 (matches Profile's Privacy lead) —
              "your" reads as the space's own assistant here. */}
          <p className="prof__care-lead">
            Who can see what. What you&rsquo;re comfortable sharing with your AI
            assistant. Almost everything is on by default but yours to switch
            off, if you&rsquo;d prefer!
          </p>

          <p className="prof__privacy-sub">Being found</p>
          <label className="prof__consent">
            <input type="checkbox" checked={findable} onChange={(e) => setFindable(e.target.checked)} />
            <span>
              <strong>Findable in the directory and search</strong>
              <em>On, this {kindLabel.toLowerCase()} appears in search and space directories. Off, it doesn&rsquo;t — members who already belong can still find it.</em>
            </span>
          </label>

          <p className="prof__privacy-sub">What the assistant may read</p>
          <label className="prof__consent">
            <input type="checkbox" checked={assistantReadable} onChange={(e) => setAssistantReadable(e.target.checked)} />
            <span>
              <strong>Let other members&rsquo; assistants read this {kindLabel.toLowerCase()}&rsquo;s content</strong>
              <em>When someone asks their assistant to brief them on a conversation this {kindLabel.toLowerCase()} is part of, it can read that content. Off keeps it out of everyone else&rsquo;s briefings.</em>
            </span>
          </label>

          <p className="prof__privacy-sub">This {kindLabel.toLowerCase()}&rsquo;s content — defaults for new posts</p>
          <label className="prof__consent">
            <input type="checkbox" checked={contentAiDefault} onChange={(e) => setContentAiDefault(e.target.checked)} />
            <span>
              <strong>New posts are AI-readable</strong>
              <em>Assistants may read and surface what&rsquo;s posted here. Each post can still flip this in Compose — this only sets the starting position.</em>
            </span>
          </label>
          <label className="prof__consent">
            <input type="checkbox" checked={contentDownloadDefault} onChange={(e) => setContentDownloadDefault(e.target.checked)} />
            <span>
              <strong>New posts&rsquo; media is downloadable</strong>
              <em>People can save the photos and videos posted here. Also flippable per post.</em>
            </span>
          </label>

          <div className="prof__save-row">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span className="prof__msg">{msg}</span>}
          </div>
        </CollapsibleSection>
      )}

      {adminTools && (
        <CollapsibleSection id="currentcy" title="Current-cy" open={openSections.has('currentcy')} onToggle={() => toggleSection('currentcy')}>
          <CurrentcyCard partyType="space" partyId={id} />
        </CollapsibleSection>
      )}

      {plusMenu}

      {!backstage && !tab && feedSection({ showing: true, open: () => {}, guest: !me })}

      {/* Admins see who's knocking (requests) and who hasn't answered (invites). */}
      {/* Member shares awaiting the shelves (courses/library) — stewards
          approve, and can promote the sharer into a section admin. */}
      {backstage && deskRowsForSpace(id).length > 0 && (
        <CollapsibleSection id="notifications" title="Notifications" open={openSections.has('notifications')} onToggle={() => toggleSection('notifications')}>
          <div className="sprof__desknotes">
            {deskRowsForSpace(id).slice(0, 10).map((n) => (
              <p className={'sprof__desknote' + (n.read_at ? '' : ' is-new')} key={n.id}>
                {n.title}{n.body ? <em> — {n.body}</em> : null}
              </p>
            ))}
          </div>
          <p className="prof__hint">These stay off your main bell — everything actionable is in the queues below.</p>
        </CollapsibleSection>
      )}

      {backstage && sharesForMe.length > 0 && (
        <CollapsibleSection id="shelves" title="Shared for the shelves" open={openSections.has('shelves')} onToggle={() => toggleSection('shelves')}>
          {sharesForMe.map((r) => {
            const post = sharePosts.find((p) => p.id === r.post_id);
            const isMember = members.some((m) => m.profile_id === r.requested_by);
            const alreadySteward = (() => {
              const m = members.find((x) => x.profile_id === r.requested_by);
              return !!m && holdsDuty(m.role, m.duties, r.area);
            })();
            return (
              <div className="sprof__req sprof__sharereq" key={`${r.post_id}:${r.area}`}>
                <span className="sprof__req-name">
                  {r.requester?.full_name ?? 'A member'} shared a {r.area === 'courses' ? 'course' : 'library piece'}:{' '}
                  <button className="sprof__share-title" onClick={() => navigate(`/posts/${r.post_id}`)}>
                    {post?.title || post?.body.slice(0, 48) || 'a post'}
                  </button>
                </span>
                <span className="sprof__req-actions sprof__share-actions">
                  <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
                    onClick={() => void act(() => decideShare(r, true))}>Approve</button>
                  {isMember && !alreadySteward && (
                    <button className="btn sprof__invite-btn" disabled={memBusy}
                      title={`Approve AND make them a ${r.area === 'courses' ? 'Courses' : 'Library'} admin of this space`}
                      onClick={() => void act(() => decideShare(r, true, true))}>
                      Approve + make {r.area === 'courses' ? 'Courses' : 'Library'} admin
                    </button>
                  )}
                  <button className="btn sprof__invite-btn" disabled={memBusy}
                    onClick={() => void act(() => decideShare(r, false))}>Decline</button>
                </span>
              </div>
            );
          })}
        </CollapsibleSection>
      )}

      {backstage && resBookings.length > 0 && (
        <CollapsibleSection id="bookings" title="Booking requests" open={openSections.has('bookings')} onToggle={() => toggleSection('bookings')}>
          {resBookings.map((b) => (
            <div className="sprof__req sprof__sharereq" key={b.id}>
              <span className="sprof__req-name">
                {b.requester?.full_name ?? 'A member'} asked for <strong>{b.resource?.name}</strong>
                {' · '}{b.start_date === b.end_date ? b.start_date : `${b.start_date} – ${b.end_date}`}
                {b.note && <em className="sprof__req-tag"> — {b.note}</em>}
              </span>
              <span className="sprof__req-actions sprof__share-actions">
                <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
                  onClick={() => void act(async () => { await decideResourceBooking(b.id, true); setResBookings((c) => c.filter((x) => x.id !== b.id)); })}>Approve</button>
                <button className="btn sprof__invite-btn" disabled={memBusy}
                  onClick={() => void act(async () => { await decideResourceBooking(b.id, false); setResBookings((c) => c.filter((x) => x.id !== b.id)); })}>Decline</button>
              </span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {backstage && (
        <CollapsibleSection id="rooms" title="Bookable areas & things" open={openSections.has('rooms')} onToggle={() => toggleSection('rooms')}>
          {resources.length === 0 && !newResOpen && (
            <p className="sprof__muted">Nothing listed yet — a stall, an arena, a tool, the dinner plates. Anything members can book.</p>
          )}
          <div className="sprof__members">
            {resources.map((r) => (
              <div className="sprof__grouprow" key={r.id}>
                <span className="sprof__res-main">
                  <Icon name={r.kind === 'room' ? 'location' : 'store'} size={16} />
                  <span className="sprof__res-name">{r.name}</span>
                  <span className="sprof__res-desc">{r.approval === 'instant' ? 'books instantly' : 'requests need a yes'}</span>
                </span>
                <button className="btn sprof__invite-btn" disabled={memBusy}
                  onClick={() => {
                    void confirmDialog({ message: `Remove ${r.name}? Its calendar and pending requests go with it.`, confirmLabel: 'Remove', danger: true }).then((ok) => {
                      if (ok) void act(async () => { await deleteResource(r.id); setResources((c) => c.filter((x) => x.id !== r.id)); });
                    });
                  }}>Remove</button>
              </div>
            ))}
          </div>
          {newResOpen ? (
            <div className="sprof__res-new">
              <div className="sprof__rolepills">
                <button className={'sprof__rolepill' + (newResKind === 'room' ? ' is-on' : '')} onClick={() => setNewResKind('room')}>Area</button>
                <button className={'sprof__rolepill' + (newResKind === 'thing' ? ' is-on' : '')} onClick={() => setNewResKind('thing')}>Thing</button>
              </div>
              <input className="prof__input" value={newResName} onChange={(e) => setNewResName(e.target.value)}
                placeholder={newResKind === 'room' ? 'e.g. The pavilion, stall 4, the north arena' : 'e.g. Formal dinner plates (service for 24)'} autoFocus />
              <input className="prof__input" value={newResDesc} onChange={(e) => setNewResDesc(e.target.value)}
                placeholder="A few words — capacity, condition, care instructions (optional)" />
              <label className="sprof__duty">
                <input type="checkbox" checked={newResInstant} onChange={(e) => setNewResInstant(e.target.checked)} />
                <span>Book instantly <em>no approval step — first come, first served</em></span>
              </label>
              <div className="sprof__rolepills">
                <button className="btn btn-primary sprof__invite-btn" disabled={memBusy || !newResName.trim()}
                  onClick={() => void act(async () => {
                    await createResource({
                      space_id: id, name: newResName.trim(), kind: newResKind,
                      description: newResDesc.trim() || undefined,
                      approval: newResInstant ? 'instant' : 'request',
                    });
                    setResources(await listSpaceResources(id));
                    setNewResOpen(false); setNewResName(''); setNewResDesc(''); setNewResInstant(false);
                  })}>Add</button>
                <button className="btn sprof__invite-btn" onClick={() => setNewResOpen(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="btn sprof__invite-btn" onClick={() => setNewResOpen(true)}>+ Add an area or thing</button>
          )}
        </CollapsibleSection>
      )}

      {memberTools && (pendingReqs.length > 0 || knocks.length > 0) && (
        <CollapsibleSection id="waiting" title="Waiting at the door" open={openSections.has('waiting')} onToggle={() => toggleSection('waiting')}>
          {/* Knocks from the open web (founder 2026-08-17): not yet on Lichen at
              all. The steward's invitation is the vouch; membership here is
              filed automatically when they sign up. */}
          {knocks.map((k) => (
            <div className="sprof__req sprof__req--knock" key={k.id}>
              <span className="sprof__req-name">
                {k.name} <span className="sprof__knock-email">· {k.email}</span>
                <em className="sprof__req-tag"> knocked from the public page · not on Lichen yet</em>
                {k.story && <span className="sprof__knock-story">{k.story}</span>}
              </span>
              <div className="sprof__knock-acts">
                <input
                  className="sprof__knock-note"
                  value={knockNote[k.id] ?? ''}
                  onChange={(e) => setKnockNote((m) => ({ ...m, [k.id]: e.target.value }))}
                  placeholder={`A line for ${k.name.split(' ')[0]} to read when the invitation lands`}
                />
                <button className="btn btn-primary sprof__invite-btn" disabled={knockBusy === k.id}
                  onClick={() => {
                    setKnockBusy(k.id); setKnockErr('');
                    inviteKnocker(k, myRow?.profile?.full_name ?? '', knockNote[k.id] ?? '')
                      .then(() => setKnocks((cur) => cur.filter((x) => x.id !== k.id)))
                      .catch((e: Error) => { setKnockErr(e.message); setKnocks((cur) => cur.filter((x) => x.id !== k.id || !/already on Lichen/.test(e.message))); })
                      .finally(() => setKnockBusy(null));
                  }}>{knockBusy === k.id ? 'Sending…' : 'Send the invitation'}</button>
                <button className="btn sprof__invite-btn" disabled={knockBusy === k.id}
                  onClick={() => {
                    setKnockBusy(k.id);
                    decideSpaceKnock(k.id, 'declined')
                      .then(() => setKnocks((cur) => cur.filter((x) => x.id !== k.id)))
                      .catch((e: Error) => setKnockErr(e.message))
                      .finally(() => setKnockBusy(null));
                  }}>Not a fit</button>
                {/* Spam is a category, not just a dismissal (founder
                    2026-08-21): the address is quietly barred from knocking
                    again, and the labeled row becomes training data. */}
                <button className="btn sprof__invite-btn sprof__knock-spam" disabled={knockBusy === k.id}
                  onClick={() => {
                    setKnockBusy(k.id);
                    decideSpaceKnock(k.id, 'spam')
                      .then(() => setKnocks((cur) => cur.filter((x) => x.id !== k.id)))
                      .catch((e: Error) => setKnockErr(e.message))
                      .finally(() => setKnockBusy(null));
                  }}>Spam</button>
              </div>
            </div>
          ))}
          {knockErr && <p className="sprof__knock-err">{knockErr}</p>}
          {pendingReqs.map((r) => {
            const initiatorRole = members.find((m) => m.profile_id === r.initiated_by)?.role;
            const kind = r.initiated_by === r.profile_id ? 'request'
              : (initiatorRole === 'admin' || initiatorRole === 'super_admin') ? 'invite'
              : 'suggestion';
            return (
              <div className="sprof__req" key={r.profile_id}>
                <Avatar id={r.profile_id} name={r.profile?.full_name ?? 'Member'} url={r.profile?.avatar_url} size={34} />
                <span className="sprof__req-name">
                  {r.profile?.full_name ?? 'A member'}
                  {kind === 'suggestion' && (
                    <em className="sprof__req-tag"> suggested by {r.initiator?.full_name ?? 'a member'}</em>
                  )}
                </span>
                {kind === 'request' && (
                  <span className="sprof__req-actions">
                    <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
                      onClick={() => void act(() => approveJoin(id, r.profile_id))}>Approve</button>
                    <button className="btn sprof__invite-btn" disabled={memBusy}
                      onClick={() => void act(() => removeRequest(id, r.profile_id))}>Decline</button>
                  </span>
                )}
                {kind === 'invite' && (
                  <span className="sprof__req-actions">
                    <em className="sprof__req-tag">invited</em>
                    <button className="btn sprof__invite-btn" disabled={memBusy}
                      onClick={() => void act(() => removeRequest(id, r.profile_id))}>Withdraw</button>
                  </span>
                )}
                {kind === 'suggestion' && (
                  <span className="sprof__req-actions">
                    <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
                      title="Turn this suggestion into your invite"
                      onClick={() => void act(() => endorseSuggestion(id, r.profile_id))}>Invite</button>
                    <button className="btn sprof__invite-btn" disabled={memBusy}
                      onClick={() => void act(() => removeRequest(id, r.profile_id))}>Decline</button>
                  </span>
                )}
              </div>
            );
          })}
        </CollapsibleSection>
      )}


      {tab && !backstage && (
        <button className="cmp__back calp__backchip sprof__tabback" onClick={() => openTab('')}>
          <Icon name="arrow-left" size={14} /> Back to {space.name}
        </button>
      )}

      {tab === 'events' && (
        <section className="prof__section">
          <h2 className="prof__h2">Events</h2>
          {spaceEvents.length === 0 && (
            <p className="sprof__muted">
              Nothing on the calendar yet.{isMember ? ' Add one from the + menu.' : ''}
            </p>
          )}
          <div className="sprof__members">
            {(() => {
              const today = new Date().toISOString().slice(0, 10);
              const when = (p: FeedPost) => p.linked_event?.start_date ?? '';
              const upcoming = spaceEvents
                .filter((p) => (p.linked_event?.recurrence ? true : (p.linked_event?.end_date ?? when(p)) >= today))
                .sort((a, b) => when(a).localeCompare(when(b)));
              const past = spaceEvents
                .filter((p) => !upcoming.includes(p))
                .sort((a, b) => when(b).localeCompare(when(a)));
              const row = (p: FeedPost, dim: boolean) => (
                <button className={'sprof__member' + (dim ? ' is-past' : '')} key={p.id}
                  onClick={() => navigate(`/events/${p.id}`)}>
                  <span className="sprof__ev-date">
                    {p.linked_event?.recurrence ? 'repeats' : when(p).slice(5)}
                  </span>
                  <span className="sprof__member-name">{p.title || p.body.slice(0, 48)}</span>
                  <span className="sprof__member-role">
                    {p.event_mode === 'free' ? 'Free' : p.event_mode === 'trade' ? 'Trade' : p.event_mode === 'paid' ? 'Paid' : ''}
                  </span>
                </button>
              );
              return (
                <>
                  {upcoming.map((p) => row(p, false))}
                  {past.length > 0 && <p className="sprof__past-head">Past</p>}
                  {past.slice(0, 10).map((p) => row(p, true))}
                </>
              );
            })()}
          </div>
        </section>
      )}

      {/* Backstage folds Members into the accordion like every other
          section (founder 2026-08-11); the dedicated ?tab=members page
          keeps it open — you navigated there to see exactly this. */}
      {(tab === 'members' || backstage) && (
      <MembersShell
        backstage={backstage}
        open={openSections.has('members')}
        onToggle={() => toggleSection('members')}
        sectionRef={membersRef}
        meta={members.length === 0 ? 'No members yet' : `${members.length} member${members.length === 1 ? '' : 's'}`}
        onAdd={memberTools ? () => {
          setOpenSections((s2) => new Set(s2).add('members'));
          window.setTimeout(() => invInputRef.current?.focus(), 80);
        } : undefined}
      >
        {members.length === 0 && <p className="sprof__muted">No members yet.</p>}
        <div className="sprof__members">
          {sortClaudeFirst([...members].sort((a, b) => {
            // Present, then around, then everyone else — the same order the
            // my-celium directory uses, so presence reads the same anywhere.
            const rank = (id: string) => {
              const w = presentWho.find((x) => x.id === id);
              return w ? (w.lit ? 0 : 1) : 2;
            };
            return rank(a.profile_id) - rank(b.profile_id)
              || (a.profile?.full_name ?? '').localeCompare(b.profile?.full_name ?? '');
          }), (m) => m.profile_id).map((m) => {
            const presentHere = presentWho.find((x) => x.id === m.profile_id);
            const isMe = m.profile_id === me;
            // A scoped admin's label says what they steward ("admin · Library")
            const roleLabel = m.role === 'admin' && m.duties
              ? 'admin · ' + m.duties.map((d) => SPACE_DUTIES.find((x) => x.key === d)?.label ?? d).join(', ')
              : ROLE_LABEL[m.role] ?? m.role;
            const canManage = adminTools && myRole === 'super_admin'
              && m.role !== 'super_admin' && m.profile_id !== me;
            // Remove (founder 2026-08-17): the members duty removes members;
            // only the super admin removes an admin — the server enforces the
            // same rule, this just hides doors that would refuse.
            const canRemove = m.profile_id !== me && m.role !== 'super_admin'
              && (myRole === 'super_admin' || (memberTools && m.role === 'member'));
            return (
              <MemberRow
                key={m.profile_id}
                id={m.profile_id}
                name={m.profile?.full_name ?? 'Member'}
                avatarUrl={m.profile?.avatar_url}
                presence={presentHere ? 'lit' : null}
                kind="person"
                roleLabel={roleLabel}
                trusted={myVouchedSet.has('profile:' + m.profile_id)}
                onTrust={(on) => {
                  setMyVouchedSet((cur) => {
                    const next = new Set(cur);
                    if (on) { next.add('profile:' + m.profile_id); } else next.delete('profile:' + m.profile_id);
                    return next;
                  });
                  if (on) setMyWebSet((cur) => new Set(cur).add('profile:' + m.profile_id));
                  void setVouch('profile', m.profile_id, on).catch(console.error);
                }}
                weaveOn={myWebSet.has('profile:' + m.profile_id)}
                onWeave={(on) => {
                  setMyWebSet((cur) => {
                    const next = new Set(cur);
                    if (on) next.add('profile:' + m.profile_id); else next.delete('profile:' + m.profile_id);
                    return next;
                  });
                  void setInWeb('profile', m.profile_id, on).catch(console.error);
                }}
                onOpen={() => navigate(`/members/${m.profile_id}`)}
                hideActions={!me || isMe}
                claudeInUse={claudeInUse}
                trailing={(canManage || canRemove) ? (
                  <span className="sprof__memberacts">
                    {canManage && (
                      <button
                        className="sprof__rolebtn"
                        title="Member or admin, and what they steward"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (manage?.id === m.profile_id) { setManage(null); return; }
                          setManage({ id: m.profile_id, name: m.profile?.full_name ?? 'this member' });
                          setMAdmin(m.role === 'admin');
                          setMAll(!m.duties);
                          setMDuties(m.duties ?? []);
                        }}
                      >
                        Role <Icon name="chevron-right" size={12} />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        className="sprof__rolebtn sprof__rolebtn--remove"
                        title={`Remove ${m.profile?.full_name ?? 'this member'} from ${space.name}`}
                        disabled={memBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          void confirmDialog({
                            message: `Remove ${m.profile?.full_name ?? 'this member'} from ${space.name}? They'll be told. Their own posts and everything else of theirs stay theirs.`,
                            confirmLabel: 'Remove', danger: true,
                          }).then((ok) => { if (ok) void act(() => removeSpaceMember(id, m.profile_id)); });
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                ) : undefined}
              />
            );
          })}
        </div>
        {/* Super admin's stewardship editor: admin or member, and WHICH duties
            (founder 2026-07-24 — "one admin curates the library, another TAs
            a course"). Null duties = a full admin, exactly as before. */}
        {manage && adminTools && myRole === 'super_admin' && (
          <div className="sprof__rolebox">
            <p className="sprof__rolebox-title">What does {manage.name} steward?</p>
            <div className="sprof__rolepills">
              <button className={'sprof__rolepill' + (!mAdmin ? ' is-on' : '')} onClick={() => setMAdmin(false)}>Member</button>
              <button className={'sprof__rolepill' + (mAdmin ? ' is-on' : '')} onClick={() => setMAdmin(true)}>Admin</button>
            </div>
            {mAdmin && (
              <div className="sprof__duties">
                <label className="sprof__duty">
                  <input type="checkbox" checked={mAll} onChange={(e) => setMAll(e.target.checked)} />
                  <span>Everything <em>a full admin</em></span>
                </label>
                {!mAll && SPACE_DUTIES.map((d) => (
                  <label className="sprof__duty" key={d.key}>
                    <input
                      type="checkbox"
                      checked={mDuties.includes(d.key)}
                      onChange={(e) => setMDuties((cur) =>
                        e.target.checked ? [...cur, d.key] : cur.filter((x) => x !== d.key))}
                    />
                    <span>{d.label} <em>{d.hint}</em></span>
                  </label>
                ))}
                <p className="prof__hint">Scoped admins steward just their areas; editing this page stays with all admins.</p>
              </div>
            )}
            <div className="sprof__rolepills">
              <button
                className="btn btn-primary sprof__invite-btn"
                disabled={memBusy || (mAdmin && !mAll && mDuties.length === 0)}
                onClick={() => void act(async () => {
                  await setMemberRole(id, manage.id, mAdmin ? 'admin' : 'member', mAdmin && !mAll ? mDuties : null);
                  setManage(null);
                  await load();
                })}
              >
                Save
              </button>
              <button className="btn sprof__invite-btn" onClick={() => setManage(null)}>Cancel</button>
            </div>
          </div>
        )}
        {(memberTools || (isMember && !backstage && !holdsDuty(myRole, myRow?.duties, 'members'))) && (
          <div className="sprof__invitebox">
            <input
              ref={invInputRef}
              className="prof__input"
              value={invQ}
              onChange={(e) => setInvQ(e.target.value)}
              placeholder={memberTools ? 'Invite a member by name…' : 'Suggest a member to the admins…'}
            />
            {!memberTools && invQ.trim().length >= 2 && (
              <p className="prof__hint">The admins review suggestions before anyone is invited.</p>
            )}
            {invHits.length > 0 && (
              <div className="sprof__invhits">
                {invHits.map((h) => (
                  <button key={h.id} className="sprof__invhit" disabled={memBusy}
                    onClick={() => {
                      setInvQ('');
                      void act(() => memberTools ? inviteMember(id, me, h.id) : suggestMember(id, me, h.id));
                    }}>
                    {h.full_name ?? 'Member'} <em>{memberTools ? 'Invite' : 'Suggest'}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </MembersShell>
      )}

      {/* Nested groups and places — the community's smaller circles and its
          grounds. In BACKSTAGE they sit in the accordion like everything else
          (founder 2026-08-17: title, "No groups yet" on the same line, a +
          instead of a drawer to open); on ?tab=groups the list stands open. */}
      {(() => {
        const canNest = space.kind === 'community' || space.kind === 'organization';
        if (!canNest || !(childGroups.length > 0 || childPlaces.length > 0 || me)) return null;
        const groupList = (
          <>
            <div className="sprof__members">
              {childGroups.map((g) => (
                <div className="sprof__grouprow" key={g.id}>
                  <button className="sprof__member" onClick={() => navigate(`/spaces/${g.id}`)}>
                    <Avatar id={g.id} name={g.name} url={g.avatar_url} size={34} />
                    <span className="sprof__member-name">{g.name}</span>
                    <span className="sprof__member-role">
                      {g.member_count} {g.member_count === 1 ? 'member' : 'members'}
                    </span>
                  </button>
                  {adminTools && (
                    <button
                      className="btn sprof__invite-btn"
                      disabled={memBusy}
                      title="Release this group — it becomes standalone; nothing else changes"
                      onClick={() => {
                        void confirmDialog({ message: `Release ${g.name} from ${space.name}? It becomes a standalone group — its members, chat, and posts are untouched.`, confirmLabel: 'Release' }).then((ok) => {
                          if (ok) void act(() => ejectGroup(g.id));
                        });
                      }}
                    >
                      Release
                    </button>
                  )}
                </div>
              ))}
            </div>
            {/* Groups knocking on the door — admins decide. */}
            {adminTools && proposals.length > 0 && proposals.map((pr) => (
              <div className="sprof__req" key={pr.group_id}>
                <Avatar id={pr.group_id} name={pr.group?.name ?? 'Group'} url={pr.group?.avatar_url} size={34} />
                <span className="sprof__req-name">
                  {pr.group?.name ?? 'A group'}
                  <em className="sprof__req-tag"> proposed by {pr.proposer?.full_name ?? 'a member'}</em>
                </span>
                <span className="sprof__req-actions">
                  <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
                    onClick={() => void act(() => approveNesting(pr.group_id))}>Approve</button>
                  <button className="btn sprof__invite-btn" disabled={memBusy}
                    onClick={() => void act(() => removeNesting(pr.group_id))}>Decline</button>
                </span>
              </div>
            ))}
            {adminTools ? (
              !newGroupOpen ? null : (
                <div className="sprof__newgroup">
                  <input
                    className="prof__input"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                    placeholder={`Name the new group (it lives inside ${space.name})`}
                    autoFocus
                  />
                  <button className="btn btn-primary sprof__invite-btn" disabled={memBusy || !newGroupName.trim()}
                    onClick={() => void createChildGroup()}>Create</button>
                  <button className="btn sprof__invite-btn" disabled={memBusy}
                    onClick={() => { setNewGroupOpen(false); setNewGroupName(''); }}>Cancel</button>
                </div>
              )
            ) : me ? (
              /* Opened from the +: anyone can propose a group; the admins
                 here decide whether it joins. It's theirs to run either way. */
              !proposeOpen ? null : (
                <div className="sprof__newgroup">
                  <input
                    className="prof__input"
                    value={proposeName}
                    onChange={(e) => setProposeName(e.target.value)}
                    placeholder={`Name your group — ${space.name}'s admins will review it`}
                    autoFocus
                  />
                  <button className="btn btn-primary sprof__invite-btn" disabled={memBusy || !proposeName.trim()}
                    onClick={() => void proposeNewGroup()}>Propose</button>
                  <button className="btn sprof__invite-btn" disabled={memBusy}
                    onClick={() => { setProposeOpen(false); setProposeName(''); }}>Cancel</button>
                </div>
              )
            ) : null}
          </>
        );
        const placeList = (
          <>
            <div className="sprof__members">
              {childPlaces.map((g) => (
                <div className="sprof__grouprow" key={g.id}>
                  <button className="sprof__member" onClick={() => navigate(`/spaces/${g.id}`)}>
                    <Avatar id={g.id} name={g.name} url={g.avatar_url} size={34} />
                    <span className="sprof__member-name">{g.name}</span>
                    {g.location && <span className="sprof__member-role">{g.location}</span>}
                  </button>
                  {adminTools && (
                    <button
                      className="btn sprof__invite-btn"
                      disabled={memBusy}
                      title="Release this place — it becomes standalone; nothing else changes"
                      onClick={() => {
                        void confirmDialog({ message: `Release ${g.name} from ${space.name}? It becomes a standalone place — nothing else changes.`, confirmLabel: 'Release' }).then((ok) => {
                          if (ok) void act(() => ejectGroup(g.id));
                        });
                      }}
                    >
                      Release
                    </button>
                  )}
                </div>
              ))}
            </div>
            {adminTools && newPlaceOpen && (
              <div className="sprof__newgroup">
                <input
                  className="prof__input"
                  value={newPlaceName}
                  onChange={(e) => setNewPlaceName(e.target.value)}
                  placeholder={`Name the new place (it lives inside ${space.name})`}
                  autoFocus
                />
                <button className="btn btn-primary sprof__invite-btn" disabled={memBusy || !newPlaceName.trim()}
                  onClick={() => void createChildPlace()}>Create</button>
                <button className="btn sprof__invite-btn" disabled={memBusy}
                  onClick={() => { setNewPlaceOpen(false); setNewPlaceName(''); }}>Cancel</button>
              </div>
            )}
          </>
        );
        const count = (n: number, one: string) => n === 0 ? `No ${one}s yet` : `${n} ${one}${n === 1 ? '' : 's'}`;
        if (backstage) {
          const groupsOpenable = childGroups.length > 0 || (adminTools && proposals.length > 0) || newGroupOpen || proposeOpen;
          const placesOpenable = childPlaces.length > 0 || newPlaceOpen;
          return (
            <>
              <CollapsibleSection id="groups" title="Groups" meta={count(childGroups.length, 'group')}
                expandable={groupsOpenable}
                open={openSections.has('groups') || newGroupOpen || proposeOpen}
                onToggle={() => toggleSection('groups')}
                action={me ? {
                  label: adminTools ? 'Add a group' : 'Propose a group',
                  onClick: () => {
                    if (adminTools) setNewGroupOpen(true); else setProposeOpen(true);
                    setOpenSections((s2) => new Set(s2).add('groups'));
                  },
                } : undefined}>
                {groupList}
              </CollapsibleSection>
              <CollapsibleSection id="places" title="Places" meta={count(childPlaces.length, 'place')}
                expandable={placesOpenable}
                open={openSections.has('places') || newPlaceOpen}
                onToggle={() => toggleSection('places')}
                action={adminTools ? {
                  label: 'Add a place',
                  onClick: () => { setNewPlaceOpen(true); setOpenSections((s2) => new Set(s2).add('places')); },
                } : undefined}>
                {placeList}
              </CollapsibleSection>
            </>
          );
        }
        if (tab !== 'groups') return null;
        return (
          <section className="prof__section" ref={groupsRef}>
            <h2 className="prof__h2">Groups</h2>
            {childGroups.length === 0 && <p className="sprof__muted">No groups here yet.</p>}
            {groupList}
            {childPlaces.length > 0 && (
              <>
                <h2 className="prof__h2">Places</h2>
                {placeList}
              </>
            )}
          </section>
        );
      })()}

      {roomsSection}

      {/* Two doors at the foot, the super admin's alone (founder 2026-08-17):
          TAKE OFFLINE — off the network, held intact, put back online any time
          from Profile → Off the network; and DELETE — permanent, immediate.
          Plain buttons, not accordion sections: there is never more to say
          than the act itself. Each confirm opens in place; the server's
          refusal (treasury Current, a stewarded member, an open trade), when
          there is one, IS the copy. */}
      {backstage && myRole === 'super_admin' && (
        <div className="sprof__delete">
          {retireMode === null ? (
            <div className="sprof__delete-row">
              <button className="btn" disabled={deleting} onClick={() => setRetireMode('offline')}>
                Take this {kindLabel.toLowerCase()} offline
              </button>
              <button className="btn sprof__btn--danger" disabled={deleting} onClick={() => setRetireMode('delete')}>
                Delete this {kindLabel.toLowerCase()}
              </button>
            </div>
          ) : (
            <div className={'sprof__confirm' + (retireMode === 'offline' ? ' sprof__confirm--soft' : '')}>
              <span className="sprof__confirm-text">
                {retireMode === 'offline' ? (
                  <>Take <em>&ldquo;{space.name}&rdquo;</em> off the network? It disappears from Lichen
                    for everyone, members included — chat, events, posts and all — but nothing is lost.
                    You can put it back online any time from your Profile.</>
                ) : (
                  <>Delete <em>&ldquo;{space.name}&rdquo;</em> for good? Its members, chat, events,
                    bookable areas, collections and everything it posted in its own voice go with it
                    {(space.kind === 'community' || space.kind === 'organization')
                      ? '; groups nested inside it stay, on their own'
                      : ''}. This can&rsquo;t be undone.</>
                )}
              </span>
              <button className={'btn' + (retireMode === 'delete' ? ' sprof__btn--danger' : ' btn-primary')} disabled={deleting} onClick={() => {
                setDeleting(true); setDeleteError('');
                const dir = `/${space.kind === 'community' ? 'communities' : space.kind + 's'}`;
                (retireMode === 'delete' ? deleteSpace(id) : takeSpaceOffline(id))
                  .then(() => navigate(retireMode === 'delete' ? dir : '/profile#offline', { replace: true }))
                  .catch((e: Error) => { setDeleteError(e.message); setDeleting(false); });
              }}>
                {deleting ? (retireMode === 'delete' ? 'Deleting…' : 'Taking offline…') : (retireMode === 'delete' ? 'Yes, delete' : 'Yes, take it offline')}
              </button>
              <button className="btn" disabled={deleting} onClick={() => { setRetireMode(null); setDeleteError(''); }}>Cancel</button>
              {deleteError && <p className="sprof__delete-err">{deleteError}</p>}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
