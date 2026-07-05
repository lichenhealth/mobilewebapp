import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Home from './routes/Home';
import Community from './routes/Community';
import CommunityList from './routes/CommunityList';
import Group from './routes/Group';
import GroupList from './routes/GroupList';
import Mycelium from './routes/Mycelium';
import Marketplace from './routes/Marketplace';
import Concierge from './routes/Concierge';
import Caregiver from './routes/Caregiver';
import CarePostComposer from './routes/CarePostComposer';
import Directory from './routes/Directory';
import Chat from './routes/Chat';
import ChatThread from './routes/ChatThread';
import Donate from './routes/Donate';
import { Saved, Maps } from './routes/Stubs';
import Calendar from './routes/Calendar';
import EventComposer from './routes/EventComposer';
import CalendarSettings from './routes/CalendarSettings';
import Events from './routes/Events';
import EventPage from './routes/EventPage';
import Profile from './routes/Profile';
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
import Placeholder from './routes/Placeholder';
import BottomNav from './components/BottomNav';
import TopBar from './components/TopBar';
import SideMenu from './components/SideMenu';
import InstallPrompt from './components/InstallPrompt';
import { useAuth } from './auth/AuthProvider';

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
  const navigate = useNavigate();
  const { user, loading, onboarded } = useAuth();
  useEffect(() => {
    if (loading || onboarded === null) return;
    if (user && onboarded === false && !isAuth) {
      navigate('/onboarding', { replace: true });
    }
  }, [user, loading, onboarded, isAuth, pathname, navigate]);

  return (
    <div className="app-shell">
      <ScrollToTop />
      {!isChatThread && !isAuth && <TopBar onMenu={() => setMenuOpen(true)} />}
      <main className="scroll-view" style={isChatThread || isAuth ? { padding: 0, minHeight: 0 } : undefined}>
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
          <Route path="/maps"      element={<Maps />} />
          <Route path="/profile"   element={<Profile />} />
          <Route path="/invite"    element={<Invite />} />
          <Route path="/help"      element={<Help />} />
          <Route path="/membership" element={<Membership />} />
          <Route path="/compose"   element={<Compose />} />
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
          <Route path="/communities"      element={<CommunityList />} />
          <Route path="/communities/:id"  element={<Community />} />
          {/* Legacy /community path — redirect */}
          <Route path="/community"        element={<Navigate to="/communities/mons-sana" replace />} />

          {/* Groups — feed per group */}
          <Route path="/groups"      element={<GroupList />} />
          <Route path="/groups/:id"  element={<Group />} />

          {/* Marketplace */}
          <Route path="/market"        element={<Marketplace />} />
          <Route path="/market/:kind"  element={<Marketplace />} />

          {/* Donate */}
          <Route path="/donate" element={<Donate />} />

          {/* Side-menu passages — placeholders */}
          <Route path="/organizations" element={<Placeholder title="Organizations" icon="user-multiple" intro="Practices, nonprofits, and businesses rooted in the network." hint="Coming soon" />} />
          <Route path="/places"   element={<Placeholder title="Places"   icon="location"       intro="Spaces members open up — kitchens, studios, libraries, fields." hint="Coming soon" />} />
          <Route path="/work"     element={<Placeholder title="Work"     icon="briefcase"      intro="Help wanted, help offered. Hourly, project-based, and apprenticeships." hint="Coming soon" />} />
          <Route path="/events"   element={<Events />} />
          {/* /events/mine must precede /events/:postId or "mine" is read as a post id */}
          <Route path="/events/mine" element={<Events />} />
          <Route path="/events/:postId" element={<EventPage />} />
          <Route path="/library"  element={<Placeholder title="Library"  icon="book"           intro="Essays, field guides, and zines on land, food, and care." hint="Coming soon" />} />

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
      {!isChatThread && !isAuth && <BottomNav />}
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      {!isChatThread && !isAuth && <InstallPrompt />}
    </div>
  );
}
