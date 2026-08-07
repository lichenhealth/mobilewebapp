import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { useNotifications } from '../notifications/NotificationsProvider';
import { listMyAdminDeskCounts } from '../lib/spacesApi';
import { supabase } from '../lib/supabase';
import { useAdminView, setAdminView } from '../lib/adminView';

/** MEMBER VIEW | ADMIN VIEW, on the page rather than in the menu (founder
 *  2026-08-08). A space page has carried this pair since 2026-07-27; Lichen's
 *  own front door now carries it too, and there it means stewarding the
 *  platform: the menu narrows to the spaces you manage, with blue desk badges,
 *  and a platform admin also gets the Lichen group (knocks, memberships,
 *  categories). Blue = tending the structure; peach = life inside it.
 *
 *  Renders nothing for members who steward nothing — the toggle only appears
 *  where there's something to steward. */
export default function AdminViewToggle() {
  const { user, isAdmin: platformAdmin } = useAuth();
  const { countsBySection } = useNotifications();
  const adminView = useAdminView();
  const [deskTotal, setDeskTotal] = useState(0);
  const [stewards, setStewards] = useState(false);
  const [knocks, setKnocks] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void listMyAdminDeskCounts(user.id).then((d) => {
      if (!live) return;
      setStewards(d.ids.size > 0);
      setDeskTotal(Object.values(d.counts).reduce((a, b) => a + b, 0));
    });
    return () => { live = false; };
  }, [user]);

  // Platform admins also carry the door: people waiting to be let in.
  useEffect(() => {
    if (!platformAdmin) return;
    let live = true;
    void supabase.from('join_requests').select('id', { count: 'exact', head: true })
      .eq('status', 'new').then(({ count }) => { if (live) setKnocks(count ?? 0); });
    return () => { live = false; };
  }, [platformAdmin]);

  if (!user || (!stewards && !platformAdmin)) return null;

  const badge = deskTotal + knocks + (platformAdmin ? (countsBySection['profile'] ?? 0) : 0);

  return (
    <div className="view-toggle-row view-toggle-row--center">
      <span className="view-toggle" role="group" aria-label="View">
        <button
          className={'view-toggle__side' + (!adminView ? ' is-on' : '')}
          onClick={() => setAdminView(false)}
        >
          Member view
        </button>
        <button
          className={'view-toggle__side view-toggle__side--admin' + (adminView ? ' is-on' : '')}
          onClick={() => setAdminView(true)}
          title={platformAdmin
            ? 'Steward Lichen itself — the spaces you manage, and what waits at the platform desk'
            : 'See only the spaces you manage, and what waits at each desk'}
        >
          Admin view
          {badge > 0 && <span className="view-toggle__badge">{badge > 9 ? '9+' : badge}</span>}
        </button>
      </span>
    </div>
  );
}
