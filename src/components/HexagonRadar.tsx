import { Icon, IconName } from './Icon';
import './HexagonRadar.css';

export interface RadarAxis {
  label: string;
  icon: IconName;
  value: number | null; // 0-100, or null = no data yet
}

interface Props {
  axes: RadarAxis[]; // exactly 6 axes
  size?: number;
}

/** 6-axis hexagonal radar chart. Each axis runs from center to a hex vertex;
 *  the values trace a peach polygon inside. Small icons sit at each vertex
 *  with the % value just beyond, matching the wireframe. */
export default function HexagonRadar({ axes, size = 220 }: Props) {
  if (axes.length !== 6) {
    console.warn('HexagonRadar expects exactly 6 axes');
  }
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.36;
  // Start at top (12 o'clock), go clockwise. 6 axes = 60° apart.
  const angles = [-90, -30, 30, 90, 150, 210].map((d) => (d * Math.PI) / 180);

  // Outer hex vertices (the boundary)
  const outerPts = angles.map((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  // Value vertices — only for axes WITH data, so empty dimensions don't dent the
  // shape to the center (they read as "no data", not 0%).
  const dataPts = angles
    .map((a, i) => {
      const val = axes[i]?.value;
      if (val == null) return null;
      const v = val / 100;
      return [cx + r * v * Math.cos(a), cy + r * v * Math.sin(a)];
    })
    .filter((p): p is number[] => p !== null);
  // Concentric rings for the grid (25%, 50%, 75%, 100%)
  const rings = [0.25, 0.5, 0.75, 1].map((s) =>
    angles.map((a) => [cx + r * s * Math.cos(a), cy + r * s * Math.sin(a)])
  );
  // Label position: slightly outside the vertex
  const labelOffset = 1.34;
  const labelPts = angles.map((a) => [
    cx + r * labelOffset * Math.cos(a),
    cy + r * labelOffset * Math.sin(a),
  ]);
  // Icon position: just inside the vertex
  // Icons centered on the outer hexagon vertices; % labels sit just beyond them.
  const iconOffset = 1.0;
  const iconPts = angles.map((a) => [
    cx + r * iconOffset * Math.cos(a),
    cy + r * iconOffset * Math.sin(a),
  ]);

  const toPath = (pts: number[][]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + ' Z';

  return (
    <div
      className="hex-radar"
      style={{ width: size, height: size }}
      role="img"
      aria-label="Health snapshot radar"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="hex-radar__svg"
        overflow="visible"
      >
        {/* Concentric grid rings */}
        {rings.map((ring, i) => (
          <path
            key={i}
            d={toPath(ring)}
            fill="none"
            stroke="var(--ink)"
            strokeWidth="0.6"
            opacity={0.25}
          />
        ))}
        {/* Spokes from center to each outer vertex */}
        {outerPts.map((p, i) => (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p[0]}
            y2={p[1]}
            stroke="var(--ink)"
            strokeWidth="0.5"
            opacity={0.2}
          />
        ))}
        {/* Filled value polygon over the axes that have data (≥3 → area; ≤2 → line) */}
        {dataPts.length >= 3 && (
          <path d={toPath(dataPts)} fill="var(--peach)" fillOpacity={0.85} stroke="var(--peach-deep)" strokeWidth="1" />
        )}
        {dataPts.length > 0 && dataPts.length < 3 && (
          <path
            d={dataPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')}
            fill="none" stroke="var(--peach-deep)" strokeWidth="1.5"
          />
        )}
        {/* Dot at each data vertex (so 1–2 entries still show) */}
        {dataPts.map((p, i) => (
          <circle key={`dot-${i}`} cx={p[0]} cy={p[1]} r={2.5} fill="var(--peach-deep)" />
        ))}
      </svg>

      {/* Icons at each vertex */}
      {iconPts.map(([x, y], i) => (
        <div
          key={`icon-${i}`}
          className="hex-radar__icon"
          style={{ left: x, top: y }}
          title={axes[i]?.label}
        >
          <Icon name={axes[i]?.icon ?? 'sparkle'} size={14} />
        </div>
      ))}

      {/* % labels just outside each vertex ("—" when the dimension has no entries) */}
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
