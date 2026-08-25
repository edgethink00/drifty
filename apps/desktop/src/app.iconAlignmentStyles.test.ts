// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readAppStyles } from "./test/readStyles";

function cssBlock(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(styles.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "g")));
  return matches[matches.length - 1]?.[0] ?? "";
}

describe("mixed app and favicon alignment styles", () => {
  it("computes lettered site fallbacks onto the centering layout", () => {
    const style = document.createElement("style");
    style.textContent = readAppStyles();
    document.head.append(style);

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

  it("keeps resolved site images on the block cover layout", () => {
    const style = document.createElement("style");
    style.textContent = readAppStyles();
    document.head.append(style);

    const image = document.createElement("img");
    image.className = "site-favicon";
    document.body.append(image);

    const computed = getComputedStyle(image);

    expect(computed.display).toBe("block");
    expect(computed.objectFit).toBe("cover");
  });

  it("uses stable icon slots for source rows that mix app icons and favicons", () => {
    const styles = readAppStyles();
    const classificationSourceIconBlock = cssBlock(styles, ".classification-panel-view__source-icon");
    const historyIdentityIconBlock = cssBlock(styles, ".history-row__identity-icon");

    for (const block of [classificationSourceIconBlock, historyIdentityIconBlock]) {
      expect(block).toContain("width: 28px;");
      expect(block).toContain("height: 28px;");
    }
  });
});
