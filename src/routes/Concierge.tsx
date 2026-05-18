import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import HexagonRadar from '../components/HexagonRadar';
import { TODAY_SNAPSHOT } from '../data/concierge';
import './Concierge.css';

type ConciergeTab = 'wow' | 'koc' | 'urgent';

/** Renders body text with {{ai:phrase}} markers transformed into <span>s
 *  that get peach color when AI is on, muted gray when AI is off. */
function BodyWithAI({ text, aiOn }: { text: string; aiOn: boolean }) {
  const parts = text.split(/(\{\{ai:[^}]+\}\})/g);
  return (
    <p className="snap__body-text">
      {parts.map((p, i) => {
        const m = p.match(/^\{\{ai:([^}]+)\}\}$/);
        if (m) {
          return (
            <span
              key={i}
              className={'snap__ai-ref' + (aiOn ? '' : ' is-off')}
            >
              {m[1]}
            </span>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

export default function Concierge() {
  const { tab } = useParams<{ tab?: ConciergeTab }>();
  const navigate = useNavigate();
  const activeTab: ConciergeTab = (tab as ConciergeTab) ?? 'wow';

  const [aiOn, setAiOn] = useState(true);
  const [scope, setScope] = useState<'Day' | 'Week' | 'Month'>('Day');
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState('');

  // Chat tab is special — it navigates directly to /chat
  const handleTabClick = (target: ConciergeTab | 'chat') => {
    if (target === 'chat') {
      navigate('/chat');
      return;
    }
    navigate(target === 'wow' ? '/concierge' : `/concierge/${target}`);
  };

  const snap = TODAY_SNAPSHOT;

  return (
    <div className="conc">
      <header className="conc__head">
        <h1 className="conc__title">Concierge</h1>
      </header>

      {/* 4 tabs: WOW / KOC / Chat / Urgent Care */}
      <nav className="conc__tabs">
        <button
          className={'conc__tab' + (activeTab === 'wow' ? ' is-active' : '')}
          onClick={() => handleTabClick('wow')}
        >
          WOW
        </button>
        <button
          className={'conc__tab' + (activeTab === 'koc' ? ' is-active' : '')}
          onClick={() => handleTabClick('koc')}
        >
          KOC
        </button>
        <button className="conc__tab" onClick={() => handleTabClick('chat')}>
          Chat
        </button>
        <button
          className={'conc__tab' + (activeTab === 'urgent' ? ' is-active' : '')}
          onClick={() => handleTabClick('urgent')}
        >
          Urgent Care
        </button>
      </nav>

      {/* Tool row (search · AI brain · scope · pagination) */}
      <div className="conc__tools">
        <button
          className={'conc__tool-circle' + (showSearch ? ' is-active' : '')}
          onClick={() => {
            setShowSearch((s) => !s);
            if (showSearch) setQuery('');
          }}
          aria-label="Search"
        >
          <Icon name="search" size={14} />
        </button>
        <button
          className={'conc__brain' + (aiOn ? ' is-on' : '')}
          onClick={() => setAiOn((v) => !v)}
          aria-pressed={aiOn}
          title={aiOn ? 'AI assistance on \u2014 tap to disable' : 'AI assistance off \u2014 tap to enable'}
        >
          <Icon name="brain" size={20} />
        </button>
        <div className="conc__scope">
          <button
            className="conc__scope-label"
            onClick={() => {
              const order: typeof scope[] = ['Day', 'Week', 'Month'];
              const i = order.indexOf(scope);
              setScope(order[(i + 1) % order.length]);
            }}
          >
            {scope}
          </button>
          <button
            className="conc__scope-arrow"
            onClick={() => {
              const order: typeof scope[] = ['Day', 'Week', 'Month'];
              const i = order.indexOf(scope);
              setScope(order[(i + 1) % order.length]);
            }}
            aria-label="Cycle scope"
          >
            <Icon name="chevron-right" size={10} />
          </button>
        </div>
        <div className="conc__pager">
          <button className="conc__tool-circle conc__pager-btn" aria-label="Previous">
            <Icon name="chevron-left" size={12} />
          </button>
          <button className="conc__tool-circle conc__pager-btn" aria-label="Next">
            <Icon name="chevron-right" size={12} />
          </button>
        </div>
      </div>

      {/* Search bar (toggleable) */}
      {showSearch && (
        <div className="conc__search">
          <Icon name="search" size={14} />
          <input
            autoFocus
            className="conc__search-input"
            placeholder="Search your snapshots"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery('')} className="conc__search-clear" aria-label="Clear">
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {/* Active tab content */}
      {activeTab === 'wow' && (
        <article className="snap">
          <header className="snap__head">
            <div className="snap__avatar" style={{ background: snap.patient.color }}>
              {snap.patient.monogram}
            </div>
            <span className="snap__name">{snap.patient.name}</span>
            <span className="snap__date">{snap.date}</span>
          </header>

          <section className="snap__summary">
            <div className="snap__summary-text">
              <h3 className="snap__h3">Summary</h3>
              <p className="snap__body-text">{snap.summary}</p>
            </div>
            <HexagonRadar axes={snap.axes} size={200} />
          </section>

          {snap.sections.map((s) => (
            <section className="snap__section" key={s.title}>
              <h3 className="snap__h3 snap__h3--center">{s.title}</h3>
              <ol className="snap__list">
                {s.items.map((it, i) => (
                  <li key={i} className="snap__list-item">
                    {it}
                  </li>
                ))}
              </ol>
              <BodyWithAI text={s.body} aiOn={aiOn} />
            </section>
          ))}

          <footer className="conc__end">
            <span className="eyebrow">End of snapshot</span>
            <Icon name="sparkle" size={14} />
          </footer>
        </article>
      )}

      {activeTab === 'koc' && (
        <div className="conc__placeholder">
          <div className="conc__placeholder-icon">
            <Icon name="book" size={28} />
          </div>
          <h2 className="conc__placeholder-title">
            <span className="display-italic">KOC</span> is being built.
          </h2>
          <p className="conc__placeholder-sub">
            Send the wireframe and I&rsquo;ll wire it up like WOW.
          </p>
        </div>
      )}

      {activeTab === 'urgent' && (
        <div className="conc__placeholder">
          <div className="conc__placeholder-icon">
            <Icon name="health" size={28} />
          </div>
          <h2 className="conc__placeholder-title">
            <span className="display-italic">Urgent Care</span> is being built.
          </h2>
          <p className="conc__placeholder-sub">
            Send the wireframe and I&rsquo;ll wire it up like WOW.
          </p>
        </div>
      )}
    </div>
  );
}
