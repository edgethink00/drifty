// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklyTrendChart } from "./WeeklyTrendChart";

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
});
