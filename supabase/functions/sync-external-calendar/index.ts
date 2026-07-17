// Supabase Edge Function: sync-external-calendar
//
// Fetches each of the caller's external calendars (secret iCal URLs — Google /
// Apple / Outlook), parses the ICS, expands recurring events, and rewrites the
// member's busy blocks in external_busy. Invoked from the app
// (`supabase.functions.invoke('sync-external-calendar', { body: { timezone } })`)
// on Calendar load and from the settings "Sync now" button.
//
// All database access uses the CALLER's Authorization header against the REST
// API, so RLS guarantees members can only ever touch their own rows. Calendars
// synced within the last 30 minutes are skipped unless { force: true }.
//
// ICS support (deliberately lite, matching src/lib/recurrence.ts's spirit):
// DTSTART/DTEND (UTC, TZID, VALUE=DATE), DURATION, RRULE FREQ=DAILY/WEEKLY/
// MONTHLY/YEARLY with INTERVAL/COUNT/UNTIL/BYDAY/BYMONTHDAY, EXDATE,
// RECURRENCE-ID overrides, STATUS:CANCELLED. Window: 30 days back, 180 forward.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ─── Timezone math (no libraries): wall time in tz ⇄ UTC instant ────────────
function tzOffset(t: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(new Date(t))) p[part.type] = part.value;
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return local - t;
}
function wallToUTC(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}
function utcToWall(t: number, tz: string): { y: number; mo: number; d: number; min: number } {
  const local = new Date(t + tzOffset(t, tz));
  return { y: local.getUTCFullYear(), mo: local.getUTCMonth() + 1, d: local.getUTCDate(), min: local.getUTCHours() * 60 + local.getUTCMinutes() };
}
const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (y: number, mo: number, d: number) => `${y}-${pad(mo)}-${pad(d)}`;

// ─── ICS parsing ─────────────────────────────────────────────────────────────
interface IcsTime { utc: number | null; date: string | null } // timed instant OR all-day date
interface IcsEvent {
  uid: string;
  recurrenceId: string | null;    // raw value — marks an override instance
  start: IcsTime; end: IcsTime | null;
  durationMs: number | null;
  rrule: Record<string, string> | null;
  exdates: Set<string>;           // raw date parts (yyyymmdd) — good enough to match
  cancelled: boolean;
  title: string;
}

function unfold(ics: string): string[] {
  const raw = ics.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out;
}

function parseIcsTime(params: string, value: string, fallbackTz: string): IcsTime {
  if (/VALUE=DATE(?:;|$)/.test(params) || /^\d{8}$/.test(value)) {
    return { utc: null, date: `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z?)$/);
  if (!m) return { utc: null, date: null };
  const [, y, mo, d, h, mi, s, z] = m;
  if (z === 'Z') return { utc: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)), date: null };
  const tzm = params.match(/TZID=([^;:]+)/);
  const tz = tzm ? tzm[1].replace(/^"|"$/g, '') : fallbackTz;
  try {
    return { utc: wallToUTC(+y, +mo, +d, +h, +mi, +(s || 0), tz), date: null };
  } catch {
    return { utc: wallToUTC(+y, +mo, +d, +h, +mi, +(s || 0), 'UTC'), date: null };
  }
}

function parseDuration(v: string): number | null {
  const m = v.match(/^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const ms = ((+(m[2] || 0)) * 86400 + (+(m[3] || 0)) * 3600 + (+(m[4] || 0)) * 60 + (+(m[5] || 0))) * 1000;
  return m[1] ? -ms : ms;
}

function parseIcs(ics: string, fallbackTz: string): IcsEvent[] {
  const lines = unfold(ics);
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> & { inEvent?: boolean } | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: new Set(), cancelled: false, title: '', recurrenceId: null, rrule: null, end: null, durationMs: null }; continue; }
    if (line === 'END:VEVENT') {
      if (cur?.uid && cur.start && (cur.start.utc != null || cur.start.date)) events.push(cur as IcsEvent);
      cur = null; continue;
    }
    if (!cur) continue;
    const ci = line.indexOf(':');
    if (ci < 0) continue;
    const head = line.slice(0, ci);
    const value = line.slice(ci + 1);
    const [prop, ...paramParts] = head.split(';');
    const params = paramParts.join(';');
    switch (prop) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.title = value.replace(/\\([,;nN\\])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).slice(0, 200); break;
      case 'DTSTART': cur.start = parseIcsTime(params, value, fallbackTz); break;
      case 'DTEND': cur.end = parseIcsTime(params, value, fallbackTz); break;
      case 'DURATION': cur.durationMs = parseDuration(value); break;
      case 'RRULE': {
        const r: Record<string, string> = {};
        for (const kv of value.split(';')) { const [k, v] = kv.split('='); if (k && v) r[k.toUpperCase()] = v; }
        cur.rrule = r; break;
      }
      case 'EXDATE':
        for (const v of value.split(',')) { const dm = v.match(/^(\d{8})/); if (dm) cur.exdates!.add(dm[1]); }
        break;
      case 'RECURRENCE-ID': cur.recurrenceId = value.replace(/Z$/, '').slice(0, 8); break;
      case 'STATUS': if (value.toUpperCase() === 'CANCELLED') cur.cancelled = true; break;
    }
  }
  return events;
}

// ─── Expansion into per-day busy rows ────────────────────────────────────────
interface BusyRow { on_date: string; all_day: boolean; start_min: number | null; end_min: number | null; title: string }

const DAY_MS = 86400000;
const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function* occurrences(ev: IcsEvent, windowStart: number, windowEnd: number): Generator<number> {
  // Yields UTC start instants (timed) or UTC midnights (all-day) for each occurrence.
  const base = ev.start.utc ?? Date.parse(ev.start.date + 'T00:00:00Z');
  if (!ev.rrule) { yield base; return; }
  const freq = ev.rrule.FREQ;
  const interval = Math.max(1, +(ev.rrule.INTERVAL || 1));
  const count = ev.rrule.COUNT ? +ev.rrule.COUNT : Infinity;
  let until = Infinity;
  if (ev.rrule.UNTIL) {
    const u = ev.rrule.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/);
    if (u) until = Date.UTC(+u[1], +u[2] - 1, +u[3], +(u[4] || 23), +(u[5] || 59), +(u[6] || 59));
  }
  const cap = 730; // hard stop — two years of daily
  let made = 0, emitted = 0;
  if (freq === 'WEEKLY') {
    const days = (ev.rrule.BYDAY ? ev.rrule.BYDAY.split(',').map((d) => BYDAY[d.slice(-2)]).filter((d) => d != null) : [new Date(base).getUTCDay()]);
    for (let week = 0; made < count && emitted < cap; week++) {
      const weekAnchor = base + week * interval * 7 * DAY_MS;
      if (weekAnchor > windowEnd + 7 * DAY_MS || weekAnchor > until + 7 * DAY_MS) break;
      const anchorDow = new Date(base).getUTCDay();
      for (const dow of days.sort((a, b) => a - b)) {
        const t = weekAnchor + ((dow - anchorDow + 7) % 7) * DAY_MS;
        if (t < base || t > until) continue;
        if (made++ >= count) break;
        emitted++;
        if (t >= windowStart - DAY_MS && t <= windowEnd) yield t;
      }
    }
    return;
  }
  for (let i = 0; made < count && emitted < cap; i++) {
    let t: number;
    const b = new Date(base);
    if (freq === 'DAILY') t = base + i * interval * DAY_MS;
    else if (freq === 'MONTHLY') {
      const nth = ev.rrule.BYDAY?.match(/^(-?\d)([A-Z]{2})$/);
      if (nth) {
        // nth weekday of month (e.g. 2TU); -1 = last
        const m = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + i * interval, 1));
        const dow = BYDAY[nth[2]];
        let day: number;
        if (+nth[1] > 0) {
          day = 1 + ((dow - m.getUTCDay() + 7) % 7) + (+nth[1] - 1) * 7;
        } else {
          const lastDay = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 0));
          day = lastDay.getUTCDate() - ((lastDay.getUTCDay() - dow + 7) % 7);
        }
        t = Date.UTC(m.getUTCFullYear(), m.getUTCMonth(), day, b.getUTCHours(), b.getUTCMinutes());
      } else {
        const dom = ev.rrule.BYMONTHDAY ? +ev.rrule.BYMONTHDAY.split(',')[0] : b.getUTCDate();
        t = Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + i * interval, dom, b.getUTCHours(), b.getUTCMinutes());
      }
    } else if (freq === 'YEARLY') t = Date.UTC(b.getUTCFullYear() + i * interval, b.getUTCMonth(), b.getUTCDate(), b.getUTCHours(), b.getUTCMinutes());
    else { yield base; return; } // unknown FREQ — treat as single
    if (t > until || t > windowEnd) return;
    made++; emitted++;
    if (t >= windowStart - DAY_MS) yield t;
  }
}

function expand(events: IcsEvent[], tz: string, windowStart: number, windowEnd: number): BusyRow[] {
  // Overrides (RECURRENCE-ID) replace the base instance on that date.
  const overridden = new Set<string>();
  for (const ev of events) if (ev.recurrenceId && ev.uid) overridden.add(ev.uid + ':' + ev.recurrenceId);

  const rows: BusyRow[] = [];
  const push = (startUtc: number, durMs: number, allDay: boolean, dateOnly: string | null, title: string) => {
    if (allDay && dateOnly) {
      const days = Math.max(1, Math.round(durMs / DAY_MS));
      const baseT = Date.parse(dateOnly + 'T00:00:00Z');
      for (let i = 0; i < Math.min(days, 60); i++) {
        const dd = new Date(baseT + i * DAY_MS);
        rows.push({ on_date: isoDate(dd.getUTCFullYear(), dd.getUTCMonth() + 1, dd.getUTCDate()), all_day: true, start_min: null, end_min: null, title });
      }
      return;
    }
    // Timed: convert to the member's tz, split at midnights.
    let cursor = startUtc;
    const endUtc = startUtc + Math.max(durMs, 15 * 60000);
    let guard = 0;
    while (cursor < endUtc && guard++ < 60) {
      const w = utcToWall(cursor, tz);
      const dayEndUtc = cursor + (1440 - w.min) * 60000;
      const segEnd = Math.min(endUtc, dayEndUtc);
      const endWall = w.min + Math.round((segEnd - cursor) / 60000);
      rows.push({ on_date: isoDate(w.y, w.mo, w.d), all_day: false, start_min: w.min, end_min: Math.min(1440, endWall), title });
      cursor = segEnd;
    }
  };

  for (const ev of events) {
    if (ev.cancelled) continue;
    const isAllDay = ev.start.date != null;
    let durMs: number;
    if (ev.durationMs != null) durMs = ev.durationMs;
    else if (ev.end) {
      const endT = ev.end.utc ?? (ev.end.date ? Date.parse(ev.end.date + 'T00:00:00Z') : null);
      const startT = ev.start.utc ?? Date.parse(ev.start.date + 'T00:00:00Z');
      durMs = endT != null ? endT - startT : (isAllDay ? DAY_MS : 30 * 60000);
    } else durMs = isAllDay ? DAY_MS : 30 * 60000;

    if (ev.recurrenceId) {
      // An override instance — emit directly.
      const startT = ev.start.utc ?? Date.parse(ev.start.date + 'T00:00:00Z');
      if (startT <= windowEnd && startT + durMs >= windowStart) {
        push(startT, durMs, isAllDay, ev.start.date, ev.title);
      }
      continue;
    }
    for (const t of occurrences(ev, windowStart, windowEnd)) {
      const key = new Date(t);
      const ymd = `${key.getUTCFullYear()}${pad(key.getUTCMonth() + 1)}${pad(key.getUTCDate())}`;
      if (ev.exdates.has(ymd)) continue;
      if (ev.uid && overridden.has(ev.uid + ':' + ymd)) continue;
      const dateOnly = isAllDay ? isoDate(key.getUTCFullYear(), key.getUTCMonth() + 1, key.getUTCDate()) : null;
      push(t, durMs, isAllDay, dateOnly, ev.title);
    }
  }
  return rows.slice(0, 4000);
}

// ─── REST helpers (caller's token — RLS scopes everything) ───────────────────
function rest(auth: string) {
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: auth, 'Content-Type': 'application/json' };
  return {
    get: async (path: string) => (await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers })).json(),
    post: (path: string, body: unknown) =>
      fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body) }),
    patch: (path: string, body: unknown) =>
      fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body) }),
    del: (path: string) =>
      fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method: 'DELETE', headers: { ...headers, Prefer: 'return=minimal' } }),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth) return json({ error: 'Not signed in' }, 401);

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } });
  if (!userRes.ok) return json({ error: 'Not signed in' }, 401);
  const user = await userRes.json();

  let body: { timezone?: string; calendarId?: string; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const tz = body.timezone && /^[A-Za-z_+-]+\/[A-Za-z_+-\/]+$|^UTC$/.test(body.timezone) ? body.timezone : 'UTC';

  const db = rest(auth);
  const calFilter = body.calendarId ? `&id=eq.${body.calendarId}` : '';
  const cals = await db.get(`external_calendars?select=id,url,name,last_synced_at&profile_id=eq.${user.id}${calFilter}`);
  if (!Array.isArray(cals)) return json({ error: 'Could not load calendars' }, 500);

  const now = Date.now();
  const windowStart = now - 30 * DAY_MS;
  const windowEnd = now + 180 * DAY_MS;
  const results: Record<string, unknown>[] = [];

  for (const cal of cals) {
    if (!body.force && cal.last_synced_at && now - Date.parse(cal.last_synced_at) < 30 * 60000) {
      results.push({ id: cal.id, skipped: 'fresh' });
      continue;
    }
    try {
      const url = String(cal.url).replace(/^webcal:\/\//i, 'https://');
      const res = await fetch(url, { headers: { 'User-Agent': 'Lichen-Calendar-Sync/1.0' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`Calendar URL answered ${res.status}`);
      const text = await res.text();
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Not an iCal feed — check the URL');
      const rows = expand(parseIcs(text, tz), tz, windowStart, windowEnd);

      await db.del(`external_busy?calendar_id=eq.${cal.id}`);
      for (let i = 0; i < rows.length; i += 400) {
        const batch = rows.slice(i, i + 400).map((r) => ({ ...r, calendar_id: cal.id, profile_id: user.id }));
        const ins = await db.post('external_busy', batch);
        if (!ins.ok) throw new Error('Could not save busy blocks');
      }
      await db.patch(`external_calendars?id=eq.${cal.id}`, {
        last_synced_at: new Date().toISOString(), last_error: null, event_count: rows.length, timezone: tz,
      });
      results.push({ id: cal.id, events: rows.length });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await db.patch(`external_calendars?id=eq.${cal.id}`, { last_synced_at: new Date().toISOString(), last_error: msg });
      results.push({ id: cal.id, error: msg });
    }
  }
  return json({ ok: true, results });
});
