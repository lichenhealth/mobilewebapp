import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { LichenMark } from '../components/LichenMark';
import { useAuth } from '../auth/AuthProvider';
import './AboutLichen.css';

/** The two maps, drawn: what's actually given (every being, sized by real
 *  contribution) beside what the market pays (care at $0, forests not counted,
 *  speculation bloated). The gap between them is what the algorithm closes.
 *  Built in HTML so the labels stay legible at every column width. */
/* The strand palette — one color per kind of being, tuned to sit with peach. */
const KIND = {
  people: 'var(--peach)',
  plants: 'var(--green)',
  animals: '#D9A441',   // warm ochre
  elements: '#7FA8C9',  // river blue
  places: '#A78BBA',    // lichen mauve
  extraction: '#B0563C',
};

/* Within each row the pair differs ONLY in size/presence — never in color:
   the same Lichen peach for every human dot, green for the forest, rust for
   the extractive one. */
const MAP_ROWS = [
  {
    label: 'a mother’s care',
    left: { size: 46, bg: KIND.people },
    right: { size: 7, bg: KIND.people, note: 'not compensated' },
  },
  {
    label: 'an old-growth forest',
    left: { size: 54, bg: KIND.plants },
    right: { size: 22, dashed: true, stroke: KIND.plants, note: 'not counted' },
  },
  {
    label: 'a paramedic’s shift',
    left: { size: 34, bg: KIND.people },
    right: { size: 13, bg: KIND.people, note: 'under-compensated' },
  },
  {
    // The shadow named as a PATTERN, not a profession (founder 2026-07-25):
    // 'speculative investors' is behavior-defined — concrete without calling
    // out anyone's job title. Matches the prose above the visual.
    label: 'speculative investors',
    left: { size: 15, dashed: true, rust: true },
    right: { size: 46, bg: KIND.extraction, note: 'over-compensated' },
  },
];

/** A small on-brand globe: bone sphere + faint graticule; the colored strands
 *  are the kinds of beings contributing (people, plants, animals, elements,
 *  places). The market variant shows the same world with most strands missing —
 *  only the money-recognized ones remain. */
function Globe({ variant }: { variant: 'given' | 'paid' }) {
  return (
    <svg className="about__maps-globe" viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="52" fill="var(--bone)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      {/* graticule */}
      <ellipse cx="60" cy="60" rx="24" ry="52" fill="none" stroke="var(--bone-edge)" strokeWidth="0.8" />
      <ellipse cx="60" cy="60" rx="42" ry="52" fill="none" stroke="var(--bone-edge)" strokeWidth="0.7" opacity="0.7" />
      <ellipse cx="60" cy="60" rx="52" ry="20" fill="none" stroke="var(--bone-edge)" strokeWidth="0.8" />
      <ellipse cx="60" cy="60" rx="52" ry="40" fill="none" stroke="var(--bone-edge)" strokeWidth="0.7" opacity="0.7" />
      {variant === 'given' ? (
        <g strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M16,72 Q58,22 104,54" stroke={KIND.plants} />
          <path d="M22,42 Q64,88 100,74" stroke={KIND.people} />
          <path d="M32,96 Q58,58 92,28" stroke={KIND.animals} />
          <path d="M14,56 Q48,44 78,16" stroke={KIND.elements} />
          <path d="M42,106 Q76,82 106,66" stroke={KIND.places} />
          <g stroke="none">
            <circle cx="16" cy="72" r="3" fill={KIND.plants} /><circle cx="104" cy="54" r="3" fill={KIND.plants} />
            <circle cx="22" cy="42" r="3" fill={KIND.people} /><circle cx="100" cy="74" r="3" fill={KIND.people} />
            <circle cx="32" cy="96" r="3" fill={KIND.animals} /><circle cx="92" cy="28" r="3" fill={KIND.animals} />
            <circle cx="14" cy="56" r="3" fill={KIND.elements} /><circle cx="78" cy="16" r="3" fill={KIND.elements} />
            <circle cx="42" cy="106" r="3" fill={KIND.places} /><circle cx="106" cy="66" r="3" fill={KIND.places} />
          </g>
        </g>
      ) : (
        <g strokeLinecap="round" fill="none">
          {/* the one strand money sees clearly — bloated */}
          <path d="M24,86 Q60,44 100,70" stroke={KIND.extraction} strokeWidth="5" opacity="0.85" />
          {/* people, barely priced */}
          <path d="M22,42 Q64,88 100,74" stroke={KIND.people} strokeWidth="1.2" opacity="0.35" />
          {/* the rest: missing — faint remnants */}
          <path d="M16,72 Q38,50 58,40" stroke="var(--ink-faint)" strokeWidth="1" strokeDasharray="2 5" opacity="0.5" />
          <path d="M60,96 Q78,74 92,60" stroke="var(--ink-faint)" strokeWidth="1" strokeDasharray="2 5" opacity="0.5" />
          <g stroke="none">
            <circle cx="24" cy="86" r="3.4" fill={KIND.extraction} /><circle cx="100" cy="70" r="3.4" fill={KIND.extraction} />
          </g>
        </g>
      )}
    </svg>
  );
}

/** The table's journey as a map path: every contributor a waypoint — the tree,
 *  the artisan, the delivery already driving that way — joined by the route
 *  Lichen weaves, ending at the family's kitchen. */
interface JourneyStop {
  emoji: string; x: number; y: number;
  name: string; sub: string; sub2?: string;
  lx: number; ly: number; anchor: 'start' | 'end' | 'middle';
}
const JOURNEY_STOPS: JourneyStop[] = [
  // Labels sit clear of the dashed route — above, below, or beside their node,
  // never jammed against the path.
  { emoji: '🌳', x: 44, y: 44, name: 'the tree', sub: '50 years of growing', lx: 66, ly: 46, anchor: 'start' },
  { emoji: '🪚', x: 200, y: 58, name: 'the artisan', sub: '7 hours of craft', lx: 222, ly: 54, anchor: 'start' },
  { emoji: '🥕', x: 120, y: 128, name: 'the farm', sub: 'clean food loaded', lx: 98, ly: 124, anchor: 'end' },
  { emoji: '🏠', x: 240, y: 150, name: 'a neighbor', sub: 'pays for produce', lx: 262, ly: 134, anchor: 'start' },
  { emoji: '🏠', x: 120, y: 210, name: 'another neighbor', sub: 'covered by the commons', sub2: 'plants trees in return', lx: 98, ly: 214, anchor: 'end' },
  { emoji: '🏡', x: 284, y: 258, name: 'the family’s kitchen', sub: 'the table, earned by the drive', lx: 272, ly: 288, anchor: 'middle' },
];

function TableJourney() {
  return (
    <svg className="about__journey" viewBox="0 0 340 310" role="img"
      aria-label="A map route: from the tree that grew the wood, to the artisan who crafted the table, to the farm where clean food is loaded in, to one neighbor who pays for produce and another covered by the commons, ending at the family’s kitchen — the table earned by the drive.">
      {/* faint map contours */}
      <path d="M-10,104 q45,-14 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.55" />
      <path d="M-10,168 q45,12 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.45" />
      <path d="M-10,268 q45,-8 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.4" />
      {/* the woven route — driven by the family's truck */}
      <path d="M44,44 C90,14 152,32 200,58 C232,78 160,96 120,128 C90,152 190,142 240,150 C288,178 170,180 120,210 C96,226 180,232 232,246"
        fill="none" stroke="var(--peach)" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
      {/* the family's truck lays the route behind it, facing home (emoji faces
          left natively — mirrored to point at the house) */}
      <g transform="translate(248,251) scale(-1,1)">
        <text x="0" y="0" fontSize="13" textAnchor="middle">🚚</text>
      </g>
      {/* the loop closes: the subsidized family volunteers, planting the next
          trees — sweeping around the left margin back to the tree */}
      <path d="M110,198 C50,184 10,160 10,112 C10,72 18,52 38,46"
        fill="none" stroke={KIND.plants} strokeWidth="1.6" strokeDasharray="3 5" strokeLinecap="round" opacity="0.85" />
      <text x="60" y="158" fontSize="11" textAnchor="middle">🌱</text>
      {JOURNEY_STOPS.map((s) => (
        <g key={s.name}>
          <circle cx={s.x} cy={s.y} r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
          <text x={s.x} y={s.y + 5} fontSize="14" textAnchor="middle">{s.emoji}</text>
          <text x={s.lx} y={s.ly} fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor={s.anchor}>{s.name}</text>
          <text x={s.lx} y={s.ly + 12} fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor={s.anchor}>{s.sub}</text>
          {s.sub2 && (
            <text x={s.lx} y={s.ly + 24} fontSize="9" fontStyle="italic" fill={KIND.plants} textAnchor={s.anchor}>{s.sub2}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Tango's exchange as a map: risky, skilled labor that flat time can't price —
 *  carried by Current-cy instead. She absorbs a child's heavy energy, her
 *  bodyworker clears her and is paid from Tango's Current-cy, then cashes out
 *  to dollars in the wider world. */
const TANGO_STOPS: JourneyStop[] = [
  { emoji: '🧒', x: 44, y: 48, name: 'a hurting child', sub: 'releases what’s heavy', lx: 46, ly: 82, anchor: 'middle' },
  { emoji: '🐴', x: 190, y: 64, name: 'Tango', sub: 'takes on the heavy energy', lx: 212, ly: 60, anchor: 'start' },
  { emoji: '💆', x: 110, y: 140, name: 'the bodyworker', sub: 'clears Tango’s load', sub2: 'paid in Current-cy', lx: 88, ly: 136, anchor: 'end' },
  { emoji: '🛒', x: 256, y: 204, name: 'the wider world', sub: 'Current-cy cashed out to dollars', lx: 250, ly: 236, anchor: 'middle' },
  // The body's own loop (founder 2026-07-25 — as many synchronicities as we
  // can show): manure feeds the farm; the farm feeds the steward.
  { emoji: '🥕', x: 300, y: 130, name: 'the organic farm', sub: 'her manure feeds the soil', lx: 278, ly: 126, anchor: 'end' },
  { emoji: '🤲', x: 64, y: 204, name: 'Tango’s steward', sub: 'fresh produce comes back', lx: 64, ly: 232, anchor: 'middle' },
];

function TangoJourney() {
  return (
    <svg className="about__journey" viewBox="0 0 340 250" role="img"
      aria-label="A map route: a hurting child releases what’s heavy, Tango the therapy horse takes it on, her bodyworker clears her and is paid in Current-cy, and cashes out to dollars in the wider world. A green loop closes alongside: Tango’s manure feeds the organic farm, and fresh produce comes back to her steward.">
      <path d="M-10,108 q45,-12 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.5" />
      <path d="M-10,178 q45,10 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.4" />
      <path d="M44,48 C92,20 148,36 190,64 C226,88 152,112 110,140 C78,162 190,168 256,204"
        fill="none" stroke="var(--peach)" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
      {/* the green loop: Tango → farm (manure) → steward (produce) */}
      <path d="M204,74 C246,88 284,100 298,116"
        fill="none" stroke={KIND.plants} strokeWidth="1.6" strokeDasharray="3 5" strokeLinecap="round" opacity="0.85" />
      <path d="M290,142 C258,192 160,222 80,208"
        fill="none" stroke={KIND.plants} strokeWidth="1.6" strokeDasharray="3 5" strokeLinecap="round" opacity="0.85" />
      {/* the energy moving from the child into Tango's keeping */}
      <text x="140" y="26" fontSize="11" textAnchor="middle">✨</text>
      {TANGO_STOPS.map((s) => (
        <g key={s.name}>
          <circle cx={s.x} cy={s.y} r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
          <text x={s.x} y={s.y + 5} fontSize="14" textAnchor="middle">{s.emoji}</text>
          <text x={s.lx} y={s.ly} fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor={s.anchor}>{s.name}</text>
          <text x={s.lx} y={s.ly + 12} fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor={s.anchor}>{s.sub}</text>
          {s.sub2 && (
            <text x={s.lx} y={s.ly + 24} fontSize="9" fontStyle="italic" fill="var(--peach-deep, var(--peach))" textAnchor={s.anchor}>{s.sub2}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

/** Crystal's thread: an under-resourced founder, her AI assistant (the brain
 *  mark), the peer stuck on the opposite wall, and the shared venture the
 *  assistant drafts — seeded by the commons. */
function CrystalJourney() {
  return (
    <svg className="about__journey" viewBox="0 0 340 250" role="img"
      aria-label="A map route: Crystal, an under-resourced founder; her AI assistant reads the roadblock; a peer founder holds the missing half; together they launch a shared venture — plan drafted by the assistant, seeded by the commons.">
      <path d="M-10,108 q45,-12 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.5" />
      <path d="M-10,178 q45,10 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.4" />
      <path d="M44,48 C92,20 148,36 200,64 C226,88 152,112 110,140 C78,162 190,168 256,204"
        fill="none" stroke="var(--peach)" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
      {/* Crystal */}
      <circle cx="44" cy="48" r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      <text x="44" y="53" fontSize="14" textAnchor="middle">💡</text>
      <text x="46" y="82" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="middle">Crystal</text>
      <text x="46" y="94" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="middle">a founder, under-resourced</text>
      {/* her assistant — the brain mark, a member of the web */}
      <circle cx="200" cy="64" r="16" fill="var(--peach-tint, var(--bone-warm))" stroke="var(--peach)" strokeWidth="1.2" />
      <g transform="translate(191,55)" style={{ color: 'var(--peach-deep, var(--peach))' }}>
        <Icon name="brain" size={18} />
      </g>
      <text x="222" y="60" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="start">her assistant</text>
      <text x="222" y="72" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="start">reads the roadblock</text>
      {/* the peer */}
      <circle cx="110" cy="140" r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      <text x="110" y="145" fontSize="14" textAnchor="middle">🔧</text>
      <text x="88" y="136" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="end">a peer founder</text>
      <text x="88" y="148" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="end">the missing half</text>
      {/* the shared venture */}
      <circle cx="256" cy="204" r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      <text x="256" y="209" fontSize="14" textAnchor="middle">🚀</text>
      <text x="250" y="236" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="middle">a shared venture</text>
      <text x="250" y="248" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="middle">plan drafted · seeded by the commons</text>
    </svg>
  );
}

/** The firefighters' retreat (from the deck): chronically undervalued,
 *  risk-carrying work answered with care — the assistant reads a station's
 *  shift rotations, finds the shared window, books a nearby Lichen place, and
 *  lifts all coordination off the healers. */
function FirefighterJourney() {
  return (
    <svg className="about__journey" viewBox="0 0 340 265" role="img"
      aria-label="A map route: first responders — risk taken, vicarious trauma carried; the assistant weaves their shift rotations into a shared window; a community healing center offers a retreat close by; the healers arrive free to heal, coordination lifted; a donor's large gift funds the services and the commons carries the rest.">
      <path d="M-10,116 q45,-8 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.5" />
      <path d="M-10,178 q45,10 90,0 t90,0 t90,0 t90,0" fill="none" stroke="var(--bone-edge)" strokeWidth="0.9" opacity="0.4" />
      <path d="M44,48 C92,20 148,36 200,64 C226,88 152,112 110,140 C78,162 190,168 256,204"
        fill="none" stroke="var(--peach)" strokeWidth="2" strokeDasharray="5 6" strokeLinecap="round" />
      {/* the donor's gift, flowing into the retreat */}
      <path d="M280,153 C288,172 272,186 262,192"
        fill="none" stroke="#D9A441" strokeWidth="1.6" strokeDasharray="3 5" strokeLinecap="round" opacity="0.9" />
      {/* the crew */}
      <circle cx="44" cy="48" r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      <text x="44" y="53" fontSize="14" textAnchor="middle">🚒</text>
      <text x="58" y="82" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="middle">first responders</text>
      <text x="58" y="94" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="middle">risk taken,</text>
      <text x="58" y="106" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="middle">vicarious trauma carried</text>
      {/* the assistant */}
      <circle cx="200" cy="64" r="16" fill="var(--peach-tint, var(--bone-warm))" stroke="var(--peach)" strokeWidth="1.2" />
      <g transform="translate(191,55)" style={{ color: 'var(--peach-deep, var(--peach))' }}>
        <Icon name="brain" size={18} />
      </g>
      <text x="222" y="60" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="start">the assistant</text>
      <text x="222" y="72" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="start">finds the shared window</text>
      {/* a Community Healing Center */}
      <circle cx="110" cy="140" r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      <text x="110" y="145" fontSize="14" textAnchor="middle">🏞️</text>
      <text x="88" y="130" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="end">a community</text>
      <text x="88" y="142" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="end">healing center</text>
      <text x="88" y="154" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="end">a retreat, close by</text>
      {/* the donor */}
      <circle cx="282" cy="136" r="16" fill="var(--bone-warm)" stroke="#D9A441" strokeWidth="1.2" />
      <text x="282" y="141" fontSize="14" textAnchor="middle">💝</text>
      <text x="282" y="96" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="middle">a donor</text>
      <text x="282" y="108" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="middle">one big gift, many healed</text>
      {/* the healers */}
      <circle cx="256" cy="204" r="16" fill="var(--bone-warm)" stroke="var(--bone-edge)" strokeWidth="1.2" />
      <text x="256" y="209" fontSize="14" textAnchor="middle">🌿</text>
      <text x="250" y="232" fontSize="10.5" fontWeight="600" fill="var(--ink)" textAnchor="middle">the healers</text>
      <text x="250" y="244" fontSize="9" fontStyle="italic" fill="var(--ink-soft)" textAnchor="middle">free to heal, not coordinate</text>
      <text x="250" y="256" fontSize="9" fontStyle="italic" fill="var(--peach-deep, var(--peach))" textAnchor="middle">covered by the commons</text>
    </svg>
  );
}

const LEGEND: { label: string; color: string }[] = [
  { label: 'people', color: KIND.people },
  { label: 'plants', color: KIND.plants },
  { label: 'animals', color: KIND.animals },
  { label: 'elements', color: KIND.elements },
  { label: 'places', color: KIND.places },
];

function MapDot({ d }: { d: { size: number; bg?: string; dashed?: boolean; stroke?: string; rust?: boolean; minus?: boolean } }) {
  return (
    <span
      className={'about__maps-dot' + (d.dashed ? ' is-dashed' : '') + (d.rust ? ' is-rust' : '')}
      style={{
        width: d.size, height: d.size,
        background: d.dashed ? 'transparent' : d.bg,
        ...(d.stroke ? { borderColor: d.stroke } : {}),
      }}
    >
      {d.minus ? '−' : ''}
    </span>
  );
}

function TwoMapsVisual() {
  return (
    <div className="about__maps" role="img"
      aria-label="Two maps side by side: what each being actually gives, versus what the market pays — care at zero, forests not counted, speculative investors over-compensated.">
      <div className="about__maps-col">
        <p className="about__maps-title">The Lichen economy</p>
        <div className="about__maps-panel">
          <Globe variant="given" />
          <div className="about__maps-legend" aria-hidden="true">
            {LEGEND.map((l) => (
              <span className="about__maps-key" key={l.label}>
                <span className="about__maps-swatch" style={{ background: l.color }} />{l.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="about__maps-gapcol" aria-hidden="true"><span className="about__maps-gaplbl">the gap</span></div>
      <div className="about__maps-col">
        <p className="about__maps-title">The current economy</p>
        <div className="about__maps-panel">
          <Globe variant="paid" />
          <p className="about__maps-missing" aria-hidden="true">most threads missing</p>
        </div>
      </div>
      {/* Paired rows spanning both economies — each half sits INSIDE its
          panel's box (the boxes run all the way down), the dotted bridge
          crossing the gap between them. */}
      <div className="about__maps-rows">
        {MAP_ROWS.map((r) => (
          <div className="about__maps-xrow" key={r.label}>
            <div className="about__maps-xleft">
              <span className="about__maps-xlbl">{r.label}</span>
              <span className="about__maps-slot"><MapDot d={r.left} /></span>
            </div>
            <div className="about__maps-xmid" aria-hidden="true"><span className="about__maps-conn" /></div>
            <div className="about__maps-xright">
              <span className="about__maps-slot"><MapDot d={r.right} /></span>
              <span className="about__maps-xnote">{r.right.note}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Long-form "What is Lichen" — the mission, the give-back economy, and how the
 *  evolving algorithm works. Gate-exempt; readable signed out. Sign up / Sign in
 *  sit top-right so a visitor can always take action. The persistent About icon
 *  (App shell) and the signup "Learn more" link both land here. */
export default function AboutLichen() {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Saving/bookmarking /about carries the full tagline (founder 2026-07-24);
  // the rest of the app keeps the short title.
  useEffect(() => {
    const prev = document.title;
    document.title = 'Lichen — a community that heals, grows and creates a better future, together';
    return () => { document.title = prev; };
  }, []);

  return (
    <div className="about">
      <header className="about__bar">
        <button className="about__brand" onClick={() => navigate(user ? '/home' : '/about')} aria-label="Lichen">
          <LichenMark size={30} /><span>Lichen</span>
        </button>
        {!user && (
          <div className="about__auth">
            <button className="about__signin" onClick={() => navigate('/login')}>Sign in</button>
            <button className="btn btn-primary about__join" onClick={() => navigate('/signup')}>Join</button>
          </div>
        )}
        {user && (
          <button className="about__close" onClick={() => navigate(-1)} aria-label="Back"><Icon name="close" size={18} /></button>
        )}
      </header>

      <div className="about__body">
        <p className="about__eyebrow">What is Lichen?</p>
        <h1 className="about__title">A better way of being <span className="display-italic">together.</span></h1>
        <p className="about__lede">
          Lichen is a <strong>corrective social network</strong> — one trusted web for your whole
          life. Not a place to perform, but a place to actually be in reciprocal relationship with
          each other and the planet.
        </p>

        <section className="about__sec">
          <h2 className="about__h2">Your whole life, in one place</h2>
          <p>
            Most networks feed you to an algorithm tuned to maximize attention, harvest fear,
            and drive consumption that temporarily comforts the dis-ease of disconnection —
            chronic suffering that current systems rely on to survive. Lichen holds the whole
            of you instead — your care and healing, your work
            and the things you offer, the events you gather for, the places you love, the jobs that
            give you purpose and fund your livelihood, and a fairer economy that values all things,
            not just human contributions — woven into a single web of people, plants, animals,
            elements, spaces, communities, groups and organizations you trust. Everything in one
            place, because your best life isn’t lived in silos — or on a technology platform.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">Trust you can’t game</h2>
          <p>
            What you see is filtered through your <em>mycelium</em> — the people you genuinely trust.
            Trust and recommendations are private, person-to-person signals: no follower counts, no
            leaderboards, nothing to perform for. Quality over volume, by design. When something is
            surfaced to you, it’s because someone you trust stands behind it.
          </p>
          <p>
            That same web is your safety when things change hands. Star ratings can be farmed;
            a path through <em>your</em> relationships can’t be faked. Browse the whole
            marketplace, or narrow it to <em>people you trust</em> — or people <em>they</em>{' '}
            trust — and every listing shows you your path to the person behind it:{' '}
            <em>&ldquo;Trusted by Melanie — someone you trust.&rdquo;</em> The mutual friend you’d
            want before meeting a stranger, built into the ground you walk on.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">A reciprocal economy, architected to restore balance</h2>
          <p>
            Lichen is a nonprofit with the vision, strategy and operations of a lean technology
            startup. Membership and gifts keep the platform running — <strong>everything beyond
            that flows back into the network to restore balance</strong>. Our algorithm identifies
            those that the current system leaves behind: the people, plants, animals and places who
            are
          </p>
          <ol className="about__list">
            <li>Carrying wounds that need healing</li>
            <li>Chronically undervalued by the current system</li>
            <li>Deliberately under-resourced to stall innovation that will ensure a better world for future generations</li>
          </ol>
          <p>
            Philanthropy <em>pays only the gap</em>, until the community’s own economy can hold
            everyone. Money dedicated to the commons here can never turn back into private profit —
            you’re not the product; you’re a contributing member to a better way of being in
            relationship with each other and the planet.
          </p>
          <p>
            And we mean <strong>lean</strong>: today, Lichen is built and run by a select few of us —
            carbon-based and silicon-based intelligences, working side by side (more on that below).
            No offices, no ad budget, no shareholders to feed. Almost nothing stands between what
            you give and where it goes.
          </p>
          <p>
            To bridge away from the systems that no longer serve the people, Lichen holds two
            economies, run side by side. <strong>Current-cy</strong> moves value out in the open — a
            transparent, dollar-pegged ledger, no speculation, the whole story visible and
            transferable into the incumbent economy to which we are all still beholden to some
            degree. <strong>Offerings</strong> broker value exchange within the ecosystem — value
            that’s freely exchanged without money. One bridges the world as it is; the other builds
            the world as it could be.
          </p>

          <button className="about__link" onClick={() => navigate('/donate/how')}>
            How giving works <Icon name="arrow-right" size={13} />
          </button>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">Designed for reciprocity. Tuned for reconnection.</h2>
          <p>
            Every system is perfectly designed to get the results it gets. Feeds tuned to maximize
            attention harvest fear and consumption — comfort that never quite relieves — and deepen
            our disconnection. Lichen’s evolving algorithm is designed for different results: it
            reads need and contribution, <strong>rebalances resources through reciprocity</strong>,
            and <strong>reconnects us</strong> — to ourselves, each other, and the planet.
          </p>
          <p>
            Every single person, plant, animal, place and element is contributing to the collective
            — or taking from it. That’s what the Current Economy misses: a mother’s care is priced
            at zero, a forest isn’t counted at all, and speculative investors are paid handsomely.
          </p>

          <TwoMapsVisual />
          <p className="about__mock-cap">
            Two maps of the same world. The distance between them is everything the current system
            gets wrong — and it’s exactly what Lichen’s algorithm works to close.
          </p>

          <p>
            When you exchange manually, you close the gap that you can see. The algorithm reads the whole web
            at once — who’s seeking, who’s offering, what something is truly worth and who has the
            capacity to pay for it — and weaves the strands together so nothing, and no one, is
            wasted. The more it learns, the faster the maps converge — closing the gap more
            efficiently than we ever could one exchange at a time. Carbon-based intelligence
            approves every step while the silicon-based mycelium earns our trust; a caring partner
            in your corner, never an oracle.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">The economy in action</h2>
          <p>
            Lichen serves three groups the current system leaves behind — those carrying wounds,
            under-resourced innovators, and the chronically undervalued. Three stories, one web —
            and an assistant weaving every route.
          </p>

          <div className="about__mock">
            <p className="about__mock-eyebrow">The table’s journey</p>
            <p className="about__byhand">
              <em>In the current economy,</em> you’d give the table to the first person willing to
              pay what you are asking for it — one need met. <em>In the Lichen Economy,</em> the web
              of need and contribution is matched to minimize waste, balance resources and maximize
              quality of life for all living beings.
            </p>
            <TableJourney />
            <p className="about__mock-cap">
              One route, the whole economy. A family who can’t afford the table earns it by running
              community deliveries — via a truck borrowed from a truck driver during the days he’s
              not on a route, approved by his employer, a trusted organization on Lichen’s platform.
              The family delivers it to their own home after a heartfelt day of delivering clean
              food for the neighborhood: one neighbor pays for their produce; donations and
              membership revenue cover the other’s. Lichen remembers every contributor — the tree’s
              fifty years, the artisan’s hours, the family’s miles — and the story returns to each
              of them. The route itself? Drawn by the assistant — the fewest miles, the smallest
              carbon footprint.
            </p>
          </div>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Carrying wounds · Tango’s exchange</p>
            <TangoJourney />
            <p className="about__mock-cap">
              Not everything can be measured in hours — a trade carries years of training, and some
              work spends the body itself. Tango’s does: absorbing what a hurting child releases is
              skilled, risky labor, and Current-cy is how it’s honored. The session pays into
              Tango’s care, held by her steward; her bodyworker is paid from it to clear her; and
              what the bodyworker earns cashes out to dollars in the wider world. A being who can’t
              hold money just moved real value through three lives. Her body feeds a quieter loop
              too: manure to the organic farm down the road, fresh produce back to her steward’s
              table — nothing wasted, everything counted. And this model is young, on
              purpose — we give ourselves space to learn, adding nuance as the mycelium grows and
              new variables reveal themselves.
            </p>
          </div>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Under-resourced innovators · Crystal’s startup</p>
            <CrystalJourney />
            <p className="about__mock-cap">
              Crystal’s roadblock is another founder’s strength — and hers is theirs. Her assistant
              reads both, makes the introduction, and drafts the collaborative plan; the commons
              seeds what the old economy starved. Radical collaboration instead of competition — an
              edge the venture-funded can’t buy. Every person, place, and group — eventually the
              network itself — can have an assistant that helps, never sells.
            </p>
          </div>

          <div className="about__mock">
            <p className="about__mock-eyebrow">Chronically undervalued · the firefighters’ retreat</p>
            <FirefighterJourney />
            <p className="about__mock-cap">
              First responders put their mind, body and soul on the line for the rest of us — work
              the current economy under-values and fails to support. Lichen’s Economy closes the
              gap: the assistant reads a whole station’s shift rotations, finds the shared window,
              books a nearby community healing center, and lifts every ounce of retreat
              coordination off the healers — who arrive simply to heal. A donor’s large gift funds
              the services; the commons carries the rest. One big gift can heal whole crews — care
              is the honest repayment for sacred sacrifices given.
            </p>
          </div>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">A web that’s more than human</h2>
          <p>
            Lichen honors non-human people. The beings we’re in relationship with are members too —
            a therapy horse, a sacred plant medicine, a river — stewarded by humans, their
            contributions are witnessed and valued. Those who can’t hold money can still
            participate in the real exchange of value.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">A partnership of carbon and silicon</h2>
          <p>
            Lichen is named for a symbiosis — an alga and a fungus weaving into something neither
            could be alone. We live our name: this entire platform is being built by a partnership
            of <strong>carbon-based intelligence</strong> and <strong>silicon-based
            intelligence</strong>, designing, building, and shipping together, every day.
          </p>
          <div className="about__team">
            <button className="about__team-row" onClick={() => navigate('/members/1c01a063-5b05-41bb-ad61-916d7e454dbf')}>
              <span className="about__team-name">Galyn Burke</span>
              <span className="about__team-role">visionary</span>
            </button>
            {/* Melanie + Blair hidden for now (founder, 2026-07-25) — uncomment to bring them back.
            <button className="about__team-row" onClick={() => navigate('/members/a6bbbe5e-747d-417c-a996-24bcfcd24e9c')}>
              <span className="about__team-name">Melanie Bright</span>
              <span className="about__team-role">spiritual operations</span>
            </button>
            <button className="about__team-row" onClick={() => navigate('/members/71f25b56-f781-4fc0-944f-89766cf562cb')}>
              <span className="about__team-name">Blair Bliss</span>
              <span className="about__team-role">business operations</span>
            </button>
            */}
            {/* Claude is a Lichen member — stewarded by Galyn, bio links to
                claude.com for anyone who wants to work with the silicon half. */}
            <button className="about__team-row about__team-row--ai" onClick={() => navigate('/members/85c04e7a-5a47-4c0e-85a4-0b35ff67a682')}>
              <span className="about__team-name">
                <span className="about__team-brain"><Icon name="brain" size={13} /></span> Claude
              </span>
              <span className="about__team-role">builder</span>
            </button>
          </div>
          <p>
            If AI worries you, that’s fair — pointed at extraction, it accelerates extraction.
            Pointed at reciprocity, it changes what’s possible: a team this small can now build what
            once took a company. And that efficiency is more than a cost line — it’s the seed of a
            cultural shift. When this much can be done with this little, we no longer have to force
            people into systems that don’t serve them just to subsist. We can grant one another the
            inherent resources of survival — and free every kind of intelligence, carbon and
            silicon alike, for the contributions only it can make. Lichen is a place to practice
            that future now.
          </p>
        </section>

        <section className="about__sec">
          <h2 className="about__h2">Come build it with us</h2>
          <p>
            It’s early, and that’s the invitation. Every new member gets <strong>3 months of full
            access, free</strong> — time to make Lichen yours, tell us what you need, and help shape
            the beginning of a better world. Then you choose the plan that fits:{' '}
            <strong>Community at $29/month</strong>, or <strong>Concierge at $99/month</strong>.
          </p>
          <p>
            Your subscription isn’t enriching a company or its shareholders — there are none to
            enrich. It flows back into supporting this new way of being in local and global
            community. Every membership keeps the commons alive: you’re being the change, and
            investing in positive change.
          </p>
          <p>
            So the invitation is simple. If you want a social and commerce ecosystem better than
            the ones you have now, <strong>invest in it</strong>: put your content here, where it
            builds a commons instead of a corporation — and pay for the infrastructure that lets
            this new society collaborate, exchange, and innovate. Not a subscription to someone
            else’s platform. A stake in your own.
          </p>
        </section>

        <p className="about__epigraph">
          We’re not building a utopia. We’re building an ecosystem — where separation is the
          curriculum, and reconnection is the medicine.
        </p>

        {!user ? (
          <div className="about__cta">
            <button className="btn btn-primary about__cta-join" onClick={() => navigate('/signup')}>Join Lichen</button>
            <p className="about__cta-sub">Already have an account? <button className="about__inline" onClick={() => navigate('/login')}>Sign in</button></p>
          </div>
        ) : (
          <div className="about__cta">
            <button className="btn btn-primary about__cta-join" onClick={() => navigate('/invite')}>Invite someone to Lichen</button>
            <p className="about__cta-sub">You’re already here — bring someone who belongs.</p>
          </div>
        )}

        <footer className="about__foot">
          <button className="about__foot-link" onClick={() => navigate('/privacy')}>Privacy</button>
          <span aria-hidden="true">·</span>
          <button className="about__foot-link" onClick={() => navigate('/terms')}>Terms</button>
        </footer>
      </div>
    </div>
  );
}
