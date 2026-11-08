import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import Avatar from './Avatar';
import {
  loadRsvpExtras, loadHostMessages, sendHostMessage, loadCohosts, addCohost, removeCohost,
  type EventGuest, type ExtrasRow,
} from '../lib/eventGuestsApi';
import type { RsvpForm } from '../lib/inviteDesign';
import './EventHostSuite.css';

// THE HOST SUITE (founder 2026-11-08, the Paperless Post audit — "build all
// of them in that order!"): beside the guest list, the three things a host
// reaches for after the invitations go out — the REPLIES (headcount with
// plus-ones, the meal tally, every answer), a MESSAGE to everyone, and the
// CO-HOSTS who share the work. Creators add co-hosts; a co-host sees all of
// this and can message, invite and approve, but editing or cancelling the
// event stays the creator's.

interface Attendee { profile_id: string; status: string; profile?: { full_name: string | null } | null }

export default function EventHostSuite({ eventId, me, isCreator, guests, attendees, form }: {
  eventId: string; me: string; isCreator: boolean;
  guests: EventGuest[]; attendees: Attendee[]; form: Required<RsvpForm>;
}) {
  const [extras, setExtras] = useState<ExtrasRow[]>([]);
  const [msgs, setMsgs] = useState<{ id: string; body: string; created_at: string }[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState('');
  const [cohosts, setCohosts] = useState<{ profile_id: string; name: string; avatar_url: string | null }[]>([]);
  const [cq, setCq] = useState('');
  const [hits, setHits] = useState<{ id: string; full_name: string }[]>([]);

  useEffect(() => {
    let live = true;
    void loadRsvpExtras(eventId).then((x) => { if (live) setExtras(x); });
    void loadHostMessages(eventId).then((m) => { if (live) setMsgs(m); });
    void loadCohosts(eventId).then((c) => { if (live) setCohosts(c); });
    return () => { live = false; };
  }, [eventId]);

  useEffect(() => {
    const q = cq.trim();
    if (q.length < 2) { setHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, full_name')
        .ilike('full_name', `%${q}%`).eq('findable', true).neq('id', me).limit(6);
      if (live) setHits(((data as { id: string; full_name: string }[] | null) ?? [])
        .filter((p) => !cohosts.some((c) => c.profile_id === p.id)));
    }, 220);
    return () => { live = false; window.clearTimeout(t); };
  }, [cq, me, cohosts]);

  // Who's coming, counted honestly: members + guests who said going, plus
  // the extra guests their replies bring.
  const replies = useMemo(() => {
    const byGuest = new Map(extras.filter((x) => x.guest_id).map((x) => [x.guest_id!, x]));
    const byMember = new Map(extras.filter((x) => x.profile_id).map((x) => [x.profile_id!, x]));
    const rows: { key: string; name: string; status: string; x?: ExtrasRow }[] = [];
    for (const a of attendees) if (a.status === 'going' || a.status === 'tentative')
      rows.push({ key: 'm' + a.profile_id, name: a.profile?.full_name ?? 'Member', status: a.status, x: byMember.get(a.profile_id) });
    for (const g of guests) if (g.status === 'going' || g.status === 'tentative')
      rows.push({ key: 'g' + g.id, name: g.name, status: g.status, x: byGuest.get(g.id) });
    const going = rows.filter((r) => r.status === 'going');
    const heads = going.reduce((n, r) => n + 1 + (r.x?.plus_ones ?? 0), 0);
    const meals = new Map<string, number>();
    for (const r of going) if (r.x?.meal) meals.set(r.x.meal, (meals.get(r.x.meal) ?? 0) + 1);
    return { rows, heads, meals };
  }, [extras, guests, attendees]);

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true); setSentNote('');
    try {
      const { sent } = await sendHostMessage(eventId, me, draft);
      setDraft('');
      setSentNote(`Sent ✓ — ${sent} email${sent === 1 ? '' : 's'}; everyone on Lichen got a bell, and it’s on every guest’s invitation page.`);
      setMsgs(await loadHostMessages(eventId));
    } catch (e) { setSentNote((e as Error).message || 'That didn’t send.'); }
    finally { setSending(false); }
  }

  const emailed = guests.filter((g) => g.email && ['invited', 'going', 'tentative'].includes(g.status)).length;
  const asks = form.plusOnes > 0 || form.meals.length > 0 || form.questions.length > 0;

  return (
    <div className="ehs">
      <section className="ehs__sec">
        <h4 className="ehs__h">Replies</h4>
        <p className="ehs__sum">
          <strong>{replies.heads}</strong> coming{form.plusOnes > 0 ? ' (with the guests they bring)' : ''}
          {replies.rows.some((r) => r.status === 'tentative') && <> · {replies.rows.filter((r) => r.status === 'tentative').length} maybe</>}
        </p>
        {replies.meals.size > 0 && (
          <p className="ehs__meals">{[...replies.meals].map(([m, n]) => `${m} ×${n}`).join(' · ')}</p>
        )}
        {asks && replies.rows.some((r) => r.x) && (
          <ul className="ehs__list">
            {replies.rows.filter((r) => r.x).map((r) => (
              <li key={r.key} className="ehs__reply">
                <span className="ehs__reply-name">{r.name}{r.x!.plus_ones ? ` +${r.x!.plus_ones}` : ''}{r.status === 'tentative' ? ' · maybe' : ''}</span>
                {r.x!.meal && <span className="ehs__reply-meal">{r.x!.meal}</span>}
                {r.x!.answers.map((a) => (
                  <span key={a.q} className="ehs__reply-a"><em>{a.q}</em> {a.a}</span>
                ))}
              </li>
            ))}
          </ul>
        )}
        {!asks && <p className="ehs__fine">Want plus-ones, meal choices or your own questions? Edit the event → Edit design → Replies.</p>}
      </section>

      <section className="ehs__sec">
        <h4 className="ehs__h">Message everyone</h4>
        <p className="ehs__fine">
          Emails every invited guest{emailed ? ` (${emailed})` : ''}, rings a bell for everyone on Lichen, and pins it to each guest’s invitation page.
        </p>
        <textarea className="ehs__ta" rows={3} maxLength={2000} value={draft}
          placeholder="Parking’s at the back gate — bring a layer, it gets cold after sunset."
          onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-primary ehs__send" onClick={() => void send()} disabled={sending || !draft.trim()}>
          {sending ? 'Sending…' : 'Send to everyone'}
        </button>
        {sentNote && <p className="ehs__fine">{sentNote}</p>}
        {msgs.length > 0 && (
          <ul className="ehs__list">
            {msgs.map((m) => (
              <li key={m.id} className="ehs__msg">
                <span className="ehs__msg-body">{m.body}</span>
                <span className="ehs__msg-when">{new Date(m.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ehs__sec">
        <h4 className="ehs__h">Co-hosts</h4>
        <p className="ehs__fine">Co-hosts can invite guests, approve requests, message everyone and see every reply. Editing or cancelling stays yours.</p>
        {cohosts.length > 0 && (
          <ul className="ehs__list">
            {cohosts.map((c) => (
              <li key={c.profile_id} className="ehs__cohost">
                <Avatar id={c.profile_id} name={c.name} url={c.avatar_url} size={28} />
                <span className="ehs__cohost-name">{c.name}</span>
                {(isCreator || c.profile_id === me) && (
                  <button className="ehs__rm" onClick={async () => {
                    try { await removeCohost(eventId, c.profile_id); setCohosts(cohosts.filter((x) => x.profile_id !== c.profile_id)); }
                    catch (e) { console.error(e); }
                  }}>{c.profile_id === me ? 'Step down' : 'Remove'}</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {isCreator && (
          <div className="ehs__add">
            <input className="ehs__in" placeholder="Add a co-host — a member’s name" value={cq} onChange={(e) => setCq(e.target.value)} />
            {hits.length > 0 && (
              <ul className="ehs__hits">
                {hits.map((h) => (
                  <li key={h.id}>
                    <button onClick={async () => {
                      try {
                        await addCohost(eventId, me, h.id);
                        setCq(''); setHits([]); setCohosts(await loadCohosts(eventId));
                      } catch (e) { console.error(e); }
                    }}>{h.full_name} <span>· add as co-host</span></button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
