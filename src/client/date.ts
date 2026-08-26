// Local-date helpers that avoid UTC drift.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1); // local midnight
}

export function todayYmd(): string {
  return ymdLocal(new Date());
}

export function addDays(ymd: string, n: number): string {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}

export function nowMinutes(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function toMin(hhmm: string): number {
  const match = TIME_RE.exec(hhmm);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatTime(hhmm: string): string {
  const match = TIME_RE.exec(hhmm);
  if (!match) return hhmm;
  let h = Number(match[1]);
  const m = match[2];
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}

export function durationLabel(startMin: number, endMin: number): string {
  const total = endMin - startMin;
  if (!Number.isFinite(total) || total <= 0) return "";
  const h = Math.floor(total / 60);
  const r = total % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (r) parts.push(`${r}m`);
  return parts.length ? parts.join(" ") : "0m";
}
