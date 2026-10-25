// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { visibleMenuArea } from "./settingsSelectArea";

const rect = (top: number, bottom: number, left: number, right: number) =>
  ({ top, bottom, left, right, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("visibleMenuArea", () => {
  it("keeps a floating menu inside a dialog that anchors it, and uses the window otherwise", () => {
    // A dialog shell, its scrolling body, and the select inside the body.
    const shell = document.createElement("section");
    const body = document.createElement("div");
    const root = document.createElement("div");
    shell.appendChild(body);
    body.appendChild(root);
    document.body.appendChild(shell);
    body.style.overflowX = "auto";
    body.style.overflowY = "auto";
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(193, 600, 208, 900));
    const windowArea = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };

    // Fixed menus escape a scrolled list placed against the window.
    expect(visibleMenuArea(root)).toEqual(windowArea);

    // A modal whose backdrop or transform anchors fixed descendants lets its body clip
    // them, so the menu must stay below the dialog's header and inside its body.
    shell.style.transform = "translateZ(0)";
    expect(visibleMenuArea(root)).toEqual({ top: 193, bottom: 600, left: 208, right: 900 });

    // A box too small to hold a menu keeps the window instead of a sliver.
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(rect(193, 230, 208, 900));
    expect(visibleMenuArea(root)).toEqual(windowArea);
  });
});

