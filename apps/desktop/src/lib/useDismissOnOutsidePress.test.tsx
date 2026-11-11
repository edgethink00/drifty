// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { useDismissOnOutsidePress } from "./useDismissOnOutsidePress";

function Menu({ escape, containEscape, onParentKey }: { readonly escape?: boolean; readonly containEscape?: boolean; readonly onParentKey?: () => void }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismissOnOutsidePress(open, () => setOpen(false), [trigger, menu], { returnFocusTo: trigger, escape, containEscape });
  return (
    <div onKeyDown={onParentKey}>
      <button ref={trigger} type="button" onClick={() => setOpen((value) => !value)}>More</button>
      {open ? <div ref={menu} role="menu"><button type="button" role="menuitem">Rename</button></div> : null}
      <button type="button">Elsewhere</button>
    </div>
  );
}

describe("useDismissOnOutsidePress", () => {
  it("closes on a press outside and stays open for a press on the popup", () => {
    render(<Menu />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.pointerDown(screen.getByRole("menuitem", { name: "Rename" }));
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves a second press on the trigger to the trigger's own click, so it closes once", () => {
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    fireEvent.pointerDown(trigger);
    expect(screen.queryByRole("menu")).not.toBeNull();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<Menu />);
    const trigger = screen.getByRole("button", { name: "More" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("leaves Escape alone when the popup handles it itself", () => {
    render(<Menu escape={false} />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeNull();
  });

  it("keeps a contained Escape from reaching a shortcut on the window", () => {
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    render(<Menu containEscape />);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Rename" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onWindowKey).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKey);
  });

  it("stops listening once the popup is closed", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    render(<Menu />);
    expect(add.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(add.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(1);
    fireEvent.pointerDown(document.body);
    expect(remove.mock.calls.filter(([type]) => type === "pointerdown")).toHaveLength(1);
    add.mockRestore();
    remove.mockRestore();
  });
});
