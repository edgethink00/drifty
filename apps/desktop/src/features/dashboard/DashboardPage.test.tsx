// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivitySegment, FlowBlock } from "@drifty/domain";
import { useProFunnelExposure } from "../../lib/analytics/useProFunnelExposure";
import { DashboardPage } from "./DashboardPage";
import { DashboardAiRecoveryOverlay } from "./DashboardAiRecoveryOverlay";
import type { DashboardAiUnavailableState } from "./dashboardAiUnavailableState";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";
import { ENGLISH_TRANSLATIONS } from "../localization/translations";

// Auto-cleanup isn't unmounting between cases here, so broad role/text queries
// otherwise collide with a prior render's DOM. Tear down explicitly.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

vi.mock("../../lib/analytics/useProFunnelExposure", () => ({ useProFunnelExposure: vi.fn(() => ({ current: null })) }));

vi.mock("../share/useShareCardCommunityModels", () => ({
  useShareCardCommunityModels: () => ({ models: { daily: null, weekly: null }, loading: false }),
}));

const noop = vi.fn();

type DashboardPageFixtureOptions = {
  readonly yourDayRows?: boolean;
  readonly currentMinuteOfDay?: number | null;
  readonly deviceLabelById?: ComponentProps<typeof DashboardPage>["deviceLabelById"];
  readonly deviceTimelineFilter?: ComponentProps<typeof DashboardPage>["deviceTimelineFilter"];
  readonly onDeviceTimelineFilterChange?: ComponentProps<typeof DashboardPage>["onDeviceTimelineFilterChange"];
  readonly funnelEnabled?: boolean;
  readonly funnelResultEnabled?: boolean;
  readonly dashboardSegments?: readonly ActivitySegment[];
  readonly weekRefreshStatus?: "idle" | "loading" | "error";
  readonly browserHistoryBootstrapNotice?: ComponentProps<typeof DashboardPage>["browserHistoryBootstrapNotice"];
  readonly dashboardDateNavigator?: ComponentProps<typeof DashboardPage>["dashboardDateNavigator"];
  readonly dashboardCategoryTotals?: ComponentProps<typeof DashboardPage>["dashboardCategoryTotals"];
  readonly dashboardProductivityTotals?: ComponentProps<typeof DashboardPage>["dashboardProductivityTotals"];
  readonly dashboardReplay?: ComponentProps<typeof DashboardPage>["dashboardReplay"];
  readonly dashPeriod?: ComponentProps<typeof DashboardPage>["dashPeriod"];
  readonly hasTimelineData?: boolean;
  readonly initialDataLoading?: boolean;
  readonly flowBlocks?: FlowBlock[];
  readonly summaryFlowBlocks?: FlowBlock[];
  readonly selectedDay?: string;
  readonly selectedDayLabel?: string;
  readonly statusRunning?: boolean;
  readonly recordingHealth?: ComponentProps<typeof DashboardPage>["recordingHealth"];
  readonly onRecordingRecovery?: ComponentProps<typeof DashboardPage>["onRecordingRecovery"];
  readonly onOpenStorageSettings?: () => void;
  readonly totalSeconds?: number;
  readonly weekRows?: ComponentProps<typeof DashboardPage>["weekRows"];
  readonly language?: DisplayLanguage;
  readonly onPeriodChange?: ComponentProps<typeof DashboardPage>["onPeriodChange"];
  readonly onSelectDay?: ComponentProps<typeof DashboardPage>["onSelectDay"];
  readonly navigationRefreshEnabled?: boolean;
};

function renderDashboardWithNoData(options: DashboardPageFixtureOptions = {}) {
  render(
    <LocalizationTestProvider language={options.language ?? "en"}>
    <DashboardPage
      yourDayRows={options.yourDayRows}      funnelEnabled={options.funnelEnabled}
      funnelResultEnabled={options.funnelResultEnabled}
      deviceLabelById={options.deviceLabelById}
      deviceTimelineFilter={options.deviceTimelineFilter}
      onDeviceTimelineFilterChange={options.onDeviceTimelineFilterChange}
      appIcons={{}}
      appTheme="light"
      billingCheckoutLoadingInterval={null}
      currentMinuteOfDay={options.currentMinuteOfDay === undefined ? 4 * 60 : options.currentMinuteOfDay}
      dashboardAiRecoveryState={null}
      dashboardAppUsage={[]}
      dashboardSegments={options.dashboardSegments ?? []}
      dashboardClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: true }}
      browserHistoryBootstrapNotice={options.browserHistoryBootstrapNotice ?? null}
      dashboardCategoryTotals={options.dashboardCategoryTotals ?? []}
      dashboardDateNavigator={options.dashboardDateNavigator ?? <div aria-label="date navigator" />}
      dashboardProductivityTotals={options.dashboardProductivityTotals ?? []}
      dashboardReplay={options.dashboardReplay === undefined ? { phase: "playing", progress: 0, onRestart: noop, onStop: noop } : options.dashboardReplay}
      dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
      dashPeriod={options.dashPeriod ?? "Today"}
      flowBlocks={options.flowBlocks ?? []}
      summaryFlowBlocks={options.summaryFlowBlocks ?? []}
      focusDriftSection={<div data-testid="focus-drift-placeholder" />}
      dayBreakdownTiles={<div data-testid="day-breakdown-tiles-placeholder" />}
      dayFocusDeltaSeconds={null}
      hasTimelineData={options.hasTimelineData ?? false}
      historyClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
      historySegments={[]}
      initialDataLoading={options.initialDataLoading ?? false}
      selectedDay={options.selectedDay ?? "2026-06-29"}
      selectedDayLabel={options.selectedDayLabel ?? "Mon, Jun 29"}
      startOfDayMinutes={4 * 60}
      statusRunning={options.statusRunning ?? true}
      recordingHealth={options.recordingHealth}
      onRecordingRecovery={options.onRecordingRecovery}
      onOpenStorageSettings={options.onOpenStorageSettings}
      totalSeconds={options.totalSeconds ?? 0}
      weekCalendarEvents={new Map()}
      weekCurrentCalendarDay={null}
      weekCurrentMinuteOfDay={null}
      weekFocusDeltaSeconds={null}
      weekRefreshStatus={options.weekRefreshStatus ?? "idle"}
      weekRows={options.weekRows ?? []}
      onDismissDashboardAiRecovery={noop}
      onOpenDashboardAiSetup={noop}
      onManageCloudBilling={noop}
      onSelectBillingPlan={noop}
      navigationRefreshEnabled={options.navigationRefreshEnabled}
      onPeriodChange={options.onPeriodChange ?? noop}
      onSelectDay={options.onSelectDay ?? noop}
    />
    </LocalizationTestProvider>,
  );
}

describe("DashboardPage date navigator", () => {
  it.each([
    ["loading", true],
    ["loaded", false],
  ] as const)("renders one navigator and invokes its callback once while %s", (_state, initialDataLoading) => {
    const onNavigate = vi.fn();

    renderDashboardWithNoData({
      dashPeriod: "Week",
      initialDataLoading,
      dashboardDateNavigator: <button type="button" onClick={onNavigate}>Previous week</button>,
    });

    const dateNavigatorButtons = screen.getAllByRole("button", { name: "Previous week" });
    expect(dateNavigatorButtons).toHaveLength(1);

    fireEvent.click(dateNavigatorButtons[0]);

    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("keeps the finished Week frame without mock activity while loading", () => {
    renderDashboardWithNoData({
      dashPeriod: "Week",
      initialDataLoading: true,
      dashboardDateNavigator: <button type="button">Previous week</button>,
    });

    const calendar = document.querySelector(".week-v2-calendar");
    expect(calendar?.querySelector(".dashboard-page-head")).toBeTruthy();
    expect(document.querySelectorAll(".dashboard-page-head")).toHaveLength(1);
    expect(calendar?.querySelector(".week-v2-calendar__day-head")).toBeTruthy();
    expect(calendar?.querySelector(".week-v2-calendar__time-rail")).toBeTruthy();
    expect(calendar?.querySelector(".week-v2-calendar__legend .flow-chart-legend")).toBeTruthy();
    expect(calendar?.querySelector(".week-v2-calendar__legend .flow-chart-legend--loading")).toBeTruthy();
    // The color switch is a preference, so it stays live while the week loads.
    expect(calendar?.querySelector(".week-v2-calendar__legend .flow-color-mode-control button")).toBeTruthy();
    expect(calendar?.querySelector(".week-v2-summary")).toBeNull();
    expect(calendar?.querySelector(".week-v2-calendar__event")).toBeNull();
    expect(document.querySelector(".week-v2-side")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Collapse week breakdown" }));
    expect(document.querySelector(".week-v2-grid")?.classList.contains("week-v2-grid--side-open")).toBe(false);
  });
});

describe("DashboardPage calendar view toggle", () => {
  it("shows the selected Day view and requests Week", () => {
    const onPeriodChange = vi.fn();
    renderDashboardWithNoData({ navigationRefreshEnabled: true, onPeriodChange });

    const range = screen.getByRole("group", { name: "Calendar view" });
    expect(within(range).getByRole("button", { name: "Day" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(within(range).getByRole("button", { name: "Week" }));

    expect(onPeriodChange).toHaveBeenCalledWith("Week");
  });

  it("keeps the Day and Week controls available while Day data loads", () => {
    renderDashboardWithNoData({
      initialDataLoading: true,
      navigationRefreshEnabled: true,
      dashboardReplay: null,
      dashboardDateNavigator: <button type="button">Previous day</button>,
    });

    expect(screen.getByRole("group", { name: "Calendar view" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous day" })).toBeTruthy();
  });

  it("switches to Day before applying the selected Week date", () => {
    const calls: string[] = [];
    renderDashboardWithNoData({
      dashPeriod: "Week",
      navigationRefreshEnabled: true,
      dashboardReplay: null,
      onPeriodChange: (period) => calls.push(`period:${period}`),
      onSelectDay: (day) => calls.push(`day:${day}`),
      weekRows: [{
        day: "2026-06-29",
        dayName: "Mon",
        dayNumber: "29",
        focusScore: 0,
        focusSeconds: 0,
        productivitySlices: [],
        slices: [],
        totalSeconds: 0,
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Open Mon, Jun 29 in Day view" }));

    expect(calls).toEqual(["period:Today", "day:2026-06-29"]);
  });
});
describe("DashboardPage demo replay empty data", () => {
  it("keeps blank chart frames visible instead of empty-state copy while replay is active", () => {
    renderDashboardWithNoData();

    expect(document.querySelector('section.flow-chart-card[aria-label="4-minute flow chart"]')).toBeTruthy();
    expect(document.querySelector(".your-day-usage")).toBeTruthy();
    expect(document.querySelectorAll(".your-day-usage li")).toHaveLength(0);
    expect(screen.queryByText("No timeline yet")).toBeNull();
    expect(screen.queryByText("No usage ranking")).toBeNull();
    expect(screen.queryByText("Not enough data yet")).toBeNull();
  });

  it("shows the browser history bootstrap status on an empty Today dashboard", () => {
    renderDashboardWithNoData({
      dashboardReplay: null,
      browserHistoryBootstrapNotice: {
        detail: "Importing from browser history (last 48 hours).",
        statusLabel: "3 visits summarized locally.",
        tone: "working",
      },
    });

    // The flow chart now keeps its real empty frame (legend + time axis) instead
    // of collapsing to an empty-state card; the bootstrap status renders below it.
    expect(document.querySelector('section.flow-chart-card[aria-label="4-minute flow chart"]')).toBeTruthy();
    expect(screen.queryByText("No timeline yet")).toBeNull();
    expect(screen.getByText("Importing from browser history (last 48 hours).")).toBeTruthy();
    expect(screen.getByText("3 visits summarized locally.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /last 48 hours|add estimates/i })).toBeNull();
  });

  it("shows Share for a measured day without a Dev settings gate", () => {
    renderDashboardWithNoData({
      dashboardReplay: null,
      hasTimelineData: true,
      totalSeconds: 3_600,
    });

    const shareButton = screen.getByRole("button", { name: "Share" });
    expect(shareButton).toBeTruthy();
    expect(document.querySelector(".dashboard-page-head__primary")?.contains(shareButton)).toBe(true);
    expect(document.querySelector(".dashboard-page-head__side")?.contains(shareButton)).toBe(false);
  });

  it("keeps Korean share controls localized while the exported card stays English", () => {
    renderDashboardWithNoData({
      dashboardReplay: null,
      language: "ko",
      hasTimelineData: true,
      totalSeconds: 3_600,
      dashboardProductivityTotals: [{ productivity: "focus", totalSeconds: 3_600, segments: 1, ratio: 1 }],
    });

    expect(screen.getByRole("heading", { name: "1시간 집중했습니다" })).toBeTruthy();
    expect(screen.getByLabelText("생산성 분류 차트")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "공유" }));

    expect(screen.getByRole("dialog", { name: "오늘 공유" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "이미지 복사" })).toBeTruthy();
    const preview = screen.getByRole("img", { name: /공유 카드 1/u }) as HTMLImageElement;
    const svg = decodeURIComponent(preview.src.split(",", 2)[1] ?? "");
    expect(svg).toContain("Focus time");
    expect(svg).not.toContain("집중 시간");
    expect(svg).not.toContain("Estimated focus percentile");
  });
});

describe("DashboardPage empty day tracking guidance", () => {
  it.each([true, false])("uses the observed storage problem instead of claiming the running tracker is recording, hours down: %s", (yourDayRows) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 3, 13));
    const open = vi.fn();
    renderDashboardWithNoData({ yourDayRows, dashboardReplay: null, selectedDay: "2026-10-03", statusRunning: true,
      recordingHealth: { kind: "storage", action: null }, onOpenStorageSettings: open });
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("Disk almost full");
    // A state the person must act on carries the amber cue used by the AI status pill.
    expect(note.matches('[data-tone="attention"]') || note.querySelector('[data-tone="attention"]') !== null).toBe(true);
    // Recording still runs while the disk fills, so the current-time line stays solid.
    expect(document.querySelector(".flow-chart-now-marker")?.hasAttribute("data-recording") ?? false).toBe(false);
    expect(screen.queryByText(/Tracker is live/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Privacy & Data" }));
    expect(open).toHaveBeenCalledOnce();
  });

  it("says why today is empty beside Your Day's current-time line, dashed while nothing records", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 3, 13));
    const recover = vi.fn(() => Promise.resolve());
    renderDashboardWithNoData({ yourDayRows: true, dashboardReplay: null, selectedDay: "2026-10-03", currentMinuteOfDay: 13 * 60,
      statusRunning: false, recordingHealth: { kind: "paused", action: "resume" }, onRecordingRecovery: recover });
    const marker = document.querySelector(".flow-chart-now-marker");
    expect(marker?.getAttribute("data-recording")).toBe("off");
    const note = within(marker as HTMLElement).getByRole("note");
    expect(note.textContent).toContain("Recording is paused");
    expect(note.textContent).toContain("Resume, and activity is recorded here from now on.");
    // The bottom line under the chart is gone; one place explains the empty day.
    expect(document.querySelector(".dashboard-flow-empty-note")).toBeNull();
    // The action carries the sidebar card's words.
    fireEvent.click(within(note).getByRole("button", { name: "Resume tracking" }));
    expect(recover).toHaveBeenCalledWith("resume");
  });

  it("keeps the line solid while recording waits for activity, and opens the note upward at the day's end", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 3, 30));
    renderDashboardWithNoData({ yourDayRows: true, dashboardReplay: null, selectedDay: "2026-10-03", currentMinuteOfDay: 3 * 60 + 30,
      recordingHealth: { kind: "idle", action: null } });
    const marker = document.querySelector(".flow-chart-now-marker");
    expect(marker?.hasAttribute("data-recording")).toBe(false);
    expect(within(marker as HTMLElement).getByRole("note").textContent).toContain("Waiting for activity");
    expect(marker?.querySelector(".flow-chart-now-marker__note")?.getAttribute("data-placement")).toBe("above");
    expect(within(marker as HTMLElement).queryByRole("button")).toBeNull();
  });

  it.each(["2026-10-02", "remote-device"])("does not apply this computer's problem to %s", (scope) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 3, 13));
    renderDashboardWithNoData({ dashboardReplay: null, selectedDay: scope === "remote-device" ? "2026-10-03" : scope,
      deviceTimelineFilter: scope === "remote-device" ? scope : "all",
      recordingHealth: { kind: "storage", action: null }, onOpenStorageSettings: vi.fn() });
    expect(screen.getByRole("note").textContent).not.toContain("Disk almost full");
    expect(screen.queryByRole("button", { name: "Privacy & Data" })).toBeNull();
  });

  it.each([true, false])("describes a past empty day independently of tracker running=%s", (statusRunning) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 13));
    renderDashboardWithNoData({ dashboardReplay: null, statusRunning });

    expect(screen.getByRole("note").textContent).toContain("No activity was recorded for Mon, Jun 29.");
    expect(screen.queryByText(/Tracker is live|Tracking is paused/)).toBeNull();
  });

  it("localizes the past empty day without claiming to record it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 13));
    renderDashboardWithNoData({ dashboardReplay: null, language: "ko", selectedDay: "2026-10-02" });

    expect(screen.getByRole("note").textContent).toContain("10월 2일 (금)에 기록된 활동이 없습니다.");
    expect(screen.queryByText(/활동을 기록 중/)).toBeNull();
  });

  it.each([true, false])("keeps current logical-day guidance before the day boundary, running=%s", (statusRunning) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 3, 3));
    renderDashboardWithNoData({
      dashboardReplay: null, statusRunning,
      selectedDay: "2026-10-02", selectedDayLabel: "Fri, Oct 2",
    });

    expect(screen.getByRole("note").textContent).toContain(statusRunning
      ? "Tracker is live for Fri, Oct 2."
      : ENGLISH_TRANSLATIONS["dashboard.today.trackerPausedDetail"]);
    expect(screen.queryByText(/No activity was recorded for/)).toBeNull();
  });
});

describe("DashboardPage day metrics without measured activity", () => {
  it("announces loading in Korean", () => {
    renderDashboardWithNoData({ initialDataLoading: true, language: "ko" });

    expect(screen.getByRole("status", { name: "대시보드 데이터를 불러오는 중" })).toBeTruthy();
  });

  it.each([false, true])("loads Day in the loaded layout with placeholders, hours down: %s", (yourDayRows) => {
    renderDashboardWithNoData({ initialDataLoading: true, dashboardReplay: null, yourDayRows });

    const grid = screen.getByRole("status", { name: "Loading dashboard data" });
    expect(grid.classList.contains("week-v2-grid--day")).toBe(true);
    expect(grid.querySelector(".day-split__main .dashboard-page-head")).toBeTruthy();
    expect(grid.querySelector(".flow-chart-card .flow-chart-legend--loading")).toBeTruthy();
    expect(grid.querySelector(".week-v2-side .flow-compact-split-chart__bar--loading")).toBeTruthy();
    expect(Boolean(grid.querySelector(".week-v2-side .your-day-usage"))).toBe(yourDayRows);
    expect(Boolean(grid.querySelector(".app-usage-panel--loading"))).toBe(!yourDayRows);
    // Nothing claims the day is empty before it has arrived.
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByRole("status", { name: "Breakdown availability" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "No focus recorded" })).toBeNull();
  });

  it("keeps the Korean Today empty state in Korean", () => {
    renderDashboardWithNoData({ dashboardReplay: null, language: "ko" });

    expect(screen.getByRole("heading", { name: "집중 기록 없음" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "세부 분석 상태" }).textContent).toContain("기록된 활동 없음");
    expect(screen.getAllByText("세부 분석").length).toBeGreaterThan(0);
    expect(screen.getByText("카테고리")).toBeTruthy();
    expect(screen.getByText("생산성")).toBeTruthy();
  });

  it("uses an unavailable treatment instead of measured zeros", () => {
    renderDashboardWithNoData({ dashboardReplay: null });

    expect(screen.getByRole("heading", { name: "No focus recorded" })).toBeTruthy();
    expect(screen.getByRole("status", { name: "Breakdown availability" }).textContent).toContain("No activity recorded");
    // The breakdown donut/bar are absent (the flow chart's own Category/Productivity
    // colour toggle renders regardless, so assert on the breakdown panels' labels).
    expect(screen.queryByLabelText("Productivity compact classification")).toBeNull();
    expect(screen.queryByLabelText("Category compact classification")).toBeNull();
  });

  it("preserves a measured zero focus value when other activity exists", () => {
    renderDashboardWithNoData({
      dashboardReplay: null,
      dashboardProductivityTotals: [{ productivity: "drift", totalSeconds: 1_800, segments: 1, ratio: 1 }],
      hasTimelineData: true,
      totalSeconds: 1_800,
    });

    expect(screen.getByRole("heading", { name: "Focused for 0m" })).toBeTruthy();
    expect(screen.queryByText("No activity recorded")).toBeNull();
    // The breakdown Productivity donut is shown (measured activity exists); scope
    // to its panel label so it isn't confused with the flow chart's colour toggle.
    expect(screen.getByLabelText("Productivity compact classification")).toBeTruthy();
  });
});

describe("DashboardPage Focus hours contract", () => {
  it("uses direct classified Focus for the Day header, productivity ring, and share card", () => {
    const classifiedSeconds = (5 * 3600 + 15 * 60) + (14 * 60) + (30 * 60);
    renderDashboardWithNoData({
      dashboardReplay: null,
      language: "ko",
      hasTimelineData: true,
      totalSeconds: classifiedSeconds,
      dashboardProductivityTotals: [
        { productivity: "focus", totalSeconds: 5 * 3600 + 15 * 60, segments: 9, ratio: (5 * 3600 + 15 * 60) / classifiedSeconds },
        { productivity: "neutral", totalSeconds: 14 * 60, segments: 2, ratio: (14 * 60) / classifiedSeconds },
        { productivity: "drift", totalSeconds: 30 * 60, segments: 2, ratio: (30 * 60) / classifiedSeconds },
      ],
    });

    expect(screen.getByRole("heading", { name: "5시간 15분 집중했습니다" })).toBeTruthy();
    const ring = screen.getByLabelText("생산성 분류 차트");
    expect(ring.textContent).toContain("5시간 15분");
    expect(ring.textContent).not.toContain("5시간 29분");
    expect(ring.querySelector(".flow-compact-productivity-circle__center")?.textContent).toBe("88%");

    fireEvent.click(screen.getByRole("button", { name: "공유" }));
    const preview = screen.getByRole("img", { name: /공유 카드 1/u }) as HTMLImageElement;
    const svg = decodeURIComponent(preview.src.split(",", 2)[1] ?? "");
    expect(svg).toContain("5h 15m");
    expect(svg).not.toContain("5h 29m");
  });
});

describe("DashboardPage stable summary detail", () => {
  it("uses canonical summary blocks for Breakdown app details", () => {
    const displayBlock: FlowBlock = {
      id: "display-block",
      day: "2026-06-29",
      hour: 9,
      quarter: 0,
      minuteOfDay: 9 * 60,
      appName: "Display-only app",
      bundleId: "com.example.display",
      category: "workspace",
      productivity: "focus",
      colorKey: "Display-only app",
      durationSeconds: 180,
    };
    const summaryBlock: FlowBlock = {
      ...displayBlock,
      id: "summary-block",
      appName: "Canonical summary app",
      bundleId: "com.example.summary",
      colorKey: "Canonical summary app",
      durationSeconds: 300,
    };

    renderDashboardWithNoData({
      dashboardReplay: null,
      dashboardCategoryTotals: [{ category: "workspace", totalSeconds: 300, segments: 1, ratio: 1 }],
      dashboardProductivityTotals: [{ productivity: "focus", totalSeconds: 300, segments: 1, ratio: 1 }],
      flowBlocks: [displayBlock],
      summaryFlowBlocks: [summaryBlock],
      hasTimelineData: true,
      totalSeconds: 300,
    });

    const categoriesPanel = screen.getByLabelText("Category compact classification");
    const categorySegment = categoriesPanel.querySelector(".flow-compact-split-chart__segment") as HTMLElement;
    fireEvent.mouseEnter(categorySegment, { clientX: 120, clientY: 80 });

    expect(document.querySelector(".compact-classification-hover-card")?.textContent).toContain("Canonical summary app");
    expect(document.querySelector(".compact-classification-hover-card")?.textContent).not.toContain("Display-only app");
  });
});

describe("DashboardPage header concepts", () => {
  it("uses focus duration, not total captured time, as the Day heading", () => {
    renderDashboardWithNoData({
      dashboardProductivityTotals: [{ productivity: "focus", totalSeconds: 3_600, segments: 1, ratio: 1 }],
      hasTimelineData: true,
      totalSeconds: 3_600,
    });

    expect(screen.getByRole("heading", { name: "Focused for 1h" }).textContent).toBe("Focused for1h");
    expect(screen.queryByRole("heading", { name: /Today/ })).toBeNull();
  });

  it("uses the same focus summary sentence for Week", () => {
    renderDashboardWithNoData({
      dashPeriod: "Week",
      dashboardProductivityTotals: [{ productivity: "focus", totalSeconds: 3_600, segments: 1, ratio: 1 }],
      totalSeconds: 7_200,
    });

    expect(screen.getByRole("heading", { name: "Focused for 1h" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /This week/ })).toBeNull();
  });

  it("does not repeat the focus total or period comparison in Breakdown", () => {
    renderDashboardWithNoData({
      dashboardProductivityTotals: [{ productivity: "focus", totalSeconds: 3_600, segments: 1, ratio: 1 }],
      hasTimelineData: true,
      totalSeconds: 3_600,
    });

    expect(screen.queryByLabelText("Focus total today")).toBeNull();
    expect(screen.queryByText("vs yesterday")).toBeNull();
  });
});

describe("DashboardPage share card", () => {
  it("opens the aggregate share card from a measured day", () => {
    renderDashboardWithNoData({
      dashboardReplay: null,
      dashboardProductivityTotals: [{ productivity: "focus", totalSeconds: 3_600, segments: 1, ratio: 1 }],
      hasTimelineData: true,
      totalSeconds: 3_600,
    });

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect(screen.getByRole("dialog", { name: "Share your day" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "LinkedIn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "X" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy image" })).toBeTruthy();
    expect(screen.getByRole("img", { name: /Share card preview/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Previous share card" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Next share card" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "Curve Card" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Weekly Curve" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Productivity" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup", { name: "Card accent color" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Card theme" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next share card" }));
    expect(screen.getByRole("radio", { name: "Rank Statement" }).getAttribute("aria-checked")).toBe("true");
  });

  it("keeps Share hidden during replay and without measured activity", () => {
    renderDashboardWithNoData();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
});


describe("DashboardPage billing recovery overlay", () => {
  const billingState: DashboardAiUnavailableState = {
    variant: "cloud-billing",
    titleKey: "dashboard.aiRecovery.billingTitle",
    bodyKey: "dashboard.aiRecovery.billingBody",
    ctaLabelKey: "dashboard.aiRecovery.fixBilling",
  };

  it("recovers a blocked payment through billing management instead of plan cards", () => {
    const onManageCloudBilling = vi.fn();
    const onSelectBillingPlan = vi.fn();

    render(
      <DashboardPage
        appIcons={{}}
        appTheme="light"
        billingCheckoutLoadingInterval={null}
        currentMinuteOfDay={4 * 60}
        dashboardAiRecoveryState={billingState}
        dashboardAppUsage={[]}
        dashboardSegments={[]}
        dashboardClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
        browserHistoryBootstrapNotice={null}
        dashboardCategoryTotals={[]}
        dashboardDateNavigator={<div aria-label="date navigator" />}
        dashboardProductivityTotals={[]}
        dashboardReplay={null}
        dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
        dashPeriod="Today"
        flowBlocks={[]}
        summaryFlowBlocks={[]}
        focusDriftSection={<div data-testid="focus-drift-placeholder" />}
        dayBreakdownTiles={<div data-testid="day-breakdown-tiles-placeholder" />}
        dayFocusDeltaSeconds={null}
        hasTimelineData={true}
        historyClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
        historySegments={[]}
        initialDataLoading={false}
        selectedDay="2026-06-29"
        selectedDayLabel="Mon, Jun 29"
        startOfDayMinutes={4 * 60}
        statusRunning={true}
        totalSeconds={3600}
        weekCalendarEvents={new Map()}
        weekCurrentCalendarDay={null}
        weekCurrentMinuteOfDay={null}
        weekFocusDeltaSeconds={null}
        weekRefreshStatus="idle"
        weekRows={[]}
        onDismissDashboardAiRecovery={noop}
        onOpenDashboardAiSetup={noop}
        onManageCloudBilling={onManageCloudBilling}
        onSelectBillingPlan={onSelectBillingPlan}
        onPeriodChange={noop}
        onSelectDay={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Fix billing$/i }));
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
    expect(onSelectBillingPlan).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /choose drifty pro plan/i })).toBeNull();
    expect(screen.getByText(/Activity tracking and the timeline keep running on this device/i)).toBeTruthy();
    expect(screen.getByText(ENGLISH_TRANSLATIONS["dashboard.aiRecovery.billingSafeNote"])).toBeTruthy();
  });

  it("keeps the payment-safe note off the no-plan recovery", () => {
    render(
      <LocalizationTestProvider language="en">
        <DashboardAiRecoveryOverlay
          billingCheckoutLoadingInterval={null}
          state={{
            variant: "cloud-plan",
            titleKey: "dashboard.aiRecovery.planTitle",
            bodyKey: "dashboard.aiRecovery.planBody",
            ctaLabelKey: "billing.plan.proCta",
          }}
          onClose={noop}
          onOpenAiSetup={noop}
          onSelectBillingPlan={noop}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("heading", { name: ENGLISH_TRANSLATIONS["billing.proSheet.inactiveTitle"] })).toBeTruthy();
    expect(screen.queryByText(ENGLISH_TRANSLATIONS["dashboard.aiRecovery.billingSafeNote"])).toBeNull();
    expect(screen.queryByText(/Activity tracking and the timeline keep running on this device/i)).toBeNull();
  });
});


describe("DashboardPage funnel integration", () => {
  const classifiedSegment: ActivitySegment = {
    id: "local-result", appName: "Editor", bundleId: "app.editor", source: "nsworkspace", platform: "macos",
    durationSeconds: 60, startedAt: "2026-06-29T05:00:00Z", endedAt: "2026-06-29T05:01:00Z",
    classification: { source: "llm", confidence: 1, category: "workspace", productivity: "focus", aiResult: true },
  };
  const eligible = { funnelEnabled: true, funnelResultEnabled: true, dashboardSegments: [classifiedSegment], dashboardReplay: null };
  it.each(["Today", "Week"] as const)("observes the real %s result", (dashPeriod) => {
    renderDashboardWithNoData({ ...eligible, dashPeriod });
    expect(useProFunnelExposure).toHaveBeenLastCalledWith(true, { step: "classified_result_viewed", dashboard_period: dashPeriod === "Today" ? "day" : "week" });
  });
  it.each([
    { initialDataLoading: true },
    { funnelResultEnabled: false },
    { dashboardSegments: [] },
    { dashPeriod: "Month" as const },
    { dashPeriod: "Week" as const, weekRefreshStatus: "loading" as const },
    { dashPeriod: "Week" as const, weekRefreshStatus: "error" as const },
    { dashboardReplay: { phase: "playing" as const, progress: 0, onRestart: noop, onStop: noop } },
  ])("does not enable result exposure for excluded state %j", (state) => {
    renderDashboardWithNoData({ ...eligible, ...state });
    expect(useProFunnelExposure).toHaveBeenLastCalledWith(true, null);
  });
});


describe("dashboard device selection", () => {
  it.each(["Today", "Week"] as const)("hides the %s device selector without another device", (dashPeriod) => {
    renderDashboardWithNoData({ dashPeriod, deviceLabelById: new Map(), onDeviceTimelineFilterChange: vi.fn() });
    expect(screen.queryByRole("combobox", { name: "Device filter" })).toBeNull();
  });
  it.each(["Today", "Week"] as const)("keeps the selected known device visible on an empty %s without falling back to another device", (dashPeriod) => {
    const onChange = vi.fn();
    const deviceName = "LG Electronics 16Z90Q-G.AA5BK (12th Gen Intel(R) Core(TM) i5-1240P)";
    renderDashboardWithNoData({ dashPeriod, deviceTimelineFilter: "windows-pc", deviceLabelById: new Map([["windows-pc", deviceName]]), onDeviceTimelineFilterChange: onChange });
    const select = screen.getByRole("combobox", { name: "Device filter" });
    expect(select.textContent).toContain(deviceName);
    expect(select.getAttribute("title")).toBe(deviceName);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(select);
    expect(screen.getByRole("option", { name: "All devices" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "This device" })).toBeTruthy();
    const option = screen.getByRole("option", { name: deviceName });
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.getAttribute("title")).toBe(deviceName);
  });

  it.each(["Today", "Week"] as const)("selects devices from the %s header without a separate button strip", (dashPeriod) => {
    const onChange = vi.fn();
    renderDashboardWithNoData({ dashPeriod, deviceLabelById: new Map([["windows-pc", "Windows PC"]]), onDeviceTimelineFilterChange: onChange });
    const select = screen.getByRole("combobox", { name: "Device filter" });
    expect(select.closest(".dashboard-page-head__side")).toBeTruthy();
    // Preserve the existing elapsed-time explanation on the All devices wrapper.
    expect(select.hasAttribute("title")).toBe(false);
    expect(screen.queryByRole("button", { name: "All devices" })).toBeNull();
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Windows PC" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("windows-pc");
  });
});

describe("Your Day time-aligned fit cards", () => {
  it("keeps card starts and durations on the 24-hour chart at 100%", () => {
    window.localStorage.setItem("drifty.timelineZoom.day.v1", "100");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, 200, this.classList.contains("your-day-lane") ? 600 : 16);
    });
    try {
      const at = (time: string) => new Date(`2026-06-29T${time}:00`).toISOString();
      const segments: ActivitySegment[] = [
        ["Review", "09:00", "09:30"],
        ["Deep work", "10:30", "12:00"],
        ["Quick check", "13:00", "13:10"],
        ["Blip", "17:00", "17:01"],
      ].map(([appName, start, end], index) => ({
        id: `fit-card-${index}`, appName, startedAt: at(start), endedAt: at(end),
        durationSeconds: (Date.parse(at(end)) - Date.parse(at(start))) / 1000,
        platform: "macos", source: "nsworkspace",
      }));
      renderDashboardWithNoData({ yourDayRows: true, dashboardSegments: segments, dashboardReplay: null, hasTimelineData: true });
      const cards = [...document.querySelectorAll<HTMLElement>(".your-day-anchored-card")];
      expect(cards).toHaveLength(4);
      // Logical day begins at 04:00: 09:00 is minute 300 on a 600px day.
      expect(cards.map(card => parseFloat(card.style.top))).toEqual([125, 162.5, 225, 325]);
      expect(cards.map(card => card.dataset.durationMinutes)).toEqual(["30", "90", "10", "1"]);
      // 30 and 10 minutes (12.5px and 4.2px) are too short for a line, but the lane below
      // each stays empty for one (25px before Deep work, the rest of the day after Quick
      // check), so both take one 16px line; 90 minutes keeps its 37.5px. A lone minute is
      // under 40% of the short bar, so it keeps its 0.4px and stays out.
      [16, 37.5, 16, 600 / 1440].forEach((height, index) => {
        expect(parseFloat(cards[index].style.height)).toBeCloseTo(height, 10);
      });
      expect(cards.map(card => card.classList.contains("your-day-proportional-card--thin"))).toEqual([false, false, false, true]);
      expect(document.querySelector(".flow-chart-scroll-area")).toBeNull();
    } finally {
      cleanup();
      measure.mockRestore();
      vi.unstubAllGlobals();
      window.localStorage.removeItem("drifty.timelineZoom.day.v1");
    }
  });
});

describe("Your Day opening position", () => {
  // The day begins at 04:00; a 600px view at 150% is 37.5px an hour, 16 hours on screen.
  const blockAt = (minuteOfDay: number): FlowBlock => ({
    id: `open-${minuteOfDay}`, day: "2026-06-29", hour: Math.floor(minuteOfDay / 60), quarter: 0, minuteOfDay,
    appName: "Editor", bundleId: "com.example.editor", category: "workspace", productivity: "focus",
    colorKey: "Editor", durationSeconds: 240,
  });
  it.each([
    ["shows records from 04:00 instead of opening on the current hour", [4 * 60, 5 * 60, 9 * 60], 9 * 60 + 17, 0],
    // 09:00 is 300 minutes in; 30 minutes and 8px (12.8 minutes) of context stay above it.
    ["opens a day that starts at 09:00 just before that record", [9 * 60], 9 * 60 + 17, 160.75],
    // 23:30 is 1170 minutes in; keeping it 30 minutes above the bottom of 960 minutes puts 08:00 on top.
    ["moves a day longer than the screen down to keep now in view", [4 * 60], 23 * 60 + 30, 150],
    ["opens an empty today on the current hour", [], 9 * 60 + 17, 171.375],
  ] as const)("%s", (_name, recordMinutes, currentMinuteOfDay, expectedScrollTop) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 5, 29, Math.floor(currentMinuteOfDay / 60), currentMinuteOfDay % 60));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, 0, 600, this.classList.contains("flow-chart-scroll-area") ? 600 : 16);
    });
    try {
      renderDashboardWithNoData({ yourDayRows: true, dashboardReplay: null, currentMinuteOfDay, flowBlocks: recordMinutes.map(blockAt), hasTimelineData: recordMinutes.length > 0 });
      const scroller = document.querySelector<HTMLElement>(".flow-chart-scroll-area")!;
      expect(scroller.style.getPropertyValue("--flow-scroll-hour-height")).toBe("37.5px");
      expect(scroller.scrollTop).toBeCloseTo(expectedScrollTop);
    } finally {
      cleanup();
      measure.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe("Your Day rows activity hover", () => {
  const block: FlowBlock = {
    id: "hover-block", day: "2026-06-29", hour: 9, quarter: 0, minuteOfDay: 9 * 60,
    appName: "Editor", bundleId: "com.example.editor", category: "workspace", productivity: "focus",
    colorKey: "Editor", durationSeconds: 600,
  };

  it.each([
    ["the hours-down layout highlights the block without a floating card", true],
    ["the isolated legacy layout keeps its floating card", false],
  ] as const)("%s", async (_name, rows) => {
    window.localStorage.setItem("drifty.timelineZoom.day.v1", "100");
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    try {
      renderDashboardWithNoData({ yourDayRows: rows, flowBlocks: [block], dashboardReplay: null, hasTimelineData: true, totalSeconds: 600 });
      const cell = document.querySelector<HTMLButtonElement>('button.flow-cell[data-flow-minute="540"]');
      if (!cell) throw new Error("expected the 9:00 cell");
      fireEvent(cell, new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 80 }));
      if (rows) {
        await waitFor(() => expect(document.querySelector(".flow-hover-group-highlight")).not.toBeNull());
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
      } else {
        await waitFor(() => expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).not.toBeNull());
      }
    } finally {
      cleanup();
      vi.unstubAllGlobals();
      window.localStorage.removeItem("drifty.timelineZoom.day.v1");
    }
  });
});
