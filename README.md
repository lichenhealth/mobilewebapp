# Lichen — PWA (pass one)

A slow, considered community PWA — installable, mobile-responsive, no service worker (per spec). Built from the Figma wireframes at the `HOME_CONCIERGE` frame as canonical reference.

## What's in this pass

Three primary screens are fully designed and built:

- **`/home`** — the daily feed, mirroring the wireframe card structure (avatar + title + handle, body text with image-badge, engagement row: Trust / Recommend / Share / Save / Chat). Includes filter tabs (All / Social / Creative / Educational / Actionable / Q&A) and the round category-icon row.
- **`/community`** — the **Mons Sana** community home, built against the `COMMUNITY_HOME` Figma frame. Big centered Archivo Thin title, the same FilterRow + IconRow as Home, then a feed of *CommunityCards* with centered titles, a center-stage user-group / event / art icon, and a different engagement set: Love / Comment / Share / Recommend / Save (no Trust, per the wireframe).
- **`/chat`** — Signal-style conversation list. Search bar at top (filters by name + handle + message content, with live highlighting). Pinned conversations sort first; everything else by recency. Distinguishes 1:1 vs group via avatar treatment (single circle vs stacked three).
- **`/chat/:id`** — the individual chat thread. Hides the top bar and bottom nav for a full-screen feel. Group threads show sender names + tiny colored avatars on incoming messages. Bubbles support **replies** (quoted inset with peach left-border), **reactions** (tappable pills hugging the bubble), and the **••• action menu** which surfaces quick emoji reactions + Reply / Save / Info. Auto-grow textarea, Enter-to-send, Shift+Enter for newline. Mock messages are mutable in local state — sending appends to the list immediately, reactions toggle live.
- **`/concierge`** — curated "three things" daily picks with an ask-the-concierge input.

The other 11 nav destinations (Chat, Calendar, Saved, Maps, Profile, Places, Market, Work, Events, Library, Groups, Mycelium) are wired up as placeholder routes so the bottom nav and side menu both work end-to-end. Build them out in pass two.

## Design system

- **Palette**: cream `#F0EEE9`, white cards, near-black `#12181C` ink, muted `#979797`, peach accent `#F5A36D` (all matched to the wireframe)
- **Type**: Archivo (body, ExtraLight 200 dominant) + Fraunces italic (display, with the SOFT axis) + JetBrains Mono (small numerics)
- **Texture**: subtle paper-grain SVG noise over the whole canvas
- **Layout**: mobile-first, max-width 430px on desktop with a soft frame

Design tokens live in `src/styles/tokens.css` — edit there and everything updates.

## Running locally

Requires Node ≥ 18.

```bash
npm install
npm run dev          # http://localhost:5173
```

Open it on your phone for the real experience — easiest path is `npm run dev -- --host` and visit your machine's LAN IP from the phone.

## Building

```bash
npm run build        # outputs to dist/
npm run preview      # serves the build at :4173 for a sanity check
```

## Installing it as a PWA

Once deployed over HTTPS:

- **iOS Safari**: Share → "Add to Home Screen"
- **Android Chrome**: hamburger → "Install app" (or the auto-prompt this app shows after ~4s)
- **Desktop Chrome/Edge**: the install icon appears in the address bar

The manifest is at `public/manifest.webmanifest`. Icons are in `public/icons/` — regenerate with `python3 public/icons/_make_icons.py` if you redesign the mark.

## Deploying — three good options

Pick one. All three give you HTTPS automatically, which you need for installability.

### 1. Vercel (easiest)

```bash
npm i -g vercel
vercel              # follow prompts, accept defaults
vercel --prod       # promote when you're happy
```

Vercel auto-detects Vite, builds, and serves from a global CDN. Free tier is plenty for this.

### 2. Netlify (drag-and-drop)

```bash
npm run build
```

Then drag the `dist/` folder onto <https://app.netlify.com/drop>. Done.

For continuous deploys, connect your Git repo at netlify.com → "Add new site" → "Import an existing project". Build command: `npm run build`, publish directory: `dist`.

### 3. Cloudflare Pages

```bash
npm i -g wrangler
npx wrangler pages deploy dist --project-name=lichen
```

Or via the dashboard: pages.cloudflare.com → "Create a project" → connect Git → build command `npm run build`, output directory `dist`.

## File map

```
src/
├── main.tsx              # entry
├── App.tsx               # routes + shell
├── styles/
│   ├── tokens.css        # color, type, spacing, motion variables
│   └── global.css        # base, reset, shell, atoms (.btn, .tag, .h-scroll)
├── components/
│   ├── TopBar.tsx        # hamburger + logo + bell w/ badge
│   ├── BottomNav.tsx     # 7-tab nav (matches wireframe)
│   ├── SideMenu.tsx      # drawer for the other 8 sections
│   ├── FeedCard.tsx      # the canonical card from the wireframe
│   ├── FilterRow.tsx     # All / Social / Creative …
│   ├── IconRow.tsx       # round category buttons
│   ├── InstallPrompt.tsx # captures beforeinstallprompt, shows a soft prompt
│   ├── Icon.tsx          # inline-SVG icon set (28 icons)
│   └── LichenMark.tsx    # logo (circular mycelium mark + "lichen" wordmark)
├── routes/
│   ├── Home.tsx          # canonical feed screen
│   ├── Community.tsx     # People / Groups / Discussions
│   ├── Concierge.tsx     # three picks + ask box
│   ├── Stubs.tsx         # Chat, Calendar, Saved, Maps, Profile placeholders
│   └── Placeholder.tsx   # shared "growing into place" component
└── data/
    ├── feed.ts           # mock feed entries
    └── community.ts      # mock members + groups
```

## What I'd build in pass two

In priority order:

1. **Chat** — that's a real interaction, not a placeholder. Probably worth its own session.
2. **Calendar** — also non-trivial; needs a real month/agenda view.
3. **Profile** — editable, ties into the trust signals already in the feed.
4. **The "passages"** (Market, Events, Library, Places, Work) — these can share a structural pattern once one is built.
5. **Real data layer** — replace `src/data/*.ts` with a fetch layer; pick a backend or stay client-only with `IndexedDB`.
6. **A service worker** if offline matters later (currently skipped per the brief).

## Notes on what I made up

The wireframes are mid-fidelity; copy and microcopy are mine. Everything I invented is replaceable in `src/data/*` and the route files — the structural decisions (palette, type, components, navigation) all trace back to the wireframe.
