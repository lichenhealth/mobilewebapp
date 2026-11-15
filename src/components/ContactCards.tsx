import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import {
  listContacts, createContact, updateContact, deleteContact, onLichen, contactPath, splitList,
  CONTACT_KINDS, kindMeta, type Contact, type ContactKind, type ContactDraft,
} from '../lib/contactsApi';
import { updateGuestList, type GuestList, type ListEntry } from '../lib/guestListsApi';
import './ContactCards.css';

// CONTACT CARDS (founder 2026-11-15). Gray until they're on Lichen, peach
// once a card links to a real profile or page. People can be personal,
// professional or both; organizations run places (a place card can name the
// organization that runs it, and nests under it here).

type Filter = 'all' | 'personal' | 'professional' | ContactKind;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'person', label: 'People' },
  { id: 'personal', label: 'Personal' },
  { id: 'professional', label: 'Professional' },
  { id: 'organization', label: 'Organizations' },
  { id: 'place', label: 'Places' },
  { id: 'community', label: 'Communities' },
  { id: 'group', label: 'Groups' },
];

type Form = {
  kind: ContactKind; name: string; roles: ('personal' | 'professional')[]; emails: string; phones: string;
  website: string; address: string; notes: string; parent_id: string;
};
const blank = (kind: ContactKind = 'person', parent = ''): Form =>
  ({ kind, name: '', roles: [], emails: '', phones: '', website: '', address: '', notes: '', parent_id: parent });
const toForm = (c: Contact): Form => ({
  kind: c.kind, name: c.name, roles: c.roles, emails: c.emails.join(', '), phones: c.phones.join(', '),
  website: c.website ?? '', address: c.address ?? '', notes: c.notes ?? '', parent_id: c.parent_id ?? '',
});
const fromForm = (f: Form): ContactDraft => ({
  kind: f.kind, name: f.name.trim(), roles: f.kind === 'person' ? f.roles : [],
  emails: splitList(f.emails), phones: splitList(f.phones), website: f.website.trim() || null,
  address: f.address.trim() || null, notes: f.notes.trim() || null,
  parent_id: f.kind === 'place' && f.parent_id ? f.parent_id : null,
});

function entryFor(c: Contact): ListEntry | null {
  if (c.linked_profile_id) return { kind: 'member', id: c.linked_profile_id, name: c.name, ...{ contact_id: c.id } } as ListEntry;
  if (c.emails[0]) return { kind: 'email', value: c.emails[0], name: c.name, ...{ contact_id: c.id } } as ListEntry;
  if (c.phones[0]) return { kind: 'phone', value: c.phones[0].replace(/\D/g, ''), sms: c.phones[0], name: c.name, ...{ contact_id: c.id } } as ListEntry;
  return null;
}
const inList = (l: GuestList, c: Contact) => l.entries.some((e) => (e as { contact_id?: string }).contact_id === c.id);

export default function ContactCards({ me, query, lists, onListsChanged }: {
  me: string; query: string; lists: GuestList[]; onListsChanged: () => void;
}) {
  const navigate = useNavigate();
  const [cards, setCards] = useState<Contact[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState<string | null>(null); // a card id, or 'new'
  const [form, setForm] = useState<Form>(blank());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [del, setDel] = useState(false);

  async function refresh() { setCards(await listContacts(me)); }
  useEffect(() => { void refresh(); }, [me]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const orgs = useMemo(() => cards.filter((c) => c.kind === 'organization'), [cards]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter === 'personal' || filter === 'professional') { if (c.kind !== 'person' || !c.roles.includes(filter)) return false; }
      else if (filter !== 'all' && c.kind !== filter) return false;
      if (!q) return true;
      return [c.name, ...c.emails, ...c.phones, c.website ?? '', c.address ?? '', c.notes ?? ''].join(' ').toLowerCase().includes(q);
    });
  }, [cards, filter, query]);
  const shownIds = new Set(shown.map((c) => c.id));
  // A place sits under the organization that runs it, when both are shown.
  const tops = shown.filter((c) => !(c.parent_id && shownIds.has(c.parent_id)));
  const childrenOf = (id: string) => shown.filter((c) => c.parent_id === id);

  function openCard(c: Contact) {
    if (open === c.id) { setOpen(null); return; }
    setOpen(c.id); setForm(toForm(c)); setNote(null); setDel(false);
  }
  function openNew(kind: ContactKind = 'person', parent = '') {
    setOpen('new'); setForm(blank(kind, parent)); setNote(null); setDel(false);
  }

  async function save() {
    if (!form.name.trim() && !form.emails.trim() && !form.phones.trim()) { setNote('Give the card a name, an email or a phone.'); return; }
    setBusy(true); setNote(null);
    try {
      const saved = open === 'new' ? await createContact(me, fromForm(form)) : await updateContact(open as string, fromForm(form));
      await refresh(); onListsChanged();
      setOpen(saved.id); setForm(toForm(saved));
      setNote(onLichen(saved) ? 'Saved ✓ — they’re on Lichen, so the card is peach.' : 'Saved ✓');
    } catch (e) { setNote((e as Error).message); }
    finally { setBusy(false); }
  }

  async function remove(c: Contact) {
    if (!del) { setDel(true); return; }
    await deleteContact(c.id); setOpen(null); setDel(false); await refresh(); onListsChanged();
  }

  async function addToList(c: Contact, listId: string) {
    const l = lists.find((x) => x.id === listId); const e = entryFor(c);
    if (!l || !e) { setNote('Add an email or phone first — a list needs a way to reach them.'); return; }
    if (inList(l, c)) { setNote(`Already on ${l.name}.`); return; }
    await updateGuestList(l.id, { entries: [...l.entries, e] });
    onListsChanged(); setNote(`Added to ${l.name} ✓`);
  }

  const row = (c: Contact, depth = 0) => {
    const m = kindMeta(c.kind);
    const live = onLichen(c);
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const kids = cards.filter((k) => k.parent_id === c.id);
    const bits = [c.kind === 'person' && c.roles.length ? c.roles.map((r) => r[0].toUpperCase() + r.slice(1)).join(' & ') : m.label];
    if (parent && depth === 0) bits.push(`run by ${parent.name || 'an organization'}`);
    if (c.kind === 'organization' && kids.length) bits.push(`runs ${kids.length} place${kids.length === 1 ? '' : 's'}`);
    bits.push(live ? 'on Lichen' : 'not on Lichen yet');
    const isOpen = open === c.id;
    return (
      <div key={c.id} className={'ccard' + (depth ? ' ccard--child' : '')}>
        <div className={'drive__row ccard__row' + (isOpen ? ' is-open' : '')} role="button" tabIndex={0} aria-expanded={isOpen}
          onClick={() => openCard(c)} onKeyDown={(ev) => { if (ev.key === 'Enter') openCard(c); }}>
          <span className={'ccard__ava' + (live ? ' is-live' : '')} title={live ? 'On Lichen' : 'Not on Lichen yet'}>
            {c.photo_url ? <img src={c.photo_url} alt="" /> : <Icon name={m.icon} size={16} />}
          </span>
          <span className="drive__row-main">
            <span className={'drive__row-title' + (live ? ' ccard__name--live' : '')}>{c.name || c.emails[0] || c.phones[0] || 'Unnamed'}</span>
            <span className="drive__row-meta">{bits.join(' · ')}</span>
          </span>
          <span className={'drive__foldcar' + (isOpen ? ' is-open' : '')} aria-hidden="true"><Icon name="chevron-right" size={13} /></span>
        </div>
        {isOpen && editor(c)}
        {!depth && childrenOf(c.id).map((k) => row(k, 1))}
      </div>
    );
  };

  const editor = (c: Contact | null) => {
    const live = c ? onLichen(c) : false;
    const path = c ? contactPath(c) : null;
    const f = form; const set = (p: Partial<Form>) => setForm({ ...f, ...p });
    const listsWithout = c ? lists.filter((l) => !inList(l, c)) : [];
    return (
      <div className="ccard__panel">
        {c && (
          <p className={'ccard__status' + (live ? ' is-live' : '')}>
            {live
              ? <>On Lichen ✓ {path && <button className="ccard__link" onClick={() => navigate(path)}>Open their {c.linked_space_id ? 'page' : 'profile'} ›</button>}</>
              : <>Not on Lichen yet{c.emails[0] && <> · <button className="ccard__link" onClick={() => navigate(`/invite?email=${encodeURIComponent(c.emails[0])}`)}>Invite to Lichen ›</button></>}</>}
          </p>
        )}
        <div className="ccard__kinds" role="group" aria-label="What kind of contact">
          {CONTACT_KINDS.map((k) => (
            <button key={k.id} type="button" className={'ccard__kind' + (f.kind === k.id ? ' is-on' : '')} onClick={() => set({ kind: k.id })}>
              <Icon name={k.icon} size={13} /> {k.label}
            </button>
          ))}
        </div>
        {f.kind === 'person' && (
          <div className="ccard__roles">
            {(['personal', 'professional'] as const).map((r) => (
              <label key={r}><input type="checkbox" checked={f.roles.includes(r)}
                onChange={(ev) => set({ roles: ev.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} /> {r === 'personal' ? 'Personal' : 'Professional'}</label>
            ))}
          </div>
        )}
        <input className="dcon__input" placeholder="Name" value={f.name} onChange={(ev) => set({ name: ev.target.value })} />
        <input className="dcon__input" placeholder="Email(s) — separate with commas" value={f.emails} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(ev) => set({ emails: ev.target.value })} />
        <input className="dcon__input" placeholder="Phone(s)" value={f.phones} inputMode="tel" onChange={(ev) => set({ phones: ev.target.value })} />
        {f.kind !== 'person' && (
          <input className="dcon__input" placeholder="Website" value={f.website} autoCapitalize="none" autoCorrect="off" spellCheck={false}
            onChange={(ev) => set({ website: ev.target.value })} />
        )}
        <input className="dcon__input" placeholder="Address" value={f.address} onChange={(ev) => set({ address: ev.target.value })} />
        {f.kind === 'place' && (
          <select className="dcon__input" value={f.parent_id} onChange={(ev) => set({ parent_id: ev.target.value })}>
            <option value="">Run by — no organization</option>
            {orgs.filter((o) => o.id !== c?.id).map((o) => <option key={o.id} value={o.id}>Run by {o.name || 'an organization'}</option>)}
          </select>
        )}
        <textarea className="dcon__input ccard__notes" rows={3} placeholder="Notes" value={f.notes} onChange={(ev) => set({ notes: ev.target.value })} />
        {note && <p className="dcon__note">{note}</p>}
        <div className="dcon__acts">
          <button className="dcon__act dcon__act--lead" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
          {c && c.kind === 'organization' && <button className="dcon__act" onClick={() => openNew('place', c.id)}>+ A place it runs</button>}
          {c && listsWithout.length > 0 && (
            <select className="dcon__act ccard__addlist" value="" onChange={(ev) => { if (ev.target.value) void addToList(c, ev.target.value); }}>
              <option value="">Add to a list…</option>
              {listsWithout.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
          <button className="dcon__act" onClick={() => { setOpen(null); setNote(null); }}>Close</button>
          {c && (
            <button className="dcon__act dcon__act--danger" onClick={() => void remove(c)}>
              {del ? `Really delete${lists.filter((l) => inList(l, c)).length ? ' — and take them off their lists' : ''}?` : 'Delete'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="ccards">
      <div className="ccards__filters" role="group" aria-label="Show">
        {FILTERS.map((x) => (
          <button key={x.id} type="button" className={'ccards__filter' + (filter === x.id ? ' is-on' : '')} onClick={() => setFilter(x.id)}>{x.label}</button>
        ))}
      </div>
      <p className="ccards__legend"><span className="ccard__dot is-live" /> on Lichen <span className="ccard__dot" /> not on Lichen yet</p>
      {tops.length === 0 && open !== 'new' && (
        <p className="dcon__empty">{cards.length ? 'Nothing matches.' : 'No contacts yet — add one below, or save people from an event’s invite box.'}</p>
      )}
      {tops.map((c) => row(c))}
      {open === 'new' ? (
        <div className="ccard">
          <div className="drive__row ccard__row is-open"><span className="ccard__ava"><Icon name={kindMeta(form.kind).icon} size={16} /></span>
            <span className="drive__row-main"><span className="drive__row-title">New contact</span></span></div>
          {editor(null)}
        </div>
      ) : (
        <button className="dcon__new" onClick={() => openNew()}>⊕ New contact</button>
      )}
    </div>
  );
}
