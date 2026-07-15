import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
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
  suggestMember, endorseSuggestion,
  type NestingRequestRow,
  type SpaceProfileRow, type SpaceMemberRow, type SpaceKind,
  type MyRequestState, type PendingRequestRow, type SpaceDirectoryRow,
} from '../lib/spacesApi';
import { supabase } from '../lib/supabase';
import { loadMyWeb, setInWeb, setVouch, loadMyRecommendations, setRecommend } from '../lib/myceliumApi';
import './Profile.css';
import './SpaceProfile.css';
import './MemberProfile.css';   // shares the mprof action-button styles

const KIND_LABEL: Record<SpaceKind, string> = {
  organization: 'Organization', community: 'Community', group: 'Group', place: 'Place',
};
const ROLE_LABEL: Record<string, string> = {
  super_admin: 'super admin', admin: 'admin', member: 'member',
};

/** A space's own profile — organizations, communities, groups, and places get
 *  the same treatment people do. Everyone sees who/what it is; its admins
 *  edit name, story, photo, and location (a picked address pins it on Maps). */
export default function SpaceProfile() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
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
  const [parentQ, setParentQ] = useState('');
  const [parentHits, setParentHits] = useState<{ id: string; name: string; kind: string }[]>([]);

  // edit state (admins)
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [locText, setLocText] = useState('');
  const [locGeo, setLocGeo] = useState<GeoPoint | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false);
  // View-first: everyone (admins included) lands on the public presentation;
  // editing is an explicit step. publicView lets admins preview the page
  // exactly as non-admins see it (no admin affordances at all).
  const [editOpen, setEditOpen] = useState(false);
  const [publicView, setPublicView] = useState(false);
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
    }
    setLoading(false);
  }, [id, me]);
  useEffect(() => { load(); }, [load]);

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

  const myRole = members.find((m) => m.profile_id === me)?.role;
  const isMember = !!myRole;
  const isAdmin = myRole === 'admin' || myRole === 'super_admin';
  const adminTools = isAdmin && !publicView;

  useEffect(() => {
    if (!isAdmin) { setPendingReqs([]); setProposals([]); return; }
    let live = true;
    (async () => {
      const [rows, props] = await Promise.all([
        listPendingRequests(id),
        (space?.kind === 'community' || space?.kind === 'organization')
          ? listNestingProposals(id) : Promise.resolve([]),
      ]);
      if (live) { setPendingReqs(rows); setProposals(props); }
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

  const onMembershipTap = () => {
    if (isMember) {
      if (myRole === 'super_admin') return;   // owners can't leave their own space
      if (window.confirm(`Leave ${space?.name ?? 'this space'}? You'll also leave its chat.`)) {
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
    return (
      <div className="prof">
        <p className="sprof__muted">This page isn&rsquo;t available.</p>
      </div>
    );
  }

  const kindLabel = KIND_LABEL[space.kind];
  const pinned = space.lat != null && space.lng != null;

  return (
    <div className="prof">
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
        {space.location && (
          <p className="sprof__loc">
            <SmartLocation loc={space.location} className="sprof__loc-link" />
            {pinned && (
              <Link className="sprof__onmap" to="/maps">On the map ✓</Link>
            )}
          </p>
        )}
        {me && (
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
              title={inWeb ? 'In your mycelium — its doings flow to you' : 'Weave it into your mycelium (no trust implied)'}
            >
              <Icon name="user-multiple" size={14} /> {inWeb ? 'In your Mycelium ✓' : 'Add to Mycelium'}
            </button>
            {space.kind !== 'place' ? (
              /* Trust is for relationships: people, orgs, communities, groups. */
              <button
                className={'btn mprof__btn mprof__btn--trust' + (trusted ? ' is-on' : '')}
                onClick={toggleTrust}
                title={trusted ? 'You trust them — private, tap to undo' : 'Trust them — a private signal, never shown as a count'}
              >
                <Icon name="shield-user" size={14} /> {trusted ? 'Trusted ✓' : 'Trust'}
              </button>
            ) : (
              /* Recommend is for things — a place is a thing you point at. */
              <button
                className={'btn mprof__btn mprof__btn--trust' + (recommended ? ' is-on' : '')}
                onClick={toggleRecommend}
                title={recommended ? 'Recommended to those who trust you' : 'Recommend this place to those who trust you'}
              >
                <Icon name="thumbs-up" size={14} /> {recommended ? 'Recommended ✓' : 'Recommend'}
              </button>
            )}
          </div>
        )}
      </div>

      {error && <p className="prof__error">{error}</p>}

      {myRequest === 'invited' && (
        <div className="sprof__invite">
          <span>You&rsquo;re invited to join {space.name}.</span>
          <button className="btn btn-primary sprof__invite-btn" disabled={memBusy}
            onClick={() => void act(() => acceptInvite(id))}>Accept</button>
          <button className="btn sprof__invite-btn" disabled={memBusy}
            onClick={() => void act(() => removeRequest(id, me))}>Decline</button>
        </div>
      )}

      {isAdmin && publicView && (
        <div className="sprof__manage">
          <button
            className="sprof__edit-btn sprof__edit-btn--on"
            onClick={() => setPublicView(false)}
          >
            Viewing as public — tap to exit
          </button>
        </div>
      )}

      {adminTools && (
        <div className="sprof__manage">
          <button className="sprof__edit-btn" onClick={() => setEditOpen((o) => !o)}>
            {editOpen ? 'Done' : 'Edit profile'}
          </button>
          <button
            className="sprof__edit-btn"
            onClick={() => { setPublicView(true); setEditOpen(false); }}
          >
            View as public
          </button>
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
          <div className="prof__save-row">
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            {msg && <span className="prof__msg">{msg}</span>}
          </div>
        </section>
      )}

      {/* + menu: what are you adding to this space? (Figma 286-14250) */}
      {plusOpen && (
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
            adminTools ? (
              <button
                className="sprof__plus-row"
                onClick={() => {
                  setPlusOpen(false); setNewGroupOpen(true);
                  setTimeout(() => groupsRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
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
      <ContributionsFeed
        spaceId={space.id}
        me={me}
        leading={[
          // Every section carries its own doors: + posts INTO this space,
          // Search searches WITHIN it (Figma 286-11770).
          { icon: 'plus' as const, label: 'Add', onClick: () => setPlusOpen((o) => !o) },
          { icon: 'search' as const, label: 'Search', onClick: () => navigate(`/search?space=${space.id}`) },
          ...(chatId ? [{ icon: 'chat' as const, label: 'Chat', onClick: () => navigate(`/chat/${chatId}`) }] : []),
          { icon: 'member-heart' as const, label: 'Members', onClick: () => membersRef.current?.scrollIntoView({ behavior: 'smooth' }) },
          // The founder's Marketplace-icon analogy: a Groups door appears only
          // when this space actually has groups nested under it.
          ...(childGroups.length > 0
            ? [{ icon: 'groups' as const, label: 'Groups', onClick: () => groupsRef.current?.scrollIntoView({ behavior: 'smooth' }) }]
            : []),
        ]}
      />

      {/* Admins see who's knocking (requests) and who hasn't answered (invites). */}
      {adminTools && pendingReqs.length > 0 && (
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

      <section className="prof__section" ref={membersRef}>
        <h2 className="prof__h2">Members</h2>
        {members.length === 0 && <p className="sprof__muted">No members yet.</p>}
        <div className="sprof__members">
          {members.map((m) => (
            <button
              className="sprof__member"
              key={m.profile_id}
              onClick={() => navigate(`/members/${m.profile_id}`)}
            >
              <Avatar
                id={m.profile_id}
                name={m.profile?.full_name ?? 'Member'}
                url={m.profile?.avatar_url}
                size={34}
              />
              <span className="sprof__member-name">{m.profile?.full_name ?? 'Member'}</span>
              <span className="sprof__member-role">{ROLE_LABEL[m.role] ?? m.role}</span>
            </button>
          ))}
        </div>
        {(adminTools || (isMember && !publicView)) && (
          <div className="sprof__invitebox">
            <input
              className="prof__input"
              value={invQ}
              onChange={(e) => setInvQ(e.target.value)}
              placeholder={adminTools ? 'Invite a member by name…' : 'Suggest a member to the admins…'}
            />
            {!adminTools && invQ.trim().length >= 2 && (
              <p className="prof__hint">The admins review suggestions before anyone is invited.</p>
            )}
            {invHits.length > 0 && (
              <div className="sprof__invhits">
                {invHits.map((h) => (
                  <button key={h.id} className="sprof__invhit" disabled={memBusy}
                    onClick={() => {
                      setInvQ('');
                      void act(() => adminTools ? inviteMember(id, me, h.id) : suggestMember(id, me, h.id));
                    }}>
                    {h.full_name ?? 'Member'} <em>{adminTools ? 'Invite' : 'Suggest'}</em>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Nested groups — the community's smaller circles. */}
      {(space.kind === 'community' || space.kind === 'organization') && (childGroups.length > 0 || !!me) && (
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
                      if (window.confirm(`Release ${g.name} from ${space.name}? It becomes a standalone group — its members, chat, and posts are untouched.`)) {
                        void act(() => ejectGroup(g.id));
                      }
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

      {pinned && (
        <section className="prof__section">
          <button className="btn btn-primary sprof__map-btn" onClick={() => navigate('/maps')}>
            <Icon name="maps" size={15} /> See it on Maps
          </button>
        </section>
      )}
    </div>
  );
}
