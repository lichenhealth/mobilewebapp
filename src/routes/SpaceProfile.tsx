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
  type SpaceProfileRow, type SpaceMemberRow, type SpaceKind,
} from '../lib/spacesApi';
import { loadMyMycelium, loadMyRecommendations, setTrust, setRecommend } from '../lib/myceliumApi';
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
  const [trusted, setTrusted] = useState(false);
  const [recommended, setRecommended] = useState(false);
  const [loading, setLoading] = useState(true);
  const membersRef = useRef<HTMLElement>(null);

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
    const [s, m, c, myc, recs] = await Promise.all([
      loadSpaceProfile(id), loadSpaceMembers(id), loadSpaceChatId(id),
      me ? loadMyMycelium() : Promise.resolve(new Set<string>()),
      me ? loadMyRecommendations() : Promise.resolve(new Set<string>()),
    ]);
    setSpace(s);
    setMembers(m);
    setChatId(c);
    setTrusted(myc.has(`space:${id}`));
    setRecommended(recs.has(`space:${id}`));
    if (s) {
      setName(s.name);
      setDescription(s.description ?? '');
      setLocText(s.location ?? '');
      setLocGeo(s.lat != null && s.lng != null ? { lat: s.lat, lng: s.lng } : null);
    }
    setLoading(false);
  }, [id, me]);
  useEffect(() => { load(); }, [load]);

  async function toggleTrust() {
    if (!me) return;
    const next = !trusted;
    setTrusted(next);
    try { await setTrust('space', id, next); } catch (e) { console.error(e); setTrusted(!next); }
  }

  async function toggleRecommend() {
    if (!me) return;
    const next = !recommended;
    setRecommended(next);
    try { await setRecommend('space', id, next); } catch (e) { console.error(e); setRecommended(!next); }
  }

  const myRole = members.find((m) => m.profile_id === me)?.role;
  const isAdmin = myRole === 'admin' || myRole === 'super_admin';
  const adminTools = isAdmin && !publicView;

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
      await updateSpaceProfile(space.id, {
        name: name.trim() || space.name,
        description: description.trim() || null,
        location: locText.trim() || null,
        lat: locGeo?.lat ?? null,
        lng: locGeo?.lng ?? null,
      });
      setMsg('Saved');
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
        <p className="sprof__kind">{kindLabel}</p>
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
            <button
              className={'btn mprof__btn mprof__btn--trust' + (trusted ? ' is-on' : '')}
              onClick={toggleTrust}
              title={trusted ? 'In your mycelium' : 'Add to your mycelium'}
            >
              <Icon name="shield-user" size={14} /> {trusted ? 'Trusted ✓' : 'Trust'}
            </button>
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

      {/* The profile IS a feed — the space's wall (posted AS it or TO it),
          with the space-anatomy circles (Chat for members, Members) leading
          the icon row. Identical for all four kinds. */}
      <ContributionsFeed
        spaceId={space.id}
        me={me}
        leading={[
          // Every section carries its own doors: + posts INTO this space,
          // Search searches WITHIN it (Figma 286-11770).
          { icon: 'plus' as const, label: 'Post', onClick: () => navigate(`/compose?space=${space.id}`) },
          { icon: 'search' as const, label: 'Search', onClick: () => navigate(`/search?space=${space.id}`) },
          ...(chatId ? [{ icon: 'chat' as const, label: 'Chat', onClick: () => navigate(`/chat/${chatId}`) }] : []),
          { icon: 'user-multiple' as const, label: 'Members', onClick: () => membersRef.current?.scrollIntoView({ behavior: 'smooth' }) },
        ]}
      />

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
      </section>

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
