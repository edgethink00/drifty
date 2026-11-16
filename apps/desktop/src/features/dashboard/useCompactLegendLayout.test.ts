// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { legendNeedsStacking } from "./useCompactLegendLayout";

/** A legend row whose name box is boxWidth wide and whose name text needs textWidth. */
function legend(available: number, name: { boxWidth: number; textWidth: number }): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = '<span class="row"><i class="swatch"></i><span class="label">Focus</span><span class="value">5h 15m</span></span>';
  document.body.append(root);
  Object.defineProperty(root, "clientWidth", { value: available });
  const [swatch, label, value] = Array.from(root.firstElementChild!.children) as HTMLElement[];
  Object.defineProperty(swatch, "offsetWidth", { value: 9 });
  // scrollWidth is never less than the box.
  Object.defineProperty(label, "scrollWidth", { value: Math.max(name.boxWidth, name.textWidth) });
  Object.defineProperty(value, "scrollWidth", { value: 57 });
  const widths = new Map<Node, number>([[label, name.textWidth], [value, 57]]);
  vi.spyOn(document, "createRange").mockImplementation(() => {
    let node: Node | null = null;
    return {
      selectNodeContents: (target: Node) => { node = target; },
      getBoundingClientRect: () => ({ width: node ? widths.get(node) ?? 0 : 0 }),
    } as unknown as Range;
  });
  return root;
}

describe("compact legend layout", () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; });

  it("keeps a short name and its value on one line", () => {
    expect(legendNeedsStacking(legend(119, { boxWidth: 41, textWidth: 41 }))).toBe(false);
  });

  it("comes back to one line after stacking, though the stacked name's box spans the row", () => {
    // Stacked, the name's box is 104px wide while its text still needs 41.
    expect(legendNeedsStacking(legend(119, { boxWidth: 104, textWidth: 41 }))).toBe(false);
  });

  it("stacks when the name itself does not fit beside its value", () => {
    expect(legendNeedsStacking(legend(119, { boxWidth: 41, textWidth: 70 }))).toBe(true);
  });

  it("stacks while the column is still narrower than the row needs", () => {
    expect(legendNeedsStacking(legend(80, { boxWidth: 41, textWidth: 41 }))).toBe(true);
  });
});
