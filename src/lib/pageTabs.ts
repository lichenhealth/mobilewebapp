import type { IconName } from '../components/Icon';

/** The tab library (founder 2026-08-05: "create a bunch of tab options for
 *  people that most websites would use, and people can select those
 *  templates").
 *
 *  Two kinds:
 *  - BUILT-IN tabs render content Lichen already holds — your story, the
 *    offerings from your categories, your contact details. Nothing to write
 *    twice.
 *  - TEMPLATE tabs are the ones a website usually has and Lichen has no
 *    opinion about — Facilities, Hours, Pricing, FAQ. Picking one gives you a
 *    titled page with a lead line and body text to fill in.
 *
 *  A tab only appears on the page once it has something to show, so adding one
 *  is an invitation to write, never an empty room for a visitor to walk into. */

export interface TabTemplate {
  id: string;
  label: string;
  icon: IconName;
  /** What this tab is for, shown while choosing. */
  blurb: string;
  /** Built-ins draw on data elsewhere in Lichen; templates hold their own. */
  builtIn?: boolean;
  /** A first line, so nobody starts at a blank page. */
  starter?: string;
}

export const TAB_TEMPLATES: TabTemplate[] = [
  // ── Drawn from what Lichen already knows ────────────────────────────────
  { id: 'about', label: 'About', icon: 'info', builtIn: true,
    blurb: 'Your story — the one you’ve already written on your profile.' },
  { id: 'services', label: 'Services', icon: 'briefcase', builtIn: true,
    blurb: 'What you offer, kept in step with your categories automatically.' },
  { id: 'contact', label: 'Contact', icon: 'phone', builtIn: true,
    blurb: 'Address, hours, phone, email — plus what to bring and where to park.' },

  // ── The ones most websites have ─────────────────────────────────────────
  { id: 'facilities', label: 'Facilities', icon: 'location',
    blurb: 'The rooms, the land, the equipment — what people will actually find.',
    starter: 'What’s here, and what visitors can use.' },
  { id: 'hours', label: 'Hours', icon: 'calendar',
    blurb: 'When you’re open, and when you’re not.',
    starter: 'When we’re here.' },
  { id: 'pricing', label: 'Pricing', icon: 'dollar',
    blurb: 'Rates, packages, sliding scale — said plainly.',
    starter: 'What things cost, and what to do if that’s out of reach.' },
  { id: 'faq', label: 'FAQ', icon: 'chat',
    blurb: 'The questions you answer over and over.',
    starter: 'The things people ask most.' },
  { id: 'team', label: 'The people', icon: 'user-multiple',
    blurb: 'Who does the work — names, roles, a line each.',
    starter: 'Who you’ll be working with.' },
  { id: 'gallery', label: 'Gallery', icon: 'image',
    blurb: 'Photographs, with room to say what each one is.',
    starter: '' },
  { id: 'classes', label: 'Classes', icon: 'graduation-cap',
    blurb: 'What you teach, when it runs, and who it’s for.',
    starter: 'What we teach, and when.' },
  { id: 'menu', label: 'Menu', icon: 'fork-spoon',
    blurb: 'What’s served, and what it’s made from.',
    starter: 'What’s on offer.' },
  { id: 'stay', label: 'Stay', icon: 'plane',
    blurb: 'Lodging, retreats, what a night here is like.',
    starter: 'What staying here looks like.' },
  { id: 'land', label: 'The land', icon: 'leaf',
    blurb: 'The place itself — acreage, water, what grows, how it’s tended.',
    starter: 'The ground this all stands on.' },
  { id: 'story', label: 'How we started', icon: 'book',
    blurb: 'The longer telling — origins, lineage, what led here.',
    starter: 'How this began.' },
  { id: 'practice', label: 'The practice', icon: 'health',
    blurb: 'Your modality, training and lineage — what you actually do.',
    starter: 'How I work.' },
  { id: 'giving', label: 'Support us', icon: 'heart-line',
    blurb: 'How people can give, and what their giving does.',
    starter: 'What your support makes possible.' },
];

export const tabById = (id: string): TabTemplate | undefined =>
  TAB_TEMPLATES.find((t) => t.id === id);

/** A tab on someone's page: the template it came from, plus what they wrote. */
export interface PageTab {
  id: string;
  label?: string;      // renamed by the owner
  lead?: string;
  body?: string;
  href?: string;       // a tab that simply links out
}

/** Templates not already on the page — what "Add a tab" may offer. */
export const availableTemplates = (tabs: PageTab[]): TabTemplate[] => {
  const taken = new Set(tabs.map((t) => t.id));
  return TAB_TEMPLATES.filter((t) => !taken.has(t.id));
};

/** Does this tab have anything to show a visitor? Built-ins are judged by the
 *  data behind them, which only the page knows — so those answer true here and
 *  PublicPage decides. */
export const tabHasContent = (t: PageTab, tpl?: TabTemplate): boolean =>
  !!(tpl?.builtIn || t.body?.trim() || t.lead?.trim() || t.href);
