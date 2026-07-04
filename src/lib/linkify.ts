// URL detection for care-post bodies — turns pasted links into clickable text
// and feeds the rich-preview resolver. Matches http(s):// and bare www. hosts;
// trims trailing sentence punctuation so "see https://x.com." doesn't include
// the period.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}'"])/gi;

export type Segment = { text: string } | { url: string };

/** Split text into plain + url segments (in order) for inline rendering. */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i) });
    out.push({ url: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Normalize a matched link to a valid href (bare www. → https://). */
export function hrefFor(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Unique, normalized URLs found in a body of text. */
export function parseBodyUrls(text: string): string[] {
  const urls = [...text.matchAll(URL_RE)].map((m) => hrefFor(m[0]));
  return [...new Set(urls)];
}

/** What kind of place is an event's location? A video-call link (Zoom, Meet…),
 *  some other URL, or a physical address (→ Google Maps directions). */
export type LocationInfo =
  | { type: 'video'; service: string; url: string }
  | { type: 'link'; url: string }
  | { type: 'address'; mapsUrl: string };

const VIDEO_HOSTS: [RegExp, string][] = [
  [/(^|\.)zoom\.us$/, 'Zoom'],
  [/^meet\.google\.com$/, 'Google Meet'],
  [/(^|\.)teams\.microsoft\.com$/, 'Microsoft Teams'],
  [/(^|\.)whereby\.com$/, 'Whereby'],
  [/(^|\.)webex\.com$/, 'Webex'],
];

export function locationInfo(loc: string): LocationInfo | null {
  const t = loc.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) {
    const url = hrefFor(t);
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      for (const [re, service] of VIDEO_HOSTS) if (re.test(host)) return { type: 'video', service, url };
    } catch { /* not parseable — treat as plain link */ }
    return { type: 'link', url };
  }
  return { type: 'address', mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}` };
}

/** YouTube video id from watch / youtu.be / shorts / embed / live URLs, else null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(hrefFor(url));
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v');
      const m = u.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}
