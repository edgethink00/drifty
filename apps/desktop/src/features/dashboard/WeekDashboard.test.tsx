// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CategoryDuration, ProductivityDuration } from "@drifty/domain";
import { WeekDashboard } from "./WeekDashboard";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";

const weekRows: WeekDayRow[] = [
  "2024-01-01",
  "2024-01-02",
  "2024-01-03",
  "2024-01-04",
  "2024-01-05",
  "2024-01-06",
  "2024-01-07",
].map((day, index) => ({
  day,
  dayName: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index] ?? "Mon",
  dayNumber: String(index + 1),
  focusScore: index === 2 ? 80 : 0,
  focusSeconds: index === 2 ? 3600 : 0,
  slices: [],
  totalSeconds: index === 2 ? 4500 : 0,
}));

const productivityEntries: ProductivityDuration[] = [
  { productivity: "focus", ratio: 0.8, segments: 1, totalSeconds: 3600 },
  { productivity: "drift", ratio: 0.2, segments: 1, totalSeconds: 900 },
];

const categoryEntries: CategoryDuration[] = [
  { category: "workspace", ratio: 1, segments: 1, totalSeconds: 4500 },
];

function makeWeekCalendarEvent(overrides: Partial<WeekCalendarEvent> = {}): WeekCalendarEvent {
  return {
    activeDurationMinutes: 60,
    aiClassification: false,
    appName: "Design review",
    category: "workspace",
    classificationSource: "rule",
    detailSummary: "1 captured segment",
    detailTitle: "9:00 AM-10:00 AM\nDesign review",
    durationMinutes: 60,
    endLabel: "10:00 AM",
    hiddenIdentityCount: 0,
    id: "event-1",
    identities: [],
    isGroupedCluster: false,
    isShort: false,
    lane: 0,
    laneCount: 1,
    productivity: "focus",
    sessionCount: 1,
    startLabel: "9:00 AM",
    topMinutes: 9 * 60,
    ...overrides,
  };
}

type WeekDashboardRenderOverrides = {
  readonly axisScalePercent?: number;
  readonly calendarEvents?: Map<string, WeekCalendarEvent[]>;
  readonly currentCalendarDay?: string;
  readonly currentMinuteOfDay?: number;
};

function renderWeekDashboard(overrides: WeekDashboardRenderOverrides = {}) {
  const { axisScalePercent, calendarEvents = new Map(), ...dashboardOverrides } = overrides;

  return render(
    <WeekDashboard
      appIcons={{}}
      axisScalePercent={axisScalePercent}
      calendarEvents={calendarEvents}
      categoryEntries={categoryEntries}
      dateNavigator={<button type="button">Pick week</button>}
      endDay="2024-01-07"
      focusDeltaPercent={null}
      productivityEntries={productivityEntries}
      refreshStatus="idle"
      rows={weekRows}
      startDay="2024-01-01"
      startOfDayMinutes={0}
      totalSeconds={4500}
      {...dashboardOverrides}
    />,
  );
}

describe("WeekDashboard virtual current marker", () => {
  it("renders a current-time marker for the override day and minute", () => {
    const { container } = renderWeekDashboard({
      currentCalendarDay: "2024-01-03",
      currentMinuteOfDay: 9 * 60,
    });

    expect(screen.getByLabelText("Current time 9:00 AM")).toBeTruthy();
    expect(container.querySelector(".week-v2-calendar__now-marker--line")).toBeTruthy();
    expect(container.querySelector<HTMLElement>(".week-v2-calendar__now-marker--line")?.style.getPropertyValue("--week-calendar-now-line-end")).toBe("5");
  });

  it("falls back to real current-week behavior without an override", () => {
    const { container } = renderWeekDashboard();

    expect(screen.queryByLabelText(/Current time/)).toBeNull();
    expect(container.querySelector(".week-v2-calendar__now-marker--line")).toBeNull();
  });
});

describe("WeekDashboard axis scale", () => {
  it("scales the calendar y-axis while keeping event and current-time geometry aligned", () => {
    const calendarEvents = new Map<string, WeekCalendarEvent[]>([
      ["2024-01-03", [makeWeekCalendarEvent()]],
    ]);

    const { container } = renderWeekDashboard({
      axisScalePercent: 80,
      calendarEvents,
      currentCalendarDay: "2024-01-03",
      currentMinuteOfDay: 9 * 60,
    });

    const calendarBody = container.querySelector<HTMLElement>(".week-v2-calendar__body");
    const currentMarker = container.querySelector<HTMLElement>(".week-v2-calendar__now-marker--line");
    const event = screen.getByLabelText("9:00 AM-10:00 AM, Design review");

    expect(calendarBody?.style.height).toBe("1075.2px");
    expect(currentMarker?.style.getPropertyValue("--week-calendar-now-offset")).toBe("403.2px");
    expect(event.style.top).toBe("403.2px");
    expect(event.style.height).toBe("40.8px");
  });
});
