// Mint, re-time, and delete per-booking Zoom meetings (founder 2026-10-07:
// "walk me thru how to do this with zoom, yes!"). ONE reconcile routine,
// called from two doors — the `zoom-meeting` edge function (poked by the
// booking_zoom_poke trigger) and send-booking-mail (inline, so a guest's
// confirmation email never races the async poke and goes out linkless).
//
// Everything is DERIVED from the booking row's current state — mint when
// confirmed and unminted, PATCH the meeting's time when confirmed and
// already minted (a reschedule), DELETE it when cancelled/declined — so a
// doubled or replayed call can only restate the truth.
//
// Zoom auth is Server-to-Server OAuth on LICHEN'S OWN Zoom account (the
// founder's "Lichen Scheduling" Marketplace app). All minted meetings are
// hosted by that one Zoom user, and most Zoom plans allow only ONE live
// meeting per host at a time — which is why platform_settings.zoom_providers
// gates WHO may mint (today: Galyn). Secrets: ZOOM_ACCOUNT_ID,
// ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (founder-pasted, never through chat);
// ZOOM_HOST_EMAIL optional, defaults to Lichen's Zoom login.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ZOOM_ACCOUNT_ID = (Deno.env.get('ZOOM_ACCOUNT_ID') ?? '').replace(/[^\x21-\x7E]/g, '');
const ZOOM_CLIENT_ID = (Deno.env.get('ZOOM_CLIENT_ID') ?? '').replace(/[^\x21-\x7E]/g, '');
const ZOOM_CLIENT_SECRET = (Deno.env.get('ZOOM_CLIENT_SECRET') ?? '').replace(/[^\x21-\x7E]/g, '');
const ZOOM_HOST = Deno.env.get('ZOOM_HOST_EMAIL') ?? 'connect@lichen.health';

const svc = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

export const zoomConfigured = () => !!(ZOOM_ACCOUNT_ID && ZOOM_CLIENT_ID && ZOOM_CLIENT_SECRET);

async function sbGet<T>(path: string): Promise<T | null> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svc });
  if (!r.ok) return null;
  return await r.json() as T;
}

async function zoomToken(): Promise<string | null> {
  const r = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(ZOOM_ACCOUNT_ID)}`,
    { method: 'POST', headers: { Authorization: `Basic ${btoa(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`)}` } },
  );
  if (!r.ok) { console.error('zoom token:', r.status, await r.text().catch(() => '')); return null; }
  const j = await r.json().catch(() => null) as { access_token?: string } | null;
  return j?.access_token ?? null;
}

interface BookingRow {
  id: string; type_id: string; provider_id: string; status: string;
  on_date: string; start_min: number; end_min: number;
  meeting_url: string | null; zoom_meeting_id: string | null; event_id: string | null;
  booking_types: { title: string; location: string | null; capacity: number } | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const localStart = (b: BookingRow) =>
  `${b.on_date}T${pad(Math.floor(b.start_min / 60))}:${pad(b.start_min % 60)}:00`;

/** Reconcile one booking's Zoom meeting to the row's current state.
 *  Returns the join link when the booking ends up holding one. */
export async function reconcileBookingZoom(bookingId: string): Promise<string | null> {
  if (!zoomConfigured() || !/^[0-9a-f-]{36}$/i.test(bookingId)) return null;

  const rows = await sbGet<BookingRow[]>(
    `bookings?id=eq.${bookingId}&select=id,type_id,provider_id,status,on_date,start_min,end_min,meeting_url,zoom_meeting_id,event_id,booking_types(title,location,capacity)`,
  );
  const b = rows?.[0];
  if (!b) return null;

  const meet = (await sbGet<{ zoom_unique: boolean }[]>(
    `booking_type_meetings?type_id=eq.${b.type_id}&select=zoom_unique`,
  ))?.[0];
  if (!meet?.zoom_unique) return b.meeting_url;

  // The provider gate: minted meetings live on Lichen's one Zoom account.
  const allowed = (await sbGet<{ value: unknown }[]>(
    `platform_settings?key=eq.zoom_providers&select=value`,
  ))?.[0]?.value;
  if (!Array.isArray(allowed) || !allowed.includes(b.provider_id)) return b.meeting_url;

  const tz = (await sbGet<{ timezone: string | null }[]>(
    `profiles?id=eq.${b.provider_id}&select=timezone`,
  ))?.[0]?.timezone || 'America/Denver';

  const duration = Math.max(15, Math.min(1440, (b.end_min - b.start_min) || 60));

  // ── Cancelled / declined: close the door for real ─────────────────────────
  if (b.status !== 'confirmed') {
    if (!b.zoom_meeting_id) return null;
    // A group seat steps out of a SHARED meeting without killing it for the
    // seats still confirmed.
    const seatmate = (b.booking_types?.capacity ?? 1) > 1 ? (await sbGet<{ id: string }[]>(
      `bookings?type_id=eq.${b.type_id}&on_date=eq.${b.on_date}&start_min=eq.${b.start_min}` +
      `&status=eq.confirmed&zoom_meeting_id=eq.${encodeURIComponent(b.zoom_meeting_id)}&id=neq.${b.id}&select=id&limit=1`,
    ))?.[0] : null;
    if (!seatmate) {
      const token = await zoomToken();
      if (token) {
        const r = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(b.zoom_meeting_id)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok && r.status !== 404) console.error('zoom delete:', r.status, await r.text().catch(() => ''));
      }
    }
    await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${b.id}`, {
      method: 'PATCH', headers: svc,
      body: JSON.stringify({ meeting_url: null, zoom_meeting_id: null }),
    });
    return null;
  }

  // ── Confirmed + already minted: a reschedule re-times the meeting ────────
  if (b.zoom_meeting_id) {
    const token = await zoomToken();
    if (token) {
      const r = await fetch(`https://api.zoom.us/v2/meetings/${encodeURIComponent(b.zoom_meeting_id)}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ start_time: localStart(b), duration, timezone: tz }),
      });
      if (r.status === 404) {
        // The meeting vanished under us (deleted in Zoom's UI) — mint fresh.
        await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${b.id}`, {
          method: 'PATCH', headers: svc,
          body: JSON.stringify({ meeting_url: null, zoom_meeting_id: null }),
        });
        return reconcileBookingZoom(bookingId);
      }
      if (!r.ok) console.error('zoom patch:', r.status, await r.text().catch(() => ''));
    }
    return b.meeting_url;
  }

  // ── Confirmed + unminted: a group slot adopts its seatmates' meeting ──────
  if ((b.booking_types?.capacity ?? 1) > 1) {
    const mate = (await sbGet<{ meeting_url: string | null; zoom_meeting_id: string | null }[]>(
      `bookings?type_id=eq.${b.type_id}&on_date=eq.${b.on_date}&start_min=eq.${b.start_min}` +
      `&status=eq.confirmed&zoom_meeting_id=not.is.null&id=neq.${b.id}&select=meeting_url,zoom_meeting_id&limit=1`,
    ))?.[0];
    if (mate?.zoom_meeting_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${b.id}&zoom_meeting_id=is.null`, {
        method: 'PATCH', headers: svc,
        body: JSON.stringify({ meeting_url: mate.meeting_url, zoom_meeting_id: mate.zoom_meeting_id }),
      });
      return mate.meeting_url;
    }
  }

  // ── Mint ──────────────────────────────────────────────────────────────────
  const token = await zoomToken();
  if (!token) return b.meeting_url;
  const create = await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(ZOOM_HOST)}/meetings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topic: `${b.booking_types?.title ?? 'Session'} (via Lichen)`,
      type: 2, start_time: localStart(b), duration, timezone: tz,
    }),
  });
  if (!create.ok) { console.error('zoom create:', create.status, await create.text().catch(() => '')); return b.meeting_url; }
  const made = await create.json().catch(() => null) as { id?: number | string; join_url?: string } | null;
  if (!made?.id || !made.join_url) return b.meeting_url;
  const zid = String(made.id);

  // Compare-and-set: the trigger poke and send-booking-mail's inline call can
  // race — only the first stamp lands, the loser deletes its orphan meeting.
  const stamp = await fetch(`${SUPABASE_URL}/rest/v1/bookings?id=eq.${b.id}&zoom_meeting_id=is.null`, {
    method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' },
    body: JSON.stringify({ meeting_url: made.join_url, zoom_meeting_id: zid }),
  });
  const stamped = (await stamp.json().catch(() => [])) as unknown[];
  if (!Array.isArray(stamped) || stamped.length === 0) {
    await fetch(`https://api.zoom.us/v2/meetings/${zid}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
    const winner = (await sbGet<{ meeting_url: string | null }[]>(
      `bookings?id=eq.${b.id}&select=meeting_url`,
    ))?.[0];
    return winner?.meeting_url ?? null;
  }

  // The linked calendar event's location becomes the join link — but only
  // when it still reads as the type's place (or nothing); a hand-edited
  // location is the provider's own words.
  if (b.event_id) {
    const ev = (await sbGet<{ location: string | null }[]>(
      `events?id=eq.${b.event_id}&select=location`,
    ))?.[0];
    const loc = ev?.location ?? '';
    if (loc === '' || loc === (b.booking_types?.location ?? '')) {
      await fetch(`${SUPABASE_URL}/rest/v1/events?id=eq.${b.event_id}`, {
        method: 'PATCH', headers: svc, body: JSON.stringify({ location: made.join_url }),
      });
    }
  }
  return made.join_url;
}
