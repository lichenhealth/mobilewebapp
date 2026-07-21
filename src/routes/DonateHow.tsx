import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import './Donate.css';

/** The learn-more behind "Where it's needed most" (founder, 2026-07-21):
 *  the two-maps story — actual reciprocity vs. priced value — and the
 *  routing promise an undirected donation is trusting. Gate-exempt via the
 *  /donate prefix; signed-out donors can read it. */
export default function DonateHow() {
  const navigate = useNavigate();
  return (
    <div className="donate">
      <button className="cmp__back" onClick={() => navigate('/donate')}>
        <Icon name="arrow-left" size={14} /> Back to giving
      </button>

      <header className="donate__head">
        <p className="eyebrow">Where it&rsquo;s needed most</p>
        <h1 className="donate__title">
          The next, <span className="display-italic">right place.</span>
        </h1>
        <p className="donate__sub">
          How Lichen decides where an undirected gift goes.
        </p>
      </header>

      <div className="donate__how">
        <h2 className="donate__give-title">Two maps</h2>
        <p>
          Imagine two maps of the same world. The first charts what every
          being actually contributes to the ecosystem we all live in — the
          caregiver&rsquo;s decade, the farmer&rsquo;s soil, the forest&rsquo;s
          fifty years of growing, the horse&rsquo;s steady hour with a
          frightened child. The second map is the one the human economy drew:
          what each of those contributions gets <em>paid</em>.
        </p>
        <p>
          The two maps disagree almost everywhere. Whole players were left
          off the second map entirely — trees, rivers, pollinators, most care
          work ever done. Others are wildly over-valued, and some of the
          highest prices attach to work that contributes nothing at all. The
          distance between the maps is where imbalance lives: in people
          priced out of care, in land priced out of protection, in work that
          sustains life earning less than work that extracts from it.
        </p>

        <h2 className="donate__give-title">What Lichen does with the gap</h2>
        <p>
          Lichen keeps the first map. Our ledger records contribution as it
          actually happens — in care given, hours offered, value grown — for
          people, groups, places, plants, and animals alike. So when you give
          without directing your gift, you&rsquo;re not giving into a fog:
          you&rsquo;re trusting a network that can <em>see</em> where the two
          maps diverge most — the greatest need, met by the least access —
          and routes your dollars there as subsidy: care for those priced
          out of it, goods and services for those who can&rsquo;t afford
          them, protection for places that markets won&rsquo;t protect.
        </p>
        <p>
          Our routing principles are published, not secret: the largest gap
          first, weighted toward nearness and freshness, honoring every
          donor restriction we accept. Balances and circulation are open to
          scrutiny. And by law, every donated dollar is permanently dedicated
          to the commons — it can never return to private profit.
        </p>

        <h2 className="donate__give-title">The story comes back</h2>
        <p>
          Restoring balance isn&rsquo;t an abstraction — it lands somewhere,
          with someone. As the network grows, our aim is that every
          undirected gift returns a story: where it went, what it made
          possible, and what moved back toward balance because you let go of
          deciding.
        </p>

        <button
          type="button" className="donate__submit"
          onClick={() => navigate('/donate')}
        >
          Give now
        </button>
      </div>
    </div>
  );
}
