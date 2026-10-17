// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { createPetModeCustomCoat, getPetModeCoatSpec, isPetModeCoat, parsePetModeCustomCoat, petModeCoatRamp } from "./petModeCoats";
import { PET_MODE_COAT_STORAGE_KEY, resolveInitialPetModeCoat, resolvePetModeCoatShown, PET_MODE_COAT_PREVIEW_STORAGE_KEY } from "./petModeData";

beforeEach(() => window.localStorage.clear());

it("restores every shipped value with its exact fur and ink", () => {
  for (const [name, fur, ink] of [
    ["ivory", "#e8e5da", "#171916"], ["grey", "#a3a199", "#1a1b18"],
    ["charcoal", "#33332f", "#f2f1ed"], ["apricot", "#d9b18c", "#3c2b1c"],
    ["sage", "#93a88e", "#1c241a"], ["plum", "#7a5f6b", "#efe6ea"],
  ] as const) {
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, name);
    expect(resolveInitialPetModeCoat()).toBe(name);
    expect(getPetModeCoatSpec(name)).toMatchObject({ fur, ink });
  }
});

it("rounds and bounds custom values and rejects malformed stored values", () => {
  expect(createPetModeCustomCoat(-1, 1)).toBe("custom-0-30");
  expect(createPetModeCustomCoat(720, 100)).toBe("custom-359-92");
  expect(createPetModeCustomCoat(193.4, 74.9)).toBe("custom-193-75");
  expect(createPetModeCustomCoat(NaN, Infinity)).toBe("custom-18-74");
  for (const value of ["custom-360-74", "custom-18-29", "custom-18-93", "custom-018-74", "custom-18.5-74", "custom-NaN-74", "custom-18-74-extra"]) {
    expect(isPetModeCoat(value), value).toBe(false);
    window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, value);
    expect(resolveInitialPetModeCoat()).toBe("ivory");
  }
});

it("previews custom without changing saved skin and restores the saved skin when preview ends", () => {
  window.localStorage.setItem(PET_MODE_COAT_STORAGE_KEY, "mist");
  window.localStorage.setItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY, "custom-194-69");
  expect(resolvePetModeCoatShown()).toBe("custom-194-69");
  expect(resolveInitialPetModeCoat()).toBe("mist");
  window.localStorage.removeItem(PET_MODE_COAT_PREVIEW_STORAGE_KEY);
  expect(resolvePetModeCoatShown()).toBe("mist");
});

it("produces finite in-gamut ink/body ramps across the editor's full bounds", () => {
  for (const h of [0, 60, 120, 180, 240, 300, 359]) for (const l of [30, 57, 58, 74, 92]) {
    const coat = createPetModeCustomCoat(h, l), spec = getPetModeCoatSpec(coat);
    expect(parsePetModeCustomCoat(coat)).toEqual({ hue: h, lightness: l });
    expect(spec.fur).toMatch(/^#[0-9a-f]{6}$/);
    expect(spec.ink).toMatch(/^#[0-9a-f]{6}$/);
    for (const [channel, values] of petModeCoatRamp(coat).entries()) {
      const ramp = values.split(" ").map(Number);
      expect(ramp).toHaveLength(18);
      expect(ramp.every(n => Number.isFinite(n) && n >= 0 && n <= 1.000001)).toBe(true);
      expect(ramp[0]).toBeCloseTo(parseInt(spec.ink.slice(1+2*channel,3+2*channel),16)/255, 5);
      expect(ramp[17]).toBeCloseTo(parseInt(spec.fur.slice(1+2*channel,3+2*channel),16)/255, 5);
    }
  }
});
