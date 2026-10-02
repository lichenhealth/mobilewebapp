import { useSearchParams } from 'react-router-dom';
import CurrentcyCard from '../components/CurrentcyCard';
import AssistantDoor from '../components/AssistantDoor';
import MoneyInDoors from '../components/MoneyInDoors';
import BudgetCard from '../components/BudgetCard';
import './Concierge.css';
import './Mycelium.css';   // shares the myc__ centered-header vocabulary (Drive's shape)

/** The wallet's own screen (founder 2026-09-13: "your wallet just lives in
 *  your profile… it should be a left nav on desktop and a bottom nav on
 *  mobile"). Profile's Current-cy drawer stays — several doors, one ledger.
 *  TopBar's arrow is the back button (no in-page second one). The brain is
 *  the MONEY COACH (founder 2026-09-13, same day): a Current-cy assistant
 *  like every section's — and like every section's, one switch turns it off.
 *  "Your Current-cy is like a checking account — you can earn it or you can
 *  load money into it" (founder 2026-10-01): the money-in doors are the
 *  shared MoneyInDoors component, which Profile's drawer mounts too. */
export default function Currentcy() {
  const [params] = useSearchParams();
  const justLoaded = params.get('loaded') === '1';

  return (
    <div className="cedit">
      {/* Drive's header grammar (founder 2026-10-02: "have the current-cy tab
          do the same, with the explanation of what it is in the middle…and
          with no gray line") — centered title + centered explanation via the
          same .myc__head classes Drive wears, no sticky bar, no hairline. */}
      <header className="myc__head">
        <h1 className="myc__title">Your Current-cy</h1>
        {/* Founder 2026-10-02: "reflect that it is a bank account, a
            budgeting tool and a brokerage for the exchange of goods and
            services in a new economy." */}
        <p className="myc__sub">
          Your bank account, your budgeting tool, and your brokerage for the
          exchange of goods and services in a new economy.
        </p>
      </header>
      {/* Honest about BOTH speeds (founder 2026-10-02 loaded $50 from her
          bank and the old "lands in a moment… pull back in" read as broken):
          card = instant, bank = days. The webhook mints the moment Stripe
          confirms the money, whichever path it took. */}
      {justLoaded && (
        <p className="curx__loaded">
          Payment started. A card load lands here in a moment — a bank
          transfer takes a few business days to clear. Your Current appears
          the moment the money does.
        </p>
      )}
      <div className="cedit__doors">
        <AssistantDoor section="currentcy" label="Your money coach — what moved, and where you could earn more" />
      </div>
      <MoneyInDoors />
      <CurrentcyCard />
      {/* Budget (founder 2026-10-02) — wallet page only for now; Profile's
          drawer stays the compact card, deliberately. */}
      <BudgetCard />
    </div>
  );
}
