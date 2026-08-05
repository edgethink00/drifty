import { describe, expect, it } from "vitest";
import { resolveAuxiliarySurface } from "./auxiliarySurface";

describe("auxiliary surface routing", () => {
  it.each(["watcher", "companion", "drift-alarm"] as const)("accepts the %s surface", (surface) => {
    expect(resolveAuxiliarySurface(`?driftySurface=${surface}`)).toBe(surface);
  });

  it("rejects missing and main-app routes", () => {
    expect(resolveAuxiliarySurface("")).toBeNull();
    expect(resolveAuxiliarySurface("?driftySurface=app")).toBeNull();
  });
});
