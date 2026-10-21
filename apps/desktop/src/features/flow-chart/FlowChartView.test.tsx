// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivitySegment, FlowBlock, FlowIntervalMinutes } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";
import { buildFlowActivityInspectorEvent } from "./FlowHoverLayer";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
import { SiteIconProvider } from "../../components/SiteIconContext";
import { readAppStyles } from "../../test/readStyles";

const styles = readAppStyles();

function makeFlowBlock(overrides: Partial<FlowBlock> = {}): FlowBlock {
  return {
    id: "flow-block",
    day: "2026-04-06",
    hour: 14,
    quarter: 0,
    minuteOfDay: 14 * 60,
    appName: "Arc",
    bundleId: "company.thebrowser.Browser",
    browserName: "Arc",
    siteDomain: "docs.example.com",
    siteTitle: "Docs",
    windowTitle: "Docs / Flow",
    category: "workspace",
    productivity: "focus",
    colorKey: "docs.example.com",
    durationSeconds: 180,
    ...overrides,
  };
}

function expectedRowLabels(intervalMinutes: FlowIntervalMinutes): string[] {
  return Array.from({ length: 60 / intervalMinutes }, (_, index) => `:${String(index * intervalMinutes).padStart(2, "0")}`);
}

function expectedCellMinHeight(intervalMinutes: FlowIntervalMinutes): string {
  return `${(0.5 * intervalMinutes) / 3}rem`;
}

function expectedBreakdownCellMinHeight(intervalMinutes: FlowIntervalMinutes): string {
  return `${(0.76 * intervalMinutes) / 3}rem`;
}

function expectedMinuteAxisFontSize(_intervalMinutes: FlowIntervalMinutes): string {
  // The minute axis sits a hair under the shared 11px floor at every interval.
  // It is the densest repeated label in the app, so it is trimmed 3% to keep it
  // from reading heavier than its surroundings; the denser 3-minute view no
  // longer shrinks further, which is what made it unreadable before.
  return "0.667rem";
}

function visibleHourLabels(): string[] {
  return Array.from(document.querySelectorAll(".flow-chart-hours > span"), (label) => label.textContent ?? "")
    .filter((label) => label.length > 0);
}

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

function fireNativePointerMove(target: Element, clientX: number, clientY: number): void {
  fireEvent(target, new MouseEvent("pointermove", { bubbles: true, clientX, clientY }));
}

it("keeps the minute axis and activity heading outside the scrolling day", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  try {
    const { container } = render(<FlowChartView
      blocks={[makeFlowBlock()]} appIcons={{}} orientation="hoursDown" intervalMinutes={4}
      rowAside={{ header: "Activities", overlay: <span>Task</span> }}
      scrollScale={{ zoomPercent: 150, dayKey: "2026-04-06", initialMinute: 840 }}
    />);
    const axis = container.querySelector(".flow-chart-minutes")!;
    const scroller = container.querySelector(".flow-chart-scroll-area")!;
    expect(scroller.contains(axis)).toBe(false);
    expect(axis.parentElement).toBe(scroller.parentElement);
    expect(axis.textContent).toContain("Activities");
    expect(scroller.querySelectorAll(".flow-chart-row--hour")).toHaveLength(24);
    expect(scroller.textContent).toContain("Task");
    expect(container.querySelectorAll(".flow-chart-minutes")).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

function setElementRect(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  });
}

type BlockPlacementCase = {
  intervalMinutes: FlowIntervalMinutes;
  minuteOffset: number;
  rowLabel: string;
  endTime: string;
};

const blockPlacementCases: BlockPlacementCase[] = [
  { intervalMinutes: 3, minuteOffset: 6, rowLabel: ":06", endTime: "14:09" },
  { intervalMinutes: 4, minuteOffset: 8, rowLabel: ":08", endTime: "14:12" },
  { intervalMinutes: 5, minuteOffset: 5, rowLabel: ":05", endTime: "14:10" },
  { intervalMinutes: 6, minuteOffset: 12, rowLabel: ":12", endTime: "14:18" },
];

describe("FlowChartView", () => {
  it("keeps the unclassified tone static instead of implying per-cell progress", () => {
    expect(cssRule(".flow-cell--unclassified.flow-cell--unclassified")).toContain("background: var(--category-unknown);");
    expect(styles).not.toContain(".flow-cell--unclassified-pending");
    expect(styles).not.toContain("@keyframes flow-cell-classifying-pulse");
  });

  it("folds the Unclassified label before the head reaches its stacking breakpoint", () => {
    // The head is only meant to stack under 660px, so the chip has to shed its
    // long word above that to keep the row on one line in between.
    const foldedLabelRule = cssRule(".flow-chart-legend__group--unclassified .flow-chart-legend__label");
    expect(foldedLabelRule).toContain("width: 0;");
    // Collapsed rather than display:none so the chip keeps the height of the
    // Focus/Neutral/Drift chips it sits beside.
    expect(foldedLabelRule).not.toContain("display: none;");
    // Korean "미분류" wraps per character at width:0; keep the folded label
    // on one line so the chip does not stretch into a tall capsule.
    expect(foldedLabelRule).toContain("white-space: nowrap;");
    const foldBreakpoint = styles.indexOf("@container (max-width: 820px)");
    const stackBreakpoint = styles.indexOf("@container (max-width: 660px)");
    expect(foldBreakpoint).toBeGreaterThan(-1);
    expect(stackBreakpoint).toBeGreaterThan(-1);
  });

  it("constrains long hover identity labels inside their compact chips", () => {
    const identityLabelRule = cssRule(".flow-hover-card__identity-label");

    expect(identityLabelRule).toContain("min-width: 0;");
    expect(identityLabelRule).toContain("overflow: hidden;");
    expect(identityLabelRule).toContain("text-overflow: ellipsis;");
    expect(identityLabelRule).toContain("white-space: nowrap;");
  });

  it("keeps category legend dots at the JEO-10 enlarged marker size", () => {
    const categoryDotRule = cssRule(".flow-chart-legend__dot");
    const toneDotRule = cssRule(".flow-chart-legend__tone-dot");

    expect(categoryDotRule).toContain("width: 0.546rem;");
    expect(categoryDotRule).toContain("height: 0.546rem;");
    expect(categoryDotRule).toContain("display: inline-block;");
    expect(categoryDotRule).toContain("flex: 0 0 0.546rem;");
    expect(categoryDotRule).toContain("aspect-ratio: 1;");
    expect(toneDotRule).toContain("width: 0.546rem;");
    expect(toneDotRule).toContain("height: 0.546rem;");
    expect(toneDotRule).toContain("display: inline-block;");
    expect(toneDotRule).toContain("flex: 0 0 0.546rem;");
    expect(toneDotRule).toContain("aspect-ratio: 1;");
  });

  it("keeps the agent detail control quiet without flattening shared color mode controls", () => {
    const detailControlRule = cssRule(".flow-detail-select");
    const detailTriggerRule = cssRule(".flow-detail-select .settings-select-control__trigger");
    const detailMenuRule = cssRule(".flow-detail-select .settings-select-control__menu");
    const colorModeControlRule = cssRule(".flow-color-mode-control");
    const colorModeButtonRule = cssRule(".flow-color-mode-control button");

    expect(detailControlRule).toContain("width: 1.7rem;");
    expect(detailControlRule).toContain("min-width: 1.7rem;");
    expect(detailTriggerRule).toContain("border-color: transparent;");
    expect(detailTriggerRule).toContain("background: transparent;");
    expect(detailMenuRule).toContain("width: 4.75rem;");
    expect(colorModeControlRule).toContain("padding: 1.78px;");
    expect(colorModeButtonRule).toContain("min-height: 1.08rem;");
    expect(colorModeButtonRule).toContain("padding: 0.1rem 0.38rem;");
    expect(colorModeButtonRule).toContain("font-size: 0.6875rem;");
    expect(colorModeButtonRule).toContain("letter-spacing: 0.05em;");
  });

  it("shows color mode controls without a Flow detail menu", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={4} />);

    expect(screen.queryByRole("combobox", { name: /Flow detail/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Category" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
    expect(screen.getByRole("button", { name: "Productivity" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("4-minute flow chart").getAttribute("data-flow-color-mode")).toBe("productivity");
  });

  it("tightens only the flow chart shell spacing while preserving cell scale", () => {
    expect(styles).toMatch(/\.flow-breakdown-layout__chart\s*{[\s\S]*padding:\s*7px 8px 9px;/);
    expect(styles).toMatch(/\.flow-chart-card\s*{[\s\S]*gap:\s*8px;/);
    expect(styles).toMatch(/\.flow-chart-card\s*{[\s\S]*--flow-axis-gutter:\s*1\.55rem;/);
    expect(styles).toMatch(/\.flow-chart-hours,\s*\.flow-chart-row\s*\{[\s\S]*grid-template-columns:\s*var\(--flow-axis-gutter\) repeat\(24,\s*minmax\(1\.55rem,\s*1fr\)\);/);
    expect(cssRule(".flow-chart-hours")).toContain("font-size: 0.6875rem;");
    expect(cssRule(".flow-chart-row-label")).toContain("font-size: var(--flow-minute-axis-font-size, 0.667rem);");
    expect(styles).toMatch(/\.flow-chart-row--now::before\s*\{[\s\S]*left:\s*calc\(var\(--flow-axis-gutter\) \+ 0\.15rem\);/);
    expect(styles).toMatch(/\.flow-chart-row--now::after\s*\{[\s\S]*left:\s*calc\(var\(--flow-axis-gutter\) \+ \(\(100% - var\(--flow-axis-gutter\)\) \/ 24\) \* \(var\(--flow-current-hour\) \+ 1\)\);/);
    expect(styles).toMatch(/\.flow-compact-split-chart__panel\s*{[\s\S]*gap:\s*5px;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__panel\s*{[\s\S]*padding:\s*0\.44rem 0\.64rem;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__legend-item\s*{[\s\S]*font-size:\s*0\.75rem;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__legend-value\s*{[\s\S]*font-size:\s*0\.71875rem;/);
    expect(styles).toMatch(/\.flow-compact-productivity-circle\s+\.flow-compact-split-chart__legend-item\s*{[\s\S]*font-size:\s*0\.79rem;/);
    expect(styles).toMatch(/\.flow-compact-productivity-circle\s+\.flow-compact-split-chart__legend-value\s*{[\s\S]*font-size:\s*0\.71rem;/);
  });

  it("keeps light empty flow cells softly visible while preserving the dark plot bed", () => {
    const emptyCellRule = cssRule(".flow-cell--empty");

    expect(styles).toMatch(/:root\[data-theme="light"\]\s*\{[\s\S]*--flow-chart-plot-surface:\s*#fafaf8;/);
    expect(styles).toMatch(/:root\[data-theme="light"\]\s*\{[\s\S]*--flow-chart-empty-cell-surface:\s*color-mix\(in srgb,\s*var\(--bg-2\) 62%,\s*var\(--surface\)\);/);
    expect(styles).toMatch(/:root\[data-theme="light"\]\s*\{[\s\S]*--flow-chart-empty-cell-opacity:\s*0\.58;/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*--flow-chart-plot-surface:\s*#191917;/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*--flow-chart-empty-cell-surface:\s*transparent;/);
    expect(styles).toMatch(/:root\[data-theme="dark"\]\s*\{[\s\S]*--flow-chart-empty-cell-opacity:\s*1;/);
    expect(emptyCellRule).toContain("background: var(--flow-chart-empty-cell-surface);");
    expect(emptyCellRule).toContain("opacity: var(--flow-chart-empty-cell-opacity);");
  });

  it("uses compact 12-hour labels on the flow chart hour axis", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    expect(visibleHourLabels()).toEqual(["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"]);
  });

  it("orders hour labels from the configured logical start of day", () => {
    render(<FlowChartView blocks={[makeFlowBlock({ minuteOfDay: 4 * 60 })]} appIcons={{}} intervalMinutes={3} startOfDayMinutes={4 * 60} />);

    expect(visibleHourLabels()).toEqual(["4am", "7am", "10am", "1pm", "4pm", "7pm", "10pm", "1am"]);
  });

  it("uses a desktop right rail while keeping the flow chart full width in its grid cell", () => {
    const flowBreakdownLayoutRule = cssRule(".flow-breakdown-layout");
    const flowBreakdownChartRule = cssRule(".flow-breakdown-layout__chart");
    const compactSplitChartRule = cssRule(".flow-compact-split-chart");
    const compactPanelRule = cssRule(".flow-compact-split-chart__panel");

    expect(flowBreakdownLayoutRule).toContain("grid-template-columns: minmax(0, 4fr) minmax(12rem, 1fr);");
    expect(flowBreakdownChartRule).toContain("width: 100%;");
    expect(flowBreakdownChartRule).not.toContain("width: 80%;");
    expect(compactSplitChartRule).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(compactSplitChartRule).toContain("grid-template-rows: repeat(2, minmax(0, 1fr));");
    expect(compactSplitChartRule).toContain("align-self: stretch;");
    expect(compactSplitChartRule).toContain("align-content: stretch;");
    expect(compactPanelRule).toContain("min-height: 0;");
    expect(styles).toMatch(/\.flow-compact-split-chart__legend\s*\{[\s\S]*display:\s*grid;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__legend-item\s*\{[\s\S]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__legend-label\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
    expect(styles).toMatch(/@media\s*\(max-width:\s*760px\)\s*\{[\s\S]*\.flow-breakdown-layout\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    expect(styles).toMatch(/\.flow-chart-hours,\s*\.flow-chart-row\s*\{[\s\S]*min-width:\s*48rem;/);
    expect(styles).toMatch(/\.flow-breakdown-layout__chart \.flow-chart-row,\s*\.flow-breakdown-layout__chart \.flow-chart-hours\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;/);
  });

  it.each([3, 4, 5, 6] as const)("renders %dm-specific minute rows", (intervalMinutes: FlowIntervalMinutes) => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={intervalMinutes} />);

    const rowLabels = Array.from(document.querySelectorAll(".flow-chart-row-label"), (label) => label.textContent);
    const chart = document.querySelector(".flow-chart-card") as HTMLElement;

    expect(rowLabels).toEqual(expectedRowLabels(intervalMinutes));
    expect(chart.style.getPropertyValue("--flow-cell-min-height")).toBe(expectedCellMinHeight(intervalMinutes));
    expect(chart.style.getPropertyValue("--flow-breakdown-cell-min-height")).toBe(expectedBreakdownCellMinHeight(intervalMinutes));
    expect(chart.style.getPropertyValue("--flow-minute-axis-font-size")).toBe(expectedMinuteAxisFontSize(intervalMinutes));
  });

  it.each(blockPlacementCases)("places a %dm block on the selected interval row", ({ intervalMinutes, minuteOffset, rowLabel, endTime }: BlockPlacementCase) => {
    const block = makeFlowBlock({
      id: `${intervalMinutes}-minute-docs`,
      minuteOfDay: 14 * 60 + minuteOffset,
      durationSeconds: intervalMinutes * 60,
    });

    render(<FlowChartView blocks={[block]} appIcons={{}} intervalMinutes={intervalMinutes} />);

    const startTime = `14:${String(minuteOffset).padStart(2, "0")}`;
    const cell = screen.getByRole("button", { name: new RegExp(`time block: ${startTime}–${endTime}`, "i") });
    const row = cell.closest(".flow-chart-row") as HTMLElement;

    expect(row.querySelector(".flow-chart-row-label")?.textContent).toBe(rowLabel);
  });

  it("keeps the current-time marker inside the terminal interval row", () => {
    render(<FlowChartView blocks={[makeFlowBlock({ minuteOfDay: 23 * 60 + 56 })]} appIcons={{}} intervalMinutes={4} currentMinuteOfDay={23 * 60 + 56} />);

    const currentRow = document.querySelector(".flow-chart-row--now") as HTMLElement;

    expect(currentRow.querySelector(".flow-chart-row-label")?.textContent).toBe(":56");
    expect(currentRow.classList.contains("flow-chart-row--now-terminal")).toBe(true);
  });

  it("pulls the current-time arrow inside the terminal logical hour", () => {
    render(
      <FlowChartView
        blocks={[makeFlowBlock({ minuteOfDay: 3 * 60 + 9 })]}
        appIcons={{}}
        intervalMinutes={3}
        currentMinuteOfDay={3 * 60 + 9}
        startOfDayMinutes={4 * 60}
      />,
    );

    const currentRow = document.querySelector(".flow-chart-row--now") as HTMLElement;
    const terminalHourRule = cssRule(".flow-chart-row--now-terminal-hour::after");

    expect(currentRow.querySelector(".flow-chart-row-label")?.textContent).toBe(":09");
    expect(currentRow.classList.contains("flow-chart-row--now-terminal-hour")).toBe(true);
    expect(terminalHourRule).toContain("transform: translate(calc(-0.08rem - 5px), -50%);");
  });

  it("draws the current hour pill without shifting or clipping the hour-axis label", () => {
    render(<FlowChartView blocks={[makeFlowBlock({ minuteOfDay: 14 * 60 + 6 })]} appIcons={{}} intervalMinutes={3} currentMinuteOfDay={14 * 60 + 6} />);

    const currentHourLabel = Array.from(document.querySelectorAll(".flow-chart-hours > span"))
      .find((label) => label.textContent === "2pm");
    const currentMinuteLabel = document.querySelector(".flow-chart-row--time-label .flow-chart-row-label");
    const gridRule = cssRule(".flow-chart-grid");
    const hoursRule = cssRule(".flow-chart-hours");
    const currentHourRule = cssRule(".flow-chart-hours .flow-chart-hour--now");
    const currentHourBackgroundRule = cssRule(".flow-chart-hours .flow-chart-hour--now::before");
    const currentHourArrowRule = cssRule(".flow-chart-hours .flow-chart-hour--now::after");
    const currentMinuteRule = cssRule(".flow-chart-row--time-label .flow-chart-row-label");
    const sharedCurrentTimeDeclarations = [
      "border-radius: 999px;",
      "background: var(--text);",
      "box-shadow: 0 0 0 1px color-mix(in srgb, var(--text) 20%, transparent), 0 0 8px color-mix(in srgb, var(--text) 12%, transparent);",
    ];

    expect(currentHourLabel?.classList.contains("flow-chart-hour--now")).toBe(true);
    expect(currentMinuteLabel?.textContent).toBe(":09");
    expect(gridRule).toContain("overflow-x: auto;");
    expect(gridRule).toContain("overflow-y: hidden;");
    expect(hoursRule).toContain("overflow: visible;");
    expect(currentHourRule).toContain("justify-self: center;");
    expect(currentHourRule).not.toContain("padding:");
    expect(currentHourRule).toContain("color: color-mix(in srgb, var(--surface) 92%, white);");
    expect(currentMinuteRule).toContain("color: color-mix(in srgb, var(--surface) 92%, white);");
    expect(currentHourBackgroundRule).toContain("inset: -0.1rem -0.3rem -0.09rem;");
    expect(currentHourArrowRule).toContain("display: none;");
    for (const declaration of sharedCurrentTimeDeclarations) {
      expect(currentHourBackgroundRule).toContain(declaration);
      expect(currentMinuteRule).toContain(declaration);
    }
  });

  it("places a 4-minute block on the selected 4-minute row", () => {
    const block = makeFlowBlock({
      id: "four-minute-docs",
      minuteOfDay: 14 * 60 + 8,
      durationSeconds: 240,
    });

    render(<FlowChartView blocks={[block]} appIcons={{}} intervalMinutes={4} />);

    const cell = screen.getByRole("button", { name: /time block: 14:08–14:12/i });
    const row = cell.closest(".flow-chart-row") as HTMLElement;

    expect(document.querySelector(".flow-chart-card")?.getAttribute("data-flow-interval")).toBe("4");
    expect(cell.getAttribute("aria-label")).toContain("Time block: 14:08–14:12");
    expect(row.querySelector(".flow-chart-row-label")?.textContent).toBe(":08");
    expect(Array.from(document.querySelectorAll(".flow-chart-row-label"), (label) => label.textContent)).not.toContain(":09");

    fireNativePointerMove(cell, 100, 100);

    expect(screen.getByRole("tooltip").textContent).toContain("14:08–14:12");
  });

  it("uses site identity instead of the browser app in hover labels", () => {
    const block: FlowBlock = {
      id: "browser-instagram",
      day: "2026-04-06",
      hour: 14,
      quarter: 0,
      minuteOfDay: 14 * 60,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Chrome",
      siteDomain: "instagram.com",
      siteTitle: "Instagram",
      windowTitle: "Instagram / Direct",
      category: "social_media",
      productivity: "drift",
      colorKey: "instagram.com",
      durationSeconds: 300,
    };

    render(
      <SiteIconProvider value={{ "instagram.com": "data:image/png;base64,instagram" }}>
        <FlowChartView blocks={[block]} appIcons={{ "com.google.Chrome": "data:image/png;base64,chrome" }} intervalMinutes={5} />
      </SiteIconProvider>,
    );

    const cell = screen.getByRole("button", { name: /instagram\.com/i });
    expect(cell.getAttribute("aria-label")).not.toContain("Google Chrome");

    fireNativePointerMove(cell, 120, 80);

    expect(screen.getAllByText("instagram.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("Google Chrome")).toBeNull();
  });

  it("anchors the read-only flow preview to its block instead of the pointer", async () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    setElementRect(cell, 80, 90, 120, 40);
    fireNativePointerMove(cell, 120, 80);
    const preview = screen.getByRole("tooltip", { name: "docs.example.com" });

    expect(preview.style.left).toBe("212px");
    expect(preview.style.top).toBe("90px");
    expect(preview.getAttribute("data-mode")).toBe("peek");
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(within(preview).queryByRole("textbox")).toBeNull();
    expect(within(preview).queryByRole("listbox")).toBeNull();
    expect(preview.querySelector('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')).toBeNull();

    fireNativePointerMove(cell, 180, 120);

    await waitFor(() => {
      expect(preview.style.left).toBe("212px");
      expect(preview.style.top).toBe("90px");
    });
  });

  it("keeps pointer scanning non-blocking and dismisses it on the first empty cell", () => {
    const { container } = render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);
    const grid = container.querySelector<HTMLElement>(".flow-chart-grid");
    const emptyCell = container.querySelector<HTMLElement>(".flow-cell--empty");
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    if (!grid || !emptyCell) throw new Error("expected the flow chart grid and an empty cell");

    fireNativePointerMove(cell, 120, 80);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();
    expect(styles).toMatch(/\.week-activity-inspector--preview\s*\{[^}]*pointer-events:\s*none;/);
    expect(document.querySelector(".week-activity-inspector__hover-bridge")).toBeNull();

    fireNativePointerMove(emptyCell, 126, 86);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
  });

  it("coalesces rapid flow retargeting into one settled inspector update", () => {
    vi.useFakeTimers();
    try {
      const blocks = [
        makeFlowBlock(),
        makeFlowBlock({
          id: "flow-mail",
          minuteOfDay: 14 * 60 + 3,
          siteDomain: "mail.example.com",
          siteTitle: "Mail",
          windowTitle: "Mail / Inbox",
          colorKey: "mail.example.com",
        }),
        makeFlowBlock({
          id: "flow-tasks",
          minuteOfDay: 14 * 60 + 6,
          siteDomain: "tasks.example.com",
          siteTitle: "Tasks",
          windowTitle: "Tasks / Today",
          colorKey: "tasks.example.com",
        }),
      ];
      const { container } = render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
      const firstCell = container.querySelector<HTMLElement>('button.flow-cell[data-flow-minute="840"]');
      const secondCell = container.querySelector<HTMLElement>('button.flow-cell[data-flow-minute="843"]');
      const thirdCell = container.querySelector<HTMLElement>('button.flow-cell[data-flow-minute="846"]');
      if (!firstCell || !secondCell || !thirdCell) throw new Error("expected three adjacent flow cells");

      fireNativePointerMove(firstCell, 120, 80);
      expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')?.textContent).toContain("docs.example.com");

      fireNativePointerMove(secondCell, 140, 80);
      fireNativePointerMove(thirdCell, 160, 80);
      expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')?.textContent).toContain("docs.example.com");

      act(() => vi.advanceTimersByTime(15));
      expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')?.textContent).toContain("docs.example.com");

      act(() => vi.advanceTimersByTime(1));
      const settledPreview = document.querySelector('.week-activity-inspector[data-mode="peek"]');
      expect(settledPreview?.textContent).toContain("tasks.example.com");
      expect(settledPreview?.textContent).not.toContain("mail.example.com");
    } finally {
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("dismisses a pointer-opened flow preview immediately when the pointer leaves the app", () => {
    const { container } = render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });

    fireNativePointerMove(cell, 120, 80);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();

    fireEvent(document, new MouseEvent("mouseleave"));
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();

    fireNativePointerMove(cell, 120, 80);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();

    fireEvent(window, new Event("blur"));
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(container.querySelector(".flow-hover-group-highlight")).toBeNull();
  });

  it("keeps the anchored flow preview inside a narrow viewport", async () => {
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;

    try {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 });
      render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

      const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
      setElementRect(cell, 350, 450, 30, 20);
      fireNativePointerMove(cell, 370, 450);
      const card = screen.getByRole("tooltip", { name: "docs.example.com" });
      setElementRect(card, 0, 0, 304, 120);

      fireEvent(window, new Event("resize"));

      await waitFor(() => {
        expect(card.style.left).toBe("34px");
        expect(card.style.top).toBe("344px");
      });
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    }
  });

  it("publishes the active group to the card lane for pointer and keyboard interaction", () => {
    const onHoverGroupChange = vi.fn();
    const { container, unmount } = render(<FlowChartView blocks={[makeFlowBlock({ sourceSegmentIds: ["record-1"] })]} appIcons={{}} onHoverGroupChange={onHoverGroupChange} />);
    const cell = container.querySelector<HTMLButtonElement>("button.flow-cell")!;
    fireNativePointerMove(cell, 100, 100);
    expect(onHoverGroupChange).toHaveBeenLastCalledWith(expect.objectContaining({ segmentIds: ["record-1"] }));
    fireEvent.pointerLeave(container.querySelector(".flow-chart-grid")!);
    expect(onHoverGroupChange).toHaveBeenLastCalledWith(null);
    act(() => cell.focus());
    expect(onHoverGroupChange).toHaveBeenLastCalledWith(expect.objectContaining({ segmentIds: ["record-1"] }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onHoverGroupChange).toHaveBeenLastCalledWith(null);
    unmount();
    expect(onHoverGroupChange).toHaveBeenLastCalledWith(null);
  });

  it("keeps one group preview anchored to the first hovered cell while scanning that group", async () => {
    const firstBlock = makeFlowBlock();
    const nextBlock = makeFlowBlock({
      id: "flow-block-next",
      minuteOfDay: 14 * 60 + 3,
    });
    render(<FlowChartView blocks={[firstBlock, nextBlock]} appIcons={{}} intervalMinutes={3} />);

    const [firstCell, nextCell] = screen.getAllByRole("button", { name: /time block: 14:00–14:06/i });
    setElementRect(firstCell, 80, 90, 30, 20);
    setElementRect(nextCell, 110, 90, 30, 20);
    fireNativePointerMove(nextCell, 320, 190);
    const preview = screen.getByRole("tooltip", { name: "docs.example.com" });

    expect(preview.style.left).toBe("152px");
    expect(preview.style.top).toBe("90px");

    fireNativePointerMove(firstCell, 120, 80);

    await waitFor(() => {
      expect(preview.style.left).toBe("152px");
      expect(preview.style.top).toBe("90px");
    });
  });

  it("keeps the visible preview position through click focus, pinning and an unchanged-group refresh", async () => {
    const blocks = [
      makeFlowBlock({ sourceSegmentIds: ["source-activity"] }),
      makeFlowBlock({ id: "next-cell", minuteOfDay: 14 * 60 + 3, sourceSegmentIds: ["source-activity"] }),
    ];
    const { rerender } = render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
    const [clickedCell, hoveredCell] = screen.getAllByRole<HTMLButtonElement>("button", { name: /time block: 14:00–14:06/i });
    setElementRect(clickedCell, 80, 180, 30, 20);
    setElementRect(hoveredCell, 110, 90, 30, 20);
    fireNativePointerMove(hoveredCell, 125, 95);
    fireNativePointerMove(clickedCell, 85, 185);
    const preview = screen.getByRole("tooltip", { name: "docs.example.com" });
    const previewPosition = { left: preview.style.left, top: preview.style.top };
    expect(previewPosition).toEqual({ left: "152px", top: "90px" });

    // A real pointer click focuses its cell before React receives the click.
    fireEvent(clickedCell, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    act(() => clickedCell.focus());
    fireEvent(clickedCell, new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect({ left: preview.style.left, top: preview.style.top }).toEqual(previewPosition);
    fireEvent.click(clickedCell);
    const inspector = screen.getByRole("dialog", { name: "docs.example.com" });
    expect({ left: inspector.style.left, top: inspector.style.top }).toEqual(previewPosition);

    rerender(<FlowChartView blocks={blocks.map((block) => ({ ...block }))} appIcons={{}} intervalMinutes={3} />);
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBe(inspector);
    expect({ left: inspector.style.left, top: inspector.style.top }).toEqual(previewPosition);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(clickedCell));
    expect(cssRule("button.flow-cell:hover")).toContain("transform: none");
  });

  it("anchors keyboard navigation to the focused cell after hovering elsewhere in the same group", () => {
    const blocks = [
      makeFlowBlock({ sourceSegmentIds: ["source-activity"] }),
      makeFlowBlock({ id: "next-cell", minuteOfDay: 14 * 60 + 3, sourceSegmentIds: ["source-activity"] }),
    ];
    render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
    const [focusedCell, hoveredCell] = screen.getAllByRole<HTMLButtonElement>("button", { name: /time block: 14:00–14:06/i });
    setElementRect(focusedCell, 80, 180, 30, 20);
    setElementRect(hoveredCell, 110, 90, 30, 20);
    fireNativePointerMove(hoveredCell, 125, 95);
    expect(screen.getByRole("tooltip").style.top).toBe("90px");

    fireEvent.keyDown(document, { key: "Tab" });
    act(() => focusedCell.focus());
    const preview = screen.getByRole("tooltip", { name: "docs.example.com" });
    expect({ left: preview.style.left, top: preview.style.top }).toEqual({ left: "122px", top: "180px" });
    fireEvent.click(focusedCell, { detail: 0 });
    const inspector = screen.getByRole("dialog", { name: "docs.example.com" });
    expect({ left: inspector.style.left, top: inspector.style.top }).toEqual({ left: "122px", top: "180px" });
  });

  it("shows site favicon labels in category legend hover breakdowns", () => {
    const block: FlowBlock = {
      id: "browser-instagram",
      day: "2026-04-06",
      hour: 14,
      quarter: 0,
      minuteOfDay: 14 * 60,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Chrome",
      siteDomain: "instagram.com",
      siteTitle: "Instagram",
      windowTitle: "Instagram / Direct",
      category: "social_media",
      productivity: "drift",
      colorKey: "instagram.com",
      durationSeconds: 300,
    };

    render(
      <SiteIconProvider value={{ "instagram.com": "data:image/png;base64,instagram" }}>
        <FlowChartView blocks={[block]} appIcons={{ "com.google.Chrome": "data:image/png;base64,chrome" }} intervalMinutes={5} />
      </SiteIconProvider>,
    );

    fireEvent.mouseEnter(screen.getByLabelText("Social media"), { clientX: 220, clientY: 90 });
    const categoryHover = document.querySelector(".category-hover-card") as HTMLElement;

    expect(categoryHover).toBeTruthy();
    expect(categoryHover.textContent).toContain("instagram.com");
    expect(categoryHover.textContent).not.toContain("Google Chrome");
    expect(categoryHover.querySelector("img.site-favicon")?.getAttribute("src")).toBe("data:image/png;base64,instagram");
  });

  it("moves legend hover cards with the pointer", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    fireEvent.mouseEnter(screen.getByLabelText("Workspace"), { clientX: 220, clientY: 90 });
    const categoryHover = document.querySelector(".category-hover-card") as HTMLElement;

    expect(categoryHover.style.left).toBe("236px");
    expect(categoryHover.style.top).toBe("106px");

    fireEvent.mouseMove(screen.getByLabelText("Workspace"), { clientX: 320, clientY: 190 });

    expect(categoryHover.style.left).toBe("336px");
    expect(categoryHover.style.top).toBe("206px");
  });

  it("shows legend hover breakdowns from productivity labels", () => {
    const block: FlowBlock = {
      id: "browser-instagram",
      day: "2026-04-06",
      hour: 14,
      quarter: 0,
      minuteOfDay: 14 * 60,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      browserName: "Chrome",
      siteDomain: "instagram.com",
      siteTitle: "Instagram",
      windowTitle: "Instagram / Direct",
      category: "social_media",
      productivity: "drift",
      colorKey: "instagram.com",
      durationSeconds: 300,
    };

    render(<FlowChartView blocks={[block]} appIcons={{ "com.google.Chrome": "data:image/png;base64,chrome" }} intervalMinutes={5} />);

    fireEvent.mouseEnter(screen.getByText("Drift"), { clientX: 220, clientY: 90 });
    const categoryHover = document.querySelector(".category-hover-card") as HTMLElement;

    expect(categoryHover).toBeTruthy();
    expect(categoryHover.textContent).toContain("Drift");
    expect(categoryHover.textContent).toContain("Social media");
    expect(categoryHover.textContent).toContain("instagram.com");
    expect(categoryHover.textContent).not.toContain("Google Chrome");
  });
});

describe("FlowChartView activity inspector", () => {
  it("marks mixed source records on the dominant chips and keeps them accessible", () => {
    const block = makeFlowBlock({
      sourceSegmentIds: ["seg-a", "seg-b"],
      category: "workspace",
      productivity: "focus",
    });
    const mixedSegments: ActivitySegment[] = [
      {
        id: "seg-a",
        startedAt: "2026-04-06T14:00:00",
        endedAt: "2026-04-06T14:02:00",
        durationSeconds: 120,
        appName: "Arc",
        platform: "macos",
        source: "nsworkspace",
        classification: {
          category: "workspace",
          productivity: "focus",
          source: "manual",
          confidence: 1,
        },
      },
      {
        id: "seg-b",
        startedAt: "2026-04-06T14:02:00",
        endedAt: "2026-04-06T14:03:00",
        durationSeconds: 60,
        appName: "Arc",
        platform: "macos",
        source: "nsworkspace",
        classification: {
          category: "learning",
          productivity: "neutral",
          source: "manual",
          confidence: 1,
        },
      },
    ];
    render(
      <FlowChartView
        blocks={[block]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        segments={mixedSegments}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /time block: 14:00–14:03/i }));
    const inspector = screen.getByRole("dialog", { name: "docs.example.com" });
    expect(inspector.style.width).toBe("304px");
    expect(within(inspector).queryByText("Mixed values · showing dominant")).toBeNull();
    expect(within(inspector).getAllByText("+ more")).toHaveLength(2);
    expect(within(inspector).getByText("Workspace").closest(".week-activity-inspector__chip")?.getAttribute("title")).toBe("Mixed values · showing dominant");
    expect(within(inspector).getByText("Focus")).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: /Current value: Workspace · dominant/ })).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: /Current value: Focus · dominant/ })).toBeTruthy();
  });

  it("opens the card of a record sent from History on its block", () => {
    const onRevealSettled = vi.fn();
    const block = makeFlowBlock({ sourceSegmentIds: ["seg-docs"] });
    render(
      <FlowChartView
        blocks={[block]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        revealSegmentId="seg-docs"
        onRevealSettled={onRevealSettled}
      />,
    );

    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBeTruthy();
    expect(onRevealSettled).toHaveBeenCalledTimes(1);
  });

  it("does not open a card when the day holds no such record", () => {
    vi.useFakeTimers();
    try {
      const onRevealSettled = vi.fn();
      render(
        <FlowChartView
          blocks={[makeFlowBlock({ sourceSegmentIds: ["seg-docs"] })]}
          appIcons={{}}
          intervalMinutes={3}
          revealSegmentId="seg-elsewhere"
          onRevealSettled={onRevealSettled}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onRevealSettled).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the activity inspector from a flow cell", () => {
    const block = makeFlowBlock({ sourceSegmentIds: ["seg-docs"] });
    render(
      <FlowChartView
        blocks={[block]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /time block: 14:00–14:03/i }));
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Change Category/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Change Productivity/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Delete activity/ })).toBeTruthy();
  });

  it("opens the full pinned inspector from the lightweight pointer preview", () => {
    const block = makeFlowBlock({ sourceSegmentIds: ["seg-docs"] });
    render(
      <FlowChartView
        blocks={[block]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
      />,
    );
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    fireNativePointerMove(cell, 180, 120);
    const preview = screen.getByRole("tooltip", { name: "docs.example.com" });
    expect(preview.textContent).toContain("docs.example.com");
    expect(preview.getAttribute("data-mode")).toBe("peek");
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(within(preview).queryByRole("textbox")).toBeNull();
    expect(preview.querySelector('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]')).toBeNull();
    fireEvent.click(cell);
    const inspector = screen.getByRole("dialog", { name: "docs.example.com" });
    expect(within(inspector).getByRole("button", { name: /Change Category/ })).toBeTruthy();
    expect(within(inspector).getByRole("button", { name: /Delete activity/ })).toBeTruthy();
    expect(within(inspector).queryByRole("button", { name: /Change Project/ })).toBeNull();
    expect(inspector.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(document.querySelector(".flow-hover-group-highlight.is-pinned")).toBeTruthy();
    expect(cell.getAttribute("aria-expanded")).toBe("true");
    fireNativePointerMove(cell, 220, 160);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBe(inspector);
  });

  it("opens the pinned flow inspector from a keyboard-generated block activation", () => {
    const block = makeFlowBlock({ sourceSegmentIds: ["seg-docs"] });
    const segment: ActivitySegment = {
      id: "seg-docs",
      startedAt: "2026-04-06T14:00:00",
      endedAt: "2026-04-06T14:03:00",
      durationSeconds: 180,
      appName: "Arc",
      platform: "macos",
      source: "nsworkspace",
    };
    render(
      <FlowChartView
        blocks={[block]}
        segments={[segment]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        onClassifyActivity={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    act(() => cell.focus());
    expect(screen.getByRole("tooltip", { name: "docs.example.com" })).toBeTruthy();
    // jsdom does not synthesize button clicks from Enter/Space. detail=0 is
    // the browser event shape produced by keyboard activation.
    fireEvent.click(cell, { detail: 0 });

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    const pinnedInspector = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="pinned"][data-view="overview"]');
    expect(pinnedInspector).toBeTruthy();
    expect(within(pinnedInspector!).getByRole("button", { name: /Change Productivity/ })).toBeTruthy();
    expect(document.querySelector(".flow-hover-group-highlight.is-pinned")).toBeTruthy();
  });

  it("shows the same read-only anchored flow preview on keyboard focus", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    cell.setAttribute("aria-describedby", "existing-flow-description");
    fireEvent.focus(cell);
    const preview = screen.getByRole("tooltip", { name: "docs.example.com" });
    expect(preview.textContent).toContain("docs.example.com");
    expect(within(preview).queryByRole("button")).toBeNull();
    expect(within(preview).queryByRole("textbox")).toBeNull();
    expect(cell.getAttribute("aria-describedby")?.split(/\s+/)).toEqual([
      "existing-flow-description",
      preview.id,
    ]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(cell.getAttribute("aria-describedby")).toBe("existing-flow-description");
  });

  it("keeps focus on the flow cell when Escape closes its focused preview", async () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    act(() => {
      cell.focus();
      fireEvent.focusIn(cell);
    });
    expect(screen.getByRole("tooltip", { name: "docs.example.com" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("tooltip", { name: "docs.example.com" })).toBeNull();
      expect(document.activeElement).toBe(cell);
    });
  });

  it("does not steal focus from an unrelated control when dismissing a pointer preview", () => {
    render(
      <>
        <button type="button">Unrelated control</button>
        <FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />
      </>,
    );
    const unrelatedControl = screen.getByRole("button", { name: "Unrelated control" });
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    act(() => unrelatedControl.focus());
    fireNativePointerMove(cell, 180, 120);
    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeNull();
    expect(document.activeElement).toBe(unrelatedControl);
  });

  it("leaves a pointer preview open when another control consumes Escape", () => {
    render(
      <>
        <button type="button" onKeyDown={(keyEvent) => keyEvent.preventDefault()}>Escape owner</button>
        <FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />
      </>,
    );
    const escapeOwner = screen.getByRole("button", { name: "Escape owner" });
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    act(() => escapeOwner.focus());
    fireNativePointerMove(cell, 180, 120);

    fireEvent.keyDown(escapeOwner, { key: "Escape" });

    expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy();
    expect(document.activeElement).toBe(escapeOwner);
  });

  it("does not override a newer focus target after preview dismissal", async () => {
    render(
      <>
        <button type="button">New focus target</button>
        <FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />
      </>,
    );
    const newFocusTarget = screen.getByRole("button", { name: "New focus target" });
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    act(() => {
      cell.focus();
      fireEvent.focusIn(cell);
    });
    expect(screen.getByRole("tooltip", { name: "docs.example.com" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    act(() => newFocusTarget.focus());

    await waitFor(() => expect(document.activeElement).toBe(newFocusTarget));
  });

  it("does not pull focus back to the block after an outside pointer dismissal", async () => {
    render(
      <>
        <button type="button">Outside control</button>
        <FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />
      </>,
    );
    const outsideControl = screen.getByRole("button", { name: "Outside control" });
    fireEvent.click(screen.getByRole("button", { name: /time block: 14:00–14:03/i }));
    expect(document.querySelector('.week-activity-inspector[data-mode="pinned"]')).toBeTruthy();

    fireEvent.pointerDown(outsideControl);
    act(() => outsideControl.focus());

    await waitFor(() => {
      expect(document.querySelector('.week-activity-inspector[data-mode="pinned"]')).toBeNull();
      expect(document.activeElement).toBe(outsideControl);
    });
  });

  it("keeps a clicked flow block pinned through pointer movement and restores focus on Escape", async () => {
    const { container } = render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    const grid = container.querySelector<HTMLElement>(".flow-chart-grid");
    if (!grid) throw new Error("expected the flow chart grid");
    act(() => cell.focus());
    fireEvent.click(cell);
    const inspector = screen.getByRole("dialog", { name: "docs.example.com" });

    fireNativePointerMove(grid, 20, 20);
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBe(inspector);
    expect(cell.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "docs.example.com" })).toBeNull();
      expect(document.activeElement).toBe(cell);
    });
  });

  it("keeps a pinned flow inspector on its opening snapshot when its source record refreshes", async () => {
    const initialBlock = makeFlowBlock({ sourceSegmentIds: ["seg-docs"] });
    const { rerender } = render(
      <FlowChartView blocks={[initialBlock]} appIcons={{}} intervalMinutes={3} activityActionsEnabled />,
    );
    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    fireEvent.click(cell);

    rerender(
      <FlowChartView
        blocks={[makeFlowBlock({ category: "learning", productivity: "neutral", sourceSegmentIds: ["seg-docs"] })]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
      />,
    );

    await waitFor(() => {
      const inspector = screen.getByRole("dialog", { name: "docs.example.com" });
      expect(inspector.textContent).toContain("Workspace");
      expect(inspector.textContent).toContain("Focus");
      expect(cell.getAttribute("aria-expanded")).toBe("true");
      expect(document.querySelector(".flow-hover-group-highlight.is-pinned")).toBeTruthy();
    });
  });

  it("keeps the original edit scope when a refreshed flow group absorbs an unavailable adjacent record", async () => {
    const sourceSegment: ActivitySegment = {
      id: "seg-docs",
      startedAt: "2026-04-06T14:00:00",
      endedAt: "2026-04-06T14:03:00",
      durationSeconds: 180,
      appName: "Arc",
      platform: "macos",
      source: "nsworkspace",
    };
    const onClassifyActivity = vi.fn().mockResolvedValue(undefined);
    const initialBlock = makeFlowBlock({ sourceSegmentIds: [sourceSegment.id] });
    const { rerender } = render(
      <FlowChartView
        blocks={[initialBlock]}
        segments={[sourceSegment]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        onClassifyActivity={onClassifyActivity}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /time block: 14:00–14:03/i }));

    rerender(
      <FlowChartView
        blocks={[
          initialBlock,
          makeFlowBlock({
            id: "adjacent-docs",
            minuteOfDay: 14 * 60 + 3,
            sourceSegmentIds: ["seg-adjacent-not-loaded"],
          }),
        ]}
        segments={[sourceSegment]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        onClassifyActivity={onClassifyActivity}
      />,
    );

    const inspector = await screen.findByRole("dialog", { name: "docs.example.com" });
    const categoryButton = within(inspector).getByRole("button", { name: /Change Category/ });
    expect((categoryButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(categoryButton);
    fireEvent.click(screen.getByRole("option", { name: "Learning" }));

    await waitFor(() => expect(onClassifyActivity).toHaveBeenCalledWith([sourceSegment], "learning", "neutral"));
  });

  it("closes a pinned flow inspector when its rendered cell is replaced by unrelated source records", async () => {
    const sourceSegment: ActivitySegment = {
      id: "seg-docs",
      startedAt: "2026-04-06T14:00:00",
      endedAt: "2026-04-06T14:03:00",
      durationSeconds: 180,
      appName: "Arc",
      platform: "macos",
      source: "nsworkspace",
    };
    const { rerender } = render(
      <FlowChartView
        blocks={[makeFlowBlock({ sourceSegmentIds: [sourceSegment.id] })]}
        segments={[sourceSegment]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        onDeleteActivity={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /time block: 14:00–14:03/i }));
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBeTruthy();

    rerender(
      <FlowChartView
        blocks={[makeFlowBlock({ sourceSegmentIds: ["seg-replacement"] })]}
        segments={[sourceSegment]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        onDeleteActivity={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "docs.example.com" })).toBeNull());
  });

  it("preserves an explicit No project assignment inside a mixed flow group", () => {
    const assignedBlock = makeFlowBlock({
      projectId: "project-drifty",
      projectColor: "#6b8e23",
      sourceSegmentIds: ["seg-assigned"],
    });
    const unassignedBlock = makeFlowBlock({
      id: "flow-block-unassigned",
      minuteOfDay: 14 * 60 + 3,
      projectId: null,
      projectColor: null,
      sourceSegmentIds: ["seg-unassigned"],
    });
    const group: FlowBlockHoverGroup = {
      block: assignedBlock,
      blocks: [assignedBlock, unassignedBlock],
      segmentIds: ["seg-assigned", "seg-unassigned"],
      startMinuteOfDay: assignedBlock.minuteOfDay,
      endMinuteOfDay: unassignedBlock.minuteOfDay + 3,
      durationSeconds: assignedBlock.durationSeconds + unassignedBlock.durationSeconds,
    };

    expect(buildFlowActivityInspectorEvent(group).projectAssignments).toEqual([
      { segmentId: "seg-assigned", projectId: "project-drifty" },
      { segmentId: "seg-unassigned", projectId: null },
    ]);
  });

  it.each(["editing", "deleting"] as const)("resets the editing session and destructive target when switching flow blocks while %s", async (initialState) => {
    const docsSegment: ActivitySegment = {
      id: "seg-docs",
      startedAt: "2026-04-06T14:00:00",
      endedAt: "2026-04-06T14:03:00",
      durationSeconds: 180,
      appName: "Arc",
      platform: "macos",
      source: "nsworkspace",
    };
    const terminalSegment: ActivitySegment = {
      ...docsSegment,
      id: "seg-terminal",
      startedAt: "2026-04-06T14:03:00",
      endedAt: "2026-04-06T14:06:00",
      appName: "Terminal",
    };
    let finishDeletion!: () => void;
    const pendingDeletion = new Promise<void>((resolve) => { finishDeletion = resolve; });
    const onDeleteActivity = vi.fn().mockResolvedValue(undefined);
    if (initialState === "deleting") onDeleteActivity.mockImplementationOnce(() => pendingDeletion);
    const terminalBlock = makeFlowBlock({
      id: "terminal-block",
      minuteOfDay: 14 * 60 + 3,
      appName: "Terminal",
      bundleId: "com.apple.Terminal",
      browserName: null,
      siteDomain: null,
      siteTitle: null,
      windowTitle: "Build",
      colorKey: "Terminal",
      sourceSegmentIds: [terminalSegment.id],
    });
    render(
      <FlowChartView
        blocks={[makeFlowBlock({ sourceSegmentIds: [docsSegment.id] }), terminalBlock]}
        segments={[docsSegment, terminalSegment]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
        onClassifyActivity={vi.fn().mockResolvedValue(undefined)}
        onDeleteActivity={onDeleteActivity}
      />,
    );
    const docsCell = screen.getByRole("button", { name: /docs\.example\.com/i });
    const terminalCell = screen.getByRole("button", { name: /terminal/i });

    fireEvent.click(docsCell);
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Change Category/ }));
    expect(document.querySelector('.week-activity-inspector__picker[data-field="category"]')).toBeTruthy();
    if (initialState === "deleting") {
      fireEvent.keyDown(document, { key: "Escape" });
      fireEvent.click(screen.getByRole("button", { name: /Delete activity/ }));
      fireEvent.click(screen.getByRole("button", { name: "Delete activity…" }));
      expect(onDeleteActivity).toHaveBeenCalledWith([docsSegment.id]);
    }
    fireEvent.click(terminalCell);
    expect(screen.queryByRole("dialog", { name: "docs.example.com" })).toBeNull();
    const terminalInspector = screen.getByRole("dialog", { name: "Terminal" });
    expect(terminalInspector.dataset.view).toBe("overview");
    expect(document.querySelector(".week-activity-inspector__picker")).toBeNull();
    expect(docsCell.getAttribute("aria-expanded")).toBe("false");
    expect(terminalCell.getAttribute("aria-expanded")).toBe("true");
    if (initialState === "deleting") {
      await act(async () => { finishDeletion(); await pendingDeletion; });
      expect(screen.getByRole("dialog", { name: "Terminal" })).toBe(terminalInspector);
      expect(terminalCell.getAttribute("aria-expanded")).toBe("true");
    }

    fireEvent.click(within(terminalInspector).getByRole("button", { name: /Delete activity/ }));
    fireEvent.click(screen.getByRole("button", { name: "Delete activity…" }));
    await waitFor(() => expect(onDeleteActivity).toHaveBeenCalledWith([terminalSegment.id]));
  });

  it("opens the inspector from a hovered flow cell without a more-actions control", () => {
    const block = makeFlowBlock({ sourceSegmentIds: ["seg-docs"] });
    render(
      <FlowChartView
        blocks={[block]}
        appIcons={{}}
        intervalMinutes={3}
        activityActionsEnabled
      />,
    );

    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    fireNativePointerMove(cell, 180, 120);
    expect(screen.queryByRole("button", { name: "More actions for docs.example.com" })).toBeNull();
    fireEvent.click(cell);
    expect(screen.getByRole("dialog", { name: "docs.example.com" })).toBeTruthy();
  });
});

describe("FlowChartView keyboard", () => {
  it("is one tab stop that the arrow keys walk through", () => {
    const blocks = [
      makeFlowBlock({ id: "a", minuteOfDay: 14 * 60 }),
      makeFlowBlock({ id: "b", minuteOfDay: 14 * 60 + 3, siteDomain: "mail.example.com", colorKey: "mail.example.com" }),
      makeFlowBlock({ id: "c", hour: 16, minuteOfDay: 16 * 60 + 6, siteDomain: "tasks.example.com", colorKey: "tasks.example.com" }),
    ];
    const { container } = render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
    const cell = (minute: number) => container.querySelector<HTMLButtonElement>(`button.flow-cell[data-flow-minute="${minute}"]`)!;
    const tabbable = Array.from(container.querySelectorAll<HTMLButtonElement>("button.flow-cell")).filter((button) => button.tabIndex === 0);
    // The earliest cell is the chart's only tab stop.
    expect(tabbable).toEqual([cell(840)]);

    cell(840).focus();
    fireEvent.keyDown(cell(840), { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(843));
    fireEvent.keyDown(cell(843), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(966));
    fireEvent.keyDown(cell(966), { key: "Home" });
    expect(document.activeElement).toBe(cell(840));
    fireEvent.keyDown(cell(840), { key: "End" });
    expect(document.activeElement).toBe(cell(966));
    // The tab stop follows the last focused cell, so Tab comes back to it.
    expect(cell(966).tabIndex).toBe(0);
    expect(cell(840).tabIndex).toBe(-1);
  });
});

describe("FlowChartView iPhone time", () => {
  const localIso = (hour: number, minute: number) => new Date(2026, 3, 6, hour, minute).toISOString();

  it("draws approximate phone time only in empty cells, as a described, non-interactive layer", () => {
    render(
      <FlowChartView
        blocks={[makeFlowBlock()]}
        appIcons={{}}
        intervalMinutes={4}
        phoneTime={{ day: "2026-04-06", blocks: [{ startedAt: localIso(14, 0), endedAt: localIso(14, 12), minutes: 12, label: "SNS" }] }}
      />,
    );

    const macCell = document.querySelector<HTMLElement>('[data-flow-minute="840"]');
    expect(macCell?.tagName).toBe("BUTTON");
    expect(macCell?.classList.contains("flow-cell--phone")).toBe(false);
    const phoneCells = Array.from(document.querySelectorAll<HTMLElement>(".flow-cell--phone"));
    expect(phoneCells.map((cell) => cell.dataset.phoneMinute)).toEqual(["844", "848"]);
    expect(phoneCells.every((cell) => cell.tagName === "SPAN" && !cell.hasAttribute("tabindex"))).toBe(true);
    expect(screen.getAllByRole("img", { name: /^iPhone, SNS, .*about 12m$/ })).toHaveLength(1);
    expect(document.querySelector(".flow-chart-legend__group--phone")?.textContent).toBe("iPhone");

    fireNativePointerMove(phoneCells[1], 120, 80);
    const card = screen.getByRole("tooltip");
    expect(card.textContent).toContain("SNS");
    expect(card.textContent).toContain("It isn't added to your totals.");
    expect(document.querySelectorAll(".flow-hover-group-highlight").length).toBeGreaterThan(0);
  });

  it("adds no iPhone legend or cells without phone time", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={4} />);
    expect(document.querySelector(".flow-cell--phone")).toBeNull();
    expect(document.querySelector(".flow-chart-legend__group--phone")).toBeNull();
  });
});
