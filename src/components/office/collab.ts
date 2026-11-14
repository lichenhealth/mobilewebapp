/** Shared shapes for comments and live co-editing across the three editors. */
export type Anchor =
  | { kind: 'text'; quote: string }
  | { kind: 'cell'; tab: string; r: number; c: number }
  | { kind: 'slide'; index: number };

export interface Peer { uid: string; name: string; color: string; anchor?: Anchor | null }
export interface Goto { anchor: Anchor; n: number }

export const PEER_COLORS = ['#2f78ad', '#3d8c4f', '#8a56b0', '#b8443a', '#c49a1f', '#c9733d'];
export const peerColor = (uid: string) => {
  let h = 0; for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
};
export const cellMark = (tab: string, r: number, c: number) => `${tab}|${r},${c}`;
export const firstName = (n: string) => n.trim().split(/\s+/)[0] || n;
