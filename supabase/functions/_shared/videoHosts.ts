// The video services Lichen recognizes, for edge functions (booking emails'
// Join button, the calendar assistant's setup read). A copy of VIDEO_HOSTS in
// src/lib/linkify.ts — the app's own list — keep the two in step.

const VIDEO_HOSTS: [RegExp, string][] = [
  [/(^|\.)zoom\.(us|com)$/, 'Zoom'],
  [/^meet\.google\.com$/, 'Google Meet'],
  [/(^|\.)teams\.(microsoft|live)\.com$/, 'Microsoft Teams'],
  [/(^|\.)whereby\.com$/, 'Whereby'],
  [/(^|\.)webex\.com$/, 'Webex'],
  [/^meet\.jit\.si$/, 'Jitsi'],
  [/^facetime\.apple\.com$/, 'FaceTime'],
  [/(^|\.)gotomeet(ing)?\.(com|me)$/, 'GoTo Meeting'],
  [/(^|\.)doxy\.me$/, 'Doxy.me'],
  [/(^|\.)skype\.com$/, 'Skype'],
];

/** "Zoom", "Google Meet"… for a video link, or null for any other host. */
export function videoServiceOf(url: string): string | null {
  try {
    const raw = url.trim();
    const host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
      .hostname.replace(/^www\./, '').toLowerCase();
    for (const [re, svc] of VIDEO_HOSTS) if (re.test(host)) return svc;
  } catch { /* not a URL */ }
  return null;
}
