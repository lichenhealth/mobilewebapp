import { createClient } from '@supabase/supabase-js';

// Public connection details. The publishable key is safe to ship in the
// client — your Row-Level Security policies are what protect the data.
const SUPABASE_URL = 'https://mjqnaevertyzgjlpwynr.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_pw5ENFOu9gJSXmULI3BW1A_hcUs-xO6';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
