import { describe, expect, it } from "vitest";
import { toSessions, toMin, isValidTime, type RawClassRow } from "../src/timetable";

function row(partial: Partial<RawClassRow> & { hour_value: number }): RawClassRow {
  return { ...partial };
}

describe("toMin / isValidTime", () => {
  it("parses valid times", () => {
    expect(toMin("09:00")).toBe(540);
    expect(toMin("16:45")).toBe(1005);
  });
  it("returns NaN for invalid times", () => {
    expect(Number.isNaN(toMin("25:00"))).toBe(true);
    expect(Number.isNaN(toMin("9:99"))).toBe(true);
    expect(Number.isNaN(toMin("nope"))).toBe(true);
  });
  it("validates time strings", () => {
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
    expect(isValidTime("24:00")).toBe(false);
  });
});

describe("toSessions", () => {
  it("keeps a single theory class as one session", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "MA101", subject_name: "Calculus", subject_type: "Theory" }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ start: "09:00", end: "09:55", kind: "theory" });
  });

  it("does NOT merge theory classes even when hours are consecutive", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "MA101", subject_type: "Theory" }),
      row({ hour_value: 2, subject_code: "MA101", subject_type: "Theory" }),
    ]);
    expect(sessions).toHaveLength(2);
  });

  it("merges consecutive time-adjacent lab hours into one block", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "CS199", subject_name: "Prog Lab", subject_type: "Lab" }),
      row({ hour_value: 2, subject_code: "CS199", subject_name: "Prog Lab", subject_type: "Lab" }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      hourStart: 1,
      hourEnd: 2,
      start: "09:00",
      end: "10:50",
      kind: "lab",
    });
  });

  it("does NOT merge lab hours separated by lunch (hour 4 -> hour 5)", () => {
    // Hour 4 ends 12:55, hour 5 starts 14:00 — not time-adjacent.
    const sessions = toSessions([
      row({ hour_value: 4, subject_code: "CS199", subject_type: "Lab" }),
      row({ hour_value: 5, subject_code: "CS199", subject_type: "Lab" }),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({ start: "12:00", end: "12:55" });
    expect(sessions[1]).toMatchObject({ start: "14:00", end: "14:55" });
  });

  it("does NOT merge lab hours separated by the morning break (hour 2 -> hour 3)", () => {
    // Hour 2 ends 10:50, hour 3 starts 11:05 — not time-adjacent.
    const sessions = toSessions([
      row({ hour_value: 2, subject_code: "CS199", subject_type: "Lab" }),
      row({ hour_value: 3, subject_code: "CS199", subject_type: "Lab" }),
    ]);
    expect(sessions).toHaveLength(2);
  });

  it("ignores rows with hour values outside the bell schedule", () => {
    const sessions = toSessions([
      row({ hour_value: 99, subject_code: "X" }),
      row({ hour_value: 1, subject_code: "MA101", subject_type: "Theory" }),
    ]);
    expect(sessions).toHaveLength(1);
  });

  it("accumulates multiple staff for one hour", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "CS101", subject_type: "Theory", employee_name: "Alice" }),
      row({ hour_value: 1, subject_code: "CS101", subject_type: "Theory", employee_name: "Bob" }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.staff).toEqual(["Alice", "Bob"]);
  });

  it("marks mixed attendance across a merged lab block", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "CS199", subject_type: "Lab", leave_type: "p" }),
      row({ hour_value: 2, subject_code: "CS199", subject_type: "Lab", leave_type: "a" }),
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.attendance.status).toBe("mixed");
  });

  it("reports a single attendance status when all parts agree", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "CS199", subject_type: "Lab", leave_type: "p" }),
      row({ hour_value: 2, subject_code: "CS199", subject_type: "Lab", leave_type: "p" }),
    ]);
    expect(sessions[0]!.attendance.status).toBe("present");
  });

  it("classifies activity subjects", () => {
    const sessions = toSessions([
      row({ hour_value: 1, subject_code: "MENTOR", subject_name: "Mentoring" }),
    ]);
    expect(sessions[0]!.kind).toBe("activity");
  });
});
