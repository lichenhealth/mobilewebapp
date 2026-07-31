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
        {/* Essays + Resources hidden until the Library presents them well
            (founder 2026-07-31) — restore the two buttons then. */}
        <button onClick={() => navigate('/about')}>About</button>
        <button onClick={() => navigate('/donate')}>Give</button>
      </nav>
      <div className="fdoor__ways">
        <button className="fdoor__signin" onClick={() => navigate('/login')}>Sign in</button>
        <button className="fdoor__cta" onClick={() => navigate('/signup')}>Request an invitation</button>
      </div>
    </header>
  );
}
