import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import {
  loadConciergeAccess, loadCareClients, messagePreview, formatRelative,
  colorFor, monogramFor, CareClient,
} from '../lib/chatApi';
import './Caregiver.css';

/** Caregiver dashboard — a Concierge feature. Lists the clients you care for,
 *  ordered by last engagement; each opens that client's Concierge page. */
export default function Caregiver() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [clients, setClients] = useState<CareClient[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!me) return;
    let active = true;
    (async () => {
      const ok = await loadConciergeAccess(me);
      if (!active) return;
      setAllowed(ok);
      if (ok) {
        const list = await loadCareClients(me);
        if (active) setClients(list);
      }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, [me]);

  return (
    <div className="cg">
      <header className="cg__head">
        <span className="eyebrow">Caregiver</span>
        <h1 className="cg__title">
          <span className="display-italic">Your clients</span>
        </h1>
        <p className="cg__sub">People whose care team you're on. Open a client to see their WOW, KOC, and chat.</p>
      </header>

      {loading && <div className="cg__empty"><p>Loading your clients…</p></div>}

      {!loading && allowed === false && (
        <div className="cg__gate">
          <Icon name="shield-user" size={22} />
          <h3 className="cg__gate-title">A Concierge feature</h3>
          <p className="cg__gate-sub">
            The caregiver dashboard — one place for all the people you care for — is part of
            Concierge membership.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/membership')}>See Concierge</button>
        </div>
      )}

      {!loading && allowed && clients.length === 0 && (
        <div className="cg__empty">
          <Icon name="heart-line" size={20} />
          <p>No clients yet</p>
          <p className="cg__empty-sub">
            When someone adds you to their care team (or you offer to care for them and they accept),
            they'll appear here.
          </p>
          <button className="btn btn-primary" onClick={() => navigate('/profile#care-for')}>
            Manage who you care for
          </button>
        </div>
      )}

      {!loading && allowed && clients.length > 0 && (
        <div className="cg__list">
          {clients.map((c) => (
            <button
              key={c.patient_id}
              className="cg__row"
              onClick={() => navigate(`/concierge/client/${c.patient_id}`)}
            >
              <span className="cg__avatar" style={{ background: colorFor(c.patient_id) }}>
                {monogramFor(c.name)}
              </span>
              <span className="cg__row-body">
                <span className="cg__row-top">
                  <span className="cg__row-name">{c.name}</span>
                  <span className="cg__row-time">{c.last ? formatRelative(c.last.created_at) : ''}</span>
                </span>
                <span className="cg__row-preview">
                  {c.last ? messagePreview(c.last) : <em>No messages yet</em>}
                </span>
              </span>
              <Icon name="chevron-right" size={16} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
