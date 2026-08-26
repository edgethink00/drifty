// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("keeps unknown-category blocks as stable unclassified gray in both color modes", async () => {
    const unclassifiedBlock = makeFlowBlock({
      category: "unknown",
      productivity: "neutral",
      classificationSource: "unknown",
      siteDomain: "notion.so",
      siteTitle: "Notion",
    });
    render(<FlowChartView blocks={[unclassifiedBlock]} appIcons={{}} intervalMinutes={3} />);

    const cell = screen.getByRole("button", { name: /unclassified.*neutral/i });
    expect(cell.classList.contains("flow-cell--unclassified")).toBe(true);
    expect(cell.classList.contains("flow-cell--unclassified-pending")).toBe(false);
    expect(within(screen.getByLabelText("Flow chart tones")).getByText("Unclassified")).toBeTruthy();

    fireEvent(cell, new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 80 }));
    await waitFor(() => expect(screen.getByText("Not classified yet")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
    expect(cell.classList.contains("flow-cell--unclassified")).toBe(true);
    expect(cell.classList.contains("flow-cell--unclassified-pending")).toBe(false);
    expect(within(screen.getByLabelText("Flow chart tones")).getByText("Unclassified")).toBeTruthy();
  });

  it("uses the same stable unclassified gray for stored blank-screen blocks", () => {
    const storedBlock = makeFlowBlock({
      category: "unknown",
      productivity: "neutral",
      classificationSource: "stored",
    });
    render(<FlowChartView blocks={[storedBlock]} appIcons={{}} intervalMinutes={3} />);

    const cell = screen.getByRole("button", { name: /unclassified.*neutral/i });
    expect(cell.classList.contains("flow-cell--unclassified")).toBe(true);
    expect(cell.classList.contains("flow-cell--unclassified-pending")).toBe(false);
  });

  it("hides the Unclassified legend chip when the day has no unclassified time", () => {
    const { rerender } = render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);

    const legend = () => screen.getByLabelText("Flow chart tones");
    expect(within(legend()).queryByText("Unclassified")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
    expect(within(legend()).queryByText("Unclassified")).toBeNull();

    // The chip comes back as soon as there is gray time for it to explain.
    rerender(
      <FlowChartView
        blocks={[makeFlowBlock(), makeFlowBlock({ id: "flow-block-2", minuteOfDay: 14 * 60 + 3, category: "unknown", productivity: "neutral" })]}
        appIcons={{}}
        intervalMinutes={3}
      />,
    );
    expect(within(legend()).getByText("Unclassified")).toBeTruthy();
  });

  it("keeps the empty-day legend on a single row by omitting the Unclassified chip", () => {
    render(<FlowChartView blocks={[]} appIcons={{}} intervalMinutes={3} showEmptyGrid />);

    const legend = screen.getByLabelText("Flow chart tones");
    expect(within(legend).queryByText("Unclassified")).toBeNull();
    expect(within(legend).getByText("Focus")).toBeTruthy();
    expect(within(legend).getByText("Drift")).toBeTruthy();
  });

  it("keeps the Unclassified chip nameable when narrow layouts hide its label", () => {
    // The visible word is dropped by a container query at narrow widths, so the
    // meaning has to survive on the chip itself rather than the text node.
    render(
      <FlowChartView
        blocks={[makeFlowBlock({ category: "unknown", productivity: "neutral" })]}
        appIcons={{}}
        intervalMinutes={3}
      />,
    );

    const legend = screen.getByLabelText("Flow chart tones");
    expect(within(legend).getByLabelText("Unclassified")).toBeTruthy();
    expect(legend.querySelector(".flow-chart-legend__group--unclassified .flow-chart-legend__label")?.textContent).toBe("Unclassified");
  });

  it("offers a Project color mode only when project data is available and colors cells by project", () => {
    const blocks = [
      makeFlowBlock({ minuteOfDay: 14 * 60, projectColor: "#112233" }),
      makeFlowBlock({ id: "flow-block-2", minuteOfDay: 14 * 60 + 3, appName: "Slack", siteDomain: null, colorKey: "slack", projectColor: null }),
    ];
    const projectLegend = [
      { projectId: "p1", name: "Drifty", color: "#112233" },
      { projectId: null, name: "No project", color: "#9ca3af" },
    ];

    const { rerender } = render(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} />);
    expect(screen.queryByRole("button", { name: "Project" })).toBeNull();

    rerender(<FlowChartView blocks={blocks} appIcons={{}} intervalMinutes={3} projectModeAvailable projectLegend={projectLegend} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));

    const chart = screen.getByLabelText("3-minute flow chart");
    expect(chart.getAttribute("data-flow-color-mode")).toBe("project");
    const cells = chart.querySelectorAll("button.flow-cell--project");
    expect(cells.length).toBe(2);
    expect((cells[0] as HTMLElement).style.getPropertyValue("--flow-project-color")).toBe("#112233");
    // Unassigned cell falls back to the gray convention, not hidden.
    expect((cells[1] as HTMLElement).style.getPropertyValue("--flow-project-color")).toBe("#9ca3af");
    // Legend lists the project and the gray "No project" bucket.
    expect(within(chart).getByText("Drifty")).toBeTruthy();
    expect(within(chart).getByText("No project")).toBeTruthy();
  });

  it("shows readable identity chips before the hover detail and avoids repeated site pills", async () => {
    render(<FlowChartView blocks={[makeFlowBlock({ classificationSource: "domain-db" })]} appIcons={{}} intervalMinutes={3} />);

    fireEvent(screen.getByRole("button", { name: /^workspace.*focus/i }), new MouseEvent("pointermove", { bubbles: true, clientX: 120, clientY: 80 }));
    await waitFor(() => expect(document.querySelector(".flow-hover-card")).toBeTruthy());
    const hoverCard = document.querySelector(".flow-hover-card") as HTMLElement;
    const identityRow = hoverCard.querySelector(".flow-hover-card__identity-row") as HTMLElement;
    const detail = hoverCard.querySelector(".flow-hover-card__detail") as HTMLElement;

    expect(hoverCard).toBeTruthy();
    expect(identityRow.querySelectorAll(".flow-hover-card__identity-dot")).toHaveLength(2);
    expect(identityRow.querySelectorAll(".flow-hover-card__identity-label")).toHaveLength(2);
    expect(identityRow.querySelectorAll(".hover-metadata-chip")).toHaveLength(3);
    expect(within(identityRow).getByText("Workspace")).toBeTruthy();
    expect(within(identityRow).getByText("Focus")).toBeTruthy();
    expect(within(identityRow).getByText("Predefined")).toBeTruthy();
    expect(detail.textContent).toBe("Docs");
    expect(identityRow.compareDocumentPosition(detail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hoverCard.querySelector(".flow-hover-card__site")).toBeNull();
  });
});
