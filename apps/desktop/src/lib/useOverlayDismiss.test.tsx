// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOverlayDismiss } from "./useOverlayDismiss";

function Dialog({ onDismiss, disabled, keepOpen }: { readonly onDismiss: () => void; readonly disabled?: boolean; readonly keepOpen?: boolean }) {
  const overlay = useOverlayDismiss(onDismiss, { disabled, keepOpen });
  return (
    <div data-testid="overlay" {...overlay}>
      <section data-testid="dialog">
        <input data-testid="field" defaultValue="draft" />
      </section>
    </div>
  );
}

describe("useOverlayDismiss", () => {
  afterEach(cleanup);

  it("closes on a click that starts and ends on the overlay", () => {
    const onDismiss = vi.fn();
    const view = render(<Dialog onDismiss={onDismiss} />);
    const overlay = view.getByTestId("overlay");
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays open when a text selection that started in a field ends past the dialog edge", () => {
    // The browser targets that click at the overlay, the common ancestor of
    // the press and the release.
    const onDismiss = vi.fn();
    const view = render(<Dialog onDismiss={onDismiss} />);
    fireEvent.pointerDown(view.getByTestId("field"));
    fireEvent.click(view.getByTestId("overlay"));
    expect(onDismiss).not.toHaveBeenCalled();
    // The next real outside click still closes it.
    fireEvent.pointerDown(view.getByTestId("overlay"));
    fireEvent.click(view.getByTestId("overlay"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks inside the dialog", () => {
    const onDismiss = vi.fn();
    const view = render(<Dialog onDismiss={onDismiss} />);
    fireEvent.pointerDown(view.getByTestId("dialog"));
    fireEvent.click(view.getByTestId("dialog"));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("keeps a dialog with unsaved input open and skips it while a request is in flight", () => {
    const onDismiss = vi.fn();
    const view = render(<Dialog onDismiss={onDismiss} keepOpen />);
    fireEvent.pointerDown(view.getByTestId("overlay"));
    fireEvent.click(view.getByTestId("overlay"));
    view.rerender(<Dialog onDismiss={onDismiss} disabled />);
    fireEvent.pointerDown(view.getByTestId("overlay"));
    fireEvent.click(view.getByTestId("overlay"));
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
