import type {
  Attendance,
  AttendancePart,
  AttendanceStatus,
  BellPeriod,
  Kind,
  ScheduleBreak,
  Session,
} from "./contracts";

export type {
  Attendance,
  AttendancePart,
  AttendanceStatus,
  Kind,
  Session,
} from "./contracts";

export interface RawClassRow {
  hour_value: number;
  day_value?: number;
  subject_code?: string;
  subject_name?: string;
  short_name?: string;
  subject_type?: string; // "Theory" | "Lab" | ...
  section?: string;
  part?: number;
  employee_name?: string; // real staff name
  leave_type?: string | null; // "p" present, "a" absent, "od" on-duty, null unmarked
  marked_by?: string | null;
  marked_subject?: string | null;
  room_id?: string | null;
}

export const BELL: Record<number, BellPeriod> = {
  1: { start: "09:00", end: "09:55" },
  2: { start: "09:55", end: "10:50" },
  3: { start: "11:05", end: "12:00" },
  4: { start: "12:00", end: "12:55" },
  5: { start: "14:00", end: "14:55" },
  6: { start: "14:55", end: "15:50" },
  7: { start: "15:50", end: "16:45" },
};

export const BREAKS: ScheduleBreak[] = [
  { label: "Break", start: "10:50", end: "11:05" },
  { label: "Lunch", start: "12:55", end: "14:00" },
];

const clean = (s?: string | null): string => (s ?? "").replace(/\s+/g, " ").trim();

function classify(row: RawClassRow): Kind {
  const t = (row.subject_type ?? "").toLowerCase();
  if (t.includes("lab")) return "lab";
  const code = (row.subject_code ?? "").toUpperCase();
  if (/ASSOCIATION|PLACEMENT|CGC|MENTOR|LIBRARY|COUNSELL/i.test(code + " " + (row.subject_name ?? "")))
    return "activity";
  return "theory";
}

function attendanceStatusOf(row: RawClassRow): Exclude<AttendanceStatus, "mixed"> {
  const l = clean(row.leave_type).toLowerCase();
  if (l === "p") return "present";
  if (l === "a") return "absent";
  if (l === "od") return "on-duty";
  return "unmarked";
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function attendanceOf(cells: { hour: number; row: RawClassRow }[]): Attendance {
  const parts: AttendancePart[] = cells.map(({ hour, row }) => {
    const part: AttendancePart = { hour, status: attendanceStatusOf(row) };
    const markedBy = clean(row.marked_by);
    const markedSubject = clean(row.marked_subject);
    if (markedBy) part.markedBy = markedBy;
    if (markedSubject) part.markedSubject = markedSubject;
    return part;
  });

  const statuses = [...new Set(parts.map((p) => p.status))];
  const markedBy = [...new Set(parts.map((p) => p.markedBy).filter(isNonEmptyString))].sort();
  const markedSubject = [
    ...new Set(parts.map((p) => p.markedSubject).filter(isNonEmptyString)),
  ].sort();

  return {
    status: statuses.length === 1 ? statuses[0]! : "mixed",
    markedBy,
    markedSubject,
    parts,
  };
}

interface Cell {
  hour: number;
  row: RawClassRow;
  staff: Set<string>;
  code: string;
}

/**
 * Two cells may merge into one session only when:
 *  - both are labs (labs span multiple bell hours; theory/activity do not merge), and
 *  - they share the same subject code, and
 *  - they are actually time-adjacent (previous bell end === next bell start).
 *
 * The time-adjacency check prevents merging across breaks/lunch — e.g. hour 4
 * (ends 12:55) is NOT adjacent to hour 5 (starts 14:00).
 */
function canMerge(previous: Cell, current: Cell): boolean {
  if (classify(previous.row) !== "lab" || classify(current.row) !== "lab") return false;
  if (previous.code !== current.code) return false;
  const prevBell = BELL[previous.hour];
  const curBell = BELL[current.hour];
  if (!prevBell || !curBell) return false;
  return prevBell.end === curBell.start;
}

export function toSessions(rows: RawClassRow[]): Session[] {
  // De-duplicate rows that describe the same subject in the same hour, while
  // accumulating the (possibly multiple) staff names.
  const byKey = new Map<string, { hour: number; row: RawClassRow; staff: Set<string> }>();
  for (const r of rows) {
    if (!BELL[r.hour_value]) continue;
    const code = clean(r.subject_code) || clean(r.subject_name) || `h${r.hour_value}`;
    const key = `${r.hour_value}::${code}`;
    const staff = clean(r.employee_name);
    const cur = byKey.get(key);
    if (cur) {
      if (staff) cur.staff.add(staff);
    } else {
      byKey.set(key, { hour: r.hour_value, row: r, staff: new Set(staff ? [staff] : []) });
    }
  }

  const cells: Cell[] = [...byKey.values()].map((v) => ({
    ...v,
    code: clean(v.row.subject_code) || clean(v.row.subject_name) || `h${v.hour}`,
  }));

  const byCode = new Map<string, Cell[]>();
  for (const c of cells) {
    const a = byCode.get(c.code) ?? [];
    a.push(c);
    byCode.set(c.code, a);
  }

  const sessions: Session[] = [];
  for (const group of byCode.values()) {
    group.sort((a, b) => a.hour - b.hour);
    let run: Cell[] = [];

    const flush = (): void => {
      if (!run.length) return;
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const staff = new Set<string>();
      run.forEach((c) => c.staff.forEach((s) => staff.add(s)));
      const firstBell = BELL[first.hour]!;
      const lastBell = BELL[last.hour]!;
      sessions.push({
        hourStart: first.hour,
        hourEnd: last.hour,
        start: firstBell.start,
        end: lastBell.end,
        title: clean(first.row.subject_name) || first.code,
        code: clean(first.row.subject_code),
        short: clean(first.row.short_name),
        kind: classify(first.row),
        staff: [...staff].sort(),
        section: clean(first.row.section) || undefined,
        attendance: attendanceOf(run),
      });
      run = [];
    };

    for (const c of group) {
      const prev = run[run.length - 1];
      if (!prev || canMerge(prev, c)) {
        run.push(c);
      } else {
        flush();
        run.push(c);
      }
    }
    flush();
  }

  sessions.sort((a, b) => a.hourStart - b.hourStart || a.title.localeCompare(b.title));
  return sessions;
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Parse "HH:MM" into minutes-since-midnight. Returns NaN for invalid input. */
export const toMin = (hhmm: string): number => {
  const match = TIME_RE.exec(hhmm);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
};

export const isValidTime = (hhmm: string): boolean => TIME_RE.test(hhmm);
