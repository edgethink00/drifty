// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";
import { buildFlowBlockHoverGroups, buildFlowHoverGroupContributions } from "./flowHoverGroups";

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
    const inspector = screen.getByRole("dialog", { name: "cmux" });
    expect(inspector).toBeTruthy();
    expect(within(inspector).queryByRole("button", { name: /Change Project/ })).toBeNull();
    expect(inspector.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
  });

  it("sums each cell's composition across the hover group with the painted winner first", () => {
    const slack = {
      colorKey: "Slack",
      appName: "Slack",
      bundleId: "com.tinyspeck.slackmacgap",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
      category: "communication" as const,
      productivity: "neutral" as const,
      durationSeconds: 60,
      sourceSegmentIds: ["seg-slack"],
    };
    const cmuxShare = (durationSeconds: number, sourceSegmentIds: string[]) => ({
      ...slack,
      colorKey: "cmux",
      appName: "cmux",
      bundleId: "dev.cmux",
      category: "workspace" as const,
      productivity: "focus" as const,
      durationSeconds,
      sourceSegmentIds,
    });
    const blocks = [
      makeFlowBlock({
        id: "cmux-a",
        minuteOfDay: 60,
        durationSeconds: 120,
        sourceSegmentIds: ["seg-a"],
        composition: [cmuxShare(120, ["seg-a"]), slack],
      }),
      makeFlowBlock({
        id: "cmux-b",
        minuteOfDay: 63,
        durationSeconds: 100,
        sourceSegmentIds: ["seg-b"],
        composition: [cmuxShare(100, ["seg-b"]), { ...slack, durationSeconds: 80 }],
      }),
    ];

    const group = buildFlowBlockHoverGroups(blocks, 3, 0).get(60);
    expect(group).toBeTruthy();
    const contributions = buildFlowHoverGroupContributions(group!);

    expect(contributions.map((entry) => [entry.label, entry.durationSeconds, entry.isWinner, entry.category])).toEqual([
      ["cmux", 220, true, "workspace"],
      ["Slack", 140, false, "communication"],
    ]);
  });

  it("falls back to the block itself when a cell carries no composition", () => {
    const group = buildFlowBlockHoverGroups([makeFlowBlock({ id: "solo", minuteOfDay: 60, durationSeconds: 90 })], 3, 0).get(60);

    expect(buildFlowHoverGroupContributions(group!)).toEqual([
      expect.objectContaining({ label: "cmux", durationSeconds: 90, isWinner: true }),
    ]);
  });

  it("lists the hidden runner-ups in the hover preview so a flat cell explains what else filled it", () => {
    const block = makeFlowBlock({
      id: "instagram-cell",
      minuteOfDay: 14 * 60 + 8,
      appName: "Arc",
      bundleId: "company.thebrowser.Browser",
      browserName: "Arc",
      siteDomain: "instagram.com",
      siteTitle: "Instagram",
      windowTitle: null,
      category: "social_media",
      productivity: "drift",
      colorKey: "instagram.com",
      durationSeconds: 180,
      sourceSegmentIds: ["seg-instagram"],
      composition: [
        {
          colorKey: "instagram.com",
          appName: "Arc",
          bundleId: "company.thebrowser.Browser",
          browserName: "Arc",
          siteDomain: "instagram.com",
          siteTitle: "Instagram",
          category: "social_media",
          productivity: "drift",
          durationSeconds: 180,
          sourceSegmentIds: ["seg-instagram"],
        },
        {
          colorKey: "Slack",
          appName: "Slack",
          bundleId: "com.tinyspeck.slackmacgap",
          browserName: null,
          siteDomain: null,
          siteTitle: null,
          category: "communication",
          productivity: "neutral",
          durationSeconds: 45,
          sourceSegmentIds: ["seg-slack"],
        },
      ],
    });

    render(<FlowChartView blocks={[block]} appIcons={{}} intervalMinutes={4} />);

    fireEvent.click(screen.getByRole("button", { name: /time block: 14:08–14:12/i }));

    const preview = document.querySelector('.week-activity-inspector[data-mode="pinned"]') as HTMLElement;
    const rows = Array.from(preview.querySelectorAll<HTMLElement>(".week-activity-inspector__activity-row"));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.children[1]?.textContent)).toEqual(["instagram.com · dominant", "Slack"]);
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual(["3m", "45s"]);
    expect(rows[0].classList.contains("week-activity-inspector__activity-row--dominant")).toBe(true);
    // Mutations still target only the painted winner's records.
    expect(preview.textContent).toContain("14:08–14:12");
  });

  it("keeps the preview breakdown hidden when the cell was filled by one activity", () => {
    const block = makeFlowBlock({
      id: "solo-cell",
      minuteOfDay: 14 * 60 + 8,
      composition: [{
        colorKey: "cmux",
        appName: "cmux",
        bundleId: "dev.cmux",
        browserName: null,
        siteDomain: null,
        siteTitle: null,
        category: "workspace",
        productivity: "focus",
        durationSeconds: 180,
        sourceSegmentIds: ["seg-a"],
      }],
    });

    render(<FlowChartView blocks={[block]} appIcons={{}} intervalMinutes={4} />);
    fireEvent.click(screen.getByRole("button", { name: /time block: 14:08–14:12/i }));

    const inspector = document.querySelector('.week-activity-inspector[data-mode="pinned"]');
    expect(inspector?.querySelectorAll(".week-activity-inspector__activity-row")).toHaveLength(0);
  });
});
