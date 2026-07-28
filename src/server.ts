import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { toSessions, BELL, BREAKS, type RawClassRow, type Session } from "./timetable.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, "..", "public");
const PORT = Number(process.env.PORT ?? 5173);
const CIT_BASE = "https://portal.cit.edu.in/api";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res: ServerResponse, code: number, body: string | Buffer, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function tokenFrom(req: IncomingMessage): string | undefined {
  const h = req.headers["x-cit-token"];
  return Array.isArray(h) ? h[0] : h;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}

async function citForm(path: string, form: Record<string, string>, token?: string) {
  const body = new URLSearchParams(form).toString();
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (token) headers["Api-Token"] = token;
  const r = await fetch(`${CIT_BASE}${path}`, { method: "POST", headers, body });
  const text = await r.text();
  try {
    return { ok: r.ok, status: r.status, json: JSON.parse(text) };
  } catch {
    return { ok: r.ok, status: r.status, json: null as unknown, raw: text };
  }
}

async function citPost(path: string, token: string, form: Record<string, string>) {
  return citForm(path, form, token);
}

async function loginCit(registerno: string, password: string) {
  const reg = registerno.trim();
  if (!reg || !password) throw new Error("Register number and password are required");

  const first = await citForm("/mob/stu/v1/login/check-regno", { registerno: reg });
  if (!first.json || !isOk((first.json as any).status)) {
    throw new Error(messageText(first.json) || `check-regno failed (${first.status})`);
  }
  const uuid = String((first.json as any).data || "");
  const hasPassword = String((first.json as any).has_password ?? "1");
  if (!uuid) throw new Error("Login did not return a uuid");

  const payload: Record<string, string> = { uuid, password };
  if (hasPassword === "0") {
    payload.registerno = reg;
    payload.student_status = "admitted";
  }

  const second = await citForm("/mob/stu/v1/login/check-pass", payload);
  if (!second.json || !isOk((second.json as any).status)) {
    throw new Error(messageText(second.json) || `check-pass failed (${second.status})`);
  }
  const token = String((second.json as any).api || "").trim();
  if (!token) throw new Error("Login succeeded but no Api-Token was returned");
  return {
    token,
    user: (second.json as any).data ?? null,
    acyear: (second.json as any).acyear ?? null,
    permissions: (second.json as any).permissions ?? null,
  };
}

const isOk = (s: unknown) => String(s) === "1";

function messageText(v: unknown): string {
  const m = (v as any)?.message;
  if (Array.isArray(m)) return m.join(", ");
  return typeof m === "string" ? m : "";
}

function isNoClassMessage(msg: string): boolean {
  return /no\s+day\s+order\s+found|day\s+order\s+not\s+found|no\s+time\s*table|no\s+classes?/i.test(msg);
}

function publicError(msg: string, fallback = "Could not load your timetable."): string {
  if (/invalid\s+api|please\s+login|login\s+again|unauthor/i.test(msg)) {
    return "Please log in again to view your timetable.";
  }
  if (/required|validation/i.test(msg)) return "Something needed is missing. Try again.";
  return fallback;
}

interface DayPayload {
  date: string;
  dayOrder: number | null;
  sessions: Session[];
  bell: typeof BELL;
  breaks: typeof BREAKS;
  student?: { course?: string; degree?: string; semester?: number; section?: string };
  error?: string;
}

async function buildDay(token: string, date: string): Promise<DayPayload> {
  const base: DayPayload = { date, dayOrder: null, sessions: [], bell: BELL, breaks: BREAKS };

  const dv = await citPost("/mob/stu/v2/timetable/day-value", token, { date });
  if (dv.json && isOk((dv.json as any).status)) {
    const row = (dv.json as any).row;
    if (row && !Array.isArray(row)) base.dayOrder = Number(row.day_order_value) || null;
  }

  const tt = await citPost("/mob/stu/v2/timetable/my-time-table", token, {
    type: "today",
    date,
    with_general: "1",
  });
  if (!tt.json || !isOk((tt.json as any).status)) {
    const msg = tt.json ? messageText(tt.json) : "";
    if (isNoClassMessage(msg)) return base;
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/api/login" && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const out = await loginCit(String(body.registerno || ""), String(body.password || ""));
      return send(res, 200, JSON.stringify(out));
    } catch (e) {
      return send(res, 401, JSON.stringify({ error: "Login failed. Check your details and try again." }));
    }
  }

  if (url.pathname === "/api/day") {
    const token = tokenFrom(req);
    if (!token) return send(res, 401, JSON.stringify({ error: "Please log in to view your timetable." }));
    const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return send(res, 400, JSON.stringify({ error: "Bad date" }));
    try {
      const payload = await buildDay(token, date);
      return send(res, 200, JSON.stringify(payload));
    } catch (e) {
      return send(res, 502, JSON.stringify({ error: "Could not load your timetable. Try again." }));
    }
  }

  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  try {
    const file = await readFile(join(PUBLIC, p));
    return send(res, 200, file, MIME[extname(p)] ?? "application/octet-stream");
  } catch {
    return send(res, 404, "Not found", "text/plain");
  }
});

server.listen(PORT, () => {
  console.log(`\n  CIT timetable → http://localhost:${PORT}`);
  console.log(`  login in the UI to fetch your timetable\n`);
});
