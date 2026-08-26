import { describe, expect, it } from "vitest";

import { buildShortCommit, createBuildInfo, normalizeAppVersion, normalizeBuildCommit } from "./buildInfo";

describe("buildInfo", () => {
  it("normalizes an empty build commit to unknown", () => {
    expect(normalizeBuildCommit("   ")).toBe("unknown");
  });

  it("keeps the full commit while exposing a short display value", () => {
    const commit = "d1f00b6a2cc9a43278b4e3f61234567890123456";

    expect(createBuildInfo(commit)).toEqual({
      commit,
      shortCommit: "d1f00b6a2cc9",
      version: "1.8.0",
    });
  });

  it("does not shorten an unknown commit", () => {
    expect(buildShortCommit("unknown")).toBe("unknown");
  });

  it("normalizes an empty app version to unknown", () => {
    expect(normalizeAppVersion("  ")).toBe("unknown");
  });
});
