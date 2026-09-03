// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UpgradeDecisionPanel } from "./UpgradeDecisionPanel";

afterEach(cleanup);

describe("UpgradeDecisionPanel", () => {
  it("keeps the selected choice at 1:1 without a $0 price anchor", () => {
    const onSelectPlan = vi.fn();
    render(
      <UpgradeDecisionPanel
        context="trial-active"
        loadingInterval={null}
        onContinueLocal={vi.fn()}
        onSelectPlan={onSelectPlan}
      />,
    );

    const panel = screen.getByLabelText(/drifty pro subscription choice/i);
    const ratioGrid = document.querySelector('[data-choice-ratio="1:1"]');
    expect(ratioGrid?.children).toHaveLength(2);
    expect(within(panel).getByText("$7")).toBeTruthy();
    expect(within(panel).queryByText("$0")).toBeNull();
    expect(within(panel).queryByText(/^Free$/)).toBeNull();

    fireEvent.click(within(panel).getByRole("radio", { name: /yearly/i }));
    expect(within(panel).getByText("$5")).toBeTruthy();
    expect(within(panel).getByText("/ month · $60 billed yearly")).toBeTruthy();
    expect(within(panel).getByText("Save $24/year")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: /continue with pro/i }));
    expect(onSelectPlan).toHaveBeenCalledWith("yearly");
  });

  it("uses the Local AI card for decision-relevant setup and tradeoffs", () => {
    const onContinueLocal = vi.fn();
    render(
      <UpgradeDecisionPanel
        context="trial-active"
        loadingInterval={null}
        onContinueLocal={onContinueLocal}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText("You provide")).toBeTruthy();
    expect(screen.getByText(/on-device model, api key, or endpoint/i)).toBeTruthy();
    expect(screen.getByText("Good to know")).toBeTruthy();
    expect(screen.getByText(/on-device model: uses mac memory and storage/i)).toBeTruthy();
    expect(screen.getByText(/api or endpoint: may need separate setup and incur usage fees/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /view local ai setup/i }));
    expect(onContinueLocal).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["trial-active", "Keep using the same Cloud AI after your trial.", "Trial active", "Continue with Pro"],
    ["trial-ended", "Subscribe to restart Cloud AI classification.", "Trial ended", "Restart Cloud AI"],
    ["upgrade", "Use Cloud AI right away without model setup.", "Recommended", "Upgrade to Pro"],
  ] as const)("uses the right %s offer copy", (context, body, badge, action) => {
    render(
      <UpgradeDecisionPanel
        context={context}
        loadingInterval={null}
        onContinueLocal={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText("More accurate AI, ready to use")).toBeTruthy();
    expect(screen.getByText(body)).toBeTruthy();
    expect(screen.getByText(badge)).toBeTruthy();
    expect(screen.getByRole("button", { name: action })).toBeTruthy();
    expect(screen.getByText("Cloud AI classification on up to 2 Macs")).toBeTruthy();
  });

  it("acknowledges a configured Local AI setup before offering Cloud AI", () => {
    render(
      <UpgradeDecisionPanel
        context="upgrade-local"
        loadingInterval={null}
        onContinueLocal={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByText("Switch to more accurate Cloud AI without model setup.")).toBeTruthy();
    expect(screen.getByText("Current setup · Local AI")).toBeTruthy();
    expect(screen.getByText(/keep using your configured local ai/i)).toBeTruthy();
  });

  it("locks both routes while checkout is opening", () => {
    render(
      <UpgradeDecisionPanel
        context="trial-active"
        loadingInterval="monthly"
        onContinueLocal={vi.fn()}
        onSelectPlan={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: /opening checkout/i })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: /view local ai setup/i })).toHaveProperty("disabled", true);
  });
});
