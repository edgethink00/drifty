import { describe, expect, it } from "vitest";
import type { DaySpan } from "./dayNoteFixture";
import { dailyFigures } from "./dailyFiguresModel";
const span = (start: number, end: number, kind: DaySpan["kind"], category: DaySpan["category"] = "workspace"): DaySpan => ({ start, end, kind, category });
describe("daily category flow", () => {
  it("counts overlapping records once and keeps category totals consistent with cell time", () => {
    const result = dailyFigures([span(0, 30, "focus"), span(10, 20, "drift", "entertainment"), span(0, 30, "neutral", "utility"), span(40, 40, "focus"), span(NaN, 50, "focus")], 0);
    expect(result.total).toBe(30);
    expect(result.rows.map(row => [row.category, row.minutes])).toEqual([["workspace", 20], ["entertainment", 10]]);
    for (const row of result.rows) expect(row.cells.reduce((sum, n) => sum + n, 0)).toBeCloseTo(row.minutes);
  });
  it("retains a short category inside a shared cell rather than selecting only its majority", () => {
    const result = dailyFigures([span(0, 14, "focus"), span(14, 15, "neutral", "communication")], 0);
    expect(result.rows[0]?.cells[0]).toBe(14);
    expect(result.rows[1]?.cells[0]).toBe(1);
    expect(result.total).toBe(15);
  });
  it("keeps next-calendar-morning records in the operational day and clips outside it", () => {
    const result = dailyFigures([span(200, 250, "focus"), span(1450, 1470, "neutral", "utility"), span(1670, 1700, "drift", "entertainment")]);
    expect(result.start).toBe(240);
    expect(result.end).toBe(1680);
    expect(result.total).toBe(40);
    expect(result.rows.find(row => row.category === "utility")?.minutes).toBe(20);
    expect(result.rows.every(row => row.cells.length === 48)).toBe(true);
    const hourly = dailyFigures([span(200, 250, "focus"), span(1450, 1470, "neutral", "utility")], 240, 60);
    expect(hourly.rows.every(row => row.cells.length === 24)).toBe(true);
    expect(hourly.rows.find(row => row.category === "utility")?.cells[20]).toBe(20);
  });
  it("keeps an identical time axis for a short day and a full day without counting gaps", () => {
    const short = dailyFigures([span(800, 810, "focus")]);
    const full = dailyFigures([span(300, 360, "focus"), span(1400, 1500, "neutral")]);
    expect([short.start, short.end]).toEqual([full.start, full.end]);
    expect(short.total).toBe(10);
    expect(full.total).toBe(160);
  });
  it("does not invent category rows or time on an empty day", () => {
    const result = dailyFigures([]);
    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });
  it("groups the same cells by productivity and by project, with no time invented", () => {
    const result = dailyFigures([span(0, 30, "focus"), { ...span(30, 50, "drift", "entertainment"), project: "Site" }, { ...span(50, 60, "focus"), project: "Site" }, { ...span(60, 65, "neutral", "utility"), project: "App" }], 0, 60);
    expect(result.rowsBy("productivity").map(row => [row.key, row.minutes])).toEqual([["focus", 40], ["drift", 20], ["neutral", 5]]);
    expect(result.rowsBy("project").map(row => [row.key, row.minutes])).toEqual([["Site", 30], ["App", 5]]);
    expect(result.rowsBy("productivity").reduce((sum, row) => sum + row.minutes, 0)).toBe(result.total);
  });
  it("lists the top apps of one cell, counting overlaps once and keeping private time unnamed", () => {
    const result = dailyFigures([
      { ...span(0, 20, "focus"), app: "Code", bundleId: "code" },
      { ...span(10, 25, "drift", "entertainment"), app: "Safari", site: "youtube.com" },
      { ...span(20, 26, "focus"), app: "Figma" },
      span(26, 30, "focus"),
    ], 0, 30);
    // Drift owns 10–25, so Code keeps 0–10 and Figma only 25–26; the unnamed (private) span keeps its time.
    expect(result.cellApps("category", "workspace", 0)).toEqual([
      { appName: "Code", bundleId: "code", site: undefined, minutes: 10 },
      { appName: "", bundleId: undefined, site: undefined, minutes: 4 },
      { appName: "Figma", bundleId: undefined, site: undefined, minutes: 1 },
    ]);
    expect(result.cellApps("productivity", "drift", 0)).toEqual([{ appName: "youtube.com", bundleId: undefined, site: "youtube.com", minutes: 15 }]);
    expect(result.cellApps("category", "workspace", 1)).toEqual([]);
  });
});
