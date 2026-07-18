# Google Calendar OAuth — founder setup checklist

Goal: a one-tap **Connect Google Calendar** button. Google's console only works
under your own Google account, so these clicks are yours (~20 minutes). Claude
builds everything downstream once you hand over the Client ID.

The two-track plan:
- **Alpha (now):** publish the app "In production" WITHOUT verification. Your
  alpha members see a one-time "Google hasn't verified this app" screen and
  click Advanced → Continue. Fine for people you know. (Don't use "Testing"
  status — its tokens expire weekly and everyone would have to reconnect.)
- **Public (later):** submit for verification (steps 8–9) so the warning
  disappears. Free, takes days-to-weeks, needs the privacy policy + a short
  demo video of the flow.

## Part 1 — Create the project (one time)

1. Go to **console.cloud.google.com** and sign in (use the account you want
   to own this long-term — connect@lichen.health's Google account if it has
   one, else yours).
2. Top bar → project picker → **New project**. Name: `Lichen`.
   - **Parent resource**: Browse → pick whatever it offers — if the only
     row is "No organization", select that (fine; the warning triangle is
     cosmetic for a single-app setup).
   Create, then make sure it's selected.
3. Left menu → **APIs & Services → Library** → search **Google Calendar API**
   → Enable.

## Part 2 — Google Auth Platform (the redesigned "consent screen")

4. **APIs & Services → OAuth consent screen** now lands on "Google Auth
   Platform". Click **Get started** and walk the wizard:
   - App information: name `Lichen`, support email `connect@lichen.health`
   - Audience: **External** (Workspace accounts also see Internal — don't;
     it would limit connections to Lichen Health staff accounts)
   - Contact info: your email → agree → **Create**.
5. Left menu → **Branding**: homepage `https://lichen.healthcare`, privacy
   policy `https://lichen.healthcare/privacy`, authorized domain
   `lichen.healthcare` (logo optional until verification). Save.
6. Left menu → **Data Access** → Add or remove scopes → check
   `.../auth/calendar.readonly`. Save.
7. Left menu → **Audience** → **Publish app** (Testing → In production;
   the unverified-but-working state the alpha uses).

## Part 3 — Credentials

8. Left menu → **Clients** → **Create client**:
   - Type: **Web application**. Name: `Lichen PWA`.
   - Authorized redirect URIs — add BOTH:
     - `https://mjqnaevertyzgjlpwynr.supabase.co/functions/v1/google-oauth-callback`
     - `http://localhost:5173/calendar/settings` (dev)
   - Create. You'll get a **Client ID** (public — paste it to Claude in chat)
     and a **Client secret** (NEVER paste in chat).
   - Put both where the other secrets live: Supabase dashboard →
     Edge Functions → Secrets → `GOOGLE_OAUTH_CLIENT_SECRET` and
     `GOOGLE_OAUTH_CLIENT_ID`.

## Part 4 — Verification (when public launch nears)

8. Verify the domain: **search.google.com/search-console** → add property
   `lichen.healthcare` → DNS TXT record (add it in Vercel DNS, where the
   domain's records live).
9. Google Auth Platform → **Verification Center** → submit. Google will ask for
   the privacy policy URL (live by then), scope justification ("Lichen reads
   calendar busy/free time so members' real availability powers scheduling
   and booking; data is never shared or used for ads"), and a short screen
   recording of the connect flow. Respond to their emails; typically days to
   a few weeks.

## What Claude builds once you send the Client ID
- `google-oauth-callback` edge function (token exchange; tokens live server-
  side only, never reach the browser)
- "Connect Google Calendar" button in Calendar settings → Other calendars
- Sync path that reads availability via the Calendar API (fresher than the
  secret-URL feed) with the secret URL remaining as the universal fallback
