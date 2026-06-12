// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BreakRecoveryInsight } from "../companion/driftAlarmRecovery";
import { BreakRecoveryCard } from "./BreakRecoveryCard";

afterEach(cleanup);

const emptySummary: BreakRecoveryInsight = {
  actionCounts: { return_to_focus: 0, start_break: 0, manual_correction: 0, settings: 0, dismiss: 0 },
  outcomeCounts: { recovered: 0, same_drift_continued: 0, drift_shifted: 0, unknown: 0 },
  recoveryRate: null,
  resolvedBreaks: 0,
  totalBreaks: 0,
  bestBreak: null,
};

describe("BreakRecoveryCard", () => {
  it("renders a compact recovery trend from resolved break outcomes", () => {
    render(
      <BreakRecoveryCard
        summary={{
          actionCounts: { return_to_focus: 2, start_break: 5, manual_correction: 1, settings: 0, dismiss: 1 },
          outcomeCounts: { recovered: 3, same_drift_continued: 1, drift_shifted: 1, unknown: 2 },
          recoveryRate: 0.6,
          resolvedBreaks: 5,
          totalBreaks: 7,
          bestBreak: { minutes: 15, recoveryRate: 0.75, resolvedBreaks: 4 },
        }}
      />,
    );

    expect(screen.getByRole("region", { name: /break recovery/i })).toBeTruthy();
    expect(screen.getByLabelText("Break recovery dense summary")).toBeTruthy();
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("5 resolved")).toBeTruthy();
    expect(screen.getByText("15m")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByText("Drift alarm response")).toBeNull();
    expect(screen.getByText("75% recovered, 4 samples")).toBeTruthy();
    expect(screen.queryByText("4 samples")).toBeNull();
    expect(screen.getByText("1 shifted")).toBeTruthy();
    expect(screen.getByText("2 excluded")).toBeTruthy();
    expect(screen.getByText("Attempt outcomes")).toBeTruthy();
    expect(screen.getByText("Alarm actions")).toBeTruthy();
    expect(screen.getByText("5 of 7 breaks")).toBeTruthy();
    expect(screen.getByText("Take a break")).toBeTruthy();
    expect(screen.getByText("Dismissed")).toBeTruthy();
  });

  it("renders a restrained empty state before recovery data exists", () => {
    render(<BreakRecoveryCard summary={emptySummary} />);

    expect(screen.getByText("No break recovery yet")).toBeTruthy();
    expect(screen.getByText("Use Take a break from a drift alarm to start building this trend.")).toBeTruthy();
  });
});
