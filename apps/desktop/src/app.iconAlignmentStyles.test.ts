import { describe, expect, it } from "vitest";
import { readAppStyles } from "./test/readStyles";

function cssBlock(styles: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = Array.from(styles.matchAll(new RegExp(`(?:^|\\n)\\s*${escapedSelector}\\s*\\{[\\s\\S]*?\\n\\s*\\}`, "g")));
  return matches[matches.length - 1]?.[0] ?? "";
}

describe("mixed app and favicon alignment styles", () => {
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
