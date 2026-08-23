// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IndividualPlanCards } from "./IndividualPlanCards";
import { readAppStyles } from "../../test/readStyles";

describe("IndividualPlanCards", () => {
  it("shows Free and Individual with a monthly/yearly interval switch", () => {
    render(<IndividualPlanCards billingInterval="monthly" currentPlan="free" loadingInterval={null} onSelectPlan={vi.fn()} />);

    const freePlan = screen.getByRole("article", { name: /free plan/i });
    const individualPlan = screen.getByRole("button", { name: /choose individual plan/i });

    expect(screen.getByRole("radio", { name: /monthly/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /yearly/i })).toBeTruthy();
    expect(screen.getByText("Save 20%")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /quarterly/i })).toBeNull();
    expect(screen.queryByRole("article", { name: /business plan/i })).toBeNull();
    expect(screen.queryByText(/every 3 months|\$4\.33/i)).toBeNull();

    expect(within(freePlan).getByText("$0")).toBeTruthy();
    expect(within(freePlan).getByText("forever")).toBeTruthy();
    expect(within(freePlan).getAllByText("Current plan").length).toBeGreaterThan(0);
    expect(within(freePlan).getByText(/Local classification/)).toBeTruthy();
    expect(within(freePlan).getAllByText(/API key/).length).toBeGreaterThan(0);
    expect(within(freePlan).getAllByText(/Self-hosted local AI/).length).toBeGreaterThan(0);

    expect(within(individualPlan).getByText("$5")).toBeTruthy();
    expect(within(individualPlan).getByText("/ month")).toBeTruthy();
    expect(within(individualPlan).getByText("Cloud AI")).toBeTruthy();
    expect(within(individualPlan).getByText("2 active desktop devices included")).toBeTruthy();
    expect(within(individualPlan).getByText("Manage old devices from Account settings")).toBeTruthy();
    expect(within(individualPlan).getByText("Start Individual")).toBeTruthy();

    expect(screen.queryByRole("article", { name: /pro plan/i })).toBeNull();
    expect(screen.queryByText("Launch pricing")).toBeNull();
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("keeps the billing interval switch ten percent shorter without changing its width rhythm", () => {
    const styles = readAppStyles();

    expect(styles).toMatch(/\.individual-plan-intervals\s*\{[\s\S]*height:\s*2\.390625rem;/);
    expect(styles).toMatch(/\.individual-plan-intervals\s*\{[\s\S]*padding:\s*0\.225rem 0\.25rem;/);
    expect(styles).toMatch(/\.individual-plan-interval\s*\{[\s\S]*height:\s*1\.940625rem;/);
    expect(styles).toMatch(/\.individual-plan-interval\s*\{[\s\S]*min-width:\s*6\.5rem;/);
  });

  it("marks Individual as current during an active trial", () => {
    render(<IndividualPlanCards billingInterval="yearly" currentPlan="individual" loadingInterval={null} />);

    const individualPlan = screen.getByRole("article", { name: /individual plan/i });

    expect(within(individualPlan).getAllByText("Current plan").length).toBeGreaterThan(0);
    expect(within(individualPlan).getByText("$4")).toBeTruthy();
    expect(within(individualPlan).queryByText("$5")).toBeNull();
    expect(within(individualPlan).getByText("/ month · $48 billed yearly")).toBeTruthy();
  });

  it("starts Individual setup from the card when shown in display mode with a select handler", () => {
    const onSelectPlan = vi.fn();

    render(<IndividualPlanCards billingInterval="monthly" currentPlan="free" loadingInterval={null} mode="display" onSelectPlan={onSelectPlan} />);

    fireEvent.click(screen.getByRole("button", { name: /choose individual plan/i }));

    expect(onSelectPlan).toHaveBeenCalledWith("monthly");
  });

  it("opens AI setup from the Free plan card when shown with a free-plan handler", () => {
    const onSelectFreePlan = vi.fn();

    render(<IndividualPlanCards billingInterval="monthly" loadingInterval={null} mode="display" onSelectFreePlan={onSelectFreePlan} />);

    fireEvent.click(screen.getByRole("button", { name: /open ai setup/i }));

    expect(onSelectFreePlan).toHaveBeenCalledTimes(1);
  });
});
