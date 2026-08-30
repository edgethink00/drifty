// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklyTrendChart } from "./WeeklyTrendChart";

const residualCapChart = {
  gridlines: [],
  columns: [
    {
      weekdayIndex: 0,
      weekday: "Mon",
      off: false,
      totalSeconds: 12600,
      barHeightPct: 80,
      segments: [
        { key: "focus", heightPct: 14, color: "var(--flow-tone-focus)", seconds: 1800 },
        { key: "drift", heightPct: 29, color: "var(--flow-tone-drift)", seconds: 3600 },
        { key: "neutral", heightPct: 57, color: "var(--flow-tone-neutral)", seconds: 7200 },
      ],
    },
  ],
};

const emptyChart = {
  gridlines: [],
  columns: [],
};

describe("WeeklyTrendChart", () => {
  it("exposes the chart mode picker as a labeled single-selection control", () => {
    const onModeChange = vi.fn();

    render(
      <WeeklyTrendChart
        chart={emptyChart}
        hasData={false}
        mode="category"
        projectModeAvailable
        onHideSegmentHover={vi.fn()}
        onModeChange={onModeChange}
        onMoveSegmentHover={vi.fn()}
        onShowSegmentHover={vi.fn()}
      />,
    );

    const modePicker = screen.getByRole("group", { name: "Weekly breakdown mode" });
    const productivity = within(modePicker).getByRole("button", { name: "Productivity" });
    const category = within(modePicker).getByRole("button", { name: "Category" });
    const project = within(modePicker).getByRole("button", { name: "Project" });

    expect(productivity.getAttribute("aria-pressed")).toBe("false");
    expect(category.getAttribute("aria-pressed")).toBe("true");
    expect(project.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(productivity);
    expect(onModeChange).toHaveBeenCalledWith("productivity");
  });

  it("paints residual segments last so column-reverse keeps them as the visual cap", () => {
    render(
      <WeeklyTrendChart
        chart={residualCapChart}
        hasData
        mode="productivity"
        onHideSegmentHover={vi.fn()}
        onModeChange={vi.fn()}
        onMoveSegmentHover={vi.fn()}
        onShowSegmentHover={vi.fn()}
      />,
    );

    const bar = document.querySelector(".wt-bar");
    expect(bar).toBeTruthy();
    expect([...bar!.querySelectorAll(".wt-seg")].map((segment) => (segment as HTMLElement).style.background)).toEqual([
      "var(--flow-tone-focus)",
      "var(--flow-tone-drift)",
      "var(--flow-tone-neutral)",
    ]);
  });
});
