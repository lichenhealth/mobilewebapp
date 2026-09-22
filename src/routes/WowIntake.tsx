import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import {
  WOW_DIMENSIONS, DIMENSION_META, createCarePost, myWovenWowEntries,
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
 *  AND SHOWS WHAT WAS WOVEN (founder 2026-09-22: a checkmark against empty
 *  fields read as lost work) — its entries render read-only above the
 *  fields, which stay open as an "add more" composer; the board stays an
 *  append-only journal, nothing is replaced. A score alone weaves as a
 *  valid entry (care_posts_nonempty carries a wow-score arm for exactly
 *  this — going back to add a number to something already spoken to).
 *
 *  REAL-TIME AUTOSAVE (founder 2026-09-22, after toggling away lost an
 *  unwoven answer): everything typed but not yet woven autosaves into
 *  wow_intake_drafts on a 1.2s debounce (the page_drafts idiom) and is
 *  FLUSHED IMMEDIATELY when the tab hides or unloads, and the page reopens
 *  ON THE STEP you left, words intact — cross-device, since the draft lives
 *  in the DB, not this browser. The fields only ever hold UNWOVEN words
 *  (weaving clears them into the read-only display above), so the draft can
 *  never re-arm a double-post; the row is deleted when the draft empties or
 *  the intake finishes — a row means unsaved work, always. Owner-only RLS;
 *  no assistant path ever reads a draft (the per-entry AI hold-back is
 *  chosen at weave time, so nothing may read the words before then). */

type StepId = 'welcome' | Dimension | 'close';

interface DimAnswers { where: string; inner: string; outer: string; score: number | null; omit: boolean }

const blankDim = (): DimAnswers => ({ where: '', inner: '', outer: '', score: null, omit: false });

/** The two-layer prompts, tuned per dimension so nothing reads generic.
 *  `inner` overrides the Inner layer's label where the generic
 *  "beliefs, feelings, the stories you carry" doesn't fit the thread
 *  (founder 2026-09-22: the body's inner layer is "beliefs, habits and
 *  body care routines"). */
const PROMPTS: Record<Dimension, { where: string; way: string; inner?: string }> = {
  Mental: {
    where: 'How is your mind these days — clarity, mood, what occupies you?',
    way: 'caring for your mental wellbeing',
  },
  Physical: {
    where: 'How is your body — energy, pain, sleep, movement?',
    way: 'caring for your body',
    inner: 'beliefs, habits and body care routines',
  },
  Social: {
    where: 'How held are you by other people — friends, family, community?',
    way: 'connection with others',
  },
  Spiritual: {
    where: 'What feeds your spirit right now — practice, nature, meaning — and how connected to it are you?',
    way: 'your spiritual life',
  },
  Environmental: {
    where: 'How are the places you live and move through — home, land, neighborhood — treating you?',
    way: 'your surroundings supporting you',
  },
  Economic: {
    where: 'What are your thoughts and feelings around money right now?',
    way: '', // Economic asks its own adaptive question below.
  },
};

const money = (s: string): number | null => {
  const n = Number(s.replace(/[^0-9.]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : Math.round(n);
};

export default function WowIntake() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const me = user?.id ?? '';

  const [answered, setAnswered] = useState<Set<Dimension>>(new Set());
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<StepId>('welcome');
  const [dims, setDims] = useState<Record<Dimension, DimAnswers>>(
    () => Object.fromEntries(WOW_DIMENSIONS.map((d) => [d, blankDim()])) as Record<Dimension, DimAnswers>,
  );
  // Woven-in this session — feeds the progress dots alongside `answered`.
  const savedNow = useRef(new Set<Dimension>());
  // What's already on the board, per dimension, newest first — displayed on
  // each answered step so the checkmark never sits against empty fields.
  const [woven, setWoven] = useState<Partial<Record<Dimension, WovenWowEntry[]>>>({});

  // The Economic numbers (merged over the existing financial position, never
  // clobbering fields this screen doesn't carry).
  const [pos, setPos] = useState<FinancialPosition | null>(null);
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState('');
  const [assets, setAssets] = useState('');
  const [debt, setDebt] = useState('');
  const [household, setHousehold] = useState('');
  // The founder's mirror question: too little vs too much. Adaptive from
  // their own numbers, always flippable — nobody is told which they are.
  const [moneyFrame, setMoneyFrame] = useState<'auto' | 'little' | 'much'>('auto');

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

  useEffect(() => {
    if (!me) return;
    let live = true;
    void (async () => {
      const [wovenMap, p, draftRow] = await Promise.all([
        myWovenWowEntries(me),
        getFinancialPosition(me),
        supabase.from('wow_intake_drafts').select('draft').eq('profile_id', me).maybeSingle(),
      ]);
      if (!live) return;
      setWoven(wovenMap);
      setAnswered(new Set(Object.keys(wovenMap) as Dimension[]));
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
        if (draft.dims) {
          setDims((cur) => {
            const next = { ...cur };
            for (const d of WOW_DIMENSIONS) {
              // Fields only ever hold UNWOVEN words (weaving clears them),
              // so every drafted dimension hydrates — on an answered step
              // it's an unsent addition, shown under the woven display.
              const v = draft.dims?.[d];
              if (v) next[d] = { ...blankDim(), ...v };
            }
            return next;
          });
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
  const writeDraft = (justWove?: Dimension) => {
    if (!me || !hydrated.current) return;
    const dimsOut: Partial<Record<Dimension, DimAnswers>> = {};
    for (const d of WOW_DIMENSIONS) {
      // A dim woven this very call flushes as blank — its words just moved
      // to the board, and React's state clear hasn't re-rendered yet.
      if (d === justWove) continue;
      const a = dims[d];
      if (a.where.trim() || a.inner.trim() || a.outer.trim() || a.score != null || a.omit) dimsOut[d] = a;
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
      void supabase.from('wow_intake_drafts').delete().eq('profile_id', me);
      return;
    }
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
    window.scrollTo({ top: 0 });
  };

  const setDim = (d: Dimension, patch: Partial<DimAnswers>) =>
    setDims((cur) => ({ ...cur, [d]: { ...cur[d], ...patch } }));

  /** Compose one honest entry from the two layers — labeled sections, prose
   *  in the feed, nothing invented. */
  const composeBody = (a: DimAnswers): string => {
    const parts: string[] = [];
    if (a.where.trim()) parts.push(a.where.trim());
    if (a.inner.trim()) parts.push(`In the way — inner (beliefs, feelings): ${a.inner.trim()}`);
    if (a.outer.trim()) parts.push(`In the way — outer (the world): ${a.outer.trim()}`);
    return parts.join('\n\n');
  };

  const dimHasContent = (d: Dimension) => {
    const a = dims[d];
    return !!(a.where.trim() || a.inner.trim() || a.outer.trim() || a.score != null);
  };

  async function saveDim(d: Dimension): Promise<void> {
    const a = dims[d];
    if (!dimHasContent(d)) return;
    await createCarePost(me, {
      patientId: me, kind: 'wow', body: composeBody(a),
      dimensions: [d], score: a.score ?? undefined,
      attachments: [], links: [], previews: [],
      aiOmit: a.omit ? (d === 'Economic' ? 'financial' : 'other') : null,
    });
    savedNow.current.add(d);
    // The words move to the board: show them in the woven display, clear the
    // fields (they're the "add more" composer now), and flush the draft so a
    // reload can never re-arm what was just posted.
    setWoven((cur) => ({
      ...cur,
      [d]: [
        { body: composeBody(a), score: a.score, dimensions: [d], created_at: new Date().toISOString() },
        ...(cur[d] ?? []),
      ],
    }));
    setAnswered((cur) => new Set(cur).add(d));
    setDims((cur) => ({ ...cur, [d]: blankDim() }));
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
      // The intake is finished — the draft row steps out (best-effort;
      // a leftover would only re-land them on the close step).
      await supabase.from('wow_intake_drafts').delete().eq('profile_id', me);
      navigate('/concierge');
    } catch (e) {
      setError((e as Error)?.message || 'Something went wrong — try again.');
      setBusy(false);
    }
  }

  if (!me) return null;

  const margin = (money(income) ?? 0) - (money(expenses) ?? 0);
  const haveNumbers = money(income) != null && money(expenses) != null;
  const frame: 'little' | 'much' = moneyFrame !== 'auto'
    ? moneyFrame
    : haveNumbers && margin > 300 && (money(assets) ?? 0) >= (money(debt) ?? 0) ? 'much' : 'little';

  const dots = (
    <div className="wintake__dots" aria-label="Your progress">
      {WOW_DIMENSIONS.map((d) => {
        const done = answered.has(d) || savedNow.current.has(d);
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
            const first = WOW_DIMENSIONS.find((d) => !answered.has(d)) ?? WOW_DIMENSIONS[0];
            setStep(first);
          }}>
            Begin
          </button>
          {answered.size > 0 && (
            <p className="wintake__fine">
              You&rsquo;ve already spoken to {answered.size} of 6 — we&rsquo;ll start at the next one.
            </p>
          )}
        </section>
      )}

      {ready && WOW_DIMENSIONS.map((d) => {
        if (step !== d) return null;
        const a = dims[d];
        const wovenHere = woven[d] ?? [];
        const isWoven = wovenHere.length > 0 || answered.has(d);
        return (
          <section className="wintake__card" key={d}>
            <div className="wintake__dimhead">
              <Icon name={DIMENSION_META[d]} size={20} />
              <h2 className="wintake__dimname">{d}</h2>
              {a.score == null ? (
                <button className="wintake__scorebtn" onClick={() => setDim(d, { score: 70 })}>
                  Add a score
                </button>
              ) : (
                <span className="wintake__scorewrap">
                  <input
                    type="range" min={0} max={100} value={a.score}
                    onChange={(e) => setDim(d, { score: Number(e.target.value) })}
                    aria-label={`${d} score`}
                  />
                  <span className="wintake__scoreval">{a.score}</span>
                  <button className="wintake__scoreclear" onClick={() => setDim(d, { score: null })} aria-label="Remove score">×</button>
                </span>
              )}
            </div>

            {wovenHere.length > 0 && (
              <div className="wintake__wovenbox">
                <p className="wintake__woven">
                  Woven into your board ✓ — anything you add below weaves in
                  alongside it, nothing is replaced.
                </p>
                {wovenHere.map((w, i) => (
                  <blockquote className="wintake__wovenentry" key={w.created_at + i}>
                    {w.body.trim() && <p>{w.body}</p>}
                    <footer>
                      {w.score != null && <span className="wintake__wovenscore">Score {w.score}</span>}
                      <time>{new Date(w.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>
                    </footer>
                  </blockquote>
                ))}
              </div>
            )}

            {d === 'Economic' && (
              <div className="wintake__money">
                <p className="wintake__moneylead">
                  First, the picture in numbers — these are what the subsidy
                  formula reads. Your care team can see them; providers never
                  do, and no AI reads any line you hold back on your{' '}
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

            <label className="wintake__q">
              <span>{PROMPTS[d].where}</span>
              <textarea
                value={a.where}
                onChange={(e) => setDim(d, { where: e.target.value })}
                placeholder={isWoven ? 'Add more in your own words…' : 'In your own words…'}
              />
            </label>

            {d === 'Economic' ? (
              <>
                <p className="wintake__waylead">
                  {frame === 'little'
                    ? 'If money is tighter than you need — what is keeping you from earning more?'
                    : 'If you hold more than you need — what is keeping you from re-allocating it?'}
                  {' '}
                  <button type="button" className="wintake__flip" onClick={() => setMoneyFrame(frame === 'little' ? 'much' : 'little')}>
                    {frame === 'little' ? 'Ask me the other question' : 'Ask me the other question'}
                  </button>
                </p>
              </>
            ) : (
              <p className="wintake__waylead">What&rsquo;s in the way of {PROMPTS[d].way}?</p>
            )}
            <div className="wintake__way">
              <label className="wintake__q">
                <span>Inner — {PROMPTS[d].inner ?? 'beliefs, feelings, the stories you carry'}</span>
                <textarea
                  value={a.inner}
                  onChange={(e) => setDim(d, { inner: e.target.value })}
                  placeholder={d === 'Economic' ? '“I’m bad with money”, “asking is shameful”…' : 'What you tell yourself…'}
                />
              </label>
              <label className="wintake__q">
                <span>Outer — real-world obstacles</span>
                <textarea
                  value={a.outer}
                  onChange={(e) => setDim(d, { outer: e.target.value })}
                  placeholder={d === 'Economic' ? 'Hours, childcare, credentials, a market that won’t pay…' : 'Time, money, distance, access…'}
                />
              </label>
            </div>

            <label className="wintake__omit">
              <input type="checkbox" checked={a.omit} onChange={(e) => setDim(d, { omit: e.target.checked })} />
              <span>Keep this entry out of AI — only humans on your care team read it</span>
            </label>

            {error && <p className="wintake__error">{error}</p>}
            <div className="wintake__nav">
              {at > 1 && <button className="btn" onClick={() => go(-1)}>Back</button>}
              <span className="wintake__navgap" />
              {dimHasContent(d) ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => void next(d)}>
                  {busy ? 'Weaving in…' : 'Weave it in & continue'}
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => void next(d)}>
                  {isWoven ? 'Continue' : 'Skip for now'}
                </button>
              )}
            </div>
          </section>
        );
      })}

      {ready && step === 'close' && (
        <section className="wintake__card">
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
