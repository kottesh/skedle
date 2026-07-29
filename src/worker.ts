import { toSessions, BELL, BREAKS, type RawClassRow, type Session } from "./timetable";

interface Env {
  ASSETS: Fetcher;
}

const CIT_BASE = "https://portal.cit.edu.in/api";
const isOk = (s: unknown) => String(s) === "1";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function tokenFrom(request: Request): string | null {
  return request.headers.get("X-Cit-Token");
}

async function citForm(path: string, form: Record<string, string>, token?: string) {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (token) headers["Api-Token"] = token;

  const r = await fetch(`${CIT_BASE}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(form).toString(),
  });
  const text = await r.text();
  try {
    return { ok: r.ok, status: r.status, json: JSON.parse(text) };
  } catch {
    return { ok: r.ok, status: r.status, json: null as unknown };
  }
}

async function loginCit(registerno: string, password: string) {
  const reg = registerno.trim();
  if (!reg || !password) throw new Error("bad-login");

  const first = await citForm("/mob/stu/v1/login/check-regno", { registerno: reg });
  if (!first.json || !isOk((first.json as any).status)) throw new Error("bad-login");

  const uuid = String((first.json as any).data || "");
  const hasPassword = String((first.json as any).has_password ?? "1");
  if (!uuid) throw new Error("bad-login");

  const payload: Record<string, string> = { uuid, password };
  if (hasPassword === "0") {
    payload.registerno = reg;
    payload.student_status = "admitted";
  }

  const second = await citForm("/mob/stu/v1/login/check-pass", payload);
  if (!second.json || !isOk((second.json as any).status)) throw new Error("bad-login");

  const token = String((second.json as any).api || "").trim();
  if (!token) throw new Error("bad-login");

  return {
    token,
    user: (second.json as any).data ?? null,
    acyear: (second.json as any).acyear ?? null,
    permissions: (second.json as any).permissions ?? null,
  };
}

function messageText(v: unknown): string {
  const m = (v as any)?.message;
  if (Array.isArray(m)) return m.join(", ");
  return typeof m === "string" ? m : "";
}

function isNoClassMessage(msg: string): boolean {
  return /no\s+day\s+order\s+found|day\s+order\s+not\s+found|no\s+time\s*table|no\s+classes?/i.test(msg);
}

function isAuthMessage(msg: string): boolean {
  return /invalid\s+api|please\s+login|login\s+again|unauthor/i.test(msg);
}

function publicError(msg: string, fallback = "Could not load your timetable."): string {
  if (isAuthMessage(msg)) {
    return "Please log in again to view your timetable.";
  }
  if (/required|validation/i.test(msg)) return "Something needed is missing. Try again.";
  return fallback;
}

function studentName(user: unknown): string {
  const u = user as any;
  const candidates = [
    u?.name,
    u?.student_name,
    u?.studentName,
    u?.stuname,
    u?.fullname,
    u?.first_name,
    u?.student?.name,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().replace(/\s+/g, " ");
  }
  return "";
}

interface DayPayload {
  date: string;
  dayOrder: number | null;
  sessions: Session[];
  bell: typeof BELL;
  breaks: typeof BREAKS;
  student?: { course?: string; degree?: string; semester?: number; section?: string };
  error?: string;
  unauthorized?: boolean;
}

async function buildDay(token: string, date: string): Promise<DayPayload> {
  const base: DayPayload = { date, dayOrder: null, sessions: [], bell: BELL, breaks: BREAKS };

  const dv = await citForm("/mob/stu/v2/timetable/day-value", { date }, token);
  if (dv.json && isOk((dv.json as any).status)) {
    const row = (dv.json as any).row;
    if (row && !Array.isArray(row)) base.dayOrder = Number(row.day_order_value) || null;
  }

  const tt = await citForm(
    "/mob/stu/v2/timetable/my-time-table",
    { type: "today", date, with_general: "1" },
    token,
  );
  if (!tt.json || !isOk((tt.json as any).status)) {
    const msg = tt.json ? messageText(tt.json) : "";
    if (isNoClassMessage(msg)) return base;
    if (isAuthMessage(msg) || tt.status === 401 || tt.status === 403) {
      base.error = "Please log in again to view your timetable.";
      base.unauthorized = true;
      return base;
    }
    base.error = publicError(msg);
    return base;
  }

  const rows = ((tt.json as any).data ?? []) as RawClassRow[];
  base.sessions = toSessions(rows);

  const first = rows[0] as any;
  if (first) {
    base.student = {
      course: first.coursename,
      degree: first.degreename,
      semester: first.semester,
      section: first.section,
    };
  }
  return base;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/login" && request.method === "POST") {
      try {
        const body = (await request.json()) as any;
        const session = await loginCit(String(body.registerno || ""), String(body.password || ""));
        return json({ token: session.token, name: studentName(session.user) });
      } catch {
        return json({ error: "Login failed. Check your details and try again." }, 401);
      }
    }

    if (url.pathname === "/api/day" && request.method === "GET") {
      const token = tokenFrom(request);
      if (!token) return json({ error: "Please log in to view your timetable." }, 401);

      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: "Bad date" }, 400);

      try {
        const payload = await buildDay(token, date);
        if (payload.unauthorized) {
          return json({ error: payload.error || "Please log in again to view your timetable." }, 401);
        }
        return json(payload);
      } catch {
        return json({ error: "Could not load your timetable. Try again." }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
