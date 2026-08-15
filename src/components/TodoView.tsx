import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { localDate } from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import { remindersOn, type Reminder as ReminderRow } from '../lib/remindersApi';
import { listTodos, createTodo, setTodoDone, deleteTodo, type Todo } from '../lib/todosApi';
import { visibleTasksOf, type VisibleTasks } from '../lib/tasksApi';
import { supabase } from '../lib/supabase';
import './TodoView.css';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The To-Do view (founder, 2026-07-22): a checklist that lives where the
 *  calendar grid does. Free-form to-dos up top; reminders auto-populate below,
 *  grouped by day. Tick a reminder to mark that day done; tap it to edit. */
export default function TodoView({
  me, reminders, remDone, onToggleRem, onLeave, days, today,
}: {
  me: string;
  reminders: ReminderRow[];
  remDone: Set<string>;
  onToggleRem: (r: ReminderRow, iso: string) => void;
  /** Step out of a task someone assigned to you — removes it from your list,
   *  leaves the owner's untouched. */
  onLeave?: (r: ReminderRow) => void;
  days: string[];
  today: string;
}) {
  const navigate = useNavigate();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!me) return;
    let live = true;
    void listTodos(me).then((t) => { if (live) { setTodos(t); setReady(true); } });
    return () => { live = false; };
  }, [me]);

  const add = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    const t = await createTodo(me, title);
    if (t) setTodos((cur) => [t, ...cur]);
  };
  const toggle = (t: Todo) => {
    setTodos((cur) => cur.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    void setTodoDone(t.id, !t.done).catch(console.error);
  };
  const remove = (t: Todo) => {
    setTodos((cur) => cur.filter((x) => x.id !== t.id));
    void deleteTodo(t.id).catch(console.error);
  };

  // Someone else's list, if their rules admit you.
  const [peerQ, setPeerQ] = useState('');
  const [peerHits, setPeerHits] = useState<{ id: string; name: string }[]>([]);
  const [peer, setPeer] = useState<VisibleTasks | null>(null);
  const [peerTried, setPeerTried] = useState<string | null>(null);
  useEffect(() => {
    const q = peerQ.trim();
    if (q.length < 2 || peer) { setPeerHits([]); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const { data } = await supabase.from('profiles')
        .select('id, full_name').ilike('full_name', `%${q}%`).neq('id', me).limit(5);
      if (live) setPeerHits(((data as { id: string; full_name: string | null }[] | null) ?? [])
        .map((r) => ({ id: r.id, name: r.full_name ?? 'Member' })));
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [peerQ, peer, me]);
  const openPeer = async (h: { id: string; name: string }) => {
    setPeerHits([]); setPeerQ('');
    const v = await visibleTasksOf(h.id);
    if (v) { setPeer(v); setPeerTried(null); }
    else { setPeer(null); setPeerTried(h.name); }
  };

  const openTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);
  const remDays = days.map((iso) => ({ iso, rems: remindersOn(reminders, iso) })).filter((d) => d.rems.length > 0);

  const dayLabel = (iso: string) => {
    if (iso === today) return 'Today';
    const d = localDate(iso);
    return `${DAY_LABELS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <div className="todo">
      <div className="todo__add">
        <input
          className="todo__input" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
          placeholder="Add a to-do…"
        />
        <button className="btn btn-primary todo__addbtn" onClick={() => void add()} disabled={!draft.trim()}>Add</button>
      </div>
      {/* The quick-add makes a plain to-do — no time, nobody else. The tiers
          and assignment live in the reminder composer, and nothing used to
          point there (founder 2026-08-14: "it lets me add it, but not add a
          time for it"). This carries your words across. */}
      <button
        className="todo__more"
        onClick={() => navigate(`/calendar/new?kind=reminder${draft.trim() ? `&title=${encodeURIComponent(draft.trim())}` : ''}`)}
      >
        <Icon name="plus" size={11} /> Add a time, a repeat, or assign it to someone
      </button>

      {ready && openTodos.length === 0 && doneTodos.length === 0 && remDays.length === 0 && (
        <p className="todo__empty">Nothing on your list — add a to-do, or your reminders will gather here by day.</p>
      )}

      {openTodos.map((t) => (
        <div className="todo__row" key={t.id}>
          <button className="todo__box" aria-label="Mark done" onClick={() => toggle(t)} />
          <span className="todo__title">{t.title}</span>
          <button className="todo__x" aria-label="Delete" onClick={() => remove(t)}><Icon name="close" size={12} /></button>
        </div>
      ))}

      {remDays.length > 0 && (
        <>
          <p className="todo__head">Reminders</p>
          {remDays.map(({ iso, rems }) => (
            <div className="todo__day" key={iso}>
              <p className="todo__daylbl">{dayLabel(iso)}</p>
              {rems.map((r) => {
                const done = remDone.has(`${r.id}:${iso}`);
                return (
                  <div className={'todo__row todo__row--rem' + (done ? ' is-done' : '')} key={r.id + iso}>
                    <button
                      className={'todo__box' + (done ? ' is-done' : '')}
                      aria-label={done ? 'Mark not done' : 'Mark done'}
                      onClick={() => onToggleRem(r, iso)}
                    >{done ? '✓' : ''}</button>
                    <button className="todo__title todo__title--btn" onClick={() => { if (r.profile_id === me) navigate(`/calendar/new?reminder=${r.id}`); }}>
                      {r.title}
                      {r.at_min != null && <span className="todo__when">{minToLabel(r.at_min)}</span>}
                      {r.profile_id !== me && (
                        <span className="todo__from">from {r.owner?.full_name ?? 'a member'}</span>
                      )}
                    </button>
                    {r.profile_id !== me && onLeave && (
                      <button
                        className="todo__x" aria-label="Step out of this task"
                        title="Step out — their task stays on their list"
                        onClick={() => onLeave(r)}
                      ><Icon name="close" size={12} /></button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

      {/* SEE SOMEONE'S LIST (founder 2026-08-14): only what their task-
          visibility rules admit — default is hidden, and a private list says
          so honestly instead of rendering blank. Session-only. */}
      <div className="todo__peer">
        {!peer && !peerTried && (
          <div className="todo__add">
            <input
              className="todo__input" value={peerQ}
              onChange={(e) => setPeerQ(e.target.value)}
              placeholder="See someone's list…"
            />
          </div>
        )}
        {peerHits.map((h) => (
          <button key={h.id} className="calp__match" onClick={() => void openPeer(h)}>
            {h.name}
          </button>
        ))}
        {peerTried && !peer && (
          <p className="todo__empty">
            {peerTried} keeps their tasks private.{' '}
            <button className="todo__peer-clear" onClick={() => { setPeerTried(null); setPeerQ(''); }}>OK</button>
          </p>
        )}
        {peer && (
          <>
            <p className="todo__head">
              {peer.owner_name}&rsquo;s list
              <button className="todo__peer-clear" onClick={() => { setPeer(null); setPeerTried(null); setPeerQ(''); }} aria-label="Close">×</button>
            </p>
            {peer.todos.map((t) => (
              <div className="todo__row todo__row--peer" key={t.id}>
                <span className="todo__box todo__box--ro" aria-hidden />
                <span className="todo__title">{t.title}</span>
              </div>
            ))}
            {days.map((iso) => {
              const rems = remindersOn(peer.reminders as unknown as ReminderRow[], iso);
              if (!rems.length) return null;
              return (
                <div className="todo__day" key={'peer' + iso}>
                  <p className="todo__daylbl">{dayLabel(iso)}</p>
                  {rems.map((r) => (
                    <div className="todo__row todo__row--peer" key={r.id + iso}>
                      <span className="todo__box todo__box--ro" aria-hidden />
                      <span className="todo__title">
                        {r.title}
                        {r.at_min != null && <span className="todo__when">{minToLabel(r.at_min)}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
            {peer.todos.length === 0 && !days.some((iso) => remindersOn(peer.reminders as unknown as ReminderRow[], iso).length > 0) && (
              <p className="todo__empty">Their list is clear.</p>
            )}
          </>
        )}
      </div>

      {doneTodos.length > 0 && (
        <>
          <p className="todo__head">Done</p>
          {doneTodos.map((t) => (
            <div className="todo__row is-done" key={t.id}>
              <button className="todo__box is-done" aria-label="Mark not done" onClick={() => toggle(t)}>✓</button>
              <span className="todo__title">{t.title}</span>
              <button className="todo__x" aria-label="Delete" onClick={() => remove(t)}><Icon name="close" size={12} /></button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
