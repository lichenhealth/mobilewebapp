// Shared pieces for the event mails (send-event-invite + event-mail): the
// date line, the event's look (cover photo + Studio design), and a REST
// helper. One copy so the invitation, the reminder and the host's message
// can't drift apart.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function zoneShort(tz: string | null | undefined, iso: string): string {
  if (!tz) return '';
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date(iso + 'T18:00:00Z')).find((x) => x.type === 'timeZoneName')?.value ?? '';
  } catch { return ''; }
}
export function whenLabel(e: { start_date: string; end_date?: string; all_day: boolean; start_min: number | null; timezone?: string | null }): string {
  const [y, m, d] = e.start_date.split('-').map(Number);
  const date = `${MONTHS[m - 1]} ${d}, ${y}`;
  if (e.all_day || e.start_min == null) return date;
  const h = Math.floor(e.start_min / 60), mm = e.start_min % 60;
  const ap = h < 12 ? 'am' : 'pm'; const h12 = h % 12 === 0 ? 12 : h % 12;
  const z = zoneShort(e.timezone, e.start_date);
  return `${date} · ${h12}${mm ? ':' + String(mm).padStart(2, '0') : ''}${ap}${z ? ' ' + z : ''}`;
}

export function restClient(url: string, key: string) {
  return (path: string, init?: RequestInit) =>
    fetch(`${url}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
}
type Sb = ReturnType<typeof restClient>;

/** The event's cover photo AND the host's Studio design (details.invite). */
export async function eventLook(sb: Sb, event_id: string): Promise<{ photo: string | null; design: unknown; postId: string | null }> {
  try {
    const posts = await (await sb(`posts?linked_event_id=eq.${event_id}&select=id,details,image_url&limit=1`)).json();
    const po = Array.isArray(posts) ? posts[0] : null;
    if (!po) return { photo: null, design: null, postId: null };
    const media: { type?: string; url?: string }[] = Array.isArray(po.details?.media) ? po.details.media : [];
    return {
      photo: media.find((m) => m?.type === 'photo' && m?.url)?.url ?? po.image_url ?? null,
      design: po.details?.invite ?? null, postId: po.id ?? null,
    };
  } catch { return { photo: null, design: null, postId: null }; }
}

/** "Galyn Burke & June Park" — the creator, then any co-hosts. */
export async function hostLine(sb: Sb, event_id: string, creator_id: string): Promise<string> {
  const names: string[] = [];
  try {
    const c = await (await sb(`profiles?id=eq.${creator_id}&select=full_name`)).json();
    if (Array.isArray(c) && c[0]?.full_name) names.push(c[0].full_name);
    const co = await (await sb(`event_cohosts?event_id=eq.${event_id}&select=profile:profiles!event_cohosts_profile_id_fkey(full_name)&order=created_at`)).json();
    if (Array.isArray(co)) for (const r of co) if (r?.profile?.full_name) names.push(r.profile.full_name);
  } catch { /* fall through */ }
  return names.length ? names.join(' & ') : 'A member';
}

/** Is this person a host (creator or co-host) of the event? */
export async function isHost(sb: Sb, event_id: string, creator_id: string, uid: string): Promise<boolean> {
  if (creator_id === uid) return true;
  try {
    const r = await (await sb(`event_cohosts?event_id=eq.${event_id}&profile_id=eq.${uid}&select=profile_id`)).json();
    return Array.isArray(r) && r.length > 0;
  } catch { return false; }
}
