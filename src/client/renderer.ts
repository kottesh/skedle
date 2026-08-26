import type { AttendanceStatus, DayPayload, HolidayPayload, ScheduleBreak } from "../contracts";
import { formatTime, toMin, durationLabel } from "./date";
import { smartTitleCase } from "./text";
import { layoutColumns, type LaidSession } from "./layout";

const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "present",
  absent: "absent",
  "on-duty": "on duty",
  unmarked: "not marked",
  mixed: "mixed",
};

export interface RailGeometry {
  dayStart: number;
  dayEnd: number;
  pxMin: number;
  y: (min: number) => number;
  height: number;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function railGeometry(bell: DayPayload["bell"]): RailGeometry {
  const periods = Object.values(bell);
  const starts = periods.map((b) => toMin(b.start)).filter(Number.isFinite);
  const ends = periods.map((b) => toMin(b.end)).filter(Number.isFinite);
  const dayStart = Math.min(...starts) - 5;
  const dayEnd = Math.max(...ends) + 5;
  const pxMin =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px-min")) || 2.4;
  return {
    dayStart,
    dayEnd,
    pxMin,
    y: (min: number) => (min - dayStart) * pxMin,
    height: (dayEnd - dayStart) * pxMin,
  };
}

function holidayTypeLabel(type: string | undefined): string {
  const t = String(type ?? "")
    .replace(/[_-]/g, " ")
    .trim()
    .toLowerCase();
  if (!t) return "";
  if (t === "fullday" || t === "full day") return "Full day";
  return smartTitleCase(t);
}

export function renderHoliday(rail: HTMLElement, holiday: HolidayPayload): void {
  rail.replaceChildren();
  rail.dataset.view = "holiday";
  rail.style.height = "auto";

  const card = el("article", "holiday-card");
  card.setAttribute("aria-label", "Holiday");

  card.append(el("div", "holiday-card__time", "All day"));

  const body = el("div", "holiday-card__body");
  body.append(el("div", "holiday-card__kicker", "Campus holiday"));
  body.append(el("h2", "holiday-card__title", holiday.name));
  body.append(
    el(
      "p",
      "holiday-card__copy",
      "No timetable sessions are scheduled for this day.",
    ),
  );
  const type = holidayTypeLabel(holiday.type);
  if (type) body.append(el("div", "holiday-card__meta", type));

  card.append(body);
  rail.append(card);
}

export function renderEmpty(rail: HTMLElement): void {
  rail.replaceChildren();
  rail.dataset.view = "empty";
  rail.style.height = "auto";

  const wrap = el("div", "empty");
  wrap.append(el("div", "empty__mark", "No classes."));
  wrap.append(el("div", undefined, "Nothing scheduled for this day."));
  rail.append(wrap);
}

export function renderLoading(rail: HTMLElement): void {
  rail.replaceChildren();
  rail.dataset.view = "loading";
  rail.style.height = "";
  rail.setAttribute("aria-busy", "true");
  rail.append(el("div", "rail__loading", "Loading…"));
}

function attendanceStatusOf(session: LaidSession): AttendanceStatus {
  return session.attendance?.status ?? "unmarked";
}

function buildSessionCard(session: LaidSession): HTMLElement {
  const status = attendanceStatusOf(session);
  const card = el("article", `ev ev--${session.kind} ev--att-${status}`);

  const top = el("div", "ev__top");
  const time = el("span", "ev__time", `${formatTime(session.start)} – ${formatTime(session.end)}`);
  const kind = el("span", "ev__kind", session.kind);
  const att = el("span", `ev__att ev__att--${status}`, ATTENDANCE_LABEL[status]);
  top.append(time, kind, att);
  card.append(top);

  card.append(el("h3", "ev__title", smartTitleCase(session.title)));

  const meta = el("div", "ev__meta");
  if (session.code) meta.append(el("span", "ev__code", session.code));
  if (session.staff.length) meta.append(el("span", "ev__staff", session.staff.join(", ")));
  card.append(meta);

  const hrs =
    session.hourEnd !== session.hourStart
      ? `Hours ${session.hourStart}–${session.hourEnd}`
      : `Hour ${session.hourStart}`;
  const dur = durationLabel(toMin(session.start), toMin(session.end));
  card.append(el("div", "ev__dur", dur ? `${hrs} · ${dur}` : hrs));

  card.dataset.start = session.start;
  card.dataset.end = session.end;
  return card;
}

interface ClusterMember {
  session: LaidSession;
  card: HTMLElement;
  stackTop?: number;
  stackHeight?: number;
}

interface Cluster {
  start: number;
  end: number;
  members: ClusterMember[];
  stacked?: boolean;
  resolvedHeight?: number;
}

const CARD_GAP = 6; // vertical gap subtracted from a slot so stacked cards breathe

/**
 * Group cards whose time ranges overlap. Members of a cluster are laid out in
 * parallel columns, so the cluster must be tall enough for its tallest column.
 */
function buildClusters(members: ClusterMember[]): Cluster[] {
  const clusters: Cluster[] = [];
  const sorted = [...members].sort((a, b) => a.session.s0 - b.session.s0);
  for (const m of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && m.session.s0 < last.end) {
      last.end = Math.max(last.end, m.session.s1);
      last.members.push(m);
    } else {
      clusters.push({ start: m.session.s0, end: m.session.s1, members: [m] });
    }
  }
  return clusters;
}

// Below this per-column width (px) side-by-side columns become unreadable, so
// overlapping sessions stack vertically instead.
const MIN_COLUMN_WIDTH = 150;
const STACK_GAP = 8; // vertical gap between stacked cards within a cluster
const LEFT_INSET = 12; // matches `.ev { left: 12px }`

export function renderRail(rail: HTMLElement, payload: DayPayload): RailGeometry {
  rail.replaceChildren();
  rail.dataset.view = "rail";
  rail.style.height = "";
  rail.removeAttribute("aria-busy");

  const laid = layoutColumns(payload.sessions);
  const base = railGeometry(payload.bell);

  // ---- pass 1: build cards (unpositioned) so we can measure natural height ----
  const list = el("ol", "ev-list");
  list.setAttribute("aria-label", "Sessions");
  const members = laid.map((s) => {
    const card = buildSessionCard(s);
    const li = el("li");
    li.style.display = "contents";
    li.append(card);
    list.append(li);
    return { session: s, card };
  });
  rail.append(list);

  const clusters = buildClusters(members);

  // Decide, per cluster, whether columns fit. Columns require the widest
  // cluster to still give each column at least MIN_COLUMN_WIDTH.
  const railWidth = rail.clientWidth - LEFT_INSET;
  for (const cluster of clusters) {
    const maxCols = Math.max(...cluster.members.map((m) => m.session.cols));
    const columnWidth = maxCols > 0 ? railWidth / maxCols : railWidth;
    cluster.stacked = maxCols > 1 && columnWidth < MIN_COLUMN_WIDTH;
  }

  // Apply column widths for cluster members that will be laid out side by side.
  for (const cluster of clusters) {
    if (cluster.stacked) continue;
    for (const { session: s, card } of cluster.members) {
      if (s.cols <= 1) continue;
      card.classList.add("ev--overlap");
      const gapPct = 2;
      const w = (100 - gapPct * (s.cols - 1)) / s.cols;
      card.style.left = `calc(${LEFT_INSET}px + (100% - ${LEFT_INSET}px) * ${(s.col * (w + gapPct)) / 100})`;
      card.style.width = `calc((100% - ${LEFT_INSET}px) * ${w / 100})`;
      card.style.right = "auto";
    }
  }

  // ---- measure & compute per-cluster geometry ----
  // For column clusters: height = tallest column's natural content height.
  // For stacked clusters: height = sum of all members' natural heights + gaps.
  const offsets: { at: number; extra: number }[] = [];
  for (const cluster of clusters) {
    const proportional = (cluster.end - cluster.start) * base.pxMin - CARD_GAP;

    if (cluster.stacked) {
      let total = 0;
      cluster.members.forEach((m, idx) => {
        const h = Math.max(m.card.scrollHeight, 34);
        m.stackTop = total;
        m.stackHeight = h;
        total += h + (idx < cluster.members.length - 1 ? STACK_GAP : 0);
      });
      cluster.resolvedHeight = Math.max(total, proportional, 34);
    } else {
      let needed = 0;
      for (const m of cluster.members) needed = Math.max(needed, m.card.scrollHeight);
      cluster.resolvedHeight = Math.max(needed, proportional, 34);
    }

    const extra = Math.max(0, cluster.resolvedHeight - Math.max(proportional, 34));
    if (extra > 0) offsets.push({ at: cluster.end, extra });
  }
  offsets.sort((a, b) => a.at - b.at);

  // Offset-aware vertical map: add all expansion accrued from clusters that
  // ended at or before `min`, keeping the now-line and ticks aligned.
  const offsetBefore = (min: number): number =>
    offsets.reduce((sum, o) => (o.at <= min ? sum + o.extra : sum), 0);
  const y = (min: number): number => (min - base.dayStart) * base.pxMin + offsetBefore(min);

  const g: RailGeometry = {
    dayStart: base.dayStart,
    dayEnd: base.dayEnd,
    pxMin: base.pxMin,
    y,
    height: base.height + offsets.reduce((sum, o) => sum + o.extra, 0),
  };
  rail.style.height = `${g.height}px`;

  // ---- pass 2: position cards with the offset-aware map ----
  for (const cluster of clusters) {
    const clusterTop = y(cluster.start);
    const clusterHeight = cluster.resolvedHeight ?? 34;
    for (const member of cluster.members) {
      const { session: s, card } = member;
      if (cluster.stacked) {
        const stackTop = member.stackTop ?? 0;
        const stackHeight = member.stackHeight ?? 34;
        card.classList.add("ev--stacked");
        card.style.left = `${LEFT_INSET}px`;
        card.style.right = "0";
        card.style.width = "";
        card.style.top = `${clusterTop + stackTop}px`;
        card.style.height = `${stackHeight}px`;
        if (stackHeight < 90) card.classList.add("ev--short");
      } else {
        if (clusterHeight < 90 || s.cols > 1) card.classList.add("ev--short");
        card.style.top = `${clusterTop}px`;
        card.style.height = `${Math.max(clusterHeight - CARD_GAP, 34)}px`;
      }
    }
  }

  // Ticks
  const tickTimes = [
    ...new Set(Object.values(payload.bell).flatMap((b) => [b.start, b.end])),
  ].sort();
  for (const t of tickTimes) {
    const tick = el("div", "tick");
    tick.style.top = `${y(toMin(t))}px`;
    tick.append(el("span", "tick__label", formatTime(t)));
    tick.setAttribute("aria-hidden", "true");
    rail.append(tick);
  }

  // Breaks
  for (const br of payload.breaks) {
    renderBreak(rail, g, br);
  }

  return g;
}


function renderBreak(rail: HTMLElement, g: RailGeometry, br: ScheduleBreak): void {
  const start = toMin(br.start);
  const end = toMin(br.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const gap = el("div", "gap");
  gap.style.top = `${g.y(start)}px`;
  gap.style.height = `${g.y(end) - g.y(start)}px`;
  gap.setAttribute("aria-hidden", "true");
  gap.append(el("span", "gap__label", br.label));
  rail.append(gap);
}
