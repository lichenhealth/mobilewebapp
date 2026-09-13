import CurrentcyCard from '../components/CurrentcyCard';
import AssistantDoor from '../components/AssistantDoor';
import './Concierge.css';

/** The wallet's own screen (founder 2026-09-13: "your wallet just lives in
 *  your profile… it should be a left nav on desktop and a bottom nav on
 *  mobile"). Profile's Current-cy drawer stays — several doors, one ledger.
 *  TopBar's arrow is the back button (no in-page second one). The brain is
 *  the MONEY COACH (founder 2026-09-13, same day): a Current-cy assistant
 *  like every section's — and like every section's, one switch turns it off. */
export default function Currentcy() {
  return (
    <div className="cedit">
      <header className="cedit__head cedit__head--noback">
        <h1 className="cedit__title">Current-cy</h1>
      </header>
      <p className="means__pagelead">
        Your wallet — what you hold, what has moved, and a way to send it on.
      </p>
      <div className="cedit__doors">
        <AssistantDoor section="currentcy" label="Your money coach — what moved, and where you could earn more" />
      </div>
      <CurrentcyCard />
    </div>
  );
}
