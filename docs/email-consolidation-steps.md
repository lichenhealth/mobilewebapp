# Email consolidation: steps for browser-Claude

**Goal:** everything lands in **galyn@lichen.health** (the Workspace at admin.google.com).
- **galynburke@gmail.com** → forwards in, labeled *Personal*. The account stays open.
- **galyn@galynburke.com** → becomes a true alias of galyn@lichen.health once its mail is copied over.

## Rules for browser-Claude (read first)
- **Galyn signs in herself.** Never type a password. If a sign-in screen appears, stop and ask her.
- **Never delete mail, accounts, or subscriptions, and never cancel anything,** without her explicit "yes" in that moment.
- **Never change MX records.** Both sides are Google, so the mail records stay as they are.
- After each part, tell her what changed (before → after) and what's next.

---

## Part 1 — Forward galynburke@gmail.com into galyn@lichen.health (today, ~5 min)

1. Sign in to Gmail as **galynburke@gmail.com** (Galyn does this).
2. ⚙ → **See all settings** → **Forwarding and POP/IMAP** → **Add a forwarding address** → enter `galyn@lichen.health` → Next → Proceed.
3. Google emails a confirmation code to galyn@lichen.health. Galyn opens that inbox (or browser-Claude does, in a tab where she's signed in) and clicks the link or copies the code back.
4. Back in galynburke@gmail.com's Forwarding settings: choose **Forward a copy of incoming mail to galyn@lichen.health** and **archive Gmail's copy** → **Save Changes**.
5. Now sign in as **galyn@lichen.health** → ⚙ → See all settings → **Filters and Blocked Addresses** → **Create a new filter**:
   - In **To:** enter `galynburke@gmail.com`
   - **Create filter** → tick **Apply the label** → **New label…** → `Personal` → tick **Also apply filter to matching conversations** → **Create filter**.
6. **Test:** from any other address, email galynburke@gmail.com. It should arrive in galyn@lichen.health wearing the *Personal* label within a minute or two.
7. *(Optional)* To reply **as** galynburke@gmail.com from the lichen inbox: in galyn@lichen.health ⚙ → Accounts → **Send mail as** → Add another email address → galynburke@gmail.com. This needs an app password from the Gmail account, so ask Galyn before going down this path. Replying from galyn@lichen.health instead is fine and helps people update their contacts.

**Keep galynburke@gmail.com open.** Forwarding only works while it exists, and it's free.

---

## Part 2 — Move the galyn@galynburke.com logins (before Part 3)

The galyn@galynburke.com Google login stops working when its account closes, so do this first.

1. Sign in as **galyn@galynburke.com** → **myaccount.google.com → Security → "Your connections to third-party apps & services."**
2. List every app or site shown. For each one, go to that site's account settings and change the email or sign-in to **galyn@lichen.health** (or link the lichen Google account and unlink the old one).
3. Also search the galyn@galynburke.com inbox for `welcome`, `verify your email`, and `password reset` to find sites that use the address as a plain username, and update those too.
4. Give Galyn the list: what moved and what couldn't (some sites don't allow changing the email; she decides those).

*(Repeat this for galynburke@gmail.com whenever convenient. There's no rush, since that account stays open.)*

---

## Part 3 — Fold galyn@galynburke.com into the lichen.health Workspace

### 3a. Find where galynburke.com's mailbox lives (look only, change nothing)
- Check **Squarespace → Settings → Google Workspace / Email**. If the mailbox is billed there, the subscription is a Squarespace-resold Google Workspace and its cancellation happens in Squarespace.
- Otherwise it's a Google Workspace billed by Google directly (admin.google.com, signed in as galyn@galynburke.com).
- **Report which it is to Galyn before going on.**

### 3b. Copy everything into galyn@lichen.health (nothing deleted)
1. **Mail and contacts:** sign in as **galyn@lichen.health** → Gmail ⚙ → See all settings → **Accounts** → **Import mail and contacts** → enter `galyn@galynburke.com` → Galyn signs in to authorize → tick **Import mail**, **Import contacts**, and **Import new mail for the next 30 days** → under **Label imported mail**, use `galynburke.com` → Start import.
   - Big mailboxes can take hours or a couple of days. Check back until it says it's finished.
2. **Calendar:** as galyn@galynburke.com, open Google Calendar → ⚙ Settings → **Import & export → Export** (downloads a .zip of .ics files). Then as galyn@lichen.health → Settings → **Import & export → Import** each .ics into her main calendar.
   - Note any calendars other people subscribe to or that are shared, and tell Galyn. Those shares need re-sending from the new account.
3. **Drive (if there are files):** **takeout.google.com** as galyn@galynburke.com → select only **Drive** → export → download → upload into galyn@lichen.health's Drive (a folder named `From galynburke.com`).
4. **Check with Galyn** that recent mail, contacts, and calendar events all show up in galyn@lichen.health **before going any further.**

### 3c. Release galynburke.com from its old account ⚠ needs Galyn's explicit yes
- Only after 3b is confirmed and Part 2 is done.
- If Squarespace-billed: Squarespace → Google Workspace → cancel the subscription for galynburke.com.
- If Google-billed: admin.google.com (as galyn@galynburke.com) → Billing → cancel the subscription and delete that Workspace account. Google walks through it.
- Google may take a little while to fully release the domain. If 3d says "domain already in use," wait and retry; don't force anything.
- **Do 3c and 3d back to back, ideally in the evening.** Mail to galynburke.com can bounce or queue in between.

### 3d. Add galynburke.com to the lichen.health Workspace
1. **admin.google.com** (as an admin of lichen.health, e.g. connect@lichen.health) → **Account → Domains → Manage domains → Add a domain** → `galynburke.com` → choose **Secondary domain** → continue.
2. Google shows a **TXT verification record**. Add it in **Squarespace → Domains → galynburke.com → DNS settings** as a TXT record on `@` with the value Google gives. Save, return to admin.google.com, and click **Verify**. It can take a few minutes.
3. **Leave the existing MX records alone** (they already point to Google).
4. **Turn on email signing (DKIM) for the domain:** admin.google.com → **Apps → Google Workspace → Gmail → Authenticate email** → pick `galynburke.com` → **Generate new record** → add the shown TXT record (host `google._domainkey`) in Squarespace DNS → back in admin, click **Start authentication**.
5. Check that an SPF TXT record including `include:_spf.google.com` exists in Squarespace DNS. If one already exists, leave it; if none exists, tell Galyn before adding one.

### 3e. Make the alias and let her reply as it
1. admin.google.com → **Directory → Users → galyn@lichen.health → User information → Alternate email addresses (email aliases)** → add `galyn` @ `galynburke.com` → Save.
2. As galyn@lichen.health in Gmail: ⚙ → See all settings → **Accounts → Send mail as → Add another email address** → `galyn@galynburke.com` → leave **"Treat as an alias"** ticked → it should accept without asking for a password, since it's the same Workspace.
3. *(Optional)* A filter like Part 1's: To `galyn@galynburke.com` → label `galynburke.com`.
4. **Test:** send an email to galyn@galynburke.com from another address. It should land in galyn@lichen.health. Reply from it choosing galyn@galynburke.com in the From menu, and check it arrives normally (not in spam) at a Gmail address.

---

## When it's all done, tell Galyn
- Which logins moved, and which couldn't.
- That **connect@lichen.health stays open regardless** (it owns the Google Cloud project behind the calendar verification, plus the Zoom and Search Console logins).
- The final picture: one inbox (galyn@lichen.health), Personal label for the Gmail, galynburke.com label and alias for the domain, one Workspace bill.
