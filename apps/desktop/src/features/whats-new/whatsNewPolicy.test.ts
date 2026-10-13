import { describe, expect, it } from "vitest";
import { entriesForBuild } from "./whatsNewPolicy";
import type { WhatsNewEntry } from "./whatsNewChangelog";

function entry(fromVersion: string, options: { toVersion?: string; platforms?: WhatsNewEntry["platforms"]; date?: string } = {}): WhatsNewEntry {
  const toVersion = options.toVersion ?? fromVersion;
  return {
    id: "v" + fromVersion,
    date: options.date ?? "2026-10-01",
    label: "v" + fromVersion,
    platforms: options.platforms ?? ["macos", "windows"],
    fromVersion,
    toVersion,
    summary: "Summary.",
    items: ["Item."],
  };
}

describe("changelog chapters for this build", () => {
  it("keeps this platform's chapters the build contains, newest first", () => {
    const list = [
      entry("1.11.17", { toVersion: "1.11.21" }),
      entry("1.13.1"),
      entry("1.13.0", { platforms: ["windows"] }),
      entry("1.12.9", { platforms: ["macos"] }),
    ];
    expect(entriesForBuild(list, "macos", "1.13.0").map((item) => item.label)).toEqual(["v1.12.9", "v1.11.17"]);
    expect(entriesForBuild(list, null, "1.13.0")).toEqual([]);
  });
});
