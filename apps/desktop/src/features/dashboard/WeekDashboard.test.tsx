// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment, CategoryDuration, ProductivityDuration } from "@drifty/domain";
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
  slices: index === 2 ? [{ category: "workspace", ratio: 1, totalSeconds: 4500 }] : [],
  productivitySlices: index === 2 ? [
    { productivity: "focus", ratio: 0.8, totalSeconds: 3600 },
    { productivity: "drift", ratio: 0.2, totalSeconds: 900 },
  ] : [],
  totalSeconds: index === 2 ? 4500 : 0,
}));

const productivityEntries: ProductivityDuration[] = [
  { productivity: "focus", ratio: 0.8, segments: 1, totalSeconds: 3600 },
  { productivity: "drift", ratio: 0.2, segments: 1, totalSeconds: 900 },
];

const categoryEntries: CategoryDuration[] = [
  { category: "workspace", ratio: 1, segments: 1, totalSeconds: 4500 },
];

const weekSegments: ActivitySegment[] = [
  {
    id: "week-focus-code",
    startedAt: "2024-01-03T09:00:00",
    endedAt: "2024-01-03T10:00:00",
    durationSeconds: 3600,
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category: "workspace",
      productivity: "focus",
      source: "manual",
      confidence: 1,
    },
  },
  {
    id: "week-drift-browser",
    startedAt: "2024-01-03T10:00:00",
    endedAt: "2024-01-03T10:15:00",
    durationSeconds: 900,
    appName: "Safari",
    browserName: "Safari",
    siteDomain: "news.example",
    platform: "macos",
    source: "nsworkspace",
    classification: {
      category: "workspace",
      productivity: "drift",
      source: "manual",
      confidence: 1,
    },
  },
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
  readonly rows?: WeekDayRow[];
  readonly segments?: ActivitySegment[];
  readonly sideOpen?: boolean;
  readonly totalSeconds?: number;
  readonly onToggleSide?: () => void;
};

function renderWeekDashboard(overrides: WeekDashboardRenderOverrides = {}) {
  const {
    axisScalePercent,
    calendarEvents = new Map(),
    rows = weekRows,
    segments = weekSegments,
    totalSeconds = 4500,
    ...dashboardOverrides
  } = overrides;

  return render(
    <WeekDashboard
      appIcons={{}}
      axisScalePercent={axisScalePercent}
      calendarEvents={calendarEvents}
      segments={segments}
      classificationOptions={{ includeAiClassifications: false }}
      categoryEntries={categoryEntries}
      endDay="2024-01-07"
      focusDeltaPercent={null}
      productivityEntries={productivityEntries}
      refreshStatus="idle"
      rows={rows}
      startDay="2024-01-01"
      startOfDayMinutes={0}
      totalSeconds={totalSeconds}
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
  it("uses the compressed 75 percent calendar y-axis by default", () => {
    const { container } = renderWeekDashboard();

    const dashboard = container.querySelector<HTMLElement>(".week-v2");
    const calendarBody = container.querySelector<HTMLElement>(".week-v2-calendar__body");

    expect(dashboard?.dataset.weekAxisScalePercent).toBe("75");
    expect(calendarBody?.style.height).toBe("1008px");
  });

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

describe("WeekDashboard breakdown panel", () => {
  it("follows the controlled sideOpen prop and reports toggles to the owner", () => {
    const onToggleSide = vi.fn();
    const { container } = renderWeekDashboard({ sideOpen: false, onToggleSide });

    expect(container.querySelector(".week-v2-grid--side-open")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show week breakdown" }));
    expect(onToggleSide).toHaveBeenCalledTimes(1);
    // Controlled: the panel stays closed until the owner flips the prop.
    expect(container.querySelector(".week-v2-grid--side-open")).toBeNull();
  });

  it("stays open by default when rendered standalone", () => {
    const { container } = renderWeekDashboard();

    expect(container.querySelector(".week-v2-grid--side-open")).toBeTruthy();
  });

  it("shows the four weekly summary metrics with the busiest day", () => {
    const { container } = renderWeekDashboard();
    const summary = container.querySelector<HTMLElement>('[aria-label="Week summary metrics"]');

    expect(summary).toBeTruthy();
    const tiles = summary!.querySelectorAll<HTMLElement>(".metric-tile");
    expect(tiles).toHaveLength(4);
    expect(summary!.classList.contains("kpi-row--insights")).toBe(true);
    expect(summary!.classList.contains("insight-summary")).toBe(true);
    expect(summary!.previousElementSibling?.classList.contains("week-v2-side-card--weekly-breakdown")).toBe(true);
    expect(within(tiles[0]).getByText("Tracked")).toBeTruthy();
    expect(within(tiles[0]).getByText("1h 15m")).toBeTruthy();
    expect(within(tiles[0]).getByText("1h 15m avg/day")).toBeTruthy();
    expect(within(tiles[1]).getByText("Sessions")).toBeTruthy();
    expect(within(tiles[1]).getByText("2")).toBeTruthy();
    expect(within(tiles[1]).getByText("38m avg")).toBeTruthy();
    expect(within(tiles[2]).getByText("Peak day")).toBeTruthy();
    expect(within(tiles[2]).getByText("Wed")).toBeTruthy();
    expect(within(tiles[2]).getByText("1h 15m")).toBeTruthy();
    expect(within(tiles[3]).getByText("Apps")).toBeTruthy();
    expect(within(tiles[3]).getByText("2")).toBeTruthy();
    expect(within(tiles[3]).getByText("Visual Studio Code")).toBeTruthy();
  });

  it("keeps empty and tied weekly summary states deterministic", () => {
    const emptyRows = weekRows.map((row) => ({ ...row, totalSeconds: 0 }));
    const { container, rerender } = renderWeekDashboard({ rows: emptyRows, segments: [], totalSeconds: 0 });
    const emptySummary = within(container.querySelector<HTMLElement>('[aria-label="Week summary metrics"]')!);

    expect(emptySummary.getByText("No active days")).toBeTruthy();
    expect(emptySummary.getByText("No sessions")).toBeTruthy();
    expect(emptySummary.getAllByText("No activity")).toHaveLength(2);

    const tiedRows = weekRows.map((row, index) => ({ ...row, totalSeconds: index < 2 ? 600 : 0 }));
    const tiedSegments: ActivitySegment[] = [
      { ...weekSegments[0], id: "zulu", appName: "Zulu", bundleId: "app.zulu", durationSeconds: 600 },
      { ...weekSegments[0], id: "alpha", appName: "Alpha", bundleId: "app.alpha", durationSeconds: 600 },
    ];
    rerender(
      <WeekDashboard
        appIcons={{}}
        calendarEvents={new Map()}
        segments={tiedSegments}
        classificationOptions={{ includeAiClassifications: false }}
        categoryEntries={categoryEntries}
        endDay="2024-01-07"
        focusDeltaPercent={null}
        productivityEntries={productivityEntries}
        refreshStatus="idle"
        rows={tiedRows}
        startDay="2024-01-01"
        startOfDayMinutes={0}
        totalSeconds={1200}
      />,
    );
    const tiedTiles = container.querySelectorAll<HTMLElement>('[aria-label="Week summary metrics"] .metric-tile');

    expect(within(tiedTiles[2]).getByText("Mon")).toBeTruthy();
    expect(within(tiedTiles[3]).getByText("Alpha")).toBeTruthy();
  });

  it("shows the shared detail card for a weekly breakdown segment", () => {
    const { container } = renderWeekDashboard();
    const segment = container.querySelector<HTMLElement>('.week-v2-side-card--weekly-breakdown .wt-seg[aria-label^="Wed Workspace"]');

    expect(segment).toBeTruthy();
    fireEvent.mouseEnter(segment!, { clientX: 160, clientY: 180 });

    const hoverCard = document.body.querySelector<HTMLElement>(".compact-classification-hover-card");
    expect(hoverCard).toBeTruthy();
    expect(within(hoverCard!).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(hoverCard!).getByText("news.example")).toBeTruthy();
    expect(hoverCard?.textContent).toContain("1h 15m");
    expect(hoverCard?.textContent).toContain("100% of tracked time");

    fireEvent.mouseLeave(segment!);
    expect(document.body.querySelector(".compact-classification-hover-card")).toBeNull();
  });

  it("fills the week productivity and category hover cards with app rows", () => {
    const { container } = renderWeekDashboard();
    const productivityArc = container.querySelector<SVGPathElement>(".flow-compact-productivity-circle__segment");

    expect(productivityArc).toBeTruthy();
    fireEvent.mouseEnter(productivityArc!, { clientX: 120, clientY: 140 });
    expect(within(document.body.querySelector<HTMLElement>(".compact-classification-hover-card")!).getByText("Visual Studio Code")).toBeTruthy();
    fireEvent.mouseLeave(productivityArc!);

    const categorySegment = container.querySelector<HTMLElement>(".flow-compact-split-chart__bar .flow-compact-split-chart__segment");
    expect(categorySegment).toBeTruthy();
    fireEvent.mouseEnter(categorySegment!, { clientX: 120, clientY: 140 });
    const categoryHoverCard = document.body.querySelector<HTMLElement>(".compact-classification-hover-card");
    expect(categoryHoverCard).toBeTruthy();
    expect(within(categoryHoverCard!).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(categoryHoverCard!).getByText("news.example")).toBeTruthy();
  });
});
