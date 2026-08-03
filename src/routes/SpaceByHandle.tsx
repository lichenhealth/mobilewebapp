import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SpaceProfile from './SpaceProfile';
import MemberProfile from './MemberProfile';

type Hit = { kind: 'space' | 'profile'; id: string };

// Clean addresses (founder 2026-07-28, widened 2026-08-03 to people too):
// lichen.health/countrymanstables or lichen.health/melaniebright resolves a
// space OR a member by its handle and renders its page AT that URL — the
// handle is the address, not a redirect to an id. A custom domain passes the
// handle (and forcePublic) as props instead — countrymanstables.com serves
// the barn's website to everyone, member or not. Spaces are checked first
// (handles were already in wide use there); a person's handle only resolves
// when no space claims it.
export default function SpaceByHandle({ handle: handleProp, forcePublic }: { handle?: string; forcePublic?: boolean } = {}) {
  const { handle: handleParam = '' } = useParams();
  const handle = handleProp || handleParam;
  const navigate = useNavigate();
  const [hit, setHit] = useState<Hit | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    (async () => {
      const h = handle.toLowerCase();
      const { data: space } = await supabase.from('spaces').select('id').eq('handle', h).maybeSingle();
      if (!live) return;
      if (space) { setHit({ kind: 'space', id: (space as { id: string }).id }); return; }
      const { data: profile } = await supabase.from('profiles').select('id').eq('handle', h).maybeSingle();
      if (!live) return;
      setHit(profile ? { kind: 'profile', id: (profile as { id: string }).id } : null);
    })();
    return () => { live = false; };
  }, [handle]);

  if (hit === undefined) return <div className="prof"><p className="sprof__muted">Loading…</p></div>;
  if (hit === null) {
    return (
      <div className="prof">
        <p className="sprof__muted">Nothing lives at that address.</p>
        <button className="btn btn-primary" onClick={() => navigate('/home')}>Go to Lichen</button>
      </div>
    );
  }
  return hit.kind === 'space'
    ? <SpaceProfile spaceId={hit.id} forcePublic={forcePublic} />
    : <MemberProfile memberId={hit.id} />;
}
