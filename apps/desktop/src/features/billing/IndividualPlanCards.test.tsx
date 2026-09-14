// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IndividualPlanCards } from "./IndividualPlanCards";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { readAppStyles } from "../../test/readStyles";

afterEach(cleanup);

describe("IndividualPlanCards", () => {
  it("shows Free and Pro with a monthly/yearly interval switch", () => {
    render(<IndividualPlanCards billingInterval="monthly" currentPlan="free" loadingInterval={null} onSelectPlan={vi.fn()} />);

    const freePlan = screen.getByRole("article", { name: /free plan/i });
    const proPlan = screen.getByRole("button", { name: /choose drifty pro plan/i });

    expect(screen.getByRole("radio", { name: /monthly/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /yearly/i })).toBeTruthy();
    expect(screen.getByText("Save 28%")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /quarterly/i })).toBeNull();
    expect(screen.queryByRole("article", { name: /business plan/i })).toBeNull();
    expect(screen.queryByText(/every 3 months|\$4\.33/i)).toBeNull();

    expect(within(freePlan).getByText("$0")).toBeTruthy();
    expect(within(freePlan).getByText("forever")).toBeTruthy();
    expect(within(freePlan).getByText("On-device AI you control")).toBeTruthy();
    expect(within(freePlan).getAllByText("Current plan").length).toBeGreaterThan(0);
    expect(within(freePlan).getByText(/Custom classification rules you create/)).toBeTruthy();
    expect(within(freePlan).getAllByText(/API key/).length).toBeGreaterThan(0);
    expect(within(freePlan).getByText("On-device AI classification, no paid plan needed")).toBeTruthy();
    expect(within(freePlan).queryByText(/no account needed/i)).toBeNull();
    expect(within(freePlan).queryByText(/^Local-first$/i)).toBeNull();

    expect(within(proPlan).getByText("Drifty Pro")).toBeTruthy();
    expect(within(proPlan).getByText("$7")).toBeTruthy();
    expect(within(proPlan).getByText("/ month")).toBeTruthy();
    expect(within(proPlan).getByText("Recommended")).toBeTruthy();
    expect(within(proPlan).getByText("Peak performance. Zero setup.")).toBeTruthy();
    expect(within(proPlan).getByText("Includes all Free plan features")).toBeTruthy();
    expect(within(proPlan).getByText(/More accurate on ambiguous work/)).toBeTruthy();
    expect(within(proPlan).getByText(/No downloads, API keys, or models to manage/)).toBeTruthy();
    expect(within(proPlan).getByText(/on up to 2 Macs/)).toBeTruthy();
    expect(within(proPlan).getAllByText(/7-day free trial/).length).toBeGreaterThan(0);
    // Device management lives in the Account rows below, not as a plan benefit.
    expect(within(proPlan).queryByText(/Manage old devices/i)).toBeNull();
    expect(within(proPlan).getByText("Upgrade to Pro")).toBeTruthy();

    expect(screen.queryByText("Individual")).toBeNull();
    expect(screen.queryByText("Launch pricing")).toBeNull();
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("keeps the interval switch subordinate to the plan cards", () => {
    const styles = readAppStyles();

    // The switch is a secondary control: it stays under the settings control
    // height and carries no elevation of its own, so the cards read first.
    expect(styles).toMatch(/\.individual-plan-intervals\s*\{[\s\S]*height:\s*2\.125rem;/);
    expect(styles).toMatch(/\.individual-plan-intervals\s*\{[\s\S]*box-shadow:\s*none;/);
    expect(styles).toMatch(/\.individual-plan-interval\s*\{[\s\S]*height:\s*1\.75rem;/);
  });

  it("lets both plan cards size to their content instead of a fixed card height", () => {
    const styles = readAppStyles();

    // A fixed min-height left the shorter Free card with dead space; the grid
    // now equalizes the pair from real content.
    expect(styles).not.toMatch(/\.individual-plan-card\s*\{[\s\S]*min-height:\s*24\.75rem;/);
    expect(styles).toMatch(/\.individual-plan-cards\s*\{[\s\S]*align-items:\s*stretch;/);
  });

  it("gives each plan a concise value headline without promoting checkout status text", () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.individual-plan-card__value\s*\{[\s\S]*font-size:\s*1\.25rem;/);
    expect(styles).toMatch(/\.individual-plan-card__value--status\s*\{[\s\S]*font-size:\s*0\.78rem;/);
  });

  it("uses the shared Prism Echo tokens for the paid plan without tinting the card body", () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/--plan-card-pro-label-gradient:\s*linear-gradient\(96deg/);
    expect(styles).toMatch(/--plan-card-pro-border-gradient:\s*linear-gradient\(/);
    expect(styles).toMatch(/\.individual-plan-card--featured\s*\{[\s\S]*var\(--plan-card-pro-border-gradient\) border-box;[\s\S]*border-color:\s*transparent;/);
    expect(styles).toMatch(/\.individual-plan-card--featured \.individual-plan-card__badge\s*\{[\s\S]*background:\s*var\(--plan-card-pro-badge-bg\);/);
    expect(styles).toMatch(/\.individual-plan-card--featured \.individual-plan-card__topline > span\s*\{[\s\S]*background-image:\s*var\(--plan-card-pro-label-gradient\);/);
    expect(styles).toMatch(/@media \(forced-colors: active\)\s*\{[\s\S]*\.individual-plan-card--featured\s*\{[\s\S]*background:\s*Canvas;[\s\S]*border-color:\s*CanvasText;/);
  });

  it("marks Pro as current during an active trial", () => {
    render(<IndividualPlanCards billingInterval="yearly" currentPlan="individual" loadingInterval={null} />);

    const proPlan = screen.getByRole("article", { name: /pro plan/i });

    expect(within(proPlan).getAllByText("Current plan").length).toBeGreaterThan(0);
    expect(within(proPlan).getByText("$5")).toBeTruthy();
    expect(within(proPlan).queryByText("$7")).toBeNull();
    expect(within(proPlan).getByText("/ month · $60 billed yearly")).toBeTruthy();
  });

  it("shows the server-confirmed regional currency and matching yearly savings", () => {
    render(
      <IndividualPlanCards
        loadingInterval={null}
        onSelectPlan={vi.fn()}
        pricingQuote={{
          assignmentId: "4f708408-1e56-4dad-8f45-2f02d755ae24",
          pricingRevision: "pro-regional-pilot-2026-09",
          market: "IN",
          variant: "regional",
          currency: "INR",
          monthlyAmountMinor: 29_900,
          yearlyAmountMinor: 249_000,
        }}
      />,
    );

    expect(screen.getByText("₹299")).toBeTruthy();
    expect(screen.getByText("Regional price · charged in INR")).toBeTruthy();
    expect(screen.getByText("Save 30%")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /yearly/i }));
    expect(screen.getByText("₹207.50")).toBeTruthy();
    expect(screen.getByText("/ month · ₹2,490 billed yearly")).toBeTruthy();
  });

  it("starts Pro setup from the card when shown in display mode with a select handler", () => {
    const onSelectPlan = vi.fn();

    render(<IndividualPlanCards billingInterval="monthly" currentPlan="free" loadingInterval={null} mode="display" onSelectPlan={onSelectPlan} />);

    fireEvent.click(screen.getByRole("button", { name: /choose drifty pro plan/i }));

    expect(onSelectPlan).toHaveBeenCalledWith("monthly");
  });

  it("keeps the displayed cadence stable while checkout is opening", () => {
    render(<IndividualPlanCards billingInterval="monthly" currentPlan="free" loadingInterval="monthly" onSelectPlan={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /monthly/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: /yearly/i })).toHaveProperty("disabled", true);
  });

  it("opens AI setup from the Free plan card when shown with a free-plan handler", () => {
    const onSelectFreePlan = vi.fn();

    render(<IndividualPlanCards billingInterval="monthly" loadingInterval={null} mode="display" onSelectFreePlan={onSelectFreePlan} />);

    fireEvent.click(screen.getByRole("button", { name: /open ai setup/i }));

    expect(onSelectFreePlan).toHaveBeenCalledTimes(1);
  });

  it("lets a current Pro plan recover billing with a custom action label", () => {
    const onManageCurrentPlan = vi.fn();

    render(
      <IndividualPlanCards
        billingInterval="monthly"
        currentPlan="individual"
        loadingInterval={null}
        manageCurrentPlanLabel="Fix billing"
        onManageCurrentPlan={onManageCurrentPlan}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Fix billing$/i }));
    expect(onManageCurrentPlan).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /^Manage billing$/i })).toBeNull();
  });
});


it("keeps the Korean annual savings, invoice amount, and checkout interval consistent", () => {
  const onSelectPlan = vi.fn();
  render(
    <LocalizationTestProvider language="ko">
      <IndividualPlanCards loadingInterval={null} onSelectPlan={onSelectPlan} />
    </LocalizationTestProvider>,
  );
  expect(screen.getByText("$7")).toBeTruthy();
  expect(screen.getByText("기기 내 AI 분류, 유료 요금제 없이 사용")).toBeTruthy();
  expect(screen.queryByText(/계정 없이/)).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "연간 28% 절약" }));
  expect(screen.getByText("$5")).toBeTruthy();
  expect(screen.getByText("월 기준 · 연 $60 결제")).toBeTruthy();
  expect(screen.queryByText(/\{\{|\}\}/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Drifty Pro 요금제 선택" }));
  expect(onSelectPlan).toHaveBeenLastCalledWith("yearly");
  fireEvent.click(screen.getByRole("radio", { name: "월간" }));
  expect(screen.getByText("$7")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Drifty Pro 요금제 선택" }));
  expect(onSelectPlan).toHaveBeenLastCalledWith("monthly");
});
