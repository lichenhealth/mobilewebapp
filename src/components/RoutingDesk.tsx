import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ensureDirectChat } from '../lib/chatApi';
import './CurrentcyCard.css';

/** THE ROUTING DESK — the allocation algorithm, v1 (founder + Claude,
 *  2026-07-21). Human-in-the-loop: the machine scans every ENTRUSTED
 *  offering ("Gift · Lichen routes") against every open need (ISO posts),
 *  scores and ranks the matches, and shows its reasoning; the steward
 *  judges need, runs chains, and makes the call. Scoring: shared meaningful
 *  words + double-weighted shared style tags, freshest first. Every routing
 *  a steward approves is doctrine for the day the algorithm runs alone. */

interface Listing {
  id: string;
  author_id: string;
  title: string | null;
  body: string;
  created_at: string;
  details: Record<string, unknown>;
  author?: { full_name: string | null } | null;
}
interface Match { need: Listing; score: number; words: string[]; styles: string[] }
/** A need a member SHARED with Lichen's matcher from their Budget (the gift
 *  economy, 2026-11-16: "Gifts flow to need. Giving earns no claim on
 *  receiving."). Only routing_needs() reads these — admin-gated server-side. */
interface SharedNeed {
  id: string; profile_id: string; full_name: string | null; label: string;
  amount_cents: number | null; offer_kind: 'pay' | 'trade' | 'none' | null;
  offer_cents: number | null; offer_trade: string | null; created_at: string;
  gift_offered_post_id: string | null;
  provider_name: string | null; provider_profile_id: string | null; provider_space_id: string | null;
  funded_cents: number | null; funded_at: string | null;
  gifts_received_180d: number; funded_180d_cents: number;
}
interface Being {
  being_id: string; name: string | null; kind: string | null; jurisdiction: string | null;
  received_cents: number; exchanged_cents: number; returned_cents: number; records: number;
}

/** What the wells would fund: the whole fee when they can't pay, else the
 *  part beyond what they can afford (founder 2026-11-16: "the totality of
 *  her fee… or a portion based on how much you can afford"). */
function fundGap(n: SharedNeed): number | null {
  if (!n.amount_cents) return null;
  const can = n.offer_kind === 'pay' ? (n.offer_cents ?? 0) : 0;
  return Math.max(0, n.amount_cents - can);
}

/** THE SUGGESTION — deterministic, by NEED, never by what someone has given
 *  ("Gifts flow to need. Giving earns no claim on receiving."). A steward
 *  reads the reasons and decides; nothing moves on the score. */
function needScore(n: SharedNeed): { score: number; why: string[] } {
  let score = 0; const why: string[] = [];
  if (n.offer_kind === 'none') { score += 3; why.push("can't pay right now"); }
  else if (n.offer_kind === 'trade') { score += 1; why.push('can only trade'); }
  else if (n.offer_kind === 'pay' && n.amount_cents && (n.offer_cents ?? 0) < n.amount_cents) {
    score += 1; why.push(`can afford ${dollars(n.offer_cents ?? 0)} of ${dollars(n.amount_cents)}`);
  }
  const days = (Date.now() - +new Date(n.created_at)) / 86400000;
  const wait = Math.min(3, Math.floor(days / 14));
  if (wait > 0) { score += wait; why.push(`waiting ${Math.round(days)} days`); }
  const recent = n.gifts_received_180d + Math.floor((n.funded_180d_cents ?? 0) / 10000);
  if (recent > 0) { score -= Math.min(4, recent); why.push('already received recently'); }
  else why.push('nothing received lately');
  if (n.gift_offered_post_id) { score -= 1; why.push('a gift was already offered'); }
  if (n.provider_name) why.push(`from ${n.provider_name}`);
  return { score, why };
}
const needWords = (n: SharedNeed) => new Set(n.label.toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
  .split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const dollars = (c: number) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
function offerLine(n: SharedNeed): string {
  if (n.offer_kind === 'pay') return n.offer_cents ? `can put ${dollars(n.offer_cents)} toward it` : 'can pay some';
  if (n.offer_kind === 'trade') return n.offer_trade ? `could trade: ${n.offer_trade}` : 'could trade';
  if (n.offer_kind === 'none') return "can't pay right now";
  return 'no offer named';
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'my',
  'our', 'your', 'i', 'we', 'is', 'are', 'it', 'this', 'that', 'me', 'you',
  'from', 'at', 'by', 'as', 'be', 'has', 'have', 'was', 'will', 'would',
  'need', 'needs', 'looking', 'search', 'iso', 'want', 'wanted', 'love',
  'anyone', 'someone', 'please', 'thanks',
]);

function tokens(l: Listing): Set<string> {
  return new Set(
    ((l.title ?? '') + ' ' + l.body).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}
function styleTagsOf(l: Listing): string[] {
  const t = l.details?.styleTags;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
}

const SELECT = 'id, author_id, title, body, created_at, details, author:profiles!posts_author_id_fkey(full_name)';

export default function RoutingDesk() {
  const navigate = useNavigate();
  const [entrusted, setEntrusted] = useState<Listing[] | null>(null);
  const [matches, setMatches] = useState<Record<string, Match[]>>({});
  // In-kind donation offers, keyed by post id — accepting passes title to
  // Lichen and triggers the acknowledgment email.
  const [inkind, setInkind] = useState<Record<string, { id: string; kind: string }>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [shared, setShared] = useState<SharedNeed[]>([]);
  const [beings, setBeings] = useState<Being[]>([]);
  const [fundAmt, setFundAmt] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    (async () => {
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      const [off, iso] = await Promise.all([
        supabase.from('posts').select(SELECT)
          .contains('service_areas', ['marketplace']).eq('is_public', true)
          .eq('details->>allocation', 'lichen')
          .gt('created_at', since)
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('posts').select(SELECT)
          .contains('service_areas', ['marketplace']).eq('is_public', true)
          .eq('details->>mode', 'iso')
          .gt('created_at', since)
          .order('created_at', { ascending: false }).limit(100),
      ]);
      if (!live) return;
      if (off.error) { setEntrusted(null); return; }
      const offerings = (off.data as unknown as Listing[] | null) ?? [];
      const needs = (iso.data as unknown as Listing[] | null) ?? [];

      // The scoring pass: shared meaningful words + style affinity ×2.
      const m: Record<string, Match[]> = {};
      for (const o of offerings) {
        const ow = tokens(o);
        const os = styleTagsOf(o);
        m[o.id] = needs
          .filter((n) => n.author_id !== o.author_id)
          .map((n) => {
            const words = [...tokens(n)].filter((w) => ow.has(w));
            const styles = styleTagsOf(n).filter((s) => os.includes(s));
            return { need: n, score: words.length + 2 * styles.length, words, styles };
          })
          .filter((x) => x.score >= 1)
          .sort((a, b) => b.score - a.score
            || +new Date(b.need.created_at) - +new Date(a.need.created_at))
          .slice(0, 3);
      }
      setEntrusted(offerings);
      setMatches(m);
      const { data: sn } = await supabase.rpc('routing_needs');
      if (live) setShared((sn as SharedNeed[] | null) ?? []);
      const { data: bg } = await supabase.rpc('routing_beings');
      if (live) setBeings(((bg as Being[] | null) ?? []).filter((b) => b.received_cents - b.returned_cents > 0));

      // In-kind offers waiting for acceptance (quietly absent pre-migration).
      const { data: ik } = await supabase.from('inkind_donations')
        .select('id, post_id, kind').eq('status', 'offered');
      if (!live) return;
      const ikMap: Record<string, { id: string; kind: string }> = {};
      for (const row of (ik as { id: string; post_id: string | null; kind: string }[] | null) ?? []) {
        if (row.post_id) ikMap[row.post_id] = { id: row.id, kind: row.kind ?? 'goods' };
      }
      setInkind(ikMap);
    })();
    return () => { live = false; };
  }, []);

  if (entrusted === null) return null;

  const message = async (profileId: string) => {
    try { navigate(`/chat/${await ensureDirectChat(profileId)}`); } catch (e) { console.error(e); }
  };

  const acceptDonation = async (postId: string) => {
    const row = inkind[postId];
    if (!row) return;
    setBusy(true); setNote('');
    try {
      const { error } = await supabase.rpc('accept_inkind_donation', { p_id: row.id });
      if (error) throw error;
      const { error: mailErr } = await supabase.functions.invoke('inkind-receipt', { body: { id: row.id } });
      setNote(mailErr
        ? 'Accepted — but the receipt email failed; retry from the dashboard.'
        : 'Accepted — title passed to Lichen, acknowledgment emailed.');
      setInkind((cur) => { const n = { ...cur }; delete n[postId]; return n; });
    } catch (e) {
      setNote((e as { message?: string } | null)?.message || 'Could not accept.');
    }
    setBusy(false);
  };
  const offerGift = async (need: SharedNeed, postId: string) => {
    setBusy(true); setNote('');
    const { error } = await supabase.rpc('offer_gift_for_need', { p_need: need.id, p_post: postId });
    setBusy(false);
    if (error) { setNote(error.message); return; }
    setNote(`Offered — ${need.full_name ?? 'they'} got a bell with a door to the gift. Nothing moves until they take it up.`);
    setShared((cur) => cur.map((x) => x.id === need.id ? { ...x, gift_offered_post_id: postId } : x));
  };
  const fundNeed = async (n: SharedNeed) => {
    const raw = fundAmt[n.id] ?? String((fundGap(n) ?? 0) / 100);
    const c = Math.round(parseFloat(raw) * 100);
    if (!c || c <= 0) { setNote('Name an amount to fund.'); return; }
    setBusy(true); setNote('');
    const { error } = await supabase.rpc('approve_need_funding', { p_need: n.id, p_cents: c });
    setBusy(false);
    if (error) { setNote(error.message); return; }
    setNote(`Approved ${dollars(c)} for ${n.full_name ?? 'them'} — they got a bell. Arrange the payment${n.provider_name ? ` with ${n.provider_name}` : ''} by hand.`);
    setShared((cur) => cur.map((x) => x.id === n.id ? { ...x, funded_cents: c, funded_at: new Date().toISOString() } : x));
  };
  const suggested = shared.filter((n) => !n.funded_cents)
    .map((n) => ({ n, ...needScore(n) }))
    .sort((a, b) => b.score - a.score || +new Date(a.n.created_at) - +new Date(b.n.created_at))
    .slice(0, 5);
  const needsFor = (o: Listing) => {
    const ow = tokens(o);
    return shared.filter((n) => n.profile_id !== o.author_id)
      .map((n) => ({ n, words: [...needWords(n)].filter((w) => ow.has(w)) }))
      .filter((x) => x.words.length > 0)
      .sort((a, b) => b.words.length - a.words.length).slice(0, 3);
  };
  const name = (l: Listing) => l.author?.full_name ?? 'A member';
  const label = (l: Listing) => l.title || (l.body.length > 60 ? l.body.slice(0, 57) + '…' : l.body);

  return (
    <div className="adminc__gift curc__mint">
      <h2 className="adminc__h2">The routing desk</h2>
      <p className="adminc__sub">
        Offerings entrusted to Lichen&rsquo;s routing, matched against open
        asks — ranked by shared words and style affinity. The steward
        completes what the algorithm proposes.
      </p>

      {note && <p className="curc__error">{note}</p>}

      {/* SUGGESTED ROUTING (founder 2026-11-16: "the algo to suggest
          routing, although its manual now"). Ranked by need; the steward
          approves each one, and v1 arranges the payment by hand. */}
      {(suggested.length > 0 || beings.length > 0) && (
        <div className="curc__routing-suggest">
          <h3 className="adminc__h2">Suggested next — by need</h3>
          <p className="adminc__sub">
            Ranked by who can least afford it, how long they&rsquo;ve waited, and
            whether they&rsquo;ve received lately — never by what they&rsquo;ve given.
            You decide; approving bells them, and you arrange the payment.
          </p>
          {suggested.map(({ n, why }) => {
            const gap = fundGap(n);
            return (
              <div className="curc__routing-match" key={'s' + n.id}>
                <div className="curc__routing-match-head">
                  <strong>{n.full_name ?? 'A member'}</strong>
                  <span>{n.label}{n.provider_name ? ` · ${n.provider_name}` : ''}{n.amount_cents ? ` · ${dollars(n.amount_cents)}` : ''}</span>
                </div>
                <p className="curc__routing-why">{why.join(' · ')}</p>
                <div className="curc__routing-acts">
                  <button className="curc__keep" onClick={() => void message(n.profile_id)}>Message them</button>
                  <span className="curc__routing-fund">
                    $<input inputMode="decimal" aria-label="Amount to fund"
                      value={fundAmt[n.id] ?? (gap != null ? String(gap / 100) : '')}
                      placeholder="amount"
                      onChange={(e) => setFundAmt((c) => ({ ...c, [n.id]: e.target.value.replace(/[^0-9.]/g, '') }))} />
                  </span>
                  <button className="btn btn-primary curc__go" disabled={busy} onClick={() => void fundNeed(n)}>Fund from donations</button>
                </div>
              </div>
            );
          })}
          {beings.length > 0 && (<>
            <h3 className="adminc__h2 curc__routing-needs-h">Beings owed restoration</h3>
            <p className="adminc__sub">Where members recorded that a plant, animal, place or element gave more than it received. Totals only — never anyone&rsquo;s note.</p>
            {beings.map((b) => (
              <div className="curc__routing-match" key={b.being_id}>
                <div className="curc__routing-match-head">
                  <strong>{b.name ?? 'A being'}</strong>
                  <span>{b.kind}{b.jurisdiction ? ` · ${b.jurisdiction}` : ''}</span>
                </div>
                <p className="curc__routing-why">
                  gave {dollars(Number(b.received_cents))} in true value
                  {Number(b.exchanged_cents) ? ` (${dollars(Number(b.exchanged_cents))} changed hands)` : ''}
                  {' · '}received back {dollars(Number(b.returned_cents))}
                  {' · '}{b.records} record{b.records === 1 ? '' : 's'}
                </p>
                <div className="curc__routing-acts">
                  <button className="curc__keep" onClick={() => navigate(`/members/${b.being_id}`)}>See {b.name ?? 'them'}</button>
                </div>
              </div>
            ))}
          </>)}
        </div>
      )}

      {entrusted.length === 0 && (
        <p className="curc__empty">
          Nothing entrusted right now — gift listings marked
          &ldquo;Lichen routes&rdquo; gather here.
        </p>
      )}

      {entrusted.map((o) => (
        <div className="curc__donation" key={o.id}>
          <div className="curc__donation-head">
            <strong>{label(o)}</strong>
            <span>{name(o)}</span>
            <em>{new Date(o.created_at).toLocaleDateString()}</em>
          </div>
          {styleTagsOf(o).length > 0 && (
            <p className="curc__routing-styles">{styleTagsOf(o).join(' · ')}</p>
          )}
          {inkind[o.id] && (
            <p className="curc__donation-kind">
              {inkind[o.id].kind === 'services'
                ? 'Offered as donated services to Lichen — accepting emails the services acknowledgment (time isn\u2019t deductible; their out-of-pocket costs may be)'
                : 'Offered as donated goods to Lichen — accepting passes title and emails the receipt'}
            </p>
          )}
          <div className="curc__routing-acts">
            <button className="curc__keep" onClick={() => navigate(`/posts/${o.id}`)}>View listing</button>
            <button className="curc__keep" onClick={() => void message(o.author_id)}>Message giver</button>
            {inkind[o.id] && (
              <button className="btn btn-primary curc__go" disabled={busy} onClick={() => void acceptDonation(o.id)}>
                Accept as donation
              </button>
            )}
          </div>

          {(matches[o.id] ?? []).length === 0 ? (
            <p className="curc__routing-none">No matching asks yet — the matcher will bell new ones.</p>
          ) : (
            (matches[o.id] ?? []).map((mt) => (
              <div className="curc__routing-match" key={mt.need.id}>
                <div className="curc__routing-match-head">
                  <strong>{name(mt.need)}</strong>
                  <span>asks: {label(mt.need)}</span>
                </div>
                <p className="curc__routing-why">
                  score {mt.score}
                  {mt.words.length > 0 && <> · shares &ldquo;{mt.words.slice(0, 4).join('", "')}&rdquo;</>}
                  {mt.styles.length > 0 && <> · style: {mt.styles.join(', ')}</>}
                </p>
                <div className="curc__routing-acts">
                  <button className="curc__keep" onClick={() => navigate(`/posts/${mt.need.id}`)}>View ask</button>
                  <button className="curc__keep" onClick={() => void message(mt.need.author_id)}>Message seeker</button>
                </div>
              </div>
            ))
          )}
          {needsFor(o).map(({ n, words }) => (
            <div className="curc__routing-match" key={n.id}>
              <div className="curc__routing-match-head">
                <strong>{n.full_name ?? 'A member'}</strong>
                <span>shared need: {n.label}</span>
              </div>
              <p className="curc__routing-why">shares &ldquo;{words.slice(0, 4).join('", "')}&rdquo; · {offerLine(n)}</p>
              <div className="curc__routing-acts">
                <button className="curc__keep" onClick={() => void message(n.profile_id)}>Message them</button>
                {n.gift_offered_post_id === o.id
                  ? <span className="curc__routing-none">Offered ✓</span>
                  : <button className="btn btn-primary curc__go" disabled={busy} onClick={() => void offerGift(n, o.id)}>Offer this gift</button>}
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* SHARED NEEDS — what members chose to show the matcher. Gifts flow
          to need; giving earns no claim on receiving. Judge by need. */}
      <h3 className="adminc__h2 curc__routing-needs-h">Needs shared with the matcher · {shared.length}</h3>
      {shared.length === 0 ? (
        <p className="curc__empty">No one has shared a need yet — members tick &ldquo;Let Lichen match gifts to this need&rdquo; in their Budget.</p>
      ) : shared.map((n) => (
        <div className="curc__routing-match" key={n.id}>
          <div className="curc__routing-match-head">
            <strong>{n.full_name ?? 'A member'}</strong>
            <span>{n.label}{n.provider_name ? ` · ${n.provider_name}` : ''}{n.amount_cents ? ` · about ${dollars(n.amount_cents)}` : ''}</span>
          </div>
          <p className="curc__routing-why">{offerLine(n)} · shared {new Date(n.created_at).toLocaleDateString()}{n.gift_offered_post_id ? ' · a gift was offered' : ''}{n.funded_cents ? ` · funded ${dollars(n.funded_cents)}` : ''}</p>
          <div className="curc__routing-acts">
            <button className="curc__keep" onClick={() => void message(n.profile_id)}>Message them</button>
          </div>
        </div>
      ))}
    </div>
  );
}
