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
import Chat from './routes/Chat';
import ChatThread from './routes/ChatThread';
import Donate from './routes/Donate';
import { Calendar, Saved, Maps } from './routes/Stubs';
import Profile from './routes/Profile';
import SignUp from './routes/SignUp';
import Login from './routes/Login';
import Onboarding from './routes/Onboarding';
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
      {/* TEMP DEBUG — remove after diagnosing */}
      <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 99999, background: '#111', color: '#3f6', font: '11px monospace', padding: '3px 7px', opacity: 0.9 }}>
        onb={String(onboarded)} usr={user ? 'y' : 'n'} ld={String(loading)} auth={String(isAuth)} {pathname}
      </div>
      <ScrollToTop />
      {!isChatThread && !isAuth && <TopBar onMenu={() => setMenuOpen(true)} />}
      <main className="scroll-view" style={isChatThread || isAuth ? { padding: 0, minHeight: 0 } : undefined}>
        <Routes>
          <Route path="/"          element={<Navigate to="/home" replace />} />
          <Route path="/home"      element={<Home />} />
          <Route path="/concierge"      element={<Concierge />} />
          <Route path="/concierge/:tab" element={<Concierge />} />
          <Route path="/chat"      element={<Chat />} />
          <Route path="/chat/:id"  element={<ChatThread />} />
          <Route path="/calendar"  element={<Calendar />} />
          <Route path="/saved"     element={<Saved />} />
          <Route path="/maps"      element={<Maps />} />
          <Route path="/profile"   element={<Profile />} />
          <Route path="/login"     element={<Login />} />
          <Route path="/signup"    element={<SignUp />} />
          <Route path="/onboarding" element={<Onboarding />} />

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
          <Route path="/places"   element={<Placeholder title="Places"   icon="location"       intro="Spaces members open up — kitchens, studios, libraries, fields." hint="Coming soon" />} />
          <Route path="/work"     element={<Placeholder title="Work"     icon="briefcase"      intro="Help wanted, help offered. Hourly, project-based, and apprenticeships." hint="Coming soon" />} />
          <Route path="/events"   element={<Placeholder title="Events"   icon="sparkle"        intro="Mostly in-person. Workshops, suppers, gatherings on the land." hint="Coming soon" />} />
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
