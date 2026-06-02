// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FlowBlock, FlowIntervalMinutes } from "@dtime/domain";
import { FlowChartView } from "./FlowChartView";

const styles = readFileSync("src/styles.css", "utf8");

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

function visibleHourLabels(): string[] {
  return Array.from(document.querySelectorAll(".flow-chart-hours > span"), (label) => label.textContent ?? "")
    .filter((label) => label.length > 0);
}

function cssRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? "";
}

type BlockPlacementCase = {
  intervalMinutes: FlowIntervalMinutes;
  minuteOffset: number;
  rowLabel: string;
  endTime: string;
};

const blockPlacementCases: BlockPlacementCase[] = [
  { intervalMinutes: 3, minuteOffset: 6, rowLabel: ":06", endTime: "14:09" },
  { intervalMinutes: 5, minuteOffset: 5, rowLabel: ":05", endTime: "14:10" },
  { intervalMinutes: 10, minuteOffset: 10, rowLabel: ":10", endTime: "14:20" },
];

describe("FlowChartView", () => {
  it("keeps category legend dots at the JEO-10 enlarged marker size", () => {
    expect(styles).toMatch(/\.flow-chart-legend__dot\s*{\s*width:\s*0\.546rem;\s*height:\s*0\.546rem;/);
  });

  it("tightens only the flow chart shell spacing while preserving cell scale", () => {
    expect(styles).toMatch(/\.flow-breakdown-layout__chart\s*{[\s\S]*padding:\s*7px 16px 9px;/);
    expect(styles).toMatch(/\.flow-chart-card\s*{[\s\S]*gap:\s*8px;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__panel\s*{[\s\S]*gap:\s*5px;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__panel\s*{[\s\S]*padding:\s*0\.44rem 0\.64rem;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__legend-item\s*{[\s\S]*font-size:\s*0\.68rem;/);
    expect(styles).toMatch(/\.flow-compact-split-chart__legend-value\s*{[\s\S]*font-size:\s*0\.62rem;/);
  });

  it("uses compact 12-hour labels on the flow chart hour axis", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    expect(visibleHourLabels()).toEqual(["12am", "3am", "6am", "9am", "12pm", "3pm", "6pm", "9pm"]);
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

  it.each([3, 5, 10] as const)("renders %dm-specific minute rows", (intervalMinutes: FlowIntervalMinutes) => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={intervalMinutes} />);

    const rowLabels = Array.from(document.querySelectorAll(".flow-chart-row-label"), (label) => label.textContent);
    const chart = document.querySelector(".flow-chart-card") as HTMLElement;

    expect(rowLabels).toEqual(expectedRowLabels(intervalMinutes));
    expect(chart.style.getPropertyValue("--flow-cell-min-height")).toBe(expectedCellMinHeight(intervalMinutes));
    expect(chart.style.getPropertyValue("--flow-breakdown-cell-min-height")).toBe(expectedBreakdownCellMinHeight(intervalMinutes));
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
    render(<FlowChartView blocks={[makeFlowBlock({ minuteOfDay: 23 * 60 + 50 })]} appIcons={{}} intervalMinutes={10} currentMinuteOfDay={23 * 60 + 50} />);

    const currentRow = document.querySelector(".flow-chart-row--now") as HTMLElement;

    expect(currentRow.querySelector(".flow-chart-row-label")?.textContent).toBe(":50");
    expect(currentRow.classList.contains("flow-chart-row--now-terminal")).toBe(true);
  });

  it("draws the current hour pill without shifting or clipping the hour-axis label", () => {
    render(<FlowChartView blocks={[makeFlowBlock({ minuteOfDay: 14 * 60 + 6 })]} appIcons={{}} intervalMinutes={3} currentMinuteOfDay={14 * 60 + 6} />);

    const currentHourLabel = Array.from(document.querySelectorAll(".flow-chart-hours > span"))
      .find((label) => label.textContent === "2pm");
    const currentMinuteLabel = document.querySelector(".flow-chart-row--time-label .flow-chart-row-label");
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

  it("places a 10-minute block on the selected 10-minute row", () => {
    const block = makeFlowBlock({
      id: "ten-minute-docs",
      minuteOfDay: 14 * 60 + 10,
      durationSeconds: 600,
    });

    render(<FlowChartView blocks={[block]} appIcons={{}} intervalMinutes={10} onIntervalChange={() => undefined} />);

    const cell = screen.getByRole("button", { name: /time block: 14:10–14:20/i });
    const row = cell.closest(".flow-chart-row") as HTMLElement;

    expect(document.querySelector(".flow-chart-card")?.getAttribute("data-flow-interval")).toBe("10");
    expect(screen.getByRole("button", { name: "10m" }).getAttribute("aria-pressed")).toBe("true");
    expect(cell.getAttribute("aria-label")).toContain("Time block: 14:10–14:20");
    expect(row.querySelector(".flow-chart-row-label")?.textContent).toBe(":10");
    expect(Array.from(document.querySelectorAll(".flow-chart-row-label"), (label) => label.textContent)).not.toContain(":09");

    fireEvent.mouseEnter(cell, { clientX: 120, clientY: 80 });

    expect(document.querySelector(".flow-hover-card")?.textContent).toContain("14:10–14:20");
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

    render(<FlowChartView blocks={[block]} appIcons={{ "com.google.Chrome": "data:image/png;base64,chrome" }} intervalMinutes={5} />);

    const cell = screen.getByRole("button", { name: /instagram\.com/i });
    expect(cell.getAttribute("aria-label")).not.toContain("Google Chrome");

    fireEvent.mouseEnter(cell, { clientX: 120, clientY: 80 });

    expect(screen.getAllByText("instagram.com").length).toBeGreaterThan(0);
    expect(screen.queryByText("Google Chrome")).toBeNull();
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

    render(<FlowChartView blocks={[block]} appIcons={{ "com.google.Chrome": "data:image/png;base64,chrome" }} intervalMinutes={5} />);

    fireEvent.mouseEnter(screen.getByLabelText("Social media"), { clientX: 220, clientY: 90 });
    const categoryHover = document.querySelector(".category-hover-card") as HTMLElement;

    expect(categoryHover).toBeTruthy();
    expect(categoryHover.textContent).toContain("instagram.com");
    expect(categoryHover.textContent).not.toContain("Google Chrome");
    expect(categoryHover.querySelector("img.site-favicon")?.getAttribute("src")).toBe("https://www.google.com/s2/favicons?domain=instagram.com&sz=64");
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
