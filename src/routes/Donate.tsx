import { Icon } from '../components/Icon';
import './Donate.css';

export default function Donate() {
  return (
    <div className="donate">
      <header className="donate__head">
        <p className="eyebrow">Support Lichen</p>
        <h1 className="donate__title">
          A platform that <span className="display-italic">stays small.</span>
        </h1>
        <p className="donate__sub">
          Lichen is funded by its members, not by advertisers. Your contribution
          keeps the lights on, the servers small, and the work grounded.
        </p>
      </header>

      <div className="donate__amounts">
        <button className="donate__amount">
          <span className="donate__amount-n">$10</span>
          <span className="donate__amount-cadence">monthly</span>
        </button>
        <button className="donate__amount donate__amount--featured">
          <span className="donate__amount-n">$25</span>
          <span className="donate__amount-cadence">monthly</span>
          <span className="donate__amount-tag">Most chosen</span>
        </button>
        <button className="donate__amount">
          <span className="donate__amount-n">$100</span>
          <span className="donate__amount-cadence">one-time</span>
        </button>
      </div>

      <p className="donate__note">
        <Icon name="info" size={12} />
        <span>
          Payment processing is being set up. For now, this is a placeholder —
          your interest is noted.
        </span>
      </p>
    </div>
  );
}
