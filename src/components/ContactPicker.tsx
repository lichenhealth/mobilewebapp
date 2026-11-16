import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { listContacts, onLichen, type Contact } from '../lib/contactsApi';
import { listGuestLists, entryKey, entryLabel, type GuestList, type ListEntry } from '../lib/guestListsApi';
import './ContactPicker.css';

// PICK FROM YOUR CONTACTS (founder 2026-11-16: "have Events and Cal and even
// post composers have icons to add via contacts or target contact lists").
// One window every composer opens: your LISTS (a whole list in one tap) and
// your CARDS (one person at a time). Peach = on Lichen, gray = reached by
// email or text. It only returns entries; each composer decides what an
// entry means there (an event seat, an invitation, a post's audience).

/** The ONE rule turning a card into something a composer can reach: a
 *  linked member → a member entry; otherwise its first email, else its first
 *  phone. A card with none (or a group linked only as a space) can't be
 *  reached, and says why. */
export function entryForContact(c: Contact): ListEntry | null {
  if (c.linked_profile_id) return { kind: 'member', id: c.linked_profile_id, name: c.name, contact_id: c.id };
  if (c.emails[0]) return { kind: 'email', value: c.emails[0], name: c.name, contact_id: c.id };
  if (c.phones[0]) {
    const digits = c.phones[0].replace(/\D/g, '');
    return { kind: 'phone', value: digits, sms: c.phones[0].replace(/[^\d+]/g, ''), name: c.name, contact_id: c.id };
  }
  return null;
}

type Props = {
  me: string;
  onClose: () => void;
  onAdd: (entries: ListEntry[]) => void;
  /** Words for the button and the heading — "Invite", "Send to"… */
  verb?: string;
  /** Keys already chosen in the composer (entryKey) — shown ticked, disabled. */
  already?: Set<string>;
};

export default function ContactPicker({ me, onClose, onAdd, verb = 'Add', already }: Props) {
  const [cards, setCards] = useState<Contact[]>([]);
  const [lists, setLists] = useState<GuestList[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'lists' | 'people'>('people');
  const [picked, setPicked] = useState<Map<string, ListEntry>>(new Map());
  const [listPicked, setListPicked] = useState<Set<string>>(new Set());
  // Composers pass a fresh onClose every render — keep it out of the load's deps.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let live = true;
    void Promise.all([listContacts(me).catch(() => []), listGuestLists(me).catch(() => [])]).then(([c, l]) => {
      if (!live) return;
      setCards(c.filter((x) => x.kind === 'person' || x.emails.length || x.phones.length || x.linked_profile_id));
      setLists(l);
      if (l.length && !c.length) setTab('lists');
      setLoaded(true);
    });
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', esc);
    return () => { live = false; window.removeEventListener('keydown', esc); };
  }, [me]);

  const needle = q.trim().toLowerCase();
  const shownCards = useMemo(() => cards
    .filter((c) => !needle || [c.name, ...c.emails, ...c.phones].join(' ').toLowerCase().includes(needle))
    .sort((a, b) => a.name.localeCompare(b.name)), [cards, needle]);
  const shownLists = useMemo(() => lists.filter((l) => !needle || l.name.toLowerCase().includes(needle)), [lists, needle]);

  const toggleCard = (c: Contact) => {
    const e = entryForContact(c); if (!e) return;
    setPicked((cur) => { const n = new Map(cur); const k = entryKey(e); n.has(k) ? n.delete(k) : n.set(k, e); return n; });
  };
  const toggleList = (l: GuestList) => setListPicked((cur) => { const n = new Set(cur); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; });

  const result = useMemo(() => {
    const out = new Map<string, ListEntry>();
    for (const l of lists) if (listPicked.has(l.id)) for (const e of l.entries) out.set(entryKey(e), e);
    for (const [k, e] of picked) out.set(k, e);
    for (const k of already ?? []) out.delete(k);
    return [...out.values()];
  }, [lists, listPicked, picked, already]);
  const onCount = result.filter((e) => e.kind === 'member').length;
  const offCount = result.length - onCount;

  return (
    <div className="cpick" role="dialog" aria-label="Your contacts" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cpick__card">
        <div className="cpick__head">
          <span className="cpick__mark"><Icon name="contacts" size={16} /></span>
          <p className="cpick__title">Pick from your contacts</p>
          <button className="cpick__x" onClick={onClose} aria-label="Close"><Icon name="close" size={14} /></button>
        </div>
        <input className="cpick__search" autoFocus placeholder="Search names, emails, phones…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="cpick__tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'people'} className={'cpick__tab' + (tab === 'people' ? ' is-on' : '')} onClick={() => setTab('people')}>People · {cards.length}</button>
          <button role="tab" aria-selected={tab === 'lists'} className={'cpick__tab' + (tab === 'lists' ? ' is-on' : '')} onClick={() => setTab('lists')}>Lists · {lists.length}</button>
        </div>
        <div className="cpick__body">
          {!loaded && <p className="cpick__empty">Opening your contacts…</p>}
          {loaded && tab === 'people' && (shownCards.length ? shownCards.map((c) => {
            const e = entryForContact(c);
            const k = e ? entryKey(e) : '';
            const has = !!e && (picked.has(k) || !!already?.has(k));
            const live = onLichen(c);
            return (
              <label key={c.id} className={'cpick__row' + (!e ? ' is-off' : '')}>
                <input type="checkbox" checked={has} disabled={!e || !!already?.has(k)} onChange={() => toggleCard(c)} />
                <span className={'cpick__ava' + (live ? ' is-live' : '')}>
                  {c.photo_url ? <img src={c.photo_url} alt="" /> : <Icon name={c.kind === 'person' ? 'profile' : 'user-multiple'} size={13} />}
                </span>
                <span className="cpick__main">
                  <span className={'cpick__name' + (live ? ' is-live' : '')}>{c.name}</span>
                  <span className="cpick__meta">
                    {!e ? 'No email or phone on this card'
                      : e.kind === 'member' ? 'On Lichen — sees it there'
                      : e.kind === 'email' ? `By email · ${e.value}` : `By text · ${c.phones[0]}`}
                    {already?.has(k) ? ' · already added' : ''}
                  </span>
                </span>
              </label>
            );
          }) : <p className="cpick__empty">{needle ? 'No one matches.' : 'No contact cards yet — add them in Contacts.'}</p>)}
          {loaded && tab === 'lists' && (shownLists.length ? shownLists.map((l) => {
            const on = l.entries.filter((e) => e.kind === 'member').length;
            return (
              <label key={l.id} className="cpick__row">
                <input type="checkbox" checked={listPicked.has(l.id)} onChange={() => toggleList(l)} />
                <span className="cpick__ava is-list"><Icon name="contacts" size={13} /></span>
                <span className="cpick__main">
                  <span className="cpick__name">{l.name}</span>
                  <span className="cpick__meta">
                    {l.entries.length} {l.entries.length === 1 ? 'person' : 'people'}
                    {l.entries.length ? ` · ${on} on Lichen, ${l.entries.length - on} by email or text` : ''}
                  </span>
                  {listPicked.has(l.id) && l.entries.length > 0 && (
                    <span className="cpick__peek">{l.entries.slice(0, 8).map(entryLabel).join(', ')}{l.entries.length > 8 ? '…' : ''}</span>
                  )}
                </span>
              </label>
            );
          }) : <p className="cpick__empty">{needle ? 'No list matches.' : 'No lists yet — make one in Contacts.'}</p>)}
        </div>
        <div className="cpick__foot">
          <span className="cpick__count">
            {result.length === 0 ? 'Nobody picked yet'
              : [onCount ? `${onCount} on Lichen` : '', offCount ? `${offCount} by email or text` : ''].filter(Boolean).join(' · ')}
          </span>
          <button className="btn btn-primary" disabled={!result.length} onClick={() => { onAdd(result); onClose(); }}>
            {verb}{result.length ? ` ${result.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
