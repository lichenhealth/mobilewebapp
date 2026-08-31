// Supabase Edge Function: image-focus
//
// WHERE TO LOOK IN A PHOTO (founder 2026-08-28, after Rick Countryman's head
// was cropped off the barn's About page). A page photo is shown in a wide,
// short frame, and `imagePos` decided what survives the crop — defaulting to
// dead centre, which trims equally from top and bottom. A standing person's
// head is at the top, so it is the first thing to go. Nothing looked at the
// image; there was no check to fail, only the absence of one.
//
// This asks Claude where the subject actually is and stores that as the
// photo's starting position. NOT a face detector on purpose: the barn's
// photos are horses, riders and scanned newspaper clippings, and a
// human-face model would find nothing in most of them. "Where is the
// subject" is the question that generalises.
//
// The owner's drag always wins — this only sets the value a photo ARRIVES
// with, and the editor's drag handle overwrites it freely.
//
// Auth: verify_jwt (members only). Images must live in OUR storage — the
// function refuses to fetch arbitrary URLs (same guard as style-tags; an
// image URL is a fetch this server makes, so it is an SSRF surface).
// Raw fetch to api.anthropic.com (repo convention).
// Secrets: ANTHROPIC_API_KEY (already set). Model: IMAGE_FOCUS_MODEL.

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('IMAGE_FOCUS_MODEL') ?? 'claude-haiku-4-5-20251001';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// The number is a CSS object-position percentage, and the direction is not
// intuitive: with object-fit:cover, 0% pins the image's TOP edge to the
// frame (you see the top of the photo) and 100% pins the bottom. So a head
// near the top of the frame wants a LOW number. The prompt says this in
// plain words rather than naming CSS, because the model is being asked about
// a picture, not a stylesheet.
const PROMPT =
  'This photo will be shown in a wide, short frame that crops the top and bottom away.\n' +
  'Reply with ONE number from 0 to 100 and nothing else — no words, no percent sign.\n' +
  '0 keeps the TOP of the photo in frame. 100 keeps the BOTTOM. 50 is centred.\n' +
  'Choose the number that keeps the main subject in frame — a person or animal\'s ' +
  'face and head above all, and if the photo is of a document or clipping, the part ' +
  'that carries its meaning. When the subject already sits in the middle, answer 50.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!KEY) return json({});   // unconfigured → quiet no-op, photo keeps its default

  let body: { image?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const image = (body.image ?? '').trim();
  if (!image.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)) {
    return json({ error: 'Image must be a Lichen upload.' }, 400);
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'url', url: image } },
            { type: 'text', text: PROMPT },
          ],
        }],
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d?.error?.message ?? `Anthropic ${r.status}`);
    const text: string = d?.content?.[0]?.text ?? '';
    const m = text.match(/\d{1,3}/);
    if (!m) return json({});
    const pct = Math.min(100, Math.max(0, parseInt(m[0], 10)));
    return json({ pct });
  } catch (err) {
    console.error('image-focus error:', err);
    return json({});   // honest degrade — a photo never fails to upload over this
  }
});
