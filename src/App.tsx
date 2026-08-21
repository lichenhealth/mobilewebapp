import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import Home from './routes/Home';
import SpacesDirectory from './routes/SpacesDirectory';
import Mycelium from './routes/Mycelium';
import MyceliumDirectory from './routes/MyceliumDirectory';
import Privacy from './routes/Privacy';
import Terms from './routes/Terms';
import Bookings from './routes/Bookings';
import BookSession from './routes/BookSession';
import Marketplace from './routes/Marketplace';
import Concierge, { FinancialProfilePage } from './routes/Concierge';
import Caregiver from './routes/Caregiver';
import CarePostComposer from './routes/CarePostComposer';
import Directory from './routes/Directory';
import IdentityPage, { IdentitiesDirectory } from './routes/Identities';
import Chat from './routes/Chat';
import ChatThread from './routes/ChatThread';
import Donate from './routes/Donate';
import DonateHow from './routes/DonateHow';
import Giving from './routes/Giving';
import Saved from './routes/Saved';
import BookPublic from './routes/BookPublic';
import GuestBooking from './routes/GuestBooking';
import Organize from './routes/Organize';
import PostPage from './routes/PostPage';
import CollectionPage from './routes/CollectionPage';

// mapbox-gl is heavy — the Maps screen loads as its own chunk on first visit.
const MapView = lazy(() => import('./routes/MapView'));
import Calendar from './routes/Calendar';
import EventComposer from './routes/EventComposer';
import CalendarSettings from './routes/CalendarSettings';
import Events from './routes/Events';
import EventPage from './routes/EventPage';
import GuestEvent from './routes/GuestEvent';
// AboutLichen retired as a live route (founder 2026-08-04): /about is now the
// static merged marketing page (public/about, weave design). Any in-app
// navigate('/about') lands on this redirector, which hard-loads so the
// server's filesystem-first static file wins over the SPA.
/** /members/:id/about → the profile's About tab. */
function MemberAboutRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/members/${id}`} replace />;
}

function StaticAboutRedirect() {
  useEffect(() => { window.location.replace('/about'); }, []);
  return null;
}
import Profile from './routes/Profile';
import SpaceProfile from './routes/SpaceProfile';
import MemberProfile from './routes/MemberProfile';
import SignUp from './routes/SignUp';
import InviteDecline from './routes/InviteDecline';
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
import { ConfirmProvider } from './components/ConfirmDialog';
import AssistantBrief from './routes/AssistantBrief';
import AssistantFeed from './routes/AssistantFeed';
import Snapshot from './routes/Snapshot';
import SpaceByHandle from './routes/SpaceByHandle';
import FrontDoor from './routes/FrontDoor';
import { hostSpaceHandle } from './lib/customDomain';
import ReminderAlerts from './components/ReminderAlerts';
import { PullToRefresh } from './components/PullToRefresh';

// Reachable without a membership: auth flows, the paywall itself, and Help
// (a member with a payment problem must be able to reach support).
function BookGate() {
  const { param = '' } = useParams();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(param)
    ? <BookSession />
    : <BookPublic />;
}

const GATE_EXEMPT = ['/login', '/signup', '/invite/decline', '/reset-password', '/onboarding', '/membership', '/help', '/privacy', '/terms', '/donate', '/e', '/b', '/book', '/about'];

/** Client-side "/" for signed-out visitors → the static marketing homepage. */
function GoWelcome() {
  useEffect(() => { window.location.replace('/welcome/'); }, []);
  return null;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // #root is the app's scroller (the document itself is pinned — see
    // global.css); fall back to window for safety.
    (document.getElementById('root') ?? window).scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname]);
  return null;
}

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, search } = useLocation();
  const isChatThread = /^\/chat\/[^/]+/.test(pathname);
  const isAuth = pathname === '/login' || pathname === '/signup' || pathname === '/onboarding' || pathname === '/invite/decline';
  const isGuest = pathname.startsWith('/e/') || pathname.startsWith('/b/');   // external guest landing — no app chrome
  // Rendered INSIDE a frame — the page beside the assistant conversation
  // (docs/ASSISTANT_ACTIONS.md step 4). Without this the frame shows a whole
  // second app: two top bars, two bottom navs, two identity switchers. The
  // point is to see the PAGE, so the chrome around it stands down.
  const isEmbed = new URLSearchParams(search).get('embed') === '1';
  const customHandle = hostSpaceHandle();        // this hostname IS a space's website
  const isAbout = pathname === '/about';         // About page has its own header
  const isMaps = pathname === '/maps';   // full-bleed map, no scroll padding
  const navigate = useNavigate();
  const { user, loading, onboarded, isAdmin, reconnecting } = useAuth();
  useEffect(() => {
    if (loading || onboarded === null) return;
    if (user && onboarded === false && !isAuth) {
      navigate('/onboarding', { replace: true });
    }
  }, [user, loading, onboarded, isAuth, pathname, navigate]);

  // Signed-out visitors are readers, not app users (founder 2026-07-30):
  // the desktop sidebar hides on EVERY page for them (CSS scopes to >=1024;
  // the mobile drawer still works via the hamburger).
  useEffect(() => {
    // RECONNECTING IS NOT SIGNED OUT (2026-08-14): stripping the app's chrome
    // from a member whose session is merely unreachable is what made them
    // think they'd been logged out.
    document.documentElement.classList.toggle('is-signed-out', !loading && !user && !reconnecting);
    return () => document.documentElement.classList.remove('is-signed-out');
  }, [user, loading, reconnecting]);

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

  // Invite claim (founder 2026-07-28): the signup page parked the token;
  // claiming weaves inviter and invitee into each other's web. This used to
  // live inside the membership gate below, which never runs for admins, for
  // anyone mid-onboarding, or on gate-exempt paths — real joiners stayed
  // "open" on /invite forever (2026-08-11 audit). Now it runs the moment a
  // session exists, and the token only leaves localStorage once the RPC
  // SUCCEEDS, so one network blip doesn't lose the claim for good.
  // (Email-matching invites are claimed server-side at signup regardless —
  // this token path is for people who signed up under a different address.)
  useEffect(() => {
    if (!user) return;
    const invTok = localStorage.getItem('lichen-invite-token');
    if (!invTok) return;
    void supabase.rpc('claim_invite', { p_token: invTok }).then(
      () => localStorage.removeItem('lichen-invite-token'),
      () => {},
    );
  }, [user]);

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
      if (!ok) {
        // Growth phase (founder 2026-07-23): auto-gift 3 months of Concierge (the
        // full tier) the first time a member would hit the paywall. Grants once
        // (never re-grants after it lapses — the sub row stays), so month 3 lands
        // on /membership to pick a plan.
        const { data: granted } = await supabase.rpc('grant_growth_gift');
        ok = granted === true;
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
    <ConfirmProvider>
    <CollectPromptProvider>
    <div className="app-shell">
      <ScrollToTop />
      <ReminderAlerts />
      {!isChatThread && !isAuth && !isGuest && !isAbout && !isEmbed && <TopBar onMenu={() => setMenuOpen(true)} />}
      <main className="scroll-view" style={isChatThread || isAuth || isMaps || isGuest || isAbout || isEmbed ? { padding: 0, minHeight: 0 } : undefined}>
        {/* Full-bleed pages manage their own fixed layout (chat's pinned
            input, the map canvas) — a pull gesture growing the page above
            them would fight that, so this only mounts on normal pages. */}
        {!isChatThread && !isAuth && !isMaps && !isGuest && !isAbout && <PullToRefresh />}
        {customHandle ? (
          /* CUSTOM DOMAIN (founder 2026-07-29): this hostname belongs to a
             space — every path serves its website; the app lives on Lichen's
             own domain (PublicPage links cross back via appUrl). */
          <Routes>
            <Route path="*" element={<SpaceByHandle handle={customHandle} forcePublic />} />
          </Routes>
        ) : (
        <Routes>
          {/* THE FRONT DOOR (founder 2026-07-29): a signed-out visitor at the
              root gets Lichen's own public page — the same template every
              member's site uses; members go straight to Home. */}
          {/* Prod "/": the server 307s to /welcome (the static marketing
              homepage) before the SPA ever loads; this route only fires on
              CLIENT-side navigations to "/" — hand those to the server too.
              Dev keeps FrontDoor (no vercel redirects locally). */}
          <Route path="/" element={
            loading ? <div /> : user ? <Navigate to="/home" replace />
              : import.meta.env.PROD ? <GoWelcome /> : <FrontDoor />
          } />
          <Route path="/home"      element={<Home />} />
          <Route path="/concierge"      element={<Concierge />} />
          <Route path="/concierge/financial" element={<FinancialProfilePage />} />
          <Route path="/concierge/client/:patientId"           element={<Concierge />} />
          {/* No :patientId = your own board — the WOW self-entry door. */}
          <Route path="/concierge/wow/edit" element={<CarePostComposer kind="wow" />} />
          <Route path="/concierge/client/:patientId/wow/edit"  element={<CarePostComposer kind="wow" />} />
          <Route path="/concierge/client/:patientId/koc/edit"  element={<CarePostComposer kind="koc" />} />
          <Route path="/concierge/client/:patientId/:tab"      element={<Concierge />} />
          <Route path="/concierge/:tab" element={<Concierge />} />
          <Route path="/caregiver"      element={<Caregiver />} />
          <Route path="/directory"      element={<Directory />} />
          <Route path="/identities"     element={<IdentitiesDirectory />} />
          <Route path="/identities/:id" element={<IdentityPage />} />
          <Route path="/chat"      element={<Chat />} />
          <Route path="/chat/:id"  element={<ChatThread />} />
          <Route path="/calendar"  element={<Calendar />} />
          <Route path="/calendar/new" element={<EventComposer />} />
          <Route path="/calendar/edit/:eventId" element={<EventComposer />} />
          <Route path="/calendar/settings" element={<CalendarSettings />} />
          <Route path="/posts/:postId" element={<PostPage />} />
          {/* Drive (founder 2026-08-14) — /saved stays as an alias for old
              links and muscle memory. */}
          <Route path="/drive"     element={<Saved />} />
          <Route path="/saved"     element={<Saved />} />
          <Route path="/assistant" element={<AssistantBrief />} />
          <Route path="/assistant/feed" element={<AssistantFeed />} />
          <Route path="/snapshot" element={<Snapshot />} />
          {/* Clean addresses: /countrymanstables → that space's page. Static
              routes outrank this by React Router's own ranking, so it only
              catches names nothing else claims. */}
          {/* Legacy marketing-site addresses (retired 2026-07-29) — the
              essays and resources live on as public Library content, so old
              inbound links and search results keep landing somewhere real. */}
          <Route path="/mission" element={<Navigate to="/about" replace />} />
          <Route path="/vision" element={<Navigate to="/about" replace />} />
          {/* /ourstory ships as a REAL static page now (founder 2026-08-03 —
              the marketing homepage's Our Story button needed a real
              destination); filesystem-first beats this route in prod, kept
              only as a dev-server fallback. */}
          <Route path="/ourstory" element={<Navigate to="/about" replace />} />
          <Route path="/social-networks" element={<Navigate to="/about" replace />} />
          <Route path="/care-model" element={<Navigate to="/about" replace />} />
          <Route path="/safety" element={<Navigate to="/about" replace />} />
          <Route path="/platform" element={<Navigate to="/about" replace />} />
          <Route path="/conscious-economy" element={<Navigate to="/about" replace />} />
          <Route path="/business" element={<Navigate to="/about" replace />} />
          <Route path="/opportunity" element={<Navigate to="/about" replace />} />
          <Route path="/pilot" element={<Navigate to="/about" replace />} />
          {/* Essays + bookshelf hidden until the Library is ready (founder
              2026-07-31) — old content links rest on /about meanwhile. */}
          <Route path="/blog" element={<Navigate to="/about" replace />} />
          <Route path="/resources" element={<Navigate to="/about" replace />} />
          {/* /founders-circle + /get-involved are REAL static marketing pages
              now (Shape A) — served filesystem-first by Vercel, so no client
              redirects; the SPA never sees those URLs in production. */}
          <Route path="/:handle" element={<SpaceByHandle />} />
          <Route path="/organize"  element={<Organize />} />
          <Route path="/collections/:id" element={<CollectionPage />} />
          <Route path="/maps"      element={
            <Suspense fallback={<div className="scroll-view"><p style={{ padding: 'var(--s-6)', color: 'var(--ink-muted)' }}>Loading map…</p></div>}>
              <MapView />
            </Suspense>
          } />
          <Route path="/profile"   element={<Profile />} />
          <Route path="/spaces/:id" element={<SpaceProfile />} />
          <Route path="/members/:id" element={<MemberProfile />} />
          {/* The separate About page is retired (founder 2026-08-05) — its bio
              and offerings are the profile's own About and Services tabs now.
              The route survives so shared links don't 404. */}
          <Route path="/members/:id/about" element={<MemberAboutRedirect />} />
          <Route path="/invite"    element={<Invite />} />
          <Route path="/help"      element={<Help />} />
          <Route path="/membership" element={<Membership />} />
          <Route path="/compose"   element={<Compose />} />
          <Route path="/search"    element={<SmartSearch />} />
          <Route path="/login"     element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/signup"    element={<SignUp />} />
          <Route path="/invite/decline" element={<InviteDecline />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/admin/categories" element={<AdminCategories />} />
          <Route path="/admin/supporters" element={<AdminSupporters />} />

          {/* Mycelium — your full network */}
          <Route path="/privacy"         element={<Privacy />} />
          <Route path="/terms"           element={<Terms />} />
          <Route path="/mycelium"        element={<Mycelium />} />
          <Route path="/mycelium/directory" element={<MyceliumDirectory />} />
          <Route path="/bookings"        element={<Bookings />} />
                    {/* /book/<uuid> = a member's slot picker; /book/<handle> = the
              PUBLIC booking page (founder 2026-08-14, the Calendly
              replacement). One path, disambiguated by shape. */}
          <Route path="/book/:param" element={<BookGate />} />
          <Route path="/b/:token" element={<GuestBooking />} />
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
          <Route path="/donate/how" element={<DonateHow />} />
          <Route path="/giving" element={<Giving />} />

          {/* Side-menu passages — placeholders */}
          <Route path="/organizations" element={<SpacesDirectory kind="organization" />} />
          <Route path="/places"   element={<SpacesDirectory kind="place" />} />
          <Route path="/work"     element={
            <AreaFeed area="work" icon="briefcase" crumb="Work"
              title="Lichen" italic="Work."
              sub="Help wanted, help offered. Hourly, project-based, and apprenticeships."
              addLabel="Post work" emptyHint="Be the first — offer your hands or ask for help."
              browse browseStyle="rows" />
          } />
          <Route path="/art"      element={
            <AreaFeed area="art" icon="palette" crumb="Art"
              title="Lichen" italic="Art."
              sub="What members make — images, sound, words, and crafts."
              addLabel="Share art" emptyHint="Be the first — share something you made." mediaLenses />
          } />
          <Route path="/food"     element={
            <AreaFeed area="food" icon="fork-spoon" crumb="Food"
              title="Lichen" italic="Food."
              sub="Meals, harvests, recipes, and nourishment."
              addLabel="Share food" emptyHint="Be the first — share a harvest, a recipe, a meal." mediaLenses />
          } />
          <Route path="/travel"   element={
            <AreaFeed area="travel" icon="plane" crumb="Travel"
              title="Lichen" italic="Travel."
              sub="Stays, rides, and getting there together — with people your web knows."
              addLabel="Offer or seek" emptyHint="Be the first — offer a stay, a ride, or say where you're headed." browse />
          } />
          <Route path="/events"   element={<Events />} />
          {/* /events/mine must precede /events/:postId or "mine" is read as a post id */}
          <Route path="/events/mine" element={<Events />} />
          <Route path="/events/:postId" element={<EventPage />} />
          <Route path="/e/:token" element={<GuestEvent />} />
          <Route path="/about" element={<StaticAboutRedirect />} />
          <Route path="/courses"  element={
            <AreaFeed area="courses" icon="graduation-cap" crumb="Courses"
              title="Lichen" italic="Courses."
              sub="Trainings, workshops, apprenticeships — taught by people your web can vouch for."
              addLabel="Teach" emptyHint="Be the first — tap Teach and offer a course or training."
              mediaLenses structuredKind="course" browse />
          } />
          <Route path="/library"  element={
            <AreaFeed area="library" icon="book" crumb="Library"
              title="Lichen" italic="Library."
              sub="Essays, field guides, and zines on land, food, and care."
              addLabel="Contribute" emptyHint="Be the first — tap Contribute and share a piece worth keeping."
              mediaLenses collections structuredKind="path" browse />
          } />

          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
        )}
      </main>
      {!isChatThread && !isAuth && !isGuest && !isAbout && !isEmbed && <BottomNav />}
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
      {/* The install nudge lives IN Home's page now, not floating over every
          screen (founder 2026-08-17: it covered two listing tiles). See
          Home.tsx — an invitation belongs where you land, once, in the flow. */}
    </div>
    </CollectPromptProvider>
    </ConfirmProvider>
  );
}
