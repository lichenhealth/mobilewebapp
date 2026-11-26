// The open-web page of an "anyone with the link" doc (founder 2026-11-26:
// "how do I share this from the doc itself like i can on google?").
// GET ?t=<share_token>. The token IS the authorization; only a personal doc
// whose owner chose "Anyone with the link" answers. Pictures inside it are
// signed here for an hour (the open web can't sign private storage).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  let t = new URL(req.url).searchParams.get('t') ?? '';
  if (!t && req.method === 'POST') { try { t = String((await req.json())?.t ?? ''); } catch { /* */ } }
  if (!/^[0-9a-f]{20,64}$/i.test(t)) return json({ error: 'Not found' }, 404);
  const r = await fetch(`${SUPABASE_URL}/rest/v1/chat_docs?share_token=eq.${t}&chat_id=is.null&link_access=eq.anyone&select=id,kind,title,body,data,updated_at,created_by`, { headers: hdr });
  const d = ((await r.json()) ?? [])[0] as { id: string; kind: string; title: string; body: string | null; data: Record<string, unknown> | null; updated_at: string; created_by: string } | undefined;
  if (!d) return json({ error: 'Not found' }, 404);
  const p = ((await (await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${d.created_by}&select=full_name`, { headers: hdr })).json()) ?? [])[0] as { full_name?: string } | undefined;
  // Every picture reference the doc holds: data-store="drive/…" in a doc's
  // html, slide.image on slides.
  const refs = new Set<string>();
  const html = String((d.data ?? {}).html ?? '');
  for (const m of html.matchAll(/data-store="((?:drive|chat-media)\/[\w\-./]+)"/g)) refs.add(m[1]);
  for (const s of ((d.data ?? {}).slides as { image?: string }[] | undefined) ?? []) if (s.image && /^(drive|chat-media)\/[\w\-./]+$/.test(s.image)) refs.add(s.image);
  const imgs: Record<string, string> = {};
  const byBucket: Record<string, string[]> = {};
  for (const ref of refs) { if (ref.includes('..')) continue; const [b, ...rest] = ref.split('/'); (byBucket[b] ??= []).push(rest.join('/')); }
  for (const [bucket, paths] of Object.entries(byBucket)) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}`, { method: 'POST', headers: hdr, body: JSON.stringify({ expiresIn: 3600, paths }) });
    for (const x of ((await res.json().catch(() => [])) ?? []) as { path?: string; signedURL?: string }[]) {
      if (x.path && x.signedURL) imgs[`${bucket}/${x.path}`] = `${SUPABASE_URL}/storage/v1${x.signedURL}`;
    }
  }
  return json({ id: d.id, kind: d.kind, title: d.title, body: d.body, data: d.data, updated_at: d.updated_at, owner_name: p?.full_name ?? 'A Lichen member', imgs });
});
