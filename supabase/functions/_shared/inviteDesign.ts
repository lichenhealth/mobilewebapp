// THE INVITATION STUDIO — edge twin of src/lib/inviteDesign.ts (founder
// 2026-11-08, Paperless Post parity). KEEP THE TWO IN STEP: same template
// ids, colours and fonts. Used by send-event-invite to dress the emailed
// card the way the host designed it. Email-safe: tables of inline styles,
// web fonts linked with honest fallbacks (Gmail shows the fallback serif).

type InviteFont = 'serif' | 'script' | 'modern' | 'classic';
interface InviteTemplate {
  id: string; name: string; occasion: string; headline: string; rsvp: string; font: InviteFont;
  accent: string; paper: string; ink: string; envelope: string; liner: string; ornament: string;
  border: 'single' | 'double' | 'none' | 'inset';
}
const TEMPLATES = [
  { id: 'classic', name: 'Classic', occasion: 'Simple', headline: 'You’re invited', rsvp: 'RSVP',
    font: 'serif', accent: '#C06B3E', paper: '#FFFDF8', ink: '#2B2B28', envelope: '#E8D9C4', liner: 'none', ornament: '', border: 'single' },
  { id: 'garden', name: 'Garden party', occasion: 'Gatherings', headline: 'Join us in the garden', rsvp: 'RSVP',
    font: 'serif', accent: '#5E7A4E', paper: '#F3F5EC', ink: '#2F3A2A', envelope: '#C9D3B7', liner: 'leaves', ornament: '❦', border: 'double' },
  { id: 'celebration', name: 'Celebration', occasion: 'Celebrations', headline: 'Let’s celebrate', rsvp: 'Count me in',
    font: 'modern', accent: '#D9573F', paper: '#FFFFFF', ink: '#232323', envelope: '#F2C8B8', liner: 'confetti', ornament: '✦ ✦ ✦', border: 'none' },
  { id: 'birthday', name: 'Birthday', occasion: 'Celebrations', headline: 'A birthday celebration', rsvp: 'RSVP',
    font: 'script', accent: '#C9892B', paper: '#FFF8E7', ink: '#3A3125', envelope: '#F3DFA9', liner: 'stars', ornament: '✶', border: 'inset' },
  { id: 'evening', name: 'Evening', occasion: 'Gatherings', headline: 'The pleasure of your company', rsvp: 'Kindly reply',
    font: 'classic', accent: '#D8B46A', paper: '#1F2A3A', ink: '#F4EEDF', envelope: '#2E3B4F', liner: 'stripes', ornament: '◆', border: 'double' },
  { id: 'minimal', name: 'Minimal', occasion: 'Simple', headline: 'Save the date', rsvp: 'RSVP',
    font: 'modern', accent: '#2B2B28', paper: '#FFFFFF', ink: '#2B2B28', envelope: '#E9E6E0', liner: 'none', ornament: '—', border: 'none' },
  { id: 'earth', name: 'Earth & clay', occasion: 'Gatherings', headline: 'Gather with us', rsvp: 'I’ll be there',
    font: 'serif', accent: '#A4553A', paper: '#F7EEE4', ink: '#3B2A22', envelope: '#D9B79E', liner: 'dots', ornament: '❋', border: 'inset' },
  { id: 'blush', name: 'Blush', occasion: 'Celebrations', headline: 'You’re warmly invited', rsvp: 'RSVP',
    font: 'script', accent: '#B65A6E', paper: '#FDF3F3', ink: '#3A2A2E', envelope: '#F1CFD3', liner: 'dots', ornament: '♡', border: 'single' },
  { id: 'harvest', name: 'Harvest', occasion: 'Seasonal', headline: 'A harvest gathering', rsvp: 'RSVP',
    font: 'classic', accent: '#B5651D', paper: '#FBF4E6', ink: '#3A2B1A', envelope: '#E6C79A', liner: 'leaves', ornament: '❧', border: 'double' },
  { id: 'winter', name: 'Winter light', occasion: 'Seasonal', headline: 'Celebrate the season', rsvp: 'RSVP',
    font: 'serif', accent: '#4A6E8C', paper: '#F4F7FA', ink: '#22303C', envelope: '#CBD8E3', liner: 'stars', ornament: '❄', border: 'single' },
];

const FONTS: Record<InviteFont, string> = {
  serif: "'Cormorant','Iowan Old Style',Georgia,'Times New Roman',serif",
  classic: "'Playfair Display',Didot,Georgia,serif",
  script: "'Great Vibes','Snell Roundhand','Apple Chancery',cursive",
  modern: "Archivo,'Helvetica Neue',Helvetica,Arial,sans-serif",
};

const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
function isDark(h: string): boolean {
  const n = parseInt(h.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255 < 0.45;
}

export interface ResolvedInvite {
  id: string; headline: string; message: string; rsvp: string; font: InviteFont; fontCss: string;
  accent: string; paper: string; ink: string; soft: string; ornament: string; border: string; photo: boolean; cardPhoto: string | null | undefined;
  artwork: string | null; links: { label: string; url: string }[];
}

/** Resolve whatever sits in posts.details.invite (or a test payload). */
export function resolveInvite(raw: unknown): ResolvedInvite {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const t = TEMPLATES.find((x) => x.id === r.template) ?? TEMPLATES[0];
  const paper = hex(r.paper) ?? t.paper;
  const dark = isDark(paper);
  const font = (['serif', 'script', 'modern', 'classic'] as InviteFont[]).includes(r.font as InviteFont) ? r.font as InviteFont : t.font;
  return {
    id: t.id,
    headline: str(r.headline, 80) ?? t.headline,
    message: str(r.message, 600) ?? '',
    rsvp: (str(r.rsvp, 40) || t.rsvp),
    font, fontCss: FONTS[font],
    accent: hex(r.accent) ?? t.accent,
    paper, ink: hex(r.paper) ? (dark ? '#F4EEDF' : '#2B2B28') : t.ink,
    soft: dark ? '#CFC8B8' : '#5A554C',
    ornament: t.ornament, border: t.border,
    photo: r.photo !== false,
    // The card's own photo slot (client twin: invitePhotos) — null = the host
    // emptied it, undefined = the smart default (the event's first photo).
    cardPhoto: r.cardPhoto === 'none' ? null : (artworkUrl(r.cardPhoto) ?? undefined),
    artwork: artworkUrl(r.artwork),
    links: readLinks(r.links),
  };
}

/** An uploaded card is ONLY ever our own public storage — never a hotlink. */
function artworkUrl(v: unknown): string | null {
  const base = (Deno.env.get('SUPABASE_URL') ?? '') + '/storage/v1/object/public/';
  return typeof v === 'string' && base.length > 30 && v.startsWith(base) ? v.slice(0, 600) : null;
}
/** The registry / gift / info links — https only, three at most. */
function readLinks(v: unknown): { label: string; url: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { label: string; url: string }[] = [];
  for (const x of v) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!/^https:\/\/[^\s<>"]+$/i.test(url) || url.length > 500) continue;
    const label = (typeof o.label === 'string' ? o.label.trim().slice(0, 40) : '') || 'Registry';
    out.push({ label, url });
    if (out.length >= 3) break;
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The emailed card in the host's design. `eyebrow`/`cta` override the
 *  design's own words for non-invitation mails ("You're in"). */
export function inviteCardHtml(design: unknown, o: {
  title: string; when: string; where: string; hostName: string; link: string; photo: string | null;
  fine: string; eyebrow?: string; cta?: string;
}): string {
  const d = resolveInvite(design);
  const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' });
  const eyebrow = o.eyebrow ?? d.headline;
  const cta = o.cta ?? d.rsvp;
  const scriptEye = d.font === 'script';
  const frame = d.border === 'double' ? `border:3px double ${d.accent};`
    : d.border === 'single' ? `border:1px solid ${d.accent}55;`
    : d.border === 'inset' ? `border:1px solid ${d.accent}88;` : '';
  const titleStyle = `font-family:${d.fontCss};font-size:${d.font === 'script' ? 40 : 32}px;font-weight:${d.font === 'modern' ? 600 : 400};${d.font === 'classic' ? 'font-style:italic;' : ''}line-height:1.15;margin:0 0 12px;color:${d.ink}`;
  const confetti = d.id === 'celebration'
    ? `<div style="height:14px;line-height:14px;font-size:14px;letter-spacing:6px;text-align:center;padding-top:14px"><span style="color:#D9573F">●</span> <span style="color:#C9892B">●</span> <span style="color:#5E7A4E">●</span> <span style="color:#4A6E8C">●</span> <span style="color:#D9573F">●</span> <span style="color:#C9892B">●</span></div>`
    : '';
  const links = d.links.length
    ? `<p style="margin:0 0 16px">${d.links.map((l) => `<a href="${esc(l.url)}" style="display:inline-block;margin:0 4px 6px;padding:7px 14px;border:1px solid ${d.accent};border-radius:999px;color:${d.accent};text-decoration:none;font-size:13px">${esc(l.label)}</a>`).join('')}</p>`
    : '';
  // AN UPLOADED CARD (the host's own artwork) IS the card: the image leads
  // whole, the event's facts ride below it in plain type, then the button.
  const artCard = d.artwork ? `
    <div style="background:#ffffff;border-radius:16px;overflow:hidden;margin:0 0 22px;box-shadow:0 10px 30px rgba(42,51,56,0.10);border:1px solid #e6e1d8">
      <img src="${esc(d.artwork)}" alt="${esc(o.title)}" width="520" style="display:block;width:100%;height:auto">
      <div style="padding:20px 22px 24px;text-align:center">
        <p style="font-size:16px;font-weight:600;margin:0 0 4px;color:#2b2b28">${esc(o.title)}</p>
        <p style="font-size:14px;color:#5a554c;margin:0 0 2px">${esc(o.when)}</p>
        ${o.where ? `<p style="font-size:14px;color:#5a554c;margin:0 0 2px">${esc(o.where)}</p>` : ''}
        <p style="font-size:13px;color:#5a554c;margin:8px 0 16px">Hosted by <strong>${esc(o.hostName)}</strong></p>
        ${links}
        <a href="${o.link}" style="display:inline-block;background:${d.accent};color:#ffffff;text-decoration:none;padding:12px 26px;border-radius:999px;font-weight:600">${esc(cta)}</a>
      </div>
    </div>` : '';
  return `<!doctype html><html><head><meta name="color-scheme" content="light only">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant:wght@400;500&family=Great+Vibes&family=Playfair+Display:ital@0;1&display=swap" rel="stylesheet"></head>
  <body style="margin:0;background:#f3efe9;font-family:Archivo,Helvetica,Arial,sans-serif;color:#2b2b28">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="font-size:22px;font-weight:600;margin:0 0 14px">Lichen</p>
    ${artCard || `<div style="background:${d.paper};border-radius:16px;overflow:hidden;margin:0 0 22px;box-shadow:0 10px 30px rgba(42,51,56,0.10);border:1px solid #e6e1d8">
      ${(() => { const ph = !d.photo ? null : d.cardPhoto === undefined ? o.photo : d.cardPhoto; return ph ? `<img src="${esc(ph)}" alt="" width="520" style="display:block;width:100%;max-height:300px;object-fit:cover">` : ''; })()}
      ${confetti}
      <div style="padding:${frame ? '14px' : '0'}">
      <div style="${frame}border-radius:8px;padding:30px 22px 24px;text-align:center">
        ${d.ornament ? `<p style="font-size:18px;letter-spacing:6px;color:${d.accent};margin:0 0 8px">${esc(d.ornament)}</p>` : ''}
        <p style="font-family:${d.fontCss};font-size:${scriptEye ? 26 : 12}px;letter-spacing:${scriptEye ? 0 : 0.16}em;${scriptEye ? '' : 'text-transform:uppercase;'}color:${d.accent};margin:0 0 10px">${esc(eyebrow)}</p>
        <p style="${titleStyle}">${esc(o.title)}</p>
        <p style="font-size:15px;color:${d.ink};margin:0 0 4px">${esc(o.when)}</p>
        ${o.where ? `<p style="font-size:14px;color:${d.soft};margin:0 0 4px">${esc(o.where)}</p>` : ''}
        ${d.message ? `<p style="font-size:15px;line-height:1.6;color:${d.soft};margin:14px auto 0;max-width:380px;white-space:pre-wrap">${esc(d.message)}</p>` : ''}
        <p style="font-size:14px;color:${d.soft};margin:14px 0 18px">Hosted by <strong style="color:${d.ink}">${esc(o.hostName)}</strong></p>
        ${links}
        <a href="${o.link}" style="display:inline-block;background:${d.accent};color:${d.paper};text-decoration:none;padding:12px 26px;border-radius:999px;font-weight:600">${esc(cta)}</a>
      </div></div>
    </div>`}
    <p style="font-size:13px;color:#8a857c;line-height:1.5;margin:0 0 6px">${o.fine}</p>
    <p style="font-size:11px;color:#b5b0a6;margin:10px 0 0">Sent ${esc(stamp)} MT</p>
  </div></body></html>`;
}
