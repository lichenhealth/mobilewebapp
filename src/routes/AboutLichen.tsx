import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LichenMark } from '../components/LichenMark';
import { useAuth } from '../auth/AuthProvider';
import './AboutLichen.css';

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
          life. Not a place to perform, but a place to actually be in relationship.
        </p>

        <section className="about__sec">
          <h2 className="about__h2">Your whole life, in one place</h2>
          <p>
            Most networks slice you into a feed and sell your attention. Lichen holds the whole of
            you instead — your care and healing, your work and the things you offer, the events you
            gather for, the places you love, the jobs that give you purpose and fund your livelihood,
            and a fairer economy that values all things, not just human contributions — woven into a
            single web of people, plants, animals, elements, spaces, communities, groups and
            organizations you trust. Everything in one place, because a life isn’t lived in silos.
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
          <h2 className="about__h2">An economy that gives back</h2>
          <p>
            Lichen is a nonprofit at heart. Membership and gifts keep the platform running — and
            <strong> everything beyond that flows back to the people the current system leaves
            behind</strong>: those carrying wounds, those whose work is undervalued, under-resourced
            innovators, and children still becoming. Philanthropy <em>pays only the gap</em>, until
            the community’s own economy can hold everyone. Money dedicated to the commons here can
            never turn back into private profit — you’re not the product; the point is care that
            reaches further.
          </p>
          <p>
            Two economies run side by side. <strong>Current-cy</strong> moves value out in the open —
            a transparent, dollar-pegged ledger, no speculation, the whole story visible.
            <strong> Offerings</strong> move care that’s freely given and never counted. One bridges
            the world as it is; the other builds the world as it could be.
          </p>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Example · an entrusted offering</p>
            <div className="about__chain">
              <div className="about__chain-step">
                <span className="about__chain-emoji">🪑</span>
                <span><span className="about__chain-t">A hand-made table, entrusted to Lichen</span><br /><span className="about__chain-s">“Route it where it’s needed most.”</span></span>
              </div>
              <span className="about__chain-arrow">↓</span>
              <div className="about__chain-step">
                <span className="about__chain-emoji">💛</span>
                <span><span className="about__chain-t">Sold to someone who’ll treasure it</span><br /><span className="about__chain-s">Its value freed, no need lost</span></span>
              </div>
              <span className="about__chain-arrow">↓</span>
              <div className="about__chain-step is-out">
                <span className="about__chain-emoji">🥕</span>
                <span><span className="about__chain-t">A week of groceries for a family in Fairplay</span><br /><span className="about__chain-s">+ a second table, gifted to their kitchen</span></span>
              </div>
            </div>
            <p className="about__mock-cap">One gift, two needs closed — and the story of where it went comes back to you.</p>
          </div>

          <button className="about__link" onClick={() => navigate('/donate/how')}>
            How giving works <Icon name="arrow-right" size={13} />
          </button>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">An algorithm that routes care, not attention</h2>
          <p>
            Most feeds are tuned to hold your attention. Lichen’s evolving algorithm is tuned to
            <strong> close a gap</strong>. Picture two maps of the world: what each of us actually
            gives — to one another, to the land — and what the economy happened to pay for it. Care
            work alone is worth trillions and priced near zero. Lichen makes that gap visible and
            routes support toward it first: greatest need, least access, closest to home.
          </p>
          <p>
            Say what you’re looking for and it matches you with what people near you are offering;
            give something, and the story of where it went comes back to you. For now a person is
            always in the loop — as the algorithm earns trust, it weaves more. When an assistant
            helps, it’s a warm partner in your corner, never an oracle.
          </p>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Example · need meets offer</p>
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
            <p className="about__mock-eyebrow">Example · a warm partner in the thread</p>
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

        {!user && (
          <div className="about__cta">
            <button className="btn btn-primary about__cta-join" onClick={() => navigate('/signup')}>Join Lichen</button>
            <p className="about__cta-sub">Already have an account? <button className="about__inline" onClick={() => navigate('/login')}>Sign in</button></p>
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
