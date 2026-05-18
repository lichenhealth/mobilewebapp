/**
 * LICHEN icon set — real Figma icons extracted from the wireframe,
 * plus hand-drawn chat actions for icons not in the design system.
 *
 * Each icon carries its own viewBox + strokeWidth so visual weight stays
 * consistent across icons that came from different source sizes.
 */
import { SVGProps } from 'react';

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'bell'
  | 'book'
  | 'bookmark'
  | 'briefcase'
  | 'calendar'
  | 'chat'
  | 'check'
  | 'check-double'
  | 'close'
  | 'concierge'
  | 'fork-spoon'
  | 'globe'
  | 'graduation-cap'
  | 'health'
  | 'heart-line'
  | 'home'
  | 'image'
  | 'info'
  | 'install'
  | 'location'
  | 'maps'
  | 'menu'
  | 'message'
  | 'mic'
  | 'more-horizontal'
  | 'palette'
  | 'paperclip'
  | 'pin'
  | 'plus'
  | 'profile'
  | 'reply'
  | 'saved'
  | 'search'
  | 'send'
  | 'shield-user'
  | 'smile'
  | 'sparkle'
  | 'store'
  | 'thumbs-up'
  | 'user-multiple';

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
  'bookmark': {
    viewBox: '264 838 29 26',
    strokeWidth: 1.81,
    content: <><path d="M286.786 863.071L278.5 855.643L270.214 863.071V840.786C270.214 840.293 270.433 839.821 270.821 839.472C271.21 839.124 271.736 838.928 272.286 838.928H284.714C285.264 838.928 285.791 839.124 286.179 839.472C286.567 839.821 286.786 840.293 286.786 840.786V863.071Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'briefcase': {
    viewBox: '180 217 17 17',
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
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="m3 12 4 4 7-7M11 16l3 3 8-12" /></>,
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
    viewBox: '315 219 16 16',
    strokeWidth: 1.0,
    content: <><path d="M327.8 225.923C329.567 225.923 331 224.373 331 222.462C331 220.55 329.567 219 327.8 219C326.033 219 324.6 220.55 324.6 222.462C324.6 224.373 326.033 225.923 327.8 225.923Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M327.8 225.923V234" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M318.333 219V234" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M321.666 219V221.885C321.666 222.263 321.58 222.639 321.413 222.989C321.245 223.338 321 223.656 320.69 223.924C320.381 224.192 320.013 224.405 319.609 224.55C319.204 224.695 318.771 224.769 318.333 224.769C317.449 224.769 316.601 224.465 315.976 223.924C315.351 223.383 315 222.65 315 221.885V219" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'globe': {
    viewBox: '315 836 26 26',
    strokeWidth: 1.62,
    content: <><path d="M328 862C335.18 862 341 856.18 341 849C341 841.82 335.18 836 328 836C320.82 836 315 841.82 315 849C315 856.18 320.82 862 328 862Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M316 854H319.5C320.428 854 321.319 853.631 321.975 852.975C322.631 852.318 323 851.428 323 850.5V847.5C323 846.572 323.369 845.681 324.025 845.025C324.682 844.369 325.572 844 326.5 844C327.428 844 328.319 843.631 328.975 842.975C329.631 842.318 330 841.428 330 840.5V836.14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M341 848.8C339.999 848.28 338.888 848.006 337.76 848H333.5C332.572 848 331.681 848.369 331.025 849.025C330.369 849.681 330 850.572 330 851.5C330 852.428 330.369 853.319 331.025 853.975C331.681 854.631 332.572 855 333.5 855C334.163 855 334.799 855.263 335.268 855.732C335.737 856.201 336 856.837 336 857.5V859.24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'graduation-cap': {
    viewBox: '213 215 20 23',
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
    content: <><circle cx="18" cy="18" r="17.5" stroke="currentColor"/><path d="M11.52 13.6799H24.48" stroke="currentColor" strokeLinecap="round"/><path d="M11.52 18.72H24.48" stroke="currentColor" strokeLinecap="round"/><path d="M11.52 23.76H24.48" stroke="currentColor" strokeLinecap="round"/></>,
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
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M20 12.5 12.5 20a5 5 0 0 1-7-7L13 5.5a3.5 3.5 0 1 1 5 5l-7.5 7.5a2 2 0 0 1-3-3l7-7" /></>,
  },
  'pin': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 17v5M7 11.5 12 7l5 4.5-1.5 3-7 0L7 11.5ZM9 4.5h6L13.5 7h-3L9 4.5Z" /></>,
  },
  'plus': {
    viewBox: '61 211 30 30',
    strokeWidth: 1.88,
    content: <><path d="M76 241C84.2844 241 91 234.284 91 226C91 217.716 84.2844 211 76 211C67.7157 211 61 217.716 61 226C61 234.284 67.7157 241 76 241Z" fill="white" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M76 219.077V232.923Z" fill="white"/><path d="M76 219.077V232.923" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M69.0762 226H82.9223Z" fill="white"/><path d="M69.0762 226H82.9223" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'profile': {
    viewBox: '0 0 26 26',
    strokeWidth: 1.62,
    content: <><path d="M12.9999 25.0713C19.6669 25.0713 25.0713 19.6669 25.0713 12.9999C25.0713 6.33303 19.6669 0.928467 12.9999 0.928467C6.33303 0.928467 0.928467 6.33303 0.928467 12.9999C0.928467 19.6669 6.33303 25.0713 12.9999 25.0713Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M12.9998 14.857C15.564 14.857 17.6426 12.7783 17.6426 10.2141C17.6426 7.64997 15.564 5.57129 12.9998 5.57129C10.4356 5.57129 8.35693 7.64997 8.35693 10.2141C8.35693 12.7783 10.4356 14.857 12.9998 14.857Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.06982 22.0999C5.89856 20.7396 7.0633 19.6152 8.45207 18.8352C9.84084 18.055 11.4069 17.6453 12.9998 17.6453C14.5927 17.6453 16.1588 18.055 17.5476 18.8352C18.9364 19.6152 20.101 20.7396 20.9299 22.0999" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'reply': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M9 17 4 12l5-5M4 12h11a5 5 0 0 1 5 5v3" /></>,
  },
  'saved': {
    viewBox: '264 838 29 26',
    strokeWidth: 1.81,
    content: <><path d="M286.786 863.071L278.5 855.643L270.214 863.071V840.786C270.214 840.293 270.433 839.821 270.821 839.472C271.21 839.124 271.736 838.928 272.286 838.928H284.714C285.264 838.928 285.791 839.124 286.179 839.472C286.567 839.821 286.786 840.293 286.786 840.786V863.071Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'search': {
    viewBox: '28 211 30 30',
    strokeWidth: 1.88,
    content: <><path d="M43 241C51.2844 241 58 234.284 58 226C58 217.716 51.2844 211 43 211C34.7157 211 28 217.716 28 226C28 234.284 34.7157 241 43 241Z" fill="white" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M41.8454 230.615C45.0317 230.615 47.6146 228.032 47.6146 224.846C47.6146 221.66 45.0317 219.077 41.8454 219.077C38.6591 219.077 36.0762 221.66 36.0762 224.846C36.0762 228.032 38.6591 230.615 41.8454 230.615Z" fill="white" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/><path d="M49.9229 232.923L45.9307 228.931Z" fill="white"/><path d="M49.9229 232.923L45.9307 228.931" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"/></>,
  },
  'send': {
    viewBox: '224 457 14 14',
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
  'sparkle': {
    viewBox: '0 0 24 24',
    strokeWidth: 1.6,
    content: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l3 3M15.5 15.5l3 3M5.5 18.5l3-3M15.5 8.5l3-3" /></>,
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
      aria-hidden="true"
      {...rest}
    >
      {icon.content}
    </svg>
  );
}