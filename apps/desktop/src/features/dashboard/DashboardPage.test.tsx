// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { DashboardPage } from "./DashboardPage";
import type { DashboardAiUnavailableState } from "./dashboardAiUnavailableState";

// Auto-cleanup isn't unmounting between cases here, so broad role/text queries
// otherwise collide with a prior render's DOM. Tear down explicitly.
afterEach(cleanup);

const noop = vi.fn();

type DashboardPageFixtureOptions = {
  readonly browserHistoryBootstrapNotice?: ComponentProps<typeof DashboardPage>["browserHistoryBootstrapNotice"];
  readonly dashboardEffectiveProductivityTotals?: ComponentProps<typeof DashboardPage>["dashboardEffectiveProductivityTotals"];
  readonly dashboardDateNavigator?: ComponentProps<typeof DashboardPage>["dashboardDateNavigator"];
  readonly dashboardCategoryTotals?: ComponentProps<typeof DashboardPage>["dashboardCategoryTotals"];
  readonly dashboardProductivityTotals?: ComponentProps<typeof DashboardPage>["dashboardProductivityTotals"];
  readonly dashboardReplay?: ComponentProps<typeof DashboardPage>["dashboardReplay"];
  readonly dashPeriod?: ComponentProps<typeof DashboardPage>["dashPeriod"];
  readonly hasTimelineData?: boolean;
  readonly initialDataLoading?: boolean;
  readonly flowBlocks?: FlowBlock[];
  readonly summaryFlowBlocks?: FlowBlock[];
  readonly totalSeconds?: number;
};

function renderDashboardWithNoData(options: DashboardPageFixtureOptions = {}) {
  render(
    <DashboardPage
      appIcons={{}}
      appTheme="light"
      billingCheckoutLoadingInterval={null}
      currentMinuteOfDay={4 * 60}
      dashboardAiRecoveryState={null}
      dashboardAppUsage={[]}
      dashboardSegments={[]}
      dashboardClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
      browserHistoryBootstrapNotice={options.browserHistoryBootstrapNotice ?? null}
      dashboardCategoryTotals={options.dashboardCategoryTotals ?? []}
      dashboardDateNavigator={options.dashboardDateNavigator ?? <div aria-label="date navigator" />}
      dashboardEffectiveProductivityTotals={options.dashboardEffectiveProductivityTotals ?? []}
      dashboardProductivityTotals={options.dashboardProductivityTotals ?? []}
      dashboardReplay={options.dashboardReplay === undefined ? { phase: "playing", progress: 0, onRestart: noop, onStop: noop } : options.dashboardReplay}
      dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
      dashPeriod={options.dashPeriod ?? "Today"}
      flowBlocks={options.flowBlocks ?? []}
      summaryFlowBlocks={options.summaryFlowBlocks ?? []}
      flowIntervalMinutes={3}
      focusDriftSection={<div data-testid="focus-drift-placeholder" />}
      dayBreakdownTiles={<div data-testid="day-breakdown-tiles-placeholder" />}
      dayFocusDeltaSeconds={null}
      hasTimelineData={options.hasTimelineData ?? false}
      historyClassificationOptions={{ fallbackCandidates: [], includeAiClassifications: false }}
      historySegments={[]}
      initialDataLoading={options.initialDataLoading ?? false}
      selectedDay="2026-06-29"
      selectedDayLabel="Mon, Jun 29"
      startOfDayMinutes={4 * 60}
      statusRunning={true}
      totalSeconds={options.totalSeconds ?? 0}
      weekCalendarEvents={new Map()}
      weekCurrentCalendarDay={null}
      weekCurrentMinuteOfDay={null}
      weekFocusDeltaSeconds={null}
      weekRefreshStatus="idle"
      weekRows={[]}
      onDismissDashboardAiRecovery={noop}
      onFlowIntervalChange={noop}
      onOpenDashboardAiSetup={noop}
      onManageCloudBilling={noop}
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
});

describe("DashboardPage day metrics without measured activity", () => {
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
      dashboardEffectiveProductivityTotals: [{ productivity: "drift", totalSeconds: 1_800, segments: 1, ratio: 1 }],
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
      dashboardEffectiveProductivityTotals: [{ productivity: "focus", totalSeconds: 300, segments: 1, ratio: 1 }],
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
      dashboardEffectiveProductivityTotals: [{ productivity: "focus", totalSeconds: 3_600, segments: 1, ratio: 1 }],
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
        dashboardEffectiveProductivityTotals={[]}
        dashboardProductivityTotals={[]}
        dashboardReplay={null}
        dashboardRange={{ startDay: "2026-06-29", endDay: "2026-06-29" }}
        dashPeriod="Today"
        flowBlocks={[]}
        summaryFlowBlocks={[]}
        flowIntervalMinutes={3}
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
        onFlowIntervalChange={noop}
        onOpenDashboardAiSetup={noop}
        onManageCloudBilling={onManageCloudBilling}
        onSelectBillingPlan={onSelectBillingPlan}
        onSelectDay={noop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Fix billing$/i }));
    expect(onManageCloudBilling).toHaveBeenCalledTimes(1);
    expect(onSelectBillingPlan).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /choose drifty pro plan/i })).toBeNull();
  });
});
