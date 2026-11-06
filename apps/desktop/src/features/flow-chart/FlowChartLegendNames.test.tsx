// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";

function block(id: string, category: FlowBlock["category"], productivity: FlowBlock["productivity"], minute: number): FlowBlock {
  return {
    id, day: "2026-04-06", hour: 14, quarter: 0, minuteOfDay: 14 * 60 + minute,
    appName: "Arc", bundleId: "company.thebrowser.Browser", browserName: "Arc", siteDomain: "docs.example.com",
    siteTitle: "Docs", windowTitle: "Docs", category, productivity, colorKey: id, durationSeconds: 180,
  };
}

const blocks = [block("a", "workspace", "focus", 0), block("b", "communication", "neutral", 3), block("c", "entertainment", "drift", 6)];

// jsdom has no layout, so give the head row and legend a size and let the
// canvas measure each name at 7px per character.
function withLayout(rowWidth: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("flow-chart-head__actions") ? rowWidth : 0;
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ({
    font: "",
    measureText: (text: string) => ({ width: text.length * 7 }),
  }) as unknown as CanvasRenderingContext2D);
}

afterEach(() => vi.restoreAllMocks());

describe("category legend names", () => {
  it("names each category the period used, without group names, and puts the group in the hover card", () => {
    withLayout(900);
    render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
    const legend = document.querySelector(".flow-chart-legend")!;
    expect(legend.classList.contains("flow-chart-legend--expanded")).toBe(true);
    const items = Array.from(legend.querySelectorAll(".flow-chart-legend__item"), (item) => item.textContent);
    expect(items).toEqual(["Workspace", "Communication", "Entertainment"]);
    expect(within(legend as HTMLElement).queryByText("Focus")).toBeNull();

    fireEvent.mouseEnter(legend.querySelectorAll(".flow-chart-legend__item")[1]);
    const card = document.querySelector(".flow-hover-card");
    expect(card?.textContent).toContain("Communication");
    expect(card?.textContent).toContain("Neutral");
  });

  it("folds to dots-first groups when even a full row cannot hold the names", () => {
    withLayout(120);
    render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
    const legend = document.querySelector(".flow-chart-legend")!;
    expect(legend.classList.contains("flow-chart-legend--folded")).toBe(true);
    expect(Array.from(legend.querySelectorAll(".flow-chart-legend__parent"), (chip) => chip.textContent)).toEqual(["Focus", "Neutral", "Drift"]);
  });
});
