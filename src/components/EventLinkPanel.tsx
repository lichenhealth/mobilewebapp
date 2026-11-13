import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { setEventLinkAccess } from '../lib/calendarApi';
import { listMyMemberSpaces } from '../lib/spacesApi';
import {
  mintEventLink, loadEventGuests, approveEventGuest, declineEventGuest, type EventGuest,
} from '../lib/eventGuestsApi';

/** THE CALENDAR EVENT'S INVITE LINK (founder 2026-11-13: "there should be an
 *  invite link generated for each calendar event that you can optionally
 *  click to send the link to someone to invite them, with the same rule sets
 *  around permissions… Anyone with the link can join, or anyone with the link
 *  who's also <insert rule> can join, or anyone with the link can request to
 *  join"). The SAME machinery formal events use — guest_link_token +
 *  link_access + /e/<link> — so the rules are one set: request_event_spot /
 *  join_event_by_link / _event_link_tier decide who gets in. Host-only. */

export type LinkTier = 'anyone' | 'invited' | 'members' | 'circles';
export const LINK_TIERS: [LinkTier, string, string][] = [
  ['anyone', 'Anyone with the link can join', 'whoever opens it is in — on Lichen or off'],
  ['members', 'Anyone on Lichen with the link can join', 'members come straight in; people off Lichen are asked to sign in'],
  ['circles', 'Anyone with the link who’s in a circle you pick can join', 'only members of the communities or groups you tick below'],
  ['invited', 'Anyone with the link can ask to join', 'people you invited land on their own invitation; everyone else asks and you approve'],
];

/** ONE panel for every event's link (founder 2026-11-13: "merge the two for
 *  the link on events"): the calendar editor AND a formal event's page render
 *  this. `defaultTier` = what the event's audience implies when no rule was
 *  ever set (a formal event's visibility); `showQueue` off where the host's
 *  page already lists the asks beside its guest list; `onLink` tells the page
 *  the link exists. */
export default function EventLinkPanel({ eventId, me, defaultTier = 'invited', showQueue = true, intro, onLink }: {
  eventId: string; me: string; defaultTier?: LinkTier; showQueue?: boolean; intro?: string; onLink?: (url: string | null) => void;
}) {
  const [link, setLinkRaw] = useState<string | null>(null);
  const setLink = (u: string | null) => { setLinkRaw(u); onLink?.(u); };
  const [tier, setTier] = useState<LinkTier>(defaultTier);
  const [spaces, setSpaces] = useState<string[]>([]);
  const [circles, setCircles] = useState<{ id: string; name: string }[]>([]);
  const [guests, setGuests] = useState<EventGuest[]>([]);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState('');
  const [armNo, setArmNo] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void supabase.from('events').select('guest_link_token, link_access, link_space_ids').eq('id', eventId).maybeSingle()
      .then(({ data }) => {
        if (!live || !data) return;
        const d = data as { guest_link_token: string | null; link_access: LinkTier | null; link_space_ids: string[] | null };
        if (d.guest_link_token) setLink(`https://lichen.health/e/${d.guest_link_token}`);
        setTier(d.link_access ?? defaultTier);
        setSpaces(d.link_space_ids ?? []);
      });
    void loadEventGuests(eventId).then((g) => { if (live) setGuests(g); });
    void listMyMemberSpaces(me).then((r) => { if (live) setCircles(r.map((x) => ({ id: x.id, name: x.name }))); }).catch(() => {});
    return () => { live = false; };
  }, [eventId, me]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pick(k: LinkTier, nextSpaces = spaces) {
    setTier(k); setMsg('');
    if (k === 'circles' && !nextSpaces.length) return;   // waits for a tick
    setBusy(true);
    try { await setEventLinkAccess(eventId, k, nextSpaces); }
    catch (e) { setMsg((e as Error).message || 'That didn’t save.'); }
    finally { setBusy(false); }
  }

  async function make(rotate = false) {
    setBusy(true); setMsg('');
    try {
      // The link carries its rule from the first moment it exists.
      if (!(tier === 'circles' && !spaces.length)) await setEventLinkAccess(eventId, tier, spaces);
      const tok = await mintEventLink(eventId, rotate);
      setLink(`https://lichen.health/e/${tok}`); setCopied(false);
    } catch (e) { setMsg((e as Error).message || 'Could not make the link.'); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt('Copy the link:', link); }
  }
  async function share() {
    if (!link) return;
    if (navigator.share) { try { await navigator.share({ url: link }); return; } catch { /* cancelled */ } }
    void copy();
  }

  async function approve(g: EventGuest) {
    setBusy(true);
    try { await approveEventGuest(g); setGuests(await loadEventGuests(eventId)); setMsg(g.email ? `${g.name} is in — they’ve been emailed.` : `${g.name} is in — text them the good news.`); }
    catch (e) { setMsg((e as Error).message || 'Could not approve.'); }
    finally { setBusy(false); }
  }
  async function refuse(g: EventGuest) {
    if (armNo !== g.id) { setArmNo(g.id); return; }
    setArmNo(null); setBusy(true);
    try { await declineEventGuest(g.id); setGuests((x) => x.filter((y) => y.id !== g.id)); }
    finally { setBusy(false); }
  }

  const asked = guests.filter((g) => g.status === 'requested');
  const joined = guests.filter((g) => g.status !== 'requested');

  return (
    <div className="evlink">
      <span className="cedit__label">Invite link</span>
      <p className="calp__match-soft">{intro ?? 'One link to text, post or email — it lets people in by the rule you choose.'}</p>
      <div className="evlink__tiers" role="radiogroup" aria-label="Who the link lets in">
        {LINK_TIERS.map(([k, label, hint]) => (
          <label key={k} className={'evlink__tier' + (tier === k ? ' is-on' : '')}>
            <input type="radio" name={`evlink-${eventId}`} checked={tier === k} disabled={busy} onChange={() => void pick(k)} />
            <span><strong>{label}</strong><em>{hint}</em></span>
          </label>
        ))}
      </div>
      {tier === 'circles' && (
        <div className="evlink__circles">
          {circles.length === 0 && <p className="calp__match-soft">You’re not in any communities or groups yet.</p>}
          {circles.map((c) => {
            const on = spaces.includes(c.id);
            return (
              <label key={c.id} className="evlink__circle">
                <input type="checkbox" checked={on} disabled={busy} onChange={() => {
                  const next = on ? spaces.filter((x) => x !== c.id) : [...spaces, c.id];
                  setSpaces(next);
                  if (next.length) void pick('circles', next);
                }} /> {c.name}
              </label>
            );
          })}
          {!spaces.length && <p className="calp__match-soft">Tick at least one — the link keeps its earlier rule until you do.</p>}
        </div>
      )}
      {link ? (
        <>
          <p className="evlink__url">{link}</p>
          <div className="evlink__row">
            <button className="btn evlink__btn" onClick={() => void share()}>Send the link</button>
            <button className="btn evlink__btn" onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy'}</button>
            <button className="btn evlink__btn" onClick={() => void make(true)} disabled={busy}>New link</button>
          </div>
          <p className="calp__match-soft">“New link” retires the old one everywhere it was sent.</p>
        </>
      ) : (
        <button className="btn evlink__btn" onClick={() => void make()} disabled={busy}>{busy ? 'Making it…' : 'Create the invite link'}</button>
      )}
      {showQueue && asked.length > 0 && (
        <div className="evlink__asked">
          <span className="cedit__label">Asked to join</span>
          {asked.map((g) => (
            <div key={g.id} className="evlink__guest">
              <span>{g.name} <em>· {g.email ?? g.phone}</em></span>
              <span className="evlink__row">
                <button className="btn evlink__btn" onClick={() => void approve(g)} disabled={busy}>Approve</button>
                <button className="btn evlink__btn" onClick={() => void refuse(g)} disabled={busy}>{armNo === g.id ? 'Sure?' : 'Not a fit'}</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {showQueue && joined.length > 0 && (
        <p className="calp__match-soft">Came in by link: {joined.map((g) => g.name).join(', ')}</p>
      )}
      {msg && <p className="calp__match-soft" role="status">{msg}</p>}
    </div>
  );
}
