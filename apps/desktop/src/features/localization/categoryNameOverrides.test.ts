import { describe, expect, it } from "vitest";
import { parseCategoryNameOverrideKey, withCategoryNameOverrides } from "./categoryNameOverrides";
import { translateFor } from "./translate";

describe("withCategoryNameOverrides", () => {
  it("shows the user's names for built-in category labels only", () => {
    const t = withCategoryNameOverrides(translateFor("ko"), { categories: { learning: "개발 공부" } });

    expect(t("activity.category.learning")).toBe("개발 공부");
    expect(t("activity.category.workspace")).toBe("작업");
    expect(t("common.save")).toBe("저장");
  });

  it("shows the user's names for productivity labels", () => {
    const t = withCategoryNameOverrides(translateFor("ko"), parseCategoryNameOverrideKey(JSON.stringify({ categories: {}, productivity: { focus: "몰입" } })));

    expect(t("activity.productivity.focus")).toBe("몰입");
    expect(t("activity.productivity.drift")).toBe("딴짓");
  });
});
