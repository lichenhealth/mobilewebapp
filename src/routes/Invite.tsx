import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Invite.css';

type GiftTier = 'community' | 'concierge';

// The chip and the email say the same thing: 1 month, 2 months… 1 year, 2 years.
const spanText = (m: number | null) =>
  m === null ? 'no end date'
    : m % 12 === 0 ? (m === 12 ? '1 year' : `${m / 12} years`)
    : m === 1 ? '1 month' : `${m} months`;

export default function Invite() {
  const { loading, user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  // Admin-only: attach a gifted membership to the invitation. It's claimed
  // automatically when that email signs up — the invitee never sees the paywall.
  const [gift, setGift] = useState(false);
  const [giftTier, setGiftTier] = useState<GiftTier>('community');
  const [giftMonths, setGiftMonths] = useState<number | null>(12);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  // Email invites send from our server (Resend). Phone invites can't be
  // server-sent without an SMS provider, so the inviter texts it themselves —
  // a prefilled Messages link + a copy fallback (the Care Team pattern).
  const isEmail = (s: string) => /\S+@\S+\.\S+/.test(s.trim());
  const isPhone = (s: string) => /^[\d\s()+.-]{7,}$/.test(s.trim());
  const recipient = email.trim();
  const channel: 'email' | 'phone' | '' = isEmail(recipient) ? 'email' : isPhone(recipient) ? 'phone' : '';

  const inviteMessage = () => {
    const who = fullName.trim() || 'A friend';
    const lead = `${who} invited you to Lichen — a corrective social network for the whole of a life: care, work & offerings, events, places, a fairer economy. It’s early; your first 3 months are on us — come help us build it out and be part of the beginning of a better world. Join: https://lichen.healthcare/signup`;
    return note.trim() ? `${lead}\n\n${note.trim()}` : lead;
  };
  const smsHref = `sms:${recipient}?&body=${encodeURIComponent(inviteMessage())}`;

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteMessage());
      setMsg('Copied — paste it into a text or DM.');
    } catch { setError('Couldn’t copy automatically — long-press the message to copy it.'); }
  }

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (!user) return;
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => setFullName((data as { full_name: string | null } | null)?.full_name ?? ''));
  }, [user, loading, navigate]);

  async function send() {
    const to = email.trim();
    if (!to || !user) return;
    const gifting = isAdmin && gift;
    setBusy(true); setMsg(''); setError('');
    // Don't send a "join Lichen" invite to someone who's already a member —
    // but if an admin is gifting, gift the existing member directly instead.
    const { data: existing } = await supabase.rpc('find_member_by_email', { p_email: to });
    if (((existing as unknown[] | null) ?? []).length > 0) {
      if (gifting) {
        const { error: ge } = await supabase.rpc('gift_subscription', { p_email: to, p_tier: giftTier, p_months: giftMonths });
        setBusy(false);
        if (ge) { setError(ge.message); return; }
        // Email echo — the in-app bell comes from gift_subscription itself,
        // so a failed send here shouldn't fail the gift.
        void supabase.functions.invoke('send-gift-notice', {
          body: { email: to, inviterName: fullName, tier: giftTier, months: giftMonths },
        }).catch(console.warn);
        setMsg(`${to} is already on Lichen 🌿 — gifted ${giftMonths ? spanText(giftMonths) + ' of ' : ''}${giftTier === 'concierge' ? 'Concierge' : 'Community'} instead.`);
        setEmail(''); setNote('');
        return;
      }
      setBusy(false);
      setMsg(`${to} is already on Lichen 🌿 — no invite needed.`);
      return;
    }
    if (gifting) {
      // Park the gift on their email; the membership gate redeems it the
      // moment they sign up. Replace any older pending gift for this email
      // (the partial unique index allows only one).
      await supabase.from('membership_gifts')
        .delete().eq('invitee_email', to.toLowerCase()).eq('status', 'pending');
      const { error: mg } = await supabase.from('membership_gifts')
        .insert({ inviter_id: user.id, invitee_email: to.toLowerCase(), tier: giftTier, months: giftMonths });
      if (mg) { setBusy(false); setError(mg.message); return; }
    }
    const { error: e } = await supabase.functions.invoke('send-invite', {
      body: { email: to, inviterName: fullName, note: note.trim(), giftTier: gifting ? giftTier : undefined, giftMonths: gifting ? giftMonths : undefined },
    });
    setBusy(false);
    if (e) {
      setError(gifting
        ? 'The membership is reserved for them, but the email didn’t send. Try again in a moment.'
        : 'Couldn’t send the invite just now. Please try again in a moment.');
      return;
    }
    setMsg(gifting
      ? `Invitation sent to ${to} — ${giftMonths ? (spanText(giftMonths) + ' of ') : ''}${giftTier === 'concierge' ? 'Concierge' : 'Community'} is waiting for them at signup.`
      : `Invitation sent to ${to}.`);
    setEmail('');
    setNote('');
  }

  if (loading) return <div className="invite"><p className="invite__muted">Loading…</p></div>;

  return (
    <div className="invite">
      <header className="invite__head">
        <h1 className="invite__title">Invite to Lichen</h1>
        <p className="invite__sub">
          Know someone who belongs here? Their first 3 months are on us — an invitation to help
          build out a new way of being together.
        </p>
      </header>

      {error && <p className="invite__error">{error}</p>}
      {msg && <p className="invite__msg">{msg}</p>}

      <div className="invite__form">
        <label className="invite__label" htmlFor="invite-email">Their email or phone</label>
        <input
          id="invite-email"
          className="invite__input"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          placeholder="friend@example.com  or  (555) 123-4567"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMsg(''); }}
        />
        {channel === 'phone' && (
          <p className="invite__hint">
            We’ll open your Messages with the invite ready to send — free, straight from your phone.
          </p>
        )}

        <label className="invite__label" htmlFor="invite-note">Add a note (optional)</label>
        <textarea
          id="invite-note"
          className="invite__input invite__textarea"
          placeholder="A personal line — why you think they'd love Lichen."
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />

        {isAdmin && channel === 'phone' && (
          <p className="invite__hint">To attach a gifted membership, invite by email — gifts are keyed to an email address.</p>
        )}
        {isAdmin && channel !== 'phone' && (
          <div className="invite__gift">
            <p className="invite__gift-auto">
              Every new member automatically gets <strong>3 months of Concierge, free</strong> — no
              gift needed. This is for extending that welcome.
            </p>
            <label className="invite__gift-toggle">
              <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
              <span>Gift a longer membership</span>
            </label>
            {gift && (
              <div className="invite__gift-tiers">
                {(['community', 'concierge'] as GiftTier[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={'invite__gift-tier' + (giftTier === t ? ' is-on' : '')}
                    onClick={() => setGiftTier(t)}
                  >
                    {t === 'concierge' ? 'Concierge' : 'Community'}
                  </button>
                ))}
              </div>
            )}
            {gift && (
              <div className="invite__gift-span">
                <div className={'invite__gift-stepper' + (giftMonths === null ? ' is-off' : '')}>
                  <button type="button" aria-label="Less time"
                    disabled={giftMonths === null || giftMonths <= 1}
                    onClick={() => setGiftMonths((m) => Math.max(1, (m ?? 12) - 1))}>−</button>
                  <span>{giftMonths === null ? '∞' : spanText(giftMonths)}</span>
                  <button type="button" aria-label="More time"
                    disabled={giftMonths === null || giftMonths >= 24}
                    onClick={() => setGiftMonths((m) => Math.min(24, (m ?? 0) + 1))}>+</button>
                </div>
                <button
                  type="button"
                  className={'invite__gift-tier' + (giftMonths === null ? ' is-on' : '')}
                  onClick={() => setGiftMonths(giftMonths === null ? 12 : null)}
                >
                  No end date
                </button>
              </div>
            )}
            {gift && (
              <p className="invite__gift-hint">
                This replaces the standard 3-month welcome — it activates the moment they sign up
                with this email, no paywall.
              </p>
            )}
          </div>
        )}

        {channel === 'phone' ? (
          <div className="invite__phone-actions">
            <a className="btn btn-primary invite__send" href={smsHref}>Text the invite</a>
            <button type="button" className="btn invite__send" onClick={() => void copyInvite()}>Copy invite</button>
          </div>
        ) : (
          <button className="btn btn-primary invite__send" onClick={send} disabled={busy || channel !== 'email'}>
            {busy ? 'Sending…' : 'Send invitation'}
          </button>
        )}

        <p className="invite__give">
          Another way to grow Lichen —{' '}
          <a href="/donate" onClick={(e) => { e.preventDefault(); navigate('/donate'); }}>
            make a tax-deductible donation
          </a>.
        </p>
      </div>
    </div>
  );
}
