import { Navigate, useSearchParams } from 'react-router-dom';

/** Snapshot lives inside the assistant now (founder 2026-08-11: "take the
 *  person to the AI Assistant, not a completely new UI") — it's the panel
 *  at the top of the profile room. This keeps old links working. */
export default function Snapshot() {
  const [params] = useSearchParams();
  const back = params.get('back');
  const to = '/assistant/feed?thread=profile' + (back ? `&back=${encodeURIComponent(back)}` : '');
  return <Navigate to={to} replace />;
}
