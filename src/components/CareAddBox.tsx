import { useEffect, useState, type MutableRefObject } from 'react';
import { supabase } from '../lib/supabase';
import {
  classifyCareContact, inviteCare, inviteCareByPhone, addCareCaregiverById, offerCareFor,
  type PreparedCareText,
} from '../lib/careTeamApi';
import './CareAddBox.css';

type Hit = { id: string; full_name: string | null; headline: string | null };

type Props = {
  /** Who the added person becomes on the link: 'caregiver' = someone joining
   *  MY care team; 'patient' = someone I offer to care for. */
  role: 'caregiver' | 'patient';
  me: string;
  /** The inviter's display name — spoken in the prepared text. */
  myName: string;
  /** Reload whatever list this box feeds. */
  onAdded: () => void;
  inputRef?: MutableRefObject<HTMLInputElement | null>;
  placeholder?: string;
};

/** THE SMART CARE ADD (founder 2026-09-26: "a smart, type ahead (no copy
 *  and paste), so no errors") — one box, name first. A typed name finds
 *  members; no member by that name prompts an invite for that person, by
 *  email or phone (classified by classifyCareContact, so a pasted contact
 *  line can never be stored malformed again). Shared by the Concierge Care
 *  Team tab and Profile's "People you care for" — the every-surface rule. */
export default function CareAddBox({ role, me, myName, onAdded, inputRef, placeholder }: Props) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searched, setSearched] = useState(false);
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [text, setText] = useState<PreparedCareText | null>(null);

  const contact = classifyCareContact(q);
  const chContact = classifyCareContact(channel);

  // Name type-ahead — existing members. Email/phone shapes skip the search;
  // they're a channel, not a name.
  useEffect(() => {
    setSearched(false);
    if (contact.kind !== 'name' || contact.name.length < 2) { setHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name, headline').ilike('full_name', `%${contact.name}%`).limit(5);
      if (!live) return;
      setHits(((data as Hit[] | null) ?? []).filter((m) => m.id !== me));
      setSearched(true);
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
    // contact derives from q — q is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, me]);

  function reset() { setQ(''); setChannel(''); setHits([]); setSearched(false); }

  async function addMember(id: string) {
    setBusy(true); setMsg('');
    const res = role === 'caregiver' ? await addCareCaregiverById(id) : await offerCareFor(id);
    setBusy(false); setMsg(res.message);
    if (res.ok) { reset(); onAdded(); }
  }

  async function sendEmail(value: string) {
    setBusy(true); setMsg('');
    const res = await inviteCare(role, value);
    setBusy(false); setMsg(res.message);
    if (res.ok) { reset(); onAdded(); }
  }

  async function sendPhone(value: string, inviteeName?: string) {
    setBusy(true); setMsg('');
    const res = await inviteCareByPhone(role, value, myName, inviteeName);
    setBusy(false); setMsg(res.message);
    if (res.ok) { reset(); setText(res.text ?? null); onAdded(); }
  }

  async function copyText() {
    if (!text) return;
    try { await navigator.clipboard.writeText(text.body); setMsg('Copied — paste it into a text to them.'); }
    catch { setMsg('Couldn’t copy automatically — long-press the message in your Messages app instead.'); }
  }

  // The typed line IS a channel (someone typed or pasted an email/phone
  // directly) — offer the invite right on the row.
  const directAct = contact.kind === 'email'
    ? { label: 'Invite', run: () => void sendEmail(q) }
    : contact.kind === 'phone'
      ? { label: 'Text the invite', run: () => void sendPhone(q) }
      : null;

  // A real name with no member behind it → the invite prompt.
  const noMatch = contact.kind === 'name' && contact.name.length >= 2 && searched && hits.length === 0;
  const chAct = chContact.kind === 'email'
    ? { label: 'Invite', run: () => void sendEmail(channel) }
    : chContact.kind === 'phone'
      ? { label: 'Text the invite', run: () => void sendPhone(channel, contact.kind === 'name' ? contact.name : undefined) }
      : null;

  return (
    <div className="careadd">
      <div className="careadd__row">
        <input className="careadd__input" ref={inputRef} value={q}
          onChange={(e) => { setQ(e.target.value); setMsg(''); setText(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && directAct && !busy) directAct.run(); }}
          placeholder={placeholder ?? 'Type their name…'} />
        {directAct && (
          <button className="btn btn-primary careadd__btn" disabled={busy} onClick={directAct.run}>
            {busy ? '…' : directAct.label}
          </button>
        )}
      </div>

      {hits.length > 0 && (
        <div className="careadd__hits">
          {hits.map((h) => (
            <button className="careadd__hit" key={h.id} disabled={busy} onClick={() => void addMember(h.id)}>
              <span className="careadd__hit-name">{h.full_name ?? 'Member'}</span>
              {h.headline && <span className="careadd__hit-sub">{h.headline}</span>}
              <span className="careadd__hit-add" aria-hidden>{role === 'caregiver' ? 'Add' : 'Offer'}</span>
            </button>
          ))}
        </div>
      )}

      {noMatch && (
        <div className="careadd__invite">
          <p className="careadd__invite-lead">
            No member named &ldquo;{contact.kind === 'name' ? contact.name : q}&rdquo; yet — invite them to Lichen
            and they&rsquo;ll land in your care circle when they join:
          </p>
          <div className="careadd__row">
            <input className="careadd__input" value={channel}
              onChange={(e) => { setChannel(e.target.value); setMsg(''); setText(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && chAct && !busy) chAct.run(); }}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              placeholder="Their email or phone number" />
            <button className="btn btn-primary careadd__btn" disabled={busy || !chAct}
              onClick={() => chAct?.run()}>
              {busy ? '…' : chAct?.label ?? 'Invite'}
            </button>
          </div>
          {channel.trim().length > 0 && !chAct && (
            <p className="careadd__hint">Enter a full email address or phone number.</p>
          )}
        </div>
      )}

      {text && (
        <div className="careadd__text">
          <a className="btn btn-primary careadd__btn" href={text.href}>Text &rsaquo;</a>
          <button className="btn careadd__btn" onClick={() => void copyText()}>Copy the message</button>
        </div>
      )}

      {msg && <p className="careadd__msg">{msg}</p>}
    </div>
  );
}
