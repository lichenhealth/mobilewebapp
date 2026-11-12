# Moving all domains to Vercel: steps for browser-Claude

**Goal:** register galynburke.com, countrymanstables.com and lichen.health at **Vercel** (signed in as connect@lichen.health), with their DNS managed in Vercel. lichen.healthcare is already there.

**The one thing that must not happen:** a domain's DNS switching to Vercel before every mail record exists there. Email for connect@, galyn@lichen.health, galyn@galynburke.com and Katie's address all depend on these records, and so does Lichen's own email sending.

## Rules for browser-Claude (read first)
- **Galyn signs in herself.** Never type passwords or codes. Stop and ask.
- **Never delete a DNS record at the old host, never cancel a plan, never pay** without Galyn's explicit "yes" in that moment.
- **One domain at a time, in this order:** galynburke.com → countrymanstables.com → lichen.health (the most important one goes last, once the routine is proven).
- After each step, say what changed (before → after).

---

## For each domain, the same six steps

### 1. Find where it's registered and who logs in
- Look it up at **lookup.icann.org** → the "Registrar" line (Squarespace, Wix, GoDaddy…) and the **expiration date**.
- Note which email the registrar account uses to log in.
- If the domain was registered or transferred **in the last 60 days**, it can't transfer yet (an industry-wide lock). Stop and tell Galyn the date it frees up.

### 2. Copy every DNS record (look only)
At the current DNS host (usually the registrar), open the domain's **DNS settings** and write out **every** record in a table: **type · name/host · value · priority (for MX) · TTL**.

Pay special attention to:
- **MX** records (mail). Google's are either `smtp.google.com` (priority 1), or the older set `aspmx.l.google.com` / `alt1…alt4.aspmx.l.google.com`.
- **TXT** records: SPF (`v=spf1 … include:_spf.google.com …`), DMARC (`_dmarc`), Google verification (`google-site-verification=…`), and DKIM (`google._domainkey`, `resend._domainkey`).
- **CNAME** records, especially lichen.health's **`rsend`** and **`send`** → `*.forge.rmta.net` (Lichen's email sending through Resend), and anything like `_domainconnect`.
- Website records (A on `@`, CNAME on `www`) that point to Vercel (`76.76.21.21`, `216.150.1.1`, `cname.vercel-dns.com` or similar). These don't need copying, since Vercel serves the site itself.

Show Galyn the table before going on.

### 3. Recreate the records in Vercel
**Vercel → Domains → [domain] → DNS Records → Add.** Add every MX, TXT and CNAME from the table **exactly** (same name, value and priority). Skip the website A/CNAME records that point to Vercel. Then compare the two lists side by side and confirm every line has a match. Tell Galyn "all N records copied."

### 4. Unlock and get the transfer code (at the old registrar)
- Turn off the **transfer lock / registrar lock**.
- Get the **authorization (EPP / transfer) code**.
- If **WHOIS privacy** blocks the transfer emails, it may need turning off briefly. Ask Galyn first.

### 5. Start the transfer at Vercel ⚠ needs Galyn's yes (it costs money)
- **Vercel → Domains → Transfer In** → enter the domain and the code → review the price (it adds a year onto the current expiry) → **Galyn approves the payment**.
- Watch the registrant's inbox for a "confirm transfer" email from the old registrar, and approve it if there is one, so the transfer doesn't wait the full 5 days.
- Transfers usually finish in **5–7 days**. Nothing changes for visitors or email while it's pending.

### 6. After it completes: switch DNS to Vercel and test
- In Vercel, make sure the domain uses **Vercel's nameservers** (Vercel shows them, e.g. `ns1.vercel-dns.com` / `ns2.vercel-dns.com`). Set them if they aren't.
- **Tests** (ask Galyn to send from her phone):
  - the website loads at both `domain` and `www.domain`
  - an email to an address at the domain arrives
  - a reply from that address arrives at a Gmail address and doesn't land in spam
- Only then report the domain done.

---

## Domain-specific notes

### galynburke.com (from Squarespace)
- Renews Aug 28, 2027; Squarespace login is via galyn@galynburke.com. Do this one before the galynburke.com Workspace is closed (that's "Part 3" of the email plan).
- Expect: Google MX, SPF, maybe DKIM/DMARC, a Google verification TXT, and `_domainconnect`. The website records already point to Vercel.
- The Squarespace **website** plan expires Aug 27; let it lapse. The **domain** is what transfers.

### countrymanstables.com (registrar unknown — step 1 finds it)
- Galyn owns it and manages it for Katie (Countryman Stables). The site is served by Lichen through Vercel.
- **Copy Katie's mail records carefully.** If the barn has email at this domain, its MX/SPF must survive. Ask Galyn if you're unsure whether anyone uses email here.

### lichen.health (from Wix) — last, and the most careful
- Its DNS carries **Google Workspace mail for connect@ and galyn@lichen.health** and **Lichen's sending records for Resend** (`resend._domainkey` TXT, `rsend` and `send` CNAMEs → `forge.rmta.net`). Missing any of these breaks either your inbox or every email Lichen sends members.
- There is deliberately **no** Resend MX record on `@`. Don't add one; it would fight Google's mail.
- **Check that Vercel accepts .health transfers** (Transfer In will say so). If it doesn't:
  - keep the **registration** at Wix,
  - move only the **DNS** to Vercel: do steps 2–3, then change the nameservers at Wix to Vercel's.
  That still puts all the records and the site in Vercel; only the yearly renewal stays at Wix.
- After switching, have Galyn check in **Resend → Domains** that lichen.health still reads **Verified**, and tell the builder Claude so it can send a test invite from Lichen.
- The Wix **Premium plan** (renewal emails Nov 10) can be cancelled **after** lichen.health is fully moved and tested — not before. Ask Galyn.

---

## When all three are done, tell Galyn
- Each domain: registrar now Vercel (or, for .health, DNS-only), new expiry date, records copied, tests passed.
- What's left to cancel: the Squarespace website plan (lapses Aug 27), the Wix Premium plan (her call), and any old registrar accounts.
