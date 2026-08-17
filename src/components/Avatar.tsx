import { colorFor, monogramFor } from '../lib/chatApi';
import { Icon } from './Icon';
import './Avatar.css';

/** WHICH KIND OF MIND (founder 2026-08-17: "their profile picture should have
 *  the heart on it for a place steward, and the chip on it for the Ai
 *  assistant"). The same transparency the help room established, generalised:
 *  wherever an avatar appears you can see whether you're looking at a human
 *  who answers for something, or at an assistant. `pulse` = carbon, a steward;
 *  `chip` = silicon. Absent on ordinary members — a badge means a ROLE, not a
 *  decoration, so most people wear none. */
export type MindMark = 'pulse' | 'chip';

/** Identity avatar: the member's photo when they have one, else their colored
 *  monogram. One component so the photo rolls out everywhere consistently. */
export default function Avatar({
  id, name, url, size, className = '', mark, markTitle, stewardFace,
}: {
  id: string;
  name: string;
  url?: string | null;
  size: number;
  className?: string;
  mark?: MindMark;
  markTitle?: string;
  /** The human who answers for this entity. Their face fills the badge slot
   *  when they have one; a `pulse` mark is the fallback when they don't. */
  stewardFace?: { id: string; name: string; url?: string | null };
}) {
  const style = { width: size, height: size };
  const face = url
    ? <img className={`avatar ${className}`} style={style} src={url} alt={name} />
    : (
      <span
        className={`avatar avatar--mono ${className}`}
        style={{ ...style, background: colorFor(id), fontSize: Math.max(10, Math.round(size * 0.4)) }}
        aria-hidden="true"
      >
        {monogramFor(name)}
      </span>
    );
  if (!mark && !stewardFace) return face;
  // Below ~28px any badge is a smudge; the avatar stands alone there.
  if (size < 28) return face;
  const badge = Math.round(size * 0.42);
  return (
    <span className="avatar-wrap" style={style}>
      {face}
      {/* WHO answers beats THAT someone answers (founder 2026-08-17): when the
          steward has a face, show it — it's the same move the TopBar already
          makes, overlaying a scoping entity's avatar on the section mark. The
          pulse glyph is the fallback for a steward with no photo, so the slot
          always says something. Silicon has no face and never gets one: an
          assistant is a mark, deliberately, so the two can't be confused. */}
      {stewardFace && !mark ? (
        <span className="avatar__mark avatar__mark--face" style={{ width: badge, height: badge }}
          title={markTitle ?? `Stewarded by ${stewardFace.name}`}>
          {stewardFace.url
            ? <img src={stewardFace.url} alt="" />
            : <span className="avatar__mark-mono" style={{ background: colorFor(stewardFace.id), fontSize: Math.max(8, Math.round(badge * 0.5)) }}>
                {monogramFor(stewardFace.name)}
              </span>}
        </span>
      ) : mark ? (
        <span
          className={`avatar__mark avatar__mark--${mark}`}
          style={{ width: badge, height: badge }}
          title={markTitle ?? (mark === 'chip' ? 'An assistant — silicon' : 'A steward — carbon')}
        >
          <Icon name={mark} size={Math.max(8, Math.round(size * 0.26))} />
        </span>
      ) : null}
    </span>
  );
}
