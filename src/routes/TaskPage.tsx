import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { useTopBackFor } from '../lib/topBack';
import {
  getReminder, newItemId, saveTaskItems, setTaskItemDone,
  type Reminder, type TaskItem,
} from '../lib/remindersApi';
import './TaskPage.css';

// A TASK'S CHECKLIST (founder 2026-11-26: "a shopping list that's attached to
// a date in cal, where tasks can be checked off as items are bought").
// Built for a phone in a store aisle: big rows, one tap ticks, ticked items
// stay where they are (struck through) so the list never jumps under a thumb.
// Anyone on the task can tick; only its owner changes the list itself.

function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const me = user?.id ?? '';
  const navigate = useNavigate();
  const [task, setTask] = useState<Reminder | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading');
  const [hideDone, setHideDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useTopBackFor(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate(task ? `/calendar?d=${task.start_date}` : '/calendar');
  });

  const load = useCallback(async () => {
    if (!id) return;
    const r = await getReminder(id);
    if (!r) { setState('gone'); return; }
    setTask(r); setState('ready');
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  // Shopping together: someone else may tick while you stand in the aisle.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 20000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, [load]);

  const items = task?.items ?? [];
  const isOwner = !!task && task.profile_id === me;
  const doneCount = items.filter((i) => i.done).length;

  const groups = useMemo(() => {
    const out: { name: string; items: TaskItem[] }[] = [];
    for (const it of items) {
      if (hideDone && it.done) continue;
      const name = (it.group ?? '').trim();
      let g = out.find((x) => x.name === name);
      if (!g) { g = { name, items: [] }; out.push(g); }
      g.items.push(it);
    }
    return out;
  }, [items, hideDone]);

  const toggle = async (it: TaskItem) => {
    if (!task) return;
    const next = !it.done;
    setTask({ ...task, items: items.map((x) => (x.id === it.id ? { ...x, done: next } : x)) });
    try {
      const fresh = await setTaskItemDone(task.id, it.id, next);
      setTask((cur) => (cur ? { ...cur, items: fresh } : cur));
    } catch (e) {
      setErr((e as Error).message);
      void load();
    }
  };

  const write = async (next: TaskItem[]) => {
    if (!task) return;
    setTask({ ...task, items: next });
    try { await saveTaskItems(me, task.id, next); setErr(null); }
    catch (e) { setErr((e as Error).message); void load(); }
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const lastGroup = items.length ? items[items.length - 1].group ?? null : null;
    void write([...items, { id: newItemId(), text: text.slice(0, 200), group: lastGroup, done: false }]);
    setDraft('');
    inputRef.current?.focus();
  };

  if (state === 'loading') return <div className="taskp"><p className="taskp__quiet">Opening the list…</p></div>;
  if (state === 'gone' || !task) {
    return (
      <div className="taskp">
        <p className="taskp__quiet">This task isn't here anymore — it may have been deleted, or it isn't shared with you.</p>
        <button className="btn btn-secondary" onClick={() => navigate('/calendar')}>Open your calendar</button>
      </div>
    );
  }

  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  return (
    <div className="taskp">
      <header className="taskp__head">
        <h1 className="taskp__title">{task.title}</h1>
        <p className="taskp__when">
          {dayLabel(task.start_date)}
          {task.owner?.full_name && !isOwner ? <> · from {task.owner.full_name}</> : null}
        </p>
        {items.length > 0 && (
          <div className="taskp__prog" aria-label={`${doneCount} of ${items.length} checked off`}>
            <div className="taskp__bar"><span style={{ width: pct + '%' }} /></div>
            <span className="taskp__count">{doneCount} of {items.length}</span>
          </div>
        )}
        <div className="taskp__tools">
          {doneCount > 0 && (
            <button className="taskp__tool" onClick={() => setHideDone((v) => !v)}>
              {hideDone ? 'Show checked items' : 'Hide checked items'}
            </button>
          )}
          {isOwner && (
            <button className="taskp__tool" onClick={() => setEditing((v) => !v)}>{editing ? 'Done editing' : 'Edit list'}</button>
          )}
          {isOwner && (
            <button className="taskp__tool" onClick={() => navigate(`/calendar/new?reminder=${task.id}`)}>Change date</button>
          )}
        </div>
      </header>

      {err && <p className="taskp__err">{err}</p>}

      {items.length === 0 && <p className="taskp__quiet">No items yet.{isOwner ? ' Add the first one below.' : ''}</p>}
      {hideDone && items.length > 0 && doneCount === items.length && (
        <p className="taskp__quiet">Everything is checked off ✓</p>
      )}

      {groups.map((g) => (
        <section className="taskp__group" key={g.name || '_'}>
          {g.name && <h2 className="taskp__gname">{g.name}</h2>}
          <ul className="taskp__list">
            {g.items.map((it) => (
              <li key={it.id} className={'taskp__item' + (it.done ? ' is-done' : '')}>
                <button className="taskp__row" onClick={() => void toggle(it)} aria-pressed={!!it.done}>
                  <span className="taskp__box">{it.done ? <Icon name="check" size={14} /> : null}</span>
                  <span className="taskp__text">{it.text}</span>
                </button>
                {editing && isOwner && (
                  <button className="taskp__rm" aria-label={`Remove ${it.text}`}
                    onClick={() => void write(items.filter((x) => x.id !== it.id))}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {isOwner && (
        <div className="taskp__add">
          <input
            ref={inputRef}
            className="taskp__input"
            value={draft}
            placeholder="Add an item…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
          />
          <button className="btn btn-primary" onClick={add} disabled={!draft.trim()}>Add</button>
        </div>
      )}
    </div>
  );
}
