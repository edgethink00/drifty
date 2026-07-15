// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

// Auto-cleanup isn't unmounting between cases here, so broad role/text queries
// otherwise collide with a prior render's DOM. Tear down explicitly.
afterEach(cleanup);

const noop = vi.fn();

type DashboardPageFixtureOptions = {
  readonly browserHistoryBootstrapNotice?: ComponentProps<typeof DashboardPage>["browserHistoryBootstrapNotice"];
  readonly dashboardEffectiveProductivityTotals?: ComponentProps<typeof DashboardPage>["dashboardEffectiveProductivityTotals"];
  readonly dashboardDateNavigator?: ComponentProps<typeof DashboardPage>["dashboardDateNavigator"];
  readonly dashboardProductivityTotals?: ComponentProps<typeof DashboardPage>["dashboardProductivityTotals"];
  readonly dashboardReplay?: ComponentProps<typeof DashboardPage>["dashboardReplay"];
  readonly dashboardTitleDuration?: string;
  readonly dashPeriod?: ComponentProps<typeof DashboardPage>["dashPeriod"];
  readonly hasTimelineData?: boolean;
  readonly initialDataLoading?: boolean;
  readonly totalSeconds?: number;
};

function renderDashboardWithNoData(options: DashboardPageFixtureOptions = {}) {
  render(
    <DashboardPage
      appIcons={{}}
      billingCheckoutLoadingInterval={null}
      classificationActionLoading={false}
      currentMinuteOfDay={4 * 60}
      dashboardAiRecoveryState={null}
      dashboardAiUnavailableState={null}
      dashboardAppUsage={[]}
      browserHistoryBootstrapNotice={options.browserHistoryBootstrapNotice ?? null}
      dashboardCategoryTotals={[]}
      dashboardDateNavigator={options.dashboardDateNavigator ?? <div aria-label="date navigator" />}
      dashboardEffectiveProductivityTotals={options.dashboardEffectiveProductivityTotals ?? []}
      dashboardProductivityTotals={options.dashboardProductivityTotals ?? []}
      dashboardReplay={options.dashboardReplay === undefined ? { phase: "playing", progress: 0, onRestart: noop, onStop: noop } : options.dashboardReplay}
      dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
      dashboardTitle="Today"
      dashboardTitleDuration={options.dashboardTitleDuration ?? "0m"}
      dashPeriod={options.dashPeriod ?? "Today"}
      flowBlocks={[]}
      flowIntervalMinutes={3}
      focusDriftSection={<div data-testid="focus-drift-placeholder" />}
      dayBreakdownTiles={<div data-testid="day-breakdown-tiles-placeholder" />}
      dayFocusDeltaPercent={null}
      hasTimelineData={options.hasTimelineData ?? false}
      historyClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
      historySegments={[]}
      initialDataLoading={options.initialDataLoading ?? false}
      isPreviewSurface={false}
      selectedDay="2026-06-29"
      selectedDayLabel="Mon, Jun 29"
      startOfDayMinutes={4 * 60}
      statusRunning={true}
      totalSeconds={options.totalSeconds ?? 0}
      weekCalendarEvents={new Map()}
      weekCurrentCalendarDay={null}
      weekCurrentMinuteOfDay={null}
      weekFocusDeltaPercent={null}
      weekRefreshStatus="idle"
      weekRows={[]}
      onDashboardAiUnavailableAction={noop}
      onDismissDashboardAiRecovery={noop}
      onFlowIntervalChange={noop}
      onOpenDashboardAiSetup={noop}
      onRetrySelectedDayAiClassification={noop}
      onSelectBillingPlan={noop}
      onSelectDay={noop}
    />,
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
});
describe("DashboardPage demo replay empty data", () => {
  it("keeps blank chart frames visible instead of empty-state copy while replay is active", () => {
    renderDashboardWithNoData();

    expect(screen.getByLabelText("3-minute flow chart")).toBeTruthy();
    expect(screen.getByLabelText("No app usage for today yet")).toBeTruthy();
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
    expect(screen.getByLabelText("3-minute flow chart")).toBeTruthy();
    expect(screen.queryByText("No timeline yet")).toBeNull();
    expect(screen.getByText("Importing from browser history (last 48 hours).")).toBeTruthy();
    expect(screen.getByText("3 visits summarized locally.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /last 48 hours|add estimates/i })).toBeNull();
  });
});

describe("DashboardPage day metrics without measured activity", () => {
  it("uses an unavailable treatment instead of measured zeros", () => {
    renderDashboardWithNoData({ dashboardReplay: null });

    expect(screen.getByRole("heading", { name: "Today —" })).toBeTruthy();
    expect(screen.getByLabelText("Focus total today").textContent).toContain("Focus today—");
    expect(screen.getByRole("status", { name: "Breakdown availability" }).textContent).toContain("No activity data");
    // The breakdown donut/bar are absent (the flow chart's own Category/Productivity
    // colour toggle renders regardless, so assert on the breakdown panels' labels).
    expect(screen.queryByLabelText("Productivity compact classification")).toBeNull();
    expect(screen.queryByLabelText("Category compact classification")).toBeNull();
  });

  it("preserves a measured zero focus value when other activity exists", () => {
    renderDashboardWithNoData({
      dashboardReplay: null,
      dashboardEffectiveProductivityTotals: [{ productivity: "drift", totalSeconds: 1_800, segments: 1, ratio: 1 }],
      dashboardProductivityTotals: [{ productivity: "drift", totalSeconds: 1_800, segments: 1, ratio: 1 }],
      dashboardTitleDuration: "30m",
      hasTimelineData: true,
      totalSeconds: 1_800,
    });

    expect(screen.getByRole("heading", { name: "Today 30m" })).toBeTruthy();
    expect(screen.getByLabelText("Focus total today").textContent).toContain("Focus today0m");
    expect(screen.queryByText("No activity data")).toBeNull();
    // The breakdown Productivity donut is shown (measured activity exists); scope
    // to its panel label so it isn't confused with the flow chart's colour toggle.
    expect(screen.getByLabelText("Productivity compact classification")).toBeTruthy();
  });
});
