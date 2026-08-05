// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPANION_HIDDEN_UNTIL_STORAGE_KEY,
  COMPANION_DAY_REVIEW_LAYOUT_STORAGE_KEY,
  COMPANION_MENU_BAR_DISPLAY_STORAGE_KEY,
  COMPANION_PILL_STORAGE_KEY,
  COMPANION_SURFACE_POLICY_STORAGE_KEY,
  LEGACY_COMPANION_PILL_STORAGE_KEY,
  persistCompanionHiddenUntil,
  persistCompanionDayReviewLayout,
  persistCompanionMenuBarDisplayMode,
  persistCompanionPillEnabled,
  persistCompanionSurfacePolicy,
  resolveInitialCompanionHiddenUntil,
  resolveInitialCompanionDayReviewLayout,
  resolveInitialCompanionMenuBarDisplayMode,
  resolveInitialCompanionPillEnabled,
  resolveInitialCompanionSurfacePolicy,
  resolveEffectiveCompanionSurfacePolicy,
} from "./companionPillSettings";

describe("Companion visibility settings", () => {
  afterEach(() => {
    window.localStorage.removeItem(COMPANION_PILL_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_COMPANION_PILL_STORAGE_KEY);
    window.localStorage.removeItem(COMPANION_SURFACE_POLICY_STORAGE_KEY);
    window.localStorage.removeItem(COMPANION_MENU_BAR_DISPLAY_STORAGE_KEY);
    window.localStorage.removeItem(COMPANION_HIDDEN_UNTIL_STORAGE_KEY);
    window.localStorage.removeItem(COMPANION_DAY_REVIEW_LAYOUT_STORAGE_KEY);
  });

  it("defaults to the Focus-time menu-bar Companion and persists a permanent off choice", () => {
    expect(resolveInitialCompanionPillEnabled()).toBe(true);
    expect(resolveInitialCompanionSurfacePolicy()).toBe("menuBar");
    expect(resolveInitialCompanionMenuBarDisplayMode()).toBe("focusTime");
    expect(resolveInitialCompanionDayReviewLayout()).toBe("minimal");

    persistCompanionPillEnabled(false);
    expect(resolveInitialCompanionPillEnabled()).toBe(false);
    expect(resolveInitialCompanionSurfacePolicy()).toBe("off");
  });

  it("preserves the choice from the earlier Dev setting", () => {
    window.localStorage.setItem(LEGACY_COMPANION_PILL_STORAGE_KEY, "false");
    expect(resolveInitialCompanionPillEnabled()).toBe(false);
  });

  it("routes beta-off users to legacy regardless of stored Companion choices", () => {
    expect(resolveEffectiveCompanionSurfacePolicy(false, "floating", false)).toBe("off");
    expect(resolveEffectiveCompanionSurfacePolicy(false, "menuBar", false)).toBe("off");
    expect(resolveEffectiveCompanionSurfacePolicy(true, "menuBar", false)).toBe("menuBar");
    expect(resolveEffectiveCompanionSurfacePolicy(true, "floating", true)).toBe("off");
  });

  it("persists the selected Companion placement and menu-bar display", () => {
    persistCompanionSurfacePolicy("floating");
    persistCompanionMenuBarDisplayMode("donutFocusTime");

    expect(resolveInitialCompanionSurfacePolicy()).toBe("floating");
    expect(resolveInitialCompanionMenuBarDisplayMode()).toBe("donutFocusTime");
  });

  it("persists the selected Day review layout", () => {
    persistCompanionDayReviewLayout("full");
    expect(resolveInitialCompanionDayReviewLayout()).toBe("full");

    persistCompanionDayReviewLayout("compact");
    expect(resolveInitialCompanionDayReviewLayout()).toBe("compact");

    persistCompanionDayReviewLayout("minimal");
    expect(resolveInitialCompanionDayReviewLayout()).toBe("minimal");
  });

  it("restores an active temporary hide and clears it after expiry", () => {
    const now = 1_000_000;
    persistCompanionHiddenUntil(now + 60_000);
    expect(resolveInitialCompanionHiddenUntil(now)).toBe(now + 60_000);

    expect(resolveInitialCompanionHiddenUntil(now + 60_001)).toBeNull();
    expect(window.localStorage.getItem(COMPANION_HIDDEN_UNTIL_STORAGE_KEY)).toBeNull();
  });
});
