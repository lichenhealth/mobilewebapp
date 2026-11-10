import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import IconRow from '../components/IconRow';
import { Icon, type IconName } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import {
  TRASH_SECTIONS, listTrash, restoreTrash, emptyTrash,
  listSpamKnocks, restoreSpamKnock, emptySpamKnocks,
  type TrashItem, type SpamKnock,
} from '../lib/trashApi';
import './Trash.css';

/** THE TRASH (founder 2026-11-10: "a trash that waits with everything until
 *  you empty it. There is a meta trash for the entire platform, then a trash
 *  for drive, profile, library, courses, etc"). One page, every section; a
 *  section's own trash is this page through `?section=` — the platform's
 *  scoped-section rule. Nothing leaves until the person empties it. */

const KIND_WORD: Record<TrashItem['kind'], string> = {
  post: 'Post', draft: 'Draft', doc: 'Document', file: 'File', folder: 'Folder',
};
const KIND_ICON: Record<TrashItem['kind'], IconName> = {
  post: 'newsfeed', draft: 'newsfeed', doc: 'book', file: 'image', folder: 'bookmark',
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

type Row =
  | { type: 'item'; id: string; section: string; at: string; item: TrashItem }
  | { type: 'knock'; id: string; section: 'door'; at: string; knock: SpamKnock };

export default function Trash() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const section = params.get('section') ?? '';
  const [items, setItems] = useState<TrashItem[]>([]);
  const [knocks, setKnocks] = useState<SpamKnock[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sure, setSure] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let live = true;
    void Promise.all([listTrash(), listSpamKnocks()]).then(([t, k]) => {
      if (!live) return;
      setItems(t); setKnocks(k); setLoaded(true);
    });
    return () => { live = false; };
  }, [user]);

  const rows: Row[] = useMemo(() => {
    const r: Row[] = [
      ...items.map((item) => ({ type: 'item' as const, id: item.id, section: item.section, at: item.trashed_at, item })),
      ...knocks.map((knock) => ({ type: 'knock' as const, id: knock.id, section: 'door' as const, at: knock.created_at, knock })),
    ];
    return r.sort((a, b) => b.at.localeCompare(a.at));
  }, [items, knocks]);

  const present = new Set(rows.map((r) => r.section));
  const shown = section ? rows.filter((r) => r.section === section) : rows;
  const secLabel = TRASH_SECTIONS.find((s) => s.key === section)?.label;

  function pick(key: string) {
    setSure(null); setMsg(null);
    const next = new URLSearchParams(params);
    if (!key || key === section) next.delete('section'); else next.set('section', key);
    setParams(next, { replace: true });
  }

  async function restore(r: Row) {
    setBusy(r.id); setMsg(null);
    try {
      if (r.type === 'item') {
        await restoreTrash(r.item);
        setItems((cur) => cur.filter((x) => x.id !== r.id));
        setMsg(`“${r.item.label ?? 'It'}” is back where it lived.`);
      } else {
        await restoreSpamKnock(r.id);
        setKnocks((cur) => cur.filter((x) => x.id !== r.id));
        setMsg(`${r.knock.name ?? 'They'} ${r.knock.name ? 'is' : 'are'} back at the door.`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That didn’t come back — try again.');
    } finally { setBusy(null); }
  }

  async function forget(list: Row[]) {
    setBusy('empty'); setMsg(null);
    try {
      const its = list.filter((r): r is Extract<Row, { type: 'item' }> => r.type === 'item').map((r) => r.item);
      const ks = list.filter((r) => r.type === 'knock').map((r) => r.id);
      await emptyTrash(its);
      await emptySpamKnocks(ks);
      const gone = new Set(list.map((r) => r.id));
      setItems((cur) => cur.filter((x) => !gone.has(x.id)));
      setKnocks((cur) => cur.filter((x) => !gone.has(x.id)));
      setMsg(list.length === 1 ? 'Gone for good.' : `${list.length} things gone for good.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'That didn’t empty — try again.');
    } finally { setBusy(null); setSure(null); }
  }

  const lenses = [
    { icon: 'trash' as IconName, label: 'All', variant: !section ? 'icon-row__btn--here' : undefined },
    ...TRASH_SECTIONS.filter((s) => present.has(s.key) || s.key === section).map((s) => ({
      icon: s.icon as IconName, label: s.label,
      variant: section === s.key ? 'icon-row__btn--here' : undefined,
    })),
  ];

  return (
    <div className="trash">
      <header className="myc__head">
        <h1 className="myc__title">{secLabel ? `${secLabel} trash` : 'Trash'}</h1>
        <p className="myc__sub">
          Everything you delete waits here until you empty it — restore anything, any time.
        </p>
      </header>

      {lenses.length > 1 && (
        <IconRow
          className="icon-row--lenses"
          ariaLabel="Trash sections"
          items={lenses}
          onSelect={(label) => pick(label === 'All' ? '' : (TRASH_SECTIONS.find((s) => s.label === label)?.key ?? ''))}
        />
      )}

      {msg && <p className="trash__msg" role="status">{msg}</p>}

      {loaded && shown.length === 0 && (
        <p className="trash__empty">
          {secLabel ? `Nothing in the ${secLabel} trash.` : 'Your trash is empty.'}
        </p>
      )}

      {shown.length > 0 && (
        <>
          <div className="trash__bar">
            <span className="trash__count">{shown.length} {shown.length === 1 ? 'thing' : 'things'}</span>
            <button
              className={'trash__empty-btn' + (sure === 'all' ? ' is-sure' : '')}
              disabled={busy === 'empty'}
              onClick={() => (sure === 'all' ? void forget(shown) : setSure('all'))}
              onBlur={() => setSure((s) => (s === 'all' ? null : s))}
            >
              {busy === 'empty' ? 'Emptying…' : sure === 'all'
                ? `Empty ${shown.length === 1 ? 'it' : `all ${shown.length}`} for good?`
                : secLabel ? `Empty the ${secLabel} trash` : 'Empty trash'}
            </button>
          </div>

          <ul className="trash__list">
            {shown.map((r) => {
              const sec = TRASH_SECTIONS.find((s) => s.key === r.section);
              const isKnock = r.type === 'knock';
              const title = isKnock ? (r.knock.name || r.knock.email || 'Someone') : (r.item.label || 'Untitled');
              const meta = isKnock
                ? `${r.knock.email ?? ''} · marked spam · knocked ${shortDate(r.knock.created_at)}`
                : `${KIND_WORD[r.item.kind]} · ${sec?.label ?? r.section} · trashed ${shortDate(r.item.trashed_at)}`;
              const icon: IconName = isKnock ? 'user-multiple' : KIND_ICON[r.item.kind];
              return (
                <li key={r.id} className="trash__row">
                  <span className="trash__icon"><Icon name={icon} size={16} /></span>
                  <span className="trash__main">
                    <span className="trash__title">{title}</span>
                    <span className="trash__meta">{meta}</span>
                    {isKnock && r.knock.story && <span className="trash__story">“{r.knock.story.slice(0, 160)}”</span>}
                  </span>
                  <span className="trash__acts">
                    <button className="trash__act" disabled={busy === r.id} onClick={() => void restore(r)}>
                      {isKnock ? 'Not spam' : 'Restore'}
                    </button>
                    <button
                      className={'trash__act trash__act--del' + (sure === r.id ? ' is-sure' : '')}
                      onClick={() => (sure === r.id ? void forget([r]) : setSure(r.id))}
                      onBlur={() => setSure((s) => (s === r.id ? null : s))}
                    >
                      {sure === r.id ? 'For good?' : 'Delete'}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {section === 'door' && (
            <p className="trash__fine">
              Emptying spam hides it for good. The address stays quietly marked, so it can’t knock again.
            </p>
          )}
        </>
      )}
      {!loaded && <p className="trash__empty">Opening the trash…</p>}
    </div>
  );
}
