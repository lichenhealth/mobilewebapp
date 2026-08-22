import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from './Icon';
import { speechRecognition } from '../lib/dictation';
import {
  requestSnapshot, applySnapshot,
  type SnapshotProposal, type SnapshotListing,
} from '../lib/snapshotApi';
import '../routes/Snapshot.css';

/** SNAPSHOT, as a panel inside the assistant's profile room (founder
 *  2026-08-11: "take the person to the AI Assistant, not a completely new
 *  UI"). Same flow, no page of its own — the room supplies the header and
 *  the way back.
 *
 *  "Share with me everything about who you
 *  are and what you do, and I'll translate that into a Public Web & Lichen
 *  App Profile you can use to engage with your community and customers."
 *
 *  One read of whatever they already have: what they type or say, plus any
 *  site they point at (a one-page Squarespace, a Wix site, an Etsy
 *  storefront). It proposes; the member confirms. NOTHING is written until
 *  they press the button at the bottom, because every field here is public.
 *
 *  Snapshot is deliberately not Sync — no credentials, nothing ongoing.
 *  Plugging Lichen into a live backend (hub or spoke, real inventory) is
 *  its own build; the door below says so honestly rather than pretending. */
export default function SnapshotPanel({ back, onDone, openInitially = false }: {
  back?: string; onDone?: () => void; openInitially?: boolean;
}) {
  // A conversation, not a form (founder 2026-08-11): the builder waits
  // behind one line until it's actually wanted.
  const [open, setOpen] = useState(openInitially);
  const { user } = useAuth();
  const navigate = useNavigate();

  const [text, setText] = useState('');
  const [urls, setUrls] = useState<string[]>(['']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [prop, setProp] = useState<SnapshotProposal | null>(null);

  // What the member has ticked — the proposal is a suggestion until this
  // says otherwise.
  const [useTagline, setUseTagline] = useState(true);
  const [useStory, setUseStory] = useState(true);
  const [useContact, setUseContact] = useState(true);
  const [pickedCats, setPickedCats] = useState<Set<string>>(new Set());
  const [pickedListings, setPickedListings] = useState<Set<number>>(new Set());
  const [tagline, setTagline] = useState('');
  const [story, setStory] = useState('');
  const [applied, setApplied] = useState(false);

  const [listening, setListening] = useState(false);
  // Usable-here check (src/lib/dictation.ts): null on iOS, where starting
  // recognition in an installed web app hangs the page — the iPhone
  // keyboard's own mic covers dictation there.
  const SR = speechRecognition();
  function dictate() {
    if (!SR || listening) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[e.results.length - 1][0].transcript;
      setText((t) => (t ? `${t} ${said}` : said));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    // A refused start must never strand the button lit.
    try { rec.start(); } catch { setListening(false); }
  }

  async function run() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const p = await requestSnapshot({
        text,
        urls: urls.map((u) => u.trim()).filter(Boolean),
      });
      setProp(p);
      setTagline(p.tagline);
      setStory(p.story);
      setPickedCats(new Set(p.categories));
      setPickedListings(new Set(p.listings.map((_, i) => i)));
    } catch (e) {
      setError((e as Error)?.message || 'Something went wrong.');
    }
    setBusy(false);
  }

  async function apply() {
    if (!user || !prop || busy) return;
    setBusy(true); setError('');
    try {
      await applySnapshot(user.id, {
        tagline: useTagline ? tagline.trim() : undefined,
        story: useStory ? story.trim() : undefined,
        categories: [...pickedCats],
        contact: useContact ? prop.contact : undefined,
        listings: prop.listings.filter((_: SnapshotListing, i: number) => pickedListings.has(i)),
      });
      setApplied(true);
    } catch (e) {
      setError((e as Error)?.message || 'Could not save that.');
    }
    setBusy(false);
  }

  const toggle = <T,>(set: Set<T>, v: T, upd: (s: Set<T>) => void) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v); else n.add(v);
    upd(n);
  };

  if (applied) {
    return (
      <div className="snap snap--panel">
        <h2 className="snap__title">That&rsquo;s yours now.</h2>
        <p className="snap__lead">
          Everything you kept is on your profile and your public page. Nothing is
          final — edit any of it whenever you like.
        </p>
        <div className="snap__acts">
          {back && (
            <button className="btn btn-primary" onClick={() => navigate(back)}>Back to manual mode</button>
          )}
          <button className="btn" onClick={() => { setApplied(false); setProp(null); onDone?.(); }}>
            Keep going here
          </button>
          <button className="btn" onClick={() => navigate(`/members/${user?.id}?preview=1`)}>
            See the public page
          </button>
        </div>
      </div>
    );
  }

  if (!open && !prop) {
    return (
      <button className="snap__invite" onClick={() => setOpen(true)}>
        <strong>Build your page from what you&rsquo;ve already got</strong>
        <em>Tell me about yourself, or paste your website — I&rsquo;ll draft the whole thing.</em>
      </button>
    );
  }

  return (
    <div className="snap snap--panel">
      <h2 className="snap__title">Build your presence</h2>
      <p className="snap__lead">
        Share with me everything about who you are and what you do, and I&rsquo;ll
        translate that into a Public Web &amp; Lichen App Profile that you can use
        to engage with your community and customers online.
      </p>

      {!prop && (
        <>
          <div className="snap__field">
            <label className="prof__label">Tell me about yourself</label>
            <p className="prof__hint">
              Ramble — I&rsquo;ll shape it. The more you tell me, the less I have to
              ask. Useful things: what you make or do, who it&rsquo;s for, how long
              you&rsquo;ve been at it, where you are, how people reach you, what you
              charge.
            </p>
            <textarea
              className="prof__input snap__text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What you make or do, who it's for, how long you've been at it, where you are, how people reach you. However it comes out — I'll shape it."
            />
            {SR && (
              <button className={'btn snap__mic' + (listening ? ' is-live' : '')} onClick={dictate}>
                <Icon name="mic" size={15} /> {listening ? 'Listening…' : 'Say it out loud'}
              </button>
            )}
          </div>

          <div className="snap__field">
            <label className="prof__label">Already have a website, shop or page?</label>
            <div className="snap__can">
              <p><strong>What I can read</strong> — your own website, a blog, an Etsy
                or Square shop: anything a visitor could open without signing in.</p>
              <p><strong>What I can&rsquo;t</strong> — Instagram, Facebook, and anything
                behind a login. Those lock readers out. Copy the words you like from
                there into the box above and I&rsquo;ll fold them in.</p>
            </div>
            {urls.map((u, i) => (
              <input
                key={i}
                className="prof__input snap__url"
                value={u}
                onChange={(e) => setUrls((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="yourbusiness.com"
              />
            ))}
            {urls.length < 4 && (
              <button className="snap__addurl" onClick={() => setUrls((c) => [...c, ''])}>
                + Add another
              </button>
            )}
          </div>

          {error && <p className="prof__error">{error}</p>}

          <button
            className="btn btn-primary snap__go"
            onClick={() => void run()}
            disabled={busy || (!text.trim() && !urls.some((u) => u.trim()))}
          >
            {busy ? 'Reading…' : 'Build my profile'}
          </button>
          <p className="prof__hint snap__foot">
            {busy
              ? 'Reading what you gave me and writing it up — about twenty seconds. Nothing is saved yet.'
              : 'I’ll show you everything before anything is saved, and you can change any of it.'}
          </p>
        </>
      )}

      {prop && (
        <>
          <p className="snap__review">
            Here&rsquo;s what I found. Untick anything you don&rsquo;t want, edit what
            you do — <strong>nothing is saved until you say so</strong>.
          </p>

          {prop.unreadable.length > 0 && (
            <p className="prof__hint">
              I couldn&rsquo;t open {prop.unreadable.join(', ')}. That&rsquo;s usually a site
              that locks readers out rather than anything you did — Instagram and
              Facebook always do. Copy what matters from there into the box and run
              it again, and I&rsquo;ll work it in.
            </p>
          )}

          <label className="prof__consent">
            <input type="checkbox" checked={useTagline} onChange={(e) => setUseTagline(e.target.checked)} />
            <span><strong>Your one line</strong></span>
          </label>
          <input className="prof__input" value={tagline} onChange={(e) => setTagline(e.target.value)}
            disabled={!useTagline} />

          <label className="prof__consent snap__gap">
            <input type="checkbox" checked={useStory} onChange={(e) => setUseStory(e.target.checked)} />
            <span><strong>Your story</strong></span>
          </label>
          <textarea className="prof__input snap__text" rows={8} value={story}
            onChange={(e) => setStory(e.target.value)} disabled={!useStory} />

          {prop.categories.length > 0 && (
            <>
              <p className="prof__privacy-sub">What you offer</p>
              <div className="snap__chips">
                {prop.categories.map((id, i) => (
                  <button
                    key={id}
                    className={'snap__chip' + (pickedCats.has(id) ? ' is-on' : '')}
                    onClick={() => toggle(pickedCats, id, setPickedCats)}
                  >
                    {prop.categoryNames[i] ?? id}
                  </button>
                ))}
              </div>
            </>
          )}

          {Object.keys(prop.contact).length > 0 && (
            <>
              <label className="prof__consent snap__gap">
                <input type="checkbox" checked={useContact} onChange={(e) => setUseContact(e.target.checked)} />
                <span>
                  <strong>Contact details</strong>
                  <em>
                    {Object.entries(prop.contact).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                  </em>
                </span>
              </label>
            </>
          )}

          {prop.listings.length > 0 && (
            <>
              <p className="prof__privacy-sub">Things to list</p>
              <p className="prof__hint">These publish as marketplace posts you can edit after.</p>
              {prop.listings.map((l, i) => (
                <label className="prof__consent" key={i}>
                  <input type="checkbox" checked={pickedListings.has(i)}
                    onChange={() => toggle(pickedListings, i, setPickedListings)} />
                  <span>
                    <strong>{l.title}</strong>
                    <em>{l.body}{l.price ? ` · ${l.price}` : ''}</em>
                  </span>
                </label>
              ))}
            </>
          )}

          {prop.missing.length > 0 && (
            <div className="snap__missing">
              <p className="prof__privacy-sub">Still worth adding</p>
              {prop.missing.map((q) => <p className="prof__hint" key={q}>· {q}</p>)}
            </div>
          )}

          {error && <p className="prof__error">{error}</p>}

          <div className="snap__acts">
            <button className="btn btn-primary" onClick={() => void apply()} disabled={busy}>
              {busy ? 'Saving…' : 'Save this to my profile'}
            </button>
            <button className="btn" onClick={() => { setProp(null); setError(''); }} disabled={busy}>
              Start over
            </button>
          </div>
        </>
      )}

      {/* The other half of the pair (founder 2026-08-11). Snapshot builds
          your presence; Sync plugs Lichen into the infrastructure you
          already run on. It isn't built yet, and says so. */}
      {!prop && (
        <div className="snap__sync">
          <h2 className="snap__sync-title">Sync &amp; Manage</h2>
          <p className="snap__sync-lead">
            Make Lichen your hub, or another spoke on the commerce wheel you use to
            run your business. Your calendar, your storefront, your stock — talking
            to each other, so selling one of five in one place leaves four
            everywhere.
          </p>
          <p className="prof__hint">
            Being built. Snapshot above is a one-time read — it takes nothing from
            your accounts and keeps no connection open.
          </p>
        </div>
      )}
    </div>
  );
}
