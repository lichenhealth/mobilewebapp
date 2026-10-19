import { markPrompt } from './promptsApi';

/* THE WALKTHROUGH (founder 2026-10-19: "a walk through of the platform with
 * Claude as the assistant — kinda like clippy the paperclip, instead of
 * dropping you into the Ai chat, without knowing how you got there, but the
 * focus is on the area of the platform you want to get set up with"):
 * after onboarding, a chosen path lands on the REAL screens with a floating
 * Claude companion stepping through them — deterministic templated steps
 * (no model call; the "Ask me" door on every step opens the real
 * conversation), active state per device, completion marked per MEMBER via
 * member_prompts (`guide-<path>`) so finishing once is finishing forever.
 * A CLIENT keeps the guided intake — that flow IS their walkthrough. */

export type GuidePath = 'practitioner' | 'community';

export interface GuideStep {
  route: string;      // the real screen this step stands on (Next walks there)
  title: string;
  body: string;
  ask: string;        // the prefilled (unsent) ask behind "Ask me to do it"
  /** This step carries a teaching another prompt would otherwise pop for —
   *  reaching it marks that prompt fully taught (founder 2026-10-19: the
   *  candle bubble over the tour card read as two popups at once, so the
   *  candle is a STEP on the journey now, and PresencePrompt holds off
   *  while a tour is live). */
  teaches?: 'presence';
}

export const GUIDES: Record<GuidePath, GuideStep[]> = {
  practitioner: [
    {
      route: '/caregiver',
      title: 'Your Provider dashboard',
      body: 'Your clients gather here. Add your first client right on this screen — type their name, or invite them by email or phone.',
      ask: 'Help me add my first client to my care team.',
    },
    {
      route: '/calendar/settings',
      title: 'Sessions & hours',
      body: 'Where your practice takes shape: session types people can book, your hours, and a booking link that works even outside Lichen. Set it up here — or just tell me what you offer and I’ll build it.',
      ask: 'Set up my session types and hours with me — ask me what you need to know.',
    },
    {
      route: '/profile',
      title: 'Your profile & public page',
      body: 'Who you are on Lichen — and, if you like, a public page on the open web where clients can find and book you.',
      ask: 'Help me fill out my profile and public page.',
    },
    {
      route: '/profile',
      title: 'Your candle',
      body: 'The candle at the top is your light — lit means you’re present and open to connecting. Nothing ever shows you’re merely online, and no timestamps follow you. Tap it any time to blow it out and work quietly; tap again to relight.',
      ask: 'Explain presence on Lichen — when should I keep my candle lit?',
      teaches: 'presence',
    },
    {
      route: '/caregiver',
      title: 'That’s the loop',
      body: 'Clients in Concierge, sessions in Calendar, your story in Profile. I’m always behind the brain icon at the top of every section — ask me anything, or ask me to do it for you.',
      ask: 'What should I do next as a new practitioner on Lichen?',
    },
  ],
  community: [
    {
      route: '/home',
      title: 'Home — the river',
      body: 'What your network shares flows here. The icons filter the feed by section; search, post and my brain live in the row up top.',
      ask: 'Show me around Home — what am I looking at?',
    },
    {
      route: '/directory',
      title: 'The Directory',
      body: 'Everyone on Lichen — people, organizations, communities, groups and places. Weave whoever resonates into your own web, your My-celium.',
      ask: 'How do I build my web of people here?',
    },
    {
      route: '/directory',
      title: 'Your candle',
      body: 'The candle at the top is your light — lit means you’re present and open to connecting. Nothing ever shows you’re merely online, and no timestamps follow you. Tap it any time to blow it out and browse quietly; tap again to relight.',
      ask: 'Explain presence on Lichen — when should I keep my candle lit?',
      teaches: 'presence',
    },
    {
      route: '/market',
      title: 'The Marketplace',
      body: 'Give, trade, lend, rent or sell — goods and services move here by reciprocity. Your first offering can be anything you’d share.',
      ask: 'Help me create my first Marketplace offering.',
    },
    {
      route: '/profile',
      title: 'Your profile',
      body: 'Tell the network who you are — and publish a public page to the open web if you like. That’s the heart of it. I’m always behind the brain icon, in every section.',
      ask: 'Help me fill out my profile.',
    },
  ],
};

const KEY = 'lichen.guide';
const EVT = 'lichen:guide';

export interface GuideState { path: GuidePath; step: number }

function announce() { window.dispatchEvent(new Event(EVT)); }

export function readGuide(): GuideState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as GuideState;
    if ((s.path !== 'practitioner' && s.path !== 'community') || !GUIDES[s.path][s.step]) return null;
    return s;
  } catch { return null; }
}

export function startGuide(path: GuidePath): void {
  try { localStorage.setItem(KEY, JSON.stringify({ path, step: 0 })); } catch { /* storage off */ }
  announce();
}

export function setGuideStep(path: GuidePath, step: number): void {
  try { localStorage.setItem(KEY, JSON.stringify({ path, step })); } catch { /* ignore */ }
  announce();
}

/** Done or dismissed — the tour never returns for this member. */
export function endGuide(me: string | null | undefined, path: GuidePath): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  if (me) void markPrompt(me, 'guide-' + path);
  announce();
}

export function onGuideChange(fn: () => void): () => void {
  window.addEventListener(EVT, fn);
  return () => window.removeEventListener(EVT, fn);
}
