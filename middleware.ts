// THE FRONT DOOR (founder 2026-08-28).
//
// Vercel checks the FILESYSTEM before it applies rewrites, and "/" resolves
// to the real index.html — so a rewrite on "/" can never fire, however it is
// written. countrymanstables.com/lessons got its real <title> from
// api/page.ts; countrymanstables.com itself — the one URL Google indexes and
// the barn hands out — was the only page on the site still wearing Lichen's
// generic shell title. A host-matched "/" rewrite was tried first and was
// silently dead; this replaces it.
//
// Middleware runs BEFORE routing, which is the only layer that can get in
// front of a real file. Everything else is untouched: api/page returns the
// same shell with meta patched in, React still boots.
import { rewrite, next } from '@vercel/edge';
import { spaceHandleForHost } from './src/lib/customDomain';

export const config = {
  // ONLY the bare root. Every other path already reaches api/page through
  // the handle rewrite in vercel.json, and a matcher of "/(.*)" would put an
  // extra hop in front of every static asset on every request.
  matcher: '/',
};

export default function middleware(req: Request) {
  const url = new URL(req.url);
  // Lichen's own domains keep their behaviour untouched — on lichen.health
  // "/" is a redirect to the static /welcome/ page.
  if (!spaceHandleForHost(url.hostname)) return next();
  // api/page reads the HOST, not the path, to decide whose site this is, and
  // forces canonical to the domain root — so the rewritten pathname being
  // /api/page changes nothing.
  return rewrite(new URL('/api/page', url));
}
