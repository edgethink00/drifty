// @vitest-environment jsdom

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ProjectPassRun } from "@drifty/domain";

import { ProjectPassCostPanel } from "./ProjectPassCostPanel";

function makeRun(fields: Partial<ProjectPassRun> & Pick<ProjectPassRun, "id" | "ranAt">): ProjectPassRun {
  return {
    rangeStart: "2026-07-04T00:00:00.000Z",
    rangeEnd: "2026-07-04T23:59:59.000Z",
    trigger: "schedule",
    model: "openai/gpt-5-mini",
    promptVersion: "pp-v1",
    ...fields,
  };
}

const runs: ProjectPassRun[] = [
  makeRun({ id: 1, ranAt: "2026-07-04T23:00:00.000Z", trigger: "eod", tokensIn: 8000, tokensOut: 2000, assignmentsCount: 40, correctionsCount: 3 }),
  makeRun({ id: 2, ranAt: "2026-07-04T12:00:00.000Z", trigger: "schedule", tokensIn: 4000, tokensOut: 1000, assignmentsCount: 20, correctionsCount: 1 }),
  makeRun({ id: 3, ranAt: "2026-07-03T09:00:00.000Z", trigger: "manual", tokensIn: 6000, tokensOut: 1500 }),
];

describe("ProjectPassCostPanel", () => {
  it("shows the model, estimated spend, per-day rows, and per-trigger counts", () => {
    render(<ProjectPassCostPanel runs={runs} />);

    expect(screen.getByRole("heading", { name: "Project pass cost" })).toBeTruthy();

    // Model + estimated spend: 18000 in / 4500 out on gpt-5-mini → 18000/1e6*0.25 + 4500/1e6*2 = $0.0135.
    expect(screen.getByText("gpt-5-mini")).toBeTruthy();
    expect(screen.getByText("Est. cost to date")).toBeTruthy();
    expect(screen.getByText("$0.01")).toBeTruthy();
    expect(screen.getByText("Est. monthly")).toBeTruthy();
    expect(screen.getByText(/18,000 tokens in/)).toBeTruthy();

    // Per-day rows: header + one row per day (newest day first).
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);

    const newestDayRow = rows[1];
    expect(within(newestDayRow).getByRole("cell", { name: "2026-07-04" })).toBeTruthy();
    expect(within(newestDayRow).getByRole("cell", { name: "12,000" })).toBeTruthy(); // 8000 + 4000 tokens in
    expect(within(newestDayRow).getByRole("cell", { name: "60" })).toBeTruthy(); // 40 + 20 assignments

    const olderDayRow = rows[2];
    expect(within(olderDayRow).getByRole("cell", { name: "2026-07-03" })).toBeTruthy();

    // Per-trigger summary lists every trigger, defaulting absent ones to 0.
    expect(screen.getByText("schedule: 1")).toBeTruthy();
    expect(screen.getByText("eod: 1")).toBeTruthy();
    expect(screen.getByText("manual: 1")).toBeTruthy();
    expect(screen.getByText("open: 0")).toBeTruthy();
    expect(screen.getByText("backfill: 0")).toBeTruthy();
    expect(screen.getByText("discovery: 0")).toBeTruthy();
  });

  it("renders an empty state when there are no runs", () => {
    render(<ProjectPassCostPanel runs={[]} />);

    expect(screen.getByText("No project passes yet.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
