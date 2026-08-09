import { lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
      {/* Always a way back (founder: like Compose) — real history when we
          came from inside the app, else the door we arrived through. */}
      <button
        className="ssrch__back"
        onClick={() => {
          if ((window.history.state as { idx?: number } | null)?.idx) navigate(-1);
          else navigate(urlParams.get('from') === 'maps' ? '/maps' : '/home');
        }}
      >
        <Icon name="arrow-left" size={14} /> {urlParams.get('from') === 'maps' ? 'Back to map' : 'Back'}
      </button>
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
