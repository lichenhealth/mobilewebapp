/**
 * LICHEN icon set — outline style, 24×24 grid, 1.6px stroke.
 * One component, named paths. Add new icons by extending PATHS.
 */
import { SVGProps } from 'react';

export type IconName =
  | 'home'
  | 'concierge'
  | 'chat'
  | 'calendar'
  | 'saved'
  | 'maps'
  | 'profile'
  | 'menu'
  | 'bell'
  | 'search'
  | 'plus'
  | 'store'
  | 'briefcase'
  | 'fork-spoon'
  | 'palette'
  | 'location'
  | 'book'
  | 'graduation-cap'
  | 'health'
  | 'sparkle'
  | 'shield-user'
  | 'thumbs-up'
  | 'send'
  | 'bookmark'
  | 'message'
  | 'arrow-right'
  | 'arrow-up'
  | 'close'
  | 'install'
  | 'arrow-left'
  | 'smile'
  | 'paperclip'
  | 'mic'
  | 'more-horizontal'
  | 'pin'
  | 'check'
  | 'check-double'
  | 'reply'
  | 'info'
  | 'image'
  | 'heart-line';

const PATHS: Record<IconName, JSX.Element> = {
  // ─── Bottom nav ────────────────────────────────────────────────────
  home: (
    <>
      <path d="M4 11.2 12 4l8 7.2v8.3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8.3Z" />
      <path d="M9.5 21V14h5v7" />
    </>
  ),
  concierge: (
    // Stylized pulse / care motif — fits "concierge / curation"
    <>
      <path d="M3 12h3.2l2-4 3.5 8 2.3-6 1.7 2H21" />
    </>
  ),
  chat: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.4 3.5a.6.6 0 0 1-1-.5V17 a2.5 2.5 0 0 1-1 0Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </>
  ),
  saved: (
    <>
      <path d="M6 4h12v17l-6-4-6 4V4Z" />
    </>
  ),
  maps: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.6 4 5.7 4 8.5s-1.5 5.9-4 8.5c-2.5-2.6-4-5.7-4-8.5s1.5-5.9 4-8.5Z" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1-3.6 4-5.5 7-5.5s6 1.9 7 5.5" />
    </>
  ),

  // ─── Top bar ───────────────────────────────────────────────────────
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h11" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2H4.5l1.5-2Z" />
      <path d="M10 19.5a2 2 0 0 0 4 0" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),

  // ─── Category icons (round buttons) ────────────────────────────────
  store: (
    <>
      <path d="M4 9.5 5.5 5h13L20 9.5M4 9.5h16M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5M9 20v-5h6v5" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12h18" />
    </>
  ),
  'fork-spoon': (
    <>
      <path d="M7 4v6a2 2 0 1 0 4 0V4M9 10v10M16 4c-1.5 0-3 1.5-3 4s1.5 4 3 4v8M16 4v8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5C7.3 3.5 3.5 7.3 3.5 12s3.8 8.5 8.5 8.5c1.5 0 2-1 2-2 0-1.5-1-2-1-3 0-1 .8-1.5 2-1.5h2c2 0 3.5-1.5 3.5-3.5 0-4.7-3.8-7-8.5-7Z" />
      <circle cx="7.5" cy="11.5" r="1" fill="currentColor" />
      <circle cx="11" cy="7.5" r="1" fill="currentColor" />
      <circle cx="16" cy="9" r="1" fill="currentColor" />
    </>
  ),
  location: (
    <>
      <path d="M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" />
      <circle cx="12" cy="9" r="2.5" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
    </>
  ),
  'graduation-cap': (
    <>
      <path d="M2.5 9 12 4l9.5 5L12 14 2.5 9Z" />
      <path d="M6.5 11v4.5c0 .8 2.5 2.5 5.5 2.5s5.5-1.7 5.5-2.5V11" />
      <path d="M20 9v5" />
    </>
  ),
  health: (
    <>
      <path d="M12 19.5s-7-4.4-7-9.5a4.5 4.5 0 0 1 7-3.7A4.5 4.5 0 0 1 19 10c0 5.1-7 9.5-7 9.5Z" />
      <path d="M9 10.5h2l1-2 1.5 4 1-2H16" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l3 3M15.5 15.5l3 3M5.5 18.5l3-3M15.5 8.5l3-3" />
    </>
  ),

  // ─── Engagement row ────────────────────────────────────────────────
  'shield-user': (
    <>
      <path d="M12 3.5 4.5 6v6c0 4.4 3.2 7.5 7.5 8.5 4.3-1 7.5-4.1 7.5-8.5V6L12 3.5Z" />
      <circle cx="12" cy="10.5" r="2" />
      <path d="M8.5 16c.5-1.5 2-2.5 3.5-2.5s3 1 3.5 2.5" />
    </>
  ),
  'thumbs-up': (
    <>
      <path d="M7 21V11l4-6.5c.4-.7 1.6-.6 1.8.2L13.5 9H19a1.5 1.5 0 0 1 1.5 1.7l-1.2 8.6A2 2 0 0 1 17.3 21H7Z" />
      <path d="M7 11H3.5v10H7" />
    </>
  ),
  send: (
    <>
      <path d="M21 4 3 11l7 2 2 7 9-16Z" />
      <path d="M10 13 21 4" />
    </>
  ),
  bookmark: (
    <>
      <path d="M6 4h12v17l-6-4-6 4V4Z" />
    </>
  ),
  message: (
    <>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.4 3.5a.6.6 0 0 1-1-.5V17 a2.5 2.5 0 0 1-1 0Z" />
    </>
  ),

  // ─── Misc ──────────────────────────────────────────────────────────
  'arrow-right': (
    <>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  install: (
    <>
      <path d="M12 4v12M6 10l6 6 6-6M4 20h16" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="0.6" fill="currentColor" />
      <circle cx="15" cy="10" r="0.6" fill="currentColor" />
      <path d="M8.5 14.5c.8 1.5 2 2.3 3.5 2.3s2.7-.8 3.5-2.3" />
    </>
  ),
  paperclip: (
    <>
      <path d="M20 12.5 12.5 20a5 5 0 0 1-7-7L13 5.5a3.5 3.5 0 1 1 5 5l-7.5 7.5a2 2 0 0 1-3-3l7-7" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </>
  ),
  'more-horizontal': (
    <>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  pin: (
    <>
      <path d="M12 17v5M7 11.5 12 7l5 4.5-1.5 3-7 0L7 11.5ZM9 4.5h6L13.5 7h-3L9 4.5Z" />
    </>
  ),
  check: (
    <>
      <path d="m5 12 5 5L20 7" />
    </>
  ),
  'check-double': (
    <>
      <path d="m3 12 4 4 7-7M11 16l3 3 8-12" />
    </>
  ),
  reply: (
    <>
      <path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m3 17 5-5 4 4 3-3 6 6" />
    </>
  ),
  'heart-line': (
    <>
      <path d="M12 19.5s-7-4.4-7-9.5a4.5 4.5 0 0 1 7-3.7A4.5 4.5 0 0 1 19 10c0 5.1-7 9.5-7 9.5Z" />
    </>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  strokeWidth?: number;
  fill?: 'none' | 'currentColor';
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.6,
  fill = 'none',
  ...rest
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
