import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { classifyCareContact } from '../lib/careTeamApi';
import { loadSpaceNames } from '../lib/postsApi';
import {
  listGuestLists, createGuestList, updateGuestList, deleteGuestList,
  entryKey, entryLabel, listToRows, exportRows, type GuestList, type ListEntry,
} from '../lib/guestListsApi';
import './DriveContacts.css';

// CONTACTS IN DRIVE (founder 2026-11-06: "Should we create a drive folder
// for Contacts and have various guest lists within it?… exporting contacts
// … if people wanna leave the platform, or manage an invite off platform"):
// a Drive SECTION (not a collection folder — folders hold posts by
// reference, a guest list isn't a post). Each list opens in place: its
// people, an add box, Use-for-an-event, CSV/vCard export, rename, delete.
// Owner-only, like everything in Drive.

type Props = {
  me: string;
  query: string;
  foldHead: (id: string, label: string, count: number, extra?: React.ReactNode) => React.ReactNode;
  foldOpen: (id: string) => boolean;
};

/** "Rick Countryman rick@barn.com" → "Rick Countryman" (the contact stripped). */
function nameFrom(line: string): string {
  return line
    .replace(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/\+?[\d\s().-]{7,}/g, '')
    .replace(/[<>,]/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function DriveContacts({ me, query, foldHead, foldOpen }: Props) {
  const navigate = useNavigate();
  const [lists, setLists] = useState<GuestList[]>([]);
  const [spaceNames, setSpaceNames] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [addLine, setAddLine] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState<string | null>(null);

  async function refresh() {
    const rows = await listGuestLists(me);
    setLists(rows);
    const ids = rows.flatMap((l) => l.space_ids);
    if (ids.length) setSpaceNames(await loadSpaceNames(ids));
  }
  useEffect(() => { void refresh(); }, [me]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lists;
    return lists.filter((l) => l.name.toLowerCase().includes(q)
      || l.entries.some((e) => entryLabel(e).toLowerCase().includes(q)));
  }, [lists, query]);

  // The freshest lists, synchronously — two quick adds must not both build
  // on the same stale row and drop one.
  const listsRef = useRef<GuestList[]>([]);
  listsRef.current = lists;
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  async function patch(l: GuestList, p: Partial<Pick<GuestList, 'name' | 'entries' | 'space_ids'>>) {
    listsRef.current = listsRef.current.map((x) => x.id === l.id ? { ...x, ...p } : x);
    setLists(listsRef.current);
    // Saves QUEUE: two quick edits must reach the server in order, or the
    // older write lands last and erases the newer one.
    const run = saveChain.current.then(() => updateGuestList(l.id, p));
    saveChain.current = run.catch(() => undefined);
    try { await run; setNote(null); }
    catch (e) { setNote((e as Error).message); void refresh(); }
  }

  function addTo(l: GuestList) {
    const line = addLine.trim();
    if (!line) return;
    const c = classifyCareContact(line);
    let entry: ListEntry | null = null;
    if (c.kind === 'email') entry = { kind: 'email', value: c.email, name: nameFrom(line) };
    else if (c.kind === 'phone') entry = { kind: 'phone', value: c.digits, sms: c.sms, name: nameFrom(line) };
    else {
      // "Rick 303-555-0123": the classifier reads a BARE phone, so pull a
      // phone-shaped tail off the line (Compose's invite-box rule).
      const tail = /(\+?[\d\s().\-]{7,})$/.exec(line);
      const digits = tail ? tail[1].replace(/\D/g, '') : '';
      if (tail && digits.length >= 7 && digits.length <= 16) {
        entry = { kind: 'phone', value: digits, sms: tail[1].replace(/[^\d+]/g, ''), name: nameFrom(line) };
      }
    }
    if (!entry) { setNote('Type an email or a phone number (a name in front is fine). Members join a list from an event’s invite box.'); return; }
    const k = entryKey(entry);
    const cur = listsRef.current.find((x) => x.id === l.id) ?? l;
    if (cur.entries.some((e) => entryKey(e) === k)) { setNote('Already on this list.'); return; }
    void patch(cur, { entries: [...cur.entries, entry] });
    setAddLine('');
  }

  async function create() {
    const n = newName.trim();
    if (!n) return;
    try {
      const row = await createGuestList(me, n);
      setLists((cur) => [row, ...cur]);
      setOpen(row.id); setCreating(false); setNewName(''); setNote(null);
    } catch (e) { setNote((e as Error).message); }
  }

  const people = (l: GuestList) => l.entries.length;
  const meta = (l: GuestList) => {
    const bits = [`${people(l)} ${people(l) === 1 ? 'person' : 'people'}`];
    if (l.space_ids.length) bits.push(`${l.space_ids.length} circle${l.space_ids.length === 1 ? '' : 's'}`);
    return bits.join(' · ');
  };

  return (
    <section className="drive__drafts dcon">
      <div className="drive__items-head">
        {foldHead('contacts', 'Contacts', lists.length)}
      </div>
      {foldOpen('contacts') && (<>
        {visible.map((l) => {
          const isOpen = open === l.id;
          return (
            <div key={l.id} className={'dcon__list' + (isOpen ? ' is-open' : '')}>
              <div className="drive__row" role="button" tabIndex={0} aria-expanded={isOpen}
                onClick={() => { setOpen(isOpen ? null : l.id); setNote(null); setDel(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(isOpen ? null : l.id); }}>
                <span className="drive__row-icon"><Icon name="user-multiple" size={16} /></span>
                <span className="drive__row-main">
                  {renaming === l.id ? (
                    <input className="dcon__rename" value={renameVal} autoFocus maxLength={80}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' && renameVal.trim()) { void patch(l, { name: renameVal.trim() }); setRenaming(null); }
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={() => { if (renameVal.trim() && renameVal.trim() !== l.name) void patch(l, { name: renameVal.trim() }); setRenaming(null); }} />
                  ) : (
                    <span className="drive__row-title">{l.name}</span>
                  )}
                  <span className="drive__row-meta">Guest list · {meta(l)}</span>
                </span>
                <span className={'drive__foldcar' + (isOpen ? ' is-open' : '')} aria-hidden="true">
                  <Icon name="chevron-right" size={13} />
                </span>
              </div>
              {isOpen && (
                <div className="dcon__panel">
                  {l.entries.length === 0 && l.space_ids.length === 0 && (
                    <p className="dcon__empty">Nobody here yet — add an email or phone below, or save people from an event’s invite box.</p>
                  )}
                  {l.entries.map((e) => (
                    <div key={entryKey(e)} className={'dcon__person' + (e.kind === 'member' ? ' is-member' : '')}>
                      <Icon name={e.kind === 'member' ? 'profile' : e.kind === 'email' ? 'send' : 'phone'} size={13} />
                      <span className="dcon__person-name">{entryLabel(e)}</span>
                      {e.kind === 'member' && <span className="dcon__tag">on Lichen</span>}
                      <button className="dcon__x" aria-label={`Remove ${entryLabel(e)}`}
                        onClick={() => void patch(l, { entries: l.entries.filter((x) => entryKey(x) !== entryKey(e)) })}>×</button>
                    </div>
                  ))}
                  {l.space_ids.map((sid) => (
                    <div key={sid} className="dcon__person is-member">
                      <Icon name="user-multiple" size={13} />
                      <span className="dcon__person-name">{spaceNames.get(sid) ?? 'A circle'}</span>
                      <span className="dcon__tag">whole circle</span>
                      <button className="dcon__x" aria-label="Remove circle"
                        onClick={() => void patch(l, { space_ids: l.space_ids.filter((x) => x !== sid) })}>×</button>
                    </div>
                  ))}
                  <div className="dcon__add">
                    <input className="dcon__input" value={addLine} placeholder="Add an email or phone — e.g. Rick rick@barn.com"
                      autoCapitalize="none" autoCorrect="off" spellCheck={false}
                      onChange={(e) => setAddLine(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTo(l); } }} />
                    <button className="dcon__addbtn" disabled={!addLine.trim()} onClick={() => addTo(l)}>Add</button>
                  </div>
                  {note && <p className="dcon__note">{note}</p>}
                  <div className="dcon__acts">
                    <button className="dcon__act dcon__act--lead" onClick={() => navigate(`/compose?area=events&list=${l.id}`)}>
                      Invite them to an event ›
                    </button>
                    <button className="dcon__act" onClick={() => exportRows(l.name, listToRows(l), 'csv')}>Export CSV</button>
                    <button className="dcon__act" onClick={() => exportRows(l.name, listToRows(l), 'vcf')}>Export vCard</button>
                    <button className="dcon__act" onClick={() => { setRenaming(l.id); setRenameVal(l.name); }}>Rename</button>
                    <button className={'dcon__act dcon__act--danger'}
                      onClick={() => {
                        if (del !== l.id) { setDel(l.id); return; }
                        void deleteGuestList(l.id).then(() => { setLists((cur) => cur.filter((x) => x.id !== l.id)); setOpen(null); setDel(null); });
                      }}>
                      {del === l.id ? 'Really delete?' : 'Delete'}
                    </button>
                  </div>
                  <p className="dcon__fine">
                    Exports carry what you typed. Members export as their name and Lichen profile link — their private email and phone stay theirs.
                    CSV opens in Excel or Google Sheets; vCard imports into your phone’s contacts.
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {creating ? (
          <div className="dcon__add dcon__add--new">
            <input className="dcon__input" value={newName} autoFocus maxLength={80} placeholder="Name the list — e.g. Solstice regulars"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void create(); } if (e.key === 'Escape') setCreating(false); }} />
            <button className="dcon__addbtn" disabled={!newName.trim()} onClick={() => void create()}>Create</button>
            <button className="dcon__cancel" aria-label="Cancel" onClick={() => { setCreating(false); setNewName(''); }}>×</button>
          </div>
        ) : (
          <button className="dcon__new" onClick={() => { setCreating(true); setNote(null); }}>⊕ New guest list</button>
        )}
        {!open && note && <p className="dcon__note">{note}</p>}
      </>)}
    </section>
  );
}
