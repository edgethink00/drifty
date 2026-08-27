import { describe, expect, it } from "vitest";
import { resolveAuxiliarySurface } from "./auxiliarySurface";

describe("auxiliary surface routing", () => {
  it.each(["watcher", "companion"] as const)("accepts the %s surface", (surface) => {
    expect(resolveAuxiliarySurface(`?driftySurface=${surface}`)).toBe(surface);
  });

  it("rejects the retired drift alarm surface", () => {
    expect(resolveAuxiliarySurface("?driftySurface=drift-alarm")).toBeNull();
  });

  it("rejects missing and main-app routes", () => {
    expect(resolveAuxiliarySurface("")).toBeNull();
    expect(resolveAuxiliarySurface("?driftySurface=app")).toBeNull();
  });
});
