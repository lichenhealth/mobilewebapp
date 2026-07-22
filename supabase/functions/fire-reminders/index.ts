// Supabase Edge Function: fire-reminders
//
// Invoked every minute by pg_cron (via public.tick_reminders() → net.http_post).
// It expands each reminder's recurrence, checks each recipient's LOCAL time
// (profiles.timezone), and for anything due-right-now calls notify() — which
// inserts the bell AND fans it to the phone via the send-push webhook. A
// reminder_fired ledger guarantees once-per-day-per-person (no double buzzes).
//
// This away-from-app path is what ReminderAlerts (foreground-only) always
// pointed at as "phase 2". The recurrence math below is a faithful copy of
// src/lib/recurrence.ts — keep the two in step if either changes.
//
// verify_jwt OFF; gated by x-webhook-secret == PUSH_HOOK_SECRET.

const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── recurrence (mirror of src/lib/recurrence.ts, on UTC-parsed date strings) ──
type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
type RecEnd = { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; n: number };
interface Recurrence { freq: Freq; interval: number; byday?: number[]; monthMode?: 'date' | 'weekday'; end: RecEnd }
interface Reminder {
  id: string; profile_id: string; title: string;
  start_date: string; end_date: string | null;
  at_min: number | null; lead_min: number; recurrence: Recurrence | null;
}

const ms = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const isoOf = (t: number) => {
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
const dowMon0 = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; };
const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / 86_400_000);
const monthsBetween = (a: string, b: string) => {
  const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const dayOfMonth = (iso: string) => Number(iso.split('-')[2]);
const nthOfMonth = (iso: string) => Math.floor((dayOfMonth(iso) - 1) / 7) + 1;
const isLastOfMonth = (iso: string) => { const [y, m] = iso.split('-').map(Number); return dayOfMonth(iso) + 7 > daysInMonth(y, m - 1); };

function matchesPattern(rec: Recurrence, anchor: string, iso: string): boolean {
  if (iso < anchor) return false;
  const interval = Math.max(1, rec.interval || 1);
  switch (rec.freq) {
    case 'daily':
      return daysBetween(anchor, iso) % interval === 0;
    case 'weekly': {
      const byday = rec.byday?.length ? rec.byday : [dowMon0(anchor)];
      if (!byday.includes(dowMon0(iso))) return false;
      const wa = daysBetween(anchor, iso) - (dowMon0(iso) - dowMon0(anchor));
      return Math.round(wa / 7) % interval === 0;
    }
    case 'monthly': {
      if (monthsBetween(anchor, iso) % interval !== 0) return false;
      if (rec.monthMode === 'weekday') {
        if (dowMon0(iso) !== dowMon0(anchor)) return false;
        return isLastOfMonth(anchor) ? isLastOfMonth(iso) : nthOfMonth(iso) === nthOfMonth(anchor);
      }
      return dayOfMonth(iso) === dayOfMonth(anchor);
    }
    case 'yearly': {
      const [ay, am, ad] = anchor.split('-').map(Number), [iy, im, id] = iso.split('-').map(Number);
      return (iy - ay) % interval === 0 && im === am && id === ad;
    }
  }
}

function occurrenceIndex(rec: Recurrence, anchor: string, iso: string): number {
  let count = 0;
  let t = ms(anchor);
  const guard = Math.min(daysBetween(anchor, iso), 366 * 20);
  for (let i = 0; i <= guard; i++) {
    const cur = isoOf(t);
    if (matchesPattern(rec, anchor, cur)) count += 1;
    if (cur === iso) return count;
    t += 86_400_000;
  }
  return count;
}

function occursOn(r: Reminder, iso: string): boolean {
  const anchor = r.start_date;
  if (!anchor) return false;
  if (!r.recurrence) return anchor <= iso && iso <= (r.end_date ?? anchor);
  const rec = r.recurrence;
  if (!matchesPattern(rec, anchor, iso)) return false;
  if (rec.end.type === 'until') return iso <= rec.end.date;
  if (rec.end.type === 'count') return occurrenceIndex(rec, anchor, iso) <= Math.max(1, rec.end.n);
  return true;
}

// ── local time in a member's timezone ────────────────────────────────────────
function localParts(tz: string): { date: string; min: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
    const hour = Number(p.hour) % 24; // some engines render midnight as '24'
    return { date: `${p.year}-${p.month}-${p.day}`, min: hour * 60 + Number(p.minute) };
  } catch {
    return null;
  }
}

function timeLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

const sb = (path: string, init?: RequestInit) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY!, Authorization: `Bearer ${SERVICE_KEY!}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

// Window: fire if the due minute is 0..6 minutes in the past (catches a late or
// briefly-missed cron run; the ledger stops any double-fire).
const LATE_WINDOW = 6;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) return json({ error: 'Unauthorized' }, 401);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Not configured' }, 500);

  // All reminders (alpha scale — a handful). Columns only.
  const reminders = (await (await sb('reminders?select=id,profile_id,title,start_date,end_date,at_min,lead_min,recurrence')).json()) as Reminder[];
  if (!Array.isArray(reminders) || reminders.length === 0) return json({ ok: true, checked: 0, fired: 0 });

  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

  const ids = reminders.map((r) => r.id);
  const recips = arr<{ reminder_id: string; recipient_type: 'profile' | 'space'; recipient_id: string }>(
    await (await sb(`reminder_recipients?reminder_id=in.(${ids.join(',')})&select=reminder_id,recipient_type,recipient_id`)).json());

  // Expand space recipients to their members.
  const spaceIds = [...new Set(recips.filter((r) => r.recipient_type === 'space').map((r) => r.recipient_id))];
  const spaceMembers: Record<string, string[]> = {};
  if (spaceIds.length) {
    const mem = arr<{ space_id: string; profile_id: string }>(
      await (await sb(`space_members?space_id=in.(${spaceIds.join(',')})&select=space_id,profile_id`)).json());
    for (const m of mem) (spaceMembers[m.space_id] ??= []).push(m.profile_id);
  }

  // Recipient set per reminder: owner + named people + space members.
  const audience = (r: Reminder): string[] => {
    const set = new Set<string>([r.profile_id]);
    for (const rr of recips.filter((x) => x.reminder_id === r.id)) {
      if (rr.recipient_type === 'profile') set.add(rr.recipient_id);
      else for (const pid of spaceMembers[rr.recipient_id] ?? []) set.add(pid);
    }
    return [...set];
  };

  // Timezones for everyone involved.
  const everyone = [...new Set(reminders.flatMap(audience))];
  // timezone may not exist pre-migration → select degrades; guard so we 200, not 500.
  const tzRows = arr<{ id: string; timezone: string | null; notification_pref: string | null }>(
    await (await sb(`profiles?id=in.(${everyone.join(',')})&select=id,timezone,notification_pref`)).json());
  const tzOf: Record<string, string | null> = {};
  const prefOf: Record<string, string | null> = {};
  for (const p of tzRows) { tzOf[p.id] = p.timezone; prefOf[p.id] = p.notification_pref; }

  let checked = 0, fired = 0;
  for (const r of reminders) {
    for (const uid of audience(r)) {
      const tz = tzOf[uid];
      if (!tz) continue;                                  // no known local time → don't guess
      if ((prefOf[uid] ?? 'in_app') === 'off') continue;  // respect the mute
      const local = localParts(tz);
      if (!local) continue;
      checked++;
      if (!occursOn(r, local.date)) continue;
      const due = r.at_min != null ? r.at_min - r.lead_min : 9 * 60;
      const late = local.min - due;
      if (late < 0 || late > LATE_WINDOW) continue;

      // Claim this (reminder,user,day) atomically; empty return = already fired.
      const claim = await sb('reminder_fired', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
        body: JSON.stringify({ reminder_id: r.id, profile_id: uid, on_date: local.date }),
      });
      const claimed = (await claim.json().catch(() => [])) as unknown[];
      if (!Array.isArray(claimed) || claimed.length === 0) continue;

      const body = r.title + (r.at_min != null ? ` · ${timeLabel(r.at_min)}` : '');
      await sb('rpc/notify', {
        method: 'POST',
        body: JSON.stringify({
          p_recipient: uid, p_section: 'calendar', p_space: null, p_type: 'reminder_due',
          p_title: 'Reminder', p_body: body, p_link: '/calendar', p_actor: null,
        }),
      });
      fired++;
    }
  }

  return json({ ok: true, checked, fired });
});
