import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { listGuardianQueue, approveAsGuardian, cancelExchange, type Exchange } from '../lib/exchangeApi';
import {
  listMyBeings, createBeing, ENTITY_KINDS,
  type Being, type EntityKind, type EntityAspect,
} from '../lib/stewardshipApi';
import { getIdentityTags, saveIdentityTags } from '../lib/meansApi';
import { ensureDirectChat } from '../lib/chatApi';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { loadMyPhone } from '../lib/conciergeApi';
import {
  loadCareLinks, inviteCare as careInvite, approveCare as careApprove,
  removeCare as careRemove, cancelCareInvite as careCancelInvite,
  copyCareInvite, sendCareInviteEmail, type CareStatus,
} from '../lib/careTeamApi';
import Avatar from '../components/Avatar';
import { Icon } from '../components/Icon';
import HomeLocationSection from '../components/HomeLocationSection';
import CurrentcyCard from '../components/CurrentcyCard';
import { uploadAvatar } from '../lib/avatarApi';
import CategoryPicker, { type Category } from '../components/CategoryPicker';
import { currentPushState, enablePush, disablePush, type PushState } from '../lib/webPush';
import './Profile.css';
import { useLocation, useSearchParams } from 'react-router-dom';
import { offerCareFor } from '../lib/careTeamApi';
import ContactFields, { type ContactInfo, type ContactSuggestion } from '../components/ContactFields';
import { listMyBookingTypes } from '../lib/bookingApi';
import { APP_ORIGIN } from '../lib/customDomain';
import PageTabsEditor from '../components/PageTabsEditor';
import CollapsibleSection from '../components/CollapsibleSection';
import ContactActionsPicker from '../components/ContactActionsPicker';
import CoverPicker from '../components/CoverPicker';
import BuildModeSplit, { FillWithClaude } from '../components/BuildModeSplit';
import type { PageTab } from '../lib/pageTabs';
import { type PageMeta } from '../components/PublicPage';

type SpaceKind = 'organization' | 'community' | 'group' | 'place';
type SpaceRole = 'super_admin' | 'admin' | 'member';
type MySpace = { id: string; name: string; kind: SpaceKind; role: SpaceRole };
type NotifPref = 'off' | 'in_app' | 'both';

type ProfileRow = { created_at: string; full_name: string | null; first_name: string | null; last_name: string | null; headline: string | null; bio: string | null; notification_pref?: NotifPref; avatar_url: string | null };
type MemberRow = { role: SpaceRole; spaces: { id: string; name: string; kind: SpaceKind } | null };
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

// "Tue–Sat, 9am–5pm · Sun, 10am–2pm" from availability windows —
// consecutive weekdays sharing a range collapse into one span.
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtMin(m: number): string {
  const h = Math.floor(m / 60), mm = m % 60;
  const h12 = ((h + 11) % 12) + 1;
  const ap = h < 12 ? 'am' : 'pm';
  return mm ? `${h12}:${String(mm).padStart(2, '0')}${ap}` : `${h12}${ap}`;
}
function formatWeeklyHours(ws: { weekday: number; start_min: number; end_min: number }[]): string {
  if (!ws.length) return '';
  const byDay = new Map<number, string>();
  ws.forEach((w) => {
    const r = `${fmtMin(w.start_min)}–${fmtMin(w.end_min)}`;
    byDay.set(w.weekday, byDay.has(w.weekday) ? `${byDay.get(w.weekday)!} & ${r}` : r);
  });
  const days = [1, 2, 3, 4, 5, 6, 0]; // Monday-first reading order
  const parts: string[] = [];
  let i = 0;
  while (i < days.length) {
    const r = byDay.get(days[i]);
    if (!r) { i++; continue; }
    let j = i;
    while (j + 1 < days.length && byDay.get(days[j + 1]) === r) j++;
    parts.push(`${DAY_ABBR[days[i]]}${j > i ? `–${DAY_ABBR[days[j]]}` : ''}, ${r}`);
    i = j + 1;
  }
  return parts.join(' · ');
}

export default function Profile() {
  const { user, loading, isAdmin } = useAuth();
  const { actor, refreshSelf } = useActing();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  // Beings you steward — hidden until the stewardship migration lands.
  const [beings, setBeings] = useState<Being[]>([]);
  const [minors, setMinors] = useState<{ id: string; full_name: string | null; is_adult: boolean }[]>([]);
  const [gQueue, setGQueue] = useState<Exchange[]>([]);
  const loadGQueue = () => { void listGuardianQueue().then(setGQueue); };
  const [beingsOn, setBeingsOn] = useState(false);
  const [beingName, setBeingName] = useState('');
  const [beingKind, setBeingKind] = useState<EntityKind>('animal');
  const [beingAspect, setBeingAspect] = useState<EntityAspect>('individual');
  const [beingBusy, setBeingBusy] = useState(false);
  const [beingMsg, setBeingMsg] = useState('');
  const [fullName, setFullName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  // Public identity tags ("Firefighter, Veteran") — comma-entered, chip-shown;
  // what gift-targeted offers will one day match against. Fetched separately
  // so the page keeps working before the column migration runs.
  const [identity, setIdentity] = useState('');
  const [notifPref, setNotifPref] = useState<NotifPref>('in_app');
  const [pushState, setPushState] = useState<PushState>('off');
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState('');
  const [caps, setCaps] = useState<string[]>([]);
  const [spaces, setSpaces] = useState<MySpace[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [serviceCats, setServiceCats] = useState<string[]>([]);
  const [goodCats, setGoodCats] = useState<string[]>([]);
  const [placeCats, setPlaceCats] = useState<string[]>([]);
  const [tier, setTier] = useState<{ tier: string; source: string } | null>(null);

  const [loadingData, setLoadingData] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [newNames, setNewNames] = useState<Record<SpaceKind, string>>({
    organization: '', community: '', group: '', place: '',
  });
  const [addingKind, setAddingKind] = useState<SpaceKind | null>(null);
  const [error, setError] = useState('');

  const [pendingCats, setPendingCats] = useState(0);
  const [care, setCare] = useState<CareRow[]>([]);
  const [invites, setInvites] = useState<{ id: string; email: string; role: 'caregiver' | 'patient' }[]>([]);
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
      supabase.from('categories').select('*').order('sort', { ascending: true }),
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
      void getIdentityTags(user.id).then((tags) => setIdentity(tags.join(', ')));
      setNotifPref(p.notification_pref ?? 'in_app');
      // '*' select elsewhere would be heavy; read this one on its own so the
      // page keeps working before the column exists.
      void supabase.from('profiles').select('findable').eq('id', user.id).maybeSingle()
        .then(({ data: f }) => {
          const v = (f as { findable?: boolean } | null)?.findable;
          if (typeof v === 'boolean') setFindable(v);   // pre-migration: stays on
        }, () => {});
      void supabase.from('profiles').select('assistant_readable').eq('id', user.id).maybeSingle()
        .then(({ data: ar }) => {
          const v = (ar as { assistant_readable?: boolean } | null)?.assistant_readable;
          if (typeof v === 'boolean') setAssistantReadable(v);
        });
    }
    setPhone(myPhone);
    const cRows = (cRes.data as { capability: string }[] | null) ?? [];
    setCaps(cRows.map((r) => r.capability));
    const mRows = (mRes.data as MemberRow[] | null) ?? [];
    setSpaces(mRows.filter((r) => r.spaces).map((r) => ({
      id: r.spaces!.id, name: r.spaces!.name, kind: r.spaces!.kind, role: r.role,
    })));
    setCategories(((catRes.data as Category[] | null) ?? []));
    const pcRows = (pcRes.data as { category_id: string; categories: { domain: 'good' | 'service' | 'place' } | null }[] | null) ?? [];
    setServiceCats(pcRows.filter((r) => r.categories?.domain === 'service').map((r) => r.category_id));
    setGoodCats(pcRows.filter((r) => r.categories?.domain === 'good').map((r) => r.category_id));
    setPlaceCats(pcRows.filter((r) => r.categories?.domain === 'place').map((r) => r.category_id));
    setTier((subRes.data as { tier: string; source: string } | null) ?? null);
    setLoadingData(false);
  }, [user]);

  const loadCare = useCallback(async () => {
    if (!user) return;
    const { links, invites: inv } = await loadCareLinks();
    setCare(links);
    setInvites(inv);
  }, [user]);

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (user) { loadAll(); loadCare(); }
  }, [user, loading, navigate, loadAll, loadCare]);

  // Beings you steward — the section stays hidden pre-migration.
  useEffect(() => {
    if (!user) return;
    let live = true;
    void supabase.from('profiles').select('kind').limit(1).then(({ error }) => {
      if (!live || error) return;   // columns not there yet
      setBeingsOn(true);
      void listMyBeings(user.id).then((b) => { if (live) setBeings(b); });
      void supabase.rpc('my_minors').then(({ data, error: e2 }) => {
        if (!live || e2) return;
        setMinors((data as { id: string; full_name: string | null; is_adult: boolean }[] | null) ?? []);
      });
      void listGuardianQueue().then((q) => { if (live) setGQueue(q); });
    });
    return () => { live = false; };
  }, [user]);

  // Admin badge: how many category suggestions are waiting for review.
  useEffect(() => {
    if (!isAdmin) return;
    supabase.from('category_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPendingCats(count ?? 0));
  }, [isAdmin]);

  async function inviteCare(role: 'caregiver' | 'patient', emailRaw: string) {
    if (!user) return;
    setCareMsg(''); setCareBusy(true);
    const res = await careInvite(role, emailRaw);
    setCareBusy(false);
    setCareMsg(res.message);
    if (res.ok) {
      if (role === 'patient') setPatientEmail('');
      loadCare();
    }
  }

  async function approveCare(id: string) {
    setError('');
    try { await careApprove(id); loadCare(); } catch (e) { setError((e as Error).message); }
  }
  async function removeCare(id: string) {
    setError('');
    try { await careRemove(id); loadCare(); } catch (e) { setError((e as Error).message); }
  }
  async function cancelInvite(id: string) {
    setError('');
    try { await careCancelInvite(id); loadCare(); } catch (e) { setError((e as Error).message); }
  }
  async function copyInvite(email: string) {
    setCareMsg(await copyCareInvite(email));
  }
  async function sendInviteEmail(email: string, role: 'caregiver' | 'patient') {
    setCareMsg('Sending…');
    setCareMsg(await sendCareInviteEmail(email, role, fullName));
  }

  // A #fragment lands you at the section you came for (the caregiver
  // dashboard's "Manage who you care for" → #care-for). React Router leaves
  // fragments alone, so scroll once the section exists.
  // Offer to care for someone (founder 2026-07-28) — they approve first.
  // Consent travels with your words (founder 2026-07-28): may other members'
  // assistants read what you wrote in shared conversations?
  const [assistantReadable, setAssistantReadable] = useState(true);
  // Findable by other members — on by default, like every other consent here.
  const [findable, setFindable] = useState(true);
  // Content defaults (founder 2026-08-05): pre-select Compose's per-post
  // AI-readable / downloadable toggles. Null until loaded (pre-migration →
  // stays null, group hidden).
  const [contentDefaults, setContentDefaults] = useState<{ ai: boolean; dl: boolean } | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    void supabase.from('profiles')
      .select('content_ai_default, content_download_default')
      .eq('id', user.id).maybeSingle()
      .then(({ data, error: e }) => {
        if (!live || e || !data) return;
        const r = data as { content_ai_default?: boolean; content_download_default?: boolean };
        setContentDefaults({ ai: r.content_ai_default !== false, dl: r.content_download_default !== false });
      });
    return () => { live = false; };
  }, [user]);
  async function updateContentDefault(key: 'ai' | 'dl', next: boolean) {
    if (!user || !contentDefaults) return;
    const prior = contentDefaults;
    setContentDefaults({ ...contentDefaults, [key]: next });
    const { error: e } = await supabase.from('profiles')
      .update(key === 'ai' ? { content_ai_default: next } : { content_download_default: next })
      .eq('id', user.id);
    if (e) { setError(e.message); setContentDefaults(prior); }
  }
  // "From Lichen" contact suggestions (founder 2026-08-11): what the app
  // already knows, offered under empty Contact & hours fields as one-tap
  // chips — never auto-filled, because that section is PUBLIC and these
  // values live in more private scopes until the tap says otherwise.
  const [contactSuggs, setContactSuggs] = useState<Partial<Record<keyof ContactInfo, ContactSuggestion[]>>>({});
  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      const [btRes, awRes, blRes] = await Promise.all([
        listMyBookingTypes(user.id),
        supabase.from('availability_windows').select('weekday, start_min, end_min, kind').eq('profile_id', user.id).eq('kind', 'available'),
        supabase.from('profile_locations').select('label, location').eq('profile_id', user.id).order('created_at'),
      ]);
      if (!live) return;
      const suggs: Partial<Record<keyof ContactInfo, ContactSuggestion[]>> = {};
      if (user.email) suggs.email = [{ label: user.email, value: user.email }];
      if (phone.trim()) suggs.phone = [{ label: phone.trim(), value: phone.trim() }];
      const bookables = btRes.filter((b) => b.active && b.audience === 'everyone');
      if (bookables.length) {
        suggs.booking = bookables.slice(0, 2).map((b) => ({
          label: `Your Lichen booking page — ${b.title}`,
          value: `${APP_ORIGIN}/book/${b.id}`,
        }));
      }
      const windows = (awRes.data as { weekday: number; start_min: number; end_min: number }[] | null) ?? [];
      const hoursText = formatWeeklyHours(windows);
      if (hoursText) suggs.hours = [{ label: hoursText, value: hoursText }];
      const locs = (blRes.data as { label: string; location: string }[] | null) ?? [];
      if (locs.length) {
        suggs.address = locs.slice(0, 3).map((l) => ({
          label: l.label ? `${l.label} — ${l.location}` : l.location,
          value: l.location,
        }));
      }
      setContactSuggs(suggs);
    })();
    return () => { live = false; };
  }, [user, phone]);

  // Web of Wellbeing sharing (founder 2026-08-11): the financial picture
  // lives with the rest of your health info, care-team-only by default —
  // or fully private, understanding what can no longer be built on it.
  // The flag rides financial_positions (upserted here even before any
  // means data exists, so the choice always has somewhere to live).
  const [wowShared, setWowShared] = useState(true);
  useEffect(() => {
    if (!user) return;
    let live = true;
    void supabase.from('financial_positions')
      .select('care_team_visible').eq('profile_id', user.id).maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        const r = data as { care_team_visible?: boolean } | null;
        setWowShared(r ? r.care_team_visible !== false : true);
      });
    return () => { live = false; };
  }, [user]);
  async function updateWowShared(next: boolean) {
    if (!user) return;
    const prior = wowShared;
    setWowShared(next);
    const { error: e } = await supabase.from('financial_positions')
      .upsert({ profile_id: user.id, care_team_visible: next }, { onConflict: 'profile_id' });
    if (e) { setError(e.message); setWowShared(prior); }
  }
  // Three views of one profile (founder 2026-08-11 streamline): Admin is
  // the ONLY place you manage content — both kinds. Lichen View is the
  // internal experience (feed, marketplace, events); Public View is the
  // website layer of public tabs on top. The other two toggles just LOOK.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view');
  const [contact, setContact] = useState<ContactInfo>({});
  const [publicPage, setPublicPage] = useState(false);
  const [webMsg, setWebMsg] = useState('');
  const [pageMeta, setPageMeta] = useState<PageMeta>({});
  const setPage = (patch: Partial<PageMeta>) => setPageMeta((m) => ({ ...m, ...patch }));
  // Your vanity address (founder 2026-08-03) — lichen.health/<handle>
  // resolves the same as a space's, via SpaceByHandle's fallback lookup.
  const [handle, setHandleState] = useState('');
  const [savedHandle, setSavedHandle] = useState('');
  useEffect(() => {
    if (!user) return;
    void supabase.from('profiles').select('contact, public_page, page, handle').eq('id', user.id).maybeSingle()
      .then(({ data }) => {
        const r = data as { contact?: ContactInfo | null; public_page?: boolean; page?: PageMeta | null; handle?: string | null } | null;
        if (r) {
          setContact(r.contact ?? {}); setPublicPage(!!r.public_page); setPageMeta(r.page ?? {});
          setHandleState(r.handle ?? ''); setSavedHandle(r.handle ?? '');
        }
      });
  }, [user]);
  const setHandle = (v: string) => setHandleState(v.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  async function saveWebPage() {
    if (!user) return;
    setWebMsg('');
    const h = handle.trim();
    const { error: e } = await supabase.from('profiles')
      .update({
        contact: Object.keys(contact).length ? contact : null,
        public_page: publicPage,
        page: Object.keys(pageMeta).length ? pageMeta : null,
        handle: h || null,
      })
      .eq('id', user.id);
    if (e) {
      setWebMsg(e.code === '23505' ? 'That address is taken — try another.' : e.message);
    } else {
      setSavedHandle(h);
      setWebMsg('Saved.');
    }
  }
  async function updateFindable(next: boolean) {
    if (!user) return;
    setFindable(next);
    const { error: e } = await supabase.from('profiles')
      .update({ findable: next }).eq('id', user.id);
    if (e) { setError(e.message); setFindable(!next); }
  }

  async function updateAssistantReadable(next: boolean) {
    if (!user) return;
    setAssistantReadable(next);
    const { error: e } = await supabase.from('profiles')
      .update({ assistant_readable: next }).eq('id', user.id);
    if (e) { setError(e.message); setAssistantReadable(!next); }
  }

  const [offerQ, setOfferQ] = useState('');
  const [offerHits, setOfferHits] = useState<{ id: string; full_name: string | null }[]>([]);
  const [offerMsg, setOfferMsg] = useState('');
  useEffect(() => {
    const q = offerQ.trim();
    if (q.length < 2) { setOfferHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name').ilike('full_name', `%${q}%`).eq('onboarded', true).limit(6);
      if (live) setOfferHits(((data as { id: string; full_name: string | null }[] | null) ?? [])
        .filter((m) => m.id !== user?.id));
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [offerQ, user?.id]);

  const { hash } = useLocation();
  // Each section opens inline, click to edit, then collapses back down
  // (founder 2026-08-10: reusing the manual-search criteria pattern) —
  // independent, not exclusive-accordion, so more than one can stay open.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) => setOpenSections((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // Care team / people you care for / young people you hold / beings you
  // steward all live inside one "Concierge" accordion item now (founder's
  // profile-features spreadsheet, 2026-08-10) — their old standalone
  // anchors still work, they just open the shared parent instead.
  const SECTION_ALIAS: Record<string, string> = { 'care-for': 'concierge', holding: 'concierge', stewarding: 'concierge' };
  useEffect(() => {
    if (!hash) return;
    const id = hash.slice(1);
    const openKey = SECTION_ALIAS[id] ?? id;
    setOpenSections((s) => (s.has(openKey) ? s : new Set(s).add(openKey)));
    let tries = 0;
    const tick = window.setInterval(() => {
      const el = document.getElementById(id);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); window.clearInterval(tick); }
      if (++tries > 20) window.clearInterval(tick);
    }, 100);
    return () => window.clearInterval(tick);
  }, [hash]);

  // Legacy deep link: /profile?view=web used to be its own segmented view —
  // it's the "Public page" section inside Admin now (founder 2026-08-11).
  useEffect(() => {
    if (view !== 'web') return;
    setOpenSections((s) => (s.has('public-page') ? s : new Set(s).add('public-page')));
    setSearchParams({}, { replace: true });
  }, [view, setSearchParams]);

  // Your whole experience follows who you're acting as (founder 2026-08-10):
  // Profile is always the settings page for whoever the TopBar says you are.
  // Acting as a space lands you on ITS backstage instead of your own — the
  // acting-as options are themselves built from spaces you admin, so
  // backstage is always reachable. Skip it when a hash is present: deep
  // links like /profile#privacy and /profile#care-for are always about the
  // person, not whatever they're acting as.
  useEffect(() => {
    if (!hash && actor.type === 'space') navigate(`/spaces/${actor.id}?manage=1`, { replace: true });
  }, [actor, hash, navigate]);

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
    // Identity tags ride the same Save — quietly skipped pre-migration.
    await saveIdentityTags(identity.split(',').map((t) => t.trim()).filter(Boolean));
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

  // Phone push is per-DEVICE (a browser subscription), not a stored pref.
  useEffect(() => { void currentPushState().then(setPushState); }, []);

  async function togglePush() {
    if (!user || pushBusy) return;
    setPushBusy(true); setPushMsg('');
    try {
      if (pushState === 'on') { await disablePush(user.id); setPushState('off'); }
      else { await enablePush(user.id); setPushState('on'); setPushMsg('This device will now get phone alerts.'); }
    } catch (e) {
      setPushMsg((e as Error).message || 'Could not change device notifications.');
    } finally {
      setPushBusy(false);
      setTimeout(() => setPushMsg(''), 6000);
    }
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
  async function setCatsForDomain(domain: 'good' | 'service' | 'place', ids: string[]) {
    if (!user) return;
    setError('');
    const prev = domain === 'service' ? serviceCats : domain === 'good' ? goodCats : placeCats;
    const added = ids.filter((x) => !prev.includes(x));
    const removed = prev.filter((x) => !ids.includes(x));
    if (domain === 'service') setServiceCats(ids);
    else if (domain === 'good') setGoodCats(ids);
    else setPlaceCats(ids);
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
    <div className="prof is-adminview">
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
          <span className={'prof__tier' + (isAdmin && tier.source === 'gift' ? ' prof__tier--admin' : '')}>
            {tier.tier === 'concierge' ? 'Concierge' : 'Community'} member
            {tier.source === 'gift' ? ' · gifted' : ''}
          </span>
        )}
      </div>

      <div className="view-toggle-row view-toggle-row--center">
        <span className="view-toggle" role="group" aria-label="View">
          <button className="view-toggle__side view-toggle__side--admin is-on">
            Admin
          </button>
          <button className="view-toggle__side" onClick={() => navigate(`/members/${user?.id}`)}>
            Lichen View
          </button>
          <button className="view-toggle__side" onClick={() => navigate(`/members/${user?.id}?preview=1`)}>
            Public View
          </button>
        </span>
        <span className="prof__selfhint">
          Manage everything here &mdash; only you see this page.
        </span>
      </div>

      {error && <p className="prof__error">{error}</p>}

      {/* Public View content (founder 2026-08-11): the website layer of
          public tabs — managed HERE like everything else, viewed via the
          Public View toggle. Leads the accordion, same as a space
          backstage's Public Profile Builder. */}
      <CollapsibleSection id="public-page" title="Public page" open={openSections.has('public-page')} onToggle={() => toggleSection('public-page')}>
          <p className="prof__care-lead">
            This is what someone finds when they search your name or follow a link — no Lichen
            account needed. Everything deeper (recommending you, booking, messaging, your
            events) invites them to join.
          </p>

          {/* The fork (founder 2026-08-11): fill it in yourself, or hand it
              to Claude. Manual stands as the default — the form is right
              below — so the AI option teaches itself without blocking. */}
          <BuildModeSplit back="/profile#public-page" />


          <label className="prof__consent">
            <input type="checkbox" checked={publicPage} onChange={(e) => setPublicPage(e.target.checked)} />
            <span>
              <strong>Publish my page to the open web</strong>
              <em>
                Off by default. When on, your name, headline, story, offerings and the contact
                details below can be read by anyone — including search engines. Your location,
                calendar, messages and everything else stay exactly as private as they are now.
              </em>
            </span>
          </label>

          <div className="prof__field">
            <label className="prof__label">Your address</label>
            <div className="prof__handle">
              <span className="prof__handle-prefix">lichen.health/</span>
              <input className="prof__input" value={handle} onChange={(e) => setHandle(e.target.value)}
                placeholder="yourname" />
            </div>
            <p className="prof__hint">
              Letters, numbers and dashes only. Leave it blank and your page lives at{' '}
              <code>/members/{user?.id?.slice(0, 8)}…</code> instead.
            </p>
          </div>

          <p className="prof__privacy-sub">Your page</p>
          <div className="prof__field">
            <label className="prof__label">One line — what you do, for whom</label>
            <input className="prof__input" value={pageMeta.tagline ?? ''}
              onChange={(e) => setPage({ tagline: e.target.value })}
              placeholder="Equine-assisted healing in the Colorado foothills" />
          </div>
          <div className="prof__field">
            <label className="prof__label">Home summary — what greets a visitor</label>
            <textarea
              className="prof__textarea"
              value={pageMeta.homeSummary ?? ''}
              onChange={(e) => setPage({ homeSummary: e.target.value })}
              placeholder="A short welcome for the front page — your whole story still lives on About."
            />
            <FillWithClaude back="/profile#public-page" label="Have Claude write this from my story" />
            <p className="prof__hint">
              Leave it empty and Home opens with the first two paragraphs of your story.
            </p>
          </div>

          <div className="prof__field">
            <label className="prof__label">Your story</label>
            <textarea className="prof__textarea prof__story" value={pageMeta.story ?? ''}
              onChange={(e) => setPage({ story: e.target.value })}
              placeholder="Write it the way you'd tell a neighbor. A few short paragraphs is plenty." />
            <FillWithClaude back="/profile#public-page" label="Fill out my story with Claude" />
            <p className="prof__hint">
              Rather talk it through?{' '}
              <button
                className="prof__inline-link"
                onClick={() => navigate('/assistant?section=profile&ask=' + encodeURIComponent(
                  'Help me draft the story for my public page. Use what you already know about me on Lichen — my headline, bio, and what I offer. Before you send this, feel free to add anything else: a website to read, a length ("140 characters"), a tone.',
                ))}
              >
                Draft it with Claude
              </button>{' '}
              — the ask arrives ready to send, or add to it first.
            </p>
          </div>
          <div className="prof__field">
            <label className="prof__label">How do you want people to get in touch</label>
            <ContactActionsPicker
              value={pageMeta.actions
                ?? (pageMeta.action && pageMeta.action.kind !== 'none' ? [pageMeta.action.kind] : [])}
              onChange={(actions) => setPage({ actions })}
              contact={contact}
              onContact={(patch) => setContact((c) => ({ ...c, ...patch }))}
            />
          </div>
          <div className="prof__field">
            <label className="prof__label">Look</label>
            <div className="cmp__chips">
              {([['plain', 'Plain'], ['photo', 'Photo cover']] as const).map(([v, label]) => (
                <button key={v}
                  className={'cmp__chip' + ((pageMeta.coverStyle ?? 'plain') === v ? ' is-on' : '')}
                  onClick={() => setPage({ coverStyle: v })}>{label}</button>
              ))}
            </div>
            {pageMeta.coverStyle === 'photo' && user && (
              <CoverPicker
                value={pageMeta.cover}
                onChange={(cover) => setPage({ cover })}
                pos={pageMeta.coverPos}
                onPos={(coverPos) => setPage({ coverPos })}
                uploaderId={user.id}
                authorId={user.id}
                extraPhotos={pageMeta.photos ?? []}
              />
            )}
          </div>

          {/* The feed is a Lichen thing; the open web only sees it if you
              say so (founder 2026-08-11) — and even then About greets a
              visitor first. */}
          <label className="prof__consent">
            <input
              type="checkbox"
              checked={pageMeta.showPosts === true}
              onChange={(e) => setPage({ showPosts: e.target.checked })}
            />
            <span>
              <strong>Show my feed on my public page</strong>
              <em>
                Off, your posts stay inside Lichen and visitors see your tabs.
                On, they can read your public posts too — as a page to read,
                not to act on: recommending, saving and messaging need an
                account. Either way, visitors land on About first.
              </em>
            </span>
          </label>

          <p className="prof__privacy-sub">Your page&rsquo;s tabs</p>
          <PageTabsEditor
            tabs={pageMeta.tabs ?? []}
            onChange={(tabs: PageTab[]) => setPage({ tabs })}
            photos={pageMeta.photos ?? []}
            onPhotos={(photos: string[]) => setPage({ photos })}
            uploaderId={user?.id}
            sections={pageMeta.sections}
            onSections={(sections) => setPage({ sections: sections as PageMeta['sections'] })}
          />

          <p className="prof__privacy-sub">Contact &amp; hours</p>
          <ContactFields
            value={contact}
            onChange={setContact}
            lead="How someone reaches you without joining Lichen. Leave a field empty to keep it off the page."
            suggestions={contactSuggs}
          />

          <div className="prof__save-row">
            <button className="btn btn-primary" onClick={() => void saveWebPage()}>Save</button>
            <button className="btn" onClick={() => window.open(
              savedHandle ? `/${savedHandle}?preview=1` : `/members/${user?.id}?preview=1`, '_blank')}>
              Preview
            </button>
            {publicPage && (
              <button
                className="btn"
                onClick={() => {
                  const path = savedHandle ? `/${savedHandle}` : `/members/${user?.id}`;
                  void navigator.clipboard.writeText(`${window.location.origin}${path}`)
                    .then(() => setWebMsg('Link copied.'));
                }}
              >
                Copy link
              </button>
            )}
            {webMsg && <span className="prof__msg">{webMsg}</span>}
          </div>

      </CollapsibleSection>


      <CollapsibleSection id="about" title="About you" open={openSections.has('about')} onToggle={() => toggleSection('about')}>
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
        <div className="prof__field">
          <label className="prof__label">Identity</label>
          <input
            className="prof__input"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="Public identities, comma-separated — Firefighter, Veteran, Nurse…"
          />
          <p className="prof__hint">Shown on your public profile. Offers gifted to an identity (&ldquo;Gift to First Responders&rdquo;) will find you through these.</p>
        </div>
        <div className="prof__save-row">
          <button className="btn btn-primary" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? 'Saving...' : 'Save'}
          </button>
          {profileMsg && <span className="prof__msg">{profileMsg}</span>}
        </div>
      </CollapsibleSection>

      {/* Privacy: the one place that answers "who can see what, and what can
          AI assist with" (founder 2026-07-28). Settings whose subject lives
          elsewhere keep living there — this hub owns the homeless ones and
          points at the rest, so nothing is hidden and nothing is duplicated. */}
      <CollapsibleSection id="privacy" title="Privacy" open={openSections.has('privacy')} onToggle={() => toggleSection('privacy')}>
        {/* Founder's wording, 2026-08-11 — keep verbatim. */}
        <p className="prof__care-lead">
          Who can see what. What you&rsquo;re comfortable sharing with your AI
          assistant. Almost everything is on by default but yours to switch
          off, if you&rsquo;d prefer!
        </p>

        <p className="prof__privacy-sub">Being found</p>
        <label className="prof__consent">
          <input
            type="checkbox"
            checked={findable}
            onChange={(e) => void updateFindable(e.target.checked)}
          />
          <span>
            <strong>Findable by other members</strong>
            <em>
              On, you appear in the member directory, in search, and when someone
              types a name. Off, you don&rsquo;t. People you already share a space,
              a chat, a care team or your web with still see you, and your name
              still shows on anything you post publicly.
            </em>
          </span>
        </label>

        <p className="prof__privacy-sub">What the assistant may read</p>
        <label className="prof__consent">
          <input
            type="checkbox"
            checked={assistantReadable}
            onChange={(e) => void updateAssistantReadable(e.target.checked)}
          />
          <span>
            <strong>Let other members&rsquo; assistants read my messages</strong>
            <em>
              When someone you talk with asks their assistant to brief them, it reads
              recent messages in that conversation — including yours. Switch this off and
              your words stay out of everyone else&rsquo;s briefings; they&rsquo;ll still see
              that you wrote, and can still read you in the app. Your own assistant is
              unaffected.
            </em>
          </span>
        </label>
        <p className="prof__hint">
          Your own assistant switches on and off per section — the brain icon on Home,
          Marketplace, Calendar, Chat and your shelf each carry their own choice.
        </p>

        {contentDefaults && (
          <>
            <p className="prof__privacy-sub">Your content — defaults for new posts</p>
            <label className="prof__consent">
              <input type="checkbox" checked={contentDefaults.ai}
                onChange={(e) => void updateContentDefault('ai', e.target.checked)} />
              <span>
                <strong>New posts are AI-readable</strong>
                <em>Assistants may read and surface what you post. Each post can still flip this in Compose — this only sets the starting position.</em>
              </span>
            </label>
            <label className="prof__consent">
              <input type="checkbox" checked={contentDefaults.dl}
                onChange={(e) => void updateContentDefault('dl', e.target.checked)} />
              <span>
                <strong>New posts&rsquo; media is downloadable</strong>
                <em>People can save the photos and videos you share. Also flippable per post.</em>
              </span>
            </label>
          </>
        )}

        {/* "Your public profile" used to lead this list — retired 2026-08-11:
            the Lichen View / Public View toggles up top ARE that door now. */}
        <p className="prof__privacy-sub">Who can see what</p>
        <div className="prof__privacy-doors">
          {([
            ['Calendar sharing', 'Busy blocks, full details, or nothing — per audience', '/calendar/settings'],
            ['Presence', 'Around, present, or neither', '/mycelium/directory'],
            ['Web of Wellbeing', 'Your health & financial picture, in one place — never a score', '/concierge'],
          ] as [string, string, string][]).map(([label, sub, to]) => (
            <button key={label} className="prof__privacy-door" onClick={() => navigate(to)}>
              <span>
                <strong>{label}</strong>
                <em>{sub}</em>
              </span>
              <Icon name="chevron-right" size={13} />
            </button>
          ))}
        </div>

        {/* Money is sensitive, like AI (founder 2026-08-11): nobody HAS to
            share — what changes is only what can be built on it. */}
        <label className="prof__consent">
          <input
            type="checkbox"
            checked={wowShared}
            onChange={(e) => void updateWowShared(e.target.checked)}
          />
          <span>
            <strong>Share your Web of Wellbeing with your care team</strong>
            <em>
              On, your care team — and only them — can see your financial
              picture, so they can actually help with it: money conversations,
              financial coaching, job training, and Lichen&rsquo;s subsidies
              pool. Off, it&rsquo;s private to everyone. Like AI, money is
              sensitive — you never have to share it; switching off just means
              the help that&rsquo;s built on it can&rsquo;t reach you. Never a
              score, never visible to anyone else, either way.
            </em>
          </span>
        </label>
        <p className="prof__hint">
          New here?{' '}
          <button className="prof__inline-link" onClick={() => navigate('/collections/de300007-0000-4000-a000-000000000001')}>
            Settings 101
          </button>{' '}
          walks every switch in five minutes.
        </p>
      </CollapsibleSection>

      {user && (
        <CollapsibleSection id="location" title="Location" open={openSections.has('location')} onToggle={() => toggleSection('location')}>
          <HomeLocationSection me={user.id} />
        </CollapsibleSection>
      )}

      <CollapsibleSection id="notifications" title="Notifications" open={openSections.has('notifications')} onToggle={() => toggleSection('notifications')}>
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

        <div className="prof__push">
          <div className="prof__push-row">
            <div>
              <p className="prof__push-title">On this device</p>
              <p className="prof__push-sub">
                {pushState === 'unsupported'
                  ? 'This browser can’t show phone notifications.'
                  : pushState === 'denied'
                    ? 'Notifications are blocked in your browser settings.'
                    : 'Get lock-screen alerts even when Lichen is closed.'}
              </p>
            </div>
            <button
              type="button"
              className={'prof__push-toggle' + (pushState === 'on' ? ' is-on' : '')}
              onClick={togglePush}
              disabled={pushBusy || pushState === 'unsupported' || pushState === 'denied'}
              aria-pressed={pushState === 'on'}
            >
              {pushBusy ? '…' : pushState === 'on' ? 'On' : 'Off'}
            </button>
          </div>
          {pushMsg && <p className="prof__push-msg">{pushMsg}</p>}
        </div>
      </CollapsibleSection>

      <CollapsibleSection id="offer" title="Goods &amp; services you offer" open={openSections.has('offer')} onToggle={() => toggleSection('offer')}>
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
            <p className="prof__picker-lead">Services</p>
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
            <p className="prof__picker-lead">Goods</p>
            <CategoryPicker
              domain="good"
              categories={categories}
              selected={goodCats}
              onChange={(ids) => setCatsForDomain('good', ids)}
              userId={user.id}
            />
          </div>
        )}
        {/* Places & spaces need no capability chip — stewarding a venue or
            land is its own kind of offering (founder 2026-07-28). Renders
            only once place categories exist. */}
        {categories.some((c) => c.domain === 'place') && (
          <div className="prof__picker">
            <p className="prof__picker-lead">Places you steward</p>
            <CategoryPicker
              domain="place"
              categories={categories}
              selected={placeCats}
              onChange={(ids) => setCatsForDomain('place', ids)}
              userId={user.id}
            />
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="currentcy" title="Current-cy" open={openSections.has('currentcy')} onToggle={() => toggleSection('currentcy')}>
        <CurrentcyCard />
      </CollapsibleSection>

      <CollapsibleSection id="concierge" title="Concierge" open={openSections.has('concierge')} onToggle={() => toggleSection('concierge')}>
        <p className="prof__privacy-sub">Your care team</p>
        <p className="prof__care-lead">People who help care for you. They approve before joining.</p>
        <p className="prof__empty">
          {myTeam.length === 0
            ? 'No one on your care team yet.'
            : `${myTeam.length} ${myTeam.length === 1 ? 'person' : 'people'} on your care team.`}
        </p>
        <button className="prof__care-dash" onClick={() => navigate('/concierge/team?from=profile')}>
          Manage my care team
          <span aria-hidden="true"> →</span>
        </button>

        <p className="prof__privacy-sub" id="care-for">People you care for</p>
        <p className="prof__care-lead">Members who’ve added you as a caregiver, or whom you’ve offered to help.</p>
        <button className="prof__care-dash" onClick={() => navigate('/caregiver')}>
          Open caregiver dashboard
          <span aria-hidden="true"> →</span>
        </button>
        <div className="prof__offer">
          <input
            className="prof__input"
            value={offerQ}
            onChange={(e) => { setOfferQ(e.target.value); setOfferMsg(''); }}
            placeholder="Offer to care for someone — type their name…"
          />
          {offerHits.length > 0 && (
            <div className="prof__offer-hits">
              {offerHits.map((h) => (
                <button
                  key={h.id}
                  className="prof__offer-hit"
                  onClick={() => {
                    setOfferQ(''); setOfferHits([]);
                    void offerCareFor(h.id).then((r) => {
                      setOfferMsg(r.message);
                      if (r.ok) void loadCare();
                    });
                  }}
                >
                  {h.full_name ?? 'Member'} <em>Offer</em>
                </button>
              ))}
            </div>
          )}
          {offerMsg && <p className="prof__hint">{offerMsg}</p>}
          <p className="prof__hint">
            They decide — an offer arrives as &ldquo;wants to become a member of your care team.&rdquo;
          </p>
        </div>
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

      {minors.length > 0 && (
        <>
          <p className="prof__privacy-sub" id="holding">Young people you hold</p>
          <p className="prof__care-lead">
            They can offer what they make and keep what they earn. Buying, selling and
            meeting wait on your yes.
          </p>
          {gQueue.length > 0 && (
            <div className="prof__gq">
              <p className="prof__gq-lead">Waiting on your yes</p>
              {gQueue.map((x) => (
                <div className="prof__care-row" key={x.id}>
                  <div className="prof__care-id">
                    <span className="prof__care-name">
                      {x.mode === 'sale' || x.mode === 'sliding' ? 'A purchase' : 'An exchange'}
                      {x.amount > 0 ? ` · ${x.amount} Current-cy` : ''}
                    </span>
                    <span className="prof__care-tag">{x.note ?? 'no note'}</span>
                  </div>
                  <div className="prof__care-actions">
                    <button className="prof__care-btn prof__care-btn--ok"
                      onClick={() => void approveAsGuardian(x.id).then(loadGQueue)}>Approve</button>
                    <button className="prof__care-btn"
                      onClick={() => void cancelExchange(x.id).then(loadGQueue)}>Not now</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="prof__care-list">
            {minors.map((m) => (
              <div className="prof__care-row" key={m.id}>
                <div className="prof__care-id">
                  <span className="prof__care-name">{m.full_name ?? 'A young member'}</span>
                  {m.is_adult && <span className="prof__care-tag">now 18 — no longer held</span>}
                </div>
                <div className="prof__care-actions">
                  <button className="prof__care-btn" onClick={() => navigate(`/members/${m.id}`)}>Open</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Beings you steward (founder 2026-08-05). A therapy horse, a sacred
          plant, a river — real members with no login, who act through you.
          The section hides itself until the stewardship migration lands. */}
      {beingsOn && (
        <>
          <p className="prof__privacy-sub" id="stewarding">Beings you steward</p>
          <p className="prof__care-lead">
            Members who can&rsquo;t hold a password — an animal, a plant, a place, an
            element. They earn, hold and spend in their own name; you act for them.
          </p>
          {beings.length === 0 && <p className="prof__empty">You don&rsquo;t steward anyone yet.</p>}
          <div className="prof__care-list">
            {beings.map((b) => (
              <div className="prof__care-row" key={b.id}>
                <div className="prof__care-id">
                  <span className="prof__care-name">{b.full_name ?? 'A being'}</span>
                  <span className="prof__care-tag">
                    {b.kind}{b.steward_space_id ? ' · through a space you administer' : ''}
                  </span>
                </div>
                <div className="prof__care-actions">
                  <button className="prof__care-btn" onClick={() => navigate(`/members/${b.id}`)}>Open</button>
                </div>
              </div>
            ))}
          </div>
          <div className="prof__being-add">
            <input className="prof__input" value={beingName}
              onChange={(e) => { setBeingName(e.target.value); setBeingMsg(''); }}
              placeholder="Their name — Tango, Grandmother Saguaro…" />
            <div className="cmp__chips">
              {ENTITY_KINDS.map((k) => (
                <button key={k.value}
                  className={'cmp__chip' + (beingKind === k.value ? ' is-on' : '')}
                  onClick={() => setBeingKind(k.value)}>{k.label}</button>
              ))}
            </div>
            <div className="cmp__chips">
              {(['individual', 'collective'] as const).map((a) => (
                <button key={a}
                  className={'cmp__chip' + (beingAspect === a ? ' is-on' : '')}
                  onClick={() => setBeingAspect(a)}>
                  {a === 'individual' ? 'An individual' : 'A collective spirit'}
                </button>
              ))}
            </div>
            <p className="prof__hint">
              Tango is an individual; Huachuma is a collective. The question isn&rsquo;t
              plant or animal — it&rsquo;s one being or many acting as one.
            </p>
            <button className="btn btn-primary" disabled={beingBusy || !beingName.trim()}
              onClick={() => {
                setBeingBusy(true);
                void createBeing(beingName.trim(), beingKind, beingAspect)
                  .then(async (r) => {
                    setBeingMsg(r.message);
                    if (r.ok) { setBeingName(''); setBeings(await listMyBeings(meId)); }
                  })
                  .finally(() => setBeingBusy(false));
              }}>
              Weave them in
            </button>
            {beingMsg && <p className="prof__care-msg">{beingMsg}</p>}
          </div>
        </>
      )}
      </CollapsibleSection>

      {SPACE_SECTIONS.map((sec) => {
        const mine = spaces.filter((s) => s.kind === sec.kind);
        const article = /^[aeiou]/i.test(sec.one) ? 'an' : 'a';
        return (
          <CollapsibleSection key={sec.kind} id={sec.kind} title={sec.title} open={openSections.has(sec.kind)} onToggle={() => toggleSection(sec.kind)}>
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
          </CollapsibleSection>
        );
      })}

      {isAdmin && (
        <CollapsibleSection id="admin" title="Admin" open={openSections.has('admin')} onToggle={() => toggleSection('admin')}>
          <p className="prof__care-lead">Lichen-wide tools — only admins see this section.</p>
          <div className="prof__admin-rows">
            <button className="prof__admin-row" onClick={() => navigate('/admin/categories')}>
              <Icon name="sparkle" size={18} />
              <span>Review categories</span>
              {pendingCats > 0 && <em className="prof__admin-badge">{pendingCats}</em>}
              <span className="prof__admin-go" aria-hidden>→</span>
            </button>
            <button className="prof__admin-row" onClick={() => navigate('/admin/supporters')}>
              <Icon name="member-heart" size={18} />
              <span>Memberships &amp; gifts</span>
              <span className="prof__admin-go" aria-hidden>→</span>
            </button>
          </div>
        </CollapsibleSection>
      )}

      <div className="prof__signout">
        <button className="btn btn-ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
