// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_LEGACY_COAT_STORAGE_KEY,
  PET_MODE_LEGACY_STORAGE_KEY,
  PET_MODE_SIZES,
  PET_MODE_SIZE_STORAGE_KEY,
  PET_MODE_STORAGE_KEY,
  PET_MODE_DEFAULT_SIZE,
  getPetModeWindowSize,
  isPetModeSize,
  resolveInitialPetModeCoat,
  resolveInitialPetModeEnabled,
  resolveInitialPetModeSize,
} from "./petModeData";

const app = readFileSync("src/App.tsx", "utf8");
const accountMenu = readFileSync("src/features/auth/AccountMenu.tsx", "utf8");
const devSettings = readFileSync("src/features/settings/DevSettingsSection.tsx", "utf8");
const notifications = readFileSync("src/features/settings/NotificationsSettingsSection.tsx", "utf8");

describe("pet promoted out of Dev", () => {
  beforeEach(() => window.localStorage.clear());

  it("stores its settings under production keys", () => {
    expect(PET_MODE_STORAGE_KEY).not.toContain(".dev.");
    expect(PET_MODE_COAT_STORAGE_KEY).not.toContain(".dev.");
    expect(PET_MODE_SIZE_STORAGE_KEY).not.toContain(".dev.");
  });

  it("carries a Dev-preview user's pet and coat over to the new keys", () => {
    window.localStorage.setItem(PET_MODE_LEGACY_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_LEGACY_COAT_STORAGE_KEY, "charcoal");
    expect(resolveInitialPetModeEnabled()).toBe(true);
    expect(resolveInitialPetModeCoat()).toBe("charcoal");
  });

  it("lets the new key win once the user changes the setting", () => {
    window.localStorage.setItem(PET_MODE_LEGACY_STORAGE_KEY, "1");
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
    expect(resolveInitialPetModeEnabled()).toBe(false);
  });

  it("does not switch the pet off when Dev mode is turned off", () => {
    // The reset block that clears Dev-only previews must not reach the pet, or
    // a production user loses their pet whenever they leave Dev mode.
    const resetBlock = app.slice(app.indexOf("if (settingsSection === \"dev\") setSettingsSection(\"general\");"));
    const block = resetBlock.slice(0, resetBlock.indexOf("}, ["));
    expect(block).not.toContain("setPetModeEnabled");
  });

  it("is not gated behind Dev mode when deciding to show the pet", () => {
    expect(app).toContain("const petModeActive = petModeEnabled;");
  });

  it("offers the visibility toggle in the account menu", () => {
    expect(accountMenu).toContain('t("settings.pet.show")');
    expect(accountMenu).toContain('role="menuitemcheckbox"');
    // Signed-out users still own a local pet, so the toggle must not sit
    // inside the signed-in-only branch.
    const petIndex = accountMenu.indexOf('t("settings.pet.show")');
    const profileIndex = accountMenu.indexOf("showProfile ?");
    expect(petIndex).toBeLessThan(profileIndex);
  });

  it("moves coat and size into Companion settings, leaving only the Lab in Dev", () => {
    expect(notifications).toContain("PetSettings");
    expect(devSettings).toContain("Pet Mode Lab");
    expect(devSettings).not.toContain("PetCoatPicker");
  });
});

describe("pet size", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to 100% and rejects unknown values", () => {
    expect(PET_MODE_DEFAULT_SIZE).toBe(100);
    expect(resolveInitialPetModeSize()).toBe(100);
    window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "63");
    expect(resolveInitialPetModeSize()).toBe(100);
    expect(isPetModeSize(75)).toBe(true);
    expect(isPetModeSize(63)).toBe(false);
  });

  it("restores a stored size", () => {
    window.localStorage.setItem(PET_MODE_SIZE_STORAGE_KEY, "125");
    expect(resolveInitialPetModeSize()).toBe(125);
  });

  it("scales the native panel from the reviewed 144x99 layout", () => {
    expect(getPetModeWindowSize(100)).toEqual({ width: 144, height: 99 });
    expect(getPetModeWindowSize(50)).toEqual({ width: 72, height: 50 });
    expect(getPetModeWindowSize(125)).toEqual({ width: 180, height: 124 });
    for (const size of PET_MODE_SIZES) {
      const { width, height } = getPetModeWindowSize(size);
      expect(Number.isInteger(width)).toBe(true);
      expect(Number.isInteger(height)).toBe(true);
    }
  });

  it("resizes the native window whenever size or visibility changes", () => {
    // The window is recreated at its default size each time the pet is shown,
    // so a non-default size has to be re-applied on that transition too.
    expect(app).toContain("[petModeActive, petModeSize]");
  });
});
