import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import './Donate.css';

/** The fiscal architecture of Lichen, for contributors (founder, 2026-07-21):
 *  one page, anchored sections — the three cards on /donate each deep-link
 *  here (#donate / #give / #economy), the purpose chips link #needed-most.
 *  Explains what we settled philosophically + legally: two maps, three doors,
 *  two economies, FAQs, and lived scenarios. Gate-exempt via /donate prefix. */
export default function DonateHow() {
  const navigate = useNavigate();
  const { hash } = useLocation();

  // ScrollToTop fires on every pathname change; land on the asked-for
  // section right after it.
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) window.setTimeout(() => el.scrollIntoView({ block: 'start' }), 120);
  }, [hash]);

  return (
    <div className="donate">
      <button className="cmp__back" onClick={() => navigate('/donate')}>
        <Icon name="arrow-left" size={14} /> Back to giving
      </button>

      <header className="donate__head">
        <p className="eyebrow">Support Lichen</p>
        <h1 className="donate__title">
          How giving <span className="display-italic">works.</span>
        </h1>
        <p className="donate__sub">
          The fiscal architecture of Lichen — three doors, two economies, one
          commons — explained plainly for contributors.
        </p>
      </header>

      <div className="donate__how">
        <section id="needed-most" className="donate__how-sec">
          <h2 className="donate__give-title">Two maps</h2>
          <p>
            Imagine two maps of the same world. The first charts what every
            being actually contributes to the ecosystem we all live in — the
            caregiver&rsquo;s decade, the farmer&rsquo;s soil, the
            forest&rsquo;s fifty years of growing, the horse&rsquo;s steady
            hour with a frightened child. The second map is the one the human
            economy drew: what each of those contributions does (or
            doesn&rsquo;t) get <em>paid</em>.
          </p>
          <p>
            The two maps disagree almost everywhere. Whole players were left
            off the second map entirely — trees, rivers, pollinators, most
            care work ever done. Others are wildly over-valued. The distance
            between the maps is where imbalance lives: people priced out of
            care, land priced out of protection, work that sustains life
            earning less than work that extracts from it.
          </p>
          <p>
            Lichen keeps the first map. Our ledger records contribution as it
            actually happens — for people, groups, places, plants, and
            animals alike. A donation marked <em>&ldquo;where it&rsquo;s needed
            most&rdquo;</em> trusts that map: we route it toward the largest
            gap — the greatest need, met by the least access — as subsidy for
            care, goods, services, and places. Our routing principles are
            published, not secret, and our aim is that every undirected
            donation eventually returns a story: where it went, and what
            moved back toward balance.
          </p>

          <h2 className="donate__give-title">The algorithm the mycelium is building</h2>
          <p>
            Lichen is building a map of the actual, reciprocal value exchange
            among all of this planet&rsquo;s players — places, elements,
            animals, plants, and people. Every contribution the network
            witnesses becomes a coordinate: the care given, the hours
            offered, the meal grown, the fifty years a tree spent becoming
            timber, the steady work of a place that holds a community
            together. Over it we lay the second map — what human systems
            currently attribute value to, at what level, and everything they
            leave out entirely.
          </p>
          <p>
            The distance between those maps is the algorithm&rsquo;s whole
            objective: <em>close the gap, as efficiently as possible.</em>
            Donating to Lichen means trusting that process. Today the routing
            is done by human stewards reading the ledger, aided by
            deterministic matching of needs to offers; as the map fills in,
            the routing sharpens — but the objective never changes, and it is
            never secret. The algorithm serves the map; the map serves
            balance.
          </p>
        </section>

        <section id="donate" className="donate__how-sec">
          <h2 className="donate__give-title">Donate — the tax-deductible door</h2>
          <p>
            A donation is a contribution to Lichen Health, a registered 501(c)(3)
            nonprofit (EIN 73-1683375), and is tax-deductible to the fullest
            extent allowed by law. You may voice a preference for where it
            flows — a practitioner, a program, a place — and we honor
            preferences gladly. But the IRS requires that Lichen keep final
            discretion and control over donated funds; that discretion is
            exactly what makes your deduction valid.
          </p>
          <p>
            Once given, your dollars are permanently dedicated to the commons.
            This is black-letter nonprofit law: a 501(c)(3) has no owners, can
            pay no dividends, and even on dissolution its assets must pass to
            another charity. A donated dollar leaves the private-profit
            economy forever.
          </p>
          <p>
            In practice: 95% of a directed donation is translated into
            Current-cy for the recipient we resolve from your words; 5%
            sustains the operations that make the platform possible. If you
            direct nothing, your donation flows <em>where it&rsquo;s needed
            most</em> — the routing described above — and you can also point
            it at subsidized care, goods and services, or spaces and places
            for those who can&rsquo;t afford them. A proper tax receipt —
            with the IRS-required language — arrives in your inbox the moment
            your donation clears.
          </p>
        </section>

        <section id="give" className="donate__how-sec">
          <h2 className="donate__give-title">Give — the direct-gift door</h2>
          <p>
            Sometimes you don&rsquo;t want an organization&rsquo;s discretion —
            you know exactly who you want to help. Give is that door: a direct
            personal gift where <em>you</em> choose who benefits. It is
            generous, honest, and — because the IRS treats donor-controlled
            gifts to chosen individuals as personal gifts, not charitable
            contributions — it is not tax-deductible.
          </p>
          <p>
            We say so plainly at every step: the checkout page says
            sponsorship, and your email says <em>gift acknowledgment</em>{' '}
            rather than tax receipt. Recipients owe no income tax on true
            gifts. Lichen simply facilitates your generosity as you direct
            it, on the same 95/5 terms.
          </p>
          <p>
            In short: control comes at the cost of the deduction. For gifts
            of ordinary size the current system asks nothing of you either
            way — no benefit, and no burden. You are simply moving your own
            generosity, with Lichen as the path it travels.
          </p>
        </section>

        <section id="economy" className="donate__how-sec">
          <h2 className="donate__give-title">The Lichen Economy — where value lives</h2>
          <p>
            Inside Lichen, value moves in two distinct ways. <strong>
            Current-cy</strong> is our dollar-backed unit: every Current in
            circulation is matched by a real dollar held in reserve, and the
            books are open. It is earned honestly and taxed honestly — value
            received for goods or services is income under U.S. law whether
            it arrives as dollars or Current, and we&rsquo;d never pretend
            otherwise. It is the bridge between the world as it is and the
            world we&rsquo;re building.
          </p>
          <p>
            <strong>Offerings</strong> are the other way — the reciprocity
            economy taking root. Goods and services freely given, chosen by their
            givers, carrying their stories instead of price tags. Money
            cannot buy its way into this layer, and that&rsquo;s the point:
            you enter by offering. It runs on reciprocity rather than
            accounting, and it&rsquo;s where the marketplace&rsquo;s Gift
            mode already lives today.
          </p>
          <p>
            And the trust you place in a donation extends to offerings too:
            when you list a gift, you can choose <em>&ldquo;Let Lichen route
            this&rdquo;</em> — handing allocation to the same algorithm that
            directs undirected donations. The network matches your offering
            against open asks by need, words, and even visual style, and a
            steward completes the routing. Sometimes the best route is a
            chain: a resourced member receives your offering at its full
            value, that value flows onward as subsidy to a more urgent need,
            and a second offering meets the first ask — one gift, two needs
            closed. You&rsquo;ll see it on listings as
            <em> &ldquo;Gift · Lichen routes.&rdquo;</em>
          </p>
        </section>

        <section id="faq" className="donate__how-sec">
          <h2 className="donate__give-title">Questions donors ask</h2>
          <dl className="donate__faq">
            <dt>Can I direct my donation to a specific practitioner?</dt>
            <dd>
              You can voice the preference, and we honor preferences in
              nearly every case — but Lichen must retain final discretion for
              your deduction to be valid. If you want binding control over
              who benefits, that&rsquo;s the Give door, without the deduction.
            </dd>
            <dt>Why isn&rsquo;t a direct gift tax-deductible?</dt>
            <dd>
              The IRS&rsquo;s &ldquo;conduit rule&rdquo;: a gift the donor
              controls to a chosen person is a personal gift passed through
              an organization, not a contribution to it. We route it honestly
              rather than pretend otherwise.
            </dd>
            <dt>Do recipients pay tax on what they receive?</dt>
            <dd>
              True gifts and charitable assistance: no — gifts are never
              income to the receiver. Value <em>earned</em> for goods or
              services — in dollars or Current-cy — is ordinary income, and
              Lichen provides the paperwork that makes tax season easy.
            </dd>
            <dt>What is Current-cy worth?</dt>
            <dd>
              One dollar, always. Every Current in circulation is backed by a
              real dollar held in Lichen&rsquo;s float account — we publish
              circulation against reserves, and we never mint more than the
              donations backing it.
            </dd>
            <dt>Does Lichen take a cut?</dt>
            <dd>
              5% of every donation or gift sustains platform operations; 95%
              flows where it points. Membership revenue funds operations
              separately.
            </dd>
            <dt>What happens to donations if Lichen ever dissolved?</dt>
            <dd>
              By law, every remaining asset must pass to another 501(c)(3).
              Donated money can never return to private hands — the one-way
              door is permanent.
            </dd>
          </dl>
        </section>

        <section id="scenarios" className="donate__how-sec">
          <h2 className="donate__give-title">True-to-life scenarios</h2>
          <p>
            <strong>The directed donor.</strong> A donor gives $2,750,
            writing <em>&ldquo;for subsidized care through Melanie&rsquo;s
            practice.&rdquo;</em> Deductible — the beneficiaries are an open
            class (people who can&rsquo;t afford care), Melanie is the
            program&rsquo;s deliverer, and Lichen holds discretion. $2,612.50
            becomes Current-cy behind her subsidized sessions; the donor&rsquo;s
            words ride in the ledger forever.
          </p>
          <p>
            <strong>The personal sponsor.</strong> A donor wants to pay for
            three specific people to see Melanie — people he chose. That&rsquo;s
            the Give door: same generosity, no deduction, a gift
            acknowledgment instead of a receipt, and nobody&rsquo;s paperwork
            tells a story the IRS would dispute.
          </p>
          <p>
            <strong>The table.</strong> A member lists a handmade table on a
            sliding scale from $0 to $150. A well-resourced buyer would pay
            full price — funding the maker&rsquo;s free therapy work. Instead
            she gifts it to a family furnishing their first apartment, who
            answer with offered hours at a community planting day. No
            deduction, no tax event for the family, and the table&rsquo;s
            story — seven hours at the workbench, fifty years of ponderosa —
            travels with it.
          </p>
          <p>
            <strong>The entrusted offering.</strong> A member lists a
            handcrafted bench and chooses <em>Lichen*</em> — no recipient, no
            price, no decisions. The algorithm reads the network: an open ask
            whose words and style match, a well-resourced member who admires
            the maker&rsquo;s work, a family short on groceries this month.
            Sometimes it proposes the simple route — bench to the ask. And
            sometimes a chain: the admirer receives the bench at its full
            value, that value flows onward as food subsidy, and a second
            bench meets the original ask — one offering, two needs closed.
            The giver&rsquo;s only decision was trust, and the story of where
            it landed comes back to them.
          </p>
        </section>

        <p className="donate__tax">
          This page explains our architecture in plain language — it isn&rsquo;t
          tax advice. For your own situation, please consult your tax advisor.
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
