// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readAppStyles } from "./test/readStyles";

function cssBlock(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(styles.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "g")));
  return matches[matches.length - 1]?.[0] ?? "";
}

describe("mixed app and favicon alignment styles", () => {
  const style = document.createElement("style");
  let styles: string;

  beforeAll(() => {
    // Parse the full application cascade once as shared fixture setup. Repeating
    // it inside assertions makes these layout checks depend on cold CSS parsing.
    styles = readAppStyles();
    style.textContent = styles;
    document.head.append(style);
  });

  afterEach(() => document.body.replaceChildren());
  afterAll(() => style.remove());

  it("computes lettered site fallbacks onto the centering layout", () => {
    const slot = document.createElement("span");
    slot.className = "usage-identity-icon usage-identity-icon--sm";
    const fallback = document.createElement("div");
    fallback.className = "site-favicon site-favicon--fallback";
    fallback.textContent = "N";
    slot.append(fallback);
    document.body.append(slot);

    const computed = getComputedStyle(fallback);

    expect(["flex", "inline-flex"]).toContain(computed.display);
    expect(computed.alignItems).toBe("center");
    expect(computed.justifyContent).toBe("center");
  });

  it("keeps resolved app and site images on a block layout without cropping artwork", () => {
    for (const className of ["site-favicon", "app-icon app-icon--md"]) {
      const image = document.createElement("img");
      image.className = className;
      document.body.append(image);

      const computed = getComputedStyle(image);

      expect(computed.display).toBe("block");
      expect(computed.objectFit).toBe("contain");
      if (image.classList.contains("app-icon")) expect(computed.borderRadius).toBe("0");
    }
  });

  it("uses stable icon slots for source rows that mix app icons and favicons", () => {
    const classificationSourceIconBlock = cssBlock(styles, ".classification-panel-view__source-icon");
    const historyIdentityIconBlock = cssBlock(styles, ".history-row__identity-icon");

    for (const block of [classificationSourceIconBlock, historyIdentityIconBlock]) {
      expect(block).toContain("width: 28px;");
      expect(block).toContain("height: 28px;");
    }
  });
});
