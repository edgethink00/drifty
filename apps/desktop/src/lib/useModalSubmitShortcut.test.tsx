// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useModalSubmitShortcut, type ModalSubmitShortcut } from "./useModalSubmitShortcut";

afterEach(cleanup);

function Editor({ shortcut, onSubmit, disabled = false, children }: {
  readonly shortcut: ModalSubmitShortcut;
  readonly onSubmit: () => void;
  readonly disabled?: boolean;
  readonly children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalSubmitShortcut(dialogRef, shortcut, onSubmit, { disabled });
  return (
    <section ref={dialogRef} role="dialog" aria-label="Editor">
      <input aria-label="Name" />
      <textarea aria-label="Description" />
      <input type="checkbox" aria-label="Pin" />
      <button type="button">Cancel</button>
      {children}
    </section>
  );
}

describe("useModalSubmitShortcut", () => {
  it("submits with Enter from a single-line field and leaves newlines and other keys alone", () => {
    const onSubmit = vi.fn();
    render(<Editor shortcut="enter" onSubmit={onSubmit} />);

    expect(fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter" })).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", metaKey: true });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter", shiftKey: true });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "a" });
    expect(onSubmit).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" })).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("lets a focused button keep Enter for itself", () => {
    const onSubmit = vi.fn();
    render(<Editor shortcut="modEnter" onSubmit={onSubmit} />);

    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), { key: "Enter" })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("never submits on the Enter that commits Hangul composition", () => {
    const onSubmit = vi.fn();
    render(<Editor shortcut="enter" onSubmit={onSubmit} />);
    const name = screen.getByLabelText("Name");

    fireEvent.keyDown(name, { key: "Enter", isComposing: true });
    fireEvent.keyDown(name, { key: "Enter", keyCode: 229 });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(name, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits a multi-line form with ⌘/Ctrl+Enter from any field while plain Enter in the textarea stays a newline", () => {
    const onSubmit = vi.fn();
    render(<Editor shortcut="modEnter" onSubmit={onSubmit} />);

    expect(fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter" })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter", metaKey: true });
    fireEvent.keyDown(screen.getByLabelText("Pin"), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(3);
  });

  it("does nothing while the primary action is unavailable", () => {
    const onSubmit = vi.fn();
    render(<Editor shortcut="modEnter" onSubmit={onSubmit} disabled />);

    fireEvent.keyDown(screen.getByLabelText("Name"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Description"), { key: "Enter", metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("defers to an inner control that handled Enter and to a nested dialog", () => {
    const onSubmit = vi.fn();
    render(
      <Editor shortcut="modEnter" onSubmit={onSubmit}>
        <input aria-label="Tag" onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
        <div role="dialog" aria-label="Color picker">
          <input aria-label="Hex" />
        </div>
      </Editor>,
    );

    fireEvent.keyDown(screen.getByLabelText("Tag"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Hex"), { key: "Enter" });
    fireEvent.keyDown(screen.getByLabelText("Hex"), { key: "Enter", metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("leaves plain Enter inside a form to the browser's own submission", () => {
    const onSubmit = vi.fn();
    render(
      <Editor shortcut="modEnter" onSubmit={onSubmit}>
        <form>
          <input aria-label="Email" />
        </form>
      </Editor>,
    );

    expect(fireEvent.keyDown(screen.getByLabelText("Email"), { key: "Enter" })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Email"), { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
