// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ActivitySegment } from "@drifty/domain";
import { describe, expect, it, vi } from "vitest";
import { WeeklyCategoryRow } from "./InsightCards";

const rawSegment: ActivitySegment = {
  id: "raw-segment",
  startedAt: "2026-08-17T09:00:00+09:00",
  endedAt: "2026-08-17T09:03:00+09:00",
  durationSeconds: 180,
  appName: "Visual Studio Code",
  bundleId: "com.microsoft.VSCode",
  platform: "macos",
  source: "nsworkspace",
  classification: {
    category: "workspace",
    productivity: "focus",
    source: "manual",
    confidence: 1,
  },
};

const projectedSegment: ActivitySegment = {
  ...rawSegment,
  id: "project-window:personal:2026-08-17T00:00:00.000Z:raw-segment",
};

function projectRow(projectModeAvailable: boolean, onModeChange = vi.fn()) {
  return (
    <WeeklyCategoryRow
      appIcons={{}}
      categoryTotals={[{ category: "workspace", totalSeconds: 180 }]}
      classificationOptions={{}}
      mode="project"
      onModeChange={onModeChange}
      productivityTotals={{ focus: 180, neutral: 0, drift: 0 }}
      projectBySegmentId={new Map([[projectedSegment.id, "project-drifty"]])}
      projectMeta={new Map([["project-drifty", { label: "Drifty", color: "#6366f1" }]])}
      projectModeAvailable={projectModeAvailable}
      projectSegments={[projectedSegment]}
      projectSeries={[{ key: "project-drifty", color: "#6366f1" }]}
      segments={[rawSegment]}
      weekly={[{
        weekdayIndex: 0,
        weekday: "Mon",
        isActive: true,
        focusSeconds: 180,
        neutralSeconds: 0,
        driftSeconds: 0,
        categorySeconds: { workspace: 180 },
        projectSeconds: { "project-drifty": 180 },
      }]}
    />
  );
}

describe("WeeklyCategoryRow project mode", () => {
  it("builds hover details from projected project slices instead of raw segment ids", () => {
    render(projectRow(true));

    const weeklyTrend = screen.getByLabelText(/weekly focus and drift trend/i);
    expect(within(weeklyTrend).getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");

    const projectSegment = weeklyTrend.querySelector<HTMLElement>(".wt-seg");
    expect(projectSegment).toBeTruthy();
    fireEvent.mouseEnter(projectSegment!, { clientX: 160, clientY: 160 });

    const hoverCard = document.body.querySelector<HTMLElement>(".category-hover-card");
    expect(hoverCard).toBeTruthy();
    expect(within(hoverCard!).getByText(/^Drifty$/)).toBeTruthy();
    expect(within(hoverCard!).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(hoverCard!).getAllByText("3m").length).toBeGreaterThan(0);
  });

  it("derives a Category fallback without changing the controlled Project request", () => {
    const onModeChange = vi.fn();
    const { rerender } = render(projectRow(false, onModeChange));

    let modePicker = screen.getByRole("group", { name: "Weekly breakdown mode" });
    expect(within(modePicker).getByRole("button", { name: "Category" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(modePicker).queryByRole("button", { name: "Project" })).toBeNull();
    expect(onModeChange).not.toHaveBeenCalled();

    rerender(projectRow(true, onModeChange));

    modePicker = screen.getByRole("group", { name: "Weekly breakdown mode" });
    expect(within(modePicker).getByRole("button", { name: "Project" }).getAttribute("aria-pressed")).toBe("true");
    expect(onModeChange).not.toHaveBeenCalled();
  });
});
