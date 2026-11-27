import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Icon } from '../components/Icon';
import { useTopBackFor } from '../lib/topBack';
import { supabase } from '../lib/supabase';
import {
  getReminder, newItemId, saveTaskItems, setTaskItemDone, loadReminderRecipients,
  shareTaskWith, unshareTask, leaveReminder,
  type Reminder, type TaskItem, type Recipient,
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
  // Sharing (founder 2026-11-27): a checklist is shareable like a Drive file —
  // the people on it tick items too.
  const [people, setPeople] = useState<Recipient[]>([]);
  const [sharing, setSharing] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; full_name: string | null }[]>([]);
  const [shareNote, setShareNote] = useState<string | null>(null);

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
  const loadPeople = useCallback(async () => {
    if (!id) return;
    setPeople(await loadReminderRecipients(id).catch(() => []));
  }, [id]);
  useEffect(() => { void loadPeople(); }, [loadPeople]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles').select('id, full_name')
        .eq('findable', true).eq('onboarded', true).ilike('full_name', `%${term.replace(/[%_]/g, '')}%`).limit(6);
      const on = new Set(people.map((p) => p.id));
      setHits(((data as { id: string; full_name: string | null }[] | null) ?? []).filter((h) => h.id !== me && !on.has(h.id)));
    }, 220);
    return () => window.clearTimeout(t);
  }, [q, people, me]);

  const addPerson = async (h: { id: string; full_name: string | null }) => {
    if (!task) return;
    try {
      await shareTaskWith(task.id, h.id);
      setQ(''); setHits([]);
      setShareNote(`Shared with ${h.full_name ?? 'them'} ✓ — they'll get a bell and can check items off too.`);
      void loadPeople();
    } catch (e) { setErr((e as Error).message); }
  };
  const removePerson = async (r: Recipient) => {
    if (!task) return;
    try { await unshareTask(task.id, r); setShareNote(null); void loadPeople(); }
    catch (e) { setErr((e as Error).message); }
  };
  const leave = async () => {
    if (!task) return;
    try { await leaveReminder(task.id, me); navigate('/calendar'); }
    catch (e) { setErr((e as Error).message); }
  };
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
          {people.length > 0 && (
            <> · with {people.filter((p) => p.id !== me).map((p) => (p.name ?? 'someone').split(' ')[0]).join(', ') || 'you'}</>
          )}
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
          {isOwner && (
            <button className={'taskp__tool taskp__tool--share' + (sharing ? ' is-on' : '')} onClick={() => setSharing((v) => !v)}>
              <Icon name="user-multiple" size={14} /> Share
            </button>
          )}
          {!isOwner && (
            <button className="taskp__tool" onClick={() => void leave()}>Leave this list</button>
          )}
        </div>
        {isOwner && sharing && (
          <div className="taskp__share">
            <p className="taskp__share-lead">People on this list can check items off with you. It stays on everyone's calendar.</p>
            {people.length > 0 && (
              <ul className="taskp__people">
                {people.map((p) => (
                  <li key={p.type + p.id}>
                    <span>{p.name ?? 'Member'}{p.type === 'space' ? ' (group)' : ''}</span>
                    <button className="taskp__tool" onClick={() => void removePerson(p)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <input
              className="taskp__input"
              value={q}
              placeholder="Add a person by name…"
              autoFocus
              onChange={(e) => { setQ(e.target.value); setShareNote(null); }}
            />
            {hits.length > 0 && (
              <ul className="taskp__hits">
                {hits.map((h) => (
                  <li key={h.id}><button onClick={() => void addPerson(h)}>{h.full_name ?? 'Member'} <span>· add</span></button></li>
                ))}
              </ul>
            )}
            {q.trim().length >= 2 && hits.length === 0 && <p className="taskp__quiet">No member by that name yet.</p>}
            {shareNote && <p className="taskp__share-ok">{shareNote}</p>}
          </div>
        )}
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
