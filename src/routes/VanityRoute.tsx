// PLATFORM-WIDE VANITY LINKS (founder 2026-11-04: "vanity url structure should
// be deployed across platform, so you can share a link for anything, a product
// on marketplace a travel review, etc") — lichen.health/<section>/<handle>/<link-name>,
// the /book/<handle>/<slug> grammar generalized to posts.
//
// One dispatcher serves every section route:
//   /<section>/<uuid>            → the section's own page (events → EventPage,
//                                   anything else → the post page)
//   /<section>/<handle>          → that person's/space's section, scoped
//                                   (?member= / ?space= — the standing scope grammar)
//   /<section>/<handle>/<slug>   → the one post wearing that link name
//                                   (events land on /events/<post>; signed OUT an
//                                   event lands on its open /e/ page when minted)
//
// Resolution rides resolve_post_vanity (SECURITY DEFINER — spaces before
// people, the SpaceByHandle order; anon only ever gets a PUBLIC post's id, and
// a signed-in caller's actual read still goes through RLS on the landing page).
// The section word in the URL is a door word, not a gate — a slug found under
// the wrong section still lands on the right piece.
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import EventPage from './EventPage';
import './VanityRoute.css';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SECTION_ROOT: Record<string, { root: string; label: string }> = {
  events: { root: '/events', label: 'Events' },
  marketplace: { root: '/market', label: 'Marketplace' },
  travel: { root: '/travel', label: 'Travel' },
  courses: { root: '/courses', label: 'Courses' },
  library: { root: '/library', label: 'the Library' },
  art: { root: '/art', label: 'Art' },
  food: { root: '/food', label: 'Food' },
  work: { root: '/work', label: 'Work' },
};

type VanityRow = {
  host_kind: 'space' | 'profile';
  host_id: string;
  post_id: string | null;
  areas: string[] | null;
  open_link: string | null;
};

export default function VanityRoute({ area }: { area: string }) {
  const params = useParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const slug = params.slug ?? null;
  // The handle rides whatever the route named its first segment (:postId on
  // the legacy events route, :kind on market's, :param elsewhere).
  const param = params.param ?? params.postId ?? params.kind ?? '';
  const isUuid = UUID_RE.test(param);
  const { root, label } = SECTION_ROOT[area] ?? SECTION_ROOT.marketplace;
  const [miss, setMiss] = useState(false);

  useEffect(() => {
    if (isUuid || !param || loading) return;
    let live = true;
    void (async () => {
      const { data, error } = await supabase.rpc('resolve_post_vanity', {
        p_handle: param, p_slug: slug,
      });
      if (!live) return;
      const row = (Array.isArray(data) ? data[0] : data) as VanityRow | undefined;
      if (error || !row) { setMiss(true); return; }
      if (slug) {
        if (!row.post_id) { setMiss(true); return; }
        if ((row.areas ?? []).includes('events')) {
          // Signed out, an event's shareable /e/ page is the honest landing
          // when the host minted one (RSVP works there; the approval gate
          // covers anyone off the invite list).
          if (!user && row.open_link) navigate(`/e/${row.open_link}`, { replace: true });
          else navigate(`/events/${row.post_id}`, { replace: true });
        } else {
          navigate(`/posts/${row.post_id}`, { replace: true });
        }
      } else {
        const key = row.host_kind === 'space' ? 'space' : 'member';
        navigate(`${root}?${key}=${row.host_id}`, { replace: true });
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, slug, isUuid, loading, user?.id]);

  if (isUuid) {
    return area === 'events' ? <EventPage /> : <Navigate to={`/posts/${param}`} replace />;
  }
  if (miss) {
    return (
      <div className="vanity-miss">
        <p>Nothing lives at this address{param ? <> — <strong>{param}{slug ? `/${slug}` : ''}</strong></> : ''}.</p>
        <Link className="link-cue" to={root}>Browse {label} ›</Link>
      </div>
    );
  }
  return null;
}

/** lichen.health/calendar/<handle> — "sharing your calendar" (founder
 *  2026-11-04) lands on the public booking page, the calendar's open face. */
export function CalendarVanity() {
  const { handle = '' } = useParams();
  return <Navigate to={`/book/${handle}`} replace />;
}
