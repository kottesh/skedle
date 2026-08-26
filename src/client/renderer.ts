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

export function renderRail(rail: HTMLElement, payload: DayPayload): RailGeometry {
  rail.replaceChildren();
  rail.dataset.view = "rail";
  rail.style.height = "";
  rail.removeAttribute("aria-busy");

  const laid = layoutColumns(payload.sessions);
  const g = railGeometry(payload.bell);
  rail.style.height = `${g.height}px`;

  // Ticks
  const tickTimes = [
    ...new Set(Object.values(payload.bell).flatMap((b) => [b.start, b.end])),
  ].sort();
  for (const t of tickTimes) {
    const tick = el("div", "tick");
    tick.style.top = `${g.y(toMin(t))}px`;
    tick.append(el("span", "tick__label", formatTime(t)));
    tick.setAttribute("aria-hidden", "true");
    rail.append(tick);
  }

  // Breaks
  for (const br of payload.breaks) {
    renderBreak(rail, g, br);
  }

  // Sessions
  const list = el("ol", "ev-list");
  list.setAttribute("aria-label", "Sessions");
  for (const s of laid) {
    const top = g.y(toMin(s.start));
    const rawHeight = (toMin(s.end) - toMin(s.start)) * g.pxMin;
    const narrow = s.cols > 1;

    const li = el("li");
    li.style.display = "contents";
    const card = buildSessionCard(s);
    if (rawHeight < 90 || narrow) card.classList.add("ev--short");
    card.style.top = `${top}px`;
    card.style.height = `${Math.max(rawHeight - 6, 34)}px`;

    if (s.cols > 1) {
      card.classList.add("ev--overlap");
      const gapPct = 2;
      const w = (100 - gapPct * (s.cols - 1)) / s.cols;
      card.style.left = `calc(12px + (100% - 12px) * ${(s.col * (w + gapPct)) / 100})`;
      card.style.width = `calc((100% - 12px) * ${w / 100})`;
      card.style.right = "auto";
    }

    li.append(card);
    list.append(li);
  }
  rail.append(list);

  return g;
}

function renderBreak(rail: HTMLElement, g: RailGeometry, br: ScheduleBreak): void {
  const start = toMin(br.start);
  const end = toMin(br.end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  const gap = el("div", "gap");
  gap.style.top = `${g.y(start)}px`;
  gap.style.height = `${(end - start) * g.pxMin}px`;
  gap.setAttribute("aria-hidden", "true");
  gap.append(el("span", "gap__label", br.label));
  rail.append(gap);
}
