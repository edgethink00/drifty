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

function setup(ranges: [string, string, string][], stored = true, activityRanges: [string, string][] = [["09:00", "11:00"]]) {
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
  const result = render(<LocalizationTestProvider language="en"><ActivityLabelsContext.Provider value={{ index, weekCalendarEvents, editingEnabled: false, saveUserLabel: vi.fn(), resetUserLabel: vi.fn() }}>
    <YourDayCardLane day={day} segments={segments} classificationOptions={{ fallbackCandidates: [], includeAiClassifications: true }} startOfDayMinutes={0} colorMode="category" projectBySegmentId={new Map()} appIcons={{}} onOpenMinute={onOpenMinute} />
  </ActivityLabelsContext.Provider></LocalizationTestProvider>);
  return { ...result, week, onOpenMinute };
}

describe("Your Day uses the Week task ranges", () => {
  it("keeps readable names and accessible short tasks at exact time sizes", () => {
    const { container } = setup([["Review checkout", "09:00", "09:50"], ["Quick check", "09:50", "10:20"], ["Short switch", "10:20", "10:35"]]);
    const cards = [...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    expect(parseFloat(cards[0].style.height)).toBeCloseTo(50 / 1440 * 600);
    expect(cards[0].classList.contains("your-day-proportional-card--thin")).toBe(false);
    expect((cards[0].querySelector(".your-day-name") as HTMLElement).style.display).not.toBe("none");
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
    const { container } = setup([["Deep work", "09:00", "10:30"], ["Quick check", "10:30", "11:00"]]);
    const cards = [...container.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
    // A 600px, 24-hour chart gives one hour 25px: 90 minutes must be 37.5px, 30 minutes 12.5px.
    expect(parseFloat(cards[0].style.height)).toBeCloseTo(37.5);
    expect(parseFloat(cards[1].style.height)).toBeCloseTo(12.5);
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
});
