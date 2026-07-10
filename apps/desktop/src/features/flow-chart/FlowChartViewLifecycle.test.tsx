// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";

function makeFlowBlock(overrides: Partial<FlowBlock> = {}): FlowBlock {
  return {
    id: "flow-block",
    day: "2026-04-06",
    hour: 1,
    quarter: 0,
    minuteOfDay: 60,
    appName: "cmux",
    bundleId: "dev.cmux",
    browserName: null,
    siteDomain: null,
    siteTitle: null,
    windowTitle: "cmux",
    category: "workspace",
    productivity: "focus",
    colorKey: "cmux",
    durationSeconds: 180,
    ...overrides,
  };
}

function fireNativePointerMove(target: Element, clientX: number, clientY: number): void {
  fireEvent(target, new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));
}

function firstElement<T>(items: readonly T[]): T {
  const [first] = items;
  if (first === undefined) throw new Error("Expected at least one flow cell.");
  return first;
}

describe("FlowChartView lifecycle", () => {
  it("reattaches hover handling when the flow grid remounts after an empty loading pass", () => {
    const firstDayBlocks = [
      makeFlowBlock({ id: "first-day-start", minuteOfDay: 60 }),
      makeFlowBlock({ id: "first-day-next", minuteOfDay: 63 }),
    ];
    const nextDayBlocks = [
      makeFlowBlock({ id: "next-day-start", day: "2026-04-05", minuteOfDay: 120 }),
      makeFlowBlock({ id: "next-day-next", day: "2026-04-05", minuteOfDay: 123 }),
    ];

    const { rerender } = render(<FlowChartView blocks={firstDayBlocks} appIcons={{}} intervalMinutes={3} />);
    fireNativePointerMove(firstElement(screen.getAllByRole("button", { name: /time block: 01:00–01:06/i })), 120, 80);
    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("01:00–01:06");

    rerender(<FlowChartView blocks={[]} appIcons={{}} intervalMinutes={3} />);
    expect(document.querySelector(".flow-chart-grid")).toBeNull();

    rerender(<FlowChartView blocks={nextDayBlocks} appIcons={{}} intervalMinutes={3} />);
    const nextDayCells = screen.getAllByRole("button", { name: /time block: 02:00–02:06/i });

    fireNativePointerMove(firstElement(nextDayCells), 160, 120);

    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("02:00–02:06");
    const highlights = document.querySelectorAll(".flow-hover-group-highlight");
    expect(highlights).toHaveLength(1);
    // Both remounted cells belong to the reattached hover group (row span 2).
    expect((highlights[0] as HTMLElement).style.getPropertyValue("--flow-hover-row-span")).toBe("2");
  });
});
