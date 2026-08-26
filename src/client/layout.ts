import type { Session } from "../contracts";
import { toMin } from "./date";

export interface LaidSession extends Session {
  s0: number;
  s1: number;
  col: number;
  cols: number;
}

/**
 * Assign each session a column so overlapping sessions sit side by side.
 * Non-overlapping clusters are laid out independently (each cluster resets
 * to a single column when possible).
 */
export function layoutColumns(sessions: Session[]): LaidSession[] {
  const items: LaidSession[] = sessions
    .map((s) => ({ ...s, s0: toMin(s.start), s1: toMin(s.end), col: 0, cols: 1 }))
    .filter((s) => Number.isFinite(s.s0) && Number.isFinite(s.s1) && s.s1 > s.s0)
    .sort((a, b) => a.s0 - b.s0 || a.s1 - b.s1);

  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    let clusterEnd = items[i]!.s1;
    while (j < items.length && items[j]!.s0 < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[j]!.s1);
      j++;
    }
    const cluster = items.slice(i, j);

    const colEnds: number[] = [];
    for (const it of cluster) {
      let placed = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (it.s0 >= colEnds[c]!) {
          placed = c;
          break;
        }
      }
      if (placed === -1) {
        placed = colEnds.length;
        colEnds.push(0);
      }
      it.col = placed;
      colEnds[placed] = it.s1;
    }
    const cols = colEnds.length;
    cluster.forEach((it) => (it.cols = cols));
    i = j;
  }

  return items;
}
