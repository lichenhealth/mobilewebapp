import { useState } from 'react';
import { Icon } from '../components/Icon';
import FeedCard from '../components/FeedCard';
import { FEED } from '../data/feed';
import './Concierge.css';

export default function Concierge() {
  const [q, setQ] = useState('');

  return (
    <div className="concierge">
      <header className="concierge__head">
        <span className="eyebrow">Your Concierge</span>
        <h1 className="concierge__title">
          <span className="display-italic">Three things</span>{' '}
          <span className="display">
            we thought you should see, picked slowly.
          </span>
        </h1>
        <p className="concierge__sub">
          Curated from members you trust and groups you're closest to.
          Updated each morning. Never sold to anyone.
        </p>
      </header>

      <div className="concierge__ask">
        <Icon name="search" size={16} />
        <input
          className="concierge__input"
          placeholder="Ask the concierge…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="concierge__send"
          disabled={!q.trim()}
          aria-label="Send"
        >
          <Icon name="arrow-up" size={14} />
        </button>
      </div>

      <div className="concierge__suggestions">
        {[
          'What\u2019s growing in my region this month?',
          'Find a builder near Bailey',
          'Quiet places I haven\u2019t visited',
        ].map((s) => (
          <button key={s} className="concierge__chip" onClick={() => setQ(s)}>
            {s}
          </button>
        ))}
      </div>

      <section className="concierge__pick">
        <PickHeader index={1} label="Because you trusted @mountainbeef" />
        <FeedCard {...FEED[0]} />
      </section>

      <section className="concierge__pick">
        <PickHeader index={2} label="Because the Library of Care is active today" />
        <FeedCard {...FEED[1]} />
      </section>

      <section className="concierge__pick">
        <PickHeader index={3} label="Quiet, but interesting" />
        <FeedCard {...FEED[2]} />
      </section>

      <footer className="concierge__end">
        <span className="eyebrow">Three is enough for today</span>
        <Icon name="sparkle" size={14} />
      </footer>
    </div>
  );
}

function PickHeader({ index, label }: { index: number; label: string }) {
  return (
    <div className="pick-head">
      <span className="pick-head__num">{String(index).padStart(2, '0')}</span>
      <span className="pick-head__line" aria-hidden="true" />
      <span className="pick-head__label">{label}</span>
    </div>
  );
}
