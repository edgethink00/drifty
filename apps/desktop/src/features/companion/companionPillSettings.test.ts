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

  it("defaults to the donut menu-bar Companion and persists a permanent off choice", () => {
    expect(resolveInitialCompanionPillEnabled()).toBe(true);
    expect(resolveInitialCompanionSurfacePolicy()).toBe("menuBar");
    // The donut is the only display narrow enough to survive a crowded menu
    // bar; a titled display can be pushed off the right screen edge.
    expect(resolveInitialCompanionMenuBarDisplayMode()).toBe("donut");
    expect(resolveInitialCompanionDayReviewLayout()).toBe("minimal");

    persistCompanionPillEnabled(false);
    expect(resolveInitialCompanionPillEnabled()).toBe(false);
    expect(resolveInitialCompanionSurfacePolicy()).toBe("off");
  });

  it("keeps the timed menu-bar displays available as explicit choices", () => {
    persistCompanionMenuBarDisplayMode("focusTime");
    expect(resolveInitialCompanionMenuBarDisplayMode()).toBe("focusTime");

    persistCompanionMenuBarDisplayMode("donutFocusTime");
    expect(resolveInitialCompanionMenuBarDisplayMode()).toBe("donutFocusTime");
  });

  it("preserves the choice from the earlier Dev setting", () => {
    window.localStorage.setItem(LEGACY_COMPANION_PILL_STORAGE_KEY, "false");
    expect(resolveInitialCompanionPillEnabled()).toBe(false);
  });

  it("uses the stored production preference unless Dev Floating or temporary hide overrides it", () => {
    expect(resolveEffectiveCompanionSurfacePolicy("menuBar", false, false)).toBe("menuBar");
    expect(resolveEffectiveCompanionSurfacePolicy("menuBar", true, false)).toBe("floating");
    expect(resolveEffectiveCompanionSurfacePolicy("menuBar", true, true)).toBe("off");
    expect(resolveEffectiveCompanionSurfacePolicy("off", true, false)).toBe("floating");
    expect(resolveEffectiveCompanionSurfacePolicy("off", false, false)).toBe("off");
  });

  it("migrates a stored Floating choice to the production menu bar", () => {
    window.localStorage.setItem(COMPANION_SURFACE_POLICY_STORAGE_KEY, "floating");
    persistCompanionMenuBarDisplayMode("donutFocusTime");

    expect(resolveInitialCompanionSurfacePolicy()).toBe("menuBar");
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
