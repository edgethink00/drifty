// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KeyHint } from "./KeyHint";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.platform;
});

function Actions() {
  return (
    <>
      <button type="button">Cancel<KeyHint shortcut="escape" /></button>
      <button type="button">Create<KeyHint shortcut="enter" /></button>
      <button type="button">Save<KeyHint shortcut="modEnter" /></button>
    </>
  );
}

describe("KeyHint", () => {
  it("shows macOS key glyphs and announces the key on its button instead of in the name", () => {
    render(<Actions />);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const create = screen.getByRole("button", { name: "Create" });
    const save = screen.getByRole("button", { name: "Save" });
    expect([cancel.textContent, create.textContent, save.textContent]).toEqual(["CancelEsc", "Create↵", "Save⌘↵"]);
    expect([cancel, create, save].map((button) => button.getAttribute("aria-keyshortcuts"))).toEqual(["Escape", "Enter", "Meta+Enter"]);
  });

  it("spells the keys out on Windows", () => {
    document.documentElement.dataset.platform = "windows";
    render(<Actions />);

    expect(screen.getByRole("button", { name: "Cancel" }).textContent).toBe("CancelEsc");
    expect(screen.getByRole("button", { name: "Create" }).textContent).toBe("CreateEnter");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.textContent).toBe("SaveCtrl+Enter");
    expect(save.getAttribute("aria-keyshortcuts")).toBe("Control+Enter");
  });
});
