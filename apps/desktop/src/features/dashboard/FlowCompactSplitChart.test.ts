import { describe, expect, it } from "vitest";
import type { CategoryDuration } from "@drifty/domain";
import { buildActiveCategoryEntries, buildClassifiedCategoryEntries } from "./FlowCompactSplitChart";

const workspace: CategoryDuration = { category: "workspace", totalSeconds: 3600, segments: 2, ratio: 0.36 };
const unknown: CategoryDuration = { category: "unknown", totalSeconds: 4400, segments: 4, ratio: 0.44 };
const entertainment: CategoryDuration = { category: "entertainment", totalSeconds: 2000, segments: 1, ratio: 0.2 };

describe("buildActiveCategoryEntries", () => {
  it("keeps unclassified last among active categories", () => {
    expect(buildActiveCategoryEntries([unknown, workspace, entertainment]).map((entry) => entry.category)).toEqual([
      "workspace",
      "entertainment",
      "unknown",
    ]);
  });
});

describe("buildClassifiedCategoryEntries", () => {
  it("omits unclassified and reanchors shares to classified time", () => {
    expect(buildClassifiedCategoryEntries([unknown, workspace, entertainment])).toEqual([
      { ...workspace, ratio: 3600 / 5600 },
      { ...entertainment, ratio: 2000 / 5600 },
    ]);
  });

  it("returns an empty list when only unclassified time exists", () => {
    expect(buildClassifiedCategoryEntries([unknown])).toEqual([]);
  });
});
