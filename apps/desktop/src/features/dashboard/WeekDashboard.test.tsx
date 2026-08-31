// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityCategory, ActivitySegment, CategoryDuration, ProductivityDuration, ProductivityLabel } from "@drifty/domain";
import { WeekDashboard } from "./WeekDashboard";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";
import { readAppStyles } from "../../test/readStyles";

const styles = readAppStyles();

afterEach(cleanup);

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
    hasMixedCategory: false,
    hasMixedProductivity: false,
    id: "event-1",
    segmentIds: ["week-focus-code"],
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
  readonly activityActionsEnabled?: boolean;
  readonly axisScalePercent?: number;
  readonly calendarEvents?: Map<string, WeekCalendarEvent[]>;
  readonly categoryEntries?: CategoryDuration[];
  readonly currentCalendarDay?: string;
  readonly currentMinuteOfDay?: number;
  readonly productivityEntries?: ProductivityDuration[];
  readonly rows?: WeekDayRow[];
  readonly segments?: ActivitySegment[];
  readonly sideOpen?: boolean;
  readonly totalSeconds?: number;
  readonly onToggleSide?: () => void;
  readonly onClassifyActivity?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onDeleteActivity?: (segmentIds: readonly string[]) => Promise<void>;
};

function renderWeekDashboard(overrides: WeekDashboardRenderOverrides = {}) {
  const {
    axisScalePercent,
    calendarEvents = new Map(),
    categoryEntries: overrideCategoryEntries = categoryEntries,
    productivityEntries: overrideProductivityEntries = productivityEntries,
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
      categoryEntries={overrideCategoryEntries}
      endDay="2024-01-07"
      productivityEntries={overrideProductivityEntries}
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
    const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");

    expect(calendarBody?.style.height).toBe("1075.2px");
    expect(currentMarker?.style.getPropertyValue("--week-calendar-now-offset")).toBe("403.2px");
    expect(event?.style.top).toBe("403.2px");
    expect(event?.style.height).toBe("40.8px");
  });
});

describe("WeekDashboard activity inspector", () => {
  const groupedEvent = makeWeekCalendarEvent({
    id: "event-grouped",
    segmentIds: ["week-focus-code", "week-drift-browser"],
    sessionCount: 2,
    isGroupedCluster: true,
    hasMixedCategory: true,
    hasMixedProductivity: false,
  });
  const groupedEvents = new Map<string, WeekCalendarEvent[]>([["2024-01-03", [groupedEvent]]]);

  it("opens the inspector from the block body and reports the exact source-record scope", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }), { clientX: 180, clientY: 120 });

    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(within(inspector).getByText("2 captured records")).toBeTruthy();
    expect(within(inspector).queryByText("Only these 2 records")).toBeNull();
    expect(within(inspector).getByText("Focus (dominant)")).toBeTruthy();
    expect(within(inspector).queryByText("Workspace (dominant)")).toBeNull();
    expect(document.activeElement).toBe(inspector);
    expect(inspector).not.toBe(within(inspector).getByRole("button", { name: "Close activity inspector" }));
    expect(inspector.style.left).toBe("196px");
    expect(inspector.style.top).toBe("136px");
    expect(styles).toMatch(/:root\[data-theme="dark"\] \.week-activity-inspector\s*\{[^}]*--week-inspector-choice-bg:/);
    expect(styles).toMatch(/:root\[data-theme="dark"\] \.week-activity-inspector\s*\{[^}]*background:\s*color-mix/);
  });

  it("keeps compact grouped icon-only blocks body-clickable without a more-actions control", () => {
    const iconOnlyEvent = makeWeekCalendarEvent({
      activeDurationMinutes: 14,
      durationMinutes: 14,
      isGroupedCluster: true,
      isShort: true,
      sessionCount: 2,
      identities: [{
        id: "visual-studio-code",
        label: "Visual Studio Code",
        appName: "Visual Studio Code",
        bundleId: "com.microsoft.VSCode",
        browserName: null,
        siteDomain: null,
        siteTitle: null,
        seconds: 14 * 60,
        firstStartMinute: 0,
      }],
    });
    const { container } = renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [iconOnlyEvent]]]),
      activityActionsEnabled: true,
    });

    expect(screen.queryByRole("button", { name: "More actions for Design review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
  });

  it("applies a changed category and productivity only to the selected source records", async () => {
    const onClassifyActivity = vi.fn().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Edit classification/ }));
    expect(screen.queryByText(/Future activity will not be changed/i)).toBeNull();
    expect(styles).toMatch(/\.week-activity-inspector__choice-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/);
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Workspace" }));
    fireEvent.click(screen.getByRole("radio", { name: "Learning" }));
    fireEvent.click(screen.getByRole("radio", { name: "Neutral" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onClassifyActivity).toHaveBeenCalledWith(weekSegments, "learning", "neutral");
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens from right-click and confirms full-record deletion before calling the mutation", async () => {
    const onDeleteActivity = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onDeleteActivity,
    });

    fireEvent.contextMenu(container.querySelector<HTMLElement>(".week-v2-calendar__event")!);
    fireEvent.click(screen.getByRole("button", { name: /Delete activity/ }));

    expect(screen.getByText("Deleting 2 captured records cannot be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 records" }));

    await waitFor(() => {
      expect(onDeleteActivity).toHaveBeenCalledWith(["week-focus-code", "week-drift-browser"]);
    });
  });

  it("hides the week hover card while the inspector is open", () => {
    const { container } = renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const event = container.querySelector(".week-v2-calendar__event")!;
    fireEvent.mouseMove(event, { clientX: 180, clientY: 120 });
    expect(document.querySelector(".week-calendar-hover-card")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
    expect(document.querySelector(".week-calendar-hover-card")).toBeNull();
  });

  it("closes the inspector when the week calendar scrolls", () => {
    const { container } = renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }), { clientX: 180, clientY: 120 });
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
    fireEvent.scroll(container.querySelector(".week-v2-calendar__scroller")!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the inspector open when scrolling inside it", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }), { clientX: 180, clientY: 120 });
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    fireEvent.scroll(inspector);
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
  });

  it("anchors keyboard opens to the block instead of the viewport origin", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    const eventBlock = openButton.closest(".week-v2-calendar__event");
    if (!(eventBlock instanceof HTMLElement)) throw new Error("expected a week calendar event");
    eventBlock.getBoundingClientRect = () => ({ x: 80, y: 90, width: 120, height: 40, top: 90, left: 80, bottom: 130, right: 200, toJSON: () => undefined });
    fireEvent.click(openButton, { clientX: 0, clientY: 0 });
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(inspector.style.left).toBe("112px");
    expect(inspector.style.top).toBe("122px");
  });

  it("closes on Escape and restores focus to the control that opened it", async () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    fireEvent.click(openButton);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(openButton);
    });
  });

  it("keeps a compact block body-clickable without placing an ellipsis inside it", () => {
    const compactEvent = makeWeekCalendarEvent({
      activeDurationMinutes: 5,
      durationMinutes: 5,
      isShort: true,
    });
    renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [compactEvent]]]),
      activityActionsEnabled: true,
    });

    expect(screen.queryByRole("button", { name: "More actions for Design review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
  });

  it("allows inspection but disables mutation for synced activity", () => {
    const remoteSegment: ActivitySegment = {
      ...weekSegments[0],
      id: "remote-segment",
      deviceId: "remote-mac",
    };
    const remoteEvent = makeWeekCalendarEvent({ segmentIds: [remoteSegment.id] });
    renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [remoteEvent]]]),
      segments: [remoteSegment],
      activityActionsEnabled: true,
      onClassifyActivity: vi.fn().mockResolvedValue(undefined),
      onDeleteActivity: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));

    expect(screen.getByText(/must be edited on the Mac that recorded it/i)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Edit classification/ }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Delete activity/ }).disabled).toBe(true);
  });
});

describe("WeekDashboard time rail", () => {
  it("positions time-rail labels with a tighter right inset so two-digit hours fit in the 2.5rem rail", () => {
    expect(styles).toMatch(/\.week-v2-calendar__time-rail span\s*\{[^}]*right:\s*4px/);
  });

  it("keeps the original 2.5rem grid-column width for the time rail", () => {
    expect(styles).toMatch(/grid-template-columns:\s*2\.5rem repeat\(7/);
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

describe("WeekDashboard legend", () => {
  it("gives the Week legend a container so the shared Unclassified fold breakpoint applies", () => {
    expect(styles).toMatch(/\.page--week-dashboard \.week-v2-calendar__legend\s*\{[^}]*container-type:\s*inline-size;/);
  });

  it("uses the Day legend grouping and keeps Unclassified separate from Neutral", () => {
    const categoryEntriesWithUnknown: CategoryDuration[] = [
      ...categoryEntries,
      { category: "unknown", ratio: 0.1, segments: 1, totalSeconds: 300 },
    ];
    renderWeekDashboard({ categoryEntries: categoryEntriesWithUnknown });

    const legend = screen.getByLabelText("Week category tones");
    const neutralGroup = legend.querySelector('.flow-chart-legend__categories[aria-label="Neutral categories"]');

    expect(neutralGroup?.querySelectorAll(".flow-chart-legend__dot")).toHaveLength(3);
    expect(neutralGroup?.querySelector(".flow-chart-legend__dot--unknown")).toBeNull();
    expect(within(legend).getByLabelText("Unclassified")).toBeTruthy();
  });

  it("shows weekly app detail when hovering category, productivity, and Unclassified legend entries", () => {
    const unclassifiedSegment: ActivitySegment = {
      ...weekSegments[0],
      id: "week-unclassified-terminal",
      appName: "Terminal",
      bundleId: "com.apple.Terminal",
      durationSeconds: 300,
      startedAt: "2024-01-03T11:00:00",
      endedAt: "2024-01-03T11:05:00",
      classification: {
        category: "unknown",
        productivity: "neutral",
        source: "unknown",
        confidence: 0,
      },
    };
    renderWeekDashboard({
      categoryEntries: [
        ...categoryEntries,
        { category: "unknown", ratio: 0.06, segments: 1, totalSeconds: 300 },
      ],
      segments: [...weekSegments, unclassifiedSegment],
    });

    const categoryLegend = screen.getByLabelText("Week category tones");
    fireEvent.mouseEnter(within(categoryLegend).getByText("Focus"), { clientX: 120, clientY: 80 });
    expect(within(document.querySelector<HTMLElement>(".category-hover-card")!).getByText("Visual Studio Code")).toBeTruthy();
    fireEvent.mouseLeave(within(categoryLegend).getByText("Focus"));

    fireEvent.mouseEnter(within(categoryLegend).getByLabelText("Unclassified"), { clientX: 120, clientY: 80 });
    expect(within(document.querySelector<HTMLElement>(".category-hover-card")!).getByText("Terminal")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
    expect(document.querySelector(".category-hover-card")).toBeNull();

    const productivityLegend = screen.getByLabelText("Week productivity tones");
    fireEvent.mouseEnter(within(productivityLegend).getByText("Drift"), { clientX: 120, clientY: 80 });
    expect(within(document.querySelector<HTMLElement>(".category-hover-card")!).getByText("news.example")).toBeTruthy();
  });
});
