// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { DashboardPageHeader } from "./DashboardPageHeader";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard share action", () => {
  it("makes room for an overflowing title and restores the label when the window widens", () => {
    let rowWidth = 496;
    let summaryWidth = 379;
    let titleWidth = 392;
    let notifyResize = () => {};
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = () => callback([], this as unknown as ResizeObserver);
      }
      observe() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dashboard-page-head__row") ? rowWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("dashboard-page-head__summary") ? titleWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const width = this.classList.contains("dashboard-page-head__summary") ? summaryWidth
        : this.classList.contains("dashboard-page-head__side") ? 260
          : this.classList.contains("app-btn--header-action") ? 109 : 0;
      return new DOMRect(0, 0, width, this.classList.contains("app-btn--header-action") ? 32 : 0);
    });

    const view = (duration: string) => (
      <LocalizationTestProvider language="es">
        <DashboardPageHeader
          dashPeriod="Today"
          initialDataLoading={false}
          dateNavigator={<div>Fecha</div>}
          focusDuration={duration}
          headerAction={<button type="button" className="app-btn app-btn--header-action">Compartir</button>}
        />
      </LocalizationTestProvider>
    );
    const { container, rerender } = render(view("4 h 54 min"));
    const head = container.querySelector(".dashboard-page-head")!;
    expect(head.getAttribute("data-header-action")).toBe("icon");
    expect(screen.getByRole("button", { name: "Compartir" })).toBeTruthy();

    rowWidth = 560;
    summaryWidth = 392;
    act(() => notifyResize());
    expect(head.hasAttribute("data-header-action")).toBe(false);

    // A longer duration can overflow without changing the constrained box's
    // width, so it must be remeasured even without a resize notification.
    rowWidth = 496;
    summaryWidth = 379;
    titleWidth = 380;
    act(() => notifyResize());
    expect(head.hasAttribute("data-header-action")).toBe(false);
    titleWidth = 392;
    rerender(view("14 h 54 min"));
    expect(head.getAttribute("data-header-action")).toBe("icon");
  });
});
