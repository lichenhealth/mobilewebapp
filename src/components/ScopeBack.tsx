import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from './Icon';
import { supabase } from '../lib/supabase';
import { resolveIdentityScope } from '../lib/identityScope';
import './ScopeBack.css';

/** THE WAY BACK TO WHOSE VIEW THIS IS (founder 2026-08-15, as a UI rule):
 *  "if you go to Places, Events, etc via the filter of a member, community,
 *  group, etc, it has a smart back button to their profile that persists
 *  until you're done with that action, or make a choice to navigate
 *  elsewhere."
 *
 *  It reads the scope straight off the URL (`?space=` / `?member=`), so it
 *  persists exactly as long as you're inside that entity's view and vanishes
 *  the moment you leave — no state to go stale, no history to guess at.
 *  Distinct from ScopeEmpty/ScopeMore, which point OUT to the whole section;
 *  this points BACK to the entity you came from. */
export default function ScopeBack({ sectionLabel }: {
  /** The section's own name ("Marketplace", "Courses") — names the clear-
   *  filter chip an identity scope shows. */
  sectionLabel?: string;
}) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const spaceId = params.get('space');
  const memberId = params.get('member');
  // An IDENTITY scope (founder 2026-08-21) gets TWO chips: back to the
  // gathering, and an explicit clear — "so you're just on marketplace" —
  // because at this exact moment both are steps someone wants to see.
  const identityId = params.get('identity');
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setName(null);
    if (spaceId) {
      void supabase.from('spaces').select('name').eq('id', spaceId).maybeSingle()
        .then(({ data }) => { if (live) setName((data as { name: string } | null)?.name ?? null); });
    } else if (memberId) {
      void supabase.from('profiles').select('full_name').eq('id', memberId).maybeSingle()
        .then(({ data }) => { if (live) setName((data as { full_name: string | null } | null)?.full_name ?? null); });
    } else if (identityId) {
      void resolveIdentityScope(identityId)
        .then((s) => { if (live) setName(s?.plural ?? null); });
    }
    return () => { live = false; };
  }, [spaceId, memberId, identityId]);

  if (!spaceId && !memberId && !identityId) return null;
  if (identityId) {
    return (
      <span className="scope-back-row">
        <button className="scope-back" onClick={() => navigate(`/identities/${identityId}`)}>
          <Icon name="arrow-left" size={13} />
          Back to {name ?? 'the identity'}
        </button>
        <button
          className="scope-back scope-back--clear"
          title={`Stop filtering by ${name ?? 'this identity'}`}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.delete('identity');
            setParams(next, { replace: true });
          }}
        >
          <Icon name="close" size={11} />
          Clear filter — all {sectionLabel ?? 'of this section'}
        </button>
      </span>
    );
  }
  return (
    <button
      className="scope-back"
      onClick={() => navigate(spaceId ? `/spaces/${spaceId}` : `/members/${memberId}`)}
    >
      <Icon name="arrow-left" size={13} />
      Back to {name ?? 'their page'}
    </button>
  );
}
