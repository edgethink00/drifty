// @vitest-environment jsdom
import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelResizeEdge, type PanelEdgeResize } from "./PanelResizeEdge";

// jsdom has no PointerEvent; a MouseEvent carrying a pointer id is all the edge reads.
beforeAll(() => {
  if (typeof window.PointerEvent === "function") return;
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
});

// The panel starts at the window's left; 1rem is 16px.
let panelWidth = 0;
let rowWidth = 1000;

function rect(width: number): DOMRect {
  return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 600, width, height: 600, toJSON: () => ({}) } as DOMRect;
}

function Row({ children }: { readonly children: ReactNode }) {
  return (
    <div ref={(row) => { if (row) row.getBoundingClientRect = () => rect(rowWidth); }}>
      <aside id="panel" ref={(panel) => { if (panel) panel.getBoundingClientRect = () => rect(panelWidth); }} />
      {children}
    </div>
  );
}

const panel = () => document.getElementById("panel");

function ToggleHarness({ onChange }: { readonly onChange?: (collapsed: boolean) => void }) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <Row>
      <PanelResizeEdge controls="panel" label="Resize panel" panel={panel}
        mode={{ kind: "toggle", snapRem: 7.25, collapsed, onCollapsedChange: (next) => { onChange?.(next); setCollapsed(next); } }} />
    </Row>
  );
}

function resizeMode() {
  const onPreview = vi.fn();
  const onCommit = vi.fn();
  const mode: PanelEdgeResize = { kind: "resize", minRem: 16, maxRem: 32.5, reserveRem: 26, onPreview, onCommit };
  return { mode, onPreview, onCommit };
}

const edge = () => screen.getByRole("separator", { name: "Resize panel" });
const down = (x: number) => fireEvent.pointerDown(edge(), { button: 0, pointerId: 1, clientX: x });
const move = (x: number) => fireEvent.pointerMove(edge(), { pointerId: 1, clientX: x });
const up = (x: number) => fireEvent.pointerUp(edge(), { pointerId: 1, clientX: x });
const folded = () => edge().getAttribute("data-collapsed") === "true";
const cursor = () => document.documentElement.dataset.panelResizing;

beforeEach(() => { panelWidth = 177; rowWidth = 1000; });
afterEach(cleanup);

describe("a two-state edge", () => {
  it("folds the panel once the pointer crosses the snap point and opens it again on the way back", () => {
    const onChange = vi.fn();
    render(<ToggleHarness onChange={onChange} />);
    down(177);
    move(130);
    expect(folded()).toBe(false);
    expect(cursor()).toBe("ew-resize");
    move(100);
    expect(folded()).toBe(true);
    move(150);
    expect(folded()).toBe(false);
    up(150);
    // The release ends the drag; it is not also a click.
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(cursor()).toBeUndefined();
  });

  it("toggles on a click and ignores a cancelled press", () => {
    render(<ToggleHarness />);
    down(177); up(178);
    expect(folded()).toBe(true);
    panelWidth = 54;
    down(54); up(54);
    expect(folded()).toBe(false);
    down(177); fireEvent.pointerCancel(edge(), { pointerId: 1 });
    expect(folded()).toBe(false);
  });

  it("folds and opens from the keyboard like a window splitter", () => {
    render(<ToggleHarness />);
    expect(edge().getAttribute("aria-controls")).toBe("panel");
    expect(edge().getAttribute("aria-valuenow")).toBe("100");
    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(folded()).toBe(true);
    expect(edge().getAttribute("aria-valuenow")).toBe("0");
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(folded()).toBe(false);
    fireEvent.keyDown(edge(), { key: "Enter" });
    expect(folded()).toBe(true);
  });
});

describe("a free edge", () => {
  it("follows the pointer between its limits, never folds, and keeps the width on release", () => {
    const { mode, onPreview, onCommit } = resizeMode();
    panelWidth = 280;
    render(<Row><PanelResizeEdge controls="panel" label="Resize panel" panel={panel} mode={mode} /></Row>);
    down(280);
    move(400);
    expect(onPreview).toHaveBeenLastCalledWith(25);
    expect(cursor()).toBe("col-resize");
    // The row leaves the main view 26rem: 1000px is 62.5rem, so the panel stops at 32.5rem (520px).
    move(900);
    expect(onPreview).toHaveBeenLastCalledWith(32.5);
    expect(cursor()).toBe("w-resize");
    // All the way left it holds the minimum.
    move(10);
    expect(onPreview).toHaveBeenLastCalledWith(16);
    expect(cursor()).toBe("e-resize");
    expect(edge().hasAttribute("data-collapsed")).toBe(false);
    up(10);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(16);
    expect(cursor()).toBeUndefined();
  });

  it("leaves a narrow row's main view its room", () => {
    const { mode, onPreview } = resizeMode();
    rowWidth = 760;
    render(<Row><PanelResizeEdge controls="panel" label="Resize panel" panel={panel} mode={mode} /></Row>);
    down(280);
    move(600);
    expect(onPreview).toHaveBeenLastCalledWith(760 / 16 - 26);
  });

  it("does nothing on a click and returns to the default width on a double-click", () => {
    const { mode, onPreview, onCommit } = resizeMode();
    panelWidth = 320;
    render(<Row><PanelResizeEdge controls="panel" label="Resize panel" panel={panel} mode={mode} /></Row>);
    down(320); up(321);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.doubleClick(edge());
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("moves by a rem with the arrows, three with Shift, and to either limit with Home and End", () => {
    const { mode, onCommit } = resizeMode();
    panelWidth = 280;
    render(<Row><PanelResizeEdge controls="panel" label="Resize panel" panel={panel} mode={mode} /></Row>);
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith(18.5);
    fireEvent.keyDown(edge(), { key: "ArrowLeft", shiftKey: true });
    // 17.5rem less three is under the minimum, so it stops there.
    expect(onCommit).toHaveBeenLastCalledWith(16);
    fireEvent.keyDown(edge(), { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(32.5);
    fireEvent.keyDown(edge(), { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(16);
    // At the minimum, left stays there.
    panelWidth = 256;
    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(onCommit).toHaveBeenLastCalledWith(16);
    fireEvent.keyDown(edge(), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(5);
  });
});
