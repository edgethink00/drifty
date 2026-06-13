// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { IndividualPlanCards } from "./IndividualPlanCards";

describe("IndividualPlanCards", () => {
  it("shows Free, Individual, and Pro with a monthly/yearly interval switch", () => {
    render(<IndividualPlanCards billingInterval="monthly" currentPlan="free" loadingInterval={null} />);

    const freePlan = screen.getByRole("article", { name: /free plan/i });
    const individualPlan = screen.getByRole("button", { name: /choose individual plan/i });
    const proPlan = screen.getByRole("article", { name: /pro plan/i });

    expect(screen.getByRole("radio", { name: /monthly/i })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /yearly/i })).toBeTruthy();
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
    expect(within(individualPlan).getByText("Start Individual")).toBeTruthy();

    expect(within(proPlan).getByText("Soon")).toBeTruthy();
    expect(within(proPlan).queryByText("Higher-tier AI")).toBeNull();
    expect(within(proPlan).getByText("Launch pricing")).toBeTruthy();
    expect(within(proPlan).getByText("coming soon")).toBeTruthy();
    expect(within(proPlan).getAllByText(/Pro model access/).length).toBeGreaterThan(0);
    expect(within(proPlan).getAllByText("Coming soon").length).toBeGreaterThan(0);
  });

  it("marks Individual as current during an active trial", () => {
    render(<IndividualPlanCards billingInterval="yearly" currentPlan="individual" loadingInterval={null} />);

    const individualPlan = screen.getByRole("article", { name: /individual plan/i });

    expect(within(individualPlan).getAllByText("Current plan").length).toBeGreaterThan(0);
    expect(within(individualPlan).getByText("$4")).toBeTruthy();
    expect(within(individualPlan).queryByText("$5")).toBeNull();
    expect(within(individualPlan).getByText("/ month · $48 billed yearly")).toBeTruthy();
  });
});
