import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import './KnockForm.css';

/** The knock at a SPACE's door (founder 2026-08-17: a public page is a
 *  gateway into Lichen). Same shape as /signup's knock — name, email, a few
 *  honest lines — but the knock carries the space, so its stewards see it in
 *  their backstage and can send the invitation themselves. `join-request`
 *  is verify_jwt=false: the asker has no account yet, that's the point. */
export default function KnockForm({ spaceId, spaceName }: { spaceId: string; spaceName: string }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [story, setStory] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // No gate here (founder 2026-09-03, reversing the same-day AlphaGate
  // popup): let people in — those who want to help build get invited into
  // the Alpha Tester group by the founder afterwards.
  async function knock(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Your name and a real email, so someone can write back.'); return;
    }
    setBusy(true);
    const { error: err } = await supabase.functions.invoke('join-request', {
      body: { name: name.trim(), email: email.trim(), story: story.trim(), space_id: spaceId },
    });
    setBusy(false);
    if (err) { setError('Something went wrong — try again in a moment.'); return; }
    setSent(true);
  }

  if (sent) {
    return (
      <p className="knock__sent">
        Got it — thank you. {spaceName}&rsquo;s stewards read every introduction and write back
        personally. Watch your email.
      </p>
    );
  }
  return (
    <form className="knock" onSubmit={knock}>
      <div className="knock__row">
        <label className="knock__label">
          Your name
          <input className="knock__input" type="text" value={name}
            onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
        </label>
        <label className="knock__label">
          Email
          <input className="knock__input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" />
        </label>
      </div>
      <label className="knock__label">
        Who are you, and what draws you to {spaceName}?
        <textarea className="knock__input knock__story" value={story}
          onChange={(e) => setStory(e.target.value)}
          placeholder="A few honest lines — what you do, why this group, who sent you…" />
      </label>
      {/* honeypot — humans never see it, bots can't resist it */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px' }} />
      {error && <p className="knock__error">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Sending…' : `Request to join ${spaceName}`}
      </button>
    </form>
  );
}
