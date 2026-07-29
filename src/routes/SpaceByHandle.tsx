import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SpaceProfile from './SpaceProfile';

// Clean addresses (founder 2026-07-28): lichen.healthcare/countrymanstables
// resolves a space by its handle and renders its page AT that URL — the
// handle is the address, not a redirect to an id.
export default function SpaceByHandle() {
  const { handle = '' } = useParams();
  const navigate = useNavigate();
  const [id, setId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void supabase.from('spaces').select('id').eq('handle', handle.toLowerCase()).maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setId((data as { id: string } | null)?.id ?? null);
      });
    return () => { live = false; };
  }, [handle]);

  if (id === undefined) return <div className="prof"><p className="sprof__muted">Loading…</p></div>;
  if (id === null) {
    return (
      <div className="prof">
        <p className="sprof__muted">Nothing lives at that address.</p>
        <button className="btn btn-primary" onClick={() => navigate('/home')}>Go to Lichen</button>
      </div>
    );
  }
  return <SpaceProfile spaceId={id} />;
}
