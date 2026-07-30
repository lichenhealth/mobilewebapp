import { useNavigate } from 'react-router-dom';
import { LichenMark } from './LichenMark';
import '../routes/FrontDoor.css';

// The website's persistent top nav (founder 2026-07-30): signed-out visitors
// carry the same header across every Lichen-owned public surface — front
// door, About, essays, collections, posts — so nobody is ever marooned.
// Member/space pages keep their own de-branded mastheads instead.

export default function SiteHeader() {
  const navigate = useNavigate();
  return (
    <header className="fdoor__head">
      <button className="fdoor__brand" onClick={() => navigate('/')}>
        <LichenMark size={34} />
        <span>Lichen</span>
      </button>
      <nav className="fdoor__nav">
        <button onClick={() => navigate('/about')}>About</button>
        <button onClick={() => navigate('/collections/02aa2dee-f955-54e9-879e-2542a7552e5f')}>Essays</button>
        <button onClick={() => navigate('/collections/ea4ae9d1-a848-548e-83c6-7022cf81ea54')}>Resources</button>
        <button onClick={() => navigate('/donate')}>Give</button>
      </nav>
      <div className="fdoor__ways">
        <button className="fdoor__signin" onClick={() => navigate('/login')}>Sign in</button>
        <button className="fdoor__cta" onClick={() => navigate('/signup')}>Request an invitation</button>
      </div>
    </header>
  );
}
