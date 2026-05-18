/**
 * The Lichen wordmark — small circular mark + serif italic wordmark.
 * Used in the top bar.
 */
export function LichenMark({ size = 56 }: { size?: number }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: size * 0.6,
      }}
    >
      <svg
        viewBox="0 0 64 64"
        width={size * 0.55}
        height={size * 0.55}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="lichen-bg" cx="50%" cy="38%" r="65%">
            <stop offset="0%" stopColor="#2D3A2A" />
            <stop offset="100%" stopColor="#12181C" />
          </radialGradient>
        </defs>
        <circle cx="32" cy="32" r="32" fill="url(#lichen-bg)" />
        {/* Mycelium pattern — simplified for small size */}
        <g
          stroke="#C5B584"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
        >
          <circle cx="32" cy="32" r="3" fill="#C5B584" stroke="none" />
          <path d="M32 32 Q 24 24, 18 20" />
          <path d="M32 32 Q 40 24, 46 20" />
          <path d="M32 32 Q 24 40, 18 44" />
          <path d="M32 32 Q 40 40, 46 44" />
          <path d="M32 32 V 14" />
          <path d="M32 32 V 50" />
          <circle cx="18" cy="20" r="2" fill="#E8D9A6" stroke="none" />
          <circle cx="46" cy="20" r="2" fill="#E8D9A6" stroke="none" />
          <circle cx="18" cy="44" r="2" fill="#E8D9A6" stroke="none" />
          <circle cx="46" cy="44" r="2" fill="#E8D9A6" stroke="none" />
          <circle cx="32" cy="14" r="2" fill="#E8D9A6" stroke="none" />
          <circle cx="32" cy="50" r="2" fill="#E8D9A6" stroke="none" />
          <circle cx="13" cy="14" r="1.4" fill="#F5A36D" stroke="none" />
          <circle cx="51" cy="14" r="1.4" fill="#F5A36D" stroke="none" />
          <circle cx="13" cy="50" r="1.4" fill="#F5A36D" stroke="none" />
          <circle cx="51" cy="50" r="1.4" fill="#F5A36D" stroke="none" />
        </g>
      </svg>
      <span
        style={{
          fontFamily: 'Fraunces, serif',
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: size * 0.36,
          letterSpacing: '-0.04em',
          color: 'var(--ink)',
          lineHeight: 1,
          fontVariationSettings: '"opsz" 144, "SOFT" 100',
        }}
      >
        lichen
      </span>
    </div>
  );
}
