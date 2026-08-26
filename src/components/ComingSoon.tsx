import { Icon, type IconName } from './Icon';
import './ComingSoon.css';

/** A room taken offline while it's being made better (founder 2026-08-25:
 *  "don't want to hold the platform up from going live") — members and
 *  visitors see this instead of the section; platform admins still see the
 *  real page, with AdminGateNote above it saying so. Which rooms are gated
 *  is decided at the ROUTE in App.tsx — one place to flip when a room opens. */
export default function ComingSoon({ icon, title, line }: {
  icon: IconName;
  title: string;
  line: string;
}) {
  return (
    <div className="soon">
      <span className="soon__mark"><Icon name={icon} size={26} /></span>
      <h1 className="soon__title"><span className="display-italic">{title}</span></h1>
      <p className="soon__badge">COMING SOON</p>
      <p className="soon__line">{line}</p>
    </div>
  );
}

/** The admin's honesty strip: you see the real room; members don't yet. */
export function AdminGateNote() {
  return (
    <p className="soon__admin-note">
      Members see a <strong>Coming soon</strong> page here — this room is only open to you while it&rsquo;s being tended.
    </p>
  );
}
