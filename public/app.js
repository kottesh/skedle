const $ = (id) => document.getElementById(id);
const rail = $("rail");
const noticeEl = $("notice");
const statusEl = $("status");

const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const fmt = (hhmm) => {
  let [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "AM" : "PM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
};

function pad2(n) {
  return String(n).padStart(2, "0");
}
function ymdLocal(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function parseYmd(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d); // local midnight, no UTC drift
}
function todayYmd() {
  return ymdLocal(new Date());
}
function addDays(ymd, n) {
  const d = parseYmd(ymd);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}

let date = todayYmd();
const tokenKey = "cit_api_token";

function savedToken() {
  return localStorage.getItem(tokenKey) || "";
}
function setLoginNote(text) {
  const n = $("login-note");
  if (n) n.textContent = text;
}
function refreshLoginState() {
  const signed = Boolean(savedToken());
  setLoginNote(signed ? "Signed in on this browser." : "Not signed in.");
  const logout = $("logout");
  if (logout) logout.hidden = !signed;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  setLoginNote("Logging in…");
  const body = {
    registerno: $("registerno").value.trim(),
    password: $("password").value,
  };
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed");
    localStorage.setItem(tokenKey, data.token);
    clearLoginFields();
    refreshLoginState();
    document.querySelector(".tok")?.removeAttribute("open");
    document.querySelector(".controls-shell")?.removeAttribute("open");
    load();
  } catch (err) {
    setLoginNote((err && err.message) || "Login failed");
  }
});
function clearLoginFields() {
  $("registerno").value = "";
  $("password").value = "";
}
function closeLoginSheet() {
  document.querySelector(".tok")?.removeAttribute("open");
}
$("login-backdrop").addEventListener("click", closeLoginSheet);
document.addEventListener("pointerdown", (e) => {
  const tok = document.querySelector(".tok");
  if (!tok?.hasAttribute("open")) return;
  if (tok.contains(e.target)) return;
  closeLoginSheet();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLoginSheet();
});
$("logout").addEventListener("click", () => {
  localStorage.removeItem(tokenKey);
  clearLoginFields();
  refreshLoginState();
  closeLoginSheet();
  document.querySelector(".controls-shell")?.removeAttribute("open");
  setHeader(parseYmd(date), null);
  showNotice("Signed out.", "Log in to view your timetable.");
});
refreshLoginState();

$("date").value = date;
$("date").addEventListener("change", (e) => {
  if (e.target.value) {
    date = e.target.value;
    load();
  }
});
$("prev").addEventListener("click", () => shift(-1));
$("next").addEventListener("click", () => shift(1));
$("today").addEventListener("click", () => {
  date = todayYmd();
  sync();
  load();
});
function shift(n) {
  date = addDays(date, n);
  sync();
  load();
}
function sync() {
  $("date").value = date;
}

function showNotice(title, detail = "") {
  const cnt = $("count");
  if (cnt) cnt.textContent = "";
  rail.hidden = true;
  rail.innerHTML = "";
  noticeEl.hidden = false;
  noticeEl.innerHTML = `
    <div class="notice__title">${escape(title)}</div>
    ${detail ? `<div class="notice__detail">${escape(detail)}</div>` : ""}`;
}
function clearNotice() {
  noticeEl.hidden = true;
  noticeEl.innerHTML = "";
  rail.hidden = false;
}

function setHeader(d, payload) {
  $("weekday").textContent = WEEKDAY[d.getDay()];
  $("d-day").textContent = String(d.getDate()).padStart(2, "0");
  $("d-mon").textContent = `${MON[d.getMonth()]} ${d.getFullYear()}`;
  const s = payload && payload.student;
  $("ctx").textContent = s && s.course ? `${s.course.toLowerCase()} · sem ${s.semester}` : "timetable";
  const n = payload && payload.sessions ? payload.sessions.length : 0;
  const cnt = $("count");
  if (cnt) cnt.textContent = n ? `${n} session${n === 1 ? "" : "s"} scheduled` : "";
}

function durLabel(startMin, endMin) {
  const m = endMin - startMin;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return (h ? `${h}h` : "") + (r ? `${h ? " " : ""}${r}m` : h ? "" : "0m");
}

function railGeometry(bell, sessions) {
  const starts = Object.values(bell).map((b) => toMin(b.start));
  const ends = Object.values(bell).map((b) => toMin(b.end));
  const dayStart = Math.min(...starts) - 5;
  const dayEnd = Math.max(...ends) + 5;
  const pxMin = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px-min")) || 2.4;
  return {
    dayStart,
    dayEnd,
    pxMin,
    y: (min) => (min - dayStart) * pxMin,
    height: (dayEnd - dayStart) * pxMin,
  };
}

function render(payload) {
  clearNotice();
  rail.innerHTML = "";
  const d = parseYmd(date);
  setHeader(d, payload);
  statusEl.textContent = "";

  if (payload.error) {
    showNotice(payload.error, "Open controls and log in, then pick the day again.");
    return;
  }

  const sessions = payload.sessions || [];
  if (!sessions.length && !payload.error) {
    const cnt = $("count");
    if (cnt) cnt.textContent = "";
    rail.style.height = "auto";
    rail.style.borderLeft = "none";
    rail.style.marginLeft = "0";
    rail.innerHTML = `<div class="empty"><div class="empty__mark">No classes.</div><div>Nothing scheduled for this day.</div></div>`;
    return;
  }
  rail.style.borderLeft = "";
  rail.style.marginLeft = "";

  const laid = layoutColumns(sessions);
  const mobile = window.matchMedia("(max-width: 560px)").matches;

  if (mobile) {
    renderList(payload, laid);
    return;
  }
  renderRail(payload, laid);
}

function eventHTML(s) {
  const kindLabel = s.leave === "absent" ? "absent" : s.kind;
  const staff = s.staff && s.staff.length ? s.staff.join(", ") : "";
  const dur = durLabel(toMin(s.start), toMin(s.end));
  const hrs = s.hourEnd !== s.hourStart ? `Hours ${s.hourStart}–${s.hourEnd}` : `Hour ${s.hourStart}`;
  return `
      <div class="ev__top">
        <span class="ev__time">${fmt(s.start)} – ${fmt(s.end)}</span>
        <span class="ev__kind">${kindLabel}</span>
      </div>
      <h3 class="ev__title">${escape(titleCase(s.title))}</h3>
      <div class="ev__meta">
        ${s.code ? `<span class="ev__code">${escape(s.code)}</span>` : ""}
        ${staff ? `<span class="ev__staff">${escape(staff)}</span>` : ""}
      </div>
      <div class="ev__dur">${hrs} · ${dur}</div>`;
}

function evClass(s, extra) {
  return (
    "ev ev--" + s.kind + (s.leave === "absent" ? " ev--absent" : "") + (extra ? " " + extra : "")
  );
}

function renderRail(payload, laid) {
  rail.dataset.view = "rail";
  const g = railGeometry(payload.bell, laid);
  rail.style.height = g.height + "px";

  const tickTimes = [...new Set(Object.values(payload.bell).flatMap((b) => [b.start, b.end]))].sort();
  for (const t of tickTimes) {
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.top = g.y(toMin(t)) + "px";
    const label = document.createElement("span");
    label.className = "tick__label";
    label.textContent = fmt(t).replace(":00", "");
    tick.appendChild(label);
    rail.appendChild(tick);
  }

  for (const br of payload.breaks || []) {
    const el = document.createElement("div");
    el.className = "gap";
    el.style.top = g.y(toMin(br.start)) + "px";
    el.style.height = (toMin(br.end) - toMin(br.start)) * g.pxMin + "px";
    el.innerHTML = `<span class="gap__label">${br.label}</span>`;
    rail.appendChild(el);
  }

  for (const s of laid) {
    const top = g.y(toMin(s.start));
    const h = (toMin(s.end) - toMin(s.start)) * g.pxMin;
    const narrow = s.cols > 1;
    const el = document.createElement("div");
    el.className = evClass(s, h < 90 || narrow ? "ev--short" : "");
    el.style.top = top + "px";
    el.style.height = Math.max(h - 6, 34) + "px";
    if (s.cols > 1) {
      const gapPct = 2;
      const w = (100 - gapPct * (s.cols - 1)) / s.cols;
      el.style.left = `calc(12px + (100% - 12px) * ${(s.col * (w + gapPct)) / 100})`;
      el.style.width = `calc((100% - 12px) * ${w / 100})`;
      el.style.right = "auto";
    }
    el.innerHTML = eventHTML(s);
    rail.appendChild(el);
  }

  const todayStr = todayYmd();
  if (date === todayStr) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin >= g.dayStart && nowMin <= g.dayEnd) {
      const line = document.createElement("div");
      line.className = "now";
      line.style.top = g.y(nowMin) + "px";
      const nl = document.createElement("span");
      nl.className = "now__label";
      nl.textContent = fmt(
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
      );
      line.appendChild(nl);
      rail.appendChild(line);
    }
  }
}

function renderList(payload, laid) {
  rail.dataset.view = "list";
  rail.style.height = "auto";

  const ordered = [...laid].sort(
    (a, b) => toMin(a.start) - toMin(b.start) || a.col - b.col
  );
  const breaks = (payload.breaks || []).slice().sort((a, b) => toMin(a.start) - toMin(b.start));

  let bi = 0;
  let prevKey = null;
  for (const s of ordered) {
    while (bi < breaks.length && toMin(breaks[bi].start) <= toMin(s.start)) {
      const d = document.createElement("div");
      d.className = "slot-break";
      d.textContent = `${breaks[bi].label} · ${fmt(breaks[bi].start)}–${fmt(breaks[bi].end)}`;
      rail.appendChild(d);
      bi++;
    }
    const key = s.start + s.end;
    const isParallel = s.cols > 1;
    const firstOfParallel = isParallel && key !== prevKey;
    if (firstOfParallel) {
      const t = document.createElement("div");
      t.className = "parallel-tag";
      t.textContent = `Parallel · ${fmt(s.start)}–${fmt(s.end)}`;
      rail.appendChild(t);
    }
    prevKey = key;
    const el = document.createElement("div");
    el.className = evClass(s, isParallel ? "ev--parallel" : "");
    el.innerHTML = eventHTML(s);
    rail.appendChild(el);
  }
  while (bi < breaks.length) {
    const d = document.createElement("div");
    d.className = "slot-break";
    d.textContent = `${breaks[bi].label} · ${fmt(breaks[bi].start)}–${fmt(breaks[bi].end)}`;
    rail.appendChild(d);
    bi++;
  }
}

function layoutColumns(sessions) {
  const items = sessions
    .map((s) => ({ ...s, s0: toMin(s.start), s1: toMin(s.end), col: 0, cols: 1 }))
    .sort((a, b) => a.s0 - b.s0 || a.s1 - b.s1);

  let i = 0;
  while (i < items.length) {
    let j = i + 1;
    let clusterEnd = items[i].s1;
    while (j < items.length && items[j].s0 < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, items[j].s1);
      j++;
    }
    const cluster = items.slice(i, j);

    const colEnds = []; // end-min per column
    for (const it of cluster) {
      let placed = -1;
      for (let c = 0; c < colEnds.length; c++) {
        if (it.s0 >= colEnds[c]) {
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

function titleCase(s) {
  return String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function load() {
  const token = savedToken().trim();
  rail.innerHTML = `<div class="rail__loading">Loading…</div>`;
  statusEl.textContent = "";
  try {
    const res = await fetch(`/api/day?date=${date}`, {
      headers: token ? { "X-Cit-Token": token } : {},
    });
    const payload = await res.json();
    if (!res.ok) {
      setHeader(parseYmd(date), null);
      statusEl.textContent = "";
      showNotice(payload.error || `Error ${res.status}`, "Open controls and log in, then pick the day again.");
      return;
    }
    render(payload);
  } catch (e) {
    rail.innerHTML = "";
    statusEl.textContent = "Could not reach the server.";
  }
}

let lastPayload = null;
const _render = render;
render = function (p) {
  lastPayload = p;
  return _render(p);
};
let rzt;
let wasMobile = window.matchMedia("(max-width: 560px)").matches;
window.addEventListener("resize", () => {
  clearTimeout(rzt);
  rzt = setTimeout(() => {
    const isMobile = window.matchMedia("(max-width: 560px)").matches;
    if (isMobile !== wasMobile && lastPayload) {
      wasMobile = isMobile;
      rail.innerHTML = "";
      render(lastPayload);
    }
  }, 150);
});

sync();
load();
