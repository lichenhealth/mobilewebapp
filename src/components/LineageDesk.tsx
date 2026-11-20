// Platform stewards review lineage nominations (founder 2026-11-20: "platform
// stewards, but members can recommend or nominate someone"). Approving a
// LINEAGE creates its page, held in trust by Lichen; approving a HOLDER asks
// that person to accept — stewardship never moves without their yes.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { approveNomination, declineNomination, listPendingNominations, type LineageNomination } from '../lib/lineageApi';

export default function LineageDesk() {
  const [rows, setRows] = useState<LineageNomination[] | null>(null);
  const [edit, setEdit] = useState<Record<string, { name: string; description: string }>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = () => void listPendingNominations().then(setRows);
  useEffect(() => {
    load();
    if (window.location.hash === '#lineages') {
      setTimeout(() => document.getElementById('lineages')?.scrollIntoView({ block: 'start' }), 300);
    }
  }, []);

  async function act(n: LineageNomination, ok: boolean) {
    setBusy(n.id); setErr('');
    try {
      if (ok) await approveNomination(n.id, edit[n.id]?.name, edit[n.id]?.description);
      else await declineNomination(n.id);
      load();
    } catch (e) { setErr((e as Error).message); }
    setBusy('');
  }

  return (
    <section className="adminc__vocab" id="lineages" style={{ scrollMarginTop: 'calc(var(--top-h) + 10px)' }}>
      <h2 className="adminc__title adminc__title--section">Wisdom lineages</h2>
      <p className="adminc__sub">
        Members nominate lineages and their holders. An approved lineage gets a page, and Lichen holds its value
        in trust until a recognized holder accepts stewardship.
      </p>
      {rows === null ? <p className="adminc__muted">Loading…</p>
        : rows.length === 0 ? <p className="adminc__muted">No nominations waiting.</p>
        : rows.map((n) => {
          const e = edit[n.id] ?? { name: n.name ?? '', description: n.description ?? '' };
          return (
            <div className="adminc__row" key={n.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
              {n.kind === 'lineage' ? (<>
                <strong>Lineage nominated by {n.nominator?.full_name ?? 'a member'}</strong>
                <input className="adminc__input" value={e.name} aria-label="Lineage name"
                  onChange={(ev) => setEdit((m) => ({ ...m, [n.id]: { ...e, name: ev.target.value } }))} />
                <textarea className="adminc__input" rows={2} value={e.description} placeholder="A short, respectful description"
                  onChange={(ev) => setEdit((m) => ({ ...m, [n.id]: { ...e, description: ev.target.value } }))} />
              </>) : (
                <strong>
                  {n.nominator?.full_name ?? 'A member'} nominated{' '}
                  <Link className="link-cue" to={`/members/${n.nominee_profile_id}`}>{n.nominee?.full_name ?? 'someone'}</Link>
                  {' '}as a holder of{' '}
                  <Link className="link-cue" to={`/members/${n.lineage_id}`}>{n.lineage?.full_name ?? 'a lineage'}</Link>
                </strong>
              )}
              {n.note && <p className="adminc__muted" style={{ margin: 0 }}>“{n.note}”</p>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" disabled={busy === n.id || (n.kind === 'lineage' && e.name.trim().length < 2)}
                  onClick={() => void act(n, true)}>
                  {n.kind === 'lineage' ? 'Approve lineage' : 'Ask them to accept'}
                </button>
                <button className="btn btn-ghost" disabled={busy === n.id} onClick={() => void act(n, false)}>Decline</button>
              </div>
            </div>
          );
        })}
      {err && <p className="adminc__muted" style={{ color: 'var(--red-deep)' }}>{err}</p>}
    </section>
  );
}
