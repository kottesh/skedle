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
  leave_type?: string; // "a" absent, "od" on-duty, etc.
  room_id?: string | null;
}

export const BELL: Record<number, { start: string; end: string }> = {
  1: { start: "09:00", end: "09:55" },
  2: { start: "09:55", end: "10:50" },
  3: { start: "11:05", end: "12:00" },
  4: { start: "12:00", end: "12:55" },
  5: { start: "14:00", end: "14:55" },
  6: { start: "14:55", end: "15:50" },
  7: { start: "15:50", end: "16:45" },
};

export const BREAKS = [
  { label: "Break", start: "10:50", end: "11:05" },
  { label: "Lunch", start: "12:55", end: "14:00" },
];

export type Kind = "theory" | "lab" | "activity";

export interface Session {
  hourStart: number; // first hour_value in this block
  hourEnd: number; // last hour_value (labs merge consecutive hours)
  start: string; // "HH:MM"
  end: string; // "HH:MM"
  title: string; // cleaned subject name
  code: string;
  short: string;
  kind: Kind;
  staff: string[]; // de-duplicated staff names
  section?: string;
  leave?: "absent" | "od" | null;
}

const clean = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();

function classify(row: RawClassRow): Kind {
  const t = (row.subject_type ?? "").toLowerCase();
  if (t.includes("lab")) return "lab";
  const code = (row.subject_code ?? "").toUpperCase();
  if (/ASSOCIATION|PLACEMENT|CGC|MENTOR|LIBRARY|COUNSELL/i.test(code + " " + (row.subject_name ?? "")))
    return "activity";
  return "theory";
}

function leaveOf(row: RawClassRow): "absent" | "od" | null {
  const l = (row.leave_type ?? "").toLowerCase();
  if (l === "a") return "absent";
  if (l === "od") return "od";
  return null;
}

export function toSessions(rows: RawClassRow[]): Session[] {
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

  type Cell = { hour: number; row: RawClassRow; staff: Set<string>; code: string };
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
    const flush = () => {
      if (!run.length) return;
      const first = run[0];
      const last = run[run.length - 1];
      const staff = new Set<string>();
      run.forEach((c) => c.staff.forEach((s) => staff.add(s)));
      sessions.push({
        hourStart: first.hour,
        hourEnd: last.hour,
        start: BELL[first.hour].start,
        end: BELL[last.hour].end,
        title: clean(first.row.subject_name) || first.code,
        code: clean(first.row.subject_code),
        short: clean(first.row.short_name),
        kind: classify(first.row),
        staff: [...staff].sort(),
        section: clean(first.row.section) || undefined,
        leave: leaveOf(first.row),
      });
      run = [];
    };
    for (const c of group) {
      if (!run.length || c.hour === run[run.length - 1].hour + 1) run.push(c);
      else {
        flush();
        run.push(c);
      }
    }
    flush();
  }

  sessions.sort((a, b) => a.hourStart - b.hourStart || a.title.localeCompare(b.title));
  return sessions;
}

export const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
