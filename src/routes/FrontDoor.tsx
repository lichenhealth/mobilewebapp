import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LichenMark } from '../components/LichenMark';
import './FrontDoor.css';

// THE FRONT DOOR AS A TRUE WEBSITE (founder 2026-07-30): the marketing
// site's desktop-optimized layout reborn inside the app — wide heroes,
// side-by-side bands, a real footer — with the old mockups replaced by
// real renderings of the live platform, and join/sign-in CTAs intact.
// Copy is ported faithfully from the retired Astro site (founder-voiced).

const B = 'https://mjqnaevertyzgjlpwynr.supabase.co/storage/v1/object/public/avatars/1c01a063-5b05-41bb-ad61-916d7e454dbf/lichen';

const SHOTS = [
  { src: `${B}/app-home.png`, cap: 'Home — your whole life, one feed, no algorithm' },
  { src: `${B}/app-market.png`, cap: 'Marketplace — gift, trade, lend, sell; trust the trader, not the platform' },
  { src: `${B}/app-events.png`, cap: 'Events — gatherings with real RSVPs' },
  { src: `${B}/app-calendar.png`, cap: 'Calendar — everything has one' },
];

const SOCIALS = [
  ['Instagram', 'https://www.instagram.com/lichen.health/'],
  ['Facebook', 'https://www.facebook.com/lichen.health'],
  ['YouTube', 'https://www.youtube.com/@LichenHealth'],
  ['LinkedIn', 'https://www.linkedin.com/company/lichen-community'],
];

export default function FrontDoor() {
  const navigate = useNavigate();

  // A website, not the app: no Lichen chrome around this page.
  useEffect(() => {
    document.documentElement.classList.add('is-public-page');
    return () => document.documentElement.classList.remove('is-public-page');
  }, []);

  return (
    <div className="fdoor">
      {/* Site header — logo left, doors center, ways in right */}
      <header className="fdoor__head">
        <button className="fdoor__brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <LichenMark size={34} />
          <span>Lichen</span>
        </button>
        <nav className="fdoor__nav">
          <a href="/about">About</a>
          <a href="/collections/02aa2dee-f955-54e9-879e-2542a7552e5f">Essays</a>
          <a href="/collections/ea4ae9d1-a848-548e-83c6-7022cf81ea54">Resources</a>
          <a href="/donate">Give</a>
        </nav>
        <div className="fdoor__ways">
          <button className="fdoor__signin" onClick={() => navigate('/login')}>Sign in</button>
          <button className="fdoor__cta" onClick={() => navigate('/signup')}>Request an invitation</button>
        </div>
      </header>

      {/* Hero — the old homepage, image and words side by side */}
      <section className="fdoor__hero">
        <div className="fdoor__hero-copy">
          <div className="fdoor__hero-mark"><LichenMark size={84} /></div>
          <h1>Because healing the world starts with ourselves</h1>
          <p>
            We are a nonprofit on a mission to reduce human suffering and expand human
            consciousness, in community and in reciprocity with the land.
          </p>
          <div className="fdoor__hero-acts">
            <button className="fdoor__cta" onClick={() => navigate('/signup')}>Request an invitation</button>
            <button className="fdoor__ghost" onClick={() => navigate('/about')}>What is Lichen?</button>
          </div>
          <p className="fdoor__hero-note">
            Lichen grows by invitation — every member arrives through someone already here.
            Tell us who you are; a real person reads every note.
          </p>
        </div>
        <img className="fdoor__hero-img" src={`${B}/welcome-hero.jpg`} alt="" />
      </section>

      {/* Welcome — ancient wisdom meets modern medicine */}
      <section className="fdoor__band fdoor__band--split">
        <img className="fdoor__band-img" src={`${B}/hero-about.jpg`} alt="" loading="lazy" />
        <div className="fdoor__band-copy">
          <p className="fdoor__eyebrow">Welcome</p>
          <h2>Where ancient wisdom meets modern medicine</h2>
          <p>
            Galyn is a tech professional turned trauma therapist. After years of watching
            people heal themselves with proper resourcing and support, she felt called to
            found a social network that weaves earth wisdom with modern science and
            technology to bring community-based, earth-based, holistic functional
            medicine to all.
          </p>
          <a href="/ourstory">Our story →</a>
        </div>
      </section>

      {/* Care — you at the center */}
      <section className="fdoor__band fdoor__band--split fdoor__band--flip">
        <img className="fdoor__band-img" src={`${B}/hero-care.jpg`} alt="" loading="lazy" />
        <div className="fdoor__band-copy">
          <p className="fdoor__eyebrow">Care</p>
          <h2>Lichen puts you at the center of your care</h2>
          <p>
            Your care team assembles around you — weaving land, plants, animals,
            eco-spiritual practice, western medicine and naturopathic support into one
            coordinated web. Your Web of Wellbeing tracks what hinders your deepest
            healing; your Kaleidoscope of Care maps it to the mainstream medical system
            when you need to carry it elsewhere.
          </p>
          <a href="/care-model">The care model →</a>
        </div>
      </section>

      {/* The app — real renderings, not mockups */}
      <section className="fdoor__band fdoor__band--app">
        <p className="fdoor__eyebrow">The platform</p>
        <h2>Live today — not mockups, the real thing</h2>
        <p className="fdoor__band-sub">
          What the early drawings imagined, members now use every day.
        </p>
        <div className="fdoor__shots">
          {SHOTS.map((s) => (
            <figure key={s.src}>
              <img src={s.src} alt="" loading="lazy" />
              <figcaption>{s.cap}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* Essays + Resources */}
      <section className="fdoor__band fdoor__band--cards">
        <a className="fdoor__card" href="/collections/02aa2dee-f955-54e9-879e-2542a7552e5f">
          <img src={`${B}/hero-essays.jpg`} alt="" loading="lazy" />
          <div>
            <h3>The Lichen essays</h3>
            <p>Why Lichen exists — mission, story, the care model, and the economics of a better world.</p>
          </div>
        </a>
        <a className="fdoor__card" href="/collections/ea4ae9d1-a848-548e-83c6-7022cf81ea54">
          <img src={`${B}/hero-involved.jpg`} alt="" loading="lazy" />
          <div>
            <h3>The Lichen bookshelf</h3>
            <p>The books, talks and guides behind the work — trauma and healing, spirit, community, the living world.</p>
          </div>
        </a>
      </section>

      {/* Donate band */}
      <section className="fdoor__band fdoor__band--donate"
        style={{ backgroundImage: `linear-gradient(rgba(30,24,18,.45), rgba(30,24,18,.45)), url(${B}/hero-donate.jpg)` }}>
        <h2>Make a tax-deductible donation</h2>
        <p>
          Expand access to holistic, community-based care for all. Thank you for
          investing in a more balanced and healthy future.
        </p>
        <button className="fdoor__cta" onClick={() => navigate('/donate')}>Donate</button>
      </section>

      {/* Footer */}
      <footer className="fdoor__foot">
        <div className="fdoor__foot-brand">
          <LichenMark size={30} />
          <span>Lichen Health · a 501(c)(3) nonprofit</span>
        </div>
        <nav className="fdoor__foot-links">
          <a href="/about">About</a>
          <a href="/donate">Give</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/login">Sign in</a>
        </nav>
        <nav className="fdoor__foot-links">
          {SOCIALS.map(([label, href]) => (
            <a key={label} href={href} target="_blank" rel="noopener">{label}</a>
          ))}
        </nav>
        <p className="fdoor__foot-note">connect@lichen.health</p>
      </footer>
    </div>
  );
}
