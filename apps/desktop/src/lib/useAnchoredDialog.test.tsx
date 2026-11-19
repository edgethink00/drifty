// @vitest-environment jsdom
import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAnchoredDialog } from "./useAnchoredDialog";

function Dialog({ height, keepWithinOverlay = false }: { readonly height: number; readonly keepWithinOverlay?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useAnchoredDialog(ref, { keepWithinOverlay });
  return (
    <div data-testid="overlay" style={{ paddingTop: 16, paddingBottom: 16 }}>
      <div ref={ref} data-testid="dialog" data-height={height} />
    </div>
  );
}

function size(element: HTMLElement, property: "clientHeight" | "offsetHeight", value: number) {
  Object.defineProperty(element, property, { configurable: true, value });
}

describe("useAnchoredDialog", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("centers the dialog once and keeps its top edge when it grows", () => {
    const view = render(<Dialog height={200} />);
    const overlay = view.getByTestId("overlay");
    const dialog = view.getByTestId("dialog");
    size(overlay, "clientHeight", 832);
    size(dialog, "offsetHeight", 200);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(dialog.style.marginTop).toBe("300px");
    expect(dialog.style.marginBottom).toBe("0px");
    expect(dialog.style.alignSelf).toBe("start");
    // Later growth is not re-centered: the inline top margin stays put.
    size(dialog, "offsetHeight", 260);
    view.rerender(<Dialog height={260} />);
    expect(dialog.style.marginTop).toBe("300px");
  });

  it("starts at the overlay inset when the dialog is taller than the window", () => {
    const view = render(<Dialog height={900} />);
    size(view.getByTestId("overlay"), "clientHeight", 600);
    size(view.getByTestId("dialog"), "offsetHeight", 900);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(view.getByTestId("dialog").style.marginTop).toBe("0px");
  });

  it("moves an opted-in dialog only as far as needed when it grows past the bottom inset", () => {
    let notify: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const view = render(<Dialog height={200} keepWithinOverlay />);
    const overlay = view.getByTestId("overlay");
    const dialog = view.getByTestId("dialog");
    size(overlay, "clientHeight", 680);
    size(dialog, "offsetHeight", 500);
    act(() => window.dispatchEvent(new Event("resize")));
    expect(dialog.style.marginTop).toBe("74px");
    size(dialog, "offsetHeight", 550);
    act(() => notify?.([], {} as ResizeObserver));
    expect(dialog.style.marginTop).toBe("74px");
    size(dialog, "offsetHeight", 600);
    act(() => notify?.([], {} as ResizeObserver));
    expect(dialog.style.marginTop).toBe("48px");
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
