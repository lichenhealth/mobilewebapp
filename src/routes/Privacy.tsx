import './Privacy.css';

/** Privacy policy — plain language, honestly Lichen. Publicly reachable
 *  (Google OAuth verification requires it at a stable URL). DRAFT reviewed
 *  and approved by the founder before merge. */
export default function Privacy() {
  return (
    <div className="privacy">
      <header className="privacy__head">
        <p className="eyebrow">Lichen · Privacy</p>
        <h1 className="privacy__title"><span className="display-italic">How we hold your information</span></h1>
        <p className="privacy__updated">Last updated July 17, 2026</p>
      </header>

      <section className="privacy__sec">
        <h2>The short version</h2>
        <p>
          Lichen exists to help a community care for each other — not to monetize
          attention. We don&rsquo;t sell your data, we don&rsquo;t show ads, and we
          don&rsquo;t let third-party trackers watch you. What you share is held for
          one purpose: making the community work.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>What we collect</h2>
        <ul>
          <li><strong>Your account</strong> — name, email, phone (if you add one), and profile details you write.</li>
          <li><strong>What you create</strong> — posts, messages, events, listings, and care-team content you choose to share.</li>
          <li><strong>Your location, on your terms</strong> — only if you add a home location, and only shown to others at the level you choose (hidden, state, county, town, or exact), per audience. The default is hidden.</li>
          <li><strong>Calendar information</strong> — only if you connect an external calendar. See the calendar section below.</li>
          <li><strong>Payments</strong> — handled by Stripe; Lichen never sees or stores your card number.</li>
        </ul>
      </section>

      <section className="privacy__sec">
        <h2>How it&rsquo;s used</h2>
        <p>
          To run Lichen: showing your posts to the audiences you picked, delivering
          messages, powering scheduling and availability, sending the emails you&rsquo;d
          expect (invitations, account notices), and keeping the community safe.
          Trust and recommendation signals stay private to the people who make
          them — there are no public counts or leaderboards, by design.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Connected calendars &amp; Google user data</h2>
        <p>
          If you connect a calendar (Google or another provider), Lichen reads your
          events solely to compute your busy times and show your own schedule to
          you. Other members only ever see &ldquo;busy&rdquo; — never event names,
          descriptions, or attendees. Calendar data is not used for advertising,
          not sold, and not shared.
        </p>
        <p>
          Lichen&rsquo;s use of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>, including its Limited Use requirements. Disconnecting a calendar
          deletes its imported data immediately.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Care information</h2>
        <p>
          Care-team boards and conversations can hold sensitive wellbeing
          information. That content is visible only to you and the care team you
          approve, protected by per-row access rules in our database. Lichen is a
          community-care tool, not a medical record system or HIPAA-covered entity.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Who touches the data</h2>
        <p>
          Lichen runs on carefully chosen infrastructure that processes data on our
          instructions: <strong>Supabase</strong> (database &amp; auth),{' '}
          <strong>Vercel</strong> (hosting), <strong>Stripe</strong> (payments),{' '}
          <strong>Resend</strong> (email delivery), and <strong>Mapbox</strong>{' '}
          (maps &amp; address lookup). None of them may use your content for their
          own purposes. There are no analytics trackers or advertising networks in
          the app.
        </p>
      </section>

      <section className="privacy__sec">
        <h2>Your controls</h2>
        <ul>
          <li>Location, calendar, and content visibility are governed by per-audience rules you set — the most specific rule always wins, and excludes beat includes.</li>
          <li>You can edit or delete your posts, remove connected calendars, and withdraw trust at any time.</li>
          <li>To delete your account and its data, write to <a href="mailto:connect@lichen.health">connect@lichen.health</a> — deletion is honored promptly and cascades through your content.</li>
        </ul>
      </section>

      <section className="privacy__sec">
        <h2>Questions</h2>
        <p>
          Write to <a href="mailto:connect@lichen.health">connect@lichen.health</a>.
          A person answers.
        </p>
      </section>
    </div>
  );
}
