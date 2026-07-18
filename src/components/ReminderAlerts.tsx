import { useEffect, useRef } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { todayISO } from '../lib/conciergeApi';
import { minToLabel } from '../lib/calendarApi';
import { listReminders, remindersOn, type Reminder } from '../lib/remindersApi';

/** Phase-1 alerts (Gabe, 2026-07-18): while Lichen is open, timed reminders
 *  fire a browser notification at their moment (minus lead). Day reminders
 *  nudge at 9am. True away-from-app push/email is phase 2 — it needs the
 *  scheduled-job infrastructure (pg_cron + edge fn), deliberately deferred. */
export default function ReminderAlerts() {
  const { user } = useAuth();
  const me = user?.id ?? '';
  const cache = useRef<{ at: number; rems: Reminder[] }>({ at: 0, rems: [] });
  const fired = useRef(new Set<string>());

  useEffect(() => {
    if (!me) return;
    const tick = async () => {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      const now = Date.now();
      if (now - cache.current.at > 10 * 60_000) {
        cache.current = { at: now, rems: await listReminders(me) };
      }
      const iso = todayISO();
      const d = new Date();
      const nowMin = d.getHours() * 60 + d.getMinutes();
      for (const r of remindersOn(cache.current.rems, iso)) {
        const due = r.at_min != null ? r.at_min - r.lead_min : 9 * 60;
        const k = `${r.id}:${iso}`;
        if (nowMin >= due && nowMin <= due + 1 && !fired.current.has(k)) {
          fired.current.add(k);
          try {
            new Notification('Lichen reminder', {
              body: r.title + (r.at_min != null ? ` · ${minToLabel(r.at_min)}` : ''),
              tag: k,
            });
          } catch { /* some platforms require a service worker — quiet no-op */ }
        }
      }
    };
    void tick();
    const t = window.setInterval(tick, 30_000);
    return () => window.clearInterval(t);
  }, [me]);

  return null;
}
