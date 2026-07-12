// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

const noop = vi.fn();

type DashboardPageFixtureOptions = {
  readonly browserHistoryBootstrapNotice?: ComponentProps<typeof DashboardPage>["browserHistoryBootstrapNotice"];
  readonly dashboardDateNavigator?: ComponentProps<typeof DashboardPage>["dashboardDateNavigator"];
  readonly dashboardReplay?: ComponentProps<typeof DashboardPage>["dashboardReplay"];
  readonly dashPeriod?: ComponentProps<typeof DashboardPage>["dashPeriod"];
  readonly initialDataLoading?: boolean;
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
      dashboardEffectiveProductivityTotals={[]}
      dashboardProductivityTotals={[]}
      dashboardReplay={options.dashboardReplay === undefined ? { phase: "playing", progress: 0, onRestart: noop, onStop: noop } : options.dashboardReplay}
      dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
      dashboardTitle="Today"
      dashboardTitleDuration="0m"
      dashPeriod={options.dashPeriod ?? "Today"}
      flowBlocks={[]}
      flowIntervalMinutes={3}
      focusDriftSection={<div data-testid="focus-drift-placeholder" />}
      dayBreakdownTiles={<div data-testid="day-breakdown-tiles-placeholder" />}
      dayFocusDeltaPercent={null}
      hasTimelineData={false}
      historyClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
      historySegments={[]}
      initialDataLoading={options.initialDataLoading ?? false}
      isPreviewSurface={false}
      selectedDay="2026-06-29"
      selectedDayLabel="Mon, Jun 29"
      startOfDayMinutes={4 * 60}
      statusRunning={true}
      totalSeconds={0}
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

    expect(screen.getByText("Not enough data yet")).toBeTruthy();
    expect(screen.getByText("Importing from browser history (last 48 hours).")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("3 visits summarized locally.");
    expect(screen.queryByRole("button", { name: /last 48 hours|add estimates/i })).toBeNull();
  });
});
