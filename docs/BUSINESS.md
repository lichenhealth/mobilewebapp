# Lichen — business & marketing brain

The CLAUDE.md pattern applied to business development (founder 2026-09-01,
preparing a pitch deck across many sessions): ONE canonical file, in the
private repo, updated as part of shipping — never per-thread summaries that
drift. CLAUDE.md carries the rule that keeps this current. Dates on facts;
`⚠ PENDING` on anything not yet true; the public website carries only
audited claims and this file says where each private fact lives.

## The story in one breath

Lichen is a partnership between carbon-based intelligence and silicon-based
intelligence building (a) the corrective social network and (b) a reciprocal
economy with hyper-local chapters — "we are not building a utopia, we are
building an ecosystem." A nonprofit with no investors to pay, radically
collaborating with pilot partners, where revenue flows back into expanding
access to goods, resources and care. The canonical PUBLIC telling is
lichen.health/about (honesty-audited 2026-09: says what exists today, not
what's in process) — every deck's opening duplicates it word-for-word via
the WeavePitch template.

## Entity & posture

- Presented in materials as a **501(c)(3) nonprofit** (HJC/Mons Sana deck,
  Jan 2026) and the donation flow sends deductible tax receipts.
  ⚠ VERIFY with Eva (the accountant) before any deck states determination
  status/EIN specifics — the repo holds no filing paperwork.
- "Being courted by a venture firm, but unclear if there is alignment"
  (founder's own deck outline, July 2026) — the no-investors posture is the
  story; any venture conversation is an exception the founder handles.
- Key people: Galyn Burke (founder & CEO; tech professional turned trauma
  therapist — LMFT/LPC/LMHC across CO/CA/WA). Building collaborators on
  indefinite platform gifts: Gabe Miltner, Melanie Bright. Mahsa Ghafourian:
  AI collaboration + the revenue-vs-AI-cost modeling. Eva: accountant
  (records retention, subsidy-policy review). Attorney: engaged for the
  subsidy-policy review; fintech-attorney consult flagged before any
  Current-cy cash-out door opens.

## Revenue & money mechanics (what a deck may claim)

- **Memberships** (Stripe): Community and Concierge tiers. Every new member
  gets one automatic 3-month Concierge gift (the growth gift). Alpha-cohort
  gifts were clocked to ~late Oct 2026 (2026-07-23) as a shared
  make-it-indispensable deadline.
- **Donations**: min-5% operating share per gift, donor may direct a larger
  share to operations or give generally (founder 2026-08-28/09-01); the
  remainder funds subsidies. Historical code: `translate_donation` minted
  95% as Current-cy — ⚠ code lags the new policy (see subsidy section).
  Sponsorships (donor picks the recipient, the "Give" flow) are the
  non-deductible conduit carve-out, separate from donations.
- **No home address on the open web** (2026-09-08): the /donate check card
  no longer prints a mailing address — it shows connect@lichen.health as
  visible text plus an "Email us" mailto, and donors are sent the current
  address by reply. Any future printed mailing address must be a PO box or
  registered-agent address, never the founder's home.
- **The float rule** (inviolable): never mint more Current-cy than donation
  dollars actually held. `currentcy_float_summary()` is the gauge.
- **Current-cy** = DB ledger + $1 peg, NO blockchain (settled 2026-07-18,
  re-settled 07-21; do not relitigate). Three channels: dollars IN (minting
  encodes value attribution), Current INSIDE (append-only ledger), dollars
  OUT at fixed $1 peg via Stripe Connect (phase 2). Taxed-at-receipt is
  settled with finality — never promise tax-free earnings.
- **The two economies** (endorsed pitch framing): "Current-cy moves value —
  above-board, bridging the world as it is. Offerings move love — freely
  given, building the world as it could be." Gift layer direction: counted
  hour-equal time-bank (never convertible — the firewall is load-bearing),
  attorney review before build. Skill/risk nuance lives in the bridge and
  in attribution, never as hour-weights.
- **The Two Maps** (keeper deck framing, founder 2026-07-21): Map One =
  actual contribution of every person/plant/animal/place to the ecosystem;
  Map Two = what the human economy priced it at. Care work ~$10T/yr priced
  at zero. Lichen's ledger + attribution = the first rigorous Map One;
  the divergence becomes computable.
- Full economic doctrine (time registers, allocation chains, entrusted
  offerings, hour-equality resolution): the `currentcy-architecture` memory
  file in the builder Claude's memory is the deep source.

## Subsidy policy — state as of 2026-09-01

Live at lichen.health/subsidy-policy. **Eva (accountant, Eva 990 &
Associates) BLESSED the page** — in writing 2026-08-28 ("I read your HOW
SUBSIDIES WORK AT LICHEN and it looks good to me", with her plain
not-a-lawyer caveat) and as-is per founder 2026-09-09, advising the page
be LESS detailed — her written principle: the public page states the
principle, the individualized written commitment carries the
legally-operative detail (FMV + deduction-limit language). Trim pass
awaits the founder's go; ATTORNEY review still open, DRAFT banner stays
until it lands. Original state, **DRAFT pending Eva + attorney**:
purpose funds beside the general pool ("You choose the well — Lichen
chooses who drinks"), restrictions name open charitable classes never
persons, family/household rule is funding-SEGREGATION never denial
(negative-proof tranche accounting — prove whose money it wasn't, never
show whose it was). **Operating allocation finalized on the page 2026-09-09**
(founder's copy, applied to lichen-health/subsidy-policy.astro): designated
gifts carry 5% min / 15% max, the rate set ANNUALLY to actual trailing-
twelve-month operating costs; overage while young is covered by earned
revenue, unrestricted gifts, and the founder's unpaid time and personal
funds; UNRESTRICTED gifts carry no cap (may fund operations in full); the
page names what operations cost as of Sept 2026 (Vercel/Supabase/Figma/
Claude, legal, accounting, periodic engineering consultation; founder
unpaid). Assistants: say "5–15% on designated gifts, set annually to real
costs", never a fixed 95/5. ⚠ NONE of the mechanics are built; the gap must
never be described to third parties as closed. Six build decisions await the founder in the
"Filling the Well" artifact; the mechanics proposal lives on branch
claude/goofy-cori-eb2846 (PR #156, docs-only).
**FAMILY RULE SIMPLIFIED (founder 2026-09-11, the Mark's-sister case).**
The segregation mechanics are RETIRED from the page: with one donor and
zero earned revenue (all alpha members use the platform free, by choice)
"funded from dollars given by unrelated donors" was a pool of zero, so
the tranche promise produced the very denial it was written to avoid.
Settled: it was OUR policy, not an IRS rule — the law has no bar on a
donor's relative (or a past donor) receiving a need-based subsidy; what
it polices is EARMARKING (a gift understood to be for a named person),
QUID PRO QUO (a gift replacing care the donor would otherwise pay for),
and INSIDER BENEFIT (a benefit to a disqualified person or their family
beyond what an unrelated applicant would get — siblings count as family
there, nieces/nephews do not, and it bites only if the donor is an
insider at all). Replacement copy for the "Donor Neutrality" section
(pending Eva's read, to be applied in lichen-health/subsidy-policy.astro):
"Being a donor, or being related to one, neither qualifies nor
disqualifies anyone. Subsidies are decided against our written criteria,
never by relationship." The pooled/untraceable paragraph above it stays
and does the legal work; the onboarding household-disclosure ask goes.
The criteria page EXISTS now — see the 2026-09-11 block below. ⚠ Suggested same pass: the bright
line about paying for "a specific person's care" should name "your own
care, or a specific person's" — it is now the only place quid-pro-quo
lives on the page. THE AUDIT DEFENSE IS THE FILE, NOT THE RATIO: one
record per subsidy decision (who, how much, why, how selected, any
relationship to officers or major contributors — written IN the file,
never around it), criteria dated before applications, the donor's
acknowledgment saying unrestricted/general fund, no conversation between
donor and Lichen about a relative's application, board recusal if the
donor ever sits. Founder's plan: a broad alpha client pool in Concierge
so any related applicant is one of many drawing on the same gift, plus a
few more dollars in before launch for optics — comfort measures, neither
legally required. Assistants: never tell a member a relative of a donor
can't receive a subsidy.
**THE CRITERIA PAGE IS PUBLISHED (2026-09-11)** — lichen.health/subsidy-criteria,
linked from the policy page three times (the donor paragraph's
"need-based criteria" anchor — founder's exact wording: "By default, your
gift joins the general subsidy fund, pooled with every other donation
allocated by Lichen alone against the need-based criteria within our Web
of Wellbeing assessment." — plus both "written criteria" phrases), with a
back button to the policy. It carries the assessment→formula story: WOW
assessment as front door, four financial numbers + household size are ALL
the formula reads, deterministic-not-AI stated plainly, FPL tier table
(≤150% pay 0 / 150–200% pay 25% / 200–250% pay 50% / 250–300% pay 75% /
>300% full price), margin adjustment (income−expenses < $200/mo moves one
tier toward more support, only ever in the member's favor), payment flows
through Lichen (practitioner paid in full, never told who's subsidized),
human steward look ONCE at enrollment recorded with reasons then automatic
per-session, exposure door funded in full outside the formula, caps
($150/session, $600/member/month, fund hard-stop), relationship-neutral
line (the simplified family rule), versioned-in-the-open promise.
⚠ Banner reads "Working draft · Numbers pending final approval" — the
percentages/caps are the PROPOSAL the founder has seen but not explicitly
blessed; the structure is presented as settled. FPL dollar figures are
deliberately NOT printed (the page defers to "the federal guidelines
published each year"), so no annual copy edit and no wrong-year number.
**FPL TIERS RETIRED SAME DAY (founder 2026-09-11, before ever taking
effect):** "I don't think we should use the standard poverty line
metrics" — an income line can't see a life. The page's "The tiers"
became **"The Criteria"**: whole-picture reading — what comes in AND HOW
(the work behind it), what goes out AND TOWARD WHAT (spending that
resources a life reads as need, not discretion; support given to others
counts), what's left, and **WHAT CARE COMES NEXT** — a subsidy is AIMED,
not just sized (founder's pair: a poorly-paid teacher funding a
niece/nephew's clean food gets naturopathic care; someone at the same
income dependent on alcohol/online gambling to avoid unresolved-PTSD
distress gets ADDICTION care — different interventions, nobody ranked).
The governing question: what most reduces depletion of collective
resources and most restores capacity for positive contribution. A HUMAN
STEWARD sets rate + aim at enrollment against the written criteria,
recorded with reasons; automatic per-session after. ⚠ The no-AI-ever
promise was SOFTENED (founder 2026-09-11 late pass): the page now says
"Whether AI reads your picture is up to you, but your story will never
be reviewed by an algorithm alone" — the founder wants the model to
read words and become a bigger part of subsidy decision-making over
time, with the human steward and the member's omit lever as the
standing guarantees. Never re-introduce "no model ever reads" claims. Caps
($150/session, $600/member/month, hard-stop) survive unchanged.
**NEW DOCTRINE — SMALL ON PURPOSE (founder, same message):** "we err on
the side of keeping the platform small and adequately supporting current
members before expanding the community... fewer people getting more
support and expand carefully" — stated on the page as its own section;
aligns with the alpha posture ("test this out with a small group and do
it right"). Growth conversations must honor it.
⚠ Build shape change: task "rate computation" is no longer an FPL
formula — it's steward-set rate + aim stored as versioned data at
enrollment; sessions bill against the stored rate.
**Subsidy build decisions (founder 2026-09-11, this session):** whole
payment runs through Lichen (member pays computed rate via Stripe, fund
covers the rest — what makes practitioner-blindness true); Mark's $10K =
program-restricted donation at 5% operating (his generosity with general
gifts earned the minimum rate); practitioners accrue Current-cy and cash
out to dollars (mint→grant→burn), 1099 tracked per practitioner per year.
Guided WOW intake shipped at /concierge/intake (PR #157) — the front door
the policy names. Still to build: fund+policy tables, rate computation,
session billing.

## Fundraising strategy & pipeline

- **Founders Circle** (donor circle) = the keystone of the fundraising
  strategy per the founder's deck outline: "host operations and
  perks/benefits to donors circle." Page redesign v2 shipped ~2026-09-01
  (/founders-circle static page; copy drafts in ~/Downloads).
- **Pilot land partnership** = the other named next step ("research
  efficacy of the model"). Live prospect: **Four Winds Wholeness
  Sanctuary** — Andrea Pomarico is gathering a COALITION of nonprofits to
  steward the property. Canonical deck since 2026-09-01:
  **lichen.health/4winds** (stewardship-circle orientation — what Lichen
  is + its role; struck seats for healing/education/operations partners;
  NO financial content by design). It supersedes
  /weave/audacitylabs-4winds (308s there now); the old trifecta deck's
  gdoc mirror (Andrea + Steve Dobo) is historical. Old open items that
  still matter if that content returns anywhere: homestead date
  (1882/1888/1892), Steve's Audacity Lab corrections, AFMOCON number,
  Andrea's owner-financing terms. Framing: first property held in a
  purpose-formed land trust.
  ⚠ REBUILT AGAIN 2026-09-01 to Andrea's synopsis brief (her structure:
  Lichen-in-brief/fit, Galyn bio, who-it-assists, why-Four-Winds): leads
  with EQUINE-ASSISTED THERAPY for first responders/veterans ("8,700
  veterans in Castle Rock" — her figure) and AI SCHEDULING ("breathing
  time for the land, animals and practitioners"); the mycelium economy is
  DEFERRED by her explicit ask. Note: this reopens the healing seat the
  founder struck 2026-08-08; founder directed the change. THIRD PASS same
  day (founder's synthesis, the live version): the fungus-and-algae
  metaphor returns up front, the two platforms named plainly (Community /
  Concierge), the Galyn×Claude lean-build story, the flow-through business
  model (deep links: /business#philanthropic-model, /business#land-trust —
  ProjectPage slugifies section titles, no page change needed), and the
  land-trust ROLES: Andrea passes stewardship to the Place entity,
  Audacity Lab = education partner, Bree stewards the mustangs' Current-cy,
  open seats marked. Equine focus is rescued-and-gentled MUSTANGS; pilot focus widened
  2026-09-01 to include PLANT MEDICINE, stated as legal via Colorado's
  regulated Natural Medicine program (licensed facilitators, lawful
  settings — never a bare "it's legal").
  Pipeline facts from Andrea (2026-08-31): Steve's two teams committed to
  Four Winds as a permanent venue ("second Global Lab for nature-based
  experiential research"); Steve is introducing Lichen+Andrea to an
  international "Mycelium Network" group (his email — founder to read);
  Linda (Bree's volunteer) moved onsite, Bree to follow when Andrea
  leaves for Sedona; Andrea has asked Galyn for a candid
  commitment conversation (100% in / toe-in-water / stepping out).
- **Gaia, Inc.** — founding media partner framing ("New Earth Living
  Resonance Site"); Four Winds approved for Gaia's Partnership Program
  2026-06-12 (contact: Sierra Samuel). Separate retreat-property proposal
  brief awaits the founder's answers to five questions (gaia-retreat
  memory).
- **Hero's Journey Center × Mons Sana** — three-way sovereign-partnership
  deck exists (Jan 2026, pptx in Drive): veterans/first-responders trauma
  model, $6M–$13.3M blended capital need, client-to-donor pipeline. Status
  since January: unknown — ask the founder before reusing numbers.
- **Alpha cohort** = existing network invited as members who "translate
  into contributors to the commons."

## Deck & materials inventory

| Asset | Where | Notes |
|---|---|---|
| Founder's vision deck (14pp PDF) | `~/Desktop/Lichen Health — Deck.pdf` | UVA, per-entity AI, Shadow Clause; mockups are the per-entity-assistant spec |
| "Lichen Pitch Deck" outline | gdoc `1UHzP444yd8FLqpL7qcvJvQ7kee_jphUWRUTuP5KO-8I` | July 2026, 8 slides → merges into Gaia/Four Winds brief |
| "Lichen Weave" narrative | gdoc `1BDCkQSiz3HyWS1z3ZlfIkCEHDgcoCPXE3XMOTB-j4j8` | The general weave-deck script; data-ownership + economy slides |
| WeavePitch deck system | `lichen-health` repo (`WeavePitch.astro` + `EcosystemStack.astro`) | Same opening every deck (literal /about copy), `slot="weave"` for the partner half; alpha badges; struck-seat pattern; no financial claims without founder's explicit go-ahead |
| Four Winds circle deck (canonical) | lichen.health/4winds | Supersedes /weave/audacitylabs-4winds (308) — orientation for the steward coalition, no financials |
| Four Winds deck gdoc mirror | gdoc `1PL1p5lgKzu3TJRALG807qeni2hJmaXtjAVr1827lhBw` | Words-only mirror of /4winds for Andrea collab (2026-09-02, Andrea liked the deck; recreated same day for the role-bullet rewording — Drive connector can't edit doc bodies, only replace); founder shares; sync edits back to the page by hand. Note: founder's 09-02 trim cut the 8,700-veterans/breathing-time passage from the deck |
| HJC × Mons Sana deck | Drive pptx `1unYR0OP01yNbCkmwu729FPAzDuGxA5L3` | Jan 2026; verify currency before reuse |
| Figma pitch deck | Figma | Narratives: Founder Burnout, Platte County FD, "a member profile of her own" |
| Audited public narrative | lichen.health /about /care /business /platform /economy | Safe source for public claims |
| Subsidy policy | lichen.health/subsidy-policy | DRAFT banner until review lands |
| Privacy/AI 101 | lichen.health/privacy-and-ai | The deck's "dive deeper" link per the Weave script |

## Honesty rules for every deck (standing)

1. Claims about the platform come from the audited website or APP_OVERVIEW.md
   — alpha badges on, "what's built" never inflated. All five ecosystem
   cards read ALPHA as of 2026-09-01 (Business graduated from In
   Development on the strength of the donation/subsidy policy work) (the State-of-Platform
   slide framing: full backend-supported Community and Concierge v1; basic
   algorithm for the new economy; a container alpha users inform).
2. No financial figures without the founder's explicit go-ahead, per deck.
3. Policy commitments in flight (subsidy mechanics, gift layer, cash-out)
   are described as commitments, never as shipped.
4. Data stance: the commons owns aggregate; individuals control their data
   and every AI door (default-on, opt-out — the consent doctrine).
5. Deck + its shared gdoc mirror stay in sync by hand; edits verified live.
