import './Privacy.css';

/** Terms of service — plain language, honestly Lichen. Publicly reachable
 *  (linked from the Google OAuth consent screen). DRAFT reviewed and
 *  approved by the founder before merge; a lawyer's pass is recommended
 *  before public launch. */
export default function Terms() {
  return (
    <div className="privacy">
      <header className="privacy__head">
        <p className="eyebrow">Lichen · Terms of Service</p>
        <h1 className="privacy__title"><span className="display-italic">The agreement between us</span></h1>
        <p className="privacy__updated">Last updated July 17, 2026</p>
      </header>

      <section className="privacy__sec">
        <h2>What Lichen is</h2>
        <p>
          Lichen is a membership community for holistic care and a more humane,
          conscious economy — a place where members share, teach, trade, gather,
          and care for one another. By creating an account you agree to these
          terms and to our <a href="/privacy">privacy policy</a>.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Membership</h2>
        <p>
          Lichen is a paid membership; subscriptions are billed through Stripe and
          can be changed or cancelled anytime from the Membership page. Gifted
          memberships run for their stated span. You must be at least 18 and a
          real person — one human, one account.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>How we treat each other</h2>
        <p>
          Lichen works because members bring care into it. Don&rsquo;t harass,
          deceive, exploit, or spam other members; don&rsquo;t post content
          that&rsquo;s unlawful or intended to harm. Trust and recommendations are
          personal signals — never gamed, bought, or sold. We may suspend or
          remove accounts that put the community at risk, and we&rsquo;ll always
          tell you why.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Your content stays yours</h2>
        <p>
          Everything you post remains yours. You give Lichen only the permission
          needed to store it and show it to the audiences you chose — nothing
          more. Delete your content and that permission ends with it.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Exchanges between members</h2>
        <p>
          The marketplace, events, and services on Lichen are offered by members,
          to members. <strong>Trust the trader, not the platform</strong>: Lichen
          is not a party to member exchanges, doesn&rsquo;t vet listings, and
          can&rsquo;t guarantee outcomes. Enter exchanges with the same judgment
          you&rsquo;d bring anywhere, and use the trust tools to inform it.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Care, not medicine</h2>
        <p>
          Lichen supports community care — it is not a medical provider, and
          nothing on Lichen is medical advice, diagnosis, or treatment.
          Practitioners on Lichen are independent members responsible for their
          own qualifications and conduct. <strong>In an emergency, call your
          local emergency number</strong> — the Urgent Care tools reach your care
          team, not emergency services.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>The service, honestly</h2>
        <p>
          We work hard to keep Lichen available and correct, and we provide it
          &ldquo;as is,&rdquo; without warranties. To the fullest extent the law
          allows, Lichen&rsquo;s liability for any claim is limited to what
          you&rsquo;ve paid us in the twelve months before the claim. Nothing in
          these terms limits liability where the law says it can&rsquo;t be
          limited.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Changes &amp; goodbyes</h2>
        <p>
          If these terms change in ways that matter, we&rsquo;ll tell you in the
          app before they take effect. You can leave anytime — cancel your
          membership and, if you wish, ask us to delete your account at{' '}
          <a href="mailto:connect@lichen.health">connect@lichen.health</a>.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>The legal frame</h2>
        <p>
          These terms are governed by the laws of the State of Colorado, USA.
          If a dispute arises, we&rsquo;ll try honest conversation first —
          write to <a href="mailto:connect@lichen.health">connect@lichen.health</a>.
        </p>
      </section>
    </div>
  );
}
