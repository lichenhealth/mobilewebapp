import { useEffect, useState } from 'react';
import { loadPollOptions, loadPollVotes, loadPollPending, memberPollVote, pollDecide, type PollOption, type PollVote } from '../lib/pollApi';
import { minToLabel, type EventRow } from '../lib/calendarApi';
import { zoneAbbr } from '../lib/bookingApi';
import { localDate } from '../lib/conciergeApi';
import './EventPoll.css';

// THE TIME POLL ON THE EVENT PAGE (founder 2026-11-09: "Like Google doodles,
// but elegantly integrated into the event flow"). Guests check every time
// that works; the host sees who can make each one, the chosen suggestion
// with its reason, and sets the time with one tap.

export function pollOptionLabel(o: { start_date: string; all_day: boolean; start_min: number | null; end_min: number | null }, tz?: string | null): string {
  const day = localDate(o.start_date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  if (o.all_day || o.start_min == null) return `${day} · all day`;
  const z = zoneAbbr(tz, o.start_date, o.start_min);
  return `${day} · ${minToLabel(o.start_min)} – ${minToLabel(o.end_min ?? o.start_min)}${z ? ' ' + z : ''}`;
}

export default function EventPoll({ ev, me, isHost, canVote, onDecided }: {
  ev: EventRow; me: string; isHost: boolean; canVote: boolean; onDecided?: () => void;
}) {
  const [opts, setOpts] = useState<PollOption[]>([]);
  const [votes, setVotes] = useState<PollVote[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [err, setErr] = useState('');
  const [deciding, setDeciding] = useState<string | null>(null);

  async function load() {
    const [o, v] = await Promise.all([loadPollOptions(ev.id), loadPollVotes(ev.id, me)]);
    setOpts(o); setVotes(v);
    setMine(new Set(v.filter((x) => x.mine).map((x) => x.option_id)));
    if (isHost) setPending(await loadPollPending(ev.id, ev.creator_id));
  }
  useEffect(() => { void load(); }, [ev.id, me, isHost]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!opts.length) return null;
  const toggle = (id: string) => setMine((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); setSaved('idle'); return n; });

  async function save() {
    setSaved('saving'); setErr('');
    try { await memberPollVote(ev.id, [...mine]); setSaved('saved'); await load(); }
    catch (e) { setErr((e as Error).message || 'That didn’t save.'); setSaved('idle'); }
  }
  async function decide(id: string) {
    setDeciding(id); setErr('');
    try { await pollDecide(ev.id, id); onDecided?.(); }
    catch (e) { setErr((e as Error).message || 'That didn’t go through.'); setDeciding(null); }
  }

  const deadline = ev.poll_deadline ? new Date(ev.poll_deadline) : null;
  const max = Math.max(0, ...opts.map((o) => votes.filter((v) => v.option_id === o.id).length));

  return (
    <section className="evpoll">
      <p className="evpoll__eyebrow">Choosing the time</p>
      <h3 className="evpoll__title">{canVote && !isHost ? 'Which times work for you?' : 'Which times work?'}</h3>
      <p className="evpoll__sub">
        {canVote && !isHost ? 'Check every time you can make it.' : 'Guests check every time they can make it.'}
        {deadline && ` Votes close ${deadline.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`}
      </p>
      <ul className="evpoll__list">
        {opts.map((o) => {
          const who = votes.filter((v) => v.option_id === o.id);
          const suggested = ev.poll_suggested === o.id;
          return (
            <li key={o.id} className={'evpoll__opt' + (suggested ? ' is-suggested' : '')}>
              <label className="evpoll__pick">
                {canVote && <input type="checkbox" checked={mine.has(o.id)} onChange={() => toggle(o.id)} />}
                <span className="evpoll__when">{pollOptionLabel(o, ev.timezone)}</span>
                {suggested && <span className="evpoll__tag">Suggested</span>}
              </label>
              {isHost && (
                <div className="evpoll__tally">
                  <span className="evpoll__bar"><span style={{ width: max ? `${(who.length / max) * 100}%` : '0%' }} /></span>
                  <span className="evpoll__count">{who.length ? `${who.length} · ${who.map((w) => w.name.split(' ')[0]).join(', ')}` : 'nobody yet'}</span>
                  <button className="evpoll__set" disabled={!!deciding} onClick={() => void decide(o.id)}>
                    {deciding === o.id ? 'Setting…' : 'Set this time'}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {isHost && ev.poll_reason && <p className="evpoll__reason">✨ {ev.poll_reason}</p>}
      {canVote && !isHost && (
        <button className="btn btn-primary evpoll__save" onClick={() => void save()} disabled={saved === 'saving'}>
          {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Your times are in ✓' : 'Save my times'}
        </button>
      )}
      {isHost && (
        <p className="evpoll__fine">
          {pending.length ? `Waiting on ${pending.length}: ${pending.slice(0, 6).join(', ')}${pending.length > 6 ? '…' : ''}. ` : 'Everyone has answered. '}
          {ev.poll_wait_all ? 'It decides once everyone answers' : ''}{ev.poll_wait_all && deadline ? ' or at the deadline' : !ev.poll_wait_all && deadline ? 'It decides at the deadline' : ''}
          {(ev.poll_wait_all || deadline) ? ` — ${ev.poll_auto ? 'and books it automatically' : 'and asks you to confirm'}. ` : 'Set a time whenever you’re ready. '}
          {ev.poll_rules ? `Your rules: “${ev.poll_rules}”.` : ''}
        </p>
      )}
      {err && <p className="evpoll__err">{err}</p>}
    </section>
  );
}
