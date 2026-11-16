import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useActing } from '../acting/ActingProvider';
import { ActingGate } from '../components/ActingGate';
import { Icon } from '../components/Icon';
import DriveContacts from '../components/DriveContacts';
import './Saved.css';
import './Contacts.css';

// CONTACTS — ITS OWN DOOR (founder 2026-11-16: "let's build contacts as a side
// nav, maybe under profile, but not nested under it"). The address book that
// used to live as a Drive section: cards (gray until on Lichen, peach once
// they are), lists, and lists shared with you. Composers reach the same rows
// through ContactPicker. Personal — a hat gets the gate.

export default function Contacts() {
  const { user } = useAuth();
  const { actor, ready } = useActing();
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const me = user?.id ?? '';

  if (!ready) return null;
  if (actor.type !== 'self') return <ActingGate what="contacts of its own" icon="contacts" />;

  return (
    <div className="myc contacts">
      <header className="myc__head">
        <h1 className="myc__title">Your contacts</h1>
        <p className="myc__sub">
          Everyone you know, on Lichen or off — gray until they join, peach once
          they do. Invite them to events, send them posts, or share a list.
        </p>
      </header>
      <div className="saved__bar">
        <button className={'mkt__action' + (showSearch ? ' is-active' : '')} aria-label="Search" data-tip="Search"
          onClick={() => { setShowSearch((s) => !s); if (showSearch) setQuery(''); }}>
          <span className="mkt__action-circle"><Icon name="search" size={16} /></span>
        </button>
      </div>
      {showSearch && (
        <input className="saved__search" autoFocus placeholder="Search your contacts and lists" value={query} onChange={(e) => setQuery(e.target.value)} />
      )}
      <div className="contacts__body">
        {me && <DriveContacts me={me} query={query} />}
      </div>
    </div>
  );
}
