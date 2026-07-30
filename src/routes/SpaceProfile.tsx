import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { setTopIdentity } from '../lib/topIdentity';
import Avatar from '../components/Avatar';
import LocationField from '../components/LocationField';
import ContributionsFeed from '../components/ContributionsFeed';
import { SmartLocation } from './Calendar';
import { useAuth } from '../auth/AuthProvider';
import { colorFor, monogramFor } from '../lib/chatApi';
import type { GeoPoint } from '../lib/geoApi';
import {
  loadSpaceProfile, loadSpaceMembers, loadSpaceChatId, updateSpaceProfile, uploadSpaceAvatar,
  loadMyRequestFor, requestToJoin, removeRequest, listPendingRequests, inviteMember,
  approveJoin, acceptInvite, leaveSpace, listChildGroups, createSpaceWithLocation,
  amIAdminOf, proposeNesting, loadNestingFor, listNestingProposals, approveNesting, removeNesting, ejectGroup,
  suggestMember, endorseSuggestion, setMemberRole, holdsDuty, SPACE_DUTIES,
  listPendingSectionShares, decideSectionShare, type SectionShareRow, type SectionArea,
  type NestingRequestRow,
  type SpaceProfileRow, type SpaceMemberRow, type SpaceKind,
  type MyRequestState, type PendingRequestRow, type SpaceDirectoryRow,
} from '../lib/spacesApi';
import { supabase } from '../lib/supabase';
import { loadPostsByIds, loadAuthorFeed, postAreas, type FeedPost } from '../lib/postsApi';
import {
  listSpaceResources, createResource, deleteResource, resourceBusy,
  requestResourceBooking, listPendingResourceBookings, decideResourceBooking,
  resourceSpanContact, type ResourceRow, type ResourceBusySpan, type ResourceBookingRow,
} from '../lib/resourcesApi';
import { ensureDirectChat } from '../lib/chatApi';
import DateRangeCalendar, { type DateRange } from '../components/DateRangeCalendar';
import { todayISO } from '../lib/conciergeApi';
import { loadMyWeb, setInWeb, setVouch, loadMyRecommendations, setRecommend } from '../lib/myceliumApi';
import { useNotifications } from '../notifications/NotificationsProvider';
import './Profile.css';
import './SpaceProfile.css';
import './MemberProfile.css';   // shares the mprof action-button styles
import { useConfirm } from '../components/ConfirmDialog';
import ContactFields, { ContactList, type ContactInfo } from '../components/ContactFields';
import PublicPage, { type PageMeta } from '../components/PublicPage';

const KIND_LABEL: Record<SpaceKind, string> = {
  organization: 'Organization', community: 'Community', group: 'Group', place: 'Place',
};
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'super admin', admin: 'admin', member: 'member',
};

/** A space's own profile — organizations, communities, groups, and places get
 *  the same treatment people do. Everyone sees who/what it is; its admins
 *  edit name, story, photo, and location (a picked address pins it on Maps). */
export default function SpaceProfile({ spaceId, forcePublic }: { spaceId?: string; forcePublic?: boolean } = {}) {
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
  const [childGroups, setChildGroups] = useState<SpaceDirectoryRow[]>([]);
  const [memBusy, setMemBusy] = useState(false);
  // admin invite type-ahead
  const [invQ, setInvQ] = useState('');
  const [invHits, setInvHits] = useState<{ id: string; full_name: string | null }[]>([]);
  // + New group (admins of a community/organization)
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
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
  // Rooms & things: the space's bookable resources + the steward queue.
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
  const [pageMeta, setPageMeta] = useState<PageMeta>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  // View-first: everyone (admins included) lands on the public presentation.
  // ALL admin machinery lives behind ?manage=1 — the "backstage" (founder
  // 2026-07-27: queues and edit tools on the public page are distracting).
  const [editOpen, setEditOpen] = useState(false);
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
    setChildGroups(kids);
    setInWebState(mine.web.has(`space:${id}`));
    setTrusted(mine.vouched.has(`space:${id}`));
    setRecommended(recs.has(`space:${id}`));
    if (s) {
      setName(s.name);
      setParentPick(s.parent);
      setDescription(s.description ?? '');
      setLocText(s.location ?? '');
      setLocGeo(s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
      const sx = s as unknown as { contact?: ContactInfo | null; public_page?: boolean };
      setContact(sx.contact ?? {});
      setPublicPage(sx.public_page !== false);
      setPageMeta(((s as unknown as { page?: PageMeta | null }).page) ?? {});
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

  async function toggleTrust() {
    if (!me) return;
    const next = !trusted;
    setTrusted(next);
    if (next && !inWeb) setInWebState(true);  // trusting auto-adds to the web
    try { await setVouch('space', id, next); } catch (e) { console.error(e); setTrusted(!next); }
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
  const isAdmin = myRole === 'admin' || myRole === 'super_admin';
  const backstage = isAdmin && searchParams.get('manage') === '1';
  // Members and Groups open as their own views rather than scrolling the feed
  // to its bottom (founder 2026-07-28: "a directory tab, for consistency").
  const tab = searchParams.get('tab');
  // The space's own gatherings — what's coming up, then what's past.
  const [spaceEvents, setSpaceEvents] = useState<FeedPost[]>([]);
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
      const [rows, props, shr, rbk] = await Promise.all([
        listPendingRequests(id),
        (space?.kind === 'community' || space?.kind === 'organization')
          ? listNestingProposals(id) : Promise.resolve([]),
        listPendingSectionShares(id),
        listPendingResourceBookings(id),
      ]);
      const shrPosts = shr.length ? await loadPostsByIds(shr.map((r) => r.post_id)) : [];
      if (live) { setPendingReqs(rows); setProposals(props); setShares(shr); setSharePosts(shrPosts); setResBookings(rbk); }
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
        .select('id, full_name').ilike('full_name', `%${q}%`).limit(8);
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
      await supabase.from('spaces')
        .update({ contact: Object.keys(contact).length ? contact : null, public_page: publicPage })
        .eq('id', id);
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

  // The open web (and the owner previewing) sees the shared page template —
  // one structure across every Lichen site (founder 2026-07-28).
  const previewing = searchParams.get('preview') === '1';
  // forcePublic: on a custom domain (countrymanstables.com) EVERYONE gets
  // the website — even signed-in members; the app lives on Lichen's domain.
  if (!me || previewing || forcePublic) {
    return (
      <PublicPage
        id={space.id}
        name={space.name}
        kindLabel={kindLabel}
        avatarUrl={space.avatar_url}
        description={space.description}
        location={space.location}
        contact={contact}
        page={pageMeta}
        preview={previewing}
      >
        {childGroups.length > 0 && (
          <section className="ppage__sec">
            <h2 className="ppage__h2">Groups</h2>
            <div className="ppage__chips">
              {childGroups.map((g) => <span className="ppage__chip" key={g.id}>{g.name}</span>)}
            </div>
          </section>
        )}
      </PublicPage>
    );
  }

  return (
    <div className={'prof' + (backstage ? ' is-adminview' : '')}>
      {isAdmin && (
        <div className="view-toggle-row">
          <span className="view-toggle" role="group" aria-label="View">
            <button
              className={'view-toggle__side' + (!backstage ? ' is-on' : '')}
              onClick={() => { setEditOpen(false); setSearchParams({}); }}
            >
              Member view
            </button>
            <button
              className={'view-toggle__side view-toggle__side--admin' + (backstage ? ' is-on' : '')}
              onClick={() => setSearchParams({ manage: '1' })}
            >
              Admin view
              {deskCount > 0 && <span className="view-toggle__badge">{deskCount}</span>}
            </button>
          </span>
          {backstage && (
            <button className="sprof__edit-btn" onClick={() => setEditOpen((o) => !o)}>
              {editOpen ? 'Done editing' : 'Edit profile'}
            </button>
          )}
        </div>
      )}
      <div className="prof__head">
        <div className="sprof__avatar-wrap">
          {space.avatar_url ? (
            <img className="sprof__avatar-img" src={space.avatar_url} alt="" />
          ) : (
            <span className="sprof__avatar-mono" style={{ background: colorFor(space.id) }}>
              {monogramFor(space.name)}
            </span>
          )}
          {adminTools && editOpen && (
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
        {me && !backstage && (
          <div className="mprof__actions">
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
            {space.kind !== 'place' && (
              /* Trust is for relationships: people, orgs, communities, groups. */
              <button
                className={'btn mprof__btn mprof__btn--trust' + (trusted ? ' is-on' : '')}
                onClick={toggleTrust}
                title={trusted ? 'You trust them — private, tap to undo' : 'Trust them — a private signal, never shown as a count'}
              >
                <Icon name="shield-user" size={14} /> {trusted ? 'Trusted ✓' : 'Trust'}
              </button>
            )}
            {/* Recommend rides beside trust on EVERY kind (founder 2026-07-30):
                "I might trust someone but not recommend them" — and the
                reverse. Independent signals, PR #77 doctrine completed. */}
            <button
              className={'btn mprof__btn mprof__btn--trust' + (recommended ? ' is-on' : '')}
              onClick={toggleRecommend}
              title={recommended ? 'Recommended to those who trust you' : 'Recommend to those who trust you'}
            >
              <Icon name="thumbs-up" size={14} /> {recommended ? 'Recommended ✓' : 'Recommend'}
            </button>
          </div>
        )}
      </div>

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

      {adminTools && editOpen && (
        <section className="prof__section">
          <h2 className="prof__h2">About this {kindLabel.toLowerCase()}</h2>
          <div className="prof__field">
            <label className="prof__label">Name</label>
            <input className="prof__input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="prof__field">
            <label className="prof__label">Description</label>
            <textarea
              className="prof__textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={`A few words about this ${kindLabel.toLowerCase()} — what it is, who it's for`}
            />
          </div>
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
          <div className="prof__field">
            <label className="prof__label">Contact &amp; hours</label>
            <ContactFields
              value={contact}
              onChange={setContact}
              lead="These appear on the public page — how someone reaches you without joining Lichen."
            />
          </div>
          <label className="sprof__duty">
            <input type="checkbox" checked={publicPage} onChange={(e) => setPublicPage(e.target.checked)} />
            <span>
              Serve this page to the open web
              <em>Anyone can see the identity, story, contact and hours above — no account needed.
                Recommending, booking, messaging and events still require joining Lichen.</em>
            </span>
          </label>
          <div className="prof__save-row">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span className="prof__msg">{msg}</span>}
          </div>
        </section>
      )}

      {/* + menu: what are you adding to this space? (Figma 286-14250) */}
      {plusOpen && !backstage && (
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
      )}

      {/* The profile IS a feed — the space's wall (posted AS it or TO it),
          with the space-anatomy circles (Chat for members, Members) leading
          the icon row. Identical for all four kinds. */}
      {!backstage && !tab && <ContributionsFeed
        spaceId={space.id}
        me={me}
        entityName={space.name}
        leading={[
          // Every section carries its own doors: + posts INTO this space,
          // Search searches WITHIN it (Figma 286-11770). Search-then-+ mirrors
          // Home's icon row (founder 2026-07-25 — one order everywhere).
          { icon: 'search' as const, label: 'Search', onClick: () => navigate(`/search?space=${space.id}`) },
          { icon: 'plus' as const, label: 'Add', onClick: () => setPlusOpen((o) => !o) },
          ...(chatId ? [{ icon: 'chat' as const, label: 'Chat', onClick: () => navigate(`/chat/${chatId}`) }] : []),
        ]}
        trailing={[
          // The founder's Marketplace-icon analogy: a Groups door appears only
          // when this space actually has groups nested under it.
          ...(childGroups.length > 0
            ? [{ icon: 'groups' as const, label: 'Groups', onClick: () => openTab('groups') }]
            : []),
          // Members closes the row — the space's Directory, far right like
          // Home's (founder 2026-07-25).
          { icon: 'rsvp' as const, label: 'Events', onClick: () => openTab('events') },
          { icon: 'member-heart' as const, label: 'Members', onClick: () => openTab('members') },
        ]}
      />}

      {/* Admins see who's knocking (requests) and who hasn't answered (invites). */}
      {/* Member shares awaiting the shelves (courses/library) — stewards
          approve, and can promote the sharer into a section admin. */}
      {backstage && deskRowsForSpace(id).length > 0 && (
        <section className="prof__section">
          <h2 className="prof__h2">Notifications</h2>
          <div className="sprof__desknotes">
            {deskRowsForSpace(id).slice(0, 10).map((n) => (
              <p className={'sprof__desknote' + (n.read_at ? '' : ' is-new')} key={n.id}>
                {n.title}{n.body ? <em> — {n.body}</em> : null}
              </p>
            ))}
          </div>
          <p className="prof__hint">These stay off your main bell — everything actionable is in the queues below.</p>
        </section>
      )}

      {backstage && sharesForMe.length > 0 && (
        <section className="prof__section">
          <h2 className="prof__h2">Shared for the shelves</h2>
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
        </section>
      )}

      {backstage && resBookings.length > 0 && (
        <section className="prof__section">
          <h2 className="prof__h2">Booking requests</h2>
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
        </section>
      )}

      {backstage && (
        <section className="prof__section">
          <h2 className="prof__h2">Rooms &amp; things</h2>
          {resources.length === 0 && !newResOpen && (
            <p className="sprof__muted">Nothing listed yet — a room, a tool, the dinner plates. Anything members can book.</p>
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
                <button className={'sprof__rolepill' + (newResKind === 'room' ? ' is-on' : '')} onClick={() => setNewResKind('room')}>Room</button>
                <button className={'sprof__rolepill' + (newResKind === 'thing' ? ' is-on' : '')} onClick={() => setNewResKind('thing')}>Thing</button>
              </div>
              <input className="prof__input" value={newResName} onChange={(e) => setNewResName(e.target.value)}
                placeholder={newResKind === 'room' ? 'e.g. The pavilion' : 'e.g. Formal dinner plates (service for 24)'} autoFocus />
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
            <button className="btn sprof__invite-btn" onClick={() => setNewResOpen(true)}>+ Add a room or thing</button>
          )}
        </section>
      )}

      {memberTools && pendingReqs.length > 0 && (
        <section className="prof__section">
          <h2 className="prof__h2">Waiting at the door</h2>
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
        </section>
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

      {(tab === 'members' || backstage) && (
      <section className="prof__section" ref={membersRef}>
        <h2 className="prof__h2">Members</h2>
        {members.length === 0 && <p className="sprof__muted">No members yet.</p>}
        <div className="sprof__members">
          {members.map((m) => {
            // A scoped admin's label says what they steward ("admin · Library")
            const roleLabel = m.role === 'admin' && m.duties
              ? 'admin · ' + m.duties.map((d) => SPACE_DUTIES.find((x) => x.key === d)?.label ?? d).join(', ')
              : ROLE_LABEL[m.role] ?? m.role;
            const canManage = adminTools && myRole === 'super_admin'
              && m.role !== 'super_admin' && m.profile_id !== me;
            return (
              <div className="sprof__grouprow" key={m.profile_id}>
                <button
                  className="sprof__member"
                  onClick={() => navigate(`/members/${m.profile_id}`)}
                >
                  <Avatar
                    id={m.profile_id}
                    name={m.profile?.full_name ?? 'Member'}
                    url={m.profile?.avatar_url}
                    size={34}
                  />
                  <span className="sprof__member-name">{m.profile?.full_name ?? 'Member'}</span>
                  <span className="sprof__member-role">{roleLabel}</span>
                </button>
                {canManage && (
                  <button
                    className="sprof__rolebtn"
                    title="Change what this member stewards"
                    onClick={() => {
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
              </div>
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
      </section>
      )}

      {/* Nested groups — the community's smaller circles. */}
      {(tab === 'groups' || backstage)
        && (space.kind === 'community' || space.kind === 'organization') && (childGroups.length > 0 || !!me) && (
        <section className="prof__section" ref={groupsRef}>
          <h2 className="prof__h2">Groups</h2>
          {childGroups.length === 0 && <p className="sprof__muted">No groups here yet.</p>}
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
            /* Opened from the + menu: anyone can propose a group; the admins
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
        </section>
      )}

      {!backstage && (resources.length > 0) && (
        <section className="prof__section">
          <h2 className="prof__h2">Rooms &amp; things</h2>
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
      )}

      {pinned && !backstage && (
        <section className="prof__section">
          <button className="btn btn-primary sprof__map-btn" onClick={() => navigate('/maps')}>
            <Icon name="maps" size={15} /> See it on Maps
          </button>
        </section>
      )}
    </div>
  );
}
