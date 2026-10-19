import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LichenMark } from '../components/LichenMark';
import { Icon } from '../components/Icon';
import './Intro.css';

/* THE WELCOME FLIGHT (founder 2026-10-18: "an onboarding flow, like a flight
 * of cards that explain the platform… think of a Canva invite, but with a
 * skip intro"): five story cards + one choosing card, shown once per device
 * in front of /signup. The last card's choice rides localStorage
 * ('lichen.introIntent') into Onboarding, where the person's OWN pick wins
 * over the invitation's intent — self-sorting at the door supersedes the
 * inviter's guess, exactly once, by their own hand. Skip is always one tap
 * (top right), and every path out of here lands on /signup with the arrival
 * params (invite token, ?from) intact. */

type IntroIntent = 'community' | 'client' | 'practitioner';

const SEEN_KEY = 'lichen.introSeen';
export const INTRO_INTENT_KEY = 'lichen.introIntent';

function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* storage may be off */ }
}

export default function Intro() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [i, setI] = useState(0);
  const touchX = useRef<number | null>(null);

  const N = 6;
  const last = i === N - 1;

  // Reaching the end counts as seen even if they then idle here.
  useEffect(() => { if (last) markSeen(); }, [last]);

  function toSignup() {
    markSeen();
    navigate('/signup' + search, { replace: true });
  }
  function choose(intent: IntroIntent) {
    try { localStorage.setItem(INTRO_INTENT_KEY, intent); } catch { /* ignore */ }
    toSignup();
  }
  function step(d: number) {
    setI((cur) => Math.min(N - 1, Math.max(0, cur + d)));
  }

  // Arrow keys walk the deck.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cards = [
    (
      <div className="intro__body" key="c1">
        <div className="intro__mark"><LichenMark size={72} /></div>
        {/* Founder's verbatim copy (2026-10-19) — the title's trailing dash
            flows into the lowercase body on purpose. */}
        <p className="intro__eyebrow">Welcome to Lichen</p>
        <h1 className="intro__title">A new way of being in relationship&nbsp;—</h1>
        <p className="intro__text">
          with each other and the plants, animals and land we rely on, not
          just to survive, but to thrive. Here, every contribution is
          valued, and <strong>reciprocity</strong> is the underlying
          principle of the whole ecosystem.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c2">
        <p className="intro__eyebrow">Two parts, one organism</p>
        <h1 className="intro__title">Community &amp; Concierge</h1>
        <div className="intro__pair">
          <div className="intro__half">
            <span className="intro__half-icon"><Icon name="user-multiple" size={22} /></span>
            <h2 className="intro__half-title">Community</h2>
            <p className="intro__text">
              The living network — people, organizations, communities, groups
              and places sharing a marketplace, events, courses and maps.
              Exchange moves by gift, trade and Current-cy, without extraction.
            </p>
          </div>
          <div className="intro__half">
            <span className="intro__half-icon"><Icon name="concierge" size={22} /></span>
            <h2 className="intro__half-title">Concierge</h2>
            <p className="intro__text">
              Holistic care, woven around a whole person — your Web of
              Wellbeing, a care team you choose, and care plans that hold
              every dimension of health. As someone receiving care, or
              someone offering it.
            </p>
          </div>
        </div>
      </div>
    ),
    (
      <div className="intro__body" key="c3">
        <span className="intro__glyph"><Icon name="merkaba" size={30} /></span>
        <p className="intro__eyebrow">The posture</p>
        <h1 className="intro__title">Build the new — don&rsquo;t fight the old</h1>
        <p className="intro__text">
          We keep a bridge to the commerce and healthcare systems most of us
          still rely on. But Current-cy and the Lichen algorithm are
          invitations to build better ways — real alternatives to walk into,
          as people invest in them.
        </p>
        <p className="intro__text">
          Like a martial artist, we don&rsquo;t push against something stronger
          than we are. We step out of its way, let what&rsquo;s imbalanced fall
          under its own weight — and build what comes next.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c4">
        <span className="intro__glyph"><Icon name="sparkle" size={30} /></span>
        <p className="intro__eyebrow">Where we are</p>
        <h1 className="intro__title">You&rsquo;re early — that&rsquo;s the point</h1>
        <p className="intro__text">
          We&rsquo;re inviting alpha members to help make the platform strong and
          solid, so expect rough edges and bugs along the way — and tell us
          when you find them.
        </p>
        <p className="intro__text">
          Community and Concierge will grow exactly as fast as people are
          willing to assemble at a grassroots level and build better systems
          than the ones crumbling.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c5">
        <span className="intro__glyph"><Icon name="fingerprint" size={30} /></span>
        <p className="intro__eyebrow">Why you</p>
        <h1 className="intro__title">Someone saw a wayshower in you</h1>
        <p className="intro__text">
          You&rsquo;re here because someone felt you might be a pioneer — a person
          who wants to contribute to the peaceful unfolding of a new
          renaissance, rather than fighting old systems with nefarious
          motives and hoping they&rsquo;ll change.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c6">
        <p className="intro__eyebrow">Begin</p>
        <h1 className="intro__title">Where would you like to begin?</h1>
        <p className="intro__text">
          Pick a first focus — after you join, Claude, Lichen&rsquo;s AI partner,
          will walk you through getting set up. Prefer to do it by hand?
          Every manual control stays one tap away.
        </p>
        <div className="intro__ctas">
          <button type="button" className="intro__cta" onClick={() => choose('community')}>
            <span className="intro__cta-icon"><Icon name="user-multiple" size={20} /></span>
            <span className="intro__cta-words">
              <strong>Community</strong>
              <em>The network — marketplace, events, people</em>
            </span>
          </button>
          <button type="button" className="intro__cta" onClick={() => choose('client')}>
            <span className="intro__cta-icon"><Icon name="concierge" size={20} /></span>
            <span className="intro__cta-words">
              <strong>Concierge — as a client</strong>
              <em>Begin your care and your Web of Wellbeing</em>
            </span>
          </button>
          <button type="button" className="intro__cta" onClick={() => choose('practitioner')}>
            <span className="intro__cta-icon"><Icon name="member-heart" size={20} /></span>
            <span className="intro__cta-words">
              <strong>Concierge — as a practitioner</strong>
              <em>Offer care — clients, sessions, hours</em>
            </span>
          </button>
        </div>
        <button type="button" className="intro__later" onClick={toSignup}>
          I&rsquo;ll decide as I go ›
        </button>
      </div>
    ),
  ];

  return (
    <div
      className="intro"
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        const x0 = touchX.current; touchX.current = null;
        const x1 = e.changedTouches[0]?.clientX;
        if (x0 == null || x1 == null) return;
        if (x0 - x1 > 48) step(1);
        else if (x1 - x0 > 48) step(-1);
      }}
    >
      <div className="intro__top">
        <span className="intro__wordmark">Lichen</span>
        {!last && (
          <button type="button" className="intro__skip" onClick={toSignup}>Skip intro ›</button>
        )}
      </div>

      <div className="intro__card" key={i}>
        {cards[i]}
      </div>

      <div className="intro__foot">
        <button type="button" className="intro__nav" onClick={() => step(-1)}
          disabled={i === 0} aria-label="Previous card">
          <Icon name="chevron-left" size={18} />
        </button>
        <div className="intro__dots" role="tablist" aria-label="Intro cards">
          {Array.from({ length: N }, (_, d) => (
            <button key={d} type="button"
              className={'intro__dot' + (d === i ? ' is-on' : '')}
              aria-label={`Card ${d + 1}`} onClick={() => setI(d)} />
          ))}
        </div>
        {last ? (
          <span className="intro__nav intro__nav--ghost" aria-hidden="true" />
        ) : (
          <button type="button" className="intro__nav intro__nav--next" onClick={() => step(1)}
            aria-label="Next card">
            <Icon name="chevron-right" size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
