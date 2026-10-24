// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeferredTabBodyFallback } from "./DeferredTabBodyFallback";
import { LocalizationTestProvider } from "../localization/LocalizationContext";

describe("DeferredTabBodyFallback", () => {
  it("renders the history deferred fallback with skeleton rows", () => {
    render(<DeferredTabBodyFallback variant="history" />);

    expect(screen.getByRole("status", { name: "Loading history records" })).toBeTruthy();
    expect(screen.getByText("Loading history records…")).toBeTruthy();
    expect(document.querySelectorAll(".history-row--skeleton").length).toBe(9);
  });

  it("localizes the history and insights loading states before their content arrives", () => {
    const { rerender } = render(
      <LocalizationTestProvider language="es">
        <DeferredTabBodyFallback variant="history" />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status", { name: "Cargando Historial" })).toBeTruthy();
    expect(screen.getByText("Cargando Historial…")).toBeTruthy();
    expect(document.querySelector(".history-delete-all .action-label__live")?.textContent).toBeTruthy();

    rerender(
      <LocalizationTestProvider language="es">
        <DeferredTabBodyFallback variant="trends" />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("status", { name: "Cargando Análisis" })).toBeTruthy();
    expect(screen.getByText("Cargando Análisis…")).toBeTruthy();
  });

  it("renders the trends deferred fallback matching the stacked usage layout without radar or alarms", () => {
    const { container } = render(<DeferredTabBodyFallback variant="trends" />);

    const statusEl = screen.getByRole("status", { name: "Loading trend analysis" });
    expect(statusEl).toBeTruthy();
    expect(statusEl.className).toContain("insights-stacked");
    expect(statusEl.className).toContain("insights-stacked--k");
    expect(statusEl.className).toContain("insights-fit-window");

    // Left column: patterns (rhythm, source groups). The alarm card appears
    // only once alarms exist, so the placeholder follows the layout without it.
    const patterns = container.querySelector(".insights-stacked__patterns");
    expect(patterns).toBeTruthy();
    expect(patterns?.querySelector(".alarm-follow-through")).toBeNull();
    expect(patterns?.querySelector("#insights-weekly-attention-rhythm")).toBeTruthy();
    expect(patterns?.querySelectorAll(".productivity-rhythm-card__board .productivity-rhythm-card__cell")).toHaveLength(7 * 24);
    expect(patterns?.querySelectorAll(".productivity-insight-group .drift-time-trend__sources")).toHaveLength(4);

    // Right column: breakdown (weekly categories, calendar)
    const breakdown = container.querySelector(".insights-stacked__breakdown");
    expect(breakdown).toBeTruthy();
    expect(breakdown?.querySelector(".insights-row--weekly-categories")).toBeTruthy();
    expect(breakdown?.querySelector(".weekly-productivity-trend-card .wt-plot")).toBeTruthy();
    expect(breakdown?.querySelector(".weekly-summary-rail__stack")).toBeTruthy();
    expect(breakdown?.querySelector(".focus-calendar")).toBeTruthy();

    // Retired radar card must NOT be present
    expect(container.querySelector(".productivity-persona-card--radar-only")).toBeNull();
  });

  it("presses the weekly chart's chosen grouping and offers Project only when it is available", () => {
    const { container, rerender } = render(<DeferredTabBodyFallback variant="trends" weeklyChartMode="productivity" />);
    const buttons = () => [...container.querySelectorAll(".wt-toggle .wt-toggle-btn")];
    expect(buttons().map((button) => button.textContent)).toEqual(["Productivity", "Category"]);
    expect(container.querySelector(".wt-toggle .is-active")?.textContent).toBe("Productivity");

    rerender(<DeferredTabBodyFallback variant="trends" weeklyChartMode="project" projectModeAvailable />);
    expect(buttons().map((button) => button.textContent)).toEqual(["Productivity", "Category", "Project"]);
    expect(container.querySelector(".wt-toggle .is-active")?.textContent).toBe("Project");
  });

  it("announces the loading tab in the app language", () => {
    render(
      <LocalizationTestProvider language="ko">
        <DeferredTabBodyFallback label="history records" variant="history" />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status", { name: "기록 불러오는 중" })).toBeTruthy();
    expect(screen.getByText("기록 불러오는 중…")).toBeTruthy();
  });
});
