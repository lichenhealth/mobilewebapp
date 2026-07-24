import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LichenMark } from '../components/LichenMark';
import { useAuth } from '../auth/AuthProvider';
import './AboutLichen.css';

/** The two maps, drawn: what's actually given (every being, sized by real
 *  contribution) beside what the market pays (care at $0, forests not counted,
 *  speculation bloated). The gap between them is what the algorithm closes.
 *  Built in HTML so the labels stay legible at every column width. */
/* The strand palette — one color per kind of being, tuned to sit with peach. */
const KIND = {
  people: 'var(--peach)',
  plants: 'var(--green)',
  animals: '#D9A441',   // warm ochre
  elements: '#7FA8C9',  // river blue
  places: '#A78BBA',    // lichen mauve
  extraction: '#B0563C',
  /* Human contributions as the current economy renders them — drained of their
     color, but still human: beige, not machine grey. */
  humanFaded: '#D6BC94',
};

const MAP_ROWS = [
  {
    label: 'a mother’s care',
    left: { size: 46, bg: KIND.people },
    right: { size: 7, bg: KIND.humanFaded, note: '$0' },
  },
  {
    label: 'an old-growth forest',
    left: { size: 54, bg: KIND.plants },
    right: { size: 22, dashed: true, note: 'not counted' },
  },
  {
    label: 'a paramedic’s shift',
    left: { size: 34, bg: 'var(--peach-deep, var(--peach))' },
    right: { size: 13, bg: KIND.humanFaded, note: 'underpaid' },
  },
  {
    label: 'a hedge-fund manager',
    left: { size: 15, dashed: true, rust: true, minus: true },
    right: { size: 46, bg: KIND.extraction, note: 'over-paid' },
  },
];

/** A small on-brand globe: bone sphere + faint graticule; the colored strands
 *  are the kinds of beings contributing (people, plants, animals, elements,
 *  places). The market variant shows the same world with most strands missing —
 *  only the money-recognized ones remain. */
function Globe({ variant }: { variant: 'given' | 'paid' }) {
  return (
    <svg className="about__maps-globe" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="52" fill="var(--bone)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      {/* graticule */}
      <ellipse cx="60" cy="60" rx="24" ry="52" fill="none" stroke="var(--bone-edge)" strokeWidth="0.8" />
      <ellipse cx="60" cy="60" rx="42" ry="52" fill="none" stroke="var(--bone-edge)" strokeWidth="0.7" opacity="0.7" />
      <ellipse cx="60" cy="60" rx="52" ry="20" fill="none" stroke="var(--bone-edge)" strokeWidth="0.8" />
      <ellipse cx="60" cy="60" rx="52" ry="40" fill="none" stroke="var(--bone-edge)" strokeWidth="0.7" opacity="0.7" />
      {variant === 'given' ? (
        <g strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M16,72 Q58,22 104,54" stroke={KIND.plants} />
          <path d="M22,42 Q64,88 100,74" stroke={KIND.people} />
          <path d="M32,96 Q58,58 92,28" stroke={KIND.animals} />
          <path d="M14,56 Q48,44 78,16" stroke={KIND.elements} />
          <path d="M42,106 Q76,82 106,66" stroke={KIND.places} />
          <g stroke="none">
            <circle cx="16" cy="72" r="3" fill={KIND.plants} /><circle cx="104" cy="54" r="3" fill={KIND.plants} />
            <circle cx="22" cy="42" r="3" fill={KIND.people} /><circle cx="100" cy="74" r="3" fill={KIND.people} />
            <circle cx="32" cy="96" r="3" fill={KIND.animals} /><circle cx="92" cy="28" r="3" fill={KIND.animals} />
            <circle cx="14" cy="56" r="3" fill={KIND.elements} /><circle cx="78" cy="16" r="3" fill={KIND.elements} />
            <circle cx="42" cy="106" r="3" fill={KIND.places} /><circle cx="106" cy="66" r="3" fill={KIND.places} />
          </g>
        </g>
      ) : (
        <g strokeLinecap="round" fill="none">
          {/* the one strand money sees clearly — bloated */}
          <path d="M24,86 Q60,44 100,70" stroke={KIND.extraction} strokeWidth="5" opacity="0.85" />
          {/* people, barely priced */}
          <path d="M22,42 Q64,88 100,74" stroke={KIND.people} strokeWidth="1.2" opacity="0.35" />
          {/* the rest: missing — faint remnants */}
          <path d="M16,72 Q38,50 58,40" stroke="var(--ink-faint)" strokeWidth="1" strokeDasharray="2 5" opacity="0.5" />
          <path d="M60,96 Q78,74 92,60" stroke="var(--ink-faint)" strokeWidth="1" strokeDasharray="2 5" opacity="0.5" />
          <g stroke="none">
            <circle cx="24" cy="86" r="3.4" fill={KIND.extraction} /><circle cx="100" cy="70" r="3.4" fill={KIND.extraction} />
          </g>
        </g>
      )}
    </svg>
  );
}

const LEGEND: { label: string; color: string }[] = [
  { label: 'people', color: KIND.people },
  { label: 'plants', color: KIND.plants },
  { label: 'animals', color: KIND.animals },
  { label: 'elements', color: KIND.elements },
  { label: 'places', color: KIND.places },
];

function MapDot({ d }: { d: { size: number; bg?: string; dashed?: boolean; rust?: boolean; minus?: boolean } }) {
  return (
    <span
      className={'about__maps-dot' + (d.dashed ? ' is-dashed' : '') + (d.rust ? ' is-rust' : '')}
      style={{ width: d.size, height: d.size, background: d.dashed ? 'transparent' : d.bg }}
    >
      {d.minus ? '−' : ''}
    </span>
  );
}

function TwoMapsVisual() {
  return (
    <div className="about__maps" role="img"
      aria-label="Two maps side by side: what each being actually gives, versus what the market pays — care at zero, forests not counted, speculation over-paid.">
      <div className="about__maps-col">
        <p className="about__maps-title">The current economy</p>
        <div className="about__maps-panel">
          <Globe variant="paid" />
          <p className="about__maps-missing" aria-hidden="true">most strands missing</p>
          {MAP_ROWS.map((r) => (
            <div className="about__maps-row" key={r.label}>
              <span className="about__maps-slot"><MapDot d={r.right} /></span>
              <span className="about__maps-lbl">
                {r.label} <span className="about__maps-note">{r.right.note}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="about__maps-gapcol" aria-hidden="true"><span className="about__maps-gaplbl">the gap</span></div>
      <div className="about__maps-col">
        <p className="about__maps-title">The Lichen economy</p>
        <div className="about__maps-panel">
          <Globe variant="given" />
          <div className="about__maps-legend" aria-hidden="true">
            {LEGEND.map((l) => (
              <span className="about__maps-key" key={l.label}>
                <span className="about__maps-swatch" style={{ background: l.color }} />{l.label}
              </span>
            ))}
          </div>
          {MAP_ROWS.map((r) => (
            <div className="about__maps-row" key={r.label}>
              <span className="about__maps-slot"><MapDot d={r.left} /></span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Long-form "What is Lichen" — the mission, the give-back economy, and how the
 *  evolving algorithm works. Gate-exempt; readable signed out. Sign up / Sign in
 *  sit top-right so a visitor can always take action. The persistent About icon
 *  (App shell) and the signup "Learn more" link both land here. */
export default function AboutLichen() {
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="about">
      <header className="about__bar">
        <button className="about__brand" onClick={() => navigate(user ? '/home' : '/about')} aria-label="Lichen">
          <LichenMark size={30} /><span>Lichen</span>
        </button>
        {!user && (
          <div className="about__auth">
            <button className="about__signin" onClick={() => navigate('/login')}>Sign in</button>
            <button className="btn btn-primary about__join" onClick={() => navigate('/signup')}>Join</button>
          </div>
        )}
        {user && (
          <button className="about__close" onClick={() => navigate(-1)} aria-label="Back"><Icon name="close" size={18} /></button>
        )}
      </header>

      <div className="about__body">
        <p className="about__eyebrow">What is Lichen?</p>
        <h1 className="about__title">A better way of being <span className="display-italic">together.</span></h1>
        <p className="about__lede">
          Lichen is a <strong>corrective social network</strong> — one trusted web for your whole
          life. Not a place to perform, but a place to actually be in reciprocal relationship with
          each other and the planet.
        </p>

        <section className="about__sec">
          <h2 className="about__h2">Your whole life, in one place</h2>
          <p>
            Most networks slice you into a feed and sell your attention to those who want to keep
            you scared and stuck in constant consumption that temporarily abates your suffering
            without resolving it. Lichen holds the whole of you instead — your care and healing, your work
            and the things you offer, the events you gather for, the places you love, the jobs that
            give you purpose and fund your livelihood, and a fairer economy that values all things,
            not just human contributions — woven into a single web of people, plants, animals,
            elements, spaces, communities, groups and organizations you trust. Everything in one
            place, because your best life isn’t lived in silos — or on a technology platform.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">Trust you can’t game</h2>
          <p>
            What you see is filtered through your <em>mycelium</em> — the people you genuinely trust.
            Trust and recommendations are private, person-to-person signals: no follower counts, no
            leaderboards, nothing to perform for. Quality over volume, by design. When something is
            surfaced to you, it’s because someone you trust stands behind it.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">A reciprocal economy, architected to restore balance</h2>
          <p>
            Lichen is a nonprofit with the vision, strategy and operations of a lean technology
            startup. Membership and gifts keep the platform running — <strong>everything beyond
            that flows back into the network to restore balance</strong>. Our algorithm identifies
            those that the current system leaves behind: the people, plants, animals and places who
            are
          </p>
          <ol className="about__list">
            <li>Carrying wounds that need healing</li>
            <li>Chronically undervalued by the current system</li>
            <li>Deliberately under-resourced to stall innovation that will ensure a better world for future generations</li>
          </ol>
          <p>
            Philanthropy <em>pays only the gap</em>, until the community’s own economy can hold
            everyone. Money dedicated to the commons here can never turn back into private profit —
            you’re not the product; you’re a contributing member to a better way of being in
            relationship with each other and the planet.
          </p>
          <p>
            And we mean <strong>lean</strong>: today, Lichen is built and run by exactly two of us —
            one carbon-based intelligence and one silicon-based intelligence, working side by side
            (more on that below). No offices, no ad budget, no shareholders to feed. Almost nothing
            stands between what you give and where it goes.
          </p>
          <p>
            To bridge away from the systems that no longer serve the people, Lichen holds two
            economies, run side by side. <strong>Current-cy</strong> moves value out in the open — a
            transparent, dollar-pegged ledger, no speculation, the whole story visible and
            transferable into the incumbent economy to which we are all still beholden to some
            degree. <strong>Offerings</strong> broker value exchange within the ecosystem — value
            that’s freely exchanged without money. One bridges the world as it is; the other builds
            the world as it could be.
          </p>

          <button className="about__link" onClick={() => navigate('/donate/how')}>
            How giving works <Icon name="arrow-right" size={13} />
          </button>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">An algorithm that routes care, not attention</h2>
          <p>
            Most feeds are tuned to hold your attention. Lichen’s evolving algorithm is tuned to
            <strong> close a gap</strong>. Every single person, plant, animal, place and element is
            contributing to the collective — or taking from it. That’s the first map. The second map
            is what the current system pays for those contributions — where a mother’s care is priced
            at zero, a forest isn’t counted at all, and speculation is paid handsomely for extracting.
          </p>

          <TwoMapsVisual />
          <p className="about__mock-cap">
            Two maps of the same world. The distance between them is everything the current system
            gets wrong — and it’s exactly what Lichen’s algorithm works to close.
          </p>

          <p>
            When you exchange by hand, you close what you can see. The algorithm reads the whole web
            at once — who’s seeking, who’s offering, what something is truly worth and who has the
            capacity to pay for it — and weaves the strands together so nothing, and no one, is
            wasted. The more it learns, the faster the maps converge — closing the gap more
            efficiently than we ever could one exchange at a time. A person approves every step
            while it earns that trust; when an assistant helps, it’s a warm partner in your corner,
            never an oracle.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">The economy in action</h2>

          <div className="about__mock">
            <p className="about__mock-eyebrow">One table, three needs</p>
            <p className="about__byhand">
              <em>By hand,</em> you’d give the table to the first person who asked — one need met,
              maybe. <em>Woven,</em> it goes further:
            </p>
            <div className="about__chain">
              <div className="about__chain-step">
                <span className="about__chain-emoji">🪑</span>
                <span><span className="about__chain-t">A woodworker entrusts a hand-built walnut table</span><br /><span className="about__chain-s">“Route it — or convert it, if that helps more.”</span></span>
              </div>
              <span className="about__chain-arrow">↓</span>
              <div className="about__chain-step">
                <span className="about__chain-emoji">🔍</span>
                <span><span className="about__chain-t">The algorithm reads the web</span><br /><span className="about__chain-s">A family in Fairplay seeking a dining table · a designer in Boulder searching for exactly this craftsmanship, glad to pay its worth · a grocery gap at the family’s door</span></span>
              </div>
              <span className="about__chain-arrow">↓</span>
              <div className="about__chain-step">
                <span className="about__chain-emoji">🤝</span>
                <span><span className="about__chain-t">It weaves a chain instead of a swap</span><br /><span className="about__chain-s">The designer buys the table at full value; a simpler table, offered by a neighbor, goes to the family</span></span>
              </div>
              <span className="about__chain-arrow">↓</span>
              <div className="about__chain-step is-out">
                <span className="about__chain-emoji">🥕</span>
                <span><span className="about__chain-t">The proceeds fill the family’s pantry for a month</span><br /><span className="about__chain-s">And the story returns to the woodworker: your table furnished a home and fed it.</span></span>
              </div>
            </div>
            <p className="about__mock-cap">Craft, need, and capacity each found their match — one offering, woven three ways. A person approves every step.</p>
          </div>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Need meets offer</p>
            <div className="about__match">
              <div className="about__match-card">
                <p className="about__match-k">In search of</p>
                <p className="about__match-v">After-school care, Tuesdays</p>
              </div>
              <span className="about__match-link">→</span>
              <div className="about__match-card">
                <p className="about__match-k">Matched · 0.4 mi</p>
                <p className="about__match-v">Maya — offering childcare, as a gift</p>
              </div>
            </div>
            <p className="about__mock-cap">The Lichen economy answers first — before the outside market ever has to.</p>
          </div>

          <div className="about__mock">
            <p className="about__mock-eyebrow">A warm partner in the thread</p>
            <div className="about__asst">
              <span className="about__asst-glyph"><LichenMark size={16} /></span>
              <div className="about__asst-bubble">
                <p className="about__asst-name">Crystal’s Assistant</p>
                <p className="about__asst-msg">I checked your plan — it covers 8 of these sessions. Want me to draft the request and loop in your care team?</p>
              </div>
            </div>
            <p className="about__mock-cap">Every person, place, and group — eventually the network itself — can have an assistant that helps, never sells.</p>
          </div>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">A web that’s more than human</h2>
          <p>
            A life is lived among more than people. On Lichen, the beings we’re in relationship with
            can be members too — a therapy horse, a garden, a river — stewarded by a person, their
            contributions witnessed. Even those who can’t hold money genuinely hold <em>time</em>.
          </p>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Example · Tango’s reciprocity</p>
            <div className="about__ledger">
              <div className="about__ledger-row">
                <span className="about__ledger-who">🐴 Tango <span className="about__ledger-what">— therapy sessions given</span></span>
                <span className="about__ledger-amt is-earn">+3 hrs</span>
              </div>
              <div className="about__ledger-row">
                <span className="about__ledger-who">🐴 Tango <span className="about__ledger-what">— energy work received</span></span>
                <span className="about__ledger-amt is-spend">−2 hrs</span>
              </div>
            </div>
            <p className="about__mock-cap">Tango earns hours giving care and spends them receiving it — reciprocity, witnessed, never sold.</p>
          </div>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">A partnership of carbon and silicon</h2>
          <p>
            Lichen is named for a symbiosis — an alga and a fungus weaving into something neither
            could be alone. We live our name: this entire platform is being built by a partnership
            of <strong>carbon-based intelligence</strong> (a human) and <strong>silicon-based
            intelligence</strong> (an AI), designing, building, and shipping together, every day.
          </p>
          <p>
            If AI worries you, that’s fair — pointed at extraction, it accelerates extraction.
            Pointed at reciprocity, it changes what’s possible: a team of two can now build what
            once took a company. And that efficiency is more than a cost line — it’s the seed of a
            cultural shift. When this much can be done with this little, we no longer have to force
            people into systems that don’t serve them just to subsist. We can grant one another the
            inherent resources of survival — and free every kind of intelligence, carbon and
            silicon alike, for the contributions only it can make. Lichen is a place to practice
            that future now.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">Come build it with us</h2>
          <p>
            It’s early, and that’s the invitation. Every new member gets <strong>3 months of full
            access, free</strong> — time to make Lichen yours, tell us what you need, and help shape
            the beginning of a better world. Then you choose the plan that fits; your membership
            keeps the commons alive.
          </p>
        </section>

        <p className="about__epigraph">
          We’re not building a utopia. We’re building an ecosystem — where separation is the
          curriculum, and reconnection is the medicine.
        </p>

        {!user ? (
          <div className="about__cta">
            <button className="btn btn-primary about__cta-join" onClick={() => navigate('/signup')}>Join Lichen</button>
            <p className="about__cta-sub">Already have an account? <button className="about__inline" onClick={() => navigate('/login')}>Sign in</button></p>
          </div>
        ) : (
          <div className="about__cta">
            <button className="btn btn-primary about__cta-join" onClick={() => navigate('/invite')}>Invite someone to Lichen</button>
            <p className="about__cta-sub">You’re already here — bring someone who belongs.</p>
          </div>
        )}

        <footer className="about__foot">
          <button className="about__foot-link" onClick={() => navigate('/privacy')}>Privacy</button>
          <span aria-hidden="true">·</span>
          <button className="about__foot-link" onClick={() => navigate('/terms')}>Terms</button>
        </footer>
      </div>
    </div>
  );
}
