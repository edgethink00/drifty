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

  it("renders the trends deferred fallback matching the stacked usage layout without radar", () => {
    const { container } = render(<DeferredTabBodyFallback variant="trends" />);

    const statusEl = screen.getByRole("status", { name: "Loading trend analysis" });
    expect(statusEl).toBeTruthy();
    expect(statusEl.className).toContain("insights-stacked");
    expect(statusEl.className).toContain("insights-stacked--k");
    expect(statusEl.className).toContain("insights-fit-window");

    // Left column: patterns (alarm, rhythm, source groups)
    const patterns = container.querySelector(".insights-stacked__patterns");
    expect(patterns).toBeTruthy();
    expect(patterns?.querySelector(".alarm-follow-through")).toBeTruthy();
    expect(patterns?.querySelector("#insights-weekly-attention-rhythm")).toBeTruthy();
    expect(patterns?.querySelector(".productivity-insight-groups")).toBeTruthy();

    // Right column: breakdown (weekly categories, calendar)
    const breakdown = container.querySelector(".insights-stacked__breakdown");
    expect(breakdown).toBeTruthy();
    expect(breakdown?.querySelector(".insights-row--weekly-categories")).toBeTruthy();
    expect(breakdown?.querySelector(".weekly-summary-rail__stack")).toBeTruthy();
    expect(breakdown?.querySelector(".focus-calendar")).toBeTruthy();

    // Retired radar card must NOT be present
    expect(container.querySelector(".productivity-persona-card--radar-only")).toBeNull();
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
