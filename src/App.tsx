import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Home from './routes/Home';
import SpacesDirectory from './routes/SpacesDirectory';
import Mycelium from './routes/Mycelium';
import MyceliumDirectory from './routes/MyceliumDirectory';
import Bookings from './routes/Bookings';
import BookSession from './routes/BookSession';
import Marketplace from './routes/Marketplace';
import Concierge from './routes/Concierge';
import Caregiver from './routes/Caregiver';
import CarePostComposer from './routes/CarePostComposer';
import Directory from './routes/Directory';
import Chat from './routes/Chat';
import ChatThread from './routes/ChatThread';
import Donate from './routes/Donate';
import Saved from './routes/Saved';
import CollectionPage from './routes/CollectionPage';

// mapbox-gl is heavy — the Maps screen loads as its own chunk on first visit.
const MapView = lazy(() => import('./routes/MapView'));
import Calendar from './routes/Calendar';
import EventComposer from './routes/EventComposer';
import CalendarSettings from './routes/CalendarSettings';
import Events from './routes/Events';
import EventPage from './routes/EventPage';
import Profile from './routes/Profile';
import SpaceProfile from './routes/SpaceProfile';
import MemberProfile from './routes/MemberProfile';
import SignUp from './routes/SignUp';
import Login from './routes/Login';
import ResetPassword from './routes/ResetPassword';
import Onboarding from './routes/Onboarding';
import AdminCategories from './routes/AdminCategories';
import AdminSupporters from './routes/AdminSupporters';
import Invite from './routes/Invite';
import Help from './routes/Help';
import Membership from './routes/Membership';
import Compose from './routes/Compose';
import SmartSearch from './routes/SmartSearch';
import AreaFeed from './routes/AreaFeed';
import BottomNav from './components/BottomNav';
import TopBar from './components/TopBar';
import SideMenu from './components/SideMenu';
import InstallPrompt from './components/InstallPrompt';
import { useAuth } from './auth/AuthProvider';
import { supabase } from './lib/supabase';
import { CollectPromptProvider } from './collections/CollectPrompt';

// Reachable without a membership: auth flows, the paywall itself, and Help
// (a member with a payment problem must be able to reach support).
const GATE_EXEMPT = ['/login', '/signup', '/reset-password', '/onboarding', '/membership', '/help'];

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const isChatThread = /^\/chat\/[^/]+/.test(pathname);
  const isAuth = pathname === '/login' || pathname === '/signup' || pathname === '/onboarding';
  const isMaps = pathname === '/maps';   // full-bleed map, no scroll padding
  const navigate = useNavigate();
  const { user, loading, onboarded, isAdmin } = useAuth();
  useEffect(() => {
    if (loading || onboarded === null) return;
    if (user && onboarded === false && !isAuth) {
      navigate('/onboarding', { replace: true });
    }
  }, [user, loading, onboarded, isAuth, pathname, navigate]);

  // MEMBERSHIP GATE (2026-07-15, founder): Lichen is a membership — every
  // non-admin needs an active subscription (Stripe, or gifted — either from
  // /admin/supporters or riding an admin's invitation). Checked per
  // navigation with a session cache; the cache stays empty until a
  // subscription exists, so the check re-runs and picks up a fresh
  // Stripe-webhook write the moment they leave /membership. past_due keeps
  // access (Stripe's retry window). Before turning anyone away, we redeem
  // any membership gift waiting on their email — an invited person walks
  // straight in without ever seeing the paywall.
  const memberOk = useRef(false);
  const endingNoticed = useRef(false);
  useEffect(() => {
    if (memberOk.current || loading || !user || onboarded !== true || isAdmin) return;
    if (GATE_EXEMPT.some((p) => pathname === p || pathname.startsWith(p + '/'))) return;
    let live = true;
    (async () => {
      const { data } = await supabase.from('subscriptions')
        .select('status, source, current_period_end').eq('profile_id', user.id).maybeSingle();
      const sub = data as { status: string; source: string; current_period_end: string | null } | null;
      // Gifts can be time-boxed ("a year of Lichen") — an ended gift no
      // longer passes. Stripe rows keep their own lifecycle via status.
      const giftAlive = !sub || sub.source !== 'gift'
        || !sub.current_period_end || new Date(sub.current_period_end) > new Date();
      let ok = !!sub && ['active', 'past_due'].includes(sub.status) && giftAlive;
      if (!ok) {
        const { data: claimed } = await supabase.rpc('claim_membership_gift');
        ok = ((claimed as number | null) ?? 0) > 0;
      }
      if (ok) {
        memberOk.current = true;
        // Time-boxed gift? Let the DB decide whether an ending-soon warning
        // is due (it self-dedupes to one per gift window).
        if (sub?.source === 'gift' && sub.current_period_end && !endingNoticed.current) {
          endingNoticed.current = true;
          void supabase.rpc('notice_gift_ending').then(() => {}, () => {});
        }
      } else if (live) navigate('/membership', { replace: true });
    })();
    return () => { live = false; };
  }, [user, loading, onboarded, isAdmin, pathname, navigate]);

  return (
    <CollectPromptProvider>
    <div className="app-shell">
      <ScrollToTop />
      {!isChatThread && !isAuth && <TopBar onMenu={() => setMenuOpen(true)} />}
      <main className="scroll-view" style={isChatThread || isAuth || isMaps ? { padding: 0, minHeight: 0 } : undefined}>
        <Routes>
          <Route path="/"          element={<Navigate to="/home" replace />} />
          <Route path="/home"      element={<Home />} />
          <Route path="/concierge"      element={<Concierge />} />
          <Route path="/concierge/client/:patientId"           element={<Concierge />} />
          <Route path="/concierge/client/:patientId/wow/edit"  element={<CarePostComposer kind="wow" />} />
          <Route path="/concierge/client/:patientId/koc/edit"  element={<CarePostComposer kind="koc" />} />
          <Route path="/concierge/client/:patientId/:tab"      element={<Concierge />} />
          <Route path="/concierge/:tab" element={<Concierge />} />
          <Route path="/caregiver"      element={<Caregiver />} />
          <Route path="/directory"      element={<Directory />} />
          <Route path="/chat"      element={<Chat />} />
          <Route path="/chat/:id"  element={<ChatThread />} />
          <Route path="/calendar"  element={<Calendar />} />
          <Route path="/calendar/new" element={<EventComposer />} />
          <Route path="/calendar/edit/:eventId" element={<EventComposer />} />
          <Route path="/calendar/settings" element={<CalendarSettings />} />
          <Route path="/saved"     element={<Saved />} />
          <Route path="/collections/:id" element={<CollectionPage />} />
          <Route path="/maps"      element={
            <Suspense fallback={<div className="scroll-view"><p style={{ padding: 'var(--s-6)', color: 'var(--ink-muted)' }}>Loading map…</p></div>}>
              <MapView />
            </Suspense>
          } />
          <Route path="/profile"   element={<Profile />} />
          <Route path="/spaces/:id" element={<SpaceProfile />} />
          <Route path="/members/:id" element={<MemberProfile />} />
          <Route path="/invite"    element={<Invite />} />
          <Route path="/help"      element={<Help />} />
          <Route path="/membership" element={<Membership />} />
          <Route path="/compose"   element={<Compose />} />
          <Route path="/search"    element={<SmartSearch />} />
          <Route path="/login"     element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/signup"    element={<SignUp />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/admin/categories" element={<AdminCategories />} />
          <Route path="/admin/supporters" element={<AdminSupporters />} />

          {/* Mycelium — your full network */}
          <Route path="/mycelium"        element={<Mycelium />} />
          <Route path="/mycelium/directory" element={<MyceliumDirectory />} />
          <Route path="/bookings"        element={<Bookings />} />
          <Route path="/book/:typeId"    element={<BookSession />} />
          <Route path="/mycelium/:type"  element={<Mycelium />} />

          {/* Communities — feed per community */}
          <Route path="/communities"      element={<SpacesDirectory kind="community" />} />
          {/* Legacy /community path — redirect */}
          <Route path="/community"        element={<Navigate to="/communities" replace />} />

          {/* Groups — feed per group */}
          <Route path="/groups"      element={<SpacesDirectory kind="group" />} />

          {/* Marketplace */}
          <Route path="/market"        element={<Marketplace />} />
          {/* Legacy kind tabs (goods/services/…) — one market now */}
          <Route path="/market/:kind"  element={<Navigate to="/market" replace />} />

          {/* Donate */}
          <Route path="/donate" element={<Donate />} />

          {/* Side-menu passages — placeholders */}
          <Route path="/organizations" element={<SpacesDirectory kind="organization" />} />
          <Route path="/places"   element={<SpacesDirectory kind="place" />} />
          <Route path="/work"     element={
            <AreaFeed area="work" icon="briefcase" crumb="Work"
              title="Lichen" italic="Work."
              sub="Help wanted, help offered. Hourly, project-based, and apprenticeships."
              addLabel="Post work" emptyHint="Be the first — offer your hands or ask for help." />
          } />
          <Route path="/art"      element={
            <AreaFeed area="art" icon="palette" crumb="Art"
              title="Lichen" italic="Art."
              sub="What members make — image, sound, word, and craft."
              addLabel="Share art" emptyHint="Be the first — share something you made." mediaLenses />
          } />
          <Route path="/food"     element={
            <AreaFeed area="food" icon="fork-spoon" crumb="Food"
              title="Lichen" italic="Food."
              sub="Meals, harvests, recipes, and nourishment."
              addLabel="Share food" emptyHint="Be the first — share a harvest, a recipe, a meal." mediaLenses />
          } />
          <Route path="/events"   element={<Events />} />
          {/* /events/mine must precede /events/:postId or "mine" is read as a post id */}
          <Route path="/events/mine" element={<Events />} />
          <Route path="/events/:postId" element={<EventPage />} />
          <Route path="/courses"  element={
            <AreaFeed area="courses" icon="graduation-cap" crumb="Courses"
              title="Lichen" italic="Courses."
              sub="Trainings, workshops, apprenticeships — taught by people your web can vouch for."
              addLabel="Teach" emptyHint="Be the first — tap Teach and offer a course or training." mediaLenses />
          } />
          <Route path="/library"  element={
            <AreaFeed area="library" icon="book" crumb="Library"
              title="Lichen" italic="Library."
              sub="Essays, field guides, and zines on land, food, and care."
              addLabel="Contribute" emptyHint="Be the first — tap Contribute and share a piece worth keeping." mediaLenses collections />
          } />

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
      {!isChatThread && !isAuth && <BottomNav />}
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      {!isChatThread && !isAuth && <InstallPrompt />}
    </div>
    </CollectPromptProvider>
  );
}
