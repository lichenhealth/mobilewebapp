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
            <span>{n.label}{n.amount_cents ? ` · about ${dollars(n.amount_cents)}` : ''}</span>
          </div>
          <p className="curc__routing-why">{offerLine(n)} · shared {new Date(n.created_at).toLocaleDateString()}{n.gift_offered_post_id ? ' · a gift was offered' : ''}</p>
          <div className="curc__routing-acts">
            <button className="curc__keep" onClick={() => void message(n.profile_id)}>Message them</button>
          </div>
        </div>
      ))}
    </div>
  );
}
