import { toSessions, BELL, BREAKS, type RawClassRow } from "./timetable";
import type { ApiError, ApiErrorCode, DayPayload, HolidayPayload, LoginResponse } from "./contracts";

interface Env {
  ASSETS: Fetcher;
}

const CIT_BASE = "https://portal.cit.edu.in/api";
const UPSTREAM_TIMEOUT_MS = 12_000;

// ---------- small runtime guards (external data is `unknown`) ----------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isString = (v: unknown): v is string => typeof v === "string";

const isOk = (s: unknown): boolean => String(s) === "1";

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// ---------- HTTP helpers ----------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(code: ApiErrorCode, message: string, status: number): Response {
  const body: ApiError = { error: { code, message } };
  return jsonResponse(body, status);
}

function tokenFrom(request: Request): string | null {
  const raw = request.headers.get("X-Cit-Token");
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

class UpstreamError extends Error {
  constructor(message = "upstream-unavailable") {
    super(message);
    this.name = "UpstreamError";
  }
}

class AuthError extends Error {
  constructor(message = "unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

class LoginError extends Error {
  constructor(message = "bad-login") {
    super(message);
    this.name = "LoginError";
  }
}

interface CitResult {
  ok: boolean;
  status: number;
  json: unknown; // never trusted; always guarded before use
}

async function citForm(
  path: string,
  form: Record<string, string>,
  token?: string,
): Promise<CitResult> {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (token) headers["Api-Token"] = token;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${CIT_BASE}${path}`, {
      method: "POST",
      headers,
      body: new URLSearchParams(form).toString(),
      signal: controller.signal,
    });
  } catch {
    throw new UpstreamError();
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { ok: response.ok, status: response.status, json: parsed };
}

// ---------- message classification ----------

function messageText(v: unknown): string {
  if (!isRecord(v)) return "";
  const m = v.message;
  if (Array.isArray(m)) return m.filter(isString).join(", ");
  return isString(m) ? m : "";
}

const isNoClassMessage = (msg: string): boolean =>
  /no\s+day\s+order\s+found|day\s+order\s+not\s+found|no\s+time\s*table|no\s+classes?/i.test(msg);

const isAuthMessage = (msg: string): boolean =>
  /invalid\s+api|please\s+login|login\s+again|unauthor/i.test(msg);

function publicError(msg: string, fallback = "Could not load your timetable."): string {
  if (isAuthMessage(msg)) return "Please log in again to view your timetable.";
  if (/required|validation/i.test(msg)) return "Something needed is missing. Try again.";
  return fallback;
}

function isSuccessResponse(v: unknown): boolean {
  if (isRecord(v) && isOk(v.status)) return true;
  return /^success$/i.test(messageText(v));
}

// ---------- login ----------

function studentName(user: unknown): string {
  if (!isRecord(user)) return "";
  const nested = isRecord(user.student) ? user.student.name : undefined;
  const candidates: unknown[] = [
    user.name,
    user.student_name,
    user.studentName,
    user.stuname,
    user.fullname,
    user.first_name,
    nested,
  ];
  for (const c of candidates) {
    if (isString(c) && c.trim()) return c.trim().replace(/\s+/g, " ");
  }
  return "";
}

async function loginCit(
  registerno: string,
  password: string,
): Promise<{ token: string; name: string }> {
  const reg = registerno.trim();
  if (!reg || !password) throw new LoginError();

  const first = await citForm("/mob/stu/v1/login/check-regno", { registerno: reg });
  if (!isRecord(first.json) || !isOk(first.json.status)) throw new LoginError();

  const uuid = asString(first.json.data);
  const hasPassword = first.json.has_password === undefined ? "1" : asString(first.json.has_password);
  if (!uuid) throw new LoginError();

  const payload: Record<string, string> = { uuid, password };
  if (hasPassword === "0") {
    payload.registerno = reg;
    payload.student_status = "admitted";
  }

  const second = await citForm("/mob/stu/v1/login/check-pass", payload);
  if (!isRecord(second.json) || !isOk(second.json.status)) throw new LoginError();

  const token = asString(second.json.api).trim();
  if (!token) throw new LoginError();

  return { token, name: studentName(second.json.data ?? null) };
}

// ---------- day payload ----------

function holidayFrom(v: unknown): HolidayPayload | null {
  if (!isRecord(v)) return null;
  const data = v.data;
  if (!isRecord(data)) return null;

  const name = asString(data.holiday_name || data.name || data.title).trim();
  if (!name) return null;

  const holiday: HolidayPayload = { name };
  const type = asString(data.day_type || data.holiday_type).trim();
  const holidayDate = asString(data.holiday_date).trim();
  if (type) holiday.type = type;
  if (holidayDate) holiday.date = holidayDate;
  return holiday;
}

function studentFrom(row: unknown): DayPayload["student"] {
  if (!isRecord(row)) return undefined;
  const summary: NonNullable<DayPayload["student"]> = {};
  if (isString(row.coursename)) summary.course = row.coursename;
  if (isString(row.degreename)) summary.degree = row.degreename;
  const semester = Number(row.semester);
  if (Number.isFinite(semester)) summary.semester = semester;
  if (isString(row.section)) summary.section = row.section;
  return Object.keys(summary).length ? summary : undefined;
}

async function buildDay(token: string, date: string): Promise<DayPayload> {
  const base: DayPayload = { date, dayOrder: null, sessions: [], bell: BELL, breaks: BREAKS };

  const dv = await citForm("/mob/stu/v2/timetable/day-value", { date }, token);
  if (isRecord(dv.json) && isSuccessResponse(dv.json)) {
    const data = dv.json.data;
    if (typeof data === "number" || typeof data === "string") {
      base.dayOrder = Number(data) || null;
    } else {
      const holiday = holidayFrom(dv.json);
      if (holiday) base.holiday = holiday;
    }
  }

  const tt = await citForm(
    "/mob/stu/v2/timetable/my-time-table",
    { type: "today", date, with_general: "1" },
    token,
  );

  if (!isRecord(tt.json) || !isSuccessResponse(tt.json)) {
    const msg = messageText(tt.json);
    if (isNoClassMessage(msg)) return base;
    if (isAuthMessage(msg) || tt.status === 401 || tt.status === 403) {
      throw new AuthError();
    }
    throw new UpstreamError(publicError(msg));
  }

  const ttHoliday = holidayFrom(tt.json);
  if (ttHoliday) {
    base.holiday = ttHoliday;
    return base;
  }

  const rawData = tt.json.data;
  const rows: RawClassRow[] = Array.isArray(rawData) ? (rawData as RawClassRow[]) : [];
  base.sessions = toSessions(rows);

  const student = studentFrom(rows[0]);
  if (student) base.student = student;

  return base;
}

// ---------- date validation ----------

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

// ---------- router ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/login") {
      if (request.method !== "POST") {
        return errorResponse("BAD_REQUEST", "Method not allowed.", 405);
      }
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return errorResponse("BAD_REQUEST", "Invalid request body.", 400);
      }
      const registerno = isRecord(body) ? asString(body.registerno) : "";
      const password = isRecord(body) ? asString(body.password) : "";
      try {
        const session = await loginCit(registerno, password);
        const response: LoginResponse = { token: session.token, name: session.name };
        return jsonResponse(response);
      } catch (err) {
        if (err instanceof UpstreamError) {
          return errorResponse(
            "UPSTREAM_UNAVAILABLE",
            "The college portal is unavailable right now. Try again shortly.",
            502,
          );
        }
        return errorResponse(
          "INVALID_LOGIN",
          "Login failed. Check your register number and password.",
          401,
        );
      }
    }

    if (url.pathname === "/api/day") {
      if (request.method !== "GET") {
        return errorResponse("BAD_REQUEST", "Method not allowed.", 405);
      }
      const token = tokenFrom(request);
      if (!token) {
        return errorResponse("UNAUTHORIZED", "Please log in to view your timetable.", 401);
      }

      const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
      if (!isValidCalendarDate(date)) {
        return errorResponse("INVALID_DATE", "That date is not valid.", 400);
      }

      try {
        const payload = await buildDay(token, date);
        return jsonResponse(payload);
      } catch (err) {
        if (err instanceof AuthError) {
          return errorResponse(
            "UNAUTHORIZED",
            "Please log in again to view your timetable.",
            401,
          );
        }
        const message =
          err instanceof UpstreamError && err.message !== "upstream-unavailable"
            ? err.message
            : "Could not load your timetable. Try again.";
        return errorResponse("UPSTREAM_UNAVAILABLE", message, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },
};
