// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FlowBlock, FlowIntervalMinutes } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";
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
    const foldBreakpoint = styles.indexOf("@container (max-width: 820px)");
    const stackBreakpoint = styles.indexOf("@container (max-width: 660px)");
    expect(foldBreakpoint).toBeGreaterThan(-1);
    expect(stackBreakpoint).toBeGreaterThan(-1);
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

  it("keeps interval controls compact without flattening the color mode toggle", () => {
    const intervalControlRule = cssRule(".flow-interval-control");
    const intervalButtonRule = cssRule(".flow-interval-control button");
    const colorModeControlRule = cssRule(".flow-color-mode-control");
    const colorModeButtonRule = cssRule(".flow-color-mode-control button");

    expect(intervalControlRule).toContain("padding: 1.78px;");
    expect(intervalButtonRule).toContain("padding: 1.78px var(--space-2);");
    expect(intervalButtonRule).toContain("font-size: 0.6875rem;");
    expect(colorModeControlRule).toContain("padding: 1.78px;");
    expect(colorModeButtonRule).toContain("min-height: 1.08rem;");
    expect(colorModeButtonRule).toContain("padding: 0.1rem 0.38rem;");
    expect(colorModeButtonRule).toContain("font-size: 0.6875rem;");
    expect(colorModeButtonRule).toContain("letter-spacing: 0.05em;");
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

  it.each([3, 4, 5] as const)("renders %dm-specific minute rows", (intervalMinutes: FlowIntervalMinutes) => {
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

    render(<FlowChartView blocks={[block]} appIcons={{}} intervalMinutes={4} onIntervalChange={() => undefined} />);

    const cell = screen.getByRole("button", { name: /time block: 14:08–14:12/i });
    const row = cell.closest(".flow-chart-row") as HTMLElement;

    expect(document.querySelector(".flow-chart-card")?.getAttribute("data-flow-interval")).toBe("4");
    expect(screen.getByRole("button", { name: "4m" }).getAttribute("aria-pressed")).toBe("true");
    expect(cell.getAttribute("aria-label")).toContain("Time block: 14:08–14:12");
    expect(row.querySelector(".flow-chart-row-label")?.textContent).toBe(":08");
    expect(Array.from(document.querySelectorAll(".flow-chart-row-label"), (label) => label.textContent)).not.toContain(":09");

    fireNativePointerMove(cell, 120, 80);

    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("14:08–14:12");
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

  it("moves the flow hover card with the pointer within the same cell", async () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    const cell = screen.getByRole("button", { name: /time block: 14:00–14:03/i });
    fireNativePointerMove(cell, 120, 80);
    const hoverCard = document.querySelector(".flow-hover-card") as HTMLElement;

    expect(hoverCard.style.left).toBe("136px");
    expect(hoverCard.style.top).toBe("96px");

    fireNativePointerMove(cell, 320, 190);

    await waitFor(() => {
      expect(hoverCard.style.left).toBe("336px");
      expect(hoverCard.style.top).toBe("206px");
    });
  });

  it("moves an active flow hover card while moving through the same hover group", async () => {
    const firstBlock = makeFlowBlock();
    const nextBlock = makeFlowBlock({
      id: "flow-block-next",
      minuteOfDay: 14 * 60 + 3,
    });
    render(<FlowChartView blocks={[firstBlock, nextBlock]} appIcons={{}} intervalMinutes={3} />);

    const [firstCell, nextCell] = screen.getAllByRole("button", { name: /time block: 14:00–14:06/i });
    fireNativePointerMove(firstCell, 120, 80);
    const hoverCard = document.querySelector(".flow-hover-card") as HTMLElement;

    expect(hoverCard.style.left).toBe("136px");
    expect(hoverCard.style.top).toBe("96px");

    fireNativePointerMove(nextCell, 320, 190);

    await waitFor(() => {
      expect(hoverCard.style.left).toBe("336px");
      expect(hoverCard.style.top).toBe("206px");
    });
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
