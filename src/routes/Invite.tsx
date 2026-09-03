import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** The invitation's standard paragraph — kept in step with send-invite's
 *  DEFAULT_MISSION by hand. Shown as the starting text when an admin chooses
 *  to customize, so they edit the real words rather than a blank box.
 *  Welcome framing (founder 2026-09-03, second pass — "let people in"):
 *  no gate, one honest alpha line, and the Alpha Tester group as the
 *  self-selected door for those who feel called to help build. */
const DEFAULT_MISSION =
  'Thanks in advance for your (precious) time. The foundation of the corrective '
  + 'social network and healthcare system is built, much is still in development, '
  + 'and there will be bugs along the way. Come use the network as it grows — and '
  + 'if you feel called to help build it out, let Galyn know: members who want to '
  + 'give feedback are invited into the Alpha Tester group, where suggestions '
  + "become features. We're grateful to be building it with you.";
import { useAuth } from '../auth/AuthProvider';
import './Invite.css';

type GiftTier = 'community' | 'concierge';

// The chip and the email say the same thing: 1 month, 2 months… 1 year, 2 years.
/** A quiet advisory flag, not a verdict (founder 2026-08-21: "so you can
 *  learn how to identify spam"). Two cheap tells that catch bot noise —
 *  words with no vowels at all ("Ngvjpj") and rAnDoM-cAsE tokens — while a
 *  human name never trips them. The desk still decides; rows marked spam
 *  stay in join_requests as the labeled set a smarter detector learns from. */
function looksSpammy(name: string, story: string | null): boolean {
  const words = `${name} ${story ?? ''}`.split(/\s+/).filter((w) => w.length >= 5);
  for (const w of words) {
    const letters = w.replace(/[^a-zA-Z]/g, '');
    if (letters.length >= 5 && !/[aeiouyAEIOUY]/.test(letters)) return true;
    let flips = 0;
    for (let i = 1; i < letters.length; i++) {
      const a = letters[i - 1], b = letters[i];
      if ((a === a.toLowerCase()) !== (b === b.toLowerCase())) flips++;
    }
    if (flips >= 5) return true;
  }
  return false;
}

const spanText = (m: number | null) =>
  m === null ? 'no end date'
    : m % 12 === 0 ? (m === 12 ? '1 year' : `${m / 12} years`)
    : m === 1 ? '1 month' : `${m} months`;

export default function Invite() {
  const { loading, user, isAdmin } = useAuth();
  // The ledger: my invitations (RLS: created_by = me) + the knocks (admins).
  type InviteRow = {
    token: string; invitee_email: string | null; claimed_by: string | null;
    opened_at: string | null; declined_at?: string | null;
    created_at: string; created_by?: string;
    claimed_name?: string; inviter_name?: string;
  };
  type KnockRow = { id: string; name: string; email: string; story: string | null; status: string; space?: { name: string } | null };
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [knocks, setKnocks] = useState<KnockRow[]>([]);
  const loadLedger = useCallback(async () => {
    if (!user) return;
    // Re-arm the drop-at-the-door scroll: it must wait for THIS load (the
    // admin-scoped one adds rows above the section and moves it).
    setLedgerLoaded(false);
    // Admins see the whole picture — every invitation, and who sent it.
    // Members see their own (RLS decides; the query is the same shape).
    let q = supabase.from('invite_tokens')
      .select('token, invitee_email, claimed_by, opened_at, declined_at, created_at, created_by')
      .order('created_at', { ascending: false }).limit(200);
    if (!isAdmin) q = q.eq('created_by', user.id);
    const { data } = await q;
    const rows = (data as InviteRow[] | null) ?? [];
    const people = [...new Set([
      ...rows.map((r) => r.claimed_by), ...rows.map((r) => r.created_by),
    ])].filter((x): x is string => !!x);
    if (people.length) {
      const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', people);
      const names = new Map(((profs as { id: string; full_name: string | null }[] | null) ?? [])
        .map((p) => [p.id, p.full_name ?? 'a member']));
      rows.forEach((r) => {
        if (r.claimed_by) r.claimed_name = names.get(r.claimed_by);
        if (r.created_by) r.inviter_name = names.get(r.created_by);
      });
    }
    setInvites(rows);
    if (isAdmin) {
      const { data: k } = await supabase.from('join_requests')
        .select('id, name, email, story, status, space:spaces(name)').order('created_at', { ascending: false }).limit(50);
      setKnocks((k as KnockRow[] | null) ?? []);
    }
    setLedgerLoaded(true);
  }, [user, isAdmin]);
  useEffect(() => { void loadLedger(); }, [loadLedger]);

  // A knock's bell drops you AT the door, not at the top of the ledger
  // (founder 2026-08-21). The link carries ?email= (and #door); once the
  // list is real we scroll to the section and light the knock in question.
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const calledEmail = (params.get('email') ?? '').toLowerCase();
  const droppedAtDoor = useRef(false);
  useEffect(() => {
    if (droppedAtDoor.current || !ledgerLoaded || !isAdmin) return;
    if (!calledEmail && hash !== '#door') return;
    // After paint AND a beat for the freshly-loaded rows to take their
    // height — a smooth scroll aimed at a still-moving target lands short.
    // ⚠ The one-shot flag is set when the scroll FIRES, not when it's armed:
    // an armed-then-cleaned-up effect (StrictMode's double pass, a dep blip)
    // would otherwise burn the shot without ever scrolling.
    const t = setTimeout(() => {
      droppedAtDoor.current = true;
      document.getElementById('door')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => clearTimeout(t);
  }, [ledgerLoaded, isAdmin, calledEmail, hash]);

  // One truth per row (founder 2026-08-11): invited → opened (they reached
  // the signup page through their link) → joined. The old page derived
  // "invited" pills by cross-referencing two tables — one list, one status.
  const inviteStatus = (i: InviteRow): 'joined' | 'declined' | 'opened' | 'invited' =>
    i.claimed_by ? 'joined' : i.declined_at ? 'declined' : i.opened_at ? 'opened' : 'invited';
  // Handling a knock moves it off the "waiting" tally and the side-menu
  // badge (founder 2026-08-02) — the row stays visible here either way, so
  // nothing is ever truly lost, just no longer flagged as needing you.
  async function resolveKnock(id: string, status: 'invited' | 'declined' | 'spam') {
    const prior = knocks;
    setKnocks((cur) => cur.map((k) => (k.id === id ? { ...k, status } : k)));
    const { error } = await supabase.from('join_requests').update({ status }).eq('id', id);
    if (error) {
      setKnocks(prior);
      setError(error.message);
    }
  }
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
  // Setting up a young person's account (founder 2026-08-05): the token carries
  // guardianship, so you're holding it from the moment they sign in.
  const [forMinor, setForMinor] = useState(false);
  // Which knock the prefilled form belongs to, so it resolves on send.
  const [pendingKnock, setPendingKnock] = useState<{ id: string; email: string } | null>(null);
  // Personalising an invitation before it goes (founder 2026-08-06): the note
  // is written on the row itself, so nothing is sent until you've read it.
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [composeNote, setComposeNote] = useState('');
  // At the door = those still ASKING (founder 2026-08-11). A knock that got
  // invited lives on as its invitation in the list above; declined ones
  // simply step out of the way.
  const waitingKnocks = knocks.filter((k) => k.status === 'new');
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
    const lead = `${who} invited you to Lichen — a corrective social network for the whole of a life: care, work & offerings, events, places, a fairer economy. It’s early; your first 3 months are on us — come help us build it out and be part of the beginning of a better world. Join: https://lichen.health/signup`;
    return note.trim() ? `${lead}\n\n${note.trim()}` : lead;
  };
  const smsHref = `sms:${recipient}?&body=${encodeURIComponent(inviteMessage())}`;

  /** Lichen is invite-only: the copied message needs a real token so the
   *  signup door opens. Minted fresh per copy (RLS: created_by = me). */
  async function tokenedMessage(): Promise<string> {
    let link = 'https://lichen.health/signup';
    if (user) {
      const { data } = await supabase.from('invite_tokens')
        .insert({ created_by: user.id, ...(forMinor ? { for_minor: true } : {}) })
        .select('token').maybeSingle();
      const tok = (data as { token: string } | null)?.token;
      if (tok) link = `https://lichen.health/signup?invite=${tok}`;
    }
    return inviteMessage().replace('https://lichen.health/signup', link);
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(await tokenedMessage());
      setMsg('Copied — paste it into a text or DM. The link carries their invitation.');
    } catch { setError('Couldn’t copy automatically — long-press the message to copy it.'); }
  }

  useEffect(() => {
    if (!loading && !user) { navigate('/login', { replace: true }); return; }
    if (!user) return;
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      .then(({ data }) => setFullName((data as { full_name: string | null } | null)?.full_name ?? ''));
  }, [user, loading, navigate]);

  async function send(toArg?: string, missionArg?: string) {
    const to = (toArg ?? email).trim();
    const theNote = note.trim();
    // A rewritten opening replaces the standard paragraph; empty keeps it.
    const theMission = (missionArg ?? '').trim();
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
      body: {
        email: to, inviterName: fullName, note: theNote,
        mission: theMission || undefined,
        giftTier: gifting ? giftTier : undefined,
        giftMonths: gifting ? giftMonths : undefined,
      },
    });
    setBusy(false);
    if (e) {
      setError(gifting
        ? 'The membership is reserved for them, but the email didn’t send. Try again in a moment.'
        : 'Couldn’t send the invite just now. Please try again in a moment.');
      return;
    }
    // NOW the knock is genuinely handled — matched on the address that was
    // actually sent to, so a direct send from a row resolves that row.
    const hit = knocks.find((k) => k.email.toLowerCase() === to.toLowerCase());
    if (hit && hit.status !== 'invited') void resolveKnock(hit.id, 'invited');
    if (pendingKnock?.email === to.toLowerCase()) setPendingKnock(null);
    void loadLedger();   // the fresh invitation appears in the list right away
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

        {/* Guardianship rides the invite (founder 2026-08-05). A young person
            doesn't sign themselves up — a grown-up sets the account up, and
            holds it from the first moment. */}
        <label className="invite__minor">
          <input type="checkbox" checked={forMinor}
            onChange={(e) => { setForMinor(e.target.checked); setMsg(''); }} />
          <span>
            I&rsquo;m setting this up for a young person
            <em>
              You&rsquo;ll be their guardian on Lichen: they can offer what they make and hold
              what they earn, and money doesn&rsquo;t move without you. Anyone under 13 can only
              join this way.
            </em>
          </span>
        </label>

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
          <button className="btn btn-primary invite__send" onClick={() => void send()} disabled={busy || channel !== 'email'}>
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

      {/* Who's in, who's still out — your own invitations, and (for admins)
          everyone knocking at the door. */}
      <section className="invite__ledger">
        <h2 className="invite__h2">
          {isAdmin ? 'Invitations across Lichen' : 'Your invitations'}
          {invites.length > 0 && (
            <span className="invite__tally">
              {(['invited', 'opened', 'joined', 'declined'] as const)
                .map((s) => `${invites.filter((i) => inviteStatus(i) === s).length} ${s}`)
                .filter((t) => !t.startsWith('0 declined'))
                .join(' · ')}
            </span>
          )}
        </h2>
        {invites.length === 0 ? (
          <p className="invite__muted">None yet — every invitation you send shows up here.</p>
        ) : (
          <ul className="invite__list">
            {invites.map((i) => {
              const s = inviteStatus(i);
              return (
                <li className="invite__row" key={i.token}>
                  <span className="invite__row-who">
                    {i.invitee_email ?? 'a shared link'}
                    {i.claimed_name && <em> — now {i.claimed_name}</em>}
                    {isAdmin && i.inviter_name && i.created_by !== user?.id && (
                      <em className="invite__by">invited by {i.inviter_name}</em>
                    )}
                  </span>
                  {/* invited → opened (reached the signup page through
                      their link) → joined. One list, one status per row
                      (founder 2026-08-11). */}
                  <span className={'invite__pill' + (s === 'joined' ? ' is-in' : s === 'opened' ? ' is-opened' : s === 'declined' ? ' is-declined' : '')}>
                    {s}
                  </span>
                  <span className="invite__row-when">{i.created_at.slice(0, 10)}</span>
                </li>
              );
            })}
          </ul>
        )}
        {isAdmin && (
          <>
            {/* "At the door" means people still waiting. Handled ones moved
                below — a 0-waiting heading above four rows is what let three
                unsent invitations hide in plain sight (founder 2026-08-06). */}
            <h2 className="invite__h2" id="door">
              At the door
              {waitingKnocks.length > 0 && <span className="invite__tally">{waitingKnocks.length} waiting</span>}
            </h2>
            {waitingKnocks.length === 0 ? (
              <p className="invite__muted">Nobody knocking right now.</p>
            ) : (
              <ul className="invite__list">
                {/* Who they are on one full-width line, the answers on their
                    own line below — the old center-aligned wrap squeezed long
                    names into a broken column (founder 2026-08-21 screenshot).
                    No status pill here: everyone in this list is 'new'. */}
                {waitingKnocks.map((k) => (
                  <li className={'invite__row invite__row--knock' + (calledEmail && k.email.toLowerCase() === calledEmail ? ' is-called' : '')} key={k.id}>
                    <span className="invite__row-who">
                      <span className="invite__knock-name">
                        <strong>{k.name}</strong> · {k.email}
                        {looksSpammy(k.name, k.story) && (
                          <span className="invite__spamflag" title="Automated guess from the name/story shape — you decide">looks like spam</span>
                        )}
                      </span>
                      {k.space && <span className="invite__knock-door">knocked at {k.space.name} — its stewards can answer too</span>}
                      {k.story && <em className="invite__story">{k.story}</em>}
                    </span>
                    {k.status === 'new' && composeFor !== k.id && (
                      <span className="invite__knock-acts">
                        {/* The standard invitation is the default — a personal
                            line is a choice, not a chore (founder 2026-08-06). */}
                        <button className="btn btn-primary invite__use" disabled={busy}
                          onClick={() => void send(k.email, '')}>
                          {busy ? 'Sending…' : 'Send'}
                        </button>
                        <button className="btn invite__use"
                          onClick={() => { setComposeFor(k.id); setComposeNote(DEFAULT_MISSION); }}>
                          Customize &amp; send
                        </button>
                        <button className="invite__dismiss" onClick={() => void resolveKnock(k.id, 'declined')}>
                          Not now
                        </button>
                        {/* Spam is a CATEGORY (founder 2026-08-21): the row
                            steps out like a decline, the address is quietly
                            barred from knocking again, and the labeled row
                            stays as training data. */}
                        <button className="invite__dismiss invite__dismiss--spam" onClick={() => void resolveKnock(k.id, 'spam')}>
                          Spam
                        </button>
                      </span>
                    )}
                    {composeFor === k.id && (
                      <span className="invite__compose">
                        <textarea
                          className="invite__input invite__textarea"
                          rows={8}
                          autoFocus
                          value={composeNote}
                          maxLength={500}
                          placeholder={`What ${k.name} should read when they open it.`}
                          onChange={(e) => setComposeNote(e.target.value)}
                        />
                        <span className="invite__compose-acts">
                          <button className="btn btn-primary" disabled={busy}
                            onClick={() => { void send(k.email, composeNote).then(() => setComposeFor(null)); }}>
                            {busy ? 'Sending…' : 'Send invitation'}
                          </button>
                          <button className="btn" onClick={() => setComposeFor(null)}>Not yet</button>
                        </span>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {/* "Already answered" is gone (founder 2026-08-11): an invited
                knock IS its invitation — it lives in the one list above
                with a real status — and a declined one steps out of the
                way. One table, one appearance. */}
          </>
        )}
      </section>
    </div>
  );
}
