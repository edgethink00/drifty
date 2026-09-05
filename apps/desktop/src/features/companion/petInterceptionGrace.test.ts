import { describe, expect, it } from "vitest";
import {
  PET_INTERCEPTION_GRACE_MS,
  buildPetInterceptionGrace,
  isPetInterceptionGraceActive,
} from "./petInterceptionGrace";

describe("petInterceptionGrace", () => {
  it("grants seventy seconds from the moment the pet is caught", () => {
    const caughtAtMs = 1_000_000;
    const grace = buildPetInterceptionGrace("drift:episode", caughtAtMs);

    expect(PET_INTERCEPTION_GRACE_MS).toBe(70_000);
    expect(grace).toEqual({
      episodeKey: "drift:episode",
      untilMs: caughtAtMs + 70_000,
    });
    expect(isPetInterceptionGraceActive(grace, "drift:episode", caughtAtMs + 69_999)).toBe(true);
    expect(isPetInterceptionGraceActive(grace, "drift:episode", caughtAtMs + 70_000)).toBe(false);
  });

  it("does not carry the grace into a different drift episode", () => {
    const grace = buildPetInterceptionGrace("drift:first", 1_000_000);

    expect(isPetInterceptionGraceActive(grace, "drift:second", 1_001_000)).toBe(false);
    expect(isPetInterceptionGraceActive(null, "drift:first", 1_001_000)).toBe(false);
  });
});
