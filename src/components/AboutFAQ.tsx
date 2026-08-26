import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { useAuth } from '../auth/AuthProvider';
import './AboutFAQ.css';

// Same HubSpot portal/form the general signup uses (SignupForm.astro on the
// marketing site) — a question here lands in the same contact list, tagged
// by page context, rather than needing a second form provisioned in HubSpot.
const HUBSPOT_PORTAL = '246356324';
const HUBSPOT_FORM = '66b86cc2-3710-48bd-8c08-c94c1198dc0e';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What does membership cost?',
    a: 'Every new member gets three months of full Concierge membership, free — no card required. When that ends, choose Community ($29/mo) or Community + Concierge ($99/mo), right inside the app.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. You control whether your data is woven into the shared commons, and whether Lichen’s AI assists you — always your choice, switchable any time, per section of the app and per community or group. Sensitive details like your home location, phone number and financial picture stay hidden by default and are only ever shared at the level you choose.',
  },
  {
    q: 'Do I have to use the AI assistant?',
    a: 'No. The assistant starts on — collaboration is the premise of the platform — but it is yours to switch off per section of the app, and per community or group. Nothing is read outside the scopes you allow, and nothing is acted on without your say.',
  },
  {
    q: 'How is Lichen different from other social networks?',
    a: 'Most networks are tuned to maximize your attention. Lichen is tuned to maximize trust — no follower counts, no leaderboards, nothing to perform for. What you see is filtered through the people, places, plants and animals you actually trust.',
  },
  {
    q: 'Is Lichen a nonprofit?',
    a: 'Yes, a 501(c)(3). Lean operations, no investors — membership revenue not needed to run the platform flows back into subsidizing care for members who need it.',
  },
  {
    q: 'Can my organization, community or business join?',
    a: 'Yes — organizations, communities, groups and places all have a home on Lichen, each with a public page, its own offerings, and an economy of exchange with the people it already serves.',
  },
  {
    q: 'How do I join?',
    a: 'Lichen grows by invitation. If you know a member, ask them for one. If not, introduce yourself below and a real person will write back.',
  },
  {
    q: 'What is Current-cy?',
    a: 'Lichen’s Universal Current-cy — value tracked and honored across every exchange, pegged to the real economy so it can be translated back into it. It’s how the platform accounts for contributions the current system doesn’t: care, land stewardship, wisdom, time.',
  },
  {
    q: 'Can I leave, and what happens to my data?',
    a: 'Yes, any time — reach out to connect@lichen.health and we’ll walk you through it.',
  },
];

export default function AboutFAQ() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [showAsk, setShowAsk] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQS;
    return FAQS.filter((f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q));
  }, [query]);

  async function submitQuestion(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    const [firstname, ...rest] = name.trim().split(' ');
    const fields = [
      { name: 'firstname', value: firstname || '' },
      { name: 'lastname', value: rest.join(' ') },
      { name: 'email', value: email.trim() },
      { name: 'message', value: question.trim() },
    ].filter((f) => f.value !== '');
    try {
      const res = await fetch(
        `https://api.hsforms.com/submissions/v3/integration/submit/${HUBSPOT_PORTAL}/${HUBSPOT_FORM}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields, context: { pageUri: location.href, pageName: document.title } }),
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      setStatus('ok');
      setName(''); setEmail(''); setQuestion('');
    } catch {
      setStatus('err');
    }
  }

  return (
    <aside className="afaq">
      <p className="afaq__eyebrow">Questions?</p>
      <h2 className="afaq__title">FAQ</h2>

      <label className="afaq__search">
        <Icon name="search" size={16} strokeWidth={1.5} />
        <input
          type="text"
          placeholder="Search questions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="afaq__list">
        {filtered.length === 0 && <p className="afaq__empty">No matches — ask below instead.</p>}
        {filtered.map((f) => {
          const idx = FAQS.indexOf(f);
          const open = openIdx === idx;
          return (
            <div className="afaq__item" key={f.q}>
              <button
                className="afaq__q"
                onClick={() => setOpenIdx(open ? null : idx)}
                aria-expanded={open}
              >
                <span>{f.q}</span>
                <Icon name="chevron-right" size={14} strokeWidth={1.5} className={open ? 'afaq__chev afaq__chev--open' : 'afaq__chev'} />
              </button>
              {open && <p className="afaq__a">{f.a}</p>}
            </div>
          );
        })}
      </div>

      <div className="afaq__chat">
        {user ? (
          <button className="afaq__chatbtn" onClick={() => navigate('/help')}>
            <Icon name="chat" size={16} strokeWidth={1.5} />
            Ask a real person
          </button>
        ) : showAsk ? (
          status === 'ok' ? (
            <p className="afaq__thanks">Thank you — a real person will write back soon.</p>
          ) : (
            <form className="afaq__ask" onSubmit={submitQuestion}>
              <input type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
              <input type="email" placeholder="Your email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <textarea placeholder="Your question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} required />
              <button type="submit" className="btn btn-primary afaq__send" disabled={status === 'sending'}>
                {status === 'sending' ? 'Sending…' : 'Send'}
              </button>
              {status === 'err' && (
                <p className="afaq__err">Something went wrong — email <a href="mailto:connect@lichen.health">connect@lichen.health</a> instead.</p>
              )}
            </form>
          )
        ) : (
          <button className="afaq__chatbtn" onClick={() => setShowAsk(true)}>
            <Icon name="chat" size={16} strokeWidth={1.5} />
            Ask a real person
          </button>
        )}
      </div>
    </aside>
  );
}
