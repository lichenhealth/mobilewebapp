// THE ONE WORDING FOR A SHARED CALENDAR (founder 2026-11-15). Twin of
// src/lib/calShare.ts — keep the two in step. What the recipient can see,
// said plainly, so the brain, the card, the settings and the email agree.
export const FEED_BASE = 'https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/calendar-feed?t=';

export function seesLine(detail: string): string {
  return detail === 'busy'
    ? 'only when I\'m busy — times, no titles, places or notes'
    : 'the events on my Lichen calendar — titles, times, places and notes, including ones I\'m going to or invited to';
}

export function shareMessage(ownerFirst: string, detail: string, url: string): string {
  return [
    `Here's my Lichen calendar, so you can see it in your own calendar.`,
    ``,
    url,
    ``,
    `To add it in Google Calendar: on a computer open calendar.google.com, then Other calendars (+) → From URL, paste the link, and Add calendar. (Apple: File → New Calendar Subscription. Outlook: Add calendar → Subscribe from web.)`,
    ``,
    `You'll see ${seesLine(detail)}. Anything I've marked private stays off it, my to-dos and care plan aren't included, and it updates on Google's schedule (often every 12–24 hours).`,
    ``,
    `— ${ownerFirst}`,
  ].join('\n');
}

/** «FIRST»'S BRAIN SENDS IT — the ONE wording, shared by the card's preview and
 *  the brain-errand fn so what the member reads is exactly what goes out.
 *  The INTRO is fixed (every Brain message says what it is — the member can't
 *  edit it away); the BODY is the editable part. */
export function brainShareIntro(themFirst: string, ownerFirst: string): string {
  return `Hi ${themFirst} — this is ${ownerFirst}'s Brain, the AI assistant ${ownerFirst} uses on Lichen, writing on ${ownerFirst}'s behalf.`;
}
export function brainShareBody(ownerFirst: string, detail: string, url: string): string {
  // The share wording is the owner's first person; the Brain speaks ABOUT them.
  const shared = shareMessage(ownerFirst, detail, url).replace(/\n\n— .*$/s, '')
    .replace("Here's my Lichen calendar", `Here's ${ownerFirst}'s Lichen calendar`)
    .replace(/Anything I've marked/, `Anything ${ownerFirst} has marked`)
    .replace(/\bI'm\b/g, `${ownerFirst} is`)
    .replace(/\bmy (to-dos|Lichen calendar)/g, `${ownerFirst}'s $1`);
  return `${ownerFirst} asked me to share their calendar with you and help you get it set up.\n\n${shared}`
    + `\n\nIf anything gets stuck, just reply here — I'll help, and I'll let ${ownerFirst} know if it needs them.`;
}
