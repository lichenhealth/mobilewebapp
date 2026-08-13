import { supabase } from './supabase';
import type { ContactInfo } from '../components/ContactFields';
import type { PageMeta } from '../components/PublicPage';

// SNAPSHOT (founder 2026-08-11): one read of everything a member already
// has — what they type or say, plus any site they point at — turned into a
// proposed Public Web & Lichen App presence. A snapshot, never a sync: no
// credentials, nothing ongoing, and nothing is written until the member
// confirms it on the review screen.

export interface SnapshotListing {
  title: string;
  body: string;
  domain: 'good' | 'service';
  price: string;
}

export interface SnapshotProposal {
  tagline: string;
  story: string;
  categories: string[];
  categoryNames: string[];
  contact: ContactInfo;
  listings: SnapshotListing[];
  /** Plain questions for whatever it couldn't find — shown, never guessed. */
  missing: string[];
  read: string[];
  unreadable: string[];
}

export async function requestSnapshot(input: {
  text: string;
  urls: string[];
  entityName?: string;
  kind?: 'person' | 'space';
}): Promise<SnapshotProposal> {
  // The real taxonomy travels with the request so Claude can only ever
  // propose categories that actually exist (the listing-autofill pattern).
  const { data: catRows } = await supabase
    .from('categories').select('id, name, domain').order('sort');
  const categories = ((catRows as { id: string; name: string; domain: string }[] | null) ?? [])
    .filter((c) => c.domain === 'service' || c.domain === 'good');

  const { data, error } = await supabase.functions.invoke('profile-snapshot', {
    body: { ...input, categories },
  });
  if (error) {
    // The function's own message (a bad link, a hiccup) is friendlier than
    // the transport error — dig it out when it's there.
    let msg = '';
    try { msg = ((await (error as { context?: Response }).context?.json()) as { error?: string })?.error ?? ''; } catch { /* noop */ }
    throw new Error(msg || 'Could not read that just now. Try again in a moment.');
  }
  const p = data as Partial<SnapshotProposal> & { error?: string };
  if (p?.error) throw new Error(p.error);
  return {
    tagline: p.tagline ?? '',
    story: p.story ?? '',
    categories: p.categories ?? [],
    categoryNames: p.categoryNames ?? [],
    contact: (p.contact ?? {}) as ContactInfo,
    listings: p.listings ?? [],
    missing: p.missing ?? [],
    read: p.read ?? [],
    unreadable: p.unreadable ?? [],
  };
}

/** What the member ticked on the review screen — only these parts land. */
export interface SnapshotApply {
  tagline?: string;
  story?: string;
  categories?: string[];
  contact?: ContactInfo;
  listings?: SnapshotListing[];
}

/** Writes a CONFIRMED proposal. Merges into the page blob rather than
 *  replacing it, so a member who already wrote something keeps it unless
 *  they chose to overwrite. Listings publish as ordinary marketplace posts. */
export async function applySnapshot(me: string, picked: SnapshotApply): Promise<void> {
  const { data: cur } = await supabase.from('profiles')
    .select('page, contact').eq('id', me).maybeSingle();
  const row = cur as { page: PageMeta | null; contact: ContactInfo | null } | null;

  const page: PageMeta = { ...(row?.page ?? {}) };
  if (picked.tagline) page.tagline = picked.tagline;
  if (picked.story) page.story = picked.story;
  // A page with a story earns its About tab — otherwise the tab list is
  // empty and the new story has nowhere to show.
  if (picked.story && !(page.tabs?.length)) page.tabs = [{ id: 'about' }, { id: 'services' }];

  const contact: ContactInfo = { ...(row?.contact ?? {}), ...(picked.contact ?? {}) };

  const { error: pErr } = await supabase.from('profiles')
    .update({ page, contact: Object.keys(contact).length ? contact : null })
    .eq('id', me);
  if (pErr) throw pErr;

  if (picked.categories?.length) {
    const { error: cErr } = await supabase.from('profile_categories')
      .upsert(picked.categories.map((category_id) => ({ profile_id: me, category_id })),
        { onConflict: 'profile_id,category_id' });
    if (cErr) throw cErr;
    // Picking what you offer IS declaring you offer it — the capability
    // rows follow the categories rather than being a separate chore.
    const { data: catRows } = await supabase.from('categories')
      .select('id, domain').in('id', picked.categories);
    const domains = new Set(((catRows as { id: string; domain: string }[] | null) ?? []).map((c) => c.domain));
    const caps = [
      ...(domains.has('service') ? ['service_provider'] : []),
      ...(domains.has('good') ? ['goods_provider'] : []),
    ];
    if (caps.length) {
      await supabase.from('profile_capabilities')
        .upsert(caps.map((capability) => ({ profile_id: me, capability })),
          { onConflict: 'profile_id,capability' });
    }
  }

  if (picked.listings?.length) {
    const { error: lErr } = await supabase.from('posts').insert(
      picked.listings.map((l) => ({
        author_id: me,
        title: l.title,
        body: l.body,
        content_type: 'actionable',
        visibility: 'public',
        is_public: true,
        service_areas: ['marketplace'],
        details: {
          modes: ['sale'], mode: 'paid',
          ...(l.price ? { price: l.price } : {}),
        },
      })),
    );
    if (lErr) throw lErr;
  }
}
