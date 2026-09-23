import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import {
  WOW_DIMENSIONS, DIMENSION_META, createCarePost, updateWowCarePost, deleteCarePost,
  myWovenWowEntries, myOpenAssessment, ensureOpenAssessment, submitAssessment, adoptWowEntry,
  type Dimension, type WovenWowEntry,
} from '../lib/conciergeApi';
import {
  getFinancialPosition, saveFinancialPosition, requestFinancialCoordinator,
  SUBSIDY_NEEDS, type SubsidyNeed, type FinancialPosition,
} from '../lib/meansApi';
import './WowIntake.css';

/** THE GUIDED INTAKE (founder 2026-09-11, onboarding the first Concierge
 *  cohort): the Web of Wellbeing self-assessment as a walk, one dimension
 *  per screen, resumable — the front door the subsidy policy names ("you
 *  complete a Web of Wellbeing assessment").
 *
 *  Every dimension asks the same two layers (the founder's Economic framing,
 *  generalized): WHERE ARE YOU NOW (their words + an optional score), then
 *  WHAT'S IN THE WAY — split into inner (beliefs, feelings, stories) and
 *  outer (real-world obstacles), because those need different help: one is
 *  care-team work, the other is coordinator work.
 *
 *  The Economic step also carries the four numbers (debts, assets, monthly
 *  expenses, monthly income + household size) into financial_positions —
 *  the subsidy formula's only inputs — while the money FEELINGS stay in the
 *  WOW entry like any other dimension: the care team reads the story, the
 *  formula reads only numbers, providers see neither.
 *
 *  Each step saves when you finish it (Next weaves it in; Skip doesn't), so
 *  stopping halfway loses nothing. A dimension already spoken to shows ✓
 *  AND ITS ANSWERS SIT IN THEIR OWN BUBBLES (founder 2026-09-22, second and
 *  third pass: a checkmark against empty fields read as lost work, and a
 *  summary box at the top wasn't it — "Put the answers where they belong
 *  with green to signal they're saved"): the latest woven entry hydrates
 *  the fields via decomposeBody() (composeBody's exact inverse — its labels
 *  are fixed strings), rendered green/read-only. Clicking any answer, or
 *  the Edit CTA top-right, unlocks edit mode; saving UPDATES the entry in
 *  place through updateWowCarePost() (RLS's self-arm allows it) — never a
 *  duplicate. A score alone weaves as a valid entry (care_posts_nonempty
 *  carries a wow-score arm for exactly this).
 *
 *  ASSESSMENTS (founder 2026-09-22, fourth pass): the intake's entries
 *  group under one OPEN wow_assessments row — editable here until Finish
 *  SUBMITS it (submitted_at is the timestamp that lets assessments be read
 *  over time), after which the next visit starts a fresh one. One entry —
 *  one score — per dimension per assessment, structurally. An overall
 *  number (the average of this assessment's saved scores) reads at the
 *  top. Pre-assessment entries are ADOPTED into the member's first open
 *  assessment on arrival, folding any newer score-only duplicate's number
 *  into the substantive entry and removing the duplicate row.
 *
 *  REAL-TIME AUTOSAVE (founder 2026-09-22, after toggling away lost an
 *  unwoven answer): everything typed but not yet woven autosaves into
 *  wow_intake_drafts on a 1.2s debounce (the page_drafts idiom) and is
 *  FLUSHED IMMEDIATELY when the tab hides or unloads, and the page reopens
 *  ON THE STEP you left, words intact — cross-device, since the draft lives
 *  in the DB, not this browser. The draft holds only what DIFFERS from the
 *  saved baseline (unwoven answers, or in-progress edits of a saved one),
 *  so it can never re-arm a double-post; the row is deleted when the draft
 *  empties or the intake finishes — a row means unsaved work, always.
 *  Owner-only RLS; no assistant path ever reads a draft (the per-entry AI
 *  hold-back is chosen at weave time, so nothing may read the words before
 *  then). ⚠ The app's scroller is #root, not window — go() scrolls it
 *  the way App.tsx's route-change reset does, or "continue" lands the
 *  reader mid-page. */

type StepId = 'welcome' | Dimension | 'close';

interface DimAnswers {
  where: string; extra: string; inner: string; outer: string;
  /** Economic only: the FULL text of the mirror question being answered —
   *  check-marked by the member, written into the finished assessment
   *  (founder 2026-09-22: '"ask me the other question" goes away and
   *  becomes the other question'). Empty = the auto frame decides. */
  asked: string;
  /** Economic only: the optional give-back offer — assets are defined many
   *  ways (founder 2026-09-22). */
  give: string;
  score: number | null; omit: boolean;
}

const blankDim = (): DimAnswers => ({ where: '', extra: '', inner: '', outer: '', asked: '', give: '', score: null, omit: false });

// The Economic RELATIONSHIP statements — selected FIRST, at the top of the
// step (founder 2026-09-23: "Let's allow you to select first", title "What
// is your current relationship with money and resources", all three
// re-written as declarations in her words). The chosen statement is written
// into the finished entry; the checked one decides which optional door
// leads. Order is hers: needs unmet · balanced · holding more.
const Q_LITTLE = 'I am not getting my needs met. I struggle to earn sufficient money, and/or procure adequate resources to support myself and those who rely on me.';
const Q_BALANCED = 'I maintain a healthy balance of resourcing myself and contributing to the rebalancing of the collective.';
const Q_MUCH = 'I hold on to more resource and financial abundance than I need to live a rich and fulfilling life. I struggle to release value back into the collective where it is needed.';
// An entry woven under an older phrasing (the retired mirror QUESTIONS)
// maps onto today's statement by its distinctive words, so the selector
// lights the right chip and a re-save upgrades the stored line quietly.
const normalizeAsked = (asked: string): string => {
  if (!asked || asked === Q_LITTLE || asked === Q_BALANCED || asked === Q_MUCH) return asked;
  if (asked.includes('healthy balance')) return Q_BALANCED;
  if (asked.includes('hold on to more') || asked.includes('re-allocat')) return Q_MUCH;
  return Q_LITTLE;
};

/** The two-layer prompts, tuned per dimension so nothing reads generic —
 *  every dimension carries its OWN Inner and Outer label (founder
 *  2026-09-22: "the mental ones aren't a comprehensive boiler plate...
 *  customize as needed across all 6"; reusing a word like "beliefs" across
 *  threads is fine where it fits). */
const PROMPTS: Record<Dimension, {
  where: string; way: string; inner: string; outer: string;
  /** An extra dimension-specific section (founder 2026-09-22: the Body step
   *  asks for diagnostics, diagnoses and illnesses currently carried). */
  extra?: { label: string; placeholder: string };
}> = {
  Mental: {
    where: 'How is your mind these days — clarity, mood, what occupies you?',
    way: 'caring for your mental wellbeing',
    inner: 'thought patterns, worries, the stories you tell yourself',
    outer: 'pressures, workload, what your days demand',
  },
  Physical: {
    where: 'How is your body — energy, pain, sleep, movement?',
    way: 'caring for your body',
    inner: 'beliefs, habits, diet, exercise and body care practices',
    outer: 'access to care, time, food, rest',
    extra: {
      label: 'Diagnostics, diagnoses and physical illnesses you currently carry',
      placeholder: 'Test results, conditions, what you’re living with…',
    },
  },
  Social: {
    where: 'How held are you by other people — friends, family, community?',
    way: 'building healthier connections with others',
    inner: 'trust, shyness, beliefs about belonging',
    outer: 'distance, schedules, finding your people',
  },
  Spiritual: {
    where: 'What feeds your spirit right now — practice, nature, meaning — and how connected to it are you?',
    way: 'your spiritual life',
    inner: 'beliefs, doubts, the stories you carry',
    outer: 'time, space and community for practice',
  },
  Environmental: {
    where: 'How are the places you live and move through — home, land, neighborhood — treating you?',
    way: 'your surroundings supporting you',
    inner: 'habits, attachments, how you relate to your surroundings',
    outer: 'housing, noise, access to nature',
  },
  Economic: {
    // Economic runs its own shape: the relationship-statement selector
    // leads, then this, then ONE long-form in-the-way field — so `way`,
    // `inner` and `outer` never render for it (founder 2026-09-23).
    where: 'What are your thoughts and feelings around money right now?',
    way: '',
    inner: '',
    outer: '',
  },
};

const money = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : Math.round(n);
};

// composeBody's labels are fixed strings, so a woven entry splits back into
// its bubbles exactly. An entry written elsewhere (free text) lands whole in
// the first field — nothing is ever dropped.
const DIAG_TAG = 'Diagnostics & diagnoses: ';
const ASKED_TAG = 'Asked: ';
const INNER_TAG = 'In the way — inner (beliefs, feelings): ';
const OUTER_TAG = 'In the way — outer (the world): ';
// Economic's in-the-way answer is ONE long-form field now (founder
// 2026-09-23: "What is in the way should be long form") — composed under
// this general tag; legacy Economic entries with INNER/OUTER sections
// hydrate merged into it (see the hydration effect).
const WAY_TAG = 'In the way: ';
const GIVE_TAG = 'Giving back: ';
const decomposeBody = (body: string): { where: string; extra: string; inner: string; outer: string; asked: string; give: string } => {
  let where = body; let extra = ''; let inner = ''; let outer = ''; let asked = ''; let give = '';
  const gi = where.indexOf(GIVE_TAG);
  if (gi >= 0) { give = where.slice(gi + GIVE_TAG.length).trim(); where = where.slice(0, gi); }
  const oi = where.indexOf(OUTER_TAG);
  if (oi >= 0) { outer = where.slice(oi + OUTER_TAG.length).trim(); where = where.slice(0, oi); }
  const ii = where.indexOf(INNER_TAG);
  if (ii >= 0) { inner = where.slice(ii + INNER_TAG.length).trim(); where = where.slice(0, ii); }
  // The general long-form tag (Economic) lands in the same `inner` slot —
  // an entry carries either the inner/outer pair or this, never both.
  const wi = where.indexOf(WAY_TAG);
  if (wi >= 0) { inner = where.slice(wi + WAY_TAG.length).trim(); where = where.slice(0, wi); }
  const ai = where.indexOf(ASKED_TAG);
  if (ai >= 0) { asked = where.slice(ai + ASKED_TAG.length).trim(); where = where.slice(0, ai); }
  const di = where.indexOf(DIAG_TAG);
  if (di >= 0) { extra = where.slice(di + DIAG_TAG.length).trim(); where = where.slice(0, di); }
  return { where: where.trim(), extra, inner, outer, asked, give };
};

const sameAnswers = (a: DimAnswers, b: DimAnswers): boolean =>
  a.where.trim() === b.where.trim() && a.extra.trim() === b.extra.trim()
  && a.inner.trim() === b.inner.trim() && a.outer.trim() === b.outer.trim()
  && a.asked === b.asked && a.give.trim() === b.give.trim()
  && a.score === b.score && a.omit === b.omit;

export default function WowIntake() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<StepId>('welcome');
  const [dims, setDims] = useState<Record<Dimension, DimAnswers>>(
    () => Object.fromEntries(WOW_DIMENSIONS.map((d) => [d, blankDim()])) as Record<Dimension, DimAnswers>,
  );
  // Each woven dimension's entry id + the answers as saved — the fields show
  // this baseline in green until edited, and saving updates the same row.
  const [saved, setSaved] = useState<Partial<Record<Dimension, { id: string; base: DimAnswers }>>>({});
  // Saved dims currently unlocked for editing (click an answer or the Edit CTA).
  const [editing, setEditing] = useState<Set<Dimension>>(new Set());
  // BOTH of the Economic step's optional sections are drop-downs now
  // (founder 2026-09-23: "have both the giving to the platform and the
  // receiving subsidies be drop downs" — and the header row stays put when
  // open, so a section can be closed back up).
  const [giveOpen, setGiveOpen] = useState(false);
  const [subsidyOpen, setSubsidyOpen] = useState(false);
  // The OPEN assessment these answers belong to (founder 2026-09-22:
  // editable until submitted, one entry — one score — per dimension per
  // assessment; Finish stamps it and the next visit starts a new one).
  // Created lazily on the first weave; ref mirrors state for async saves.
  const assessmentRef = useRef<string | null>(null);

  // The Economic numbers (merged over the existing financial position, never
  // clobbering fields this screen doesn't carry).
  const [pos, setPos] = useState<FinancialPosition | null>(null);
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState('');
  const [assets, setAssets] = useState('');
  const [debt, setDebt] = useState('');
  const [household, setHousehold] = useState('');

  const [needs, setNeeds] = useState<SubsidyNeed[]>([]);
  const [obstacles, setObstacles] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // The live draft (see the header note): hydrate before first paint of the
  // form, and never autosave until hydration has run — a save fired before
  // the read lands would clobber the very words we're restoring.
  type IntakeDraft = {
    step?: string;
    dims?: Partial<Record<Dimension, DimAnswers>>;
    money?: { income?: string; expenses?: string; assets?: string; debt?: string; household?: string };
    needs?: SubsidyNeed[]; obstacles?: string;
  };
  const hydrated = useRef(false);
  // True once we've SEEN a draft row (at hydration or by writing one). The
  // autosave's empty-branch delete is gated on it: a boot whose draft READ
  // failed or raced the token refresh looks identical to "no draft", and an
  // ungated delete then destroys the member's real row (found live
  // 2026-09-23 in the harness — an expired token's silent empty read).
  const hadDraft = useRef(false);

  useEffect(() => {
    if (!me) return;
    let live = true;
    void (async () => {
      const [openAid, p, draftRow] = await Promise.all([
        myOpenAssessment(me),
        getFinancialPosition(me),
        supabase.from('wow_intake_drafts').select('draft').eq('profile_id', me).maybeSingle(),
      ]);
      let aid = openAid;
      let wovenMap: Partial<Record<Dimension, WovenWowEntry[]>> = {};
      if (aid) {
        wovenMap = await myWovenWowEntries(me, aid);
      } else {
        // No open assessment. Pre-assessment entries (from before assessments
        // existed) become the member's first OPEN assessment, so nobody loses
        // in-flight work: adopt the newest substantive entry per dimension,
        // and a NEWER score-only duplicate folds its number in and steps out
        // (the one-score-per-category rule, and the founder's ✗ on hers).
        const legacy = await myWovenWowEntries(me, null);
        if (Object.keys(legacy).length > 0) {
          aid = await ensureOpenAssessment(me);
          for (const d of WOW_DIMENSIONS) {
            const list = legacy[d];
            if (!list?.length) continue;
            const text = list.find((e) => e.body.trim().length > 0) ?? list[0];
            const dupes = list.filter((e) =>
              e.id !== text.id && !e.body.trim() && e.score != null && e.created_at > text.created_at);
            const foldScore = dupes.length ? dupes[0].score : undefined;
            try {
              await adoptWowEntry(text.id, aid, foldScore);
              for (const dup of dupes) await deleteCarePost(dup.id);
            } catch (e) { console.warn('assessment adoption:', (e as Error).message); continue; }
            wovenMap[d] = [{ ...text, score: foldScore !== undefined ? foldScore : text.score }];
          }
        }
      }
      assessmentRef.current = aid;
      if (!live) return;
      // Saved answers land IN their bubbles: the latest entry per dimension,
      // split back into its fields, held as the baseline saving compares to.
      const sv: Partial<Record<Dimension, { id: string; base: DimAnswers }>> = {};
      const nextDims = Object.fromEntries(WOW_DIMENSIONS.map((d) => [d, blankDim()])) as Record<Dimension, DimAnswers>;
      for (const d of WOW_DIMENSIONS) {
        const e = wovenMap[d]?.[0];
        if (!e) continue;
        const base: DimAnswers = { ...decomposeBody(e.body), score: e.score, omit: !!e.ai_omit };
        if (d === 'Economic') {
          // The in-the-way answer is one long-form field now: a legacy
          // entry's inner/outer sections hydrate merged so no words hide
          // behind a field the screen no longer shows, and an old mirror
          // QUESTION reads back as today's statement. The stored entry is
          // untouched until the member actually re-saves.
          if (base.outer.trim()) {
            base.inner = [base.inner.trim(), base.outer.trim()].filter(Boolean).join('\n\n');
            base.outer = '';
          }
          base.asked = normalizeAsked(base.asked);
        }
        sv[d] = { id: e.id, base };
        nextDims[d] = { ...base };
      }
      setSaved(sv);
      if (p) {
        setPos(p);
        if (p.monthly_income != null) setIncome(String(p.monthly_income));
        if (p.monthly_expenses != null) setExpenses(String(p.monthly_expenses));
        if (p.assets != null) setAssets(String(p.assets));
        if (p.debt != null) setDebt(String(p.debt));
        if (p.household_size != null) setHousehold(String(p.household_size));
        setNeeds((p.needs ?? []) as SubsidyNeed[]);
        setObstacles(p.obstacles ?? '');
      }
      const draft = (draftRow.data as { draft?: IntakeDraft } | null)?.draft;
      if (draft) {
        hadDraft.current = true;
        if (draft.dims) {
          // The draft is what DIFFERS from the saved baseline: an unwoven
          // answer, or an unsaved edit of a woven one — which reopens in
          // edit mode so the reader sees they have changes pending.
          const editSet = new Set<Dimension>();
          for (const d of WOW_DIMENSIONS) {
            const v = draft.dims?.[d];
            if (!v) continue;
            nextDims[d] = { ...blankDim(), ...v };
            if (sv[d]) editSet.add(d);
          }
          setEditing(editSet);
        }
        const m = draft.money;
        if (m) {
          // Draft money strings win only when they hold something — an old
          // draft must not blank numbers edited since on the financial page.
          if (m.income?.trim()) setIncome(m.income);
          if (m.expenses?.trim()) setExpenses(m.expenses);
          if (m.assets?.trim()) setAssets(m.assets);
          if (m.debt?.trim()) setDebt(m.debt);
          if (m.household?.trim()) setHousehold(m.household);
        }
        if (Array.isArray(draft.needs) && draft.needs.length) setNeeds(draft.needs);
        if (draft.obstacles?.trim()) setObstacles(draft.obstacles);
        // Reopen ON the step they left — not back at the welcome prompt.
        if (draft.step === 'close' || (WOW_DIMENSIONS as readonly string[]).includes(draft.step ?? '')) {
          setStep(draft.step as StepId);
        }
      }
      setDims(nextDims);
      hydrated.current = true;
      setReady(true);
    })();
    return () => { live = false; };
  }, [me]);

  // REAL-TIME AUTOSAVE: everything unwoven, 1.2s after the last keystroke —
  // and FLUSHED at once when the tab hides or unloads, so toggling away
  // inside the debounce window never loses the last field typed. An empty
  // draft DELETES the row (a row means unsaved work). Best-effort — a failed
  // save just retries on the next edit.
  // Set when Finish runs — the debounced autosave must not resurrect the
  // draft row after finish() deletes it (a timer armed on the close step
  // can fire mid-finish).
  const finished = useRef(false);

  const writeDraft = (justWove?: Dimension) => {
    if (!me || !hydrated.current || finished.current) return;
    const dimsOut: Partial<Record<Dimension, DimAnswers>> = {};
    for (const d of WOW_DIMENSIONS) {
      // A dim saved this very call flushes as clean — its words just landed
      // on the board, and React's state update hasn't re-rendered yet.
      if (d === justWove) continue;
      const a = dims[d];
      const base = saved[d]?.base;
      if (base) {
        // Saved dims draft only their UNSAVED edits.
        if (!sameAnswers(a, base)) dimsOut[d] = a;
      } else if (a.where.trim() || a.extra.trim() || a.inner.trim() || a.outer.trim() || a.give.trim() || a.asked || a.score != null || a.omit) {
        dimsOut[d] = a;
      }
    }
    const payload: IntakeDraft = {
      step: step === 'welcome' ? undefined : step,
      dims: dimsOut,
      money: { income, expenses, assets, debt, household },
      needs, obstacles,
    };
    const empty = !payload.step && Object.keys(dimsOut).length === 0
      && needs.length === 0 && !obstacles.trim();
    if (empty) {
      // Only delete a row we KNOW exists — see hadDraft above.
      if (hadDraft.current) {
        hadDraft.current = false;
        void supabase.from('wow_intake_drafts').delete().eq('profile_id', me);
      }
      return;
    }
    hadDraft.current = true;
    void supabase.from('wow_intake_drafts')
      .upsert({ profile_id: me, draft: payload, updated_at: new Date().toISOString() })
      .then(({ error: e }) => { if (e) console.warn('intake draft save:', e.message); });
  };
  const writeDraftRef = useRef(writeDraft);
  writeDraftRef.current = writeDraft;

  useEffect(() => {
    if (!me || !ready) return;
    const t = setTimeout(() => writeDraftRef.current(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, ready, step, dims, income, expenses, assets, debt, household, needs, obstacles]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') writeDraftRef.current(); };
    const onGone = () => writeDraftRef.current();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onGone);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onGone);
    };
  }, []);

  const steps: StepId[] = ['welcome', ...WOW_DIMENSIONS, 'close'];
  const at = steps.indexOf(step);
  const go = (delta: number) => {
    const next = steps[Math.min(steps.length - 1, Math.max(0, at + delta))];
    setStep(next);
    // #root is the app's scroller (App.tsx's route-change reset does the
    // same) — window.scrollTo is a no-op here and left readers mid-page.
    (document.getElementById('root') ?? window).scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  };

  const setDim = (d: Dimension, patch: Partial<DimAnswers>) =>
    setDims((cur) => ({ ...cur, [d]: { ...cur[d], ...patch } }));

  /** Compose one honest entry from the two layers — labeled sections, prose
   *  in the feed, nothing invented. */
  const composeBody = (a: DimAnswers, d: Dimension): string => {
    const parts: string[] = [];
    if (a.where.trim()) parts.push(a.where.trim());
    if (a.extra.trim()) parts.push(`${DIAG_TAG}${a.extra.trim()}`);
    // The finished assessment shows WHICH relationship statement was checked.
    if (a.asked) parts.push(`${ASKED_TAG}${a.asked}`);
    if (d === 'Economic') {
      // One long-form in-the-way answer under the general tag; hydration
      // already folded any legacy outer section into it.
      if (a.inner.trim()) parts.push(`${WAY_TAG}${a.inner.trim()}`);
    } else {
      if (a.inner.trim()) parts.push(`${INNER_TAG}${a.inner.trim()}`);
      if (a.outer.trim()) parts.push(`${OUTER_TAG}${a.outer.trim()}`);
    }
    if (a.give.trim()) parts.push(`${GIVE_TAG}${a.give.trim()}`);
    return parts.join('\n\n');
  };

  const dimHasContent = (d: Dimension) => {
    const a = dims[d];
    // A checked relationship statement is a real answer on its own.
    return !!(a.where.trim() || a.extra.trim() || a.inner.trim() || a.outer.trim() || a.give.trim() || a.asked || a.score != null);
  };

  async function saveDim(d: Dimension): Promise<void> {
    const a = dims[d];
    // The Asked: line records only a statement the member CHECKED — an
    // unpicked selector writes nothing (a first-person statement is theirs
    // to declare, never presumed on their behalf).
    const sv = saved[d];
    const aiOmit = a.omit ? (d === 'Economic' ? 'financial' as const : 'other' as const) : null;
    if (sv) {
      // Editing a saved answer updates the SAME entry — never a duplicate.
      if (sameAnswers(a, sv.base)) return;
      await updateWowCarePost(sv.id, { body: composeBody(a, d), score: a.score, aiOmit });
      setSaved((cur) => ({ ...cur, [d]: { id: sv.id, base: { ...a } } }));
    } else {
      if (!dimHasContent(d)) return;
      const aid = assessmentRef.current ?? await ensureOpenAssessment(me);
      assessmentRef.current = aid;
      const id = await createCarePost(me, {
        patientId: me, kind: 'wow', body: composeBody(a, d),
        dimensions: [d], score: a.score ?? undefined,
        attachments: [], links: [], previews: [],
        aiOmit, assessmentId: aid,
      });
      setSaved((cur) => ({ ...cur, [d]: { id, base: { ...a } } }));
    }
    // The answers STAY in their bubbles, now green/saved; flush the draft so
    // a reload can never re-arm what was just posted.
    setEditing((cur) => { const n = new Set(cur); n.delete(d); return n; });
    writeDraft(d);
  }

  async function saveEconNumbers(): Promise<void> {
    const fields = {
      income_band: pos?.income_band ?? null,
      household_size: money(household) ?? pos?.household_size ?? null,
      circumstances: pos?.circumstances ?? null,
      assets: money(assets), debt: money(debt),
      monthly_income: money(income), monthly_expenses: money(expenses),
      needs: (pos?.needs ?? []) as SubsidyNeed[],
      obstacles: pos?.obstacles ?? null,
      ai_omit_fields: pos?.ai_omit_fields ?? [],
    };
    const any = fields.assets != null || fields.debt != null
      || fields.monthly_income != null || fields.monthly_expenses != null || fields.household_size != null;
    if (!any) return;
    await saveFinancialPosition(fields);
  }

  async function next(d?: Dimension) {
    setBusy(true); setError('');
    try {
      if (d) {
        if (d === 'Economic') await saveEconNumbers();
        await saveDim(d);
      }
      go(1);
    } catch (e) {
      setError((e as Error)?.message || 'Something went wrong — nothing was lost, try again.');
    } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true); setError('');
    finished.current = true;
    try {
      const hadNeeds = (pos?.needs?.length ?? 0) > 0;
      await saveFinancialPosition({
        income_band: pos?.income_band ?? null,
        household_size: money(household) ?? pos?.household_size ?? null,
        circumstances: pos?.circumstances ?? null,
        assets: money(assets), debt: money(debt),
        monthly_income: money(income), monthly_expenses: money(expenses),
        needs,
        obstacles: obstacles.trim() || null,
        ai_omit_fields: pos?.ai_omit_fields ?? [],
      });
      // Asking for support summons a human coordinator — the policy's
      // promise that every request gets a real look (once, at the door).
      if (needs.length > 0 && !hadNeeds) await requestFinancialCoordinator();
      // Finishing SUBMITS the assessment — the timestamp that lets
      // assessments be read over time; the next intake starts a fresh one.
      if (assessmentRef.current) await submitAssessment(assessmentRef.current);
      // The intake is finished — the draft row steps out (best-effort;
      // a leftover would only re-land them on the close step).
      await supabase.from('wow_intake_drafts').delete().eq('profile_id', me);
      navigate('/concierge');
    } catch (e) {
      finished.current = false;
      setError((e as Error)?.message || 'Something went wrong — try again.');
      setBusy(false);
    }
  }

  if (!me) return null;

  const margin = (money(income) ?? 0) - (money(expenses) ?? 0);
  const haveNumbers = money(income) != null && money(expenses) != null;
  // The checked statement is EMPTY until the member picks. The retired
  // mirror QUESTIONS took an auto-default from the margin; a first-person
  // STATEMENT is theirs to declare, never pre-checked for them — the
  // heuristic only steers which optional door leads below.
  const econAsked = dims.Economic.asked;
  const autoQ = haveNumbers && margin > 300 && (money(assets) ?? 0) >= (money(debt) ?? 0) ? Q_MUCH : Q_LITTLE;
  // Matched by each statement's distinctive words, not exact text, so an
  // entry woven under an older phrasing keeps its frame when copy shifts
  // ('re-allocat' covers the retired too-much QUESTION). Balanced is
  // self-declared only — the margin heuristic never presumes someone's
  // relationship with money is settled.
  const econFrameOf = (econAsked || autoQ);
  const econFrame: 'little' | 'much' | 'balanced' = econFrameOf.includes('healthy balance')
    ? 'balanced'
    : (econFrameOf.includes('hold on to more') || econFrameOf.includes('re-allocat')) ? 'much' : 'little';

  // The close step's support ask shows ONLY for members actually in the
  // subsidy conversation (founder 2026-09-23: "This should only be included
  // with those asking for subsidies" — the blanket ask was a leftover from
  // when the intake WAS the subsidy enrollment path): numbers in the
  // allocation grid — typed here or standing on their financial profile —
  // or a support need already checked. Everyone else just finishes.
  const subsidyAsk = !!(income.trim() || expenses.trim() || assets.trim()
    || debt.trim() || household.trim() || needs.length > 0);

  // The assessment's overall reading so far — the average of its saved
  // scores (one per dimension, structurally), shown above the steps.
  const assessScores = WOW_DIMENSIONS
    .map((d) => saved[d]?.base.score)
    .filter((s): s is number => s != null);
  const overall = assessScores.length
    ? Math.round(assessScores.reduce((sum, s) => sum + s, 0) / assessScores.length)
    : null;

  const dots = (
    <div className="wintake__dots" aria-label="Your progress">
      {WOW_DIMENSIONS.map((d) => {
        const done = !!saved[d];
        return (
          <button
            key={d} type="button"
            className={'wintake__dot' + (step === d ? ' is-here' : '') + (done ? ' is-done' : '')}
            onClick={() => setStep(d)}
            title={d + (done ? ' — woven in' : '')}
            aria-label={d + (done ? ', answered' : '')}
          >
            <Icon name={DIMENSION_META[d]} size={14} />
            {done && <em aria-hidden>✓</em>}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="wintake">
      <header className="wintake__head">
        <button className="conc__back" onClick={() => navigate('/concierge')} aria-label="Back to Concierge">
          <Icon name="arrow-left" size={18} />
        </button>
        <h1 className="wintake__title">Your Web of Wellbeing</h1>
      </header>
      {step !== 'welcome' && dots}
      {ready && step !== 'welcome' && overall != null && (
        <p className="wintake__overall">
          <strong>{overall}</strong> overall — the average of your {assessScores.length} scored
          thread{assessScores.length > 1 ? 's' : ''} so far
        </p>
      )}

      {!ready && <p className="wintake__muted">Loading…</p>}

      {ready && step === 'welcome' && (
        <section className="wintake__card">
          <p className="wintake__lead">
            Six interwoven threads weaving the strong yet flexible web of
            wellbeing surrounding your life — mental, physical, social,
            spiritual, environmental, economic. Your self assessment will take
            about ten minutes. Your work will be saved if you need to step
            away.
          </p>
          <p className="wintake__promise">
            What you share stays inside Lichen: your care team can read it,
            nobody else — it is never sold and never shared outside the
            network. Any entry can be held out of AI entirely. Your economic
            wellbeing is included as a thread in the web because humans have
            collectively decided to funnel safety, resources and respect
            through a common currency, making one&rsquo;s economic
            circumstances a critical aspect of their overall wellbeing. Since
            we&rsquo;re at a period of great imbalance and inequity — and
            health is a synonym for balance — restoring economic health,
            interconnection and balance is a critical, foundational thread
            that influences our mental, physical, spiritual and social and
            environmental wellbeing.
          </p>
          <button className="btn btn-primary" onClick={() => {
            // Land on the first dimension not yet spoken to.
            const first = WOW_DIMENSIONS.find((d) => !saved[d]) ?? WOW_DIMENSIONS[0];
            setStep(first);
          }}>
            Begin
          </button>
          {Object.keys(saved).length > 0 && (
            <p className="wintake__fine">
              You&rsquo;ve already spoken to {Object.keys(saved).length} of 6 — we&rsquo;ll start at the next one.
            </p>
          )}
        </section>
      )}

      {ready && WOW_DIMENSIONS.map((d) => {
        if (step !== d) return null;
        const a = dims[d];
        const sv = saved[d];
        const lock = !!sv && !editing.has(d);
        const changed = sv ? !sameAnswers(a, sv.base) : dimHasContent(d);
        const unlock = () => { if (sv && !editing.has(d)) setEditing((cur) => new Set(cur).add(d)); };
        return (
          <section className="wintake__card" key={d}>
            <div className="wintake__dimhead">
              <Icon name={DIMENSION_META[d]} size={20} />
              <h2 className="wintake__dimname">{d}</h2>
              {a.score == null ? (
                !lock && (
                  <button className="wintake__scorebtn" onClick={() => setDim(d, { score: 70 })}>
                    Add a score
                  </button>
                )
              ) : (
                <span className={'wintake__scorewrap' + (lock ? ' is-saved' : '')} onClick={unlock}>
                  <input
                    type="range" min={0} max={100} value={a.score}
                    disabled={lock}
                    onChange={(e) => setDim(d, { score: Number(e.target.value) })}
                    aria-label={`${d} score`}
                  />
                  <span className="wintake__scoreval">{a.score}</span>
                  {/* The bare × means "never mind, no score" — right for an
                      answer not yet saved, but on a SAVED one it read as
                      "close editing" and seemed to eat the score (founder
                      2026-09-22): saved dims say "Remove score" in words. */}
                  {!lock && !sv && (
                    <button className="wintake__scoreclear" onClick={() => setDim(d, { score: null })} aria-label="Remove score">×</button>
                  )}
                </span>
              )}
              {!lock && sv && a.score != null && (
                <button className="wintake__scoreremove" onClick={() => setDim(d, { score: null })}>
                  Remove score
                </button>
              )}
              {lock && (
                <button className="wintake__editbtn" onClick={unlock}>Edit</button>
              )}
              {sv && editing.has(d) && (
                <button
                  className="wintake__cancelbtn"
                  onClick={() => {
                    // Back out of the edit: everything saved comes back —
                    // words, score, the AI hold-back — and the fields re-lock.
                    setDims((cur) => ({ ...cur, [d]: { ...sv.base } }));
                    setEditing((cur) => { const n = new Set(cur); n.delete(d); return n; });
                    writeDraft(d);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>

            {lock && (
              <p className="wintake__woven">
                Saved on your board ✓ — tap Edit, or any answer, to change it.
              </p>
            )}

            {/* Economic selects FIRST (founder 2026-09-23: "Let's allow you
                to select first") — the statement checked here frames the
                rest of the step. Locked, only the chosen statement shows. */}
            {d === 'Economic' && (!lock || econAsked) && (
              <div className={'wintake__mqs' + (lock ? ' wintake__mqs--saved' : '')}>
                <p className="wintake__waylead">
                  What is your current relationship with money and resources?
                </p>
                {(lock ? [econAsked] : [Q_LITTLE, Q_BALANCED, Q_MUCH]).map((q) => (
                  <label
                    className={'wintake__mq' + (econAsked === q ? ' is-on' : '')}
                    key={q}
                    onClick={lock ? unlock : undefined}
                  >
                    <input
                      type="checkbox" checked={econAsked === q} disabled={lock}
                      onChange={() => setDim(d, { asked: q })}
                    />
                    <span>{q}</span>
                  </label>
                ))}
              </div>
            )}

            <label className={'wintake__q' + (lock ? ' wintake__q--saved' : '')}>
              <span>{PROMPTS[d].where}</span>
              <textarea
                value={a.where} readOnly={lock} onFocus={unlock}
                onChange={(e) => setDim(d, { where: e.target.value })}
                placeholder="In your own words…"
              />
            </label>

            {PROMPTS[d].extra && (
              <label className={'wintake__q' + (lock ? ' wintake__q--saved' : '')}>
                <span>{PROMPTS[d].extra.label}</span>
                <textarea
                  value={a.extra} readOnly={lock} onFocus={unlock}
                  onChange={(e) => setDim(d, { extra: e.target.value })}
                  placeholder={PROMPTS[d].extra.placeholder}
                />
              </label>
            )}

            {d === 'Economic' ? (
              /* In-the-way follows the selection it relates to, LONG FORM
                 (founder 2026-09-23: "'What is in the way...' makes more
                 sense, as it will be related to what you selected" + "What
                 is in the way should be long form") — one field, no
                 inner/outer split here. */
              <label className={'wintake__q wintake__q--long' + (lock ? ' wintake__q--saved' : '')}>
                <span>
                  What&rsquo;s in the way of a healthier relationship to
                  money and resource allocation?
                </span>
                <textarea
                  value={a.inner} readOnly={lock} onFocus={unlock}
                  onChange={(e) => setDim(d, { inner: e.target.value })}
                  placeholder="Take your time — beliefs, feelings, real-world obstacles, whatever stands in the way…"
                />
              </label>
            ) : (
              <>
                <p className="wintake__waylead">What&rsquo;s in the way of {PROMPTS[d].way}?</p>
                <div className="wintake__way">
                  <label className={'wintake__q' + (lock ? ' wintake__q--saved' : '')}>
                    <span>Inner — {PROMPTS[d].inner}</span>
                    <textarea
                      value={a.inner} readOnly={lock} onFocus={unlock}
                      onChange={(e) => setDim(d, { inner: e.target.value })}
                      placeholder="What you tell yourself…"
                    />
                  </label>
                  <label className={'wintake__q' + (lock ? ' wintake__q--saved' : '')}>
                    <span>Outer — {PROMPTS[d].outer}</span>
                    <textarea
                      value={a.outer} readOnly={lock} onFocus={unlock}
                      onChange={(e) => setDim(d, { outer: e.target.value })}
                      placeholder="Time, money, distance, access…"
                    />
                  </label>
                </div>
              </>
            )}

            {d === 'Economic' && (() => {
              // Two OPTIONAL sections, BOTH drop-downs whose header row
              // stays put so an open one closes back up (founder
              // 2026-09-23); the relevant one still leads per the checked
              // statement — tighter-than-you-need leads with receiving
              // subsidies, more-than-you-need with giving back.
              //
              // The weave doors open POP-UP flows (founder 2026-09-23: "a
              // pop up marketplace and a pop up donations page") — the
              // form stays right here underneath, so finishing the gift or
              // the donation lands the member back on it by construction.
              // Current never moves on the intake's own word — the pop-ups
              // are the flows that already carry the consent steps. The
              // draft flushes first in case the browser refuses the popup
              // and we fall back to plain navigation.
              const goPopup = (path: string) => {
                writeDraft();
                const w = window.open(path, 'lichen-weave', 'popup=yes,width=560,height=800');
                if (!w) navigate(path);
              };
              const subsidySec = (
                <div className="wintake__optsec" key="subsidy">
                  <button
                    type="button"
                    className={'wintake__optfold' + (subsidyOpen ? ' is-open' : '')}
                    aria-expanded={subsidyOpen}
                    onClick={() => setSubsidyOpen((v) => !v)}
                  >
                    <span>Optional — if you&rsquo;d like to receive subsidies on the platform</span>
                    <Icon name="chevron-right" size={13} />
                  </button>
                  {subsidyOpen && (
                    <div className="wintake__money">
                      <p className="wintake__moneylead">
                        These numbers are what the subsidy formula reads. Your care
                        team can see them; providers never do, and no AI reads any
                        line you hold back on your{' '}
                        <a href="/concierge/financial">financial profile</a>.
                      </p>
                      <div className="wintake__moneygrid">
                        <label>Monthly income
                          <input inputMode="decimal" value={income}
                            onChange={(e) => setIncome(e.target.value)} placeholder="$" />
                        </label>
                        <label>Monthly expenses
                          <input inputMode="decimal" value={expenses}
                            onChange={(e) => setExpenses(e.target.value)} placeholder="$" />
                        </label>
                        <label>Assets
                          <input inputMode="decimal" value={assets}
                            onChange={(e) => setAssets(e.target.value)} placeholder="$ — savings, home, vehicles" />
                        </label>
                        <label>Debts
                          <input inputMode="decimal" value={debt}
                            onChange={(e) => setDebt(e.target.value)} placeholder="$ — loans, cards, medical" />
                        </label>
                        <label>People in your household
                          <input inputMode="numeric" value={household}
                            onChange={(e) => setHousehold(e.target.value)} placeholder="including you" />
                        </label>
                      </div>
                    </div>
                  )}
                  {/* The honest term, stated up front (founder 2026-09-23):
                      subsidies are allocated by an objective algorithm, and
                      asking for them means your information goes into it. */}
                  <p className="wintake__subnote">
                    If you want subsidies, your information has to be put into
                    the algorithm for subsidy allocation — objectively.
                  </p>
                </div>
              );
              const giveSec = (
                <div className="wintake__optsec" key="give">
                  <button
                    type="button"
                    className={'wintake__optfold' + (giveOpen ? ' is-open' : '')}
                    aria-expanded={giveOpen}
                    onClick={() => setGiveOpen((v) => !v)}
                  >
                    <span>Optional — if you&rsquo;d like to give back on the platform</span>
                    <Icon name="chevron-right" size={13} />
                  </button>
                  {giveOpen && (
                    <div className="wintake__money">
                      <label className={'wintake__q' + (lock ? ' wintake__q--saved' : '')}>
                        <span>
                          Your assets are defined many ways — money, goods,
                          services, skills, time. What would you like to offer
                          the collective?
                        </span>
                        <textarea
                          value={a.give} readOnly={lock} onFocus={unlock}
                          onChange={(e) => setDim(d, { give: e.target.value })}
                          placeholder="A service you’d volunteer, goods you’d gift, time, skills…"
                        />
                      </label>
                      <p className="wintake__moneylead">
                        Weave it into the network — turn words into action
                      </p>
                      <div className="wintake__givecols">
                        <button
                          type="button" className="wintake__givecol"
                          onClick={() => goPopup('/compose?area=marketplace&popup=1'
                            + (a.give.trim() ? '&body=' + encodeURIComponent(a.give.trim()) : ''))}
                        >
                          Gift time, expertise, goods and services to the
                          network via Marketplace
                        </button>
                        <button
                          type="button" className="wintake__givecol"
                          onClick={() => goPopup('/donate?popup=1')}
                        >
                          Give dollars that translate into real goods and
                          services distributed to those in need on the network
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
              return econFrame === 'little'
                ? <>{subsidySec}{giveSec}</>
                : <>{giveSec}{subsidySec}</>;
            })()}

            <label className="wintake__omit" onClick={unlock}>
              <input type="checkbox" checked={a.omit} disabled={lock} onChange={(e) => setDim(d, { omit: e.target.checked })} />
              <span>Keep this entry out of AI — only humans on your care team read it</span>
            </label>

            {error && <p className="wintake__error">{error}</p>}
            <div className="wintake__nav">
              {at > 1 && <button className="btn" onClick={() => go(-1)}>Back</button>}
              <span className="wintake__navgap" />
              {changed ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => void next(d)}>
                  {busy ? (sv ? 'Saving…' : 'Weaving in…') : sv ? 'Save changes & continue' : 'Weave it in & continue'}
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => void next(d)}>
                  {sv ? 'Continue' : 'Skip for now'}
                </button>
              )}
            </div>
          </section>
        );
      })}

      {ready && step === 'close' && (
        <section className="wintake__card">
          {subsidyAsk ? (
            <>
              <h2 className="wintake__dimname">One last thing</h2>
              <p className="wintake__lead">
                Is there anything you need the network&rsquo;s support to carry?
                Checking a box asks a real person to take a look — every request
                gets a human read, and every decision is recorded with its
                reasons. Nothing here is ever visible to providers or donors.
              </p>
              <div className="wintake__needs">
                {SUBSIDY_NEEDS.map((n) => {
                  const on = needs.includes(n.value);
                  return (
                    <label className={'wintake__need' + (on ? ' is-on' : '')} key={n.value}>
                      <input
                        type="checkbox" checked={on}
                        onChange={() => setNeeds((cur) => (on ? cur.filter((x) => x !== n.value) : [...cur, n.value]))}
                      />
                      <span><strong>{n.label}</strong><em>{n.hint}</em></span>
                    </label>
                  );
                })}
              </div>
              {needs.length > 0 && (
                <label className="wintake__q">
                  <span>What&rsquo;s in the way that money alone won&rsquo;t fix? (optional)</span>
                  <textarea
                    value={obstacles}
                    onChange={(e) => setObstacles(e.target.value)}
                    placeholder="Leave that won’t be approved, a schedule that can’t bend, a system that won’t listen…"
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <h2 className="wintake__dimname">Your web is woven</h2>
              <p className="wintake__lead">
                Finish stamps this assessment with today&rsquo;s date, so the
                next one can show how things move over time. Every thread you
                wove is on your board.
              </p>
              <p className="wintake__fine">
                If you ever want subsidies on the platform, the door is on the
                Economic step — your information goes into the algorithm for
                subsidy allocation, objectively.
              </p>
            </>
          )}
          {error && <p className="wintake__error">{error}</p>}
          <div className="wintake__nav">
            <button className="btn" onClick={() => go(-1)}>Back</button>
            <span className="wintake__navgap" />
            <button className="btn btn-primary" disabled={busy} onClick={() => void finish()}>
              {busy ? 'Finishing…' : needs.length > 0 ? 'Finish & ask for support' : 'Finish'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
