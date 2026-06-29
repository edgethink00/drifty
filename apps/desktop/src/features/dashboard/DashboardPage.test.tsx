// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";

const noop = vi.fn();

function renderReplayDashboardWithNoData() {
  render(
    <DashboardPage
      appIcons={{}}
      billingCheckoutLoadingInterval={null}
      classificationActionLoading={false}
      currentMinuteOfDay={4 * 60}
      dashboardAiRecoveryState={null}
      dashboardAiUnavailableState={null}
      dashboardAppUsage={[]}
      dashboardCategoryTotals={[]}
      dashboardDateNavigator={<div aria-label="date navigator" />}
      dashboardEffectiveProductivityTotals={[]}
      dashboardProductivityTotals={[]}
      dashboardReplay={{ phase: "playing", progress: 0, onRestart: noop, onStop: noop }}
      dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
      dashboardTitle="Today"
      dashboardTitleDuration="0m"
      dashPeriod="Today"
      flowBlocks={[]}
      flowIntervalMinutes={3}
      focusDriftSection={<div data-testid="focus-drift-placeholder" />}
      hasTimelineData={false}
      historyClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
      historySegments={[]}
      initialDataLoading={false}
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

describe("DashboardPage demo replay empty data", () => {
  it("keeps blank chart frames visible instead of empty-state copy while replay is active", () => {
    renderReplayDashboardWithNoData();

    expect(screen.getByLabelText("3-minute flow chart")).toBeTruthy();
    expect(screen.getByLabelText("No app usage for today yet")).toBeTruthy();
    expect(screen.queryByText("No timeline yet")).toBeNull();
    expect(screen.queryByText("No usage ranking")).toBeNull();
    expect(screen.queryByText("Not enough data yet")).toBeNull();
  });
});
