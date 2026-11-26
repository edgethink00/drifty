import { describe, expect, it } from "vitest";
import { buildHomeModel, phaseAt, weekDiscovery, workItemOf } from "./homeModel";
import { at, homeFixture, homeSegment, TODAY } from "./homeFixture.testUtils";

const build = (clock: string, extra: Partial<Parameters<typeof buildHomeModel>[0]> = {}) => buildHomeModel({
  segments: homeFixture(), today: TODAY, asOfMs: at(TODAY, clock), startOfDayMinutes: 0, goalHours: null, ...extra,
});

describe("Home numbers from this computer's records", () => {
  it("compares today's focus with the same clock time on the last four same weekdays", () => {
    const model = build("12:00");
    expect(model.now.focus).toBe((2 * 60 + 35) * 60);
    expect(model.baseline.days).toBe(4);
    expect(model.baseline.focus).toBe(2 * 3600);
    expect(model.paceSeconds).toBe(35 * 60);
    expect(model.baseline.drift).toBe(20 * 60);
    expect(model.baseline.fullDayFocus).toBe(4 * 3600);
  });

  it("reads only what happened before the chosen time", () => {
    const model = build("10:00");
    expect(model.now.focus).toBe(3600);
    expect(model.now.drift).toBe(0);
    expect(model.paceSeconds).toBe(0);
    // An hour of focus has built up, so the morning recap has given way to the pace.
    expect(model.phase).toBe("midday");
    expect(build("09:30").phase).toBe("morning");
  });

  it("calls today's longest focus a record only against days that had focus", () => {
    expect(build("12:00").weekRecord).toBe(true);
    const alone = buildHomeModel({ segments: [homeSegment(TODAY, "09:00", "11:00", "focus")], today: TODAY, asOfMs: at(TODAY, "12:00"), startOfDayMinutes: 0, goalHours: 4 });
    expect(alone.weekRecord).toBe(false);
  });

  it("assumes a 4-hour goal only when onboarding left it unset", () => {
    expect(build("12:00").goalSeconds).toBe(4 * 3600);
    expect(build("12:00").goalIsDefault).toBe(true);
    const set = build("12:00", { goalHours: 3 });
    expect(set.goalSeconds).toBe(3 * 3600);
    expect(set.goalIsDefault).toBe(false);
  });

  it("keeps a record past midnight in the app's day when the day starts at 04:00", () => {
    const segments = [...homeFixture(), homeSegment(TODAY, "23:30", "01:30", "focus", { windowTitle: "late" })];
    const model = buildHomeModel({ segments, today: TODAY, asOfMs: at("2026-11-06", "02:00"), startOfDayMinutes: 240, goalHours: null });
    expect(model.now.focus).toBe((2 * 60 + 35 + 5 * 60 + 30 + 2 * 60) * 60);
    expect(model.phase).toBe("evening");
  });

  it("names yesterday's work by title and picks up from its last long focus", () => {
    const model = build("09:10");
    expect(model.yesterday?.topItems.map((item) => item.label)).toEqual(["billing.ts", "Pricing empty states"]);
    expect(model.yesterday?.lastItem).toMatchObject({ label: "Pricing empty states", source: "Figma" });
  });

  it("finds the hour the week's longest focus keeps starting in", () => {
    expect(weekDiscovery(build("12:00"))).toEqual({ kind: "same-hour", hour: 9, count: 4, of: 4 });
  });

  it("counts deep focus only from runs of 25 minutes or more", () => {
    const segments = [homeSegment(TODAY, "09:00", "09:20", "focus"), homeSegment(TODAY, "10:00", "10:40", "focus")];
    const model = buildHomeModel({ segments, today: TODAY, asOfMs: at(TODAY, "12:00"), startOfDayMinutes: 0, goalHours: 4 });
    expect(model.deepFocusSeconds).toBe(40 * 60);
    expect(model.paceSeconds).toBeNull();
  });

  it("calls a record by its title, falling back to its app or site", () => {
    expect(workItemOf(homeSegment(TODAY, "09:00", "10:00", "focus", { windowTitle: "plan.md" }))).toMatchObject({ label: "plan.md", source: "Visual Studio Code" });
    expect(workItemOf(homeSegment(TODAY, "09:00", "10:00", "drift", { appName: "Arc", siteDomain: "www.youtube.com", siteTitle: "" }))).toMatchObject({ label: "youtube.com" });
  });

  it("speaks of the morning until focus builds, of pace by day and of the wrap-up from six", () => {
    expect(phaseAt(at(TODAY, "09:10"), 0)).toBe("morning");
    expect(phaseAt(at(TODAY, "10:30"), 50 * 60)).toBe("midday");
    expect(phaseAt(at(TODAY, "14:20"), 0)).toBe("midday");
    expect(phaseAt(at(TODAY, "19:30"), 0)).toBe("evening");
  });

  it("adds focus up through the day so the curve meets today's and the usual totals at the chosen time", () => {
    const model = build("12:00");
    const { today, usual, nowStep } = model.focusCurve;
    // Quarter hours from midnight: 12:00 is the 48th.
    expect(nowStep).toBe(48);
    expect(today[nowStep - 1]).toBeCloseTo(model.now.focus, 0);
    expect(usual?.[nowStep - 1]).toBeCloseTo(model.baseline.focus, 0);
    expect(usual?.[usual.length - 1]).toBeCloseTo(model.baseline.fullDayFocus, 0);
  });

  it("leaves a same weekday with almost no focus out of usual, as a day off", () => {
    const segments = [
      homeSegment("2026-10-29", "09:00", "09:10", "focus"),
      homeSegment("2026-10-22", "09:00", "11:00", "focus"),
      homeSegment(TODAY, "09:00", "10:00", "focus"),
    ];
    const model = buildHomeModel({ segments, today: TODAY, asOfMs: at(TODAY, "12:00"), startOfDayMinutes: 0, goalHours: 4 });
    expect(model.baseline.days).toBe(1);
    expect(model.baseline.focus).toBe(2 * 3600);
    expect(model.paceSeconds).toBe(-3600);
  });

  it("counts a break in focus only for a minute or more of drift with focus on both sides", () => {
    const segments = [
      homeSegment(TODAY, "09:00", "09:30", "focus"),
      homeSegment(TODAY, "09:30", "09:33", "drift"),
      homeSegment(TODAY, "09:33", "09:34", "neutral"),
      homeSegment(TODAY, "09:34", "10:00", "focus"),
      homeSegment(TODAY, "10:00", "10:20", "focus"),
      homeSegment(TODAY, "10:20", "10:30", "drift"),
    ];
    const model = buildHomeModel({ segments, today: TODAY, asOfMs: at(TODAY, "11:00"), startOfDayMinutes: 0, goalHours: 4 });
    // The last drift has no focus after it yet.
    expect(model.focusBreaks).toBe(1);
  });

  it("splits today's records into hours that add up to today's totals", () => {
    const model = build("12:00");
    const sum = (key: "focus" | "drift") => model.hours.reduce((total, hour) => total + hour[key], 0);
    expect(model.hours).toHaveLength(24);
    expect(sum("focus")).toBeCloseTo(model.now.focus, 0);
    expect(sum("drift")).toBeCloseTo(model.now.drift, 0);
    // Usual Thursdays focus the whole 9 and 10 o'clock hours.
    expect(model.hours[9].usualFocus).toBe(3600);
  });

  it("names today's stretches oldest first: focus that held 15 minutes, drift that took 5", () => {
    const segments = [
      homeSegment(TODAY, "09:00", "09:40", "focus", { windowTitle: "plan.md" }),
      homeSegment(TODAY, "09:40", "09:43", "drift", { appName: "Arc", siteDomain: "x.com" }),
      homeSegment(TODAY, "10:00", "10:10", "focus", { windowTitle: "short.md" }),
      homeSegment(TODAY, "10:20", "10:32", "drift", { appName: "Arc", siteDomain: "youtube.com" }),
    ];
    const model = buildHomeModel({ segments, today: TODAY, asOfMs: at(TODAY, "11:00"), startOfDayMinutes: 0, goalHours: 4 });
    // The 3-minute drift and the 10-minute focus are too short to name.
    expect(model.sessions.map((session) => [session.kind, session.item?.label])).toEqual([["focus", "plan.md"], ["drift", "youtube.com"]]);
    expect(model.sessions[1].seconds).toBe(12 * 60);
  });
});

