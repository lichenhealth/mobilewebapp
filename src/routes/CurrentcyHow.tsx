import { useNavigate } from 'react-router-dom';
import { Bolt } from '../components/CurrentcyCard';
import './Mycelium.css';   // myc__ centered-header grammar (Drive's shape)
import './CurrentcyHow.css';

/** How money moves — the wallet's click-through explainer (founder
 *  2026-10-02, retiring the redundant ?loaded=1 banner: "Maybe theres a
 *  click thru capacity with a 'back to current-cy' button that explains
 *  the options for current-cy in and out and typical wait times, etc, for
 *  things like bank transfers"). Plain words, honest speeds, nothing
 *  promised that isn't built. The worded back chip names its destination
 *  (the one-back rule's exception (a)). */
export default function CurrentcyHow() {
  const navigate = useNavigate();
  return (
    <div className="curhow">
      <button className="curhow__back" onClick={() => navigate('/currentcy')}>
        ← Back to Current-cy
      </button>

      <header className="myc__head">
        <h1 className="myc__title">How money moves</h1>
        <p className="myc__sub">
          Every way dollars and Current-cy flow in, around, and out — and how
          long each one takes.
        </p>
      </header>

      <section className="curhow__sec">
        <h2 className="curhow__h2">Putting dollars in</h2>
        <div className="curhow__item">
          <h3>Load by card — instant</h3>
          <p>
            $1 becomes <Bolt small />1 Current the moment the payment goes
            through. A load is a purchase of spending power, not a donation —
            it isn&rsquo;t tax-deductible.
          </p>
        </div>
        <div className="curhow__item">
          <h3>Load from your bank account — a few business days</h3>
          <p>
            A bank transfer typically takes 2&ndash;4 business days to clear.
            While it travels, it shows on your balance as{' '}
            <em>pending</em> with an estimated arrival — like a deposit on the
            way into a checking account — and you&rsquo;ll get a Current-cy
            bell the moment it lands. Pending money isn&rsquo;t spendable
            until it clears. If a transfer doesn&rsquo;t go through, nothing
            is taken from your wallet and your wallet says so plainly.
          </p>
        </div>
        <div className="curhow__item">
          <h3>Donate</h3>
          <p>
            Dollars you donate translate into real goods and services
            distributed to those in need on the network. The Donate page
            explains where each kind of gift goes and the share that funds
            the platform&rsquo;s buildout.
          </p>
        </div>
      </section>

      <section className="curhow__sec">
        <h2 className="curhow__h2">Moving Current-cy around</h2>
        <div className="curhow__item">
          <h3>Sending to a member — instant</h3>
          <p>
            The wallet&rsquo;s Send box moves Current the moment you send it,
            to any member or space.
          </p>
        </div>
        <div className="curhow__item">
          <h3>Earning through an exchange</h3>
          <p>
            When you offer goods or services on the Marketplace, Current
            moves once both sides say the exchange is done — so it arrives
            when the work does.
          </p>
        </div>
      </section>

      <section className="curhow__sec">
        <h2 className="curhow__h2">Taking money out</h2>
        <div className="curhow__item">
          <p>
            Turning Current-cy back into dollars isn&rsquo;t open yet —
            it&rsquo;s being built carefully, with the documentation it
            deserves. Until then, Current keeps its full value inside the
            network: spend it on offerings, send it to members, or put it
            toward what you need.
          </p>
        </div>
      </section>

      <section className="curhow__sec">
        <h2 className="curhow__h2">Typical wait times</h2>
        <ul className="curhow__times">
          <li><span>Card load</span><span>Instant</span></li>
          <li><span>Bank transfer</span><span>2&ndash;4 business days</span></li>
          <li><span>Sending Current to a member</span><span>Instant</span></li>
          <li><span>Marketplace exchange</span><span>When both sides mark it done</span></li>
        </ul>
      </section>
    </div>
  );
}
