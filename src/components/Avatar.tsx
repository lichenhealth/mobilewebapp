import { colorFor, monogramFor } from '../lib/chatApi';
import './Avatar.css';

/** Identity avatar: the member's photo when they have one, else their colored
 *  monogram. One component so the photo rolls out everywhere consistently. */
export default function Avatar({
  id, name, url, size, className = '',
}: {
  id: string;
  name: string;
  url?: string | null;
  size: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (url) {
    return <img className={`avatar ${className}`} style={style} src={url} alt={name} />;
  }
  return (
    <span
      className={`avatar avatar--mono ${className}`}
      style={{ ...style, background: colorFor(id), fontSize: Math.max(10, Math.round(size * 0.4)) }}
      aria-hidden="true"
    >
      {monogramFor(name)}
    </span>
  );
}
