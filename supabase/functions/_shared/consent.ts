// PER-IDENTITY AI CONSENT — the server-side check (founder 2026-08-17).
//
// The check belongs where the data is GATHERED, not where it's rendered:
// before this, consent lived in the client (localStorage doors, a browser
// deciding what to put in the payload), so any new surface that forgot the
// check leaked silently. Every assistant edge function now asks this before
// speaking or reading.
//
// The default is ON — no rows means full participation (the collaboration
// premise; the one place "unknown is never yes" deliberately doesn't apply).
// So the question this answers is narrow: has this member written a
// de-selection covering any of the scopes in play? A member's rows are few
// (each is one deliberate "not here"), so we read them all once and answer
// in code — no filter-encoding surface to get wrong.

export type ConsentScope = { type: 'section' | 'space' | 'aspect'; id: string };

/** True if the member has switched the assistant OFF for any given scope. */
export async function assistantConsentOff(
  profileId: string,
  scopes: ConsentScope[],
): Promise<boolean> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key || !profileId || !scopes.length) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/assistant_consent?profile_id=eq.${profileId}&enabled=eq.false&select=scope_type,scope_id`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return false; // fail OPEN: default-on is the doctrine, and a
    // read hiccup must not read as a member having said no
    const rows = (await res.json()) as { scope_type: string; scope_id: string }[];
    return rows.some((r) => scopes.some((s) => s.type === r.scope_type && s.id === r.scope_id));
  } catch {
    return false;
  }
}
