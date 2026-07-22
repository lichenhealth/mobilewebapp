import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './Icon';
import { localDate } from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import { remindersOn, type Reminder as ReminderRow } from '../lib/remindersApi';
import { listTodos, createTodo, setTodoDone, deleteTodo, type Todo } from '../lib/todosApi';
import './TodoView.css';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The To-Do view (founder, 2026-07-22): a checklist that lives where the
 *  calendar grid does. Free-form to-dos up top; reminders auto-populate below,
 *  grouped by day. Tick a reminder to mark that day done; tap it to edit. */
export default function TodoView({
  me, reminders, remDone, onToggleRem, days, today,
}: {
  me: string;
  reminders: ReminderRow[];
  remDone: Set<string>;
  onToggleRem: (r: ReminderRow, iso: string) => void;
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
                    <button className="todo__title todo__title--btn" onClick={() => navigate(`/calendar/new?reminder=${r.id}`)}>
                      {r.title}
                      {r.at_min != null && <span className="todo__when">{minToLabel(r.at_min)}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      )}

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
