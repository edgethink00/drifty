// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";
import { buildFlowBlockHoverGroups } from "./flowHoverGroups";

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

describe("flow hover groups", () => {
  it("keeps separated or different-identity cells in separate hover groups", () => {
    const blocks = [
      makeFlowBlock({ id: "cmux-start", minuteOfDay: 60 }),
      makeFlowBlock({ id: "terminal-next", minuteOfDay: 63, appName: "Terminal", bundleId: "com.apple.Terminal", colorKey: "Terminal" }),
      makeFlowBlock({ id: "cmux-later", minuteOfDay: 69 }),
    ];

    const groups = buildFlowBlockHoverGroups(blocks, 3, 0);

    expect(groups.get(60)?.endMinuteOfDay).toBe(63);
    expect(groups.get(63)?.startMinuteOfDay).toBe(63);
    expect(groups.get(63)?.endMinuteOfDay).toBe(66);
    expect(groups.get(69)?.startMinuteOfDay).toBe(69);
  });

  it("shows one continuous hover range for adjacent cells with the same app identity", () => {
    const blocks = Array.from({ length: 10 }, (_, index) => makeFlowBlock({
      id: `cmux-${index}`,
      minuteOfDay: 60 + index * 3,
    }));

    render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);

    const groupedCells = screen.getAllByRole("button", { name: /time block: 01:00–01:30/i });
    expect(groupedCells).toHaveLength(10);

    fireEvent.mouseEnter(groupedCells[4], { clientX: 120, clientY: 80 });

    const hoverCard = document.querySelector(".flow-hover-card");
    expect(hoverCard?.textContent).toContain("01:00–01:30");
    expect(hoverCard?.textContent).toContain("30m");
    for (const cell of groupedCells) expect(cell.classList.contains("flow-cell--hover-group")).toBe(true);
    expect(groupedCells[0].classList.contains("flow-cell--hover-group-start")).toBe(true);
    expect(groupedCells[4].classList.contains("flow-cell--hover-group-middle")).toBe(true);
    expect(groupedCells[9].classList.contains("flow-cell--hover-group-end")).toBe(true);
    expect(groupedCells[4].classList.contains("flow-cell--hover-group-start")).toBe(false);
    expect(groupedCells[4].classList.contains("flow-cell--hover-group-end")).toBe(false);

    const highlights = document.querySelectorAll(".flow-hover-group-highlight");
    expect(highlights).toHaveLength(1);
    const highlight = highlights[0];
    expect(highlight).toBeInstanceOf(HTMLElement);
    if (!(highlight instanceof HTMLElement)) throw new Error("expected a flow hover highlight element");
    expect(highlight.style.getPropertyValue("--flow-hover-row")).toBe("0");
    expect(highlight.style.getPropertyValue("--flow-hover-row-span")).toBe("10");
  });
});
