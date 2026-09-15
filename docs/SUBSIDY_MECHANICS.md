# Subsidy mechanics — build spec

Status: proposal, 2026-09-15. Written against the published policy
(lichen.health/subsidy-policy) and criteria (lichen.health/subsidy-criteria).
Nothing here is built. Do not describe any of it to third parties as shipped.

## Why the order below is not the order you'd expect

The obvious first task is "flag donors' family members." It can't be first,
because there is nothing for the flag to constrain.

`translate_donation(p_donation, p_to_type, p_to_id)` takes a **donation** and a
**recipient** and mints 95% of that donation to that person or space. One
donor's dollars go to one named individual, chosen by an admin. There is no
pool, no per-donation remaining balance, no application, no criteria
evaluation, and no decision record.

That shape is the conduit the policy exists to prevent, and it is also the
shape that makes separation impossible: you cannot fund an award "from
unrelated dollars" when the award *is* a specific donation handed to a
specific person.

So the family rule is step 3, not step 1. It is a constraint on a funding step
that does not yet exist.

Also note `translate_donation` hardcodes 95/5. Policy is now 5% floor / 15%
ceiling on designated gifts, set annually to trailing-twelve-month actual
operating costs; unrestricted gifts carry no cap. The rate is a stored
parameter, not a literal.

## V1 restriction scope (founder, 2026-09-15)

Restrictions are STRUCTURED in v1, not free text:

- A gift's **purpose** is one of `care` | `community` (goods/services) |
  `unrestricted` — the enum below is deliberate and sufficient.
- A gift may additionally restrict **which providers** the fund buys
  through (`fund_providers`: tranche → provider profile ids — real members,
  standard rates, never a gift *to* them). Never who receives.
- A restricted fund with no qualifying request SITS until one exists —
  the escalate-and-wait behavior in step 3, by design.
- **Population/class restrictions ("clean food for first responders") are
  DEFERRED** until identity categories can carry them — donor free text
  never becomes a fund definition. Decline or hold such asks for now.
- Intake check, human not machinery (Eva's §4967 line): before accepting a
  provider-restricted gift — especially from a DAF — confirm the named
  provider does not personally serve the donor.

## Step 1 — Pool the money, keep the tranche

Donations stop naming a recipient. A donation becomes a **tranche**: a pool
deposit that retains its donor identity and a remaining balance.

```
donation_tranches
  id
  donation_id            -> donations.id
  donor_profile_id       (nullable; donor_email fallback)
  fund                   'care' | 'community' | 'unrestricted'
  source_kind            'personal' | 'daf' | 'foundation' | 'ira'
  amount_cents           original, after the operating share
  remaining_cents        decremented by fundings
  opened_at / closed_at  closed when remaining_cents = 0
```

`source_kind` is load-bearing. DAF, foundation and IRA tranches can never fund
a relative of that donor — no discretion, no steward override. Personal
tranches are subject to the same separation but the consequence of an error is
different, so the two are not interchangeable.

Invariant to enforce in the database, not the app: the sum of remaining
balances never exceeds dollars actually held. This is the float rule applied to
the subsidy fund, and the criteria page states it publicly as a hard stop.

## Step 2 — Award the subsidy, blind to funding

```
subsidy_requests      member, wow_snapshot_id, submitted_at
subsidy_decisions     request_id, steward_profile_id, criteria_version,
                      outcome, reasoning, decided_at
subsidy_awards        decision_id, amount_cents, cap_basis, expires_at
```

`criteria_version` matters: the criteria page commits that decisions are
recorded against the criteria in effect on that date. Version the criteria and
store the pointer, or that promise is unverifiable a year from now.

Caps to enforce here: per-session contribution never exceeds fair market
value; $1,000 per member per month.

**The steward's view must not include donor-relationship data.** Eligibility is
decided on the criteria alone. This is not a nicety — it is what makes "being a
donor, or being related to one, neither qualifies nor disqualifies anyone"
literally true in the system rather than only on the page, and it is the thing
you would need to demonstrate.

## Step 3 — Fund the award, where separation lives

```
award_fundings        award_id, tranche_id, amount_cents, funded_at
```

Tranche selection runs *after* the award exists. It excludes any tranche whose
donor is related to the awarded member, then draws from what remains.

This is negative-proof accounting: the record shows which tranches were
excluded and why, never which donor "paid for" whom. Store the exclusion set on
the funding, not a derived claim about the source.

If no eligible tranche can cover the award, it does not silently fail and it
does not quietly disqualify the member. It escalates — the award stands and
waits for eligible funds, and a human is told.

## Step 4 — Relationship data, as little as possible

Definition: IRC §4958(f)(4), reached via §4958(f)(7). §4967 only points there.
Spouse, ancestors, children, grandchildren, great-grandchildren and their
spouses, plus brothers and sisters and their spouses. **Nieces, nephews,
cousins and other in-laws are outside the list** — do not widen it, the whole
point is to catch only what the statute catches.

```
donor_relations       donor_profile_id, related_profile_id, relation, source,
                      declared_at, deleted_at
```

Collect at two points, both minimal:

- **Applicant side, at request time (primary).** One question on the subsidy
  request: is anyone in your immediate family a donor to Lichen? Asked of the
  person who actually knows, only when it matters.
- **Donor side, at gift time (backstop).** A yes/no: does anyone in your
  immediate family use Lichen, or might they? Names collected only on "yes."

Do not ask donors to enumerate their relatives up front. That means holding
family-relationship data, on a health platform, about people who are not
members and never consented. It also does not work: name-matching a donor
roster against member records produces false negatives that defeat the purpose
and false positives that mislabel people.

Because tranches persist, a relation declared later automatically restricts the
donor's **remaining** balance. That is the whole reason balances are kept per
tranche rather than netted into one pool figure.

Retention: when a tranche closes, its restrictions are moot. Delete relation
rows that exist only to serve closed tranches.

## Not to build

- No deduction-reduction reporting to donors. A gift is either a charitable
  contribution or it is not; there is no proportional middle, and issuing a
  "your gift funded your relative" statement would assert traceability the
  policy denies.
- No donor-designated recipients in the subsidy path at all. That is the
  sponsorship / Give flow: non-deductible, separate, and never drawn from
  subsidy funds.

## Open for Eva and the attorney

1. Minor dependents: subsidizing a donor's minor niece may relieve the
   **sister's** legal support obligation, and the sister is a related person
   even though the niece is not. Does the benefit run to the parent?
2. Does the access track ("wouldn't otherwise try it") serve a charitable
   class on its own, independent of need?
3. Confirm the §4958(f)(4) list is the right operating definition to codify.
