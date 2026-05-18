import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './routes/Home';
import Community from './routes/Community';
import Concierge from './routes/Concierge';
import { Chat, Calendar, Saved, Maps, Profile } from './routes/Stubs';
import Placeholder from './routes/Placeholder';
import BottomNav from './components/BottomNav';
import TopBar from './components/TopBar';
import SideMenu from './components/SideMenu';
import InstallPrompt from './components/InstallPrompt';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <ScrollToTop />
      <TopBar onMenu={() => setMenuOpen(true)} />
      <main className="scroll-view">
        <Routes>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home"      element={<Home />} />
          <Route path="/community" element={<Community />} />
          <Route path="/concierge" element={<Concierge />} />
          <Route path="/chat"      element={<Chat />} />
          <Route path="/calendar"  element={<Calendar />} />
          <Route path="/saved"     element={<Saved />} />
          <Route path="/maps"      element={<Maps />} />
          <Route path="/profile"   element={<Profile />} />

          {/* Side-menu passages — placeholders until pass 2 */}
          <Route path="/places"   element={<Placeholder title="Places"   icon="location"       intro="Spaces members open up — kitchens, studios, libraries, fields." hint="Coming in pass two" />} />
          <Route path="/market"   element={<Placeholder title="Market"   icon="store"          intro="Local goods at fair prices. Trusted sellers only — no rankings, no ads." hint="Coming in pass two" />} />
          <Route path="/work"     element={<Placeholder title="Work"     icon="briefcase"      intro="Help wanted, help offered. Hourly, project-based, and apprenticeships." hint="Coming in pass two" />} />
          <Route path="/events"   element={<Placeholder title="Events"   icon="sparkle"        intro="Mostly in-person. Workshops, suppers, gatherings on the land." hint="Coming in pass two" />} />
          <Route path="/library"  element={<Placeholder title="Library"  icon="book"           intro="Essays, field guides, and zines on land, food, and care." hint="Coming in pass two" />} />
          <Route path="/groups"   element={<Placeholder title="Groups"   icon="graduation-cap" intro="Smaller circles within the network — closed by default, open when you ask." hint="Coming in pass two" />} />
          <Route path="/mycelium" element={<Placeholder title="Mycelium" icon="sparkle"        intro="The underlayer of the network — connections, threads, the long memory." hint="Coming in pass two" />} />

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      <InstallPrompt />
    </div>
  );
}
