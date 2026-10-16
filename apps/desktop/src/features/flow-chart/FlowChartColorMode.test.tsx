// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FlowBlock } from "@drifty/domain";
import { FlowChartView } from "./FlowChartView";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

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
  it("localizes the Day chart controls, legend, and cell description in Korean", () => {
    render(
      <LocalizationTestProvider language="ko">
        <FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByLabelText("3분 단위 활동 흐름")).toBeTruthy();
    expect(screen.getByRole("button", { name: "카테고리" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "생산성" })).toBeTruthy();
    expect(screen.getByText("집중")).toBeTruthy();
    expect(screen.getByRole("button", { name: /작업.*집중.*시간대.*소요 시간/i })).toBeTruthy();
  });

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
    const preview = await waitFor(() => {
      const card = document.querySelector<HTMLElement>('.week-activity-inspector[data-mode="peek"]');
      if (!card) throw new Error("expected activity preview");
      return card;
    });
    expect(within(preview).getByText("Unclassified")).toBeTruthy();
    expect(screen.queryByText("Not classified yet")).toBeNull();

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

  it("shows an added productivity level after neutral, in its own color, wherever productivity is drawn", () => {
    window.localStorage.setItem("drifty.productivityCustomizations.v1", JSON.stringify({ "level-rest0001": { name: "Rest", color: "#5b86b5" } }));
    window.localStorage.setItem("drifty.categoryCustomizations.v1", JSON.stringify({ entertainment: { productivity: "neutral", level: "level-rest0001" } }));
    try {
      render(
        <FlowChartView
          blocks={[makeFlowBlock(), makeFlowBlock({ id: "flow-block-2", minuteOfDay: 14 * 60 + 3, category: "entertainment", productivity: "neutral", siteDomain: "youtube.com" })]}
          appIcons={{}}
          intervalMinutes={3}
        />,
      );
      const legend = () => screen.getByLabelText("Flow chart tones");
      // Category view: the level is a group holding the category fixed to it.
      expect(within(legend()).getByText("Rest")).toBeTruthy();
      expect(within(legend()).getByLabelText("Rest categories").querySelector(".flow-chart-legend__dot--entertainment")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
      expect(Array.from(legend().querySelectorAll(".flow-chart-legend__parent")).map((chip) => chip.textContent)).toEqual(["Focus", "Neutral", "Rest", "Drift"]);
      const cell = screen.getByRole("button", { name: /^entertainment.*rest/i });
      expect(cell.classList.contains("flow-cell--level-rest0001")).toBe(true);
    } finally {
      window.localStorage.removeItem("drifty.productivityCustomizations.v1");
      window.localStorage.removeItem("drifty.categoryCustomizations.v1");
    }
  });

  it("orders each legend group's dots by the saved category order", () => {
    window.localStorage.setItem("drifty.categoryOrder.v1", JSON.stringify(["utility", "music"]));
    try {
      render(<FlowChartView blocks={[makeFlowBlock()]} appIcons={{}} intervalMinutes={3} />);
      const neutral = screen.getByLabelText("Neutral categories");
      expect(Array.from(neutral.querySelectorAll(".flow-chart-legend__dot"), (dot) => dot.getAttribute("aria-label"))).toEqual(["Utility", "Music", "Communication"]);
    } finally {
      window.localStorage.removeItem("drifty.categoryOrder.v1");
    }
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

  it("opens the category editor on the group the legend is colored by", () => {
    const onEditCategories = vi.fn();
    render(
      <FlowChartView
        blocks={[makeFlowBlock()]}
        appIcons={{}}
        projectModeAvailable
        projectLegend={[{ projectId: "p1", name: "Drifty", color: "#6366f1" }]}
        onEditCategories={onEditCategories}
      />,
    );

    const legendPencil = () => screen.getByRole("button", { name: "Edit categories" });
    expect(legendPencil().getAttribute("aria-haspopup")).toBe("dialog");
    fireEvent.click(legendPencil());
    expect(onEditCategories).toHaveBeenLastCalledWith({ group: "category" });

    fireEvent.click(screen.getByRole("button", { name: "Productivity" }));
    fireEvent.click(legendPencil());
    expect(onEditCategories).toHaveBeenLastCalledWith({ group: "productivity" });

    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(legendPencil());
    expect(onEditCategories).toHaveBeenLastCalledWith({ group: "project" });
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

  it("shows only the available direct attributes without a classification-source badge", async () => {
    render(<FlowChartView blocks={[makeFlowBlock({ classificationSource: "domain-db" })]} appIcons={{}} intervalMinutes={3} />);

    fireEvent.focus(screen.getByRole("button", { name: /^workspace.*focus/i }));
    await waitFor(() => expect(document.querySelector('.week-activity-inspector[data-mode="peek"]')).toBeTruthy());
    const hoverCard = document.querySelector('.week-activity-inspector[data-mode="peek"]') as HTMLElement;
    const attributes = hoverCard.querySelector(".week-activity-inspector__attributes") as HTMLElement;
    const detail = hoverCard.querySelector(".week-activity-inspector__context") as HTMLElement;

    expect(hoverCard).toBeTruthy();
    expect(hoverCard.getAttribute("role")).toBe("tooltip");
    expect(within(hoverCard).queryByRole("button")).toBeNull();
    expect(within(hoverCard).queryByRole("textbox")).toBeNull();
    expect(hoverCard.textContent).toContain("docs.example.com");
    expect(within(attributes).queryByText("Project")).toBeNull();
    expect(within(attributes).getByText("Workspace")).toBeTruthy();
    expect(within(attributes).getByText("Focus")).toBeTruthy();
    expect(attributes.querySelectorAll(".week-activity-inspector__attribute-trigger")).toHaveLength(2);
    expect(hoverCard.textContent).not.toContain("Predefined");
    expect(detail.textContent).toBe("Docs");
    expect(detail.compareDocumentPosition(attributes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hoverCard.querySelectorAll(".week-activity-inspector__heading strong")).toHaveLength(1);
  });
});


it("marks only rendered cells backed by classified segments for result exposure", () => {
  const view = render(<FlowChartView blocks={[makeFlowBlock({ sourceSegmentIds: ["classified"] })]} appIcons={{}} classifiedResultIds={new Set(["classified"])} />);
  expect(view.container.querySelector('[data-funnel-classified-result="true"]')).toBeTruthy();
  view.rerender(<FlowChartView blocks={[makeFlowBlock({ sourceSegmentIds: ["raw"] })]} appIcons={{}} classifiedResultIds={new Set(["classified"])} />);
  expect(view.container.querySelector('[data-funnel-classified-result="true"]')).toBeNull();
  view.rerender(<FlowChartView blocks={[]} appIcons={{}} classifiedResultIds={new Set(["classified"])} showEmptyGrid />);
  expect(view.container.querySelector('[data-funnel-classified-result="true"]')).toBeNull();
});
