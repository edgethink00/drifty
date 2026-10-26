// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFlowBlocks, type ActivitySegment, type FlowBlock } from "@drifty/domain";
import { buildFlowActivityInspectorEvent } from "./FlowHoverLayer";
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
  it("offers the one-minute contributor's own evidence without changing winner edits or including remote records", () => {
    const day = "2026-04-06";
    const rows: ActivitySegment[] = [
      { id: "1", appName: "drifty", startedAt: `${day}T09:00:00`, endedAt: `${day}T09:05:00`, durationSeconds: 300, platform: "macos", source: "accessibility" },
      { id: "2", appName: "TextEdit", startedAt: `${day}T09:05:00`, endedAt: `${day}T09:06:00`, durationSeconds: 60, platform: "macos", source: "accessibility" },
      { id: "3", appName: "drifty", startedAt: `${day}T09:06:00`, endedAt: `${day}T09:12:00`, durationSeconds: 360, platform: "macos", source: "accessibility" },
    ];
    const byId = new Map(rows.map(row => [row.id, row]));
    const group = buildFlowBlockHoverGroups(buildFlowBlocks(rows, day, 3), 3, 0, byId).get(540)!;
    const event = buildFlowActivityInspectorEvent(group, { segmentsById: byId, boundaryMinutes: 0 });
    expect(event.segmentIds).toEqual(["1", "3"]);
    expect(event.screenEvidenceOptions?.map(option => option.label)).toEqual(["drifty", "TextEdit"]);
    expect(event.screenEvidenceOptions?.[1].selection).toEqual({ recordIds: ["2"], windows: [[Date.parse(rows[1].startedAt), Date.parse(rows[1].endedAt!)]] });
    expect(event.screenEvidenceSelection?.recordIds).toEqual(["1", "3"]);
    byId.set("2", { ...rows[1], deviceId: "remote-pc", platform: "windows" });
    const remote = buildFlowActivityInspectorEvent(group, { segmentsById: byId, boundaryMinutes: 0 });
    expect(remote.screenEvidenceOptions?.map(option => option.label)).toEqual(["drifty"]);
    expect(remote.segmentIds).toEqual(["1", "3"]);
  });
  it("attributes each app to its actual device on hover and click while preserving elapsed time and winner edits", () => {
    const records: ActivitySegment[] = [
      { id: "local-editor", appName: "Editor", startedAt: "2026-04-06T09:00:00", endedAt: "2026-04-06T09:30:00", durationSeconds: 1800, platform: "macos", source: "manual", classification: { category: "workspace", productivity: "focus", source: "manual", confidence: 1 } },
      { id: "remote-video", appName: "Video", startedAt: "2026-04-06T09:00:00", endedAt: "2026-04-06T09:30:00", durationSeconds: 1800, deviceId: "pc", platform: "windows", source: "manual", classification: { category: "entertainment", productivity: "drift", source: "manual", confidence: 1 } },
    ];
    const blocks = buildFlowBlocks(records, "2026-04-06", 3);
    const group = buildFlowBlockHoverGroups(blocks, 3, 0, new Map(records.map(record => [record.id, record]))).get(540)!;
    expect(group.durationSeconds).toBe(1800);
    expect(group.segmentIds).toEqual(["local-editor"]);
    expect(new Set(group.displaySegmentIds)).toEqual(new Set(["local-editor", "remote-video"]));

    render(<FlowChartView blocks={blocks} segments={records} appIcons={{}} intervalMinutes={3}
      deviceLabelById={new Map([["pc", "Windows PC"]])} />);
    const cell = screen.getAllByRole("button", { name: /time block: 09:00–09:30/i })[0];
    expect(cell.getAttribute("aria-label")).toContain("30m");
    fireNativePointerMove(cell, 120, 80);
    const preview = screen.getByRole("tooltip");
    const header = preview.querySelector("header")!;
    expect(within(header).getByText("This device")).toBeTruthy();
    expect(within(header).queryByText("Windows PC")).toBeNull();
    expect(within(header).getByRole("img", { name: "macOS" })).toBeTruthy();
    expect(within(header).queryByRole("img", { name: "Windows" })).toBeNull();
    expect(header.querySelector('[data-platform="macos"]')).toBeTruthy();
    expect(header.querySelector('[data-platform="windows"]')).toBeNull();
    expect(header.compareDocumentPosition(preview.querySelector(".week-activity-inspector__attributes")!)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(preview.textContent).toContain("09:00–09:30 · 30m");
    expect(within(preview).getAllByText("15m")).toHaveLength(2);

    const assertSources = (container: HTMLElement) => {
      const rows = within(container).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toContain("Editor · dominant");
      expect(within(rows[0]).getByText("This device")).toBeTruthy();
      expect(within(rows[0]).queryByText("Windows PC")).toBeNull();
      expect(rows[1].textContent).toContain("Video");
      expect(within(rows[1]).getByText("Windows PC")).toBeTruthy();
      expect(within(rows[1]).queryByText("This device")).toBeNull();
    };
    assertSources(preview);
    fireEvent.click(cell);
    const inspector = screen.getByRole("dialog", { name: "Editor" });
    expect(within(inspector).getByText("Windows PC")).toBeTruthy();
    expect(inspector.textContent).toContain("09:00–09:30 · 30m");
    assertSources(inspector);
  });
  it("keeps both devices when the same app actually ran on both, and shows local provenance with known other devices", () => {
    const local: ActivitySegment = { id: "local", appName: "Editor", startedAt: "2026-04-06T09:00:00", endedAt: "2026-04-06T09:30:00", durationSeconds: 1800, platform: "macos", source: "manual" };
    const remote: ActivitySegment = { ...local, id: "remote", deviceId: "pc", platform: "windows" };
    const labels = new Map([["pc", "Windows PC"]]);
    const eventFor = (records: ActivitySegment[]) => {
      const byId = new Map(records.map((record) => [record.id, record]));
      const group = buildFlowBlockHoverGroups(buildFlowBlocks(records, "2026-04-06", 3), 3, 0, byId).get(540)!;
      return buildFlowActivityInspectorEvent(group, { segmentsById: byId, deviceLabelById: labels, thisDeviceLabel: "This device", syncedDeviceLabel: "Synced device" });
    };
    const mixed = eventFor([local, remote]);
    expect(mixed.identities).toHaveLength(1);
    expect(mixed.identities[0].sourceSegmentIds).toEqual(["local", "remote"]);
    expect(mixed.devices?.map((device) => device.label)).toEqual(["This device", "Windows PC"]);
    expect(eventFor([local]).devices?.map((device) => device.label)).toEqual(["This device"]);
  });

  it("keeps same-app local and remote records read-only without a warning in Day hover and detail", () => {
    const local: ActivitySegment = { id: "local", appName: "Editor", startedAt: "2026-04-06T09:00:00", endedAt: "2026-04-06T09:30:00", durationSeconds: 1800, platform: "macos", source: "manual" };
    const remote: ActivitySegment = { ...local, id: "remote", deviceId: "pc", platform: "windows" };
    const records = [local, remote];
    const onClassify = vi.fn();
    const onDelete = vi.fn();
    render(<FlowChartView blocks={buildFlowBlocks(records, "2026-04-06", 3)} segments={records} appIcons={{}} intervalMinutes={3}
      deviceLabelById={new Map([["pc", "Windows PC"]])} activityActionsEnabled onClassifyActivity={onClassify} onDeleteActivity={onDelete} />);
    const cell = screen.getAllByRole("button", { name: /time block: 09:00–09:30/i })[0];
    fireNativePointerMove(cell, 120, 80);
    expect(screen.getByRole("tooltip").querySelector(".week-activity-inspector__notice")).toBeNull();
    fireEvent.click(cell);
    const inspector = screen.getByRole("dialog", { name: "Editor" });
    expect(inspector.querySelector(".week-activity-inspector__notice")).toBeNull();
    expect(within(inspector).getByText("This device")).toBeTruthy();
    expect(within(inspector).getByText("Windows PC")).toBeTruthy();
    const category = within(inspector).getByRole<HTMLButtonElement>("button", { name: /Change Category/ });
    const productivity = within(inspector).getByRole<HTMLButtonElement>("button", { name: /Change Productivity/ });
    const deletion = within(inspector).getByRole<HTMLButtonElement>("button", { name: /Delete/ });
    expect(category.disabled).toBe(true);
    expect(productivity.disabled).toBe(true);
    expect(deletion.disabled).toBe(true);
    fireEvent.click(category);fireEvent.click(deletion);
    expect(onClassify).not.toHaveBeenCalled();expect(onDelete).not.toHaveBeenCalled();
  });

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

    const hoverCard = document.querySelector('.week-activity-inspector[data-mode="peek"]');
    expect(hoverCard?.textContent).toContain("01:00–01:30");
    expect(hoverCard?.textContent).toContain("30m");
    expect(hoverCard?.getAttribute("role")).toBe("tooltip");
    expect(within(hoverCard as HTMLElement).queryByRole("button")).toBeNull();
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
