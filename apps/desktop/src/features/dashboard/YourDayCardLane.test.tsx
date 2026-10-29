// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTIVITY_TIMELINE_CARD_PROMPT_VERSION, storedActivityTimelineCards, type ActivitySegment, type ActivityTimelineWindowRecord } from "@drifty/domain";
import { ActivityLabelsContext } from "../activity-labels/ActivityLabelsContext";
import { buildActivityLabelBlocks, buildActivityLabelIndex } from "../activity-labels/activityLabelBlocks";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { buildWeekCalendarEvents } from "./weekCalendar";
import { arrangeWeekCardBlocks } from "./weekCardBlocks";
import { buildWeekTimelineEvents } from "./weekTimelineEvents";
import { YourDayCardLane } from "./YourDayCardLane";

const day = "2026-10-17";
const at = (time: string) => new Date(`${day}T${time}:00`).toISOString();
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, 200, this.classList.contains("your-day-lane") ? 600 : 16);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Naming = { readonly openWindows?: readonly { readonly startMs: number; readonly endMs: number }[]; readonly namesExpected?: boolean };

function setup(ranges: [string, string, string][], stored = true, activityRanges: [string, string][] = [["09:00", "11:00"]], naming: Naming = {}) {
  // One continuous app record spans multiple named tasks. The legacy calendar
  // alone cannot reproduce those task boundaries.
  const segments: ActivitySegment[] = activityRanges.map(([start, end], i) => ({ id: `record-${i}`, startedAt: at(start), endedAt: at(end), durationSeconds: (Date.parse(at(end)) - Date.parse(at(start))) / 1000, appName: "Code", platform: "macos", source: "nsworkspace" }));
  const windows: ActivityTimelineWindowRecord[] = stored ? [{ windowKey: "window", logicalDay: day, language: "en", startedAt: at("09:00"), endedAt: at("11:00"), promptVersion: ACTIVITY_TIMELINE_CARD_PROMPT_VERSION,
    cards: ranges.map(([title, start, end], position) => ({ position, title, description: "Extra detail", startedAt: at(start), endedAt: at(end), status: "ready", variant: "strict", segmentIds: segments.map(s => s.id) })),
  }] : [];
  const legacy = buildWeekCalendarEvents(segments, day, day, 0, 24);
  const weekCalendarEvents = buildWeekTimelineEvents(legacy, segments, storedActivityTimelineCards(windows, "en"), { startOfDayMinutes: 0 });
  const byId = new Map(segments.map(s => [s.id, s]));
  const blocks = buildActivityLabelBlocks(weekCalendarEvents, { segmentsById: byId, labels: [], windows, startOfDayMinutes: 0, language: "en", nowMs: Date.parse(at("18:00")) });
  const index = buildActivityLabelIndex(blocks, byId);
  const week = arrangeWeekCardBlocks(weekCalendarEvents, index, { startOfDayMinutes: 0 }).eventsByDay.get(day)!;
  const onOpenMinute = vi.fn();
  const result = render(<LocalizationTestProvider language="en"><ActivityLabelsContext.Provider value={{ index, weekCalendarEvents, editingEnabled: false, saveUserLabel: vi.fn(), resetUserLabel: vi.fn(), ...naming }}>
    <YourDayCardLane day={day} segments={segments} classificationOptions={{ fallbackCandidates: [], includeAiClassifications: true }} startOfDayMinutes={0} colorMode="category" projectBySegmentId={new Map()} appIcons={{}} onOpenMinute={onOpenMinute} />
  </ActivityLabelsContext.Provider></LocalizationTestProvider>);
  return { ...result, week, onOpenMinute };
}

describe("Your Day uses the Week task ranges", () => {
  it("keeps cards aligned to their hours in a scaled product picture", () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("your-day-lane") ? 1200 : 0;
    });
    // The 600px painted height is half the 1200px layout height.
    const { container } = setup([["Deep work", "09:00", "10:30"]]);
    const card = container.querySelector<HTMLElement>(".your-day-anchored-card")!;
    expect(parseFloat(card.style.top)).toBeCloseTo(450);
    expect(parseFloat(card.style.height)).toBeCloseTo(75);
  });
  it("keeps readable names and accessible short tasks at exact time sizes", () => {
    const { container } = setup([["Review checkout", "09:00", "09:50"], ["Quick check", "09:50", "10:20"], ["Short switch", "10:20", "10:35"]]);
    const cards = [...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    expect(parseFloat(cards[0].style.height)).toBeCloseTo(50 / 1440 * 600);
    expect(cards[0].classList.contains("your-day-proportional-card--thin")).toBe(false);
    expect((cards[0].querySelector(".your-day-name") as HTMLElement).style.display).not.toBe("none");
    // The next card starts 12.5px below, so this one keeps its time's height and stays out.
    expect(parseFloat(cards[1].style.height)).toBeCloseTo(12.5);
    expect(cards[1].classList.contains("your-day-proportional-card--thin")).toBe(true);
    expect(cards[2].classList.contains("your-day-proportional-card--thin")).toBe(true);
    expect(cards[1].getAttribute("aria-label")).toContain("Quick check");
    expect(cards[2].getAttribute("aria-label")).toContain("Short switch");
  });
  it("keeps two tasks that share one record, with the same event IDs and open times as Week", () => {
    const { container, week, onOpenMinute } = setup([["Review checkout", "09:00", "09:31"], ["Review figures", "09:31", "11:00"]]);
    const cards = [...container.querySelectorAll<HTMLButtonElement>(".your-day-anchored-card")];
    expect(cards.map(c => c.dataset.eventId)).toEqual(week.map(e => e.id));
    expect(cards).toHaveLength(2);
    expect(screen.getByText("Review checkout")).toBeTruthy();
    expect(screen.getByText("Review figures")).toBeTruthy();
    cards.forEach(card => fireEvent.click(card));
    expect(onOpenMinute.mock.calls.map(call => call[0])).toEqual([540, 571]);
  });
  it("keeps the legacy fallback when there are no stored cards", () => {
    const { container, week } = setup([], false);
    expect([...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")].map(c => c.dataset.eventId)).toEqual(week.map(e => e.id));
    expect(screen.getByText("Code")).toBeTruthy();
  });
  it("uses the chart's time scale for long and short work alike", () => {
    const { container } = setup([["Deep work", "09:00", "10:30"], ["Quick check", "10:30", "11:00"], ["Wrap up", "11:00", "12:00"]], true, [["09:00", "12:00"]]);
    const cards = [...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    // A 600px, 24-hour chart gives one hour 25px: 90 minutes must be 37.5px and 60 minutes 25px.
    expect(parseFloat(cards[0].style.height)).toBeCloseTo(37.5);
    // 30 minutes (12.5px) is under one line: it borrows 3.5px of the next card's top (2026-10-29),
    // whose own top and length stay and whose text starts that much lower.
    expect(parseFloat(cards[1].style.height)).toBe(16);
    expect(parseFloat(cards[2].style.height)).toBeCloseTo(25);
    expect(cards[2].style.getPropertyValue("--lane-content-offset")).toBe("3.5px");
    expect(container.querySelector(".your-day-desc")).toBeNull();
    // Pointing at a card only lights its cells; no native tooltip floats over the chart.
    expect(cards[0].hasAttribute("title")).toBe(false);
  });
  it("does not inflate a time block to fit a longer name", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(64);
    const { container } = setup([["A long work name that needs several lines at this column width", "09:00", "10:00"], ["Quick check", "10:00", "11:00"]]);
    const cards = [...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    expect(cards.map(card => parseFloat(card.style.height))).toEqual([25, 25]);
  });
  it("keeps a repeated name in separate ranges after a real break, as Week does", () => {
    const { container, week, onOpenMinute } = setup([["Release review", "09:00", "11:00"]], true, [["09:00", "09:23"], ["09:39", "11:00"]]);
    const cards = [...container.querySelectorAll<HTMLButtonElement>(".your-day-anchored-card")];
    expect(cards).toHaveLength(2);
    expect(cards.map(c => c.dataset.eventId)).toEqual(week.map(e => e.id));
    expect(screen.getAllByText("Release review")).toHaveLength(2);
    expect(cards.map(c => c.querySelector(".your-day-length")?.textContent)).toEqual(["23m", "1h 21m"]);
    cards.forEach(card => fireEvent.click(card));
    expect(onOpenMinute.mock.calls.map(call => call[0])).toEqual([540, 579]);
  });
  it("shows a short activity on one line where the lane below it is empty, though Week leaves it out", () => {
    // Seven minutes alone at 8 a.m.: 2.9px on this 25px hour, with nothing after it.
    const { container, week } = setup([], false, [["08:05", "08:12"]]);
    expect(week).toEqual([]);
    const card = container.querySelector<HTMLElement>(".your-day-anchored-card")!;
    expect(parseFloat(card.style.top)).toBeCloseTo(485 / 1440 * 600);
    expect(parseFloat(card.style.height)).toBe(16);
    expect(card.classList.contains("your-day-proportional-card--compact")).toBe(true);
    expect(card.classList.contains("your-day-proportional-card--thin")).toBe(false);
    expect(card.querySelector(".your-day-length")?.textContent).toBe("7m");
  });
  it("leaves out a lone activity under 40% of the short bar, however empty the lane", () => {
    for (const range of [["08:05", "08:06"], ["08:05", "08:10"]] as [string, string][]) {
      const { container } = setup([], false, [range]);
      expect(container.querySelector(".your-day-anchored-card")).toBeNull();
      cleanup();
    }
  });
  it("raises a short activity only as far as the empty lane below it allows", () => {
    // A seven-minute piece has 47 minutes (19.6px) before the next record, a second one 25 minutes (10.4px).
    const { container } = setup([], false, [["08:00", "08:07"], ["08:47", "09:30"], ["09:50", "09:57"], ["10:15", "11:00"]]);
    const cards = [...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    expect(cards.map(card => card.dataset.startMinute)).toEqual(["480", "527", "590", "615"]);
    expect(parseFloat(cards[0].style.height)).toBe(16);
    expect(cards[0].classList.contains("your-day-proportional-card--thin")).toBe(false);
    expect(parseFloat(cards[2].style.height)).toBeCloseTo(7 / 1440 * 600);
    expect(cards[2].classList.contains("your-day-proportional-card--thin")).toBe(true);
  });
  it("marks the cards of a window still open as being named, only while names are being made", () => {
    const open = [{ startMs: Date.parse(at("11:00")), endMs: Date.parse(at("11:40")) }];
    const named = setup([], false, [["09:00", "09:40"], ["11:00", "11:40"]], { openWindows: open, namesExpected: true });
    const cards = [...named.container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    expect(cards.map((card) => card.querySelector(".your-day-naming-chip")?.textContent ?? null)).toEqual([null, "Naming"]);
    expect(cards[1].getAttribute("title")).toBe("An AI name is on its way once this stretch ends");
    cleanup();
    const off = setup([], false, [["09:00", "09:40"], ["11:00", "11:40"]], { openWindows: open, namesExpected: false });
    expect(off.container.querySelector(".your-day-naming-chip")).toBeNull();
  });
});
