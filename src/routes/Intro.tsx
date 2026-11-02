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
 * inviter's guess, exactly once, by their own hand. Skip is always one tap —
 * on the FIRST card it's a peach button right below the card, going straight
 * to the request form (founder 2026-11-01: "a skip intro button in peach
 * below the tile cards… get rid of the one at the top right for that screen
 * only"); later cards carry it top right as a visible peach pill ("make it
 * more easy to see for subsequent slides"). Every path out of here lands on
 * /signup with the arrival params (invite token, ?from) intact. */

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
      /* The two parts are TWO SCREENS since 2026-11-01 (founder: "can you
         design a two screen scroll - first is community, 2nd is concierge,
         so its not a scroll down to then move ahead?") — each card fits a
         phone whole, the arrow is the only forward gesture. */
      <div className="intro__body" key="c2a">
        <span className="intro__glyph"><Icon name="user-multiple" size={30} /></span>
        <p className="intro__eyebrow">Two parts, one organism</p>
        <h1 className="intro__title">Community</h1>
        {/* Founder's verbatim copy (2026-11-01, her third pass the same
            day — "Further tweaks to community copy"). */}
        <p className="intro__text intro__text--left">
          The corrective social network. A complete ecosystem — where
          individuals, Groups, Communities, Organizations and Places
          can leverage a completely integrated ecosystem, including
          Marketplace, Events, Courses, Travel, Maps, Chat, and more.
        </p>
        <p className="intro__text intro__text--left">
          Filter it all through members you trust and recommend —
          expandable to those they trust and recommend. Trust stays
          private, dissuading inauthentic endorsements while scaling
          trusted recommendations for the information, goods and
          services, healthcare, places and entertainment you choose.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c2b">
        <span className="intro__glyph"><Icon name="concierge" size={30} /></span>
        <p className="intro__eyebrow">Two parts, one organism</p>
        <h1 className="intro__title">Concierge</h1>
        {/* Founder's copy (2026-11-01). */}
        <p className="intro__text intro__text--left">
          Your care team assembles around you, leveraging Lichen&rsquo;s
          Concierge platform to collaborate in weaving the land, plants,
          animals, elements, eco-spiritual practices, western medicine,
          naturopathic interventions and cutting edge technology
          necessary to best support your unique path to healing and
          expansion.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c3">
        {/* Founder's copy (2026-10-19). */}
        <span className="intro__glyph"><Icon name="merkaba" size={30} /></span>
        <p className="intro__eyebrow">Our approach</p>
        <h1 className="intro__title">Build the new — don&rsquo;t fight the old.</h1>
        <p className="intro__text">
          We keep a bridge to the commerce and healthcare systems most of us
          still rely on. But Current-cy and the Lichen algorithm are
          invitations to build better ways of exchanging value and caring
          for the health and wellbeing not just of humans, but of plants,
          animals and the land that sustains us.
        </p>
        <p className="intro__text">
          {/* Founder's tweak 2026-11-01: "We step out of its way, letting
              what's imbalanced fall under its own weight." */}
          Like a martial artist, we don&rsquo;t push against something stronger
          than we are. We step out of its way, letting what&rsquo;s imbalanced
          fall under its own weight. Instead, we choose to build something
          better — an alternative society for people to choose.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c4">
        <span className="intro__glyph"><Icon name="sparkle" size={30} /></span>
        {/* Founder's copy (2026-10-19). */}
        <p className="intro__eyebrow">Where we are</p>
        <h1 className="intro__title">We&rsquo;re at the beginning — care to join us?</h1>
        <p className="intro__text">
          We&rsquo;re inviting alpha members to help make the platform strong and
          solid, so expect rough edges and bugs along the way — we&rsquo;re
          committed to fixing what&rsquo;s broken and building what is needed but
          not yet present on the platform.
        </p>
        <p className="intro__text">
          Community and Concierge will grow exactly as fast as people are
          willing to assemble at a grassroots level to build better systems
          than the ones crumbling.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c4b">
        <span className="intro__glyph"><Icon name="currentcy" size={30} /></span>
        {/* Synthesized from lichen.health/business (founder 2026-11-02:
            "add a tile in lichen.health/intro that explains that alpha
            membership is free, once the platform is dialed, all revenue
            from concierge and community subscriptions not required to run
            the platform will go back into subsidies"). Placed right after
            the alpha-honesty card — where-we-are, then what it costs and
            where the money goes. */}
        <p className="intro__eyebrow">The business, plainly</p>
        <h1 className="intro__title">Alpha membership is free.</h1>
        <p className="intro__text">
          While we build together, membership costs nothing. And once the
          platform is dialed in, Lichen stays a nonprofit with lean
          operations and no investors or shareholders to pay — so Community
          and Concierge subscription revenue beyond what it takes to run
          the platform flows back into subsidizing the care, goods and
          services members need to heal and thrive.
        </p>
        <p className="intro__text">
          Every contribution and subsidy is tracked transparently through
          Current-cy, Lichen&rsquo;s own unit of account — because there&rsquo;s no
          shame in receiving support when the old systems under-resourced
          you. Rebalancing is the whole point.
        </p>
      </div>
    ),
    (
      <div className="intro__body" key="c5">
        <span className="intro__glyph"><Icon name="fingerprint" size={30} /></span>
        <p className="intro__eyebrow">Why you</p>
        <h1 className="intro__title">Someone saw a wayshower in you</h1>
        {/* Founder's copy (2026-10-19). */}
        <p className="intro__text">
          You&rsquo;re here because someone felt you might be a pioneer — a person
          who wants to contribute to the peaceful unfolding of a new
          renaissance, rather than fighting old systems with motives that
          contradict the positive changes we can implement if we work
          together to build new political, economic and social systems
          focused on balance and reciprocity.
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

  // N is DERIVED from the deck, never hardcoded — a literal 7 silently made
  // the chooser card unreachable the day the money card joined (found live
  // 2026-11-02: the dots read 7 and the deck ended on "wayshower").
  const N = cards.length;
  const last = i === N - 1;

  // Reaching the end counts as seen even if they then idle here.
  useEffect(() => { if (last) markSeen(); }, [last]);

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
        <span className="intro__wordmark"><LichenMark size={24} /> Lichen</span>
        {i > 0 && !last && (
          <button type="button" className="intro__skip" onClick={toSignup}>Skip intro ›</button>
        )}
      </div>

      <div className="intro__card" key={i}>
        {cards[i]}
      </div>

      {i === 0 && (
        <button type="button" className="intro__skipbtn" onClick={toSignup}>
          Skip intro ›
        </button>
      )}

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
