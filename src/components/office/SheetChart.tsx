import { useState } from 'react';
import { display } from '../../lib/formula';
import { CHART_COLORS, niceTicks, type ChartData, type ChartType } from '../../lib/sheetExtras';

/** One chart, hand-drawn SVG (no chart library — the sheet already ships the
 *  numbers). Thin marks, rounded data-ends on the baseline, a recessive grid,
 *  a legend for 2+ series and a hover readout on every mark. Colors follow the
 *  SERIES in fixed order (CHART_COLORS, validated), never its rank. */

const W = 600, H = 320, PADL = 54, PADR = 16, PADT = 18, PADB = 46;
const fmt = (n: number) => display(Math.abs(n) >= 1000 ? Math.round(n) : Math.round(n * 100) / 100);

export default function SheetChart({ data, type, small }: { data: ChartData; type: ChartType; small?: boolean }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const series = data.series.slice(0, CHART_COLORS.length);
  const n = data.labels.length;
  const show = (x: number, y: number, text: string) => setTip({ x, y, text });

  if (type === 'pie') {
    const s = series[0];
    const vals = s.values.map((v) => Math.max(0, v ?? 0));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    let a0 = -Math.PI / 2;
    const cx = 170, cy = H / 2, R = 120;
    return (
      <div className="schart" onMouseLeave={() => setTip(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Pie chart of ${s.name}`}>
          {vals.map((v, i) => {
            const a1 = a0 + (v / total) * Math.PI * 2;
            const large = a1 - a0 > Math.PI ? 1 : 0;
            const p = (a: number) => `${cx + R * Math.cos(a)},${cy + R * Math.sin(a)}`;
            const d = v >= total ? `M${cx - R},${cy}a${R},${R} 0 1,0 ${R * 2},0a${R},${R} 0 1,0 ${-R * 2},0` : `M${cx},${cy}L${p(a0)}A${R},${R} 0 ${large} 1 ${p(a1)}Z`;
            const mid = (a0 + a1) / 2; a0 = a1;
            const color = CHART_COLORS[i % CHART_COLORS.length];
            return v > 0 && (
              <path key={i} d={d} fill={color} stroke="#fff" strokeWidth={2}
                onMouseMove={() => show(cx + R * 0.6 * Math.cos(mid), cy + R * 0.6 * Math.sin(mid), `${data.labels[i]}: ${fmt(v)} (${Math.round((v / total) * 100)}%)`)} />
            );
          })}
          {data.labels.slice(0, CHART_COLORS.length).map((l, i) => (
            <g key={i} transform={`translate(330, ${40 + i * 24})`}>
              <rect width={12} height={12} rx={3} fill={CHART_COLORS[i]} />
              <text x={20} y={10} className="schart__lbl">{trunc(l, 22)} · {fmt(vals[i])}</text>
            </g>
          ))}
          {data.labels.length > CHART_COLORS.length && <text x={330} y={40 + CHART_COLORS.length * 24} className="schart__lbl">+ {data.labels.length - CHART_COLORS.length} more</text>}
        </svg>
        {tip && <Tip {...tip} />}
      </div>
    );
  }

  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const horiz = type === 'bar';
  const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
  const scale = (v: number) => ((v - lo) / (hi - lo || 1));
  const band = (horiz ? plotH : plotW) / Math.max(1, n);
  const legend = series.length > 1;

  return (
    <div className="schart" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H + (legend ? 22 : 0)}`} role="img" aria-label={`${type} chart: ${series.map((s) => s.name).join(', ')}`}>
        {ticks.map((t) => {
          const pos = scale(t);
          return horiz ? (
            <g key={t}><line x1={PADL + pos * plotW} x2={PADL + pos * plotW} y1={PADT} y2={PADT + plotH} className="schart__grid" />
              <text x={PADL + pos * plotW} y={PADT + plotH + 16} textAnchor="middle" className="schart__tick">{fmt(t)}</text></g>
          ) : (
            <g key={t}><line x1={PADL} x2={W - PADR} y1={PADT + plotH - pos * plotH} y2={PADT + plotH - pos * plotH} className="schart__grid" />
              <text x={PADL - 8} y={PADT + plotH - pos * plotH + 4} textAnchor="end" className="schart__tick">{fmt(t)}</text></g>
          );
        })}
        {data.labels.map((l, i) => {
          if (n > 14 && i % Math.ceil(n / 14)) return null;
          return horiz
            ? <text key={i} x={PADL - 8} y={PADT + band * (i + 0.5) + 4} textAnchor="end" className="schart__tick">{trunc(l, 8)}</text>
            : <text key={i} x={PADL + band * (i + 0.5)} y={PADT + plotH + 16} textAnchor="middle" className="schart__tick">{trunc(l, small ? 6 : 10)}</text>;
        })}
        {type === 'line' ? series.map((s, si) => {
          const pts = s.values.map((v, i) => (v == null ? null : [PADL + band * (i + 0.5), PADT + plotH - scale(v) * plotH] as const));
          const d = pts.reduce((acc, p, i) => (p ? acc + `${acc && pts[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}` : acc), '');
          return (
            <g key={si}>
              <path d={d} fill="none" stroke={CHART_COLORS[si]} strokeWidth={2} strokeLinejoin="round" />
              {pts.map((p, i) => p && (
                <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={CHART_COLORS[si]} stroke="#fff" strokeWidth={2}
                  onMouseMove={() => show(p[0], p[1], `${data.labels[i]} · ${s.name}: ${fmt(s.values[i]!)}`)} />
              ))}
            </g>
          );
        }) : series.map((s, si) => s.values.map((v, i) => {
          if (v == null) return null;
          const inner = band * 0.72, w = inner / series.length;
          const off = band * 0.14 + w * si;
          const base = scale(Math.max(lo, Math.min(0, hi))), at = scale(v);
          const a = Math.min(base, at), len = Math.max(1, Math.abs(at - base) * (horiz ? plotW : plotH));
          const gap = Math.max(1, w - 2);
          const rect = horiz
            ? { x: PADL + a * plotW, y: PADT + band * i + off, width: len, height: gap }
            : { x: PADL + band * i + off, y: PADT + plotH - (a * plotH) - len, width: gap, height: len };
          return (
            <rect key={`${si}-${i}`} {...rect} rx={Math.min(4, gap / 2)} fill={CHART_COLORS[si]}
              onMouseMove={() => show(rect.x + rect.width / 2, rect.y, `${data.labels[i]} · ${s.name}: ${fmt(v)}`)} />
          );
        }))}
        {legend && (
          <g transform={`translate(${PADL}, ${H + 6})`}>
            {series.map((s, si) => (
              <g key={si} transform={`translate(${si * 120}, 0)`}>
                <rect width={12} height={12} rx={3} fill={CHART_COLORS[si]} />
                <text x={18} y={10} className="schart__lbl">{trunc(s.name, 14)}</text>
              </g>
            ))}
          </g>
        )}
      </svg>
      {tip && <Tip {...tip} legend={legend} />}
    </div>
  );
}

function Tip({ x, y, text, legend }: { x: number; y: number; text: string; legend?: boolean }) {
  const h = H + (legend ? 22 : 0);
  return <span className="schart__tip" style={{ left: `${(x / W) * 100}%`, top: `${(y / h) * 100}%` }}>{text}</span>;
}
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
