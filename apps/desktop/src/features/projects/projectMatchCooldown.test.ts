import { describe, expect, it } from "vitest";

import {
  formatProjectMatchCooldown,
  PROJECT_MATCH_COOLDOWN_MS,
  resolveProjectMatchCooldown,
} from "./projectMatchCooldown";

const nowMs = Date.parse("2026-08-31T12:00:00.000Z");
const at = (offsetMs: number) => nowMs + offsetMs;

describe("projectMatchCooldown", () => {
  it("stays inactive when no clean pass has been observed yet", () => {
    expect(resolveProjectMatchCooldown(null, nowMs).active).toBe(false);
    expect(resolveProjectMatchCooldown(undefined, nowMs).active).toBe(false);
  });

  it("blocks a re-run immediately after a pass and reports the remaining time", () => {
    const cooldown = resolveProjectMatchCooldown(at(-30_000), nowMs);
    expect(cooldown.active).toBe(true);
    expect(cooldown.remainingSeconds).toBe(90);
  });

  it("releases once the window has fully elapsed", () => {
    expect(resolveProjectMatchCooldown(at(-PROJECT_MATCH_COOLDOWN_MS), nowMs).active).toBe(false);
    expect(resolveProjectMatchCooldown(at(-PROJECT_MATCH_COOLDOWN_MS - 1), nowMs).active).toBe(false);
  });

  it("releases immediately when the recorded success is ahead of now", () => {
    // Otherwise a clock change would hold the button until wall time caught up.
    expect(resolveProjectMatchCooldown(at(60 * 60 * 1000), nowMs).active).toBe(false);
    expect(resolveProjectMatchCooldown(at(1_000), nowMs).active).toBe(false);
  });

  it("ignores a non-finite timestamp instead of guessing", () => {
    expect(resolveProjectMatchCooldown(Number.NaN, nowMs).active).toBe(false);
  });

  it("formats the remaining time for a readable countdown", () => {
    expect(formatProjectMatchCooldown(72)).toBe("1:12");
    expect(formatProjectMatchCooldown(45)).toBe("45s");
    expect(formatProjectMatchCooldown(0)).toBe("0s");
  });
});
