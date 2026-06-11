import { describe, expect, it } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { buildFlowBlockHoverGroups } from "./flowHoverGroups";
import { buildFlowHoverOverlaySegments } from "./flowHoverOverlay";

function makeFlowBlock(overrides: Partial<FlowBlock> = {}): FlowBlock {
  return {
    id: "flow-block",
    day: "2026-04-06",
    hour: 13,
    quarter: 1,
    minuteOfDay: 13 * 60 + 21,
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    browserName: null,
    siteDomain: null,
    siteTitle: null,
    windowTitle: "FlowChartView.tsx",
    category: "workspace",
    productivity: "focus",
    colorKey: "Visual Studio Code",
    durationSeconds: 180,
    ...overrides,
  };
}

describe("flow hover overlay segments", () => {
  it("splits one continuous hover group into visual column segments when it crosses an hour", () => {
    const intervalMinutes = 3;
    const blocks = Array.from({ length: 27 }, (_, index) => makeFlowBlock({
      id: `vscode-${index}`,
      minuteOfDay: 13 * 60 + 21 + index * intervalMinutes,
    }));
    const groups = buildFlowBlockHoverGroups(blocks, intervalMinutes, 0);
    const group = groups.get(13 * 60 + 21);

    expect(group).toBeDefined();
    if (!group) throw new Error("expected a hover group for the first block");

    expect(buildFlowHoverOverlaySegments(group, intervalMinutes, 0)).toEqual([
      { hourIndex: 13, rowIndex: 7, rowSpan: 13 },
      { hourIndex: 14, rowIndex: 0, rowSpan: 14 },
    ]);
  });
});
