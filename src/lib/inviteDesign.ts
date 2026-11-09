// THE INVITATION STUDIO (founder 2026-11-08: "Preview and edit should also be
// possible. The edit goes to a template to build out an invite. Create
// multiple templates. I like Paperless Post's UI and features… build out a
// pretty event/invite software package with parity to paperless post").
//
// An event's invitation design is DATA on its door-post (`details.invite`),
// never per-event code — the member-made-features-are-data doctrine. Three
// surfaces read it: the composer's live card, the guest page /e/ (with the
// envelope opening), and the emailed card (send-event-invite). The edge copy
// lives in supabase/functions/_shared/inviteDesign.ts — KEEP THE TWO IN STEP
// (the videoHosts pattern): same template ids, same colours, same fonts.

export type InviteFont = 'serif' | 'script' | 'modern' | 'classic';
export type InviteLiner = 'none' | 'dots' | 'stripes' | 'leaves' | 'stars' | 'confetti';

export interface InviteDesign {
  template: string;
  headline?: string;   // the eyebrow line — "You're invited"
  message?: string;    // the host's note under the title
  rsvp?: string;       // the button's words
  font?: InviteFont;
  accent?: string;     // hex — headline, ornaments, button
  paper?: string;      // hex — the card itself
  envelope?: string;   // hex — the envelope on the guest page
  liner?: InviteLiner; // the envelope's inner pattern
  photo?: boolean;     // wear the event's cover photo (default true)
  /** THE RSVP FORM (Paperless Post parity, 2026-11-08): what the reply asks. */
  form?: RsvpForm;
  /** Registry / gift / info links worn on the card — https only, ≤3. */
  links?: InviteLink[];
  /** The host's OWN uploaded card (our storage URL) — it IS the card. */
  artwork?: string;
  /** An animated backdrop behind the envelope on the guest page. */
  backdrop?: InviteBackdrop;
  /** TWO PHOTO SLOTS (founder 2026-11-09): `envPhoto` = the card's FRONT,
   *  seen as it slides out of the envelope (the family photo); `cardPhoto` =
   *  INSIDE the card with the details. (The storage key keeps its first name.)
   *  A URL from our storage, 'none' to empty the slot, or unset = the smart
   *  default (first photo inside, second on the front). */
  cardPhoto?: string;
  envPhoto?: string;
}

export interface RsvpForm {
  plusOnes?: number;      // how many extra guests each reply may bring (0 = none)
  meals?: string[];       // meal choices offered (empty = not asked)
  questions?: string[];   // custom questions, ≤5
  remind?: boolean;       // the automatic day-before reminder (default on)
}
export interface InviteLink { label: string; url: string }
export type InviteBackdrop = 'none' | 'confetti' | 'snow' | 'petals' | 'stars' | 'bubbles' | 'leaves';
export const INVITE_BACKDROPS: { id: InviteBackdrop; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'confetti', label: 'Confetti' }, { id: 'snow', label: 'Snow' },
  { id: 'petals', label: 'Petals' }, { id: 'stars', label: 'Twinkle' }, { id: 'bubbles', label: 'Bubbles' },
  { id: 'leaves', label: 'Falling leaves' },
];

export interface InviteTemplate {
  id: string;
  name: string;
  occasion: 'Celebrations' | 'Gatherings' | 'Seasonal' | 'Simple';
  headline: string;
  rsvp: string;
  font: InviteFont;
  accent: string;
  paper: string;
  ink: string;
  envelope: string;
  liner: InviteLiner;
  ornament: string;    // a typographic ornament worn above and below the title
  border: 'single' | 'double' | 'none' | 'inset';
}

export const INVITE_TEMPLATES: InviteTemplate[] = [
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

export const INVITE_FONTS: { id: InviteFont; label: string; css: string }[] = [
  { id: 'serif', label: 'Serif', css: "'Cormorant', 'Iowan Old Style', Georgia, serif" },
  { id: 'classic', label: 'Classic', css: "'Playfair Display', 'Didot', Georgia, serif" },
  { id: 'script', label: 'Script', css: "'Great Vibes', 'Snell Roundhand', 'Apple Chancery', cursive" },
  { id: 'modern', label: 'Modern', css: "'Archivo', 'Helvetica Neue', Helvetica, Arial, sans-serif" },
];

export const INVITE_ACCENTS = ['#C06B3E', '#D9573F', '#B65A6E', '#C9892B', '#5E7A4E', '#4A6E8C', '#7A5C9E', '#2B2B28', '#D8B46A'];
export const INVITE_PAPERS = ['#FFFFFF', '#FFFDF8', '#FFF8E7', '#FDF3F3', '#F3F5EC', '#F7EEE4', '#F4F7FA', '#1F2A3A', '#2B2B28'];
export const INVITE_ENVELOPES = ['#E8D9C4', '#F2C8B8', '#F1CFD3', '#F3DFA9', '#C9D3B7', '#CBD8E3', '#D9B79E', '#2E3B4F', '#FFFFFF'];
export const INVITE_LINERS: { id: InviteLiner; label: string }[] = [
  { id: 'none', label: 'Plain' }, { id: 'dots', label: 'Dots' }, { id: 'stripes', label: 'Stripes' },
  { id: 'leaves', label: 'Leaves' }, { id: 'stars', label: 'Stars' }, { id: 'confetti', label: 'Confetti' },
];

export const templateById = (id?: string): InviteTemplate =>
  INVITE_TEMPLATES.find((t) => t.id === id) ?? INVITE_TEMPLATES[0];

/** Dark paper reads light ink — derived, never a separate choice. */
export function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.45;
}

/** A design with every slot resolved — the template's choices unless the
 *  host changed them. One answer, every surface. */
export interface ResolvedInvite {
  template: InviteTemplate;
  headline: string; message: string; rsvp: string;
  fontCss: string; font: InviteFont;
  accent: string; paper: string; ink: string; inkSoft: string;
  envelope: string; liner: InviteLiner; photo: boolean;
  form: Required<RsvpForm>; links: InviteLink[]; artwork: string | null; backdrop: InviteBackdrop;
}

export function resolveInvite(d?: Partial<InviteDesign> | null): ResolvedInvite {
  const t = templateById(d?.template);
  const paper = d?.paper || t.paper;
  const dark = isDark(paper);
  const ink = d?.paper ? (dark ? '#F4EEDF' : '#2B2B28') : t.ink;
  const font = d?.font || t.font;
  return {
    template: t,
    headline: (d?.headline ?? t.headline).slice(0, 80),
    message: (d?.message ?? '').slice(0, 600),
    rsvp: (d?.rsvp || t.rsvp).slice(0, 40),
    font, fontCss: (INVITE_FONTS.find((f) => f.id === font) ?? INVITE_FONTS[0]).css,
    accent: d?.accent || t.accent, paper, ink,
    inkSoft: dark ? 'rgba(244,238,223,0.75)' : 'rgba(43,43,40,0.68)',
    envelope: d?.envelope || t.envelope,
    liner: d?.liner || t.liner,
    photo: d?.photo !== false,
    form: {
      plusOnes: clampInt(d?.form?.plusOnes, 0, 20),
      meals: cleanList(d?.form?.meals, 8, 60),
      questions: cleanList(d?.form?.questions, 5, 200),
      remind: d?.form?.remind !== false,
    },
    links: cleanLinks(d?.links),
    artwork: isOurImage(d?.artwork) ? d!.artwork! : null,
    backdrop: INVITE_BACKDROPS.some((b) => b.id === d?.backdrop) ? d!.backdrop! : 'none',
  };
}

const clampInt = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : lo;
function cleanList(v: unknown, max: number, len: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const t = typeof x === 'string' ? x.trim().slice(0, len) : '';
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}
export function cleanLinks(v: unknown): InviteLink[] {
  if (!Array.isArray(v)) return [];
  const out: InviteLink[] = [];
  for (const x of v) {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url.trim() : '';
    if (!/^https:\/\/[^\s<>"]+$/i.test(url) || url.length > 500) continue;
    out.push({ label: (typeof o.label === 'string' ? o.label.trim().slice(0, 40) : '') || 'Registry', url });
    if (out.length >= 3) break;
  }
  return out;
}
/** An uploaded card lives in our own public storage — never a hotlink. */
export function isOurImage(v: unknown): v is string {
  return typeof v === 'string' && /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\//i.test(v);
}

/** Normalize anything that came off a post's details into a design (or null). */
export function readInvite(raw: unknown): InviteDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const hex = (v: unknown) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
  return {
    template: templateById(typeof r.template === 'string' ? r.template : undefined).id,
    headline: str(r.headline, 80), message: str(r.message, 600), rsvp: str(r.rsvp, 40),
    font: INVITE_FONTS.some((f) => f.id === r.font) ? (r.font as InviteFont) : undefined,
    accent: hex(r.accent), paper: hex(r.paper), envelope: hex(r.envelope),
    liner: INVITE_LINERS.some((l) => l.id === r.liner) ? (r.liner as InviteLiner) : undefined,
    photo: r.photo === false ? false : undefined,
    form: readForm(r.form),
    links: (() => { const l = cleanLinks(r.links); return l.length ? l : undefined; })(),
    artwork: isOurImage(r.artwork) ? r.artwork : undefined,
    backdrop: INVITE_BACKDROPS.some((b) => b.id === r.backdrop) && r.backdrop !== 'none' ? (r.backdrop as InviteBackdrop) : undefined,
    cardPhoto: r.cardPhoto === 'none' || isOurImage(r.cardPhoto) ? (r.cardPhoto as string) : undefined,
    envPhoto: r.envPhoto === 'none' || isOurImage(r.envPhoto) ? (r.envPhoto as string) : undefined,
  };
}

/** WHERE THE PHOTOS GO — one answer for every surface. An explicit choice
 *  wins ('none' empties the slot); otherwise the smart default: the first
 *  photo dresses the card, a second one dresses the envelope's outside. */
export function invitePhotos(d: Partial<InviteDesign> | null | undefined, photos: string[]): { card: string | null; env: string | null } {
  const pick = (v: string | undefined) => (v === 'none' ? null : isOurImage(v) ? v : undefined);
  const cardSet = pick(d?.cardPhoto);
  const card = d?.photo === false ? null : cardSet !== undefined ? cardSet : photos[0] ?? null;
  const envSet = pick(d?.envPhoto);
  const env = envSet !== undefined ? envSet : photos.find((p) => p !== card) && photos.length > 1 ? photos.find((p) => p !== card)! : null;
  return { card, env };
}

function readForm(v: unknown): RsvpForm | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const f = v as Record<string, unknown>;
  const out: RsvpForm = {};
  const p = clampInt(f.plusOnes, 0, 20); if (p) out.plusOnes = p;
  const m = cleanList(f.meals, 8, 60); if (m.length) out.meals = m;
  const q = cleanList(f.questions, 5, 200); if (q.length) out.questions = q;
  if (f.remind === false) out.remind = false;
  return Object.keys(out).length ? out : undefined;
}

/** Does the reply ask anything beyond going / maybe / can't? */
export const formAsks = (f: Required<RsvpForm>) => f.plusOnes > 0 || f.meals.length > 0 || f.questions.length > 0;

/** The envelope liner as a CSS background (guest page + studio swatches). */
export function linerCss(l: InviteLiner, accent: string): string {
  const a = accent;
  switch (l) {
    case 'dots': return `radial-gradient(${a}55 1.6px, transparent 1.8px) 0 0 / 14px 14px`;
    case 'stripes': return `repeating-linear-gradient(135deg, ${a}40 0 6px, transparent 6px 14px)`;
    case 'leaves': return `radial-gradient(ellipse 5px 9px at 50% 50%, ${a}50 60%, transparent 62%) 0 0 / 22px 22px, radial-gradient(ellipse 5px 9px at 50% 50%, ${a}35 60%, transparent 62%) 11px 11px / 22px 22px`;
    case 'stars': return `radial-gradient(${a}70 1.2px, transparent 1.4px) 0 0 / 18px 18px, radial-gradient(${a}45 2px, transparent 2.2px) 9px 9px / 18px 18px`;
    case 'confetti': return `radial-gradient(#D9573F 2px, transparent 2.4px) 0 0 / 23px 19px, radial-gradient(#C9892B 2px, transparent 2.4px) 7px 11px / 29px 23px, radial-gradient(#5E7A4E 1.8px, transparent 2.2px) 15px 4px / 19px 27px, radial-gradient(#4A6E8C 1.8px, transparent 2.2px) 3px 17px / 31px 21px`;
    default: return 'none';
  }
}
