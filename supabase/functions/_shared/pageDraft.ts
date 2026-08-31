// DRAFT-AND-PUBLISH FOR ASSISTANT WRITES (founder 2026-08-31, reversing the
// 2026-08-29 "chat is a command, Claude writes straight to live" call after
// living with it: "In the chat claude confirms the change made... Then
// there's a preview, and/or publish button within the text. When someone
// publishes, it goes live"). Every page-shaped write the assistant makes
// lands in `page_drafts` — the same row the manual builder autosaves into —
// and the PERSON publishes, from the builder or from the buttons the chat
// renders under Claude's reply. Identity writes (a space's description, a
// profile photo) stay live: they are not part of the page draft's scope.
//
// The row's `base` is the live page at the moment the draft began; publish
// compares it against live and refuses rather than overwrite — the same
// guard the builder's own publish carries.

type SbFn = (path: string, init?: RequestInit) => Promise<Response>;

export type PageBlob = Record<string, unknown>;

export interface PageState {
  page: PageBlob;
  contact: Record<string, string>;
  /** True when an unpublished draft is shadowing the live page. */
  hasDraft: boolean;
}

const table = (t: 'space' | 'profile') => (t === 'space' ? 'spaces' : 'profiles');

async function readLive(sb: SbFn, t: 'space' | 'profile', id: string) {
  const rows = await (await sb(`${table(t)}?id=eq.${id}&select=page,contact`)).json();
  const r = Array.isArray(rows) ? rows[0] : null;
  return {
    page: (r?.page ?? {}) as PageBlob,
    contact: (r?.contact ?? {}) as Record<string, string>,
  };
}

async function readDraftRow(sb: SbFn, t: 'space' | 'profile', id: string) {
  const rows = await (await sb(
    `page_drafts?subject_type=eq.${t}&subject_id=eq.${id}&select=draft,base`,
  )).json();
  const r = Array.isArray(rows) ? rows[0] : null;
  return r as { draft: { page?: PageBlob; contact?: Record<string, string> }; base: { page?: PageBlob; contact?: Record<string, string> } } | null;
}

/** What the page says RIGHT NOW from the editor's point of view: the draft
 *  when one exists, live otherwise. Read-modify-write cycles must go through
 *  this, or an edit would silently fork from (and later clobber) the draft. */
export async function readPageState(sb: SbFn, t: 'space' | 'profile', id: string): Promise<PageState> {
  const [live, draft] = await Promise.all([readLive(sb, t, id), readDraftRow(sb, t, id)]);
  if (draft?.draft) {
    return {
      page: (draft.draft.page ?? live.page) as PageBlob,
      contact: (draft.draft.contact ?? live.contact) as Record<string, string>,
      hasDraft: true,
    };
  }
  return { ...live, hasDraft: false };
}

/** Write a page-shaped change into the draft. `next` carries the keys being
 *  changed ({page} and/or {contact}); anything else the draft holds rides
 *  along unchanged. A first write branches the draft from live and records
 *  live as `base`, so publish can tell later whether the ground moved. */
export async function writePageDraft(
  sb: SbFn, t: 'space' | 'profile', id: string,
  next: { page?: PageBlob; contact?: Record<string, string> | null },
): Promise<void> {
  const [live, existing] = await Promise.all([readLive(sb, t, id), readDraftRow(sb, t, id)]);
  const cur = existing?.draft ?? { page: live.page, contact: live.contact };
  const draft = {
    page: next.page !== undefined ? next.page : (cur.page ?? live.page),
    contact: next.contact !== undefined ? (next.contact ?? {}) : (cur.contact ?? live.contact),
  };
  const base = existing?.base ?? { page: live.page, contact: live.contact };
  await sb('page_drafts?on_conflict=subject_type,subject_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      subject_type: t, subject_id: id, draft, base,
      updated_at: new Date().toISOString(),
    }),
  });
}

/** The one sentence every write-outcome carries so no surface can forget to
 *  say it: the change is in the draft, and the person makes it live. */
export const DRAFT_NOTE =
  'Saved to their unpublished DRAFT, not the live page — tell them it is drafted and point at the '
  + 'Preview and Publish buttons under your reply (in a suggestion room: the page builder\'s Publish). '
  + 'Never say it is live.';
