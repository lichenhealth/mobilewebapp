import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ensureDirectChat } from '../lib/chatApi';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { colorFor, monogramFor } from '../lib/chatApi';
import { loadMyPhone } from '../lib/conciergeApi';
import Avatar from '../components/Avatar';
import { Icon } from '../components/Icon';
import HomeLocationSection from '../components/HomeLocationSection';
import { uploadAvatar } from '../lib/avatarApi';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import './Profile.css';

type SpaceKind = 'organization' | 'community' | 'group' | 'place';
type SpaceRole = 'super_admin' | 'admin' | 'member';
type MySpace = { id: string; name: string; kind: SpaceKind; role: SpaceRole };
type NotifPref = 'off' | 'in_app' | 'both';

const ACTING_KIND_LABEL: Record<SpaceKind, string> = {
  organization: 'Organization', community: 'Community', group: 'Group', place: 'Place',
};

type ProfileRow = { created_at: string; full_name: string | null; first_name: string | null; last_name: string | null; headline: string | null; bio: string | null; notification_pref?: NotifPref; avatar_url: string | null };
type MemberRow = { role: SpaceRole; spaces: { id: string; name: string; kind: SpaceKind } | null };
type CareStatus = 'pending' | 'active';
type CareRow = {
  id: string;
  patient_id: string;
  caregiver_id: string;
  status: CareStatus;
  initiated_by: string;
  patientName: string;
  caregiverName: string;
};

const CAPS = [
  { id: 'service_provider', label: 'Service Provider' },
  { id: 'goods_provider', label: 'Goods Provider' },
];
const SPACE_SECTIONS: { kind: SpaceKind; title: string; one: string }[] = [
  { kind: 'organization', title: 'Your organizations', one: 'organization' },
  { kind: 'community',    title: 'Your communities',   one: 'community' },
  { kind: 'group',        title: 'Your groups',        one: 'group' },
  { kind: 'place',        title: 'Your places',        one: 'place' },
];
const ROLE_LABEL: Record<SpaceRole, string> = {
  super_admin: 'super admin', admin: 'admin', member: 'member',
};

export default function Profile() {
  const { user, loading } = useAuth();
  const { actor, setActor, options: actingOptions, refreshSelf } = useActing();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [notifPref, setNotifPref] = useState<NotifPref>('in_app');
  const [caps, setCaps] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<MySpace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [serviceCats, setServiceCats] = useState<string[]>([]);
  const [goodCats, setGoodCats] = useState<string[]>([]);
  const [tier, setTier] = useState<{ tier: string; source: string } | null>(null);

  const [loadingData, setLoadingData] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [newNames, setNewNames] = useState<Record<SpaceKind, string>>({
    organization: '', community: '', group: '', place: '',
  });
  const [addingKind, setAddingKind] = useState<SpaceKind | null>(null);
  const [error, setError] = useState('');

  const [care, setCare] = useState<CareRow[]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string; role: 'caregiver' | 'patient' }[]>([]);
  const [caregiverEmail, setCaregiverEmail] = useState('');
  const [patientEmail, setPatientEmail] = useState('');
  const [careMsg, setCareMsg] = useState('');
  const [careBusy, setCareBusy] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  async function onAvatarFile(file: File | undefined) {
    if (!file || !user) return;
    setAvatarBusy(true); setError('');
    try {
      const url = await uploadAvatar(user.id, file);
      setAvatarUrl(url);
      refreshSelf();                     // updates the top-bar chip immediately
    } catch (e) {
      setError((e as { message?: string } | null)?.message || 'Could not upload that photo.');
    }
    setAvatarBusy(false);
  }

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoadingData(true);
    const [pRes, cRes, mRes, catRes, pcRes, subRes, myPhone] = await Promise.all([
      supabase.from('profiles').select('created_at,full_name,first_name,last_name,headline,bio,notification_pref,avatar_url').eq('id', user.id).single(),
      supabase.from('profile_capabilities').select('capability').eq('profile_id', user.id),
      supabase.from('space_members').select('role, spaces(id,name,kind)').eq('profile_id', user.id),
      supabase.from('categories').select('id, domain, name, sort').order('sort', { ascending: true }),
      supabase.from('profile_categories').select('category_id, categories(domain)').eq('profile_id', user.id),
      supabase.from('subscriptions').select('tier, source').eq('profile_id', user.id).maybeSingle(),
      loadMyPhone(),
    ]);
    const p = pRes.data as ProfileRow | null;
    // Own email comes from the auth session, not the profiles table — so it stays
    // available here even though the email column is locked from member reads.
    setEmail(user.email ?? '');
    if (p) {
      setAvatarUrl(p.avatar_url ?? null);
      setFullName(p.full_name ?? '');
      setFirstName(p.first_name ?? '');
      setLastName(p.last_name ?? '');
      setHeadline(p.headline ?? '');
      setBio(p.bio ?? '');
      setNotifPref(p.notification_pref ?? 'in_app');
    }
    setPhone(myPhone);
    const cRows = (cRes.data as { capability: string }[] | null) ?? [];
    setCaps(cRows.map((r) => r.capability));
    const mRows = (mRes.data as MemberRow[] | null) ?? [];
    setSpaces(mRows.filter((r) => r.spaces).map((r) => ({
      id: r.spaces!.id, name: r.spaces!.name, kind: r.spaces!.kind, role: r.role,
    })));
    setCategories(((catRes.data as Category[] | null) ?? []));
    const pcRows = (pcRes.data as { category_id: string; categories: { domain: 'good' | 'service' } | null }[] | null) ?? [];
    setServiceCats(pcRows.filter((r) => r.categories?.domain === 'service').map((r) => r.category_id));
    setGoodCats(pcRows.filter((r) => r.categories?.domain === 'good').map((r) => r.category_id));
    setTier((subRes.data as { tier: string; source: string } | null) ?? null);
    setLoadingData(false);
  }, [user]);

  const loadCare = useCallback(async () => {
    if (!user) return;
    // turn any invitations addressed to my email into pending care connections
    await supabase.rpc('claim_care_invitations');
    const [careRes, invRes] = await Promise.all([
      supabase
        .from('care_team_members')
        .select('id, patient_id, caregiver_id, status, initiated_by, patient:profiles!care_team_members_patient_id_fkey(full_name), caregiver:profiles!care_team_members_caregiver_id_fkey(full_name)'),
      supabase
        .from('care_invitations')
        .select('id, invitee_email, role')
        .eq('status', 'pending'),
    ]);
    const raw = (careRes.data as unknown as {
      id: string; patient_id: string; caregiver_id: string; status: CareStatus; initiated_by: string;
      patient: { full_name: string | null } | null; caregiver: { full_name: string | null } | null;
    }[]) ?? [];
    // Resolve display names server-side so members with no full_name fall back to
    // their email (revealed only for our own care-team counterparties).
    const ids = [...new Set(raw.flatMap((r) => [r.patient_id, r.caregiver_id]))];
    const nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: disp } = await supabase.rpc('care_member_display', { p_ids: ids });
      for (const d of (disp as { id: string; display: string }[] | null) ?? []) nameMap.set(d.id, d.display);
    }
    const rows = raw.map((r) => ({
      id: r.id, patient_id: r.patient_id, caregiver_id: r.caregiver_id,
      status: r.status, initiated_by: r.initiated_by,
      // || (not ??) so a blank-string name also falls through to "Member".
      patientName: nameMap.get(r.patient_id) || r.patient?.full_name || 'Member',
      caregiverName: nameMap.get(r.caregiver_id) || r.caregiver?.full_name || 'Member',
    }));
    setCare(rows);
    setInvites(((invRes.data as { id: string; invitee_email: string; role: 'caregiver' | 'patient' }[] | null) ?? [])
      .map((i) => ({ id: i.id, email: i.invitee_email, role: i.role })));
  }, [user]);

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (user) { loadAll(); loadCare(); }
  }, [user, loading, navigate, loadAll, loadCare]);

  async function inviteCare(role: 'caregiver' | 'patient', emailRaw: string) {
    if (!user) return;
    setCareMsg(''); setCareBusy(true);
    const em = emailRaw.trim();
    if (!em) { setCareBusy(false); return; }
    // Look up a member by exact email via a SECURITY DEFINER function. Members
    // can't read the email column directly anymore, so this returns id + name
    // for a match (and nothing for a non-match) without exposing emails.
    const { data: foundRows } = await supabase.rpc('find_member_by_email', { p_email: em });
    const found = (foundRows as { id: string; full_name: string | null }[] | null)?.[0] ?? null;
    if (!found) {
      // Not a member yet → create a standing invitation tied to their email.
      const { error: invErr } = await supabase.from('care_invitations')
        .insert({ inviter_id: user.id, invitee_email: em.toLowerCase(), role });
      setCareBusy(false);
      if (invErr) {
        setCareMsg(/duplicate|unique/i.test(invErr.message) ? 'You already invited that email.' : invErr.message);
        return;
      }
      if (role === 'caregiver') setCaregiverEmail(''); else setPatientEmail('');
      setCareMsg(`Invited ${em} to Lichen — they'll join your care circle when they sign up. Use “Copy invite” to send them the link.`);
      loadCare();
      return;
    }
    const f = found as { id: string; full_name: string | null };
    if (f.id === user.id) { setCareBusy(false); setCareMsg('That email is you!'); return; }
    const row = role === 'caregiver'
      ? { patient_id: user.id, caregiver_id: f.id, initiated_by: user.id, status: 'pending' as const }
      : { patient_id: f.id, caregiver_id: user.id, initiated_by: user.id, status: 'pending' as const };
    const { error: e } = await supabase.from('care_team_members').insert(row);
    setCareBusy(false);
    if (e) {
      setCareMsg(/duplicate|unique/i.test(e.message) ? 'That care connection already exists.' : e.message);
      return;
    }
    if (role === 'caregiver') setCaregiverEmail(''); else setPatientEmail('');
    setCareMsg('Request sent — pending their approval.');
    loadCare();
  }

  async function approveCare(id: string) {
    setError('');
    const { error: e } = await supabase.from('care_team_members').update({ status: 'active' }).eq('id', id);
    if (e) setError(e.message); else loadCare();
  }
  async function removeCare(id: string) {
    setError('');
    const { error: e } = await supabase.from('care_team_members').delete().eq('id', id);
    if (e) setError(e.message); else loadCare();
  }
  async function cancelInvite(id: string) {
    setError('');
    const { error: e } = await supabase.from('care_invitations').delete().eq('id', id);
    if (e) setError(e.message); else loadCare();
  }
  async function copyInvite(email: string) {
    const msg = `Join me on Lichen — sign up with this email (${email}) and we'll be connected: https://lichen.healthcare/signup`;
    try {
      await navigator.clipboard.writeText(msg);
      setCareMsg('Invite link copied — paste it into a text or email to them.');
    } catch {
      setCareMsg(`Copy this and send it to them: ${msg}`);
    }
  }
  async function sendInviteEmail(email: string, role: 'caregiver' | 'patient') {
    setCareMsg('Sending…');
    const { error: e } = await supabase.functions.invoke('send-care-invite', {
      body: { email, role, inviterName: fullName || 'A Lichen member' },
    });
    if (e) { setCareMsg('Couldn’t send automatically yet — use Copy invite to share the link.'); return; }
    setCareMsg(`Invite emailed to ${email}.`);
  }

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true); setProfileMsg(''); setError('');
    // full_name is composed from first/last by a DB trigger — don't write it here.
    const { error: e } = await supabase.from('profiles')
      .update({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        headline: headline.trim() || null,
        bio: bio.trim() || null,
      })
      .eq('id', user.id);
    setSavingProfile(false);
    if (e) { setError(e.message); return; }
    setFullName(`${firstName.trim()} ${lastName.trim()}`.trim());
    refreshSelf();                       // header/acting chip picks up the new name
    setProfileMsg('Saved');
    setTimeout(() => setProfileMsg(''), 2000);
  }

  async function updateNotifPref(pref: NotifPref) {
    if (!user) return;
    const prev = notifPref;
    setNotifPref(pref);
    const { error: e } = await supabase.from('profiles').update({ notification_pref: pref }).eq('id', user.id);
    if (e) { setError(e.message); setNotifPref(prev); }
  }

  async function toggleCap(cap: string) {
    if (!user) return;
    setError('');
    const on = caps.includes(cap);
    setCaps((cur) => (on ? cur.filter((x) => x !== cap) : [...cur, cap]));
    if (on) {
      const { error: e } = await supabase.from('profile_capabilities').delete().eq('profile_id', user.id).eq('capability', cap);
      if (e) { setError(e.message); setCaps((cur) => [...cur, cap]); }
    } else {
      const { error: e } = await supabase.from('profile_capabilities').insert({ profile_id: user.id, capability: cap });
      if (e) { setError(e.message); setCaps((cur) => cur.filter((x) => x !== cap)); }
    }
  }

  // Persist category changes immediately (added -> upsert, removed -> delete)
  async function setCatsForDomain(domain: 'good' | 'service', ids: string[]) {
    if (!user) return;
    setError('');
    const prev = domain === 'service' ? serviceCats : goodCats;
    const added = ids.filter((x) => !prev.includes(x));
    const removed = prev.filter((x) => !ids.includes(x));
    if (domain === 'service') setServiceCats(ids); else setGoodCats(ids);
    if (added.length) {
      const rows = added.map((category_id) => ({ profile_id: user.id, category_id }));
      const { error: e } = await supabase.from('profile_categories')
        .upsert(rows, { onConflict: 'profile_id,category_id', ignoreDuplicates: true });
      if (e) setError(e.message);
    }
    if (removed.length) {
      const { error: e } = await supabase.from('profile_categories')
        .delete().eq('profile_id', user.id).in('category_id', removed);
      if (e) setError(e.message);
    }
  }

  async function addSpace(kind: SpaceKind) {
    const name = (newNames[kind] || '').trim();
    if (!user || !name) return;
    setAddingKind(kind); setError('');
    const { error: e } = await supabase.from('spaces').insert({ kind, name, created_by: user.id });
    setAddingKind(null);
    if (e) { setError(e.message); return; }
    setNewNames((m) => ({ ...m, [kind]: '' }));
    loadAll();
  }

  function editLocalName(id: string, name: string) {
    setSpaces((cur) => cur.map((s) => (s.id === id ? { ...s, name } : s)));
  }
  async function renameSpace(id: string, name: string) {
    if (!name.trim()) { loadAll(); return; }
    setError('');
    const { error: e } = await supabase.from('spaces').update({ name: name.trim() }).eq('id', id);
    if (e) setError(e.message);
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  async function messageMember(otherId: string) {
    try { navigate(`/chat/${await ensureDirectChat(otherId)}`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open chat'); }
  }

  if (loading || (user && loadingData)) {
    return <div className="prof"><p className="prof__muted">Loading...</p></div>;
  }
  if (!user) return null;

  const showServices = caps.includes('service_provider');
  const showGoods = caps.includes('goods_provider');
  const meId = user.id;
  const myTeam = care.filter((c) => c.patient_id === meId);     // caregivers caring for me
  const iCareFor = care.filter((c) => c.caregiver_id === meId); // people I care for

  return (
    <div className="prof">
      <div className="prof__head">
        <button
          className="prof__avatar-btn"
          onClick={() => avatarInputRef.current?.click()}
          disabled={avatarBusy}
          aria-label={avatarUrl ? 'Change profile picture' : 'Add profile picture'}
          title={avatarUrl ? 'Change profile picture' : 'Add profile picture'}
        >
          <Avatar id={user?.id ?? 'me'} name={fullName || 'Me'} url={avatarUrl} size={72} />
          <span className="prof__avatar-edit">{avatarBusy ? '…' : '✎'}</span>
        </button>
        <input
          ref={avatarInputRef} type="file" accept="image/*" hidden
          onChange={(e) => { onAvatarFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <h1 className="prof__name">{fullName || 'Your profile'}</h1>
        <p className="prof__email">{email}</p>
        {tier && (
          <span className="prof__tier">
            {tier.tier === 'concierge' ? 'Concierge' : 'Community'} member
            {tier.source === 'gift' ? ' · gifted' : ''}
          </span>
        )}
      </div>

      <div className="prof__public-row">
        <button className="prof__public-btn" onClick={() => navigate(`/members/${user?.id}`)}>
          View public profile <Icon name="chevron-right" size={12} />
        </button>
      </div>

      {error && <p className="prof__error">{error}</p>}


      {/* ── Acting as: post & create as yourself or a space you admin ── */}
      {actingOptions.length > 0 && (
        <section className="prof__section">
          <h2 className="prof__h2">Acting as</h2>
          <p className="prof__care-lead">Choose who you're acting as.</p>
          <div className="prof__acting-list">
            <button
              className={'prof__acting-row' + (actor.type === 'self' ? ' is-on' : '')}
              onClick={() => setActor({ type: 'self' })}
            >
              <Avatar id={user?.id ?? 'me'} name={fullName || 'Me'} url={avatarUrl} size={34} />
              <span className="prof__acting-name">{fullName || 'Yourself'}</span>
              <span className="prof__acting-kind">You</span>
              {actor.type === 'self' && <span className="prof__acting-on">Acting</span>}
            </button>
            {actingOptions.map((o) => {
              const on = actor.type === 'space' && actor.id === o.id;
              return (
                // Row switches acting identity; the chevron opens the space's
                // own profile (two buttons — nesting them is invalid HTML).
                <div className="prof__acting-pair" key={o.id}>
                  <button
                    className={'prof__acting-row' + (on ? ' is-on' : '')}
                    onClick={() => setActor({ type: 'space', ...o })}
                  >
                    <span className="prof__acting-avatar" style={{ background: colorFor(o.id) }}>
                      {monogramFor(o.name)}
                    </span>
                    <span className="prof__acting-name">{o.name}</span>
                    <span className="prof__acting-kind">{ACTING_KIND_LABEL[o.kind]}</span>
                    {on && <span className="prof__acting-on">Acting</span>}
                  </button>
                  <button
                    className="prof__acting-open"
                    onClick={() => navigate(`/spaces/${o.id}`)}
                    aria-label={`Open ${o.name}'s profile`}
                    title="Open profile"
                  >
                    <Icon name="chevron-right" size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="prof__section">
        <h2 className="prof__h2">About you</h2>
        <div className="prof__field">
          <label className="prof__label">First name</label>
          <input className="prof__input" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="First name" />
        </div>
        <div className="prof__field">
          <label className="prof__label">Last name</label>
          <input className="prof__input" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Last name" />
        </div>
        <div className="prof__field">
          <label className="prof__label">Phone</label>
          <input className="prof__input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" />
          <p className="prof__hint">So your care team can reach you when someone&rsquo;s on call. Only your care team can see it.</p>
        </div>
        <div className="prof__field">
          <label className="prof__label">Headline</label>
          <input className="prof__input" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="e.g. Somatic practitioner & land steward" />
        </div>
        <div className="prof__field">
          <label className="prof__label">Bio</label>
          <textarea className="prof__textarea" value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A few words about you and your work" />
        </div>
        <div className="prof__save-row">
          <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save'}
          </button>
          {profileMsg && <span className="prof__msg">{profileMsg}</span>}
        </div>
      </section>

      {user && <HomeLocationSection me={user.id} />}

      <section className="prof__section">
        <h2 className="prof__h2">Notifications</h2>
        <p className="prof__care-lead">How would you like to get notified?</p>
        <div className="prof__notif-opts">
          {([
            ['off', "Don't Notify Me"],
            ['in_app', 'In App'],
            ['both', 'In App + Email'],
          ] as [NotifPref, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={'prof__notif-opt' + (notifPref === value ? ' is-on' : '')}
              onClick={() => updateNotifPref(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="prof__section">
        <h2 className="prof__h2">What you offer</h2>
        <div className="prof__caps">
          {CAPS.map((c) => (
            <button key={c.id} type="button"
              className={'prof__cap' + (caps.includes(c.id) ? ' is-on' : '')}
              onClick={() => toggleCap(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        {showServices && (
          <div className="prof__picker">
            <p className="prof__picker-lead">Services you offer</p>
            <CategoryPicker
              domain="service"
              categories={categories}
              selected={serviceCats}
              onChange={(ids) => setCatsForDomain('service', ids)}
              userId={user.id}
            />
          </div>
        )}
        {showGoods && (
          <div className="prof__picker">
            <p className="prof__picker-lead">Goods you offer</p>
            <CategoryPicker
              domain="good"
              categories={categories}
              selected={goodCats}
              onChange={(ids) => setCatsForDomain('good', ids)}
              userId={user.id}
            />
          </div>
        )}
      </section>

      <section className="prof__section">
        <h2 className="prof__h2">Your care team</h2>
        <p className="prof__care-lead">People who help care for you. They approve before joining.</p>
        {myTeam.length === 0 && <p className="prof__empty">No one on your care team yet.</p>}
        <div className="prof__care-list">
          {myTeam.map((c) => {
            const incoming = c.status === 'pending' && c.initiated_by !== meId;
            return (
              <div className="prof__care-row" key={c.id}>
                <div className="prof__care-id">
                  <span className="prof__care-name">{c.caregiverName}</span>
                  {c.status === 'pending' && (
                    <span className="prof__care-tag">{incoming ? 'wants to join' : 'invited · awaiting'}</span>
                  )}
                </div>
                <div className="prof__care-actions">
                  {incoming && <button className="prof__care-btn prof__care-btn--ok" onClick={() => approveCare(c.id)}>Approve</button>}
                  {c.status === 'active' && <button className="prof__care-btn" onClick={() => messageMember(c.caregiver_id)}>Message</button>}
                  <button className="prof__care-btn" onClick={() => removeCare(c.id)}>{c.status === 'active' ? 'Remove' : incoming ? 'Decline' : 'Cancel'}</button>
                </div>
              </div>
            );
          })}
        </div>
        {invites.filter((i) => i.role === 'caregiver').map((i) => (
          <div className="prof__care-row prof__care-row--invite" key={i.id}>
            <div className="prof__care-id">
              <span className="prof__care-name">{i.email}</span>
              <span className="prof__care-tag">invited to Lichen</span>
            </div>
            <div className="prof__care-actions">
              <button className="prof__care-btn prof__care-btn--ok" onClick={() => sendInviteEmail(i.email, 'caregiver')}>Send email</button>
              <button className="prof__care-btn" onClick={() => copyInvite(i.email)}>Copy</button>
              <button className="prof__care-btn" onClick={() => cancelInvite(i.id)}>Cancel</button>
            </div>
          </div>
        ))}
        <div className="prof__add-row">
          <input className="prof__input" type="email" value={caregiverEmail}
            onChange={(e) => { setCaregiverEmail(e.target.value); setCareMsg(''); }}
            placeholder="Add a caregiver by email" />
          <button className="btn btn-primary" onClick={() => inviteCare('caregiver', caregiverEmail)}
            disabled={careBusy || !caregiverEmail.trim()}>Invite</button>
        </div>
      </section>

      <section className="prof__section">
        <h2 className="prof__h2">People you care for</h2>
        <p className="prof__care-lead">Members who’ve added you as a caregiver, or whom you’ve offered to help.</p>
        <button className="prof__care-dash" onClick={() => navigate('/caregiver')}>
          Open caregiver dashboard
          <span aria-hidden="true"> →</span>
        </button>
        {iCareFor.length === 0 && <p className="prof__empty">You’re not on anyone’s care team yet.</p>}
        <div className="prof__care-list">
          {iCareFor.map((c) => {
            const incoming = c.status === 'pending' && c.initiated_by !== meId;
            return (
              <div className="prof__care-row" key={c.id}>
                <div className="prof__care-id">
                  <span className="prof__care-name">{c.patientName}</span>
                  {c.status === 'pending' && (
                    <span className="prof__care-tag">{incoming ? 'added you · approve?' : 'offered · awaiting'}</span>
                  )}
                </div>
                <div className="prof__care-actions">
                  {incoming && <button className="prof__care-btn prof__care-btn--ok" onClick={() => approveCare(c.id)}>Approve</button>}
                  {c.status === 'active' && <button className="prof__care-btn" onClick={() => messageMember(c.patient_id)}>Message</button>}
                  <button className="prof__care-btn" onClick={() => removeCare(c.id)}>{c.status === 'active' ? 'Leave' : incoming ? 'Decline' : 'Cancel'}</button>
                </div>
              </div>
            );
          })}
        </div>
        {invites.filter((i) => i.role === 'patient').map((i) => (
          <div className="prof__care-row prof__care-row--invite" key={i.id}>
            <div className="prof__care-id">
              <span className="prof__care-name">{i.email}</span>
              <span className="prof__care-tag">invited to Lichen</span>
            </div>
            <div className="prof__care-actions">
              <button className="prof__care-btn prof__care-btn--ok" onClick={() => sendInviteEmail(i.email, 'patient')}>Send email</button>
              <button className="prof__care-btn" onClick={() => copyInvite(i.email)}>Copy</button>
              <button className="prof__care-btn" onClick={() => cancelInvite(i.id)}>Cancel</button>
            </div>
          </div>
        ))}
        <div className="prof__add-row">
          <input className="prof__input" type="email" value={patientEmail}
            onChange={(e) => { setPatientEmail(e.target.value); setCareMsg(''); }}
            placeholder="Offer to care for someone by email" />
          <button className="btn btn-primary" onClick={() => inviteCare('patient', patientEmail)}
            disabled={careBusy || !patientEmail.trim()}>Offer</button>
        </div>
        {careMsg && <p className="prof__care-msg">{careMsg}</p>}
      </section>

      {SPACE_SECTIONS.map((sec) => {
        const mine = spaces.filter((s) => s.kind === sec.kind);
        const article = /^[aeiou]/i.test(sec.one) ? 'an' : 'a';
        return (
          <section className="prof__section" key={sec.kind}>
            <h2 className="prof__h2">{sec.title}</h2>
            {mine.length === 0 && <p className="prof__empty">None yet.</p>}
            <div className="prof__spaces">
              {mine.map((s) => {
                const canEdit = s.role === 'admin' || s.role === 'super_admin';
                return (
                  <div className="prof__space" key={s.id}>
                    <input
                      className="prof__space-name"
                      value={s.name}
                      readOnly={!canEdit}
                      onChange={(e) => editLocalName(s.id, e.target.value)}
                      onBlur={(e) => { if (canEdit) renameSpace(s.id, e.target.value); }}
                    />
                    <span className="prof__space-role">{ROLE_LABEL[s.role]}</span>
                    <button
                      className="prof__space-open"
                      onClick={() => navigate(`/spaces/${s.id}`)}
                      aria-label={`Open ${s.name}'s profile`}
                    >
                      <Icon name="chevron-right" size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="prof__add-row">
              <input
                className="prof__input"
                value={newNames[sec.kind]}
                onChange={(e) => setNewNames((m) => ({ ...m, [sec.kind]: e.target.value }))}
                placeholder={'Name your ' + sec.one}
              />
              <button
                className="btn btn-primary"
                onClick={() => addSpace(sec.kind)}
                disabled={addingKind === sec.kind || !newNames[sec.kind].trim()}
              >
                {addingKind === sec.kind ? 'Adding...' : `Add ${article} ${sec.one}`}
              </button>
            </div>
          </section>
        );
      })}

      <div className="prof__signout">
        <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
