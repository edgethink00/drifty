// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityCategory, ActivitySegment, CategoryDuration, ProductivityDuration, ProductivityLabel } from "@drifty/domain";
import { WeekDashboard } from "./WeekDashboard";
import type { ActivityInspectorProjectOption, ActivityInspectorSaveHandler } from "./WeekActivityInspector";
import type { WeekCalendarEvent, WeekDayRow } from "./weekCalendar";
import { readAppStyles } from "../../test/readStyles";
import type { GoogleCalendarWeekEvent } from "../calendar/googleCalendarWeek";

const styles = readAppStyles();

afterEach(cleanup);

function setElementRect(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  });
}

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
  readonly googleCalendarEvents?: Map<string, GoogleCalendarWeekEvent[]>;
  readonly googleCalendarStatus?: "disabled" | "disconnected" | "loading" | "ready" | "error";
  readonly initialDataLoading?: boolean;
  readonly categoryEntries?: CategoryDuration[];
  readonly currentCalendarDay?: string;
  readonly currentMinuteOfDay?: number;
  readonly productivityEntries?: ProductivityDuration[];
  readonly rows?: WeekDayRow[];
  readonly segments?: ActivitySegment[];
  readonly sideOpen?: boolean;
  readonly totalSeconds?: number;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly projectBySegmentId?: ReadonlyMap<string, string | null>;
  readonly onSaveActivityValues?: ActivityInspectorSaveHandler;
  readonly onToggleSide?: () => void;
  readonly onAssignProject?: (
    segments: readonly ActivitySegment[],
    projectId: string | null,
  ) => Promise<void>;
  readonly onClassifyActivity?: (
    segments: readonly ActivitySegment[],
    category: ActivityCategory,
    productivity: ProductivityLabel,
  ) => Promise<void>;
  readonly onDeleteActivity?: (segmentIds: readonly string[]) => Promise<void>;
};

function weekDashboardElement(overrides: WeekDashboardRenderOverrides = {}) {
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

  return (
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
    />
  );
}

function renderWeekDashboard(overrides: WeekDashboardRenderOverrides = {}) {
  return render(weekDashboardElement(overrides));
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
  it("renders planned Calendar time as an outlined layer separate from captured activity", () => {
    const googleCalendarEvents = new Map<string, GoogleCalendarWeekEvent[]>([[
      "2024-01-03",
      [{
        id: "meeting:2024-01-03",
        sourceId: "meeting",
        day: "2024-01-03",
        title: "Planning",
        startMinute: 9 * 60,
        durationMinutes: 60,
        allDay: false,
      }],
    ]]);

    const { container } = renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent()]]]),
      googleCalendarEvents,
      googleCalendarStatus: "ready",
    });

    expect(screen.getByText("Google Calendar · planned")).toBeTruthy();
    expect(screen.getByRole("note", { name: /Planned event: Planning, 9:00 AM–10:00 AM/ })).toBeTruthy();
    expect(container.querySelectorAll(".week-v2-calendar__scheduled-event")).toHaveLength(1);
    expect(container.querySelectorAll(".week-v2-calendar__event")).toHaveLength(1);
    expect(styles).toMatch(/\.week-v2-calendar__scheduled-event\s*\{[^}]*border:\s*1px dashed/);
  });

  it("keeps both captured and planned events out of the initial loading frame", () => {
    const googleCalendarEvents = new Map<string, GoogleCalendarWeekEvent[]>([[
      "2024-01-03",
      [{
        id: "meeting:2024-01-03",
        sourceId: "meeting",
        day: "2024-01-03",
        title: "Planning",
        startMinute: 9 * 60,
        durationMinutes: 60,
        allDay: false,
      }],
    ]]);

    const { container } = renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent()]]]),
      googleCalendarEvents,
      googleCalendarStatus: "ready",
      initialDataLoading: true,
    });

    expect(screen.getByRole("status", { name: "Loading dashboard data" })).toBeTruthy();
    expect(screen.queryByText("Google Calendar · planned")).toBeNull();
    expect(container.querySelector(".week-v2-calendar__scheduled-event")).toBeNull();
    expect(container.querySelector(".week-v2-calendar__event")).toBeNull();
  });

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
    identities: [
      {
        id: "visual-studio-code",
        label: "Visual Studio Code",
        appName: "Visual Studio Code",
        bundleId: "com.microsoft.VSCode",
        browserName: null,
        siteDomain: null,
        siteTitle: null,
        seconds: 3600,
        firstStartMinute: 0,
      },
      {
        id: "news.example",
        label: "news.example",
        appName: "Safari",
        bundleId: null,
        browserName: "Safari",
        siteDomain: "news.example",
        siteTitle: null,
        seconds: 900,
        firstStartMinute: 60,
      },
    ],
  });
  const groupedEvents = new Map<string, WeekCalendarEvent[]>([["2024-01-03", [groupedEvent]]]);

  it("opens the inspector from the block body without a redundant scope banner", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });

    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    const eventBlock = openButton.closest(".week-v2-calendar__event");
    if (!eventBlock) throw new Error("expected a week calendar event");
    setElementRect(eventBlock, 80, 90, 120, 40);
    fireEvent.click(openButton, { clientX: 180, clientY: 120 });

    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(within(inspector).queryByText("Shared attributes for 2 activities")).toBeNull();
    expect(within(inspector).queryByText("Selection saves immediately")).toBeNull();
    expect(within(inspector).getByText("Focus · dominant")).toBeTruthy();
    expect(within(inspector).queryByText("Workspace · dominant")).toBeNull();
    expect(inspector.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(3);
    expect(inspector.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(2);
    expect(within(inspector).getByRole("button", { name: /Change Category/ }).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(inspector);
    expect(inspector).not.toBe(within(inspector).getByRole("button", { name: "Close activity inspector" }));
    expect(inspector.style.left).toBe("212px");
    expect(inspector.style.top).toBe("90px");
    expect(styles).toMatch(/\.week-activity-inspector\s*\{[^}]*max-width:\s*calc\(100vw - 32px\)/);
    expect(styles).toMatch(/\.week-activity-inspector\s*\{[^}]*max-height:\s*calc\(100vh - 32px\)/);
    expect(styles).toMatch(/\.week-activity-inspector__attribute-trigger\s*\{[^}]*min-height:\s*33px/);
    expect(styles).toMatch(/\.week-activity-inspector__chip\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(styles).toMatch(/\.week-activity-inspector__hover-bridge\s*\{[^}]*pointer-events:\s*auto/);
    expect(styles).toMatch(/\.week-activity-inspector__picker-options\s*\{[^}]*overflow-y:\s*hidden/);
    expect(styles).toMatch(/\.week-activity-inspector__picker\[data-scrollable="true"\] \.week-activity-inspector__picker-options\s*\{[^}]*overflow-y:\s*auto/);
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

  it("saves direct category and productivity choices immediately and keeps one-step undo", async () => {
    const onClassifyActivity = vi.fn().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    expect(document.querySelector('.week-activity-inspector__picker[data-field="category"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Learning" }));

    await waitFor(() => {
      expect(onClassifyActivity).toHaveBeenNthCalledWith(1, [weekSegments[0]], "learning", "focus");
      expect(onClassifyActivity).toHaveBeenNthCalledWith(2, [weekSegments[1]], "learning", "drift");
    });
    expect(screen.getByRole("status").textContent).toContain("Category · Learning · Saved for 2 activities");

    fireEvent.click(screen.getByRole("button", { name: /Change Productivity/ }));
    expect(screen.getByRole("status")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Neutral" }));
    await waitFor(() => {
      expect(onClassifyActivity).toHaveBeenNthCalledWith(3, weekSegments, "learning", "neutral");
    });
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Productivity · Neutral · Saved for 2 activities");

    fireEvent.click(screen.getByRole("button", { name: "Undo Productivity change" }));
    await waitFor(() => {
      expect(onClassifyActivity).toHaveBeenNthCalledWith(4, [weekSegments[0]], "learning", "focus");
      expect(onClassifyActivity).toHaveBeenNthCalledWith(5, [weekSegments[1]], "learning", "drift");
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("persists mixed classifications and undo as one atomic batch per action", async () => {
    const onSaveActivityValues = vi.fn<ActivityInspectorSaveHandler>().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onSaveActivityValues,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    fireEvent.click(screen.getByRole("option", { name: "Learning" }));

    await waitFor(() => expect(onSaveActivityValues).toHaveBeenCalledTimes(1));
    expect(onSaveActivityValues).toHaveBeenNthCalledWith(1, "category", [
      expect.objectContaining({ segment: weekSegments[0], category: "learning", productivity: "focus" }),
      expect.objectContaining({ segment: weekSegments[1], category: "learning", productivity: "drift" }),
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Undo Category change" }));
    await waitFor(() => expect(onSaveActivityValues).toHaveBeenCalledTimes(2));
    expect(onSaveActivityValues).toHaveBeenNthCalledWith(2, "category", [
      expect.objectContaining({ segment: weekSegments[0], category: "workspace", productivity: "focus" }),
      expect.objectContaining({ segment: weekSegments[1], category: "workspace", productivity: "drift" }),
    ]);
  });

  it("keeps the original edit and undo scope when one week group becomes two blocks", async () => {
    const onSaveActivityValues = vi.fn<ActivityInspectorSaveHandler>().mockResolvedValue(undefined);
    const baseOverrides: WeekDashboardRenderOverrides = {
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onSaveActivityValues,
    };
    const { rerender } = renderWeekDashboard(baseOverrides);
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    fireEvent.click(screen.getByRole("option", { name: "Learning" }));
    await waitFor(() => expect(onSaveActivityValues).toHaveBeenCalledTimes(1));

    const splitEvents = new Map<string, WeekCalendarEvent[]>([["2024-01-03", [
      makeWeekCalendarEvent({
        id: "event-focus-split",
        segmentIds: [weekSegments[0]!.id],
        category: "learning",
        productivity: "focus",
      }),
      makeWeekCalendarEvent({
        id: "event-drift-split",
        segmentIds: [weekSegments[1]!.id],
        category: "learning",
        productivity: "drift",
        startLabel: "10:00 AM",
        endLabel: "10:15 AM",
        topMinutes: 10 * 60,
        activeDurationMinutes: 15,
        durationMinutes: 15,
      }),
    ]]] as const);
    rerender(weekDashboardElement({ ...baseOverrides, calendarEvents: splitEvents }));

    expect(await screen.findByText("Timeline updated · Now shown as 2 blocks. Undo still applies to this selection.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
    expect(document.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Undo Category change" }));
    await waitFor(() => expect(onSaveActivityValues).toHaveBeenCalledTimes(2));

    const adjacentSegment: ActivitySegment = {
      ...weekSegments[1]!,
      id: "week-adjacent-browser",
      startedAt: "2024-01-03T10:15:00",
      endedAt: "2024-01-03T10:30:00",
    };
    const mergedEvents = new Map<string, WeekCalendarEvent[]>([["2024-01-03", [
      makeWeekCalendarEvent({
        id: "event-merged-with-adjacent",
        segmentIds: [...weekSegments.map((segment) => segment.id), adjacentSegment.id],
        sessionCount: 3,
        isGroupedCluster: true,
        hasMixedProductivity: true,
      }),
    ]]] as const);
    rerender(weekDashboardElement({
      ...baseOverrides,
      calendarEvents: mergedEvents,
      segments: [...weekSegments, adjacentSegment],
    }));
    await waitFor(() => expect(screen.queryByText(/Now shown as 2 blocks/)).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /Change Productivity/ }));
    fireEvent.click(screen.getByRole("option", { name: "Neutral" }));
    await waitFor(() => expect(onSaveActivityValues).toHaveBeenCalledTimes(3));
    expect(onSaveActivityValues).toHaveBeenNthCalledWith(3, "productivity", [
      expect.objectContaining({ segment: weekSegments[0], productivity: "neutral" }),
      expect.objectContaining({ segment: weekSegments[1], productivity: "neutral" }),
    ]);
  });

  it("lets a mixed group adopt its displayed dominant value without rewriting already-matching records", async () => {
    const onClassifyActivity = vi.fn().mockResolvedValue(undefined);
    const mixedCategorySegments: ActivitySegment[] = [
      weekSegments[0]!,
      {
        ...weekSegments[1]!,
        classification: {
          category: "learning",
          productivity: "drift",
          source: "manual",
          confidence: 1,
        },
      },
    ];
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      segments: mixedCategorySegments,
      activityActionsEnabled: true,
      onClassifyActivity,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    fireEvent.click(screen.getByRole("option", { name: "Workspace" }));

    await waitFor(() => {
      expect(onClassifyActivity).toHaveBeenCalledTimes(1);
      expect(onClassifyActivity).toHaveBeenCalledWith([mixedCategorySegments[1]], "workspace", "drift");
    });
  });

  it("treats Project like the other two direct selectors", async () => {
    const onAssignProject = vi.fn().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      projectOptions: [
        { id: "drifty", name: "Drifty", color: "#688c35" },
        { id: "research", name: "Research", color: "#2f8b83" },
      ],
      projectBySegmentId: new Map([
        ["week-focus-code", "drifty"],
        ["week-drift-browser", "research"],
      ]),
      onAssignProject,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByText("Drifty · dominant")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Change Project/ }));
    fireEvent.click(screen.getByRole("option", { name: "Research" }));

    await waitFor(() => expect(onAssignProject).toHaveBeenCalledWith([weekSegments[0]], "research"));
    expect(screen.getByRole("status").textContent).toContain("Project · Research · Saved for 2 activities");

    fireEvent.click(screen.getByRole("button", { name: "Undo Project change" }));
    await waitFor(() => {
      expect(onAssignProject).toHaveBeenNthCalledWith(2, [weekSegments[0]], "drifty");
      expect(onAssignProject).toHaveBeenCalledTimes(2);
    });
  });

  it("opens from right-click and confirms full-record deletion before calling the mutation", async () => {
    const onDeleteActivity = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onDeleteActivity,
    });

    fireEvent.contextMenu(container.querySelector<HTMLElement>(".week-v2-calendar__event")!);
    fireEvent.click(screen.getByRole("button", { name: /Delete 2 activities/ }));

    expect(screen.getByText("Deleting 2 activities cannot be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 activities…" }));

    await waitFor(() => {
      expect(onDeleteActivity).toHaveBeenCalledWith(["week-focus-code", "week-drift-browser"]);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /Open activity details/ }));
    });
  });

  it("pins the same week card surface and keeps the block selected", () => {
    const { container } = renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const event = container.querySelector(".week-v2-calendar__event")!;
    fireEvent.mouseMove(event, { clientX: 180, clientY: 120 });
    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    expect(preview).toBeTruthy();
    expect(within(preview!).getByRole("button", { name: /Change Category/ })).toBeTruthy();
    expect(within(preview!).getByRole("button", { name: /Delete 2 activities/ })).toBeTruthy();
    expect(preview?.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(3);
    expect(preview?.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(2);
    const previewText = preview?.textContent;
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(inspector.textContent).toBe(previewText);
    expect(inspector.style.left).toBe(preview?.style.left);
    expect(inspector.style.top).toBe(preview?.style.top);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(event.classList.contains("is-inspected")).toBe(true);
  });

  it("pins the hover card directly into the selected action", () => {
    const onClassifyActivity = vi.fn().mockResolvedValue(undefined);
    const onDeleteActivity = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity,
      onDeleteActivity,
    });
    const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
    if (!event) throw new Error("expected a week calendar event");
    fireEvent.mouseMove(event);
    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");

    fireEvent.click(within(preview).getByRole("button", { name: /Change Category/ }));

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    const pinnedInspector = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="pinned"][data-view="category"]');
    expect(pinnedInspector).toBeTruthy();
    expect(document.querySelector('.week-activity-inspector__picker[data-field="category"]')).toBeTruthy();
    expect(within(pinnedInspector!).getByRole("button", { name: /Change Category/ }).getAttribute("aria-expanded")).toBe("true");
    expect(event.classList.contains("is-inspected")).toBe(true);
  });

  it("measures the full picker option height while its initial cap is zero", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("week-activity-inspector__picker")) return 0;
      return this.style.maxHeight === "none" ? 224 : 42;
    });

    try {
      renderWeekDashboard({
        calendarEvents: groupedEvents,
        activityActionsEnabled: true,
        onClassifyActivity: vi.fn().mockResolvedValue(undefined),
      });
      fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
      const categoryTrigger = screen.getByRole("button", { name: /Change Category/ });
      setElementRect(categoryTrigger, 120, 100, 240, 33);
      fireEvent.click(categoryTrigger);

      const picker = document.querySelector<HTMLElement>('.week-activity-inspector__picker[data-field="category"]');
      if (!picker) throw new Error("expected the category picker");
      expect(picker.dataset.positioned).toBe("true");
      expect(picker.style.maxHeight).toBe("224px");
      expect(within(picker).getAllByRole("option").length).toBeGreaterThan(1);
    } finally {
      scrollHeightSpy.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("caps and scrolls a picker when neither side has its full natural height", () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 320 });
    const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("week-activity-inspector__picker") && this.style.maxHeight === "none" ? 500 : 0;
    });

    try {
      renderWeekDashboard({
        calendarEvents: groupedEvents,
        activityActionsEnabled: true,
        onClassifyActivity: vi.fn().mockResolvedValue(undefined),
      });
      fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
      const categoryTrigger = screen.getByRole("button", { name: /Change Category/ });
      setElementRect(categoryTrigger, 120, 140, 240, 33);
      fireEvent.click(categoryTrigger);

      const picker = document.querySelector<HTMLElement>('.week-activity-inspector__picker[data-field="category"]');
      if (!picker) throw new Error("expected the category picker");
      expect(picker.dataset.placement).toBe("down");
      expect(picker.dataset.scrollable).toBe("true");
      expect(picker.style.maxHeight).toBe("131px");
      expect(picker.style.top).toBe("177px");
    } finally {
      scrollHeightSpy.mockRestore();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("resets the editing session and destructive target when switching week blocks", async () => {
    const firstSegment = { ...weekSegments[0]!, id: "week-first" };
    const secondSegment = {
      ...weekSegments[1]!,
      id: "week-second",
      startedAt: "2024-01-03T11:00:00",
      endedAt: "2024-01-03T11:15:00",
    };
    const firstEvent = makeWeekCalendarEvent({
      id: "week-first-event",
      appName: "First review",
      detailTitle: "9:00 AM-10:00 AM\nFirst review",
      segmentIds: [firstSegment.id],
    });
    const secondEvent = makeWeekCalendarEvent({
      id: "week-second-event",
      appName: "Second review",
      detailTitle: "11:00 AM-11:15 AM\nSecond review",
      segmentIds: [secondSegment.id],
      startLabel: "11:00 AM",
      endLabel: "11:15 AM",
      topMinutes: 11 * 60,
    });
    const onDeleteActivity = vi.fn().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [firstEvent, secondEvent]]]),
      segments: [firstSegment, secondSegment],
      activityActionsEnabled: true,
      onClassifyActivity: vi.fn().mockResolvedValue(undefined),
      onDeleteActivity,
    });

    fireEvent.click(screen.getByRole("button", { name: /First review/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    expect(document.querySelector('.week-activity-inspector__picker[data-field="category"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Second review/ }));

    const secondInspector = screen.getByRole("dialog", { name: "Second review" });
    expect(secondInspector.dataset.view).toBe("overview");
    expect(document.querySelector(".week-activity-inspector__picker")).toBeNull();
    fireEvent.click(within(secondInspector).getByRole("button", { name: /Delete activity/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete activity…" }));
    await waitFor(() => expect(onDeleteActivity).toHaveBeenCalledWith([secondSegment.id]));
  });

  it("keeps a keyboard-opened week preview alive while focus enters an action", () => {
    const { container } = renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity: vi.fn().mockResolvedValue(undefined),
    });
    const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    if (!event) throw new Error("expected a week calendar event");
    fireEvent.focus(openButton);
    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");
    const productivityButton = within(preview).getByRole("button", { name: /Change Productivity/ });

    fireEvent.focusOut(openButton, { relatedTarget: productivityButton });
    fireEvent.focus(productivityButton);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();

    fireEvent.click(productivityButton);

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(document.querySelector('.week-activity-inspector[data-mode="pinned"][data-view="productivity"]')).toBeTruthy();
    expect(document.querySelector('.week-activity-inspector__picker[data-field="productivity"]')).toBeTruthy();
    expect(event.classList.contains("is-inspected")).toBe(true);
  });

  it("restores the block stacking level when hover and focus become pinned", async () => {
    const { container } = renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    if (!event) throw new Error("expected a week calendar event");
    expect(event.style.zIndex).toBe("3");

    fireEvent.mouseMove(event);
    fireEvent.focus(openButton);
    expect(event.style.zIndex).toBe("29");
    fireEvent.click(openButton);

    await waitFor(() => expect(event.style.zIndex).toBe("3"));
  });

  it("keeps the preview open while the pointer crosses into the card", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWeekDashboard({ calendarEvents: groupedEvents });
      const body = container.querySelector<HTMLElement>(".week-v2-calendar__body");
      const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
      if (!body || !event) throw new Error("expected the week calendar surface");
      fireEvent.mouseMove(event);
      const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
      if (!preview) throw new Error("expected the anchored activity preview");

      fireEvent.mouseLeave(body);
      act(() => vi.advanceTimersByTime(180));
      expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();

      fireEvent.pointerEnter(preview);
      act(() => vi.advanceTimersByTime(180));
      expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();

      fireEvent.pointerLeave(preview);
      act(() => vi.advanceTimersByTime(300));
      expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("bridges the full height of a tall week block so an adjacent block cannot steal the card crossing", () => {
    const tallEvent = makeWeekCalendarEvent({
      id: "event-tall-source",
      segmentIds: [weekSegments[0]!.id],
    });
    const adjacentEvent = makeWeekCalendarEvent({
      id: "event-adjacent-right",
      appName: "Adjacent review",
      segmentIds: [weekSegments[1]!.id],
    });
    const { container } = renderWeekDashboard({
      calendarEvents: new Map([
        ["2024-01-03", [tallEvent]],
        ["2024-01-04", [adjacentEvent]],
      ]),
    });
    const source = container.querySelector<HTMLElement>('[data-event-id="event-tall-source"]');
    if (!source) throw new Error("expected the tall source event");
    setElementRect(source, 100, 100, 100, 400);

    fireEvent.mouseMove(source);

    const bridge = document.querySelector<HTMLElement>(".week-activity-inspector__hover-bridge");
    if (!bridge) throw new Error("expected the anchored preview bridge");
    expect(bridge.style.left).toBe("200px");
    expect(bridge.style.top).toBe("100px");
    expect(bridge.style.width).toBe("12px");
    expect(bridge.style.height).toBe("400px");
  });

  it("keeps the current week preview while crossing an adjacent block into the card", () => {
    vi.useFakeTimers();
    try {
      const sourceEvent = makeWeekCalendarEvent({
        id: "event-crossing-source",
        segmentIds: [weekSegments[0]!.id],
      });
      const adjacentEvent = makeWeekCalendarEvent({
        id: "event-crossing-adjacent",
        appName: "Adjacent review",
        detailTitle: "10:00 AM-10:15 AM\nAdjacent review",
        segmentIds: [weekSegments[1]!.id],
      });
      const { container } = renderWeekDashboard({
        calendarEvents: new Map([
          ["2024-01-03", [sourceEvent]],
          ["2024-01-04", [adjacentEvent]],
        ]),
      });
      const source = container.querySelector<HTMLElement>('[data-event-id="event-crossing-source"]');
      const adjacent = container.querySelector<HTMLElement>('[data-event-id="event-crossing-adjacent"]');
      if (!source || !adjacent) throw new Error("expected adjacent week events");

      fireEvent.mouseMove(source);
      const preview = screen.getByRole("dialog", { name: "Design review" });

      fireEvent.mouseMove(adjacent);
      expect(screen.getByRole("dialog", { name: "Design review" })).toBe(preview);

      fireEvent.pointerEnter(preview);
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole("dialog", { name: "Design review" })).toBe(preview);

      fireEvent.pointerLeave(preview);
      fireEvent.mouseMove(adjacent);
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByRole("dialog", { name: "Adjacent review" })).toBeTruthy();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("keeps the current preview when a fast pointer move lands inside the newly mounted card", () => {
    vi.useFakeTimers();
    try {
      const sourceEvent = makeWeekCalendarEvent({
        id: "event-fast-source",
        segmentIds: [weekSegments[0]!.id],
      });
      const adjacentEvent = makeWeekCalendarEvent({
        id: "event-fast-adjacent",
        appName: "Adjacent review",
        detailTitle: "10:00 AM-10:15 AM\nAdjacent review",
        segmentIds: [weekSegments[1]!.id],
      });
      const { container } = renderWeekDashboard({
        calendarEvents: new Map([
          ["2024-01-03", [sourceEvent]],
          ["2024-01-04", [adjacentEvent]],
        ]),
      });
      const source = container.querySelector<HTMLElement>('[data-event-id="event-fast-source"]');
      const adjacent = container.querySelector<HTMLElement>('[data-event-id="event-fast-adjacent"]');
      if (!source || !adjacent) throw new Error("expected adjacent week events");

      fireEvent.mouseMove(source, { clientX: 180, clientY: 140 });
      const preview = screen.getByRole("dialog", { name: "Design review" });
      setElementRect(preview, 220, 100, 332, 320);

      // Model a queued calendar mousemove that lands where the portaled card
      // is rendered before the browser can dispatch pointerenter to that card.
      fireEvent.mouseMove(adjacent, { clientX: 260, clientY: 140 });
      act(() => vi.advanceTimersByTime(300));
      expect(screen.getByRole("dialog", { name: "Design review" })).toBe(preview);

      fireEvent.mouseMove(adjacent, { clientX: 600, clientY: 140 });
      act(() => vi.advanceTimersByTime(20));
      expect(screen.getByRole("dialog", { name: "Adjacent review" })).toBeTruthy();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("dismisses a pointer preview when the pointer leaves the browser document or its window loses focus", () => {
    vi.useFakeTimers();
    try {
      const { container } = renderWeekDashboard({ calendarEvents: groupedEvents });
      const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
      if (!event) throw new Error("expected a week calendar event");

      fireEvent.mouseMove(event, { clientX: 180, clientY: 140 });
      const preview = screen.getByRole("dialog", { name: "Design review" });
      setElementRect(preview, 220, 100, 332, 320);
      fireEvent.mouseMove(preview, { clientX: 260, clientY: 140 });

      fireEvent.mouseLeave(document);
      act(() => vi.advanceTimersByTime(300));

      expect(screen.queryByRole("dialog", { name: "Design review" })).toBeNull();

      fireEvent.mouseMove(event, { clientX: 180, clientY: 140 });
      expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
      fireEvent.blur(window);
      expect(screen.queryByRole("dialog", { name: "Design review" })).toBeNull();
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("shows the same preview on keyboard focus and dismisses it with Escape", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    openButton.setAttribute("aria-describedby", "existing-week-description");
    fireEvent.focus(openButton);
    const preview = screen.getByRole("dialog", { name: "Design review" });
    expect(openButton.getAttribute("aria-describedby")?.split(/\s+/)).toEqual([
      "existing-week-description",
      preview.getAttribute("aria-describedby"),
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Design review" })).toBeNull();
    expect(openButton.getAttribute("aria-describedby")).toBe("existing-week-description");
  });

  it("restores focus to the week block when closing a focused preview", async () => {
    renderWeekDashboard({ calendarEvents: groupedEvents });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    act(() => {
      openButton.focus();
      fireEvent.focusIn(openButton);
    });
    const preview = screen.getByRole("dialog", { name: "Design review" });
    const closeButton = within(preview).getByRole("button", { name: "Close activity inspector" });
    act(() => closeButton.focus());

    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Design review" })).toBeNull();
      expect(document.activeElement).toBe(openButton);
    });
  });

  it("does not pull focus back to the block after an outside pointer dismissal", async () => {
    render(<button type="button">Outside control</button>);
    renderWeekDashboard({ calendarEvents: groupedEvents });
    const outsideControl = screen.getByRole("button", { name: "Outside control" });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(document.querySelector('.week-activity-inspector[data-mode="pinned"]')).toBeTruthy();

    fireEvent.pointerDown(outsideControl);
    act(() => outsideControl.focus());

    await waitFor(() => {
      expect(document.querySelector('.week-activity-inspector[data-mode="pinned"]')).toBeNull();
      expect(document.activeElement).toBe(outsideControl);
    });
  });

  it("rolls back a rejected direct save and keeps the inspector retryable", async () => {
    const onClassifyActivity = vi.fn().mockRejectedValue(new Error("Could not save classification"));
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity,
    });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    fireEvent.click(screen.getByRole("option", { name: "Learning" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Could not save classification");
    expect(screen.getByRole("button", { name: /Change Category/ }).textContent).toContain("Workspace");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Change Category/ }).disabled).toBe(false);
  });

  it("keeps delete confirmation open and retryable after a rejected deletion", async () => {
    const onDeleteActivity = vi.fn().mockRejectedValue(new Error("Could not delete activity"));
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onDeleteActivity,
    });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    fireEvent.click(screen.getByRole("button", { name: /Delete 2 activities/ }));
    const confirmButton = screen.getByRole<HTMLButtonElement>("button", { name: "Delete 2 activities…" });
    fireEvent.click(confirmButton);

    expect((await screen.findByRole("alert")).textContent).toContain("Could not delete activity");
    expect(screen.getByRole("dialog", { name: "Delete activity?" })).toBeTruthy();
    expect(confirmButton.disabled).toBe(false);
  });

  it("keeps the inspector attached to its block when the week calendar scrolls", () => {
    const { container } = renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    const eventBlock = openButton.closest(".week-v2-calendar__event");
    if (!eventBlock) throw new Error("expected a week calendar event");
    setElementRect(eventBlock, 80, 90, 120, 40);
    fireEvent.click(openButton);
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(inspector.style.left).toBe("212px");
    expect(inspector.style.top).toBe("90px");
    setElementRect(eventBlock, 60, 70, 120, 40);
    fireEvent.scroll(container.querySelector(".week-v2-calendar__scroller")!);
    expect(inspector.style.left).toBe("192px");
    expect(inspector.style.top).toBe("70px");
  });

  it("keeps the inspector open when scrolling inside it", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }), { clientX: 180, clientY: 120 });
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    fireEvent.scroll(inspector);
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
  });

  it("closes the pinned inspector after its anchor scrolls out of view", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    const eventBlock = openButton.closest(".week-v2-calendar__event");
    if (!eventBlock) throw new Error("expected a week calendar event");
    setElementRect(eventBlock, 80, 90, 120, 40);
    fireEvent.click(openButton);
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
    setElementRect(eventBlock, 80, -100, 120, 40);
    fireEvent.scroll(window);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("anchors keyboard opens to the block instead of the viewport origin", () => {
    renderWeekDashboard({ calendarEvents: groupedEvents, activityActionsEnabled: true });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    const eventBlock = openButton.closest(".week-v2-calendar__event");
    if (!(eventBlock instanceof HTMLElement)) throw new Error("expected a week calendar event");
    setElementRect(eventBlock, 80, 90, 120, 40);
    fireEvent.click(openButton, { clientX: 0, clientY: 0 });
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(inspector.style.left).toBe("212px");
    expect(inspector.style.top).toBe("90px");
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
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Change Category/ }).disabled).toBe(true);
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
