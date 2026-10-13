// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityCategory, ActivitySegment, CategoryDuration, ProductivityDuration, ProductivityLabel, ProjectAssignmentRecord, ProjectWindowAssignmentRecord } from "@drifty/domain";
import { WeekDashboard } from "./WeekDashboard";
import type { ActivityInspectorProjectOption, ActivityInspectorSaveHandler } from "./WeekActivityInspector";
import { buildWeekCalendarEvents, type WeekCalendarEvent, type WeekDayRow } from "./weekCalendar";
import { readAppStyles } from "../../test/readStyles";
import type { GoogleCalendarWeekEvent } from "../calendar/googleCalendarWeek";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

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
  readonly projectAssignments?: readonly ProjectAssignmentRecord[];
  readonly projectWindowAssignments?: readonly ProjectWindowAssignmentRecord[];
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
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly sideOpen?: boolean;
  readonly totalSeconds?: number;
  readonly projectOptions?: readonly ActivityInspectorProjectOption[];
  readonly projectBySegmentId?: ReadonlyMap<string, string | null>;
  readonly refreshStatus?: "idle" | "loading" | "error";
  readonly startDay?: string;
  readonly endDay?: string;
  readonly onSaveActivityValues?: ActivityInspectorSaveHandler;
  readonly onSelectDay?: (day: string) => void;
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

describe("WeekDashboard day navigation", () => {
  it("keeps the legacy noninteractive day header out of the accessibility tree", () => {
    const { container } = renderWeekDashboard();

    expect(container.querySelector(".week-v2-calendar__day-head")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("opens past day headers and disables future dates", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2024, 0, 3, 12, 0, 0, 0));
    const onSelectDay = vi.fn();

    try {
      renderWeekDashboard({ onSelectDay });

      expect(document.querySelector(".week-v2-calendar__day-head")?.hasAttribute("aria-hidden")).toBe(false);
      const monday = screen.getByRole("button", { name: "Open Mon, Jan 1 in Day view" });
      const thursday = screen.getByRole("button", { name: "Open Thu, Jan 4 in Day view" });
      fireEvent.click(monday);

      expect(onSelectDay).toHaveBeenCalledWith("2024-01-01");
      expect((thursday as HTMLButtonElement).disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WeekDashboard calendar board", () => {
  it("keeps weekday labels outside the vertical timeline scroller", () => {
    const { container } = renderWeekDashboard();
    const board = container.querySelector(".week-v2-calendar__board");
    const scroller = container.querySelector(".week-v2-calendar__scroller");
    const dayHead = container.querySelector(".week-v2-calendar__day-head");
    const body = container.querySelector(".week-v2-calendar__body");

    expect(board).toBeTruthy();
    expect(scroller).toBeTruthy();
    expect(dayHead).toBeTruthy();
    expect(body).toBeTruthy();
    expect(board?.contains(dayHead)).toBe(true);
    expect(board?.contains(scroller)).toBe(true);
    expect(scroller?.contains(dayHead)).toBe(false);
    expect(scroller?.contains(body)).toBe(true);
  });

  it("splits overflow so only the timeline can rubber-band vertically", () => {
    const boardRules = Array.from(
      styles.matchAll(/\.week-v2-calendar__board\s*\{(?<body>[^}]*)\}/g),
      (match) => match.groups?.body ?? "",
    );
    const scrollerRules = Array.from(
      styles.matchAll(/\.week-v2-calendar__scroller\s*\{(?<body>[^}]*)\}/g),
      (match) => match.groups?.body ?? "",
    );
    const dayHeadRules = Array.from(
      styles.matchAll(/\.week-v2-calendar__day-head\s*\{(?<body>[^}]*)\}/g),
      (match) => match.groups?.body ?? "",
    );

    expect(boardRules.some((rule) => /overflow-x:\s*auto;/.test(rule) && /overflow-y:\s*hidden;/.test(rule))).toBe(true);
    expect(scrollerRules.some((rule) => /overflow-x:\s*hidden;/.test(rule) && /overflow-y:\s*auto;/.test(rule))).toBe(true);
    expect(dayHeadRules.every((rule) => !/position:\s*sticky;/.test(rule))).toBe(true);
    expect(scrollerRules.every((rule) => !/overflow-x:\s*auto;/.test(rule))).toBe(true);
    expect(scrollerRules.some((rule) => /overscroll-behavior-y:\s*auto;/.test(rule))).toBe(true);
    expect(boardRules.every((rule) => !/overscroll-behavior-y:\s*none;/.test(rule))).toBe(true);
  });

  it("lets a narrow block drop its end time, then its start time, whole instead of cutting them", () => {
    const { container } = renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent()]]]),
    });
    const time = container.querySelector(".week-v2-calendar__event-time");
    expect(Array.from(time?.children ?? [], (part) => part.textContent)).toEqual(["9:00 AM", "–10:00 AM"]);

    // The anchor that holds line one must be a full line tall: at zero height,
    // a start time that wrapped off line one still rendered at the top, cut off.
    const anchor = /:is\(\.week-v2-calendar__event-time, \.week-v2-calendar__event-detail\)::before\s*\{(?<body>[^}]*)\}/.exec(styles)?.groups?.body ?? "";
    expect(anchor).toMatch(/flex:\s*0 0 0;/);
    expect(anchor).toMatch(/height:\s*100%;/);
  });

  it("drops a card's time line when a wide window's larger root font size no longer fits it", () => {
    // The default 60 minute block is 38px tall on the 75% axis: enough for the
    // name and time at a 16px root, but not at the 19px root of a 2400px window.
    const calendarEvents = new Map([["2024-01-03", [makeWeekCalendarEvent()]]]);
    const resized = renderWeekDashboard({ calendarEvents });
    expect(resized.container.querySelector(".week-v2-calendar__event-time")).not.toBeNull();

    document.documentElement.style.fontSize = "19px";
    try {
      // Widening the window re-reads the root size at once, without waiting
      // for the resize to settle.
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(resized.container.querySelector(".week-v2-calendar__event-time")).toBeNull();
      resized.unmount();

      // A dashboard opened in an already wide window reads it on mount.
      const { container } = renderWeekDashboard({ calendarEvents });
      const block = container.querySelector(".week-v2-calendar__event");
      expect(block?.classList.contains("week-v2-calendar__event--compact")).toBe(true);
      expect(container.querySelector(".week-v2-calendar__event-time")).toBeNull();
    } finally {
      document.documentElement.style.fontSize = "";
    }
  });

  it("sizes day columns beside the time rail's rem width, which grows with the root font size", () => {
    // Four full-size identity icons need a 113px day column (81px strip + 32px
    // chrome). An 831px calendar body leaves 113px per day beside the 40px rail
    // of a 16px root, but under 112px beside the 47.5px rail of a 19px root.
    const identities = ["a", "b", "c", "d"].map((id, index) => ({
      id,
      label: id,
      appName: id,
      bundleId: null,
      browserName: null,
      siteDomain: null,
      siteTitle: null,
      seconds: 600,
      firstStartMinute: index,
    }));
    const calendarEvents = new Map([["2024-01-03", [makeWeekCalendarEvent({ isGroupedCluster: true, identities, sessionCount: 4 })]]]);
    const measureElement = HTMLElement.prototype.getBoundingClientRect;
    const rects = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("week-v2-calendar__body")) return measureElement.call(this);
      return { x: 0, y: 0, left: 0, top: 0, right: 831, bottom: 0, width: 831, height: 0, toJSON: () => ({}) } as DOMRect;
    });
    const visibleIcons = (container: HTMLElement) => container.querySelectorAll(".week-v2-calendar__identity").length;
    try {
      const resized = renderWeekDashboard({ calendarEvents });
      expect(visibleIcons(resized.container)).toBe(4);

      document.documentElement.style.fontSize = "19px";
      // Crossing a root-size breakpoint re-measures the columns at once, in the
      // same render as the cards' line fits, not after the resize settles.
      act(() => {
        window.dispatchEvent(new Event("resize"));
      });
      expect(visibleIcons(resized.container)).toBe(2);
      expect(resized.container.querySelector(".week-v2-calendar__identity-more")?.textContent).toBe("+2");
      resized.unmount();

      // A dashboard opened in an already wide window measures it on mount.
      const { container } = renderWeekDashboard({ calendarEvents });
      expect(visibleIcons(container)).toBe(2);
      expect(container.querySelector(".week-v2-calendar__identity-more")?.textContent).toBe("+2");
    } finally {
      document.documentElement.style.fontSize = "";
      rects.mockRestore();
    }
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

  it("announces the initial loading frame in Korean", () => {
    render(
      <LocalizationTestProvider language="ko">
        {weekDashboardElement({ initialDataLoading: true })}
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status", { name: "대시보드 데이터를 불러오는 중" })).toBeTruthy();
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
    expect(within(inspector).getByText("Focus")).toBeTruthy();
    expect(within(inspector).getByText(/Mixed values · showing dominant/)).toBeTruthy();
    expect(within(inspector).queryByText("Focus · dominant")).toBeNull();
    expect(within(inspector).queryByText("Workspace · dominant")).toBeNull();
    expect(within(inspector).queryByRole("button", { name: /Change Project/ })).toBeNull();
    expect(inspector.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
    expect(inspector.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(2);
    expect(within(inspector).getByRole("button", { name: /Change Category/ }).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(inspector);
    expect(inspector).not.toBe(within(inspector).getByRole("button", { name: "Close activity inspector" }));
    expect(inspector.style.left).toBe("212px");
    expect(inspector.style.top).toBe("90px");
    expect(inspector.style.width).toBe("304px");
    expect(styles).toMatch(/\.week-activity-inspector\s*\{[^}]*max-width:\s*calc\(100vw - 32px\)/);
    expect(styles).toMatch(/\.week-activity-inspector\s*\{[^}]*max-height:\s*calc\(100vh - 32px\)/);
    expect(styles).toMatch(/\.week-activity-inspector__attribute-trigger\s*\{[^}]*min-height:\s*1\.875rem/);
    expect(styles).toMatch(/\.week-activity-inspector__chip\s*\{[^}]*border-radius:\s*var\(--radius-pill\)/);
    expect(styles).toMatch(/\.week-activity-inspector--preview\s*\{[^}]*pointer-events:\s*none/);
    expect(styles).toMatch(/\.week-activity-inspector__picker-options\s*\{[^}]*overflow-y:\s*hidden/);
    expect(styles).toMatch(/\.week-activity-inspector__picker\[data-scrollable="true"\] \.week-activity-inspector__picker-options\s*\{[^}]*overflow-y:\s*auto/);
  });

  it("summarizes dense activity groups without growing the inspector", () => {
    const denseIdentities = Array.from({ length: 6 }, (_, index) => ({
      id: `dense-${index}`,
      label: ["Visual Studio Code", "Figma", "github.com", "Notion", "Slack", "Linear"][index]!,
      appName: ["Visual Studio Code", "Figma", "Safari", "Notion", "Slack", "Linear"][index]!,
      bundleId: null,
      browserName: null,
      siteDomain: index === 2 ? "github.com" : null,
      siteTitle: null,
      seconds: 600 - index * 60,
      firstStartMinute: index * 10,
    }));
    renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent({
        appName: "Visual Studio Code, Figma, github.com",
        identities: denseIdentities,
        isGroupedCluster: true,
      })]]]),
      activityActionsEnabled: true,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));

    const inspector = screen.getByRole("dialog", { name: "Visual Studio Code + 5 more" });
    expect(inspector.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(4);
    expect(within(inspector).getByText("2 more activities")).toBeTruthy();
    expect(within(inspector).queryByText("Slack")).toBeNull();
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

  it("keeps a historical week edit pinned while its source day reloads, then reanchors to the rebuilt block", async () => {
    let resolveClassification: () => void = () => undefined;
    const classificationPending = new Promise<void>((resolve) => {
      resolveClassification = resolve;
    });
    const onClassifyActivity = vi.fn()
      .mockImplementationOnce(() => classificationPending)
      .mockImplementationOnce(() => classificationPending)
      .mockResolvedValue(undefined);
    const baseOverrides: WeekDashboardRenderOverrides = {
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity,
    };
    const { rerender } = renderWeekDashboard(baseOverrides);

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    fireEvent.click(within(inspector).getByRole("button", { name: /Change Category/ }));
    fireEvent.click(screen.getByRole("option", { name: "Learning" }));
    // The fallback persistence path saves classification groups sequentially;
    // the first pending group is enough to reproduce the cache-clear window.
    await waitFor(() => expect(onClassifyActivity).toHaveBeenCalledTimes(1));

    rerender(weekDashboardElement({
      ...baseOverrides,
      calendarEvents: new Map(),
      segments: [],
      refreshStatus: "loading",
    }));
    expect(screen.getByRole("dialog", { name: "Design review" })).toBe(inspector);
    expect(document.querySelector(".week-v2-calendar__event")).toBeNull();

    const rebuiltEvent = makeWeekCalendarEvent({
      id: "event-rebuilt-after-classification",
      category: "learning",
      segmentIds: weekSegments.map((segment) => segment.id),
      sessionCount: 2,
      isGroupedCluster: true,
      hasMixedProductivity: true,
    });
    const rebuiltSegments = weekSegments.map((segment) => ({
      ...segment,
      classification: { ...segment.classification!, category: "learning" as const },
    }));
    await act(async () => {
      resolveClassification();
      rerender(weekDashboardElement({
        ...baseOverrides,
        calendarEvents: new Map([["2024-01-03", [rebuiltEvent]]]),
        segments: rebuiltSegments,
        refreshStatus: "idle",
      }));
      await classificationPending;
    });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "Design review" })).toBe(inspector);
      expect(screen.getByRole("button", { name: "Undo Category change" })).toBeTruthy();
    });
    const rebuiltAnchor = document.querySelector<HTMLElement>('[data-event-id="event-rebuilt-after-classification"]');
    expect(rebuiltAnchor?.classList.contains("is-inspected")).toBe(true);
    expect(rebuiltAnchor?.querySelector(".week-v2-calendar__event-open")?.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Undo Category change" }));
    await waitFor(() => expect(onClassifyActivity).toHaveBeenCalledTimes(4));
  });

  it.each(["idle", "error"] as const)("closes a pinned week inspector when its source is missing after a %s refresh", async (refreshStatus) => {
    const baseOverrides: WeekDashboardRenderOverrides = {
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
    };
    const { rerender } = renderWeekDashboard(baseOverrides);
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();

    rerender(weekDashboardElement({
      ...baseOverrides,
      calendarEvents: new Map(),
      segments: [],
      refreshStatus,
    }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Design review" })).toBeNull());
  });

  it("closes a pinned week inspector when navigation moves its source day outside a loading week", async () => {
    const baseOverrides: WeekDashboardRenderOverrides = {
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
    };
    const { rerender } = renderWeekDashboard(baseOverrides);
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();

    const nextWeekRows = weekRows.map((row, index) => ({
      ...row,
      day: `2024-01-${String(index + 8).padStart(2, "0")}`,
    }));
    rerender(weekDashboardElement({
      ...baseOverrides,
      calendarEvents: new Map(),
      segments: [],
      rows: nextWeekRows,
      startDay: "2024-01-08",
      endDay: "2024-01-14",
      refreshStatus: "loading",
    }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Design review" })).toBeNull());
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
    expect(screen.getByRole("dialog", { name: "Design review" }).querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(3);
    expect(screen.getByText("Drifty")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Current value: Drifty · dominant/ })).toBeTruthy();
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

  it("shows Project for an unassigned activity once a project exists", () => {
    const onAssignProject = vi.fn().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      projectOptions: [{ id: "drifty", name: "Drifty", color: "#688c35" }],
      onAssignProject,
    });

    fireEvent.mouseMove(document.querySelector(".week-v2-calendar__event")!);

    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");
    expect(within(preview).getByText("No project")).toBeTruthy();
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(preview.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(3);
  });

  it("keeps Project hidden when the only supplied option is the No project sentinel", () => {
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      projectOptions: [{ id: null, name: "No project", color: "#9ca3af" }],
    });

    fireEvent.mouseMove(document.querySelector(".week-v2-calendar__event")!);

    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");
    expect(within(preview).queryByText("Project")).toBeNull();
    expect(preview.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
  });

  it("reveals Project in an open preview when the first real project loads", () => {
    const baseOverrides = {
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onAssignProject: vi.fn().mockResolvedValue(undefined),
    } as const;
    const { rerender } = renderWeekDashboard(baseOverrides);

    fireEvent.mouseMove(document.querySelector(".week-v2-calendar__event")!);
    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");
    expect(within(preview).queryByText("Project")).toBeNull();

    rerender(weekDashboardElement({
      ...baseOverrides,
      projectOptions: [{ id: "drifty", name: "Drifty", color: "#688c35" }],
    }));

    expect(within(preview).getByText("No project")).toBeTruthy();
  });

  it("closes an open Project picker if the final real project disappears", async () => {
    const calendarEvents = new Map([["2024-01-03", [makeWeekCalendarEvent()]]]);
    const baseOverrides = {
      calendarEvents,
      activityActionsEnabled: true,
      onAssignProject: vi.fn().mockResolvedValue(undefined),
    } as const;
    const { rerender } = renderWeekDashboard({
      ...baseOverrides,
      projectOptions: [{ id: "drifty", name: "Drifty", color: "#688c35" }],
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    fireEvent.click(within(inspector).getByRole("button", { name: /Change Project/ }));
    expect(document.querySelector('.week-activity-inspector__picker[data-field="project"]')).toBeTruthy();

    rerender(weekDashboardElement(baseOverrides));

    await waitFor(() => expect(inspector.getAttribute("data-view")).toBe("overview"));
    expect(document.querySelector('.week-activity-inspector__picker[data-field="project"]')).toBeNull();
    expect(within(inspector).queryByRole("button", { name: /Change Project/ })).toBeNull();
  });

  it("keeps Project visible when an existing assignment is absent from the options", () => {
    renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent()]]]),
      activityActionsEnabled: true,
      projectBySegmentId: new Map([["week-focus-code", "archived-project"]]),
      onAssignProject: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.mouseMove(document.querySelector(".week-v2-calendar__event")!);

    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");
    expect(within(preview).getByText("Unavailable project")).toBeTruthy();
    expect(preview.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(3);
  });

  it("keeps Project visible for mixed assignments when the dominant activity is unassigned", () => {
    renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      projectBySegmentId: new Map([
        ["week-focus-code", null],
        ["week-drift-browser", "archived-project"],
      ]),
      onAssignProject: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.mouseMove(document.querySelector(".week-v2-calendar__event")!);

    const preview = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
    if (!preview) throw new Error("expected the anchored activity preview");
    expect(within(preview).getByText("No project")).toBeTruthy();
    expect(preview.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(3);
  });

  it("returns focus to the inspector when removing its final unavailable project assignment", async () => {
    const onAssignProject = vi.fn().mockResolvedValue(undefined);
    renderWeekDashboard({
      calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent()]]]),
      activityActionsEnabled: true,
      projectBySegmentId: new Map([["week-focus-code", "archived-project"]]),
      onAssignProject,
    });

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    fireEvent.click(within(inspector).getByRole("button", { name: /Change Project/ }));
    fireEvent.click(screen.getByRole("option", { name: "No project" }));

    await waitFor(() => expect(onAssignProject).toHaveBeenCalledWith([weekSegments[0]], null));
    await waitFor(() => expect(document.activeElement).toBe(inspector));
    expect(within(inspector).queryByRole("button", { name: /Change Project/ })).toBeNull();
    expect(within(inspector).getByRole("button", { name: "Undo Project change" })).toBeTruthy();
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
    expect(preview?.getAttribute("role")).toBe("tooltip");
    expect(within(preview!).queryByRole("button")).toBeNull();
    expect(within(preview!).queryByRole("textbox")).toBeNull();
    expect(within(preview!).queryByRole("listbox")).toBeNull();
    expect(preview?.querySelector('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')).toBeNull();
    expect(preview?.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
    expect(preview?.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(2);
    const previewHeading = preview?.querySelector(".week-activity-inspector__heading")?.textContent;
    const previewAttributes = preview?.querySelector(".week-activity-inspector__attributes")?.textContent;
    if (!previewHeading || !previewAttributes || !preview?.style.left || !preview.style.top) {
      throw new Error("expected the anchored preview to preserve its populated card layout");
    }
    expect(preview.style.width).toBe("304px");
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect(inspector.querySelector(".week-activity-inspector__heading")?.textContent).toBe(previewHeading);
    expect(inspector.querySelector(".week-activity-inspector__attributes")?.textContent).toBe(previewAttributes);
    expect(inspector.style.left).toBe(preview?.style.left);
    expect(inspector.style.top).toBe(preview?.style.top);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(event.classList.contains("is-inspected")).toBe(true);
    fireEvent.mouseMove(container.querySelector(".week-v2-calendar__body")!, { clientX: 10, clientY: 10 });
    expect(screen.getByRole("dialog", { name: "Design review" })).toBe(inspector);
    expect(event.classList.contains("is-inspected")).toBe(true);
  });

  it("keeps the hover card read-only until the block click opens editing", () => {
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
    expect(preview.getAttribute("role")).toBe("tooltip");
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(within(preview).queryByRole("textbox")).toBeNull();
    expect(preview.querySelector('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')).toBeNull();
    expect(onClassifyActivity).not.toHaveBeenCalled();
    expect(onDeleteActivity).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    const pinnedInspector = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="pinned"][data-view="overview"]');
    expect(pinnedInspector).toBeTruthy();
    const categoryButton = within(pinnedInspector!).getByRole("button", { name: /Change Category/ });
    fireEvent.click(categoryButton);
    expect(document.querySelector('.week-activity-inspector__picker[data-field="category"]')).toBeTruthy();
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

  it.each(["editing", "deleting"] as const)("resets the editing session and destructive target when switching week blocks while %s", async (initialState) => {
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
    let finishDeletion!: () => void;
    const pendingDeletion = new Promise<void>((resolve) => { finishDeletion = resolve; });
    const onDeleteActivity = vi.fn().mockResolvedValue(undefined);
    if (initialState === "deleting") onDeleteActivity.mockImplementationOnce(() => pendingDeletion);
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
    if (initialState === "deleting") {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: /Delete activity/ }));
      fireEvent.click(screen.getByRole("button", { name: "Delete activity…" }));
      expect(onDeleteActivity).toHaveBeenCalledWith([firstSegment.id]);
    }
    fireEvent.click(screen.getByRole("button", { name: /Second review/ }));

    const secondInspector = screen.getByRole("dialog", { name: "Second review" });
    expect(secondInspector.dataset.view).toBe("overview");
    expect(document.querySelector(".week-activity-inspector__picker")).toBeNull();
    if (initialState === "deleting") {
      await act(async () => { finishDeletion(); await pendingDeletion; });
      expect(screen.getByRole("dialog", { name: "Second review" })).toBe(secondInspector);
    }
    fireEvent.click(within(secondInspector).getByRole("button", { name: /Delete activity/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete activity…" }));
    await waitFor(() => expect(onDeleteActivity).toHaveBeenCalledWith([secondSegment.id]));
  });

  it("opens the pinned week inspector from a keyboard-generated block activation", () => {
    const { container } = renderWeekDashboard({
      calendarEvents: groupedEvents,
      activityActionsEnabled: true,
      onClassifyActivity: vi.fn().mockResolvedValue(undefined),
    });
    const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    if (!event) throw new Error("expected a week calendar event");
    act(() => openButton.focus());
    expect(screen.getByRole("tooltip", { name: "Design review" })).toBeTruthy();

    // jsdom does not synthesize button clicks from Enter/Space. detail=0 is
    // the browser event shape produced by keyboard activation.
    fireEvent.click(openButton, { detail: 0 });

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(screen.getByRole("dialog", { name: "Design review" })).toBeTruthy();
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

  it("keeps the week preview and its former bridge out of pointer hit testing", () => {
    const { container } = renderWeekDashboard({ calendarEvents: groupedEvents });
    const event = container.querySelector<HTMLElement>(".week-v2-calendar__event");
    if (!event) throw new Error("expected a week calendar event");

    fireEvent.mouseMove(event);

    const preview = screen.getByRole("tooltip", { name: "Design review" });
    expect(preview.classList.contains("week-activity-inspector--preview")).toBe(true);
    expect(document.querySelector(".week-activity-inspector__hover-bridge")).toBeNull();
    expect(styles).toMatch(/\.week-activity-inspector--preview\s*\{[^}]*pointer-events:\s*none;/);
  });

  it("retargets the read-only week preview to the next block after the settled scan delay", () => {
    vi.useFakeTimers();
    try {
      const sourceEvent = makeWeekCalendarEvent({
        id: "event-scan-source",
        segmentIds: [weekSegments[0]!.id],
      });
      const adjacentEvent = makeWeekCalendarEvent({
        id: "event-scan-adjacent",
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
      const source = container.querySelector<HTMLElement>('[data-event-id="event-scan-source"]');
      const adjacent = container.querySelector<HTMLElement>('[data-event-id="event-scan-adjacent"]');
      if (!source || !adjacent) throw new Error("expected adjacent week events");
      setElementRect(source, 80, 100, 120, 40);
      setElementRect(adjacent, 220, 100, 120, 40);

      fireEvent.mouseMove(source);
      expect(screen.getByRole("tooltip", { name: "Design review" }).style.left).toBe("212px");
      act(() => {
        fireEvent.mouseMove(adjacent);
        vi.advanceTimersByTime(15);
      });
      expect(screen.getByRole("tooltip", { name: "Design review" })).toBeTruthy();
      act(() => vi.advanceTimersByTime(1));
      const adjacentPreview = screen.getByRole("tooltip", { name: "Adjacent review" });
      expect(screen.getAllByRole("tooltip")).toHaveLength(1);
      expect(adjacentPreview.style.left).toBe("352px");
      expect(adjacentPreview.style.top).toBe("100px");
    } finally {
      vi.clearAllTimers();
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
      expect(screen.getByRole("tooltip", { name: "Design review" })).toBeTruthy();

      fireEvent.mouseLeave(document);
      act(() => vi.advanceTimersByTime(300));

      expect(screen.queryByRole("tooltip", { name: "Design review" })).toBeNull();

      fireEvent.mouseMove(event, { clientX: 180, clientY: 140 });
      expect(screen.getByRole("tooltip", { name: "Design review" })).toBeTruthy();
      fireEvent.blur(window);
      expect(screen.queryByRole("tooltip", { name: "Design review" })).toBeNull();
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
    const preview = screen.getByRole("tooltip", { name: "Design review" });
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(openButton.getAttribute("aria-describedby")?.split(/\s+/)).toEqual([
      "existing-week-description",
      preview.id,
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip", { name: "Design review" })).toBeNull();
    expect(openButton.getAttribute("aria-describedby")).toBe("existing-week-description");
  });

  it("keeps focus on the week block when Escape closes its focused preview", async () => {
    renderWeekDashboard({ calendarEvents: groupedEvents });
    const openButton = screen.getByRole("button", { name: /Open activity details/ });
    act(() => {
      openButton.focus();
      fireEvent.focusIn(openButton);
    });
    expect(screen.getByRole("tooltip", { name: "Design review" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("tooltip", { name: "Design review" })).toBeNull();
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
    fireEvent.mouseMove(openButton, { clientX: 100, clientY: 100 });
    const preview = screen.getByRole("tooltip", { name: "Design review" });
    const previewPosition = { left: preview.style.left, top: preview.style.top };
    fireEvent.click(openButton);
    const inspector = screen.getByRole("dialog", { name: "Design review" });
    expect({ left: inspector.style.left, top: inspector.style.top }).toEqual(previewPosition);
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

  it("carries each app's source records through calendar merging into preview and pinned device rows", () => {
    const records: ActivitySegment[] = [
      { id: "local-editor", appName: "Editor", startedAt: "2024-01-03T09:00:00", endedAt: "2024-01-03T09:30:00", durationSeconds: 1800, platform: "macos", source: "manual", classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } },
      { id: "remote-video", appName: "Video", startedAt: "2024-01-03T09:00:00", endedAt: "2024-01-03T09:30:00", durationSeconds: 1800, platform: "windows", deviceId: "pc", source: "manual", classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } },
    ];
    const calendarEvents = buildWeekCalendarEvents(records, "2024-01-01", "2024-01-07", 0, 24);
    const event = calendarEvents.get("2024-01-03")![0];
    expect(event.identities.map((identity) => identity.sourceSegmentIds)).toEqual([["local-editor"], ["remote-video"]]);
    renderWeekDashboard({ calendarEvents, segments: records, deviceLabelById: new Map([["pc", "Windows PC"]]) });
    const trigger = screen.getByRole("button", { name: /Open activity details/ });
    const assertSources = (container: HTMLElement) => {
      const rows = within(container).getAllByRole("listitem");
      expect(rows[0].textContent).toContain("Editor");
      expect(within(rows[0]).getByText("This device")).toBeTruthy();
      expect(within(rows[0]).queryByText("Windows PC")).toBeNull();
      expect(rows[1].textContent).toContain("Video");
      expect(within(rows[1]).getByText("Windows PC")).toBeTruthy();
      expect(within(rows[1]).queryByText("This device")).toBeNull();
    };
    fireEvent.focus(trigger);
    assertSources(screen.getByRole("tooltip"));
    fireEvent.click(trigger);
    assertSources(screen.getByRole("dialog"));
  });

  it("retains the missing-record notice even when the available record is synced", () => {
    const remoteSegment: ActivitySegment = { ...weekSegments[0], id: "remote", deviceId: "pc" };
    renderWeekDashboard({ calendarEvents: new Map([["2024-01-03", [makeWeekCalendarEvent({ segmentIds: ["remote", "missing"] })]]]), segments: [remoteSegment], activityActionsEnabled: true });
    fireEvent.click(screen.getByRole("button", { name: /Open activity details/ }));
    expect(screen.getByRole("dialog").querySelector(".week-activity-inspector__notice")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Delete activity/ }).disabled).toBe(true);
  });

  it("shows synced activity without a warning while keeping preview and detail mutations disabled", () => {
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

    const trigger = screen.getByRole("button", { name: /Open activity details/ });
    fireEvent.focus(trigger);
    const preview = screen.getByRole("tooltip");
    expect(within(preview).queryByText(/must be edited on the device that recorded it/i)).toBeNull();
    expect(preview.querySelector(".week-activity-inspector__notice")).toBeNull();
    fireEvent.click(trigger);
    const inspector = screen.getByRole("dialog");
    expect(within(inspector).queryByText(/must be edited on the device that recorded it/i)).toBeNull();
    expect(inspector.querySelector(".week-activity-inspector__notice")).toBeNull();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Change Category/ }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>("button", { name: /Delete activity/ }).disabled).toBe(true);
  });
});

describe("WeekDashboard time rail", () => {
  it("centres compact time-rail labels on their hour line inside the 2.5rem rail", () => {
    expect(styles).toMatch(/\.week-v2-calendar__time-rail span\s*\{[^}]*right:\s*7px[^}]*transform:\s*translateY\(-50%\)/);
  });

  it("keeps the original 2.5rem grid-column width for the time rail", () => {
    expect(styles).toMatch(/grid-template-columns:\s*2\.5rem repeat\(7/);
  });
});

describe("WeekDashboard breakdown panel", () => {
  it.each([7200, 2700, 900, 3600])("pins %i seconds of Unclassified above classified time without changing the data", (unknownSeconds) => {
    const totalSeconds = unknownSeconds + 5400;
    const slices = ([
      { category: "unknown", totalSeconds: unknownSeconds, ratio: unknownSeconds / totalSeconds },
      { category: "workspace", totalSeconds: 3600, ratio: 3600 / totalSeconds },
      { category: "learning", totalSeconds: 1800, ratio: 1800 / totalSeconds },
    ] satisfies WeekDayRow["slices"]).sort((left, right) => right.totalSeconds - left.totalSeconds);
    const originalSlices = slices.map((slice) => ({ ...slice }));
    const rows = weekRows.map((row, index) => index === 2 ? { ...row, slices, totalSeconds } : row);
    const { container } = renderWeekDashboard({ rows, totalSeconds });
    const bar = container.querySelector<HTMLElement>(".week-v2-side-card--weekly-breakdown .wt-bar")!;
    const segments = Array.from(bar.querySelectorAll<HTMLElement>(".wt-seg"));

    // The real chart uses column-reverse: its last DOM segment is visually on top.
    expect(segments.map((segment) => segment.getAttribute("aria-label")?.split(" · ")[0]))
      .toEqual(["Wed Workspace", "Wed Learning", "Wed Unclassified"]);
    expect(segments.map((segment) => Number.parseFloat(segment.style.height)))
      .toEqual([3600, 1800, unknownSeconds].map((seconds) => Number(((seconds / totalSeconds) * 100).toFixed(2))));
    expect(Number.parseFloat(bar.style.height)).toBe(93);
    expect(slices).toEqual(originalSlices);
  });

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
    expect(within(tiles[0]).getByText("1h 15m avg")).toBeTruthy();
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

  it("keeps the Korean peak-day label compact and wraps metric labels by phrase", () => {
    const { container } = render(
      <LocalizationTestProvider language="ko">
        {weekDashboardElement()}
      </LocalizationTestProvider>,
    );
    const summary = container.querySelector<HTMLElement>('[aria-label="주간 요약 지표"]');
    const peakTile = summary?.querySelector<HTMLElement>(".insight-summary__tile--peak");
    const eyebrowRule = styles.match(
      /\.page--week-dashboard \.week-v2-side__content \.metric-tile \.eyebrow\s*\{(?<body>[^}]*)}/,
    )?.groups?.body ?? "";

    expect(peakTile).toBeTruthy();
    expect(within(peakTile!).getByText("최다 기록일")).toBeTruthy();
    expect(within(peakTile!).queryByText("가장 많이 기록한 날")).toBeNull();
    expect(eyebrowRule).toContain("overflow-wrap: anywhere;");
    expect(eyebrowRule).toContain("word-break: keep-all;");
    expect(eyebrowRule).toContain("text-wrap: balance;");
  });

  it("keeps the Korean productivity breakdown accessible name in Korean", () => {
    render(
      <LocalizationTestProvider language="ko">
        {weekDashboardElement()}
      </LocalizationTestProvider>,
    );

    expect(screen.getByLabelText("생산성 분류 차트")).toBeTruthy();
    expect(screen.queryByLabelText("생산성 compact classification")).toBeNull();
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
        onSelectDay={vi.fn()}
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

describe("WeekDashboard event elevation", () => {
  it("keeps standalone blocks flat like the Day flow cells", () => {
    const { container } = renderWeekDashboard({
      calendarEvents: new Map([
        ["2024-01-03", [makeWeekCalendarEvent({ id: "solo" })]],
      ]),
    });

    const event = container.querySelector(".week-v2-calendar__event");
    expect(event).not.toBeNull();
    expect(event!.className).not.toContain("week-v2-calendar__event--stacked");
    expect(styles).toMatch(/\.week-v2-calendar__event\s*\{[^}]*box-shadow:\s*none;/);
  });

  it("lifts only the blocks that overlap another lane", () => {
    const { container } = renderWeekDashboard({
      calendarEvents: new Map([
        ["2024-01-03", [
          makeWeekCalendarEvent({ id: "lane-0", lane: 0, laneCount: 2 }),
          makeWeekCalendarEvent({ id: "lane-1", lane: 1, laneCount: 2, topMinutes: 9 * 60 + 30 }),
        ]],
      ]),
    });

    const events = [...container.querySelectorAll(".week-v2-calendar__event")];
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.className).toContain("week-v2-calendar__event--stacked");
    }
    expect(styles).toMatch(/\.week-v2-calendar__event--stacked\s*\{[^}]*box-shadow:\s*var\(--shadow\);/);
  });

  it("drops the gloss hairline the Day surface never had", () => {
    expect(styles).not.toMatch(/\.week-v2-calendar__event\s*\{[^}]*inset 0 1px 0 color-mix\(in srgb, white 16%/);
  });
});

describe("WeekDashboard Project mode", () => {
  const projects = [{ id: "build", name: "Build", color: "#123456" }, { id: "research", name: "Research", color: "#abcdef" }];
  const assignments: ProjectAssignmentRecord[] = [{ segmentId: "week-focus-code", projectId: "build", source: "manual" }];

  it("switches calendar colors, legend, donut and weekly bars together, retaining No project", () => {
    const { container } = renderWeekDashboard({ projectOptions: projects, projectAssignments: assignments });
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");
    const legend = container.querySelector('.flow-chart-legend--project')!;
    expect(legend.textContent).toContain("Build");
    expect(legend.textContent).toContain("No project");
    const events = container.querySelectorAll<HTMLElement>('.week-v2-calendar__event');
    expect([...events].map(event => event.style.getPropertyValue('--event-tone'))).toEqual(["#123456", "#9ca3af"]);
    expect(screen.getByLabelText("Projects compact classification")).toBeTruthy();
    const bars = container.querySelectorAll<HTMLElement>('.wt-seg');
    expect([...bars].map(bar => bar.title)).toEqual(["Build · 1h", "No project · 15m"]);
    fireEvent.focus(bars[0]);
    expect(document.querySelector(".compact-classification-hover-card")?.textContent).toContain("Visual Studio Code");
    fireEvent.blur(bars[0]);
    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
    expect(screen.getByLabelText("Productivity compact classification")).toBeTruthy();
    expect(container.querySelector('.flow-chart-legend--project')).toBeNull();
  });

  it("hides unavailable Project and falls back safely when its assignments disappear", () => {
    const { rerender } = renderWeekDashboard({ projectOptions: projects });
    expect(screen.queryByRole("button", { name: "Project" })).toBeNull();
    rerender(weekDashboardElement({ projectOptions: projects, projectAssignments: assignments }));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    rerender(weekDashboardElement({ projectOptions: projects }));
    expect(screen.queryByRole("button", { name: "Project" })).toBeNull();
    expect(screen.getByRole("button", { name: "Category" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps AI windows distinct while source-record details and edits retain full-record scope", async () => {
    const raw = { ...weekSegments[0], endedAt: "2024-01-03T09:06:00", durationSeconds: 360 };
    const onAssignProject = vi.fn().mockResolvedValue(undefined);
    const windows: ProjectWindowAssignmentRecord[] = [
      { windowId: "w1", teamProjectId: null, windowStartedAt: "2024-01-03T09:00:00", windowEndedAt: "2024-01-03T09:03:00", durationSeconds: 180, projectId: "build", source: "ai", segmentOverlaps: [{ segmentId: raw.id, durationSeconds: 180 }] },
      { windowId: "w2", teamProjectId: null, windowStartedAt: "2024-01-03T09:03:00", windowEndedAt: "2024-01-03T09:06:00", durationSeconds: 180, projectId: "research", source: "ai", segmentOverlaps: [{ segmentId: raw.id, durationSeconds: 180 }] },
    ];
    const { container } = renderWeekDashboard({ projectOptions: projects, projectWindowAssignments: windows, projectBySegmentId: new Map([[raw.id, "build"]]), segments: [raw], activityActionsEnabled: true, onAssignProject });
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    const events = container.querySelectorAll<HTMLElement>('.week-v2-calendar__event');
    expect(events).toHaveLength(2);
    fireEvent.click(events[1].querySelector('.week-v2-calendar__event-open')!);
    const inspector = screen.getByRole("dialog");
    expect(within(inspector).getByRole("button", { name: /Current value: Build · dominant/ })).toBeTruthy();
    expect(within(inspector).getByText("Edits and deletion apply to the full activity.")).toBeTruthy();
    fireEvent.click(within(inspector).getByRole("button", { name: /Change Project/ }));
    fireEvent.click(screen.getByRole("option", { name: "Research" }));
    await waitFor(() => expect(onAssignProject).toHaveBeenCalledWith([raw], "research"));
    fireEvent.click(screen.getByRole("button", { name: "Undo Project change" }));
    await waitFor(() => expect(onAssignProject).toHaveBeenNthCalledWith(2, [raw], "build"));
  });
});
