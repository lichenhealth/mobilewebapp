import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { useAuth } from '../auth/AuthProvider';
import {
  WOW_DIMENSIONS, DIMENSION_META, createCarePost, myAnsweredWowDimensions, type Dimension,
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
 *  stopping halfway loses nothing. A dimension already spoken to shows ✓ and
 *  is never re-asked — the board stays an append-only journal; more words
 *  are always welcome from the board itself. */

type StepId = 'welcome' | Dimension | 'close';

interface DimAnswers { where: string; inner: string; outer: string; score: number | null; omit: boolean }

const blankDim = (): DimAnswers => ({ where: '', inner: '', outer: '', score: null, omit: false });

/** The two-layer prompts, tuned per dimension so nothing reads generic. */
const PROMPTS: Record<Dimension, { where: string; way: string }> = {
  Mental: {
    where: 'How is your mind these days — clarity, mood, what occupies you?',
    way: 'caring for your mental wellbeing',
  },
  Physical: {
    where: 'How is your body — energy, pain, sleep, movement?',
    way: 'caring for your body',
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
  // Woven-in this session — a saved step locks rather than double-posting.
  const savedNow = useRef(new Set<Dimension>());
  const [, bump] = useState(0);

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

  useEffect(() => {
    if (!me) return;
    let live = true;
    void (async () => {
      const [done, p] = await Promise.all([myAnsweredWowDimensions(me), getFinancialPosition(me)]);
      if (!live) return;
      setAnswered(done);
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
      setReady(true);
    })();
    return () => { live = false; };
  }, [me]);

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
    if (savedNow.current.has(d) || !dimHasContent(d)) return;
    await createCarePost(me, {
      patientId: me, kind: 'wow', body: composeBody(a),
      dimensions: [d], score: a.score ?? undefined,
      attachments: [], links: [], previews: [],
      aiOmit: a.omit ? (d === 'Economic' ? 'financial' : 'other') : null,
    });
    savedNow.current.add(d);
    bump((n) => n + 1);
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
            Six aspects of one life — mental, physical, social, spiritual,
            environmental, economic. You&rsquo;ll walk them one at a time, in
            your own words. About ten minutes, and you can stop anywhere —
            each step is kept the moment you finish it.
          </p>
          <p className="wintake__promise">
            What you write stays inside Lichen: your care team can read it,
            nobody else — it is never sold and never shared outside the
            network. Any entry can be held out of AI entirely, and the money
            questions exist for one purpose: so support can reach you without
            you ever having to ask twice.
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
        const locked = savedNow.current.has(d);
        const alreadyBefore = answered.has(d) && !locked;
        return (
          <section className="wintake__card" key={d}>
            <div className="wintake__dimhead">
              <Icon name={DIMENSION_META[d]} size={20} />
              <h2 className="wintake__dimname">{d}</h2>
              {a.score == null ? (
                !locked && (
                  <button className="wintake__scorebtn" onClick={() => setDim(d, { score: 70 })}>
                    Add a score
                  </button>
                )
              ) : (
                <span className="wintake__scorewrap">
                  <input
                    type="range" min={0} max={100} value={a.score}
                    disabled={locked}
                    onChange={(e) => setDim(d, { score: Number(e.target.value) })}
                    aria-label={`${d} score`}
                  />
                  <span className="wintake__scoreval">{a.score}</span>
                  {!locked && (
                    <button className="wintake__scoreclear" onClick={() => setDim(d, { score: null })} aria-label="Remove score">×</button>
                  )}
                </span>
              )}
            </div>

            {alreadyBefore && (
              <p className="wintake__already">
                You&rsquo;ve written about {d.toLowerCase()} before — anything
                you add here weaves in alongside it, nothing is replaced.
              </p>
            )}
            {locked && <p className="wintake__woven">Woven in ✓ — add more anytime from your board.</p>}

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
                    <input inputMode="decimal" value={income} disabled={locked}
                      onChange={(e) => setIncome(e.target.value)} placeholder="$" />
                  </label>
                  <label>Monthly expenses
                    <input inputMode="decimal" value={expenses} disabled={locked}
                      onChange={(e) => setExpenses(e.target.value)} placeholder="$" />
                  </label>
                  <label>Assets
                    <input inputMode="decimal" value={assets} disabled={locked}
                      onChange={(e) => setAssets(e.target.value)} placeholder="$ — savings, home, vehicles" />
                  </label>
                  <label>Debts
                    <input inputMode="decimal" value={debt} disabled={locked}
                      onChange={(e) => setDebt(e.target.value)} placeholder="$ — loans, cards, medical" />
                  </label>
                  <label>People in your household
                    <input inputMode="numeric" value={household} disabled={locked}
                      onChange={(e) => setHousehold(e.target.value)} placeholder="including you" />
                  </label>
                </div>
              </div>
            )}

            <label className="wintake__q">
              <span>{PROMPTS[d].where}</span>
              <textarea
                value={a.where} disabled={locked}
                onChange={(e) => setDim(d, { where: e.target.value })}
                placeholder="In your own words…"
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
                <span>Inner — beliefs, feelings, the stories you carry</span>
                <textarea
                  value={a.inner} disabled={locked}
                  onChange={(e) => setDim(d, { inner: e.target.value })}
                  placeholder={d === 'Economic' ? '“I’m bad with money”, “asking is shameful”…' : 'What you tell yourself…'}
                />
              </label>
              <label className="wintake__q">
                <span>Outer — real-world obstacles</span>
                <textarea
                  value={a.outer} disabled={locked}
                  onChange={(e) => setDim(d, { outer: e.target.value })}
                  placeholder={d === 'Economic' ? 'Hours, childcare, credentials, a market that won’t pay…' : 'Time, money, distance, access…'}
                />
              </label>
            </div>

            {!locked && (
              <label className="wintake__omit">
                <input type="checkbox" checked={a.omit} onChange={(e) => setDim(d, { omit: e.target.checked })} />
                <span>Keep this entry out of AI — only humans on your care team read it</span>
              </label>
            )}

            {error && <p className="wintake__error">{error}</p>}
            <div className="wintake__nav">
              {at > 1 && <button className="btn" onClick={() => go(-1)}>Back</button>}
              <span className="wintake__navgap" />
              {!locked && dimHasContent(d) ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => void next(d)}>
                  {busy ? 'Weaving in…' : 'Weave it in & continue'}
                </button>
              ) : (
                <button className="btn" disabled={busy} onClick={() => (locked ? go(1) : void next(locked ? undefined : d))}>
                  {locked ? 'Continue' : 'Skip for now'}
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
