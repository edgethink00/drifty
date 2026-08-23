import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PublicationBoundary = {
  readonly label: string;
  readonly path: string;
  readonly minimumFilterCalls: number;
};

// Canonical inventory of every production path that turns local activity
// segments into public/shared aggregates. Adding a new publication surface
// requires adding it here and applying the local-only passive-time exclusion.
const PUBLICATION_BOUNDARIES: readonly PublicationBoundary[] = [
  {
    label: "leaderboard payload builders",
    path: "./features/leaderboard/leaderboardPublisher.ts",
    minimumFilterCalls: 2,
  },
  {
    label: "leaderboard profile metrics",
    path: "./features/leaderboard/useLeaderboardProfileController.ts",
    minimumFilterCalls: 1,
  },
  {
    label: "public focus-card payload builders",
    path: "./features/share/focusCardPublisher.ts",
    minimumFilterCalls: 2,
  },
  {
    label: "team project totals",
    path: "./features/team/teamProjectTime.ts",
    minimumFilterCalls: 1,
  },
] as const;

describe("passive presence publication boundary", () => {
  it.each(PUBLICATION_BOUNDARIES)(
    "$label keeps foreground-audio-supported time local-only",
    ({ path, minimumFilterCalls }) => {
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
      const filterCalls = source.match(/isPassiveSupportedSegment\s*\(/g) ?? [];

      expect(source).toMatch(/from\s+["']@drifty\/domain["']/);
      expect(filterCalls.length).toBeGreaterThanOrEqual(minimumFilterCalls);
    },
  );
});
