import { describe, expect, it } from "vitest";
import { buildAutomaticCloseOverride, resolveEffectiveAutomaticCloseEnabled } from "../companion/automaticCloseOverride";
import { buildPetModeHidePause } from "./petModeHidePause";

describe("one-hour pet hide pause", () => {
  const now = 1_000;
  const hour = 3_600_000;

  it.each([true, false])("resumes the current saved setting (%s) only after the hour", (savedEnabled) => {
    const pause = buildPetModeHidePause(null, now);
    expect(resolveEffectiveAutomaticCloseEnabled(savedEnabled, pause, now)).toBe(false);
    expect(resolveEffectiveAutomaticCloseEnabled(savedEnabled, pause, now + hour - 1)).toBe(false);
    expect(resolveEffectiveAutomaticCloseEnabled(savedEnabled, pause, now + hour)).toBe(savedEnabled);
    // A setting changed during the pause is authoritative when it ends.
    expect(resolveEffectiveAutomaticCloseEnabled(!savedEnabled, pause, now + hour)).toBe(!savedEnabled);
  });

  it("extends a shorter pause to the hide deadline", () => {
    const shorter = buildAutomaticCloseOverride(false, "15", now - 100);
    expect(buildPetModeHidePause(shorter, now).endsAtMs).toBe(now + hour);
  });

  it("does not shorten a longer or indefinite pause", () => {
    const longer = buildAutomaticCloseOverride(false, "60", now + 100);
    const indefinite = buildAutomaticCloseOverride(false, "forever", now);
    expect(buildPetModeHidePause(longer, now)).toBe(longer);
    expect(buildPetModeHidePause(indefinite, now)).toBe(indefinite);
  });

  it("overrides temporary activation and ignores expired pauses", () => {
    expect(buildPetModeHidePause(buildAutomaticCloseOverride(true, "forever", now), now))
      .toEqual(buildAutomaticCloseOverride(false, "60", now));
    expect(buildPetModeHidePause(buildAutomaticCloseOverride(false, "15", 0), hour))
      .toEqual(buildAutomaticCloseOverride(false, "60", hour));
  });
});
