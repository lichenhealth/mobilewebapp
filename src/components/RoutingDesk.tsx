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
    })();
    return () => { live = false; };
  }, []);

  if (entrusted === null) return null;

  const message = async (profileId: string) => {
    try { navigate(`/chat/${await ensureDirectChat(profileId)}`); } catch (e) { console.error(e); }
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
          <div className="curc__routing-acts">
            <button className="curc__keep" onClick={() => navigate(`/posts/${o.id}`)}>View listing</button>
            <button className="curc__keep" onClick={() => void message(o.author_id)}>Message giver</button>
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
        </div>
      ))}
    </div>
  );
}
