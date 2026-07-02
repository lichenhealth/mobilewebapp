import { Icon, IconName } from './Icon';
import './HexagonRadar.css';

export interface RadarAxis {
  label: string;
  icon: IconName;
  value: number | null; // 0-100, or null = no entries yet
}

interface Props {
  axes: RadarAxis[]; // exactly 6 axes
  size?: number;
}

/** Flat-top hexagonal "web": six triangular wedges (one per dimension). A
 *  dimension with a score fills its wedge transparent-orange from the center out
 *  to the score level; empty dimensions stay unfilled and show "—". Icons + %
 *  sit outside each wedge's outer edge. */
export default function HexagonRadar({ axes, size = 220 }: Props) {
  if (axes.length !== 6) console.warn('HexagonRadar expects exactly 6 axes');
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.34; // leaves room for the % labels outside the hexagon
  const rad = (d: number) => (d * Math.PI) / 180;
  const pt = (a: number, radius: number): [number, number] => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];

  // Dimension directions (wedge centers / outer-edge midpoints) — icons + % here.
  const dirAngles = [-90, -30, 30, 90, 150, 210].map(rad);
  // Hexagon corners (wedge boundaries), 30° off the directions → flat-top hexagon.
  const vertAngles = [-60, 0, 60, 120, 180, 240].map(rad);
  const vertPts = vertAngles.map((a) => pt(a, r));

  const toPath = (pts: [number, number][]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';

  // Concentric hexagon rings (25/50/75/100).
  const rings = [0.25, 0.5, 0.75, 1].map((s) => vertAngles.map((a) => pt(a, r * s)));

  // Wedge for dimension i is bounded by corners vertAngles[i] and vertAngles[i-1];
  // fill a triangle from the center out to the score level.
  const wedgePath = (i: number): string | null => {
    const v = axes[i]?.value;
    if (v == null || v <= 0) return null;
    const s = v / 100;
    const a = pt(vertAngles[(i + 5) % 6], r * s);
    const b = pt(vertAngles[i], r * s);
    return `M ${cx} ${cy} L ${a[0].toFixed(1)} ${a[1].toFixed(1)} L ${b[0].toFixed(1)} ${b[1].toFixed(1)} Z`;
  };

  // Icons centered on each wedge's outer edge (the edge midpoint = cos30·r);
  // % labels sit just beyond, outside the hexagon.
  const edgeMid = Math.cos(Math.PI / 6); // ≈ 0.866
  const iconPts = dirAngles.map((a) => pt(a, r * edgeMid));
  const labelPts = dirAngles.map((a) => pt(a, r * 1.18));

  return (
    <div className="hex-radar" style={{ width: size, height: size }} role="img" aria-label="Web of Wellbeing">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="hex-radar__svg" overflow="visible">
        {/* Per-dimension wedge fills, to the score level */}
        {axes.map((_, i) => {
          const d = wedgePath(i);
          return d ? <path key={`w-${i}`} d={d} fill="var(--peach)" fillOpacity={0.5} /> : null;
        })}
        {/* Concentric grid rings */}
        {rings.map((ring, i) => (
          <path key={`r-${i}`} d={toPath(ring)} fill="none" stroke="var(--ink)" strokeWidth="0.6" opacity={i === 3 ? 0.32 : 0.2} />
        ))}
        {/* Spokes to each corner (wedge boundaries) */}
        {vertPts.map((p, i) => (
          <line key={`s-${i}`} x1={cx} y1={cy} x2={p[0]} y2={p[1]} stroke="var(--ink)" strokeWidth="0.5" opacity={0.18} />
        ))}
      </svg>

      {/* Icons centered outside each wedge's outer edge */}
      {iconPts.map(([x, y], i) => (
        <div key={`icon-${i}`} className="hex-radar__icon" style={{ left: x, top: y }} title={axes[i]?.label}>
          <Icon name={axes[i]?.icon ?? 'sparkle'} size={14} />
        </div>
      ))}

      {/* % labels just beyond the icons ("—" when the dimension has no entries) */}
      {labelPts.map(([x, y], i) => {
        const v = axes[i]?.value;
        return (
          <div
            key={`label-${i}`}
            className={'hex-radar__label' + (v == null ? ' hex-radar__label--empty' : '')}
            style={{ left: x, top: y }}
          >
            {v == null ? '—' : `${v}%`}
          </div>
        );
      })}
    </div>
  );
}
