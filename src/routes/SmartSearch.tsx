import { lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/PageHead';
import { Icon } from '../components/Icon';
import type { SmartSearchScope } from '../components/SmartSearchCore';
import type { ServiceArea } from '../lib/postsApi';
import type { WhoKind } from '../lib/smartSearch';
import '../components/SmartSearch.css';

// Lazy — SmartSearchCore + smartSearch.ts run ~1.7k lines and pull in
// LocationField/geoApi/etc. Any caller that does `import('../components/
// SmartSearchCore')` (Marketplace included) shares this exact chunk, so
// splitting it out here doesn't duplicate it per route.
const SmartSearchCore = lazy(() => import('../components/SmartSearchCore'));

/** The standalone /search page — the page-only bits (back button, reading
 *  scope from the URL, the "search everywhere" escape hatch) around the
 *  reusable SmartSearchCore. Section doors: /search?space=<id> ·
 *  ?member=<id> · ?area=<x> · ?who=people — scope comes from WHERE you
 *  pressed Search; the × on the banner widens out. */
export default function SmartSearch() {
  const navigate = useNavigate();
  const [urlParams] = useSearchParams();

  const scope: SmartSearchScope = {
    spaceId: urlParams.get('space'),
    memberId: urlParams.get('member'),
    area: urlParams.get('area') as ServiceArea | null,
    who: urlParams.get('who') as WhoKind | null,
  };

  return (
    <div className="ssrch">
      {/* Always a way back — ☰ + ← icon circles since 2026-10-21 (the
          worded-chip sunset): real history when we came from inside the
          app, else the door we arrived through. */}
      <PageHead fallback={urlParams.get('from') === 'maps' ? '/maps' : '/home'} />
      <Suspense fallback={<p className="ssrch__status">Loading search…</p>}>
        <SmartSearchCore
          scope={scope}
          onClearScope={() => navigate('/search', { replace: true })}
          assistantSection="search"
          embedded
        />
      </Suspense>
    </div>
  );
}
