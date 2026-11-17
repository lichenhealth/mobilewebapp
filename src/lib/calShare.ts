// THE ONE WORDING FOR A SHARED CALENDAR (founder 2026-11-15). Twin of
// supabase/functions/_shared/calShare.ts — keep the two in step. What the recipient can see,
// said plainly, so the brain, the card, the settings and the email agree.
export const FEED_BASE = 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/calendar-feed?t=';

export function seesLine(detail: string): string {
  return detail === 'busy'
    ? 'only when I\'m busy — times, no titles, places or notes'
    : 'the events on my Lichen calendar — titles, times, places and notes, including ones I\'m going to or invited to';
}

/** The short "you'll see" (founder 2026-11-17: the messages were "too clunky
 *  and wordy"). The full detail lives on the card and in the Brain's replies. */
export function seesShort(detail: string, whose = 'my'): string {
  const own = whose === 'my';
  return detail === 'busy'
    ? `when ${own ? "I'm" : whose + ' is'} busy (no details)`
    : `${own ? 'my' : whose + "'s"} events and their details`;
}

const GOOGLE_STEP = 'Google Calendar (on a computer): Other calendars + → From URL → paste the link.';

export function shareMessage(ownerFirst: string, detail: string, url: string): string {
  return [
    `Here's my Lichen calendar — add it to yours and you'll see ${seesShort(detail)}.`,
    ``,
    url,
    ``,
    GOOGLE_STEP,
    ``,
    `— ${ownerFirst}`,
  ].join('\n');
}

/** «FIRST»'S BRAIN SENDS IT — the ONE wording, shared by the card's preview and
 *  the brain-errand fn so what the member reads is exactly what goes out.
 *  The INTRO is fixed (every Brain message says what it is — the member can't
 *  edit it away); the BODY is the editable part. Short on purpose: the Brain
 *  walks them through anything more when they reply. */
export function brainShareIntro(themFirst: string, ownerFirst: string): string {
  return `Hi ${themFirst} — this is ${ownerFirst}'s Brain (the AI assistant ${ownerFirst} uses on Lichen).`;
}
export function brainShareBody(ownerFirst: string, detail: string, _url: string): string {
  // ONE TAP, NOT A TUTORIAL (founder 2026-11-17: "can't we just have his
  // assistant do it for him?"): the link + add buttons ride the message as a
  // calendar card, so the words just say what it is.
  return `Here's ${ownerFirst}'s Lichen calendar — tap a button below to add it to your Google, Apple or Lichen calendar, and you'll see ${seesShort(detail, ownerFirst)}.\n\nStuck? Reply here and I'll help.`;
}

/** One-tap adds: Google's own "Add this calendar?" screen (cid=) and Apple's
 *  subscribe sheet (webcal:). The final confirm is the person's, on their
 *  calendar's own screen — Lichen can't (and shouldn't) click it for them. */
export function oneTapLinks(url: string): { google: string; apple: string } {
  const webcal = url.replace(/^https?:/, 'webcal:');
  return { google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`, apple: webcal };
}
