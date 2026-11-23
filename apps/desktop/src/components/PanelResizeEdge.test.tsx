// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PanelResizeEdge, type PanelEdgeResize, type PanelEdgeToggle } from "./PanelResizeEdge";

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

function Harness({ mode, startCollapsed = false, onChange }: {
  readonly mode: PanelEdgeToggle | PanelEdgeResize;
  readonly startCollapsed?: boolean;
  readonly onChange?: (collapsed: boolean) => void;
}) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  return (
    <div ref={(row) => { if (row) row.getBoundingClientRect = () => rect(rowWidth); }}>
      <aside id="panel" ref={(panel) => { if (panel) panel.getBoundingClientRect = () => rect(panelWidth); }} />
      <PanelResizeEdge
        controls="panel"
        label="Resize panel"
        collapsed={collapsed}
        panel={() => document.getElementById("panel")}
        onCollapsedChange={(next) => { onChange?.(next); setCollapsed(next); }}
        mode={mode}
      />
    </div>
  );
}

const edge = () => screen.getByRole("separator", { name: "Resize panel" });
const down = (x: number) => fireEvent.pointerDown(edge(), { button: 0, pointerId: 1, clientX: x });
const move = (x: number) => fireEvent.pointerMove(edge(), { pointerId: 1, clientX: x });
const up = (x: number) => fireEvent.pointerUp(edge(), { pointerId: 1, clientX: x });
const folded = () => edge().getAttribute("data-collapsed") === "true";

beforeEach(() => { panelWidth = 177; rowWidth = 1000; });
afterEach(cleanup);

describe("a two-state edge", () => {
  const toggle: PanelEdgeToggle = { kind: "toggle", snapRem: 7.25 };

  it("folds the panel once the pointer crosses the snap point and opens it again on the way back", () => {
    const onChange = vi.fn();
    render(<Harness mode={toggle} onChange={onChange} />);
    down(177);
    move(130);
    expect(folded()).toBe(false);
    expect(document.documentElement.dataset.panelResizing).toBe("ew-resize");
    move(100);
    expect(folded()).toBe(true);
    move(150);
    expect(folded()).toBe(false);
    up(150);
    // The release ends the drag; it is not also a click.
    expect(onChange.mock.calls).toEqual([[true], [false]]);
    expect(document.documentElement.dataset.panelResizing).toBeUndefined();
  });

  it("toggles on a click and ignores a cancelled press", () => {
    render(<Harness mode={toggle} />);
    down(177); up(178);
    expect(folded()).toBe(true);
    panelWidth = 54;
    down(54); up(54);
    expect(folded()).toBe(false);
    down(177); fireEvent.pointerCancel(edge(), { pointerId: 1 });
    expect(folded()).toBe(false);
  });

  it("folds and opens from the keyboard like a window splitter", () => {
    render(<Harness mode={toggle} />);
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
  function resize(valueRem: number | null = null) {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    const mode: PanelEdgeResize = { kind: "resize", minRem: 12, maxRem: 32.5, reserveRem: 26, valueRem, onPreview, onCommit };
    return { mode, onPreview, onCommit };
  }

  it("follows the pointer between the limits and keeps the width on release", () => {
    const { mode, onPreview, onCommit } = resize();
    panelWidth = 280;
    render(<Harness mode={mode} />);
    down(280);
    move(400);
    expect(onPreview).toHaveBeenLastCalledWith(25);
    // The row leaves the main view 26rem: 1000px is 62.5rem, so the rail stops at 32.5rem (520px).
    move(900);
    expect(onPreview).toHaveBeenLastCalledWith(32.5);
    // Under the minimum but above half of it, the rail holds the minimum.
    move(150);
    expect(onPreview).toHaveBeenLastCalledWith(12);
    up(150);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(12);
  });

  it("leaves a narrow row's main view its room", () => {
    const { mode, onPreview } = resize();
    rowWidth = 720;
    render(<Harness mode={mode} />);
    down(177);
    move(600);
    expect(onPreview).toHaveBeenLastCalledWith(720 / 16 - 26);
  });

  it("folds under half the minimum, restores the width it had, and opens again on a click", () => {
    const { mode, onPreview, onCommit } = resize(20);
    panelWidth = 320;
    render(<Harness mode={mode} />);
    down(320);
    move(250);
    move(80);
    expect(folded()).toBe(true);
    expect(onPreview).toHaveBeenLastCalledWith(20);
    up(80);
    expect(onCommit).not.toHaveBeenCalled();
    // A click on an open free edge does nothing; on a folded one it opens the panel.
    panelWidth = 16;
    down(8); up(8);
    expect(folded()).toBe(false);
    panelWidth = 320;
    down(320); up(320);
    expect(folded()).toBe(false);
  });

  it("returns to the default width on a double-click", () => {
    const { mode, onCommit } = resize(20);
    render(<Harness mode={mode} />);
    fireEvent.doubleClick(edge());
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("moves by a rem with the arrows, three with Shift, to either limit with Home and End, and folds past the minimum", () => {
    const { mode, onCommit } = resize();
    panelWidth = 280;
    render(<Harness mode={mode} />);
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(onCommit).toHaveBeenLastCalledWith(18.5);
    fireEvent.keyDown(edge(), { key: "ArrowLeft", shiftKey: true });
    expect(onCommit).toHaveBeenLastCalledWith(14.5);
    fireEvent.keyDown(edge(), { key: "End" });
    expect(onCommit).toHaveBeenLastCalledWith(32.5);
    fireEvent.keyDown(edge(), { key: "Home" });
    expect(onCommit).toHaveBeenLastCalledWith(12);
    panelWidth = 192;
    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(folded()).toBe(true);
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(folded()).toBe(false);
  });
});
