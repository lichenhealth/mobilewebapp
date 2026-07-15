import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import './Invite.css';

type GiftTier = 'community' | 'concierge';

// null = no end date. Labels double as email copy ("a year of Lichen").
const GIFT_SPANS: { months: number | null; label: string }[] = [
  { months: 3, label: '3 months' },
  { months: 6, label: '6 months' },
  { months: 12, label: '1 year' },
  { months: null, label: 'No end date' },
];

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
        setMsg(`${to} is already on Lichen 🌿 — gifted ${giftMonths ? GIFT_SPANS.find((sp) => sp.months === giftMonths)?.label + ' of ' : ''}${giftTier === 'concierge' ? 'Concierge' : 'Community'} instead.`);
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
      ? `Invitation sent to ${to} — ${giftMonths ? (GIFT_SPANS.find((sp) => sp.months === giftMonths)?.label + ' of ') : ''}${giftTier === 'concierge' ? 'Concierge' : 'Community'} is waiting for them at signup.`
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
          Know someone who belongs here? Send them an invitation to join Lichen.
        </p>
      </header>

      {error && <p className="invite__error">{error}</p>}
      {msg && <p className="invite__msg">{msg}</p>}

      <div className="invite__form">
        <label className="invite__label" htmlFor="invite-email">Their email</label>
        <input
          id="invite-email"
          className="invite__input"
          type="email"
          placeholder="friend@example.com"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setMsg(''); }}
        />

        <label className="invite__label" htmlFor="invite-note">Add a note (optional)</label>
        <textarea
          id="invite-note"
          className="invite__input invite__textarea"
          placeholder="A personal line — why you think they'd love Lichen."
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />

        {isAdmin && (
          <div className="invite__gift">
            <label className="invite__gift-toggle">
              <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} />
              <span>Include a gifted membership</span>
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
              <div className="invite__gift-tiers">
                {GIFT_SPANS.map((sp) => (
                  <button
                    key={String(sp.months)}
                    type="button"
                    className={'invite__gift-tier' + (giftMonths === sp.months ? ' is-on' : '')}
                    onClick={() => setGiftMonths(sp.months)}
                  >
                    {sp.label}
                  </button>
                ))}
              </div>
            )}
            {gift && (
              <p className="invite__gift-hint">
                Their membership activates the moment they sign up with this email — no paywall.
              </p>
            )}
          </div>
        )}

        <button className="btn btn-primary invite__send" onClick={send} disabled={busy || !email.trim()}>
          {busy ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </div>
  );
}
