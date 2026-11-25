# Chrome Web Store listing — Lichen (your coupons)

Upload: `public/downloads/lichen-coupons.zip` (rebuild with `npm run build:extension`).
Images in this folder: `store-icon-128.png`, `screenshot-1-coupon-popup.png`,
`screenshot-2-checkout-reminder.png`, `promo-tile-440x280.png`.

## Store listing tab
**Name** (from the manifest): Lichen — your coupons

**Summary** (≤132 characters):
When you shop at a store you hold a Lichen coupon for, Lichen shows you the code. The sites you visit never leave your browser.

**Category:** Shopping   **Language:** English

**Description:**
Lichen keeps your coupons so you don't have to keep paper. Snap a photo of a coupon in Lichen, and this extension brings it to you at the moment it's useful.

• When you're on the website of a store you hold a coupon for, the Lichen icon lights up with how many coupons work there.
• Click it to see the code, the minimum spend and the expiry — tap Copy and paste it at checkout.
• When you reach a store's cart or checkout, Lichen sends one gentle reminder (once per store per day).

Private by design:
• The extension downloads only your own coupon list, using a key that can read nothing else in your Lichen account.
• Deciding whether a site matches a coupon happens entirely inside your browser. The sites you visit are never sent to Lichen or anyone else.
• Disconnect any time from Profile → Connections in Lichen, or by removing the extension.

Requires a Lichen account (lichen.health). Works in Chrome, Edge and Brave on a computer.

**Homepage URL:** https://lichen.health
**Support URL:** https://lichen.health/help

## Privacy practices tab
**Single purpose:**
Show the user their own saved Lichen coupons when they are on the website of the store a coupon is for.

**Permission justifications:**
- `tabs` — To read the address of the active tab so the extension can tell, on the device, whether the user is on a store they hold a coupon for and light the badge. Addresses are compared locally and never transmitted or stored.
- `storage` — To keep the user's coupon list and their Lichen extension key in the browser so it works between sessions and offline.
- `notifications` — To show one reminder per store per day when the user reaches that store's cart or checkout page and holds a coupon for it.
- `alarms` — To refresh the user's coupon list from Lichen every few hours.
- Host permission `https://mjqnaevertyzgjlpwynr.supabase.co/*` — Lichen's own server, used only to download the user's coupon list.
- Content script on `lichen.health` — Only on Lichen's own site, to receive the extension key when the user presses "Connect this browser" and to tell the page the extension is installed.

**Remote code:** No, I am not using remote code.

**Data usage — what is collected:** Authentication information only (the Lichen extension key that identifies the user's coupon list). Leave web history, website content and everything else UNCHECKED — tab addresses are read on the device and never collected or transmitted.

**Certifications (tick all three):** not sold to third parties · not used for purposes unrelated to the single purpose · not used for creditworthiness or lending.

**Privacy policy URL:** https://lichen.health/privacy#extension

## Distribution tab
Visibility: **Public** (or **Unlisted** for a quiet first round — only people with the link can install).
Regions: all regions.
