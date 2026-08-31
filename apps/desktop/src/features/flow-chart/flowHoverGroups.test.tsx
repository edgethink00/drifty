// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

function fireNativePointerMove(target: Element, clientX: number, clientY: number): void {
  fireEvent(target, new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));
}

describe("flow hover groups", () => {
  it("unions source segment ids across adjacent cells", () => {
    const blocks = [
      makeFlowBlock({ id: "cmux-a", minuteOfDay: 60, sourceSegmentIds: ["seg-a"] }),
      makeFlowBlock({ id: "cmux-b", minuteOfDay: 63, sourceSegmentIds: ["seg-b", "seg-a"] }),
    ];
    const groups = buildFlowBlockHoverGroups(blocks, 3, 0);
    expect(groups.get(60)?.segmentIds).toEqual(["seg-a", "seg-b"]);
  });

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

    fireNativePointerMove(groupedCells[4], 120, 80);

    const hoverCard = document.querySelector(".flow-hover-card");
    expect(hoverCard?.textContent).toContain("01:00–01:30");
    expect(hoverCard?.textContent).toContain("30m");
    // The whole run is highlighted by a single overlay segment rather than per-cell
    // classes, so the grid never re-renders on hover (see FlowHoverLayer).
    for (const cell of groupedCells) expect(cell.classList.contains("flow-cell--hover-group")).toBe(false);

    const highlights = document.querySelectorAll(".flow-hover-group-highlight");
    expect(highlights).toHaveLength(1);
    const highlight = highlights[0];
    expect(highlight).toBeInstanceOf(HTMLElement);
    if (!(highlight instanceof HTMLElement)) throw new Error("expected a flow hover highlight element");
    expect(highlight.style.getPropertyValue("--flow-hover-row")).toBe("0");
    expect(highlight.style.getPropertyValue("--flow-hover-row-span")).toBe("10");
  });
  it("opens the shared activity inspector from a grouped flow cell", () => {
    const onClassifyActivity = vi.fn();
    const onDeleteActivity = vi.fn();
    const blocks = Array.from({ length: 4 }, (_, index) => makeFlowBlock({
      id: `cmux-${index}`,
      minuteOfDay: 60 + index * 3,
      sourceSegmentIds: ["seg-a"],
    }));

    render(
      <FlowChartView
        blocks={blocks}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        segments={[]}
        onClassifyActivity={onClassifyActivity}
        onDeleteActivity={onDeleteActivity}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /time block: 01:00–01:12/i })[0]);
    expect(screen.getByRole("dialog", { name: "cmux" })).toBeTruthy();
    expect(screen.getByText("0 captured records")).toBeTruthy();
  });
});
