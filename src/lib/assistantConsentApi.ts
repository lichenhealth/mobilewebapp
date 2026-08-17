import { supabase } from './supabase';

// PER-IDENTITY AI CONSENT — the client half (founder 2026-08-17).
//
// The decision lives in the DATABASE now (assistant_consent: one row per
// de-selection, no rows = all on — the collaboration premise). localStorage's
// `ai-door-<section>` keys are demoted from source-of-truth to a per-device
// MIRROR of the DB, kept so the reads that happen during render (icon rows,
// the brain's slash) stay synchronous and correct from the first paint.
//
// THE MIGRATION RULE (step 3 of the build brief — the one unacceptable failure
// is silently resetting someone's existing "off" back to the default "on"):
// each device pushes its pre-existing 'off' keys up exactly once, with
// insert-do-nothing, so a stale device can never clobber a choice the member
// has since changed elsewhere. After that, every sign-in pulls the DB down
// over the mirror.

type ScopeType = 'section' | 'space' | 'aspect';

/** Every room the assistant can work in — the de-selection vocabulary. The
 *  ids are the same strings the brains pass (AssistantDoor sections, feed
 *  thread names, the server's chat/help keys), so one row governs the door,
 *  the briefing, and the edge function alike. */
export const CONSENT_SECTIONS: { id: string; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'mycelium', label: 'My-celium' },
  { id: 'market', label: 'Marketplace' },
  { id: 'events', label: 'Events' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'chat', label: 'Chat' },
  { id: 'concierge', label: 'Concierge' },
  { id: 'courses', label: 'Courses' },
  { id: 'saved', label: 'Drive' },
  { id: 'maps', label: 'Maps' },
  { id: 'search', label: 'Search' },
  { id: 'profile', label: 'Profile management' },
  { id: 'member', label: 'Member briefings' },
  { id: 'organizations', label: 'Organizations' },
  { id: 'communities', label: 'Communities' },
  { id: 'groups', label: 'Groups' },
  { id: 'places', label: 'Places' },
  { id: 'help', label: 'Help room' },
  { id: 'general', label: 'Claude feed' },
];

const key = (t: ScopeType, id: string) => `${t}:${id}`;
const MIRROR_PREFIX = 'ai-door-';
const MIGRATED_FLAG = 'ai-door-migrated';

// null until the first sync — reads fall back to the mirror meanwhile.
let cache: Map<string, boolean> | null = null;

/** Is the assistant allowed in this scope? Synchronous; defaults ON. */
export function consentOn(scopeType: ScopeType, scopeId: string): boolean {
  if (cache) return cache.get(key(scopeType, scopeId)) !== false;
  // Before the sync lands, the device mirror is the best truth we hold.
  if (scopeType === 'section') {
    return localStorage.getItem(MIRROR_PREFIX + scopeId) !== 'off';
  }
  return true;
}

/** Flip consent for a scope. Instant locally; the DB write follows. */
export function setConsent(scopeType: ScopeType, scopeId: string, on: boolean): void {
  if (!cache) cache = new Map();
  if (on) cache.delete(key(scopeType, scopeId));
  else cache.set(key(scopeType, scopeId), false);
  if (scopeType === 'section') {
    if (on) localStorage.removeItem(MIRROR_PREFIX + scopeId);
    else localStorage.setItem(MIRROR_PREFIX + scopeId, 'off');
  }
  void (async () => {
    const { data: u } = await supabase.auth.getUser();
    const me = u?.user?.id;
    if (!me) return;
    if (on) {
      // All-on is the absence of rows — turning something back on deletes.
      await supabase.from('assistant_consent').delete()
        .match({ profile_id: me, scope_type: scopeType, scope_id: scopeId });
    } else {
      await supabase.from('assistant_consent').upsert(
        { profile_id: me, scope_type: scopeType, scope_id: scopeId, enabled: false, updated_at: new Date().toISOString() },
        { onConflict: 'profile_id,scope_type,scope_id' });
    }
  })();
}

/** The member's own de-selections, for the Privacy list. */
export async function listConsentOff(): Promise<{ scope_type: ScopeType; scope_id: string }[]> {
  const { data } = await supabase.from('assistant_consent')
    .select('scope_type, scope_id').eq('enabled', false);
  return (data as { scope_type: ScopeType; scope_id: string }[] | null) ?? [];
}

/** Care consent is MUTUAL, and mutually visible (founder 2026-08-17): the
 *  more restrictive of the two parties governs, and BOTH sides are told —
 *  a caregiver assuming their assistant sees a chart it can't, or a client
 *  assuming an assistant is helping when the caregiver works without one,
 *  is the same failure. Gated server-side to the two parties themselves. */
export async function careConsent(patientId: string, caregiverId: string):
  Promise<{ effective: boolean; patientOn: boolean; caregiverOn: boolean } | null> {
  const { data, error } = await supabase.rpc('assistant_consent_care', {
    p_patient: patientId, p_caregiver: caregiverId });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : data) as
    { effective: boolean; patient_enabled: boolean; caregiver_enabled: boolean } | null;
  if (!row) return null;
  return { effective: row.effective, patientOn: row.patient_enabled, caregiverOn: row.caregiver_enabled };
}

/** Called once per sign-in (AuthProvider). Migrates this device's legacy
 *  'off' keys up (insert-do-nothing), then pulls the DB down over the cache
 *  and the mirror. */
export async function syncAssistantConsent(userId: string): Promise<void> {
  try {
    if (!localStorage.getItem(MIGRATED_FLAG)) {
      const legacy: { profile_id: string; scope_type: string; scope_id: string; enabled: boolean }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(MIRROR_PREFIX) || k === MIGRATED_FLAG) continue;
        if (localStorage.getItem(k) === 'off') {
          legacy.push({ profile_id: userId, scope_type: 'section', scope_id: k.slice(MIRROR_PREFIX.length), enabled: false });
        }
      }
      if (legacy.length) {
        const { error } = await supabase.from('assistant_consent').upsert(legacy, {
          onConflict: 'profile_id,scope_type,scope_id', ignoreDuplicates: true });
        if (error) return; // try again next boot rather than mark done falsely
      }
      localStorage.setItem(MIGRATED_FLAG, 'done');
    }

    const { data, error } = await supabase.from('assistant_consent')
      .select('scope_type, scope_id, enabled').eq('profile_id', userId);
    if (error) return; // keep whatever truth we already hold
    const rows = (data as { scope_type: ScopeType; scope_id: string; enabled: boolean }[] | null) ?? [];
    const next = new Map<string, boolean>();
    for (const r of rows) next.set(key(r.scope_type, r.scope_id), r.enabled);
    cache = next;

    // Refresh the mirror: 'off' for disabled sections, gone otherwise.
    const wantOff = new Set(rows.filter((r) => r.scope_type === 'section' && r.enabled === false).map((r) => r.scope_id));
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(MIRROR_PREFIX) && k !== MIGRATED_FLAG && !wantOff.has(k.slice(MIRROR_PREFIX.length))) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
    wantOff.forEach((s) => localStorage.setItem(MIRROR_PREFIX + s, 'off'));
  } catch { /* consent stays at its last known state; next boot retries */ }
}
