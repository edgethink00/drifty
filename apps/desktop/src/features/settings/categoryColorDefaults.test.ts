import { describe, expect, it } from "vitest";
import { readAppStyles } from "../../test/readStyles";
import { CATEGORY_COLOR_OPTIONS } from "./settingsStorage";

describe("category color defaults", () => {
  it("uses a plum social-media tone that stays distinct from Drift in both themes", () => {
    const socialMedia = CATEGORY_COLOR_OPTIONS.find((option) => option.key === "social_media");
    const styles = readAppStyles();

    expect(socialMedia?.defaultColor).toBe("#9b5b91");
    expect(styles).toMatch(
      /:root\[data-theme="light"\]\s*\{[\s\S]*?--category-social-media:\s*#9b5b91;[\s\S]*?\}/,
    );
    expect(styles).toMatch(
      /:root\[data-theme="dark"\]\s*\{[\s\S]*?--category-social-media:\s*#c17db4;[\s\S]*?\}/,
    );
  });
});
