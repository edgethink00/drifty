// @vitest-environment jsdom
import { useEffect } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityInspectionProvider, useActivityInspection } from "./ActivityInspectionContext";
import { BreakdownSidePanel } from "./BreakdownSidePanelChrome";

function Selection({ close }: { readonly close: () => void }) {
  const { registerSelection } = useActivityInspection();
  useEffect(() => registerSelection(close), [close, registerSelection]);
  return null;
}

function State() {
  const { panelActive, panelElement } = useActivityInspection();
  return <output>{panelActive ? "selected" : "summary"}:{panelElement ? "host ready" : "no host"}</output>;
}

describe("activity detail destination", () => {
  it("auto-opens the existing panel and preserves summary elements and their scroll position", () => {
    const close = vi.fn(), requestOpen = vi.fn(), toggle = vi.fn();
    const tree = (selected: boolean) => <ActivityInspectionProvider options={{ presentation: "panel", hover: "off" }} scopeKey="day1" onRequestOpen={requestOpen}>
      <BreakdownSidePanel open onToggle={toggle} ariaLabel="Day breakdown" toggleSubject="day breakdown"><input aria-label="summary state" defaultValue="unchanged" /></BreakdownSidePanel>
      {selected ? <Selection close={close} /> : null}<State />
    </ActivityInspectionProvider>;
    const { container, rerender } = render(tree(false));
    const content = container.querySelector<HTMLElement>(".week-v2-side__content")!;
    const summary = screen.getByRole("textbox");
    content.scrollTop = 120;
    fireEvent.scroll(content);
    rerender(tree(true));
    expect(requestOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByText("selected:host ready")).toBeTruthy();
    expect(content.scrollTop).toBe(0);
    expect(summary.isConnected).toBe(true);
    expect(container.querySelector(".activity-detail-slot")?.hasAttribute("hidden")).toBe(false);
    content.scrollTop = 75;
    rerender(tree(false));
    expect(content.scrollTop).toBe(120);
    expect(screen.getByRole("textbox")).toBe(summary);
    expect(container.querySelector(".activity-detail-slot")?.hasAttribute("hidden")).toBe(true);
  });

  it("restores the collapse control once the summary is back", () => {
    const close = vi.fn(), toggle = vi.fn();
    const tree = (selected: boolean) => <ActivityInspectionProvider options={{ presentation: "panel", hover: "off" }} scopeKey="day1" onRequestOpen={vi.fn()}>
      {selected ? <Selection close={close} /> : null}<BreakdownSidePanel open onToggle={toggle} ariaLabel="Day breakdown" toggleSubject="day breakdown">Summary</BreakdownSidePanel>
    </ActivityInspectionProvider>;
    const { rerender } = render(tree(true));
    expect(screen.queryByRole("button", { name: "Collapse day breakdown" })).toBeNull();
    rerender(tree(false));
    fireEvent.click(screen.getByRole("button", { name: "Collapse day breakdown" }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("turns the Breakdown head into the way back while an activity is open, without collapsing the panel", () => {
    const close = vi.fn(), toggle = vi.fn();
    render(<ActivityInspectionProvider options={{ presentation: "panel", hover: "off" }} scopeKey="day1" onRequestOpen={vi.fn()}>
      <Selection close={close} /><BreakdownSidePanel open onToggle={toggle} ariaLabel="Day breakdown" toggleSubject="day breakdown" title="Breakdown">Summary</BreakdownSidePanel>
    </ActivityInspectionProvider>);
    const back = screen.getByRole("button", { name: "Back to breakdown" });
    expect(back.textContent).toBe("Breakdown");
    expect(back.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(back);
    expect(close).toHaveBeenCalledTimes(1);
    expect(toggle).not.toHaveBeenCalled();
  });

  it("closes the old selection on a day or week scope change", () => {
    const close = vi.fn();
    const tree = (scopeKey: string) => <ActivityInspectionProvider options={{ presentation: "panel", hover: "off" }} scopeKey={scopeKey} onRequestOpen={vi.fn()}><Selection close={close} /></ActivityInspectionProvider>;
    const { rerender } = render(tree("day1"));
    rerender(tree("week1"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not let a replaced selection's cleanup clear the new one", () => {
    const first = vi.fn(), second = vi.fn();
    let register!: ReturnType<typeof useActivityInspection>["registerSelection"];
    let dismiss!: () => void;
    function Consumer() { const state = useActivityInspection(); register = state.registerSelection; dismiss = state.dismissSelection; return <State />; }
    render(<ActivityInspectionProvider scopeKey="day1" onRequestOpen={vi.fn()}><Consumer /></ActivityInspectionProvider>);
    let cleanup!: () => void;
    act(() => { cleanup = register(first); register(second); });
    act(() => cleanup());
    expect(screen.getByText("selected:no host")).toBeTruthy();
    act(() => dismiss());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
