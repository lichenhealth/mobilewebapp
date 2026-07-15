import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Home from './routes/Home';
import SpacesDirectory from './routes/SpacesDirectory';
import Mycelium from './routes/Mycelium';
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
import { CollectPromptProvider } from './collections/CollectPrompt';

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
  const { user, loading, onboarded } = useAuth();
  useEffect(() => {
    if (loading || onboarded === null) return;
    if (user && onboarded === false && !isAuth) {
      navigate('/onboarding', { replace: true });
    }
  }, [user, loading, onboarded, isAuth, pathname, navigate]);

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
