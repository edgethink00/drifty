// @vitest-environment jsdom
import { StrictMode, Suspense, lazy, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModalPresence } from "./ModalPresence";
import { DeleteManagedModelModal } from "../features/settings/DeleteManagedModelModal";
import { useModalDismiss } from "../lib/useModalDismiss";

function Dialog({ close, save = () => {}, title = "Dialog" }: { close: () => void; save?: () => void; title?: string }) {
  useModalDismiss(close);
  return <div className="auth-modal__overlay" onClick={close}><section className="modal-shell" role="dialog" aria-label={title} onClick={e => e.stopPropagation()}><button className="modal-x" onClick={close}>Close {title}</button><button onClick={save}>Save {title}</button><input aria-label={`Input ${title}`} /></section></div>;
}
function Harness({ save = () => {} }: { save?: () => void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open</button><button onClick={() => setOpen(false)}>External close</button><ModalPresence>{open ? <Dialog close={() => setOpen(false)} save={save} /> : null}</ModalPresence></>;
}
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", window.clearTimeout);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("ModalPresence lifecycle", () => {
  it("gives a dialog nested in the DOM priority over its ancestor on initial mount", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(<ModalPresence onDismiss={outerClose}><div><section className="modal-shell" role="dialog" aria-label="Outer"><button>Outer action</button><ModalPresence><Dialog title="Inner" close={innerClose} /></ModalPresence></section></div></ModalPresence>);
    tick(20);
    expect(document.activeElement).toBe(screen.getByText("Close Inner"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("restores the original trigger when a lower dialog disappears before the upper one", () => {
    function Chain() {
      const [lower, setLower] = useState(false);
      const [upper, setUpper] = useState(false);
      return <><button onClick={() => setLower(true)}>Start chain</button><button onClick={() => setLower(false)}>Remove lower</button><ModalPresence>{lower ? <Dialog title="Lower" close={() => setLower(false)} save={() => setUpper(true)} /> : null}</ModalPresence><ModalPresence>{upper ? <Dialog title="Upper" close={() => setUpper(false)} /> : null}</ModalPresence></>;
    }
    render(<Chain />);
    const trigger = screen.getByText("Start chain");
    trigger.focus();
    fireEvent.click(trigger);
    tick(20);
    fireEvent.click(screen.getByText("Save Lower"));
    tick(20);
    fireEvent.click(screen.getByText("Remove lower"));
    tick(221);
    expect(document.activeElement).toBe(screen.getByText("Close Upper"));
    fireEvent.click(screen.getByText("Close Upper"));
    tick(221);
    expect(document.activeElement).toBe(trigger);
  });

  it("does not retain an invisible dialog when closed before its first frame", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("External close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    tick(300);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not dismiss a model deletion dialog underneath a newer popup", () => {
    const cancel = vi.fn();
    const dismissUpper = vi.fn();
    const { rerender } = render(<><ModalPresence><DeleteManagedModelModal modelLabel="Test model" deleting={false} onCancel={cancel} onConfirm={() => {}} /></ModalPresence><ModalPresence>{null}</ModalPresence></>);
    tick(20);
    rerender(<><ModalPresence><DeleteManagedModelModal modelLabel="Test model" deleting={false} onCancel={cancel} onConfirm={() => {}} /></ModalPresence><ModalPresence><Dialog close={dismissUpper} title="Upper" /></ModalPresence></>);
    tick(20);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dismissUpper).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("waits for a lazy dialog before starting entry", async () => {
    let resolve!: (value: { default: typeof Dialog }) => void;
    const Delayed = lazy(() => new Promise<{ default: typeof Dialog }>(done => { resolve = done; }));
    const { container } = render(<ModalPresence><Suspense fallback={null}><Delayed close={() => {}} /></Suspense></ModalPresence>);
    tick(300);
    expect(container.querySelector("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("entering");
    await act(async () => { resolve({ default: Dialog }); });
    tick(20);
    expect(screen.getByRole("dialog").closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open");
    expect(document.activeElement).toBe(screen.getByText("Close Dialog"));
  });

  it("gives inline dialogs a scoped Escape handler and blocks all keys during exit", () => {
    const close = vi.fn();
    const { rerender } = render(<ModalPresence onDismiss={close}><div className="overlay"><section className="modal-shell" role="dialog"><button>Inline action</button></section></div></ModalPresence>);
    tick(20);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    rerender(<ModalPresence onDismiss={close}>{null}</ModalPresence>);
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("retains a dialog until its own transform finishes and blocks duplicate actions", () => {
    const save = vi.fn();
    render(<Harness save={save} />);
    const opener = screen.getByText("Open");
    opener.focus();
    fireEvent.click(opener);
    tick(20);
    const dialog = screen.getByRole("dialog");
    expect(document.activeElement).toBe(screen.getByText("Close Dialog"));
    fireEvent.click(screen.getByText("Save Dialog"));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Close Dialog"));
    expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("exiting");
    fireEvent.click(screen.getByText("Save Dialog"));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.transitionEnd(dialog, { propertyName: "opacity" });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    const end = new Event("transitionend", { bubbles: true });
    Object.defineProperty(end, "propertyName", { value: "transform" });
    fireEvent(dialog, end);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("handles parent-driven close, fallback removal and reopening during exit without stale removal", () => {
    render(<StrictMode><Harness /></StrictMode>);
    fireEvent.click(screen.getByText("Open"));
    tick(20);
    fireEvent.change(screen.getByLabelText("Input Dialog"), { target: { value: "unsaved" } });
    fireEvent.click(screen.getByText("External close"));
    tick(50);
    fireEvent.click(screen.getByText("Open"));
    tick(300);
    expect((screen.getByLabelText("Input Dialog") as HTMLInputElement).value).toBe("unsaved");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeNull();
    tick(221);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Open"));
    tick(20);
    expect((screen.getByLabelText("Input Dialog") as HTMLInputElement).value).toBe("");
  });

  it("removes immediately with reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<Harness />);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("Close Dialog"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps nullable-data props during exit", () => {
    const { rerender } = render(<ModalPresence><Dialog title="Record A" close={() => {}} /></ModalPresence>);
    tick(20);
    rerender(<ModalPresence>{null}</ModalPresence>);
    expect(screen.getByRole("dialog", { name: "Record A" })).toBeTruthy();
    tick(221);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only dismisses the most recently opened dialog and holds its focus until removal", () => {
    function Stacked() {
      const [upper, setUpper] = useState(false);
      const [lower, setLower] = useState(true);
      return <><ModalPresence>{upper ? <Dialog title="Upper" close={() => setUpper(false)} /> : null}</ModalPresence><ModalPresence>{lower ? <Dialog title="Lower" close={() => setLower(false)} save={() => setUpper(true)} /> : null}</ModalPresence></>;
    }
    render(<Stacked />);
    tick(20);
    fireEvent.click(screen.getByText("Save Lower"));
    tick(20);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    tick(221);
    expect(screen.queryByRole("dialog", { name: "Upper" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Lower" })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Lower" }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    tick(221);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
