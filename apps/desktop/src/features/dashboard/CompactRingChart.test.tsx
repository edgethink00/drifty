// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import type { AppIconMap, FlowBlock } from "@drifty/domain";
import { CompactRingChart } from "./CompactRingChart";
import type { CompactRingEntry } from "./CompactRingChart";

const appIcons: AppIconMap = {};

function makeEntries(): CompactRingEntry[] {
  const totalSeconds = (7 * 3600) + (34 * 60);
  const focusSeconds = (5 * 3600) + (33 * 60);
  const driftSeconds = (1 * 3600) + (15 * 60);
  const neutralSeconds = 46 * 60;
  return [
    {
      key: "focus",
      label: "Focus",
      color: "var(--flow-tone-focus)",
      totalSeconds: focusSeconds,
      ratio: focusSeconds / totalSeconds,
      matchesBlock: (block) => block.productivity === "focus",
      dotClassName: "productivity-dot--focus",
    },
    {
      key: "drift",
      label: "Drift",
      color: "var(--flow-tone-drift)",
      totalSeconds: driftSeconds,
      ratio: driftSeconds / totalSeconds,
      matchesBlock: (block) => block.productivity === "drift",
      dotClassName: "productivity-dot--drift",
    },
    {
      key: "neutral",
      label: "Neutral",
      color: "var(--flow-tone-neutral)",
      totalSeconds: neutralSeconds,
      ratio: neutralSeconds / totalSeconds,
      matchesBlock: (block) => block.productivity === "neutral",
      dotClassName: "productivity-dot--neutral",
    },
  ];
}

describe("CompactRingChart", () => {
  it("renders the title, one arc per active entry, and the center percent", () => {
    const entries = makeEntries();
    const totalSeconds = entries.reduce((sum, entry) => sum + entry.totalSeconds, 0);

    const { container } = render(
      <CompactRingChart
        title="Productivity"
        entries={entries}
        totalSeconds={totalSeconds}
        centerPercent={73}
        flowBlocks={[]}
        appIcons={appIcons}
      />,
    );

    const panel = container.querySelector(".flow-compact-split-chart__panel--circle");
    if (!(panel instanceof HTMLElement)) throw new Error("Ring panel did not render");
    expect(within(panel).getByText("Productivity")).toBeTruthy();

    const dial = panel.querySelector(".flow-compact-productivity-circle__dial");
    expect(dial?.getAttribute("aria-label")).toContain("Productivity classification:");

    const segments = Array.from(panel.querySelectorAll<SVGPathElement>(".flow-compact-productivity-circle__segment"));
    expect(segments).toHaveLength(3);
    expect(segments.every((segment) => segment.tagName.toLowerCase() === "path")).toBe(true);
    expect(segments.every((segment) => segment.getAttribute("d")?.startsWith("M "))).toBe(true);
    expect(segments.map((segment) => segment.getAttribute("stroke"))).toEqual([
      "var(--flow-tone-focus)",
      "var(--flow-tone-drift)",
      "var(--flow-tone-neutral)",
    ]);

    const center = panel.querySelector(".flow-compact-productivity-circle__center strong");
    expect(center?.textContent).toBe("73%");
  });

  it("drives arc colors, legend labels, and title generically for category entries", () => {
    const totalSeconds = 40 * 60;
    const entries: CompactRingEntry[] = [
      {
        key: "workspace",
        label: "Workspace",
        color: "var(--category-workspace)",
        totalSeconds: 30 * 60,
        ratio: (30 * 60) / totalSeconds,
        matchesBlock: (block) => block.category === "workspace",
        dotClassName: "category-dot--workspace",
      },
      {
        key: "unknown",
        label: "Unclassified",
        color: "var(--category-unknown)",
        totalSeconds: 10 * 60,
        ratio: (10 * 60) / totalSeconds,
        matchesBlock: (block) => block.category === "unknown",
        dotClassName: "category-dot--unknown",
      },
    ];

    const { container } = render(
      <CompactRingChart
        title="Categories"
        entries={entries}
        totalSeconds={totalSeconds}
        centerPercent={75}
        flowBlocks={[]}
        appIcons={appIcons}
      />,
    );

    const panel = container.querySelector(".flow-compact-split-chart__panel--circle");
    if (!(panel instanceof HTMLElement)) throw new Error("Ring panel did not render");
    expect(panel.getAttribute("aria-label")).toBe("Categories compact classification");
    expect(within(panel).getByText("Categories")).toBeTruthy();

    const segments = Array.from(panel.querySelectorAll<SVGPathElement>(".flow-compact-productivity-circle__segment"));
    expect(segments.map((segment) => segment.getAttribute("stroke"))).toEqual([
      "var(--category-workspace)",
      "var(--category-unknown)",
    ]);

    const legend = panel.querySelector(".flow-compact-split-chart__legend");
    if (!(legend instanceof HTMLElement)) throw new Error("Ring legend did not render");
    expect(within(legend).getByText("Workspace")).toBeTruthy();
    expect(within(legend).getByText("Unclassified")).toBeTruthy();

    // All entries carry classified time, so there is no unclassified remainder note.
    expect(panel.querySelector(".flow-compact-productivity-circle__note")).toBeNull();
  });

  it("keeps the classified-time percent without explanatory labels", () => {
    const totalSeconds = 4 * 3600;
    const classifiedSeconds = 2 * 3600;
    const entries: CompactRingEntry[] = [
      {
        key: "focus",
        label: "Focus",
        color: "var(--flow-tone-focus)",
        totalSeconds: 3600,
        ratio: 3600 / classifiedSeconds,
        matchesBlock: (block) => block.productivity === "focus",
      },
      {
        key: "drift",
        label: "Drift",
        color: "var(--flow-tone-drift)",
        totalSeconds: 3600,
        ratio: 3600 / classifiedSeconds,
        matchesBlock: (block) => block.productivity === "drift",
      },
    ];

    const { container } = render(
      <CompactRingChart
        title="Productivity"
        entries={entries}
        totalSeconds={totalSeconds}
        centerPercent={50}
        flowBlocks={[]}
        appIcons={appIcons}
      />,
    );

    expect(container.querySelector(".flow-compact-productivity-circle__center span")).toBeNull();
    expect(container.querySelector(".flow-compact-productivity-circle__coverage")).toBeNull();
    const segments = container.querySelectorAll(".flow-compact-productivity-circle__segment");
    expect(segments).toHaveLength(2);
  });

  it("opens a hover card with the entry label and app breakdown on segment hover", () => {
    const totalSeconds = 20 * 60;
    const flowBlocks = [
      {
        id: "b1",
        day: "2026-07-05",
        hour: 9,
        quarter: 0,
        minuteOfDay: 9 * 60,
        appName: "cmux",
        category: "workspace",
        productivity: "focus",
        classificationSource: "registry",
        colorKey: "cmux",
        durationSeconds: 20 * 60,
      },
    ] as unknown as FlowBlock[];
    const entries: CompactRingEntry[] = [
      {
        key: "focus",
        label: "Focus",
        color: "var(--flow-tone-focus)",
        totalSeconds: 20 * 60,
        ratio: 1,
        matchesBlock: (block) => block.productivity === "focus",
        dotClassName: "productivity-dot--focus",
      },
    ];

    const { container } = render(
      <CompactRingChart
        title="Productivity"
        entries={entries}
        totalSeconds={totalSeconds}
        centerPercent={100}
        flowBlocks={flowBlocks}
        appIcons={appIcons}
      />,
    );

    const segment = container.querySelector(".flow-compact-productivity-circle__segment");
    if (!segment) throw new Error("Ring segment did not render");

    fireEvent.mouseEnter(segment, { clientX: 100, clientY: 100 });
    const hoverCard = document.body.querySelector(".compact-classification-hover-card");
    expect(hoverCard).toBeTruthy();
    expect(within(hoverCard as HTMLElement).getByText(/^Focus$/)).toBeTruthy();
    expect(within(hoverCard as HTMLElement).getByText("cmux")).toBeTruthy();

    fireEvent.mouseLeave(segment);
    expect(document.body.querySelector(".compact-classification-hover-card")).toBeNull();
  });
});
