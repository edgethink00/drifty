// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";

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

describe("FlowChartView color mode", () => {
  it("switches flow cells from category color classes to productivity color classes", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    const chart = screen.getByLabelText("3-minute flow chart");
    const cell = screen.getByRole("button", { name: /^workspace.*focus/i });

    expect(chart.getAttribute("data-flow-color-mode")).toBe("category");
    expect(cell.classList.contains("flow-cell--workspace")).toBe(true);
    expect(cell.classList.contains("flow-cell--focus")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));

    expect(chart.getAttribute("data-flow-color-mode")).toBe("productivity");
    expect(cell.classList.contains("flow-cell--focus")).toBe(true);
    expect(cell.classList.contains("flow-cell--workspace")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Category" }));

    expect(chart.getAttribute("data-flow-color-mode")).toBe("category");
    expect(cell.classList.contains("flow-cell--workspace")).toBe(true);
  });

  it("shows readable identity chips before the hover detail and avoids repeated site pills", () => {
    render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: /^workspace.*focus/i }), { clientX: 120, clientY: 80 });
    const hoverCard = document.querySelector(".flow-hover-card") as HTMLElement;
    const identityRow = hoverCard.querySelector(".flow-hover-card__identity-row") as HTMLElement;
    const detail = hoverCard.querySelector(".flow-hover-card__detail") as HTMLElement;

    expect(hoverCard).toBeTruthy();
    expect(identityRow.querySelectorAll(".flow-hover-card__identity-dot")).toHaveLength(2);
    expect(within(identityRow).getByText("Workspace")).toBeTruthy();
    expect(within(identityRow).getByText("Focus")).toBeTruthy();
    expect(detail.textContent).toBe("Docs");
    expect(identityRow.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hoverCard.querySelector(".flow-hover-card__site")).toBeNull();
  });
});
