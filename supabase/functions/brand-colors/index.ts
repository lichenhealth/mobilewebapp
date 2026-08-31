// Supabase Edge Function: brand-colors
//
// "A smart way for the website to re-do the public facing page with their
// color scheme" (founder 2026-08-28). Countryman Stables' logo is a dark red
// wordmark; the page was wearing Lichen's peach. The colours a business
// already owns are sitting in the file they uploaded — so read them.
//
// Returns an accent hex and which of three named grounds the logo sits best
// on — a scheme, not a palette. Still no more than that: the page has one
// accent slot and three possible grounds, so anything richer would invite a
// UI asking an owner to assign colours to things.
//
// The whole answer is a PROPOSAL the owner previews and accepts or refuses
// (founder 2026-08-28: "let them preview it to decide if they like it"), and
// the client re-checks contrast and will deepen the accent — this function
// is a suggestion, never an authority.
//
// Auth: verify_jwt (members only). Images must live in OUR storage — the
// function refuses to fetch arbitrary URLs (same guard as style-tags and
// image-focus; an image URL is a fetch this server makes).
// Secrets: ANTHROPIC_API_KEY (already set). Model: BRAND_COLORS_MODEL.

const KEY = (Deno.env.get('ANTHROPIC_API_KEY') ?? '').replace(/[^\x21-\x7E]/g, '');
const MODEL = Deno.env.get('BRAND_COLORS_MODEL') ?? 'claude-haiku-4-5-20251001';
const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');

import { readBrandScheme } from '../_shared/brandColors.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!KEY) return json({});   // unconfigured → quiet no-op, page keeps its accent

  let body: { image?: string };
  try { body = await req.json(); } catch { return json({ error: 'Invalid body' }, 400); }
  const image = (body.image ?? '').trim();
  if (!image.startsWith(`${SUPABASE_URL}/storage/v1/object/public/`)) {
    return json({ error: 'Image must be a Lichen upload.' }, 400);
  }

  const scheme = await readBrandScheme(image, KEY, MODEL);
  if (!scheme) return json({});   // honest degrade — the page keeps its colours
  return json(scheme);
});
