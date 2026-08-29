/**
 * LICHEN icon set — real Figma icons extracted from the wireframe,
 * plus hand-drawn chat actions for icons not in the design system.
 *
 * Each icon carries its own viewBox + strokeWidth so visual weight stays
 * consistent across icons that came from different source sizes.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'bell'
  | 'book'
  | 'booking-tap'
  | 'bookmark'
  | 'brain'
  | 'chat-about'
  | 'plane'
  | 'briefcase'
  | 'calendar'
  | 'chat'
  | 'check'
  | 'groups'
  | 'member-heart'
  | 'check-double'
  | 'chevron-left'
  | 'chevron-right'
  | 'close'
  | 'concierge'
  | 'dollar'
  | 'fork-spoon'
  | 'fingerprint'
  | 'globe'
  | 'graduation-cap'
  | 'health'
  | 'heart-line'
  | 'home'
  | 'image'
  | 'info'
  | 'install'
  | 'leaf'
  | 'lend'
  | 'location'
  | 'maps'
  | 'menu'
  | 'message'
  | 'mic'
  | 'newsfeed'
  | 'more-horizontal'
  | 'grip'
  | 'palette'
  | 'paperclip'
  | 'phone'
  | 'pin'
  | 'plus'
  | 'profile'
  | 'queue'
  | 'reply'
  | 'repeat'
  | 'rent'
  | 'drive'
  | 'pulse'
  | 'chip'
  | 'saved'
  | 'search'
  | 'send'
  | 'settings'
  | 'shield-user'
  | 'smile'
  | 'rsvp'
  | 'sparkle'
  | 'sliders'
  | 'store'
  | 'thumbs-up'
  | 'trade'
  | 'user-multiple'
  | 'video';

interface IconEntry {
  viewBox: string;
  strokeWidth: number;
  content: JSX.Element;
}

const ICONS: Record<IconName, IconEntry> = {
  'arrow-left': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M19 12H5M11 6l-6 6 6 6" /></>,
  },
  'arrow-right': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  },
  'arrow-up': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 19V5M6 11l6-6 6 6" /></>,
  },
  'bell': {
    viewBox: '0 11 14 14',
    strokeWidth: 0.88,
    content: <><path d="M6 24.25H8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 16.75C11 15.6891 10.5786 14.6717 9.82843 13.9216C9.07828 13.1714 8.06087 12.75 7 12.75C5.93913 12.75 4.92172 13.1714 4.17157 13.9216C3.42143 14.6717 3 15.6891 3 16.75V20.25C3 20.6478 2.84196 21.0294 2.56066 21.3107C2.27936 21.592 1.89782 21.75 1.5 21.75H12.5C12.1022 21.75 11.7206 21.592 11.4393 21.3107C11.158 21.0294 11 20.6478 11 20.25V16.75Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M0.5 16.62C0.500539 15.6681 0.727534 14.7301 1.16224 13.8833C1.59694 13.0365 2.22687 12.3052 3 11.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M13.5 16.62C13.4995 15.6681 13.2725 14.7301 12.8378 13.8833C12.4031 13.0365 11.7731 12.3052 11 11.75" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'book': {
    viewBox: '245 216 20 21',
    strokeWidth: 1.31,
    content: <><path d="M262.857 236.25H249.286C248.717 236.25 248.172 236.013 247.77 235.591C247.369 235.169 247.143 234.597 247.143 234C247.143 233.403 247.369 232.831 247.77 232.409C248.172 231.987 248.717 231.75 249.286 231.75H261.429C261.807 231.75 262.171 231.592 262.439 231.311C262.707 231.029 262.857 230.648 262.857 230.25V218.25C262.857 217.852 262.707 217.471 262.439 217.189C262.171 216.908 261.807 216.75 261.429 216.75H249.286C248.727 216.75 248.191 216.979 247.79 217.388C247.39 217.797 247.158 218.354 247.143 218.94V233.94" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M261.428 231.75V236.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M256.502 223.503H259.809L256.295 228.712H260.016" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M250.017 224.978L251.539 220.181C251.618 219.935 251.837 219.77 252.084 219.77C252.331 219.77 252.55 219.935 252.628 220.181L254.151 224.978M250.568 223.242H253.599" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  // Bookings: a calendar being tapped (founder 2026-08-14 — member-heart is
  // the Members mark and read as "directory" on the Calendar toolbar). The
  // word itself lives in the label; lettering dies at hairline sizes.
  'booking-tap': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <>
      <path d="M6.5 2.5v3M12.5 2.5v3" />
      <path d="M16.5 8.5V6.2c0-1-.8-1.8-1.8-1.8H4.8C3.8 4.4 3 5.2 3 6.2v8.1c0 1 .8 1.8 1.8 1.8h4.7" />
      <path d="M3 8.4h13.5" />
      <path d="M13.8 13.6V9.9a1.2 1.2 0 0 1 2.4 0v4.6l2.8.7c.9.2 1.5 1.1 1.3 2l-.5 2.3a2 2 0 0 1-2 1.6h-2.7a2 2 0 0 1-1.5-.7l-2.4-2.8a1.1 1.1 0 0 1 1.6-1.5l1 1Z" />
    </>,
  },
  'bookmark': {
    viewBox: '264 838 29 26',
    strokeWidth: 1.81,
    content: <><path d="M286.786 863.071L278.5 855.643L270.214 863.071V840.786C270.214 840.293 270.433 839.821 270.821 839.472C271.21 839.124 271.736 838.928 272.286 838.928H284.714C285.264 838.928 285.791 839.124 286.179 839.472C286.567 839.821 286.786 840.293 286.786 840.786V863.071Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'briefcase': {
    viewBox: '180.52 217.5 17 17',
    strokeWidth: 1.06,
    content: <><path d="M195.363 221.961H182.671C182.034 221.961 181.517 222.478 181.517 223.115V232.346C181.517 232.983 182.034 233.5 182.671 233.5H195.363C196.001 233.5 196.517 232.983 196.517 232.346V223.115C196.517 222.478 196.001 221.961 195.363 221.961Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M192.479 221.962V219.654C192.479 219.348 192.357 219.054 192.141 218.838C191.925 218.622 191.631 218.5 191.325 218.5H186.71C186.404 218.5 186.11 218.622 185.894 218.838C185.677 219.054 185.556 219.348 185.556 219.654V221.962" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'calendar': {
    viewBox: '201 834 32 31',
    strokeWidth: 2.0,
    content: <><path d="M211.667 836.583V840.458" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/><path d="M222.333 836.583V840.458" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/><path d="M205 846.465C205 840.394 207.227 838.766 211.667 838.521H222.333C226.773 838.753 229 840.394 229 846.465V854.447C229 859.769 227.667 862.43 221 862.43H213C206.333 862.43 205 859.769 205 854.447V852.083" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/><path d="M228.666 856.733H205.333" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/><path d="M217 845.156C217.739 845.156 218.376 845.352 218.815 845.693C219.241 846.024 219.514 846.514 219.514 847.201C219.514 847.818 219.238 848.263 218.763 848.58L218.076 849.039L218.801 849.435C219.479 849.805 219.834 850.407 219.834 851.089C219.834 851.742 219.579 852.243 219.13 852.593C218.666 852.954 217.952 853.185 217 853.185C216.04 853.185 215.327 852.954 214.866 852.594C214.419 852.245 214.167 851.744 214.167 851.089C214.167 850.409 214.52 849.817 215.195 849.431L215.9 849.027L215.223 848.579C214.762 848.275 214.474 847.818 214.474 847.201C214.474 846.516 214.749 846.026 215.178 845.694C215.621 845.352 216.261 845.156 217 845.156ZM217 849.193C216.49 849.193 215.994 849.313 215.612 849.596C215.213 849.892 214.981 850.339 214.98 850.882C214.98 851.424 215.212 851.874 215.609 852.173C215.99 852.46 216.487 852.583 217 852.583C217.513 852.583 218.011 852.46 218.392 852.173C218.789 851.874 219.021 851.424 219.021 850.882C219.02 850.343 218.786 849.898 218.39 849.602C218.009 849.317 217.513 849.193 217 849.193ZM217 845.771C216.568 845.771 216.148 845.887 215.824 846.151C215.49 846.425 215.301 846.825 215.301 847.291C215.301 847.752 215.49 848.152 215.818 848.428C216.139 848.697 216.56 848.824 217 848.824C217.44 848.824 217.861 848.697 218.182 848.428C218.51 848.152 218.7 847.752 218.7 847.291C218.7 846.825 218.511 846.425 218.177 846.151C217.853 845.887 217.432 845.771 217 845.771Z" fill="currentColor" stroke="currentColor"/></>,
  },
  'chat': {
    viewBox: '143 836 33 28',
    strokeWidth: 2.06,
    content: <><path d="M154.688 858.167H154C148.5 858.167 145.75 857 145.75 851.167V845.333C145.75 840.667 148.5 838.333 154 838.333H165C170.5 838.333 173.25 840.667 173.25 845.333V851.167C173.25 855.833 170.5 858.167 165 858.167H164.313C163.886 858.167 163.474 858.342 163.213 858.633L161.15 860.967C160.243 861.993 158.758 861.993 157.85 860.967L155.788 858.633C155.568 858.377 155.059 858.167 154.688 858.167Z" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'check': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="m5 12 5 5L20 7" /></>,
  },
  'check-double': {
    viewBox: '0.5 1 24 24',
    strokeWidth: 1.6,
    content: <><path d="m3 12 4 4 7-7M11 16l3 3 8-12" /></>,
  },
  // Founder's Groups mark (Figma icon set: user-multiple-group)
  'groups': {
    viewBox: '-1 -1 18 16.85',
    strokeWidth: 1.1,
    content: <>
      <path d="M5.69231 6.26923C7.28543 6.26923 8.57692 4.97774 8.57692 3.38462C8.57692 1.79149 7.28543 0.5 5.69231 0.5C4.09918 0.5 2.80769 1.79149 2.80769 3.38462C2.80769 4.97774 4.09918 6.26923 5.69231 6.26923Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M0.5 14.3462H5.69231H10.8846V13.7207C10.8754 12.8412 10.6435 11.9783 10.2105 11.2129C9.77742 10.4473 9.15742 9.80404 8.40838 9.34309C7.65933 8.88213 6.80567 8.61855 5.92714 8.57696C5.84882 8.57325 5.77052 8.57132 5.69231 8.57115C5.6141 8.57132 5.5358 8.57325 5.45748 8.57696C4.57895 8.61855 3.72529 8.88213 2.97623 9.34309C2.22719 9.80404 1.6072 10.4473 1.17416 11.2129C0.741127 11.9783 0.509186 12.8412 0.5 13.7207V14.3462Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.3077 6.26923C11.9008 6.26923 13.1923 4.97774 13.1923 3.38462C13.1923 1.79149 11.9008 0.5 10.3077 0.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.1923 14.3463H15.5V13.7207C15.4908 12.8412 15.2588 11.9783 14.8258 11.2129C14.3928 10.4473 13.7728 9.80406 13.0237 9.34311C12.5396 9.04513 12.0116 8.82964 11.4615 8.70327" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </>,
  },
  // Founder's Members mark: a person whose body is a heart
  'member-heart': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <>
      <path d="M12 8.8a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Z" />
      <path d="M12 21c-3.9-2.9-6.3-5.2-6.3-7.7 0-1.8 1.4-3.1 3-3.1 1.3 0 2.5.8 3.3 2 .8-1.2 2-2 3.3-2 1.6 0 3 1.3 3 3.1 0 2.5-2.4 4.8-6.3 7.7Z" />
    </>,
  },
  'close': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M6 6l12 12M18 6 6 18" /></>,
  },
  'concierge': {
    viewBox: '92 841 16 16',
    strokeWidth: 1.0,
    content: <><path d="M99.9912 855.131L94.3561 849.732C91.2849 846.537 95.7648 840.35 99.9912 845.355C104.218 840.365 108.74 846.551 105.626 849.732L99.9912 855.131Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M96.3752 849.034H97.9677L99.0402 846.914L100.665 850.818L102.063 849.034H103.623" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'fork-spoon': {
    viewBox: '314 218 18 17',
    strokeWidth: 1.0,
    content: <><path d="M327.8 225.923C329.567 225.923 331 224.373 331 222.462C331 220.55 329.567 219 327.8 219C326.033 219 324.6 220.55 324.6 222.462C324.6 224.373 326.033 225.923 327.8 225.923Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M327.8 225.923V234" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M318.333 219V234" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M321.666 219V221.885C321.666 222.263 321.58 222.639 321.413 222.989C321.245 223.338 321 223.656 320.69 223.924C320.381 224.192 320.013 224.405 319.609 224.55C319.204 224.695 318.771 224.769 318.333 224.769C317.449 224.769 316.601 224.465 315.976 223.924C315.351 223.383 315 222.65 315 221.885V219" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  // Identities' mark (founder 2026-08-21: "let's use a Fingerprint icon for
  // Identities!") — hand-drawn ridge arcs, no fill so it survives filled chips.
  'fingerprint': {
    viewBox: '0 1 24 24',
    strokeWidth: 1.5,
    content: <>
      <path d="M5 12a7 7 0 0 1 14 0c0 2.5-.35 4.9-1.05 7.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.2 12a3.8 3.8 0 0 1 7.6 0c0 2.9-.45 5.7-1.3 8.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 12v2.8c0 2.1-.3 4.2-.9 6.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.6 15.5c.35 1.9.95 3.7 1.75 5.4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </>,
  },
  'globe': {
    viewBox: '315 836 26 26',
    strokeWidth: 1.62,
    content: <><path d="M328 862C335.18 862 341 856.18 341 849C341 841.82 335.18 836 328 836C320.82 836 315 841.82 315 849C315 856.18 320.82 862 328 862Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M316 854H319.5C320.428 854 321.319 853.631 321.975 852.975C322.631 852.318 323 851.428 323 850.5V847.5C323 846.572 323.369 845.681 324.025 845.025C324.682 844.369 325.572 844 326.5 844C327.428 844 328.319 843.631 328.975 842.975C329.631 842.318 330 841.428 330 840.5V836.14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M341 848.8C339.999 848.28 338.888 848.006 337.76 848H333.5C332.572 848 331.681 848.369 331.025 849.025C330.369 849.681 330 850.572 330 851.5C330 852.428 330.369 853.319 331.025 853.975C331.681 854.631 332.572 855 333.5 855C334.163 855 334.799 855.263 335.268 855.732C335.737 856.201 336 856.837 336 857.5V859.24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'graduation-cap': {
    viewBox: '213 216 21 21',
    strokeWidth: 1.44,
    content: <><path d="M223 217.247L232.286 221.873L223 226.5L213.714 221.873L223 217.247Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M217.927 223.984L217.937 229.018C217.937 229.018 219.47 231.351 223 231.351C226.529 231.351 228.071 229.018 228.071 229.018L228.07 223.984" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M215.422 232.416V222.739" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M215.423 236.346C216.366 236.346 217.131 235.466 217.131 234.381C217.131 233.296 216.366 232.417 215.423 232.417C214.479 232.417 213.714 233.296 213.714 234.381C213.714 235.466 214.479 236.346 215.423 236.346Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'health': {
    viewBox: '382 217 13 17',
    strokeWidth: 1.06,
    content: <><path d="M394.207 228.56C394.457 228.327 394.657 228.046 394.793 227.734C394.93 227.423 395 227.088 395 226.749C395 226.41 394.93 226.075 394.793 225.763C394.657 225.452 394.457 225.171 394.207 224.938C393.694 224.46 393.014 224.194 392.307 224.194C391.6 224.194 390.92 224.46 390.407 224.938L388.5 226.808L386.593 224.938C386.08 224.46 385.4 224.194 384.693 224.194C383.986 224.194 383.306 224.46 382.793 224.938C382.542 225.171 382.343 225.452 382.207 225.763C382.07 226.075 382 226.41 382 226.749C382 227.088 382.07 227.423 382.207 227.734C382.343 228.046 382.542 228.327 382.793 228.56L388.5 234L394.207 228.56Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M388.501 222.231C389.974 222.231 391.168 221.06 391.168 219.615C391.168 218.171 389.974 217 388.501 217C387.028 217 385.834 218.171 385.834 219.615C385.834 221.06 387.028 222.231 388.501 222.231Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'heart-line': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 19.5s-7-4.4-7-9.5a4.5 4.5 0 0 1 7-3.7A4.5 4.5 0 0 1 19 10c0 5.1-7 9.5-7 9.5Z" /></>,
  },
  'home': {
    viewBox: '0 0 30 33',
    strokeWidth: 2.06,
    content: <><path d="M2.5 30.25H27.5" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.6875 30.25L3.75 13.7087C3.75 12.87 4.1125 12.0725 4.7125 11.55L13.4625 4.05626C14.3625 3.28626 15.625 3.28626 16.5375 4.05626L25.2875 11.5363C25.9 12.0588 26.25 12.8562 26.25 13.7087V30.25" stroke="currentColor" strokeMiterlimit="10" strokeLinejoin="round"/><path d="M16.25 23.375H13.75C12.7125 23.375 11.875 24.2962 11.875 25.4375V30.25H18.125V25.4375C18.125 24.2962 17.2875 23.375 16.25 23.375Z" stroke="currentColor" strokeMiterlimit="10" strokeLinejoin="round"/><path d="M11.875 18.9063H9.375C8.6875 18.9063 8.125 18.2875 8.125 17.5313V15.4688C8.125 14.7125 8.6875 14.0938 9.375 14.0938H11.875C12.5625 14.0938 13.125 14.7125 13.125 15.4688V17.5313C13.125 18.2875 12.5625 18.9063 11.875 18.9063Z" stroke="currentColor" strokeMiterlimit="10" strokeLinejoin="round"/><path d="M20.625 18.9063H18.125C17.4375 18.9063 16.875 18.2875 16.875 17.5313V15.4688C16.875 14.7125 17.4375 14.0938 18.125 14.0938H20.625C21.3125 14.0938 21.875 14.7125 21.875 15.4688V17.5313C21.875 18.2875 21.3125 18.9063 20.625 18.9063Z" stroke="currentColor" strokeMiterlimit="10" strokeLinejoin="round"/><path d="M23.7499 9.625L23.7124 5.5H18.2124" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'image': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
  },
  'info': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-5M12 8h.01" /></>,
  },
  'install': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 4v12M6 10l6 6 6-6M4 20h16" /></>,
  },
  'location': {
    viewBox: '167 773 7 8',
    strokeWidth: 0.5,
    content: <><path d="M172.923 775.72C172.923 777.533 170.5 779.648 170.5 779.648C170.5 779.648 168.077 777.533 168.077 775.72C168.077 774.238 169.18 773 170.5 773C171.82 773 172.923 774.238 172.923 775.72Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M170.5 776.626C170.946 776.626 171.308 776.221 171.308 775.72C171.308 775.219 170.946 774.813 170.5 774.813C170.054 774.813 169.692 775.219 169.692 775.72C169.692 776.221 170.054 776.626 170.5 776.626Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M172.695 778.742H173.192L174 780.857H167L167.808 778.742H168.305" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'maps': {
    viewBox: '315 836 26 26',
    strokeWidth: 1.62,
    content: <><path d="M328 862C335.18 862 341 856.18 341 849C341 841.82 335.18 836 328 836C320.82 836 315 841.82 315 849C315 856.18 320.82 862 328 862Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M316 854H319.5C320.428 854 321.319 853.631 321.975 852.975C322.631 852.318 323 851.428 323 850.5V847.5C323 846.572 323.369 845.681 324.025 845.025C324.682 844.369 325.572 844 326.5 844C327.428 844 328.319 843.631 328.975 842.975C329.631 842.318 330 841.428 330 840.5V836.14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M341 848.8C339.999 848.28 338.888 848.006 337.76 848H333.5C332.572 848 331.681 848.369 331.025 849.025C330.369 849.681 330 850.572 330 851.5C330 852.428 330.369 853.319 331.025 853.975C331.681 854.631 332.572 855 333.5 855C334.163 855 334.799 855.263 335.268 855.732C335.737 856.201 336 856.837 336 857.5V859.24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'menu': {
    viewBox: '0 0 36 36',
    strokeWidth: 2.25,
    content: <><path d="M11.52 13.6799H24.48" stroke="currentColor" strokeLinecap="round"/><path d="M11.52 18.72H24.48" stroke="currentColor" strokeLinecap="round"/><path d="M11.52 23.76H24.48" stroke="currentColor" strokeLinecap="round"/></>,
  },
  'message': {
    viewBox: '143 836 33 28',
    strokeWidth: 2.06,
    content: <><path d="M154.688 858.167H154C148.5 858.167 145.75 857 145.75 851.167V845.333C145.75 840.667 148.5 838.333 154 838.333H165C170.5 838.333 173.25 840.667 173.25 845.333V851.167C173.25 855.833 170.5 858.167 165 858.167H164.313C163.886 858.167 163.474 858.342 163.213 858.633L161.15 860.967C160.243 861.993 158.758 861.993 157.85 860.967L155.788 858.633C155.568 858.377 155.059 858.167 154.688 858.167Z" stroke="currentColor" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'mic': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" /></>,
  },
  'more-horizontal': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /><circle cx="19" cy="12" r="1.2" fill="currentColor" /></>,
  },
  'palette': {
    viewBox: '345 215 21 21',
    strokeWidth: 1.31,
    content: <><path d="M357.75 222.5C358.578 222.5 359.25 221.828 359.25 221C359.25 220.172 358.578 219.5 357.75 219.5C356.922 219.5 356.25 220.172 356.25 221C356.25 221.828 356.922 222.5 357.75 222.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M351.75 230C352.164 230 352.5 229.664 352.5 229.25C352.5 228.836 352.164 228.5 351.75 228.5C351.336 228.5 351 228.836 351 229.25C351 229.664 351.336 230 351.75 230Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M351.75 224.75C352.578 224.75 353.25 224.078 353.25 223.25C353.25 222.422 352.578 221.75 351.75 221.75C350.922 221.75 350.25 222.422 350.25 223.25C350.25 224.078 350.922 224.75 351.75 224.75Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M359.28 233.42C359.263 233.129 359.162 232.849 358.989 232.615C358.816 232.381 358.578 232.202 358.305 232.1C357.627 231.877 357.05 231.419 356.679 230.809C356.308 230.199 356.166 229.477 356.28 228.772C356.394 228.067 356.756 227.425 357.3 226.963C357.845 226.501 358.536 226.248 359.25 226.25H362.055C362.536 226.251 363.011 226.137 363.438 225.917C363.866 225.696 364.234 225.376 364.512 224.983C364.79 224.591 364.969 224.137 365.035 223.66C365.101 223.184 365.051 222.698 364.89 222.245C364.294 220.56 363.245 219.072 361.86 217.943C360.475 216.814 358.806 216.087 357.036 215.842C355.266 215.597 353.462 215.843 351.823 216.554C350.183 217.264 348.77 218.412 347.738 219.871C346.707 221.33 346.096 223.045 345.973 224.828C345.849 226.611 346.219 228.393 347.04 229.98C347.861 231.568 349.103 232.899 350.629 233.828C352.156 234.757 353.908 235.249 355.695 235.25C356.578 235.252 357.456 235.131 358.305 234.89C358.617 234.803 358.887 234.606 359.066 234.336C359.245 234.066 359.321 233.741 359.28 233.42Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'paperclip': {
    viewBox: '0.25 0.73 24 24',
    strokeWidth: 1.6,
    content: <><path d="M20 12.5 12.5 20a5 5 0 0 1-7-7L13 5.5a3.5 3.5 0 1 1 5 5l-7.5 7.5a2 2 0 0 1-3-3l7-7" /></>,
  },
  'pin': {
    viewBox: '0 1.25 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 17v5M7 11.5 12 7l5 4.5-1.5 3-7 0L7 11.5ZM9 4.5h6L13.5 7h-3L9 4.5Z" /></>,
  },
  'plus': {
    viewBox: '61 211 30 30',
    strokeWidth: 1.88,
    content: <><path d="M76 241C84.2844 241 91 234.284 91 226C91 217.716 84.2844 211 76 211C67.7157 211 61 217.716 61 226C61 234.284 67.7157 241 76 241Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M76 219.077V232.923" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M69.0762 226H82.9223" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'profile': {
    viewBox: '0 0 26 26',
    strokeWidth: 1.62,
    content: <><path d="M12.9999 25.0713C19.6669 25.0713 25.0713 19.6669 25.0713 12.9999C25.0713 6.33303 19.6669 0.928467 12.9999 0.928467C6.33303 0.928467 0.928467 6.33303 0.928467 12.9999C0.928467 19.6669 6.33303 25.0713 12.9999 25.0713Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M12.9998 14.857C15.564 14.857 17.6426 12.7783 17.6426 10.2141C17.6426 7.64997 15.564 5.57129 12.9998 5.57129C10.4356 5.57129 8.35693 7.64997 8.35693 10.2141C8.35693 12.7783 10.4356 14.857 12.9998 14.857Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.06982 22.0999C5.89856 20.7396 7.0633 19.6152 8.45207 18.8352C9.84084 18.055 11.4069 17.6453 12.9998 17.6453C14.5927 17.6453 16.1588 18.055 17.5476 18.8352C18.9364 19.6152 20.101 20.7396 20.9299 22.0999" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'reply': {
    viewBox: '0 1.5 24 24',
    strokeWidth: 1.6,
    content: <><path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v3" /></>,
  },
  'repeat': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M17 2l4 4-4 4M3 11V10a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" /></>,
  },
  // A curatable list: bars for the pieces, an up/down arrow for reordering
  // them — the Curate door's glyph (founder 2026-08-10).
  'queue': {
    viewBox: '0.75 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M3 6h12M3 12h9M3 18h12" strokeLinecap="round"/><path d="M20 4v16M20 4l-2.5 3M20 4l2.5 3M20 20l-2.5-3M20 20l2.5-3" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  // Drag handle: two columns of dots — grab a row and pull it where it goes.
  'grip': {
    viewBox: '0 0 24 24',
    strokeWidth: 2.4,
    content: <><path d="M9 5.5h.01M9 12h.01M9 18.5h.01M15 5.5h.01M15 12h.01M15 18.5h.01" strokeLinecap="round"/></>,
  },
  // Drive: a cloud with a Current-cy bolt coming out of it (founder
  // 2026-08-14 — "since it is a cloud storage offering... a nod to
  // current-cy"). The bookmark stays the SAVE gesture; this marks the place.
  /** THE TWO INTELLIGENCES (founder 2026-08-16/17). A pulse for carbon — a
   *  human steward answering for a place or a being — and a chip for silicon.
   *  Extracted out of the two hand-drawn avatars so ANY member or space can
   *  wear one as a badge, which is what a per-entity assistant needs: you
   *  should always be able to see which kind of mind you're talking to. */
  'pulse': {
    viewBox: '0 0 24 24',
    strokeWidth: 2.2,
    content: <><path d="M2 12h4.5l2.5-7 3.5 14 2.5-7H22" strokeLinecap="round" strokeLinejoin="round" /></>,
  },
  'chip': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.9,
    content: <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
      <path d="M10.5 10.5h3v3h-3z" />
      <path d="M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3" strokeLinecap="round" />
    </>,
  },
  'drive': {
    // Sized to its neighbours (founder 2026-08-15: "the cloud is smaller than
    // the other icons"). The original filled 52% of the viewBox height where
    // profile/calendar fill 83–93%, so it read small in the nav. Same shape,
    // scaled 1.17× about its own centre and re-centred in the box, with a
    // taller bolt — coordinates rewritten rather than wrapped in a transform,
    // so the stroke stays 1.6 like everything around it. The bolt drops THROUGH
    // the gap in the cloud's baseline and past it: a cloud is wider than it is
    // tall and can't fill the box vertically without ceasing to look like a
    // cloud, so the bolt carries the height — and gets to be the subject,
    // which is what was asked for.
    // Then 15% bigger again, by CROPPING the viewBox to the glyph rather than
    // scaling the path — the drawing had already reached the edges, so scaling
    // further clipped it under the stroke. The box is now the glyph's own
    // bounds, which puts the outer half-stroke flush at the left and right
    // edges exactly as Maps' circle does — that flush edge is what buys the
    // full 15%. Measured at size 20: 17.4px drawn before, 20.0px now, the same
    // as Maps. strokeWidth drops to 1.36 so the line still lands at ~1.3px,
    // like Chat, Calendar, Maps and Profile.
    viewBox: '1.53 2.81 20.94 20.94',
    strokeWidth: 1.36,
    content: <>
      <path d="M9.02 19.34H6.21a4.68 4.68 0 0 1-.47-9.34 6.08 6.08 0 0 1 11.85-1.05A4.21 4.21 0 0 1 16.97 19.34h-1.87" />
      <path d="M13.5 8.5 9.9 14.9h2.6l-1 7 3.5-7.8h-2.6l1.1-5.6Z" />
    </>,
  },
  'saved': {
    viewBox: '264 838 29 26',
    strokeWidth: 1.81,
    content: <><path d="M286.786 863.071L278.5 855.643L270.214 863.071V840.786C270.214 840.293 270.433 839.821 270.821 839.472C271.21 839.124 271.736 838.928 272.286 838.928H284.714C285.264 838.928 285.791 839.124 286.179 839.472C286.567 839.821 286.786 840.293 286.786 840.786V863.071Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'search': {
    viewBox: '28 211 30 30',
    strokeWidth: 1.88,
    // fill=none, not white: on a filled peach chip (Marketplace ISO) a white
    // fill swallowed the glyph into a blank disc
    content: <><path d="M43 241C51.2844 241 58 234.284 58 226C58 217.716 51.2844 211 43 211C34.7157 211 28 217.716 28 226C28 234.284 34.7157 241 43 241Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M41.8454 230.615C45.0317 230.615 47.6146 228.032 47.6146 224.846C47.6146 221.66 45.0317 219.077 41.8454 219.077C38.6591 219.077 36.0762 221.66 36.0762 224.846C36.0762 228.032 38.6591 230.615 41.8454 230.615Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M49.9229 232.923L45.9307 228.931" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'send': {
    viewBox: '224.42 456.58 14 14',
    strokeWidth: 0.88,
    content: <><path d="M230.155 465.341C230.055 465.121 229.879 464.945 229.659 464.845L226.672 463.487C225.865 463.12 225.899 461.962 226.727 461.644L235.4 458.308C236.209 457.997 237.003 458.791 236.692 459.6L233.356 468.273C233.038 469.101 231.88 469.135 231.513 468.328L230.155 465.341Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M230 465L233 462" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'shield-user': {
    viewBox: '102 457 13 13',
    strokeWidth: 0.81,
    content: <><path d="M108.834 469.471C108.619 469.554 108.381 469.554 108.166 469.471C106.486 468.812 105.043 467.662 104.026 466.172C103.009 464.681 102.465 462.918 102.464 461.114V458.393C102.464 458.147 102.562 457.91 102.736 457.736C102.91 457.562 103.147 457.464 103.393 457.464H113.607C113.853 457.464 114.09 457.562 114.264 457.736C114.438 457.91 114.536 458.147 114.536 458.393V461.104C114.537 462.911 113.994 464.675 112.977 466.168C111.96 467.66 110.516 468.811 108.834 469.471Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M104.634 466.964C105.466 465.715 106.887 464.893 108.5 464.893C110.113 464.893 111.534 465.715 112.366 466.964" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M108.5 463.5C109.654 463.5 110.589 462.565 110.589 461.411C110.589 460.257 109.654 459.322 108.5 459.322C107.346 459.322 106.411 460.257 106.411 461.411C106.411 462.565 107.346 463.5 108.5 463.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'smile': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><circle cx="12" cy="12" r="9" /><circle cx="9" cy="10" r="0.6" fill="currentColor" /><circle cx="15" cy="10" r="0.6" fill="currentColor" /><path d="M8.5 14.5c.8 1.5 2 2.3 3.5 2.3s2.7-.8 3.5-2.3" /></>,
  },
  'rsvp': {
    viewBox: '14 12 43 44',
    strokeWidth: 2.6,
    content: <>
      {/* Events mark — RSVP envelope, exported from the founder's Figma */}
      <path d="M51.1558 24.2881H20.5484C19.0116 24.2881 17.7659 25.5339 17.7659 27.0706V50.7224C17.7659 52.2592 19.0116 53.505 20.5484 53.505H51.1558C52.6925 53.505 53.9383 52.2592 53.9383 50.7224V27.0706C53.9383 25.5339 52.6925 24.2881 51.1558 24.2881Z" />
      <path d="M17.9971 26.5371L34.1742 36.0302C34.6454 36.3088 35.2391 36.4614 35.8523 36.4614C36.4654 36.4614 37.0592 36.3088 37.5303 36.0302L53.6757 26.5371" />
      <path d="M23.3098 29.0881V15.375C23.3098 14.8227 23.7575 14.375 24.3098 14.375H46.4834C47.0357 14.375 47.4834 14.8227 47.4834 15.375V29.7814" />
      <text x="35.8" y="46.8" textAnchor="middle" fill="currentColor" stroke="none" fontSize="6.4" fontFamily="Archivo, sans-serif" fontWeight="600" letterSpacing="0.06em">RSVP</text>
    </>,
  },
  'sparkle': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l3 3M15.5 15.5l3 3M5.5 18.5l3-3M15.5 8.5l3-3" /></>,
  },
  'sliders': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M4 8.5h8M16 8.5h4M4 15.5h3M11 15.5h9" stroke="currentColor" strokeLinecap="round"/><circle cx="14" cy="8.5" r="2" stroke="currentColor"/><circle cx="9" cy="15.5" r="2" stroke="currentColor"/></>,
  },
  /* The section's own newspaper (founder 2026-08-07). Drawn here rather than
     lifted from Figma, so it's a clean 24 box — a folded sheet, a headline
     block and column rules, at the family's hairline weight. */
  'newsfeed': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.4,
    content: <><path d="M17.5 19.5H5.5C4.67 19.5 4 18.83 4 18V5.5C4 5.22 4.22 5 4.5 5H17C17.28 5 17.5 5.22 17.5 5.5V19.5Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M17.5 9H19.5C19.78 9 20 9.22 20 9.5V18C20 18.83 19.33 19.5 18.5 19.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M6.75 8H11V11.5H6.75V8Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M13 8H15.25M13 10.25H15.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M6.75 14H15.25M6.75 16.5H15.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'store': {
    viewBox: '147 217 17 17',
    strokeWidth: 1.06,
    content: <><path d="M149.095 227.661V233.138C149.095 233.3 149.156 233.455 149.264 233.569C149.372 233.683 149.519 233.747 149.672 233.747H161.21C161.363 233.747 161.51 233.683 161.618 233.569C161.726 233.455 161.787 233.3 161.787 233.138V227.661" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M156.595 227.661V233.747" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M149.095 229.487H156.595" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M147.94 222.183L149.671 217.923H161.21L162.94 222.183H147.94Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M152.879 222.184V223.401C152.879 224.047 152.636 224.666 152.203 225.122C151.77 225.579 151.183 225.835 150.571 225.835H150.248C149.636 225.835 149.049 225.579 148.616 225.122C148.184 224.666 147.94 224.047 147.94 223.401V222.184" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M158.037 222.184V223.401C158.037 224.047 157.794 224.666 157.361 225.122C156.928 225.579 156.341 225.835 155.729 225.835H155.152C154.54 225.835 153.953 225.579 153.521 225.122C153.088 224.666 152.845 224.047 152.845 223.401V222.184" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M162.941 222.184V223.401C162.941 224.047 162.698 224.666 162.265 225.122C161.832 225.579 161.245 225.835 160.633 225.835H160.345C159.733 225.835 159.146 225.579 158.713 225.122C158.28 224.666 158.037 224.047 158.037 223.401V222.184" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'thumbs-up': {
    viewBox: '145 455 16 14',
    strokeWidth: 1.0,
    content: <><path d="M149.667 461.417L152.333 456.167C152.864 456.167 153.372 456.351 153.747 456.679C154.123 457.007 154.333 457.453 154.333 457.917V460.25H158.107C158.3 460.248 158.491 460.283 158.668 460.352C158.844 460.422 159.001 460.524 159.128 460.651C159.255 460.779 159.348 460.929 159.402 461.091C159.456 461.254 159.469 461.425 159.44 461.592L158.52 466.842C158.472 467.12 158.31 467.374 158.065 467.556C157.82 467.738 157.508 467.837 157.187 467.833H149.667M149.667 461.417V467.833M149.667 461.417H147.667C147.313 461.417 146.974 461.54 146.724 461.758C146.474 461.977 146.333 462.274 146.333 462.583V466.667C146.333 466.976 146.474 467.273 146.724 467.492C146.974 467.71 147.313 467.833 147.667 467.833H149.667" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'user-multiple': {
    viewBox: '185 524 10 10',
    strokeWidth: 0.62,
    content: <><path d="M192.456 529.714C191.821 529.714 191.306 529.199 191.306 528.564C191.306 527.929 191.821 527.414 192.456 527.414C193.091 527.414 193.606 527.929 193.606 528.564C193.606 529.199 193.091 529.714 192.456 529.714Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M190.785 531.489C190.943 531.322 191.127 531.179 191.329 531.065C191.673 530.872 192.061 530.77 192.456 530.77C192.85 530.77 193.238 530.872 193.582 531.065C193.731 531.148 193.869 531.248 193.995 531.361" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M188.735 529.345C187.948 529.345 187.31 528.707 187.31 527.92C187.31 527.133 187.948 526.495 188.735 526.495C189.522 526.495 190.16 527.133 190.16 527.92C190.16 528.707 189.522 529.345 188.735 529.345Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M191.405 533.415C191.334 532.564 191.121 532.004 191.005 531.807C190.758 531.386 190.41 531.038 189.995 530.797C189.58 530.556 189.112 530.429 188.636 530.429C188.16 530.429 187.692 530.556 187.277 530.797C186.946 530.99 186.657 531.25 186.429 531.562L186.283 531.779" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M190 533.643C187.436 533.643 185.357 531.564 185.357 529C185.357 526.436 187.436 524.357 190 524.357C192.564 524.357 194.643 526.436 194.643 529C194.643 531.564 192.564 533.643 190 533.643Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  // Two bubbles — a conversation ABOUT something (founder 2026-07-28):
  // distinct from 'message', which opens the entity's own chat.
  // Travel: an airliner in the set's hairline idiom (founder 2026-07-28).
  'plane': {
    viewBox: '1 2 22 20',
    strokeWidth: 1.4,
    content: <path d="M22 14.6l-8.6-2.4V5.4c0-1.2-.6-2.2-1.4-2.2s-1.4 1-1.4 2.2v6.8L2 14.6v1.9l8.6-1.8v3.8L8.2 20v1.2l3.8-.9 3.8.9V20l-2.4-1.5v-3.8l8.6 1.8z" stroke="currentColor" strokeLinejoin="round" fill="none"/>,
  },
  'chat-about': {
    viewBox: '-1 0.8 24 24',
    strokeWidth: 1.4,
    content: <><path d="M8.5 5.5h9a3 3 0 013 3v4a3 3 0 01-3 3h-1.2l-2.8 3v-3H8.5a3 3 0 01-3-3v-4a3 3 0 013-3z" stroke="currentColor" strokeLinejoin="round"/><path d="M5.5 9.5H4a2.5 2.5 0 00-2.5 2.5v3A2.5 2.5 0 004 17.5h.8v2.6l2.4-2.6h3.3" stroke="currentColor" strokeLinejoin="round"/><circle cx="10.5" cy="10.5" r="1" fill="currentColor"/><circle cx="13.5" cy="10.5" r="1" fill="currentColor"/><circle cx="16.5" cy="10.5" r="1" fill="currentColor"/></>,
  },
  'brain': {
    viewBox: '0 -0.98 24 24',
    strokeWidth: 1.4,
    content: <><path d="M9.5 3.5a3 3 0 00-3 3v.6a3 3 0 00-2.5 2.95V12a3 3 0 002.5 2.95v.6a3 3 0 003 3h2.5V3.5H9.5z" stroke="currentColor" strokeLinejoin="round"/><path d="M14.5 3.5a3 3 0 013 3v.6a3 3 0 012.5 2.95V12a3 3 0 01-2.5 2.95v.6a3 3 0 01-3 3H12V3.5h2.5z" stroke="currentColor" strokeLinejoin="round"/><path d="M9.5 8h-1M9.5 11.5h-1M14.5 8h1M14.5 11.5h1" stroke="currentColor" strokeLinecap="round"/></>,
  },
  'settings': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.4,
    content: <><circle cx="12" cy="12" r="3" stroke="currentColor"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.01a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.01a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeLinejoin="round"/></>,
  },
  'chevron-left': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M15 6l-6 6 6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'chevron-right': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M9 6l6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'dollar': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    content: <><path d="M12 3v18M16.5 7.5C16.5 5.84 14.49 4.5 12 4.5S7.5 5.84 7.5 7.5s2.01 3 4.5 3 4.5 1.34 4.5 3-2.01 3-4.5 3-4.5-1.34-4.5-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'leaf': {
    viewBox: '0.43 1.49 24 24',
    strokeWidth: 1.4,
    content: <><path d="M20 4c-3 0-12 1-15 4s-3 8 1 12 9 4 12 1 4-12 4-15-1-2-2-2zM4 20l8-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'lend': {
    viewBox: '0 0 30 29',
    strokeWidth: 1.2,
    content: <><path d="M1.17407 6.38867L5.87639 8.83499L10.0737 8.13248C11.4906 7.89535 12.9427 8.28743 14.0273 9.20004" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M24.1758 19.2267L17.5274 23.791C16.066 24.7944 14.113 24.8124 12.6319 23.8363L1.17407 16.2861" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M28.7188 16.2379L24.0146 19.3453L16.7156 13.6482L14.0308 15.5371C12.9391 16.3052 11.4141 16.0982 10.5833 15.0693C9.7545 14.0428 9.9144 12.5663 10.9452 11.7279L13.7407 9.45419C15.0806 8.36443 16.8224 7.85016 18.5634 8.03025L22.9204 8.48086L28.7188 5.45117" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M16.7166 13.6638C18.4729 15.1764 20.9636 14.4047 21.8897 13.1699" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'phone': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    content: <><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'video': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.5,
    content: <><path d="M23 7l-7 5 7 5V7zM3 5h11a2 2 0 012 2v10a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'trade': {
    viewBox: '0 0 17 17',
    strokeWidth: 0.75,
    content: <><path d="M1.66064 11.9111C1.66064 13.2524 2.81191 14.3397 4.23207 14.3397H6.64279" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M4.875 16.1604L6.80357 14.339L4.875 12.5176" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M10.8215 2.19629H13.2322C14.6524 2.19629 15.8037 3.2836 15.8037 4.62486" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M12.5892 0.375L10.6606 2.19643L12.5892 4.01786" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M13.2322 10.6968C12.3446 10.6968 11.6251 10.0173 11.6251 9.17899C11.6251 8.3407 12.3446 7.66113 13.2322 7.66113C14.1198 7.66113 14.8394 8.3407 14.8394 9.17899C14.8394 10.0173 14.1198 10.6968 13.2322 10.6968Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M10.0178 15.5533C10.0178 13.8767 11.4569 12.5176 13.2321 12.5176C15.0073 12.5176 16.4464 13.8767 16.4464 15.5533" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M0.375 3.41085C0.375 3.07554 0.662817 2.80371 1.01786 2.80371H7.44643C7.80147 2.80371 8.08929 3.07554 8.08929 3.41085V7.05371C8.08929 7.38902 7.80147 7.66085 7.44643 7.66085H1.01786C0.662817 7.66085 0.375 7.38902 0.375 7.05371V3.41085Z" stroke="currentColor" strokeLinejoin="round"/><path d="M2.625 2.80357V1.89286C2.625 1.05456 3.34454 0.375 4.23214 0.375C5.11975 0.375 5.83929 1.05456 5.83929 1.89286V2.80357" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'rent': {
    viewBox: '-0.03 -1.63 31 31',
    strokeWidth: 0.9,
    content: <><line x1="0.375" y1="-0.375" x2="8.56429" y2="-0.375" transform="matrix(-0.66062 0.750721 -0.671695 -0.740828 15.4436 7.48145)" stroke="currentColor" strokeLinecap="round"/><line x1="0.375" y1="-0.375" x2="7.91194" y2="-0.375" transform="matrix(0.67538 0.73747 -0.656886 0.75399 15.0474 7.9248)" stroke="currentColor" strokeLinecap="round"/><rect x="7.75" y="12.5498" width="15.4473" height="9.45" rx="0.625" stroke="currentColor"/><path d="M15.4368 5.75C16.0311 5.75 16.511 6.2304 16.511 6.82031C16.5108 7.41008 16.031 7.88965 15.4368 7.88965C14.8426 7.88964 14.3627 7.41008 14.3625 6.82031C14.3625 6.2304 14.8425 5.75001 15.4368 5.75Z" stroke="currentColor"/><path d="M9.02524 19.4006L9.03951 14.5986L11.5595 14.6061C11.8582 14.607 12.1053 14.6661 12.301 14.7833C12.4966 14.9006 12.6432 15.0573 12.7406 15.2536C12.838 15.4499 12.8863 15.6717 12.8856 15.919C12.8846 16.269 12.802 16.5628 12.638 16.8003C12.474 17.0332 12.2682 17.1912 12.0206 17.2745L13.0432 19.4125L12.6232 19.4113L11.6354 17.3433L9.40938 17.3367L9.40324 19.4017L9.02524 19.4006ZM9.41037 17.0007L11.4964 17.0069C11.809 17.0079 12.0543 16.9106 12.2322 16.7151C12.4148 16.5197 12.5066 16.2516 12.5076 15.9109C12.5082 15.7103 12.4714 15.5398 12.3971 15.3996C12.3229 15.2547 12.2112 15.1424 12.0621 15.0626C11.913 14.9828 11.7265 14.9426 11.5025 14.9419L9.41651 14.9357L9.41037 17.0007ZM14.8004 19.5018C14.4691 19.5008 14.1846 19.4323 13.947 19.2962C13.7141 19.1555 13.5351 18.9427 13.4099 18.6576C13.2894 18.3726 13.2298 18.0107 13.2311 17.5721C13.2325 17.1288 13.2942 16.7673 13.4164 16.4876C13.5432 16.2033 13.7282 15.9939 13.9712 15.8593C14.2143 15.72 14.5132 15.6509 14.8679 15.6519C15.2039 15.6529 15.4836 15.7214 15.7072 15.8574C15.9355 15.9934 16.1076 16.1876 16.2235 16.44C16.3394 16.6877 16.3969 16.9818 16.3959 17.3225L16.3949 17.6725L13.5879 17.6641C13.5868 18.0375 13.6349 18.3386 13.7322 18.5676C13.8342 18.7919 13.976 18.9533 14.1577 19.0518C14.3441 19.1504 14.5656 19.2001 14.8223 19.2008C15.037 19.2015 15.2191 19.174 15.3686 19.1184C15.518 19.0629 15.6396 18.9886 15.7332 18.8955C15.8315 18.8025 15.9041 18.6954 15.9512 18.5742C16.0029 18.453 16.0312 18.3294 16.0363 18.2034L16.3583 18.2044C16.3531 18.363 16.32 18.5193 16.2589 18.6731C16.2024 18.8269 16.1133 18.9667 15.9916 19.0923C15.8699 19.2179 15.711 19.3178 15.5147 19.3919C15.3185 19.466 15.0804 19.5026 14.8004 19.5018ZM13.5888 17.3631L16.0457 17.3704C16.0465 17.1044 16.0169 16.8827 15.9567 16.7052C15.8966 16.523 15.8107 16.3781 15.699 16.2704C15.592 16.1581 15.4639 16.0784 15.3147 16.0313C15.1702 15.9795 15.0093 15.9534 14.832 15.9528C14.5753 15.9521 14.3558 16.0028 14.1735 16.1049C13.9959 16.2023 13.8578 16.3559 13.7591 16.5656C13.6605 16.7707 13.6037 17.0365 13.5888 17.3631ZM16.6822 19.4233L16.6932 15.7414L16.9382 15.7421L16.9783 16.3652L17.0273 16.3654C17.1399 16.1744 17.264 16.0277 17.3996 15.9255C17.5399 15.8232 17.6871 15.7537 17.8413 15.7168C17.9954 15.6799 18.1564 15.6617 18.3244 15.6622C18.5578 15.6629 18.7606 15.7008 18.9331 15.776C19.1055 15.8465 19.2382 15.9659 19.331 16.1342C19.4285 16.3025 19.4768 16.5313 19.476 16.8206L19.4682 19.4316L19.1322 19.4306L19.14 16.8196C19.1405 16.6423 19.1176 16.4976 19.0713 16.3854C19.0249 16.2733 18.9599 16.1868 18.876 16.1259C18.7969 16.065 18.7014 16.0227 18.5894 15.999C18.4822 15.9753 18.3655 15.9633 18.2395 15.963C18.0389 15.9624 17.8451 16.0108 17.6581 16.1082C17.4711 16.2057 17.319 16.3499 17.2018 16.5409C17.0846 16.7272 17.0256 16.958 17.0247 17.2334L17.0182 19.4243L16.6822 19.4233ZM20.6836 19.5122C20.5389 19.5118 20.4247 19.4881 20.3408 19.4412C20.2569 19.3943 20.1965 19.3265 20.1594 19.2377C20.127 19.1443 20.111 19.0369 20.1114 18.9155L20.1199 16.0526L19.6019 16.051L19.6028 15.75L20.1208 15.7516L20.1938 14.7298L20.4598 14.7306L20.4568 15.7526L21.2058 15.7548L21.2049 16.0558L20.4559 16.0535L20.4477 18.8185C20.4472 18.9585 20.4609 19.0612 20.4887 19.1267C20.5212 19.1874 20.6028 19.218 20.7335 19.2184L21.1955 19.2198L21.1949 19.4158C21.1481 19.439 21.0944 19.4575 21.0337 19.4713C20.973 19.4851 20.9123 19.4943 20.8516 19.4987C20.7909 19.5079 20.7349 19.5124 20.6836 19.5122Z" fill="currentColor" stroke="none"/></>,
  },
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number | string;
  /** Override the icon's built-in strokeWidth (useful for emphasis or matching weights). */
  strokeWidth?: number;
  fill?: 'none' | 'currentColor';
}

export function Icon({
  name,
  size = 20,
  strokeWidth,
  fill = 'none',
  ...rest
}: IconProps) {
  const icon = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox={icon.viewBox}
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth ?? icon.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
      {...rest}
    >
      {icon.content}
    </svg>
  );
}
/** The same glyphs, as a raw SVG string — for consumers that take DOM rather
 *  than React (mapbox markers). Reads the SAME ICONS table, so a mark can
 *  never drift between the app and the map (founder 2026-08-15).
 *  Only the geometry is emitted; colour comes from the host element. */
export function iconSvgMarkup(name: IconName, size = 16): string {
  const e = ICONS[name];
  if (!e) return '';
  const body = renderToStaticMarkup(e.content as ReactElement);
  return `<svg viewBox="${e.viewBox}" width="${size}" height="${size}" fill="none" `
    + `stroke="currentColor" stroke-width="${e.strokeWidth}" stroke-linecap="round" `
    + `stroke-linejoin="round" vector-effect="non-scaling-stroke" aria-hidden="true">${body}</svg>`;
}
