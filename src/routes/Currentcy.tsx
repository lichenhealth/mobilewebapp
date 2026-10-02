import { useSearchParams } from 'react-router-dom';
import CurrentcyCard from '../components/CurrentcyCard';
import AssistantDoor from '../components/AssistantDoor';
import MoneyInDoors from '../components/MoneyInDoors';
import './Concierge.css';

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
      <header className="cedit__head cedit__head--noback">
        <h1 className="cedit__title">Current-cy</h1>
      </header>
      <p className="means__pagelead">
        Your wallet — like a checking account: earn Current-cy, or load dollars
        in to use on the platform.
      </p>
      {justLoaded && (
        <p className="curx__loaded">
          Payment received — your Current lands here in a moment. Pull back in
          if it hasn&rsquo;t appeared yet.
        </p>
      )}
      <div className="cedit__doors">
        <AssistantDoor section="currentcy" label="Your money coach — what moved, and where you could earn more" />
      </div>
      <MoneyInDoors />
      <CurrentcyCard />
    </div>
  );
}
