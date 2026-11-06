import { supabase } from './supabase';
import { downloadText, listToRows, toCsv, type GuestList } from './guestListsApi';

// DOWNLOAD MY LICHEN (founder 2026-11-06: "if people wanna leave the
// platform"). Everything that is truly YOURS, as one JSON file: your own
// rows only, read through your own session (RLS still decides — nothing
// here can reach anyone else's private data). Other people's contact
// details never ride along; members on your lists appear as name + link.
// Drive files come as links good for 7 days, plus a contacts CSV beside it.

type Section = { table: string; filter: (q: any) => any; cols?: string };

export async function exportMyLichen(me: string, email: string | null): Promise<{ counts: Record<string, number> }> {
  const sections: Record<string, Section> = {
    // profiles carries column-level grants — name the granted columns; the
    // private phone/home arrive through their owner-only RPCs below.
    profile: {
      table: 'profiles', filter: (q) => q.eq('id', me),
      cols: 'id, full_name, first_name, last_name, headline, bio, pronouns, handle, identity_tags, avatar_url, page, contact, public_page, findable, location, created_at',
    },
    posts: { table: 'posts', filter: (q) => q.eq('author_id', me) },
    post_drafts: { table: 'post_drafts', filter: (q) => q.eq('profile_id', me) },
    folders: { table: 'collections', filter: (q) => q.eq('owner_id', me) },
    guest_lists: { table: 'guest_lists', filter: (q) => q.eq('owner_id', me) },
    contact_permissions: { table: 'contact_shares', filter: (q) => q.eq('profile_id', me) },
    personal_docs: { table: 'chat_docs', filter: (q) => q.eq('created_by', me).is('chat_id', null) },
    saved: { table: 'saved_items', filter: (q) => q.eq('profile_id', me) },
    events_hosted: { table: 'events', filter: (q) => q.eq('creator_id', me) },
    rsvps: { table: 'event_attendees', filter: (q) => q.eq('profile_id', me) },
    session_types: { table: 'booking_types', filter: (q) => q.eq('profile_id', me) },
    hours: { table: 'availability_windows', filter: (q) => q.eq('profile_id', me) },
    bookings: { table: 'bookings', filter: (q) => q.or(`provider_id.eq.${me},booker_id.eq.${me}`) },
    tasks: { table: 'reminders', filter: (q) => q.eq('profile_id', me) },
    care_entries: { table: 'care_posts', filter: (q) => q.eq('patient_id', me) },
    wow_assessments: { table: 'wow_assessments', filter: (q) => q.eq('profile_id', me) },
    financial_profile: { table: 'financial_positions', filter: (q) => q.eq('profile_id', me) },
    budget: { table: 'budget_items', filter: (q) => q.eq('profile_id', me) },
    currentcy_statement: {
      table: 'ledger_entries',
      filter: (q) => q.or(`and(from_type.eq.profile,from_id.eq.${me}),and(to_type.eq.profile,to_id.eq.${me})`),
    },
    web: { table: 'mycelium', filter: (q) => q.eq('truster_id', me).is('truster_space_id', null) },
    recommendations: { table: 'recommendations', filter: (q) => q.eq('recommender_id', me).is('recommender_space_id', null) },
    course_notes: { table: 'course_notes', filter: (q) => q.eq('profile_id', me) },
    messages_you_sent: { table: 'chat_messages', filter: (q) => q.eq('sender_id', me) },
    assistant_conversations: { table: 'assistant_feed_posts', filter: (q) => q.eq('profile_id', me) },
  };

  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    account_email: email,
    about: 'Your Lichen data, read through your own account. Other members’ private details are not included. Drive file links expire 7 days after export.',
  };
  const counts: Record<string, number> = {};
  const problems: Record<string, string> = {};

  await Promise.all(Object.entries(sections).map(async ([key, s]) => {
    const { data, error } = await s.filter(supabase.from(s.table).select(s.cols ?? '*').limit(10000));
    if (error) { problems[key] = error.message; return; }
    out[key] = data ?? [];
    counts[key] = (data ?? []).length;
  }));

  // Your own private phone + home, through their owner-only doors.
  const [ph, home] = await Promise.all([supabase.rpc('my_phone'), supabase.rpc('my_home')]);
  out.private_contact = { email, phone: ph.error ? null : ph.data, home: home.error ? null : home.data };

  // Drive files → 7-day links.
  const { data: files } = await supabase.from('drive_files')
    .select('id, kind, path, title, created_at').eq('profile_id', me);
  const fileRows = (files as { path: string; title: string | null; kind: string; created_at: string }[] | null) ?? [];
  if (fileRows.length) {
    const { data: signed } = await supabase.storage.from('drive')
      .createSignedUrls(fileRows.map((f) => f.path), 60 * 60 * 24 * 7);
    const byPath = new Map((signed ?? []).map((r) => [r.path, r.signedUrl]));
    out.drive_files = fileRows.map((f) => ({ ...f, download_link: byPath.get(f.path) ?? null }));
  } else {
    out.drive_files = [];
  }
  counts.drive_files = fileRows.length;
  if (Object.keys(problems).length) out._not_included = problems;

  const stamp = new Date().toISOString().slice(0, 10);
  downloadText(`my-lichen-${stamp}.json`, JSON.stringify(out, null, 2), 'application/json');

  // Contacts as a spreadsheet beside it — every guest list in one CSV.
  const lists = (out.guest_lists as GuestList[] | undefined) ?? [];
  if (lists.length) {
    const rows = lists.flatMap((l) => listToRows(l).map((r) => ({ ...r, note: l.name })));
    window.setTimeout(() => downloadText(`my-lichen-contacts-${stamp}.csv`, toCsv(rows), 'text/csv;charset=utf-8'), 400);
  }
  return { counts };
}
