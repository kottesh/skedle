// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { DayPayload, Session } from "../../src/contracts";
import { BELL, BREAKS } from "../../src/timetable";
import { renderRail, renderHoliday, renderEmpty, renderLoading } from "../../src/client/renderer";
import { layoutColumns } from "../../src/client/layout";
import { smartTitleCase } from "../../src/client/text";
import { toMin, formatTime, durationLabel, addDays, todayYmd } from "../../src/client/date";

function session(partial: Partial<Session> & Pick<Session, "start" | "end">): Session {
  return {
    hourStart: 1,
    hourEnd: 1,
    title: "Sample",
    code: "S1",
    short: "S",
    kind: "theory",
    staff: [],
    attendance: { status: "unmarked", markedBy: [], markedSubject: [], parts: [] },
    ...partial,
  };
}

function basePayload(sessions: Session[]): DayPayload {
  return { date: "2026-01-06", dayOrder: 1, sessions, bell: BELL, breaks: BREAKS };
}

let rail: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = `<section id="rail"></section>`;
  rail = document.getElementById("rail") as HTMLElement;
});

describe("date utils", () => {
  it("formats 24h to 12h", () => {
    expect(formatTime("09:00")).toBe("9:00 AM");
    expect(formatTime("14:55")).toBe("2:55 PM");
    expect(formatTime("00:05")).toBe("12:05 AM");
  });
  it("computes durations", () => {
    expect(durationLabel(toMin("09:00"), toMin("10:50"))).toBe("1h 50m");
    expect(durationLabel(toMin("09:00"), toMin("09:55"))).toBe("55m");
  });
  it("adds days without drift", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("has a today", () => {
    expect(todayYmd()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("smartTitleCase", () => {
  it("preserves acronyms and mixed case", () => {
    expect(smartTitleCase("data structures")).toBe("Data Structures");
    expect(smartTitleCase("AI and ML")).toBe("AI And ML");
    expect(smartTitleCase("IoT systems")).toBe("IoT Systems");
    expect(smartTitleCase("C++ programming")).toBe("C++ Programming");
  });
});

describe("layoutColumns", () => {
  it("places non-overlapping sessions in one column", () => {
    const laid = layoutColumns([
      session({ start: "09:00", end: "09:55" }),
      session({ start: "11:05", end: "12:00" }),
    ]);
    expect(laid.every((s) => s.cols === 1)).toBe(true);
  });
  it("splits overlapping sessions into columns", () => {
    const laid = layoutColumns([
      session({ start: "09:00", end: "10:50" }),
      session({ start: "09:55", end: "11:00" }),
    ]);
    expect(Math.max(...laid.map((s) => s.cols))).toBe(2);
    expect(new Set(laid.map((s) => s.col)).size).toBe(2);
  });
  it("drops sessions with invalid times", () => {
    const laid = layoutColumns([session({ start: "bad", end: "worse" })]);
    expect(laid).toHaveLength(0);
  });
});

describe("renderRail", () => {
  it("builds an accessible session list with escaped text (no HTML injection)", () => {
    const payload = basePayload([
      session({
        start: "09:00",
        end: "09:55",
        title: "<img src=x onerror=alert(1)>",
        code: "CS101",
        staff: ["Prof. Ada"],
      }),
    ]);
    const g = renderRail(rail, payload);
    expect(g.height).toBeGreaterThan(0);
    expect(rail.dataset.view).toBe("rail");

    const list = rail.querySelector("ol.ev-list");
    expect(list).not.toBeNull();
    const cards = rail.querySelectorAll("article.ev");
    expect(cards).toHaveLength(1);

    // Title is set via textContent, so the tag is inert text, not a real element.
    expect(rail.querySelector("article.ev img")).toBeNull();
    const title = rail.querySelector(".ev__title") as HTMLElement;
    expect(title.textContent).toContain("<img");
  });

  it("renders ticks and breaks as aria-hidden decoration", () => {
    const payload = basePayload([session({ start: "09:00", end: "09:55" })]);
    renderRail(rail, payload);
    const ticks = rail.querySelectorAll(".tick");
    const gaps = rail.querySelectorAll(".gap");
    expect(ticks.length).toBeGreaterThan(0);
    expect(gaps.length).toBe(BREAKS.length);
    ticks.forEach((t) => expect(t.getAttribute("aria-hidden")).toBe("true"));
    gaps.forEach((gap) => expect(gap.getAttribute("aria-hidden")).toBe("true"));
  });

  it("uses side-by-side columns (ev--overlap) when the rail is wide", () => {
    Object.defineProperty(rail, "clientWidth", { configurable: true, value: 680 });
    const payload = basePayload([
      session({ start: "09:00", end: "10:50" }),
      session({ start: "09:55", end: "11:00" }),
    ]);
    renderRail(rail, payload);
    expect(rail.querySelectorAll("article.ev--overlap").length).toBe(2);
    expect(rail.querySelectorAll("article.ev--stacked").length).toBe(0);
  });

  it("stacks overlapping cards vertically when columns would be too narrow", () => {
    // Three concurrent sessions on a 320px rail -> ~107px columns -> stack.
    Object.defineProperty(rail, "clientWidth", { configurable: true, value: 320 });
    const payload = basePayload([
      session({ start: "14:55", end: "15:50", title: "A" }),
      session({ start: "14:55", end: "15:50", title: "B" }),
      session({ start: "14:55", end: "15:50", title: "C" }),
    ]);
    renderRail(rail, payload);
    expect(rail.querySelectorAll("article.ev--stacked").length).toBe(3);
    expect(rail.querySelectorAll("article.ev--overlap").length).toBe(0);
    // Stacked cards span the full width (left inset only, no narrow column width).
    const cards = [...rail.querySelectorAll<HTMLElement>("article.ev--stacked")];
    cards.forEach((c) => {
      expect(c.style.left).toBe("12px");
      expect(c.style.right).toBe("0px");
    });
  });
});

describe("holiday / empty / loading states", () => {
  it("renders a holiday card with an h2 title", () => {
    renderHoliday(rail, { name: "Republic Day", type: "full_day" });
    expect(rail.dataset.view).toBe("holiday");
    const h2 = rail.querySelector("h2.holiday-card__title") as HTMLElement;
    expect(h2.textContent).toBe("Republic Day");
    expect(rail.querySelector(".holiday-card__meta")?.textContent).toBe("Full day");
  });
  it("renders empty state", () => {
    renderEmpty(rail);
    expect(rail.dataset.view).toBe("empty");
    expect(rail.textContent).toContain("No classes");
  });
  it("renders loading state with aria-busy", () => {
    renderLoading(rail);
    expect(rail.dataset.view).toBe("loading");
    expect(rail.getAttribute("aria-busy")).toBe("true");
  });
});
