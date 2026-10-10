import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TRACKER_ACTIONS } from "./eventTaxonomy";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

function readProductSources(): ReadonlyArray<{ readonly path: string; readonly text: string }> {
  return readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry))
    .map((entry) => ({
      path: entry,
      text: readFileSync(`${sourceRoot}${entry}`, "utf8"),
    }));
}

/**
 * Volume, not correctness, is what this file protects.
 *
 * Every event below is produced by something the machine decides to do — an
 * interval elapsed, a batch finished, a view re-rendered — so its count tracks
 * how long the app stayed open rather than anything a person did. Sending them
 * per occurrence is what pushed monthly ingestion past a million events. They
 * must go through the daily cap, and a future change that reaches for the
 * per-occurrence helper again should fail here rather than in the bill.
 *
 * `leaderboard_action` and `billing_action` are deliberately absent: their
 * manual publish, opt-out, checkout and portal paths are single decisions a
 * person made, and those stay per-occurrence.
 */
const MACHINE_DRIVEN_EVENTS = [
  "app_surface_opened",
  "app_error",
  "app_launch_environment",
  "ai_classification_run",
  "project_classification_run",
  "memory_suggestion_run",
  "app_update",
] as const;

describe("analytics volume contract", () => {
  it("never sends a machine-driven event through the per-occurrence helper", () => {
    const offenders = readProductSources().flatMap(({ path, text }) => MACHINE_DRIVEN_EVENTS
      .filter((event) => new RegExp(`capturePostHogEvent\\(\\s*"${event}"`).test(text))
      .map((event) => `${path}: ${event}`));

    expect(offenders).toEqual([]);
  });

  it("defaults a leaderboard refresh to reporting nothing on success", () => {
    // Most callers are machine-driven: a classification batch saved rows, an
    // interval elapsed, a publish landed. A new caller that forgets to say what
    // it is must be silent, not counted as somebody opening the leaderboard.
    const controller = readFileSync(
      new URL("../../features/leaderboard/useLeaderboardProfileController.ts", import.meta.url),
      "utf8",
    );

    expect(controller).toContain('origin: "user_open" | "background" = "background",');
    expect(controller).toContain('if (origin === "user_open") {');
  });

  it("keeps the background classification path from reporting a leaderboard load", () => {
    const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");

    // Narrow on purpose: an unrelated `user_open` string elsewhere in this very
    // large file must not fail this test, but a refresh call asking to be counted
    // as somebody opening the leaderboard must.
    expect(appSource).not.toMatch(/refreshLeaderboardData\([^)]*user_open/);
  });

  it("pins the schema version that separates capped data from per-occurrence data", () => {
    // A time series that spans the cutover shows a cliff that reads as a broken
    // feature. Changing delivery again without moving this version would hide
    // the next break the same way.
    const runtime = readFileSync(new URL("./posthog.ts", import.meta.url), "utf8");

    expect(runtime).toContain('readonly analytics_schema_version: "v3";');
    expect(runtime).toContain('analytics_schema_version: "v3",');
  });

  it("declares only tracker actions that are actually sent", () => {
    // `refresh` and `status_check` were declared but never emitted, so analysis
    // queries looked for rows that could not exist.
    expect([...TRACKER_ACTIONS]).toEqual(["start", "stop"]);
  });
});
