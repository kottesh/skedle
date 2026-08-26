import type { DayPayload } from "../contracts";
import { ApiRequestError, fetchDay, login } from "./api";
import {
  clearAuth,
  isSignedIn,
  persistAuth,
  readAuth,
  type AuthState,
} from "./auth";
import { addDays, formatTime, nowMinutes, parseYmd, todayYmd, toMin } from "./date";
import { focusableWithin, getElement, getForm, getInput } from "./dom";
import {
  railGeometry,
  renderEmpty,
  renderHoliday,
  renderLoading,
  renderRail,
  type RailGeometry,
} from "./renderer";
import { firstName, greetingWord, smartTitleCase } from "./text";

const WEEKDAY = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MON = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

interface AppState {
  date: string;
  auth: AuthState;
  loadState: "idle" | "loading" | "ready" | "error";
}

const state: AppState = {
  date: todayYmd(),
  auth: readAuth(),
  loadState: "idle",
};

// ---------- elements ----------
const rail = getElement("rail");
const noticeEl = getElement("notice");
const statusEl = getElement("status");
const loginStatusEl = getElement("login-note");

// ---------- request lifecycle ----------
let activeRequest: AbortController | null = null;
let nowTimer: ReturnType<typeof setInterval> | null = null;

function stopNowTracking(): void {
  if (nowTimer !== null) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
}

// ---------- header ----------
function setHeader(payload: DayPayload | null): void {
  const d = parseYmd(state.date);
  getElement("weekday").textContent = WEEKDAY[d.getDay()] ?? "—";
  getElement("d-day").textContent = String(d.getDate()).padStart(2, "0");
  getElement("d-mon").textContent = `${MON[d.getMonth()] ?? ""} ${d.getFullYear()}`;

  const first = firstName(state.auth.name);
  const greetEl = getElement("greet");
  greetEl.hidden = !first;
  if (first) greetEl.textContent = `${greetingWord()}, ${smartTitleCase(first)}`;

  const student = payload?.student;
  getElement("ctx").textContent =
    student && student.course ? `${student.course} · sem ${student.semester}` : "skedle";

  const count = payload?.sessions?.length ?? 0;
  const countEl = getElement("count");
  countEl.textContent = payload?.holiday
    ? "holiday"
    : count
      ? `${count} session${count === 1 ? "" : "s"} scheduled`
      : "";
}

// ---------- notices ----------
function showNotice(title: string, detail = ""): void {
  getElement("count").textContent = "";
  rail.hidden = true;
  rail.replaceChildren();
  rail.dataset.view = "none";
  rail.removeAttribute("aria-busy");
  stopNowTracking();

  noticeEl.replaceChildren();
  const titleEl = document.createElement("div");
  titleEl.className = "notice__title";
  titleEl.textContent = title;
  noticeEl.append(titleEl);
  if (detail) {
    const detailEl = document.createElement("div");
    detailEl.className = "notice__detail";
    detailEl.textContent = detail;
    noticeEl.append(detailEl);
  }
  noticeEl.hidden = false;
}

function clearNotice(): void {
  noticeEl.hidden = true;
  noticeEl.replaceChildren();
  rail.hidden = false;
}

// ---------- login sheet (modal on mobile) ----------
const tokEl = getElement("account-toggle").closest(".tok");
const loginForm = getForm("login-form");
const trigger = getElement<HTMLButtonElement>("account-toggle");
let lastFocusBeforeSheet: HTMLElement | null = null;

function sheetIsOpen(): boolean {
  return tokEl?.classList.contains("tok--open") ?? false;
}

function setLoginSheet(open: boolean): void {
  tokEl?.classList.toggle("tok--open", open);
  trigger.setAttribute("aria-expanded", String(open));
  loginForm.setAttribute("aria-hidden", String(!open));
  loginForm.inert = !open;

  if (open) {
    lastFocusBeforeSheet = document.activeElement as HTMLElement | null;
    // Focus the first meaningful field/control inside the panel.
    requestAnimationFrame(() => {
      const focusables = focusableWithin(loginForm);
      (focusables[0] ?? loginForm).focus();
    });
  } else if (loginForm.contains(document.activeElement)) {
    (lastFocusBeforeSheet ?? trigger).focus();
  }
}

function closeLoginSheet(): void {
  setLoginSheet(false);
}

// Focus trap while the sheet is open.
function trapFocus(e: KeyboardEvent): void {
  if (e.key !== "Tab" || !sheetIsOpen()) return;
  const focusables = focusableWithin(loginForm);
  if (focusables.length === 0) return;
  const firstEl = focusables[0]!;
  const lastEl = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && active === firstEl) {
    e.preventDefault();
    lastEl.focus();
  } else if (!e.shiftKey && active === lastEl) {
    e.preventDefault();
    firstEl.focus();
  }
}

// ---------- auth state UI ----------
function setLoginNote(text: string): void {
  loginStatusEl.textContent = text;
}

function refreshLoginState(): void {
  const signed = isSignedIn(state.auth);
  getElement("login-fields").hidden = signed;
  getElement("account-info").hidden = !signed;
  if (signed) {
    getElement("account-name").textContent = state.auth.name
      ? smartTitleCase(state.auth.name)
      : "Signed in";
  }
  setLoginNote(signed ? "Signed in on this browser session." : "Not signed in.");
  loginStatusEl.hidden = false;
  tokEl?.classList.toggle("tok--signed", signed);
  trigger.setAttribute("aria-label", signed ? "Account, signed in" : "Account");
}

function clearLoginFields(): void {
  getInput("registerno").value = "";
  getInput("password").value = "";
}

// ---------- day loading (deterministic) ----------
function renderPayload(payload: DayPayload): void {
  clearNotice();
  statusEl.textContent = "";
  setHeader(payload);

  if (payload.holiday) {
    renderHoliday(rail, payload.holiday);
    stopNowTracking();
    return;
  }
  if (!payload.sessions.length) {
    renderEmpty(rail);
    stopNowTracking();
    return;
  }

  const g = renderRail(rail, payload);
  startNowTracking(g);
  maybeScrollToNow(g);
}

async function selectDate(nextDate: string): Promise<void> {
  state.date = nextDate;
  syncDateControls();
  setHeader(null);

  const token = state.auth.token.trim();
  if (!token) {
    showNotice(
      "Please log in to view your timetable.",
      "Use the account icon (top right), then pick a day.",
    );
    return;
  }

  activeRequest?.abort();
  const controller = new AbortController();
  activeRequest = controller;

  state.loadState = "loading";
  clearNotice();
  renderLoading(rail);
  statusEl.textContent = "";

  try {
    const payload = await fetchDay(nextDate, token, controller.signal);
    if (nextDate !== state.date) return; // a newer request superseded this one
    state.loadState = "ready";
    renderPayload(payload);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (nextDate !== state.date) return;
    state.loadState = "error";
    handleLoadError(err);
  } finally {
    if (activeRequest === controller) activeRequest = null;
    rail.removeAttribute("aria-busy");
  }
}

function handleLoadError(err: unknown): void {
  setHeader(null);
  if (err instanceof ApiRequestError && err.status === 401) {
    const hadToken = Boolean(state.auth.token);
    clearAuth();
    state.auth = readAuth();
    refreshLoginState();
    if (hadToken) {
      setLoginNote("Your session expired. Please sign in again.");
      setLoginSheet(true);
      showNotice("Session expired", "Please sign in again to view your timetable.");
    } else {
      showNotice(
        err.message || "Please log in to view your timetable.",
        "Use the account icon (top right), then pick a day.",
      );
    }
    return;
  }
  if (err instanceof ApiRequestError && err.code === "NETWORK") {
    statusEl.textContent = "Could not reach the server.";
    showNotice("Connection problem", "Check your connection and try again.");
    return;
  }
  const message =
    err instanceof ApiRequestError ? err.message : "Something went wrong. Try again.";
  showNotice(message, "Try picking the day again.");
}

// ---------- now indicator ----------
function paintNow(g: RailGeometry): void {
  if (rail.dataset.view !== "rail") {
    stopNowTracking();
    return;
  }
  const nm = nowMinutes();
  const inRange = state.date === todayYmd() && nm >= g.dayStart && nm <= g.dayEnd;

  for (const ev of rail.querySelectorAll<HTMLElement>(".ev")) {
    const start = toMin(ev.dataset.start ?? "");
    const end = toMin(ev.dataset.end ?? "");
    const on = inRange && start <= nm && nm < end;
    ev.classList.toggle("ev--now", on);
  }

  let line = rail.querySelector<HTMLElement>(".now");
  if (!inRange) {
    line?.remove();
    return;
  }
  if (!line) {
    line = document.createElement("div");
    line.className = "now";
    line.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "now__label";
    line.append(label);
    rail.append(line);
  }
  line.style.top = `${g.y(nm)}px`;
  const now = new Date();
  const label = line.querySelector<HTMLElement>(".now__label");
  if (label) {
    label.textContent = formatTime(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    );
  }
}

function startNowTracking(g: RailGeometry): void {
  stopNowTracking();
  paintNow(g);
  nowTimer = setInterval(() => paintNow(g), 30_000);
}

function maybeScrollToNow(g: RailGeometry): void {
  if (!window.matchMedia("(max-width: 560px)").matches) return;
  if (state.date !== todayYmd()) return;
  const nm = nowMinutes();
  if (nm < g.dayStart || nm > g.dayEnd) return;

  requestAnimationFrame(() => {
    const line = rail.querySelector<HTMLElement>(".now");
    if (!line) return;
    const y = line.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.32;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: Math.max(0, y), behavior: reduce ? "auto" : "smooth" });
  });
}

// ---------- date controls ----------
function syncDateControls(): void {
  getInput("date").value = state.date;
  getElement("today").hidden = state.date === todayYmd();
}

// ---------- wiring ----------
function wire(): void {
  // Login submit
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = getElement<HTMLButtonElement>("login");
    submitBtn.disabled = true;
    setLoginNote("Logging in…");
    try {
      const session = await login(
        getInput("registerno").value.trim(),
        getInput("password").value,
      );
      persistAuth(session);
      state.auth = readAuth();
      clearLoginFields();
      refreshLoginState();
      closeLoginSheet();
      await selectDate(state.date);
    } catch (err) {
      const msg =
        err instanceof ApiRequestError ? err.message : "Login failed. Try again.";
      setLoginNote(msg);
    } finally {
      submitBtn.disabled = false;
    }
  });

  // Sheet controls
  trigger.addEventListener("click", () => setLoginSheet(!sheetIsOpen()));
  getElement("login-close").addEventListener("click", closeLoginSheet);
  getElement("login-backdrop").addEventListener("click", closeLoginSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheetIsOpen()) closeLoginSheet();
    trapFocus(e);
  });

  // Logout
  getElement("logout").addEventListener("click", () => {
    clearAuth();
    state.auth = readAuth();
    clearLoginFields();
    refreshLoginState();
    closeLoginSheet();
    setHeader(null);
    showNotice("Signed out.", "Log in to view your timetable.");
  });

  // Date navigation
  getInput("date").addEventListener("change", (e) => {
    const value = (e.target as HTMLInputElement).value;
    if (value) void selectDate(value);
  });
  getElement("prev").addEventListener("click", () => void selectDate(addDays(state.date, -1)));
  getElement("next").addEventListener("click", () => void selectDate(addDays(state.date, 1)));
  getElement("today").addEventListener("click", () => void selectDate(todayYmd()));
}

// ---------- boot ----------
export function boot(): void {
  wire();
  refreshLoginState();
  setHeader(null);
  syncDateControls();
  void selectDate(state.date);
}

boot();
