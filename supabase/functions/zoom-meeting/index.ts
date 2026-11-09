// Supabase Edge Function: zoom-meeting
//
// The booking_zoom_poke trigger's door (pg_net): reconcile one booking's
// per-booking Zoom meeting to the row's CURRENT state — mint on confirm,
// re-time on reschedule, delete on cancel. All the real work and all the
// safety live in _shared/zoomMeeting.ts; everything is derived from the
// database, so a replayed call can only restate the truth.
//
// verify_jwt = false (config.toml) — pg_net carries no user JWT; instead the
// call must present the shared secret header (x-webhook-secret ==
// PUSH_HOOK_SECRET), the send-push pattern.
// Secrets: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET (+ optional
// ZOOM_HOST_EMAIL), PUSH_HOOK_SECRET.

import { reconcileBookingZoom, reconcileEventZoom, deleteEventZoom, zoomConfigured } from '../_shared/zoomMeeting.ts';

const WEBHOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (!WEBHOOK_SECRET || req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }
  try {
    const { booking_id, event_id, delete_zoom_id } = await req.json().catch(() => ({}));
    if (!zoomConfigured()) return json({ ok: false, error: 'Zoom not configured' });
    // EVENTS (2026-11-09): the event_zoom_poke trigger's two shapes.
    if (typeof delete_zoom_id === 'string') { await deleteEventZoom(delete_zoom_id); return json({ ok: true }); }
    if (typeof event_id === 'string') { const u = await reconcileEventZoom(event_id); return json({ ok: true, has_link: !!u }); }
    if (typeof booking_id !== 'string') return json({ error: 'No booking_id' }, 400);
    const url = await reconcileBookingZoom(booking_id);
    return json({ ok: true, has_link: !!url });
  } catch (e) {
    console.error('zoom-meeting:', e);
    return json({ error: 'Something went wrong.' }, 500);
  }
});
