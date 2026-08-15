import { createClient } from '@supabase/supabase-js';

// Public connection details. The publishable key is safe to ship in the
// client — your Row-Level Security policies are what protect the data.
const SUPABASE_URL = 'https://mjqnaevertyzgjlpwynr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pw5ENFOu9gJSXmULI3BW1A_hcUs-xO6';

/** The one place the auth storage key is written down. supabase-js derives it
 *  from the project ref; we need it by name to tell "signed out" apart from
 *  "session temporarily unreachable" (see AuthProvider). */
export const AUTH_STORAGE_KEY = 'sb-mjqnaevertyzgjlpwynr-auth-token';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: AUTH_STORAGE_KEY },
});

/** A session the browser still holds, whether or not the client can currently
 *  reach the server to refresh it. */
export function storedSession(): { access_token: string; refresh_token: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { access_token?: string; refresh_token?: string };
    return s.access_token && s.refresh_token
      ? { access_token: s.access_token, refresh_token: s.refresh_token }
      : null;
  } catch { return null; }
}
