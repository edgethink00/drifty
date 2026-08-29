// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_LEGACY_COAT_STORAGE_KEY,
  PET_MODE_LEGACY_STORAGE_KEY,
  PET_MODE_ENTRY_DURATION_MS,
  PET_MODE_ENTRY_ACCELERATION_RATIO,
  PET_MODE_ENTRY_DECELERATION_RATIO,
  PET_MODE_ENTRY_HIDDEN_SAFETY_PX,
  PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX,
  PET_MODE_GAIT_BASELINE_SHIFT_PX,
  PET_MODE_GAIT_CENTER_SHIFT_PX,
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
const petModeCatContract = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");
const petModeCssContract = readFileSync("src/features/pet-mode/petMode.css", "utf8");
const petModeRustContract = readFileSync("../../src-tauri/src/commands/pet_mode.rs", "utf8");

describe("pet entry motion contract", () => {
  it("keeps native travel and renderer motion constants aligned", () => {
    const rustDuration = petModeRustContract.match(
      /const PET_MODE_ENTRY_DURATION_MS: u64 = (\d+);/,
    );
    expect(rustDuration?.[1]).toBe(String(PET_MODE_ENTRY_DURATION_MS));
    expect(petModeRustContract).toContain('"travelDistance": entry_travel');
    expect(petModeRustContract).toContain('"durationMs": entry_duration_ms');
    expect(petModeRustContract).toContain('clamp_pet_entry_destination');
    expect(petModeCatContract).toContain('travelDistance: entryTravelDistance');
    const rustAccelerationRatio = petModeRustContract.match(
      /const PET_MODE_ENTRY_ACCELERATION_RATIO: f64 = ([\d.]+);/,
    );
    const rustDecelerationRatio = petModeRustContract.match(
      /const PET_MODE_ENTRY_DECELERATION_RATIO: f64 = ([\d.]+);/,
    );
    expect(Number(rustAccelerationRatio?.[1])).toBe(PET_MODE_ENTRY_ACCELERATION_RATIO);
    expect(Number(rustDecelerationRatio?.[1])).toBe(PET_MODE_ENTRY_DECELERATION_RATIO);
    const rustTransparentGutter = petModeRustContract.match(
      /const PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX: f64 = ([\d.]+);/,
    );
    const rustHiddenSafety = petModeRustContract.match(
      /const PET_MODE_ENTRY_HIDDEN_SAFETY_PX: f64 = ([\d.]+);/,
    );
    expect(Number(rustTransparentGutter?.[1])).toBe(PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX);
    expect(Number(rustHiddenSafety?.[1])).toBe(PET_MODE_ENTRY_HIDDEN_SAFETY_PX);
    expect(petModeCssContract).toContain(
      `var(--pet-entry-duration, ${PET_MODE_ENTRY_DURATION_MS}ms)`,
    );
    expect(petModeCssContract).toContain(
      `var(--pet-gait-baseline-shift, ${PET_MODE_GAIT_BASELINE_SHIFT_PX}px)`,
    );
    expect(petModeCssContract).toContain(
      `var(--pet-gait-center-shift, ${PET_MODE_GAIT_CENTER_SHIFT_PX}px)`,
    );
    expect(petModeCssContract).toContain(
      ".pet-mode-cat.is-mirrored { transform: scaleX(-1); }",
    );
    for (const phase of ["entry", "walk", "run"]) {
      expect(petModeCssContract).toContain(
        `.pet-mode-cat--${phase} .pet-mode-cat__vector`,
      );
    }
    expect(petModeCssContract).toContain(".pet-mode-cat__landed-vector");
    expect(petModeCssContract).toContain("@keyframes pet-mode-entry-shadow");
    expect(petModeCatContract).toContain('fetch("/pet-mode/walk-frames-v2.json")');
    expect(petModeCatContract).toContain('className="pet-mode-cat__vector pet-mode-cat__landed-vector"');
    expect(petModeCssContract).toContain(
      ".pet-mode-cat.is-entry-landed .pet-mode-cat__motion",
    );
  });
});

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
    // The only thing allowed to suppress an enabled pet is its own temporary
    // hide, which expires on a timer. Any Dev-mode term here would be the
    // regression this test exists to catch.
    expect(app).toContain("const petModeActive = petModeEnabled && petModeHiddenUntil === null;");
  });

  /* A temporarily hidden pet must stay off screen for every reason the pet can
     appear, not just the resident panel. An intervention that keyed off the raw
     preference would drag the cat back mid-screen-share, which is exactly the
     situation the one-hour hide exists to protect. */
  it("routes interventions through the same suppressed state as the panel", () => {
    expect(app).toContain("if (petModeActive) {");
    const interventionBlock = app.slice(app.indexOf("const runExtremeNudge = async () => {"));
    expect(interventionBlock.slice(0, 200)).not.toContain("petModeEnabled");
  });

  it("keeps the native visibility action authoritative over both hide choices", () => {
    // Rust hides the panel immediately; the main window owns persistence. If the
    // command stopped validating, an unknown action would silently hide the pet
    // with nothing recording why.
    expect(petModeRustContract).toContain("fn validate_pet_visibility_action");
    expect(petModeRustContract).toContain('"hideOneHour" | "turnOff" => Ok(())');
    expect(petModeRustContract).toContain('main.emit("pet-visibility-action"');
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

describe("pet symbol orientation", () => {
  it("keeps readable overlays upright when the cat faces left", () => {
    expect(petModeCssContract).toContain(
      ".pet-mode-cat.is-mirrored .pet-mode-cat__zzz { transform: scaleX(-1); }",
    );
    expect(petModeCssContract).toContain(
      ".pet-mode-cat.is-mirrored .pet-mode-cat__music-note { --pet-symbol-direction: -1; }",
    );
    expect(petModeCatContract).toContain('className="pet-mode-cat__music-note-glyph"');
    expect(petModeCssContract).toContain(
      ".pet-mode-cat__music-note-glyph {",
    );
    expect(petModeCssContract).toContain("transform: scaleX(var(--pet-symbol-direction));");
    expect(petModeCssContract).not.toContain(
      "scale(1.05) scaleX(var(--pet-symbol-direction))",
    );
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

describe("catching the cat cancels the close", () => {
  const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");
  const petWindow = readFileSync("src/features/pet-mode/PetModeWindowApp.tsx", "utf8");
  const cat = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");

  it("never closes a tab or app when the paw did not reach its contact frame", () => {
    // The paw contact frame is the stated cause of the close. Closing without
    // it turns the whole approach animation into a lie and destroys a tab the
    // user just reached out to protect.
    const runner = app.slice(app.indexOf("const runExtremeNudge = async () => {"));
    const body = runner.slice(0, runner.indexOf("applyNativeExtremeNudge"));
    expect(body).toContain("const contacted = await playNativePetModeIntervention");
    expect(body).toContain("if (!contacted)");
    expect(body).toContain("pet_intercepted");
  });

  it("hands an intercepted nudge to the companion without an OS notification", () => {
    // The user is already looking at the screen with a hand on the pointer, so
    // a system banner on top of the companion is pure noise.
    expect(app).toContain('const intercepted = result.diagnostic === "pet_intercepted"');
    expect(app).toContain("showFallbackDriftAlarm(intercepted ? false : notifyOnFallback, intercepted)");
    const interceptedBranch = app.slice(app.indexOf("if (intercepted) {"));
    expect(interceptedBranch.slice(0, interceptedBranch.indexOf("showFallbackDriftAlarm")))
      .toContain("lastDriftAlertSegmentRef.current = null");
  });

  it("keys the one-round reprieve to the current delivery segment", () => {
    // The drift episode alert key is stable across fast tab transitions, while
    // the delivery source identifies the current target the cat approached.
    expect(app).toContain("petInterceptedSegmentRef.current = deliverySourceSegmentId ?? segment.id");
    expect(app).toContain("if (petInterceptedSegmentRef.current === (deliverySourceSegmentId ?? segment.id))");
    expect(app).toContain("pet_intercept_reprieve");
  });

  it("spends the reprieve so a continued drift is nudged again", () => {
    const gate = app.slice(app.indexOf("if (petInterceptedSegmentRef.current === (deliverySourceSegmentId"));
    const spentReprieve = gate.slice(0, gate.indexOf("recordDriftAlarmDebugEvent"));
    expect(spentReprieve).toContain("petInterceptedSegmentRef.current = null");
    expect(spentReprieve).toContain("lastDriftAlertSegmentRef.current = null");
  });

  it("reports a missed contact immediately instead of waiting out the timeout", () => {
    // Without this the caller burns the full contact timeout before it can
    // react, leaving a caught cat in the user's hand and a silent screen.
    const finallyBlock = petWindow.slice(petWindow.indexOf("} finally {"));
    expect(finallyBlock.slice(0, finallyBlock.indexOf("if (movedToTarget)"))).toContain("reportNativePetContact(target.id, false)");
  });

  it("warns before the close while the approach can still be interrupted", () => {
    expect(cat).toContain('className="pet-mode-cat__alert"');
    expect(css).toContain(".pet-mode-cat--run .pet-mode-cat__alert");
    expect(css).toContain(".pet-mode-cat--paw .pet-mode-cat__alert");
    expect(css).toContain(".pet-mode-cat--stalk.has-hunt-alert .pet-mode-cat__alert");
    expect(css).toContain("@keyframes pet-mode-hunt-alert");
  });

  it("treats a chosen break as permission to drift, so the cat stays away for its whole duration", () => {
    // Product decision: picking a break duration authorises that drift. The
    // snooze gate has to keep sitting in front of the nudge call, otherwise the
    // cat would run at a tab the user just bought time for.
    const snoozeGate = app.indexOf("const activeSnooze = driftAlarmSnooze ?? driftAlarmSnoozeRef.current;");
    const nudgeCall = app.indexOf("applyCurrentExtremeNudge(");
    expect(snoozeGate).toBeGreaterThan(-1);
    expect(nudgeCall).toBeGreaterThan(snoozeGate);

    const gateBlock = app.slice(snoozeGate, app.indexOf("if (!latestDrift)", snoozeGate));
    expect(gateBlock).toContain('reason: "snoozed"');
    expect(gateBlock).toContain("return;");
  });

  it("lets the cat intervene again when the break ends and the drift is still going", () => {
    // Expiry clears the snooze and the delivered-alert key, so the next poll
    // treats a continuing drift as a fresh candidate rather than a duplicate.
    const expiry = app.slice(app.indexOf("pendingBreakReturnAlarmRef.current = driftAlarmSnooze;"));
    const block = expiry.slice(0, expiry.indexOf("}, delayMs);"));
    expect(block).toContain("driftAlarmSnoozeRef.current = null");
    expect(block).toContain("lastDriftAlertSegmentRef.current = null");
  });

  it("lets Dev show the caught-cat card on demand for visual review", () => {
    // Visual work has to be reviewable by the person approving it. Gating the
    // card behind winning a live grab, or behind a throwaway capture harness,
    // leaves nothing they can actually open and judge.
    const devSettings = readFileSync("src/features/settings/DevSettingsSection.tsx", "utf8");
    expect(devSettings).toContain("onRehearsePetModeIntercept");
    expect(devSettings).toContain("Intercept card");

    const handler = app.slice(app.indexOf("onRehearsePetModeIntercept={() => {"));
    const body = handler.slice(0, handler.indexOf("onPreviewPetModeBrowserTabClose"));
    // Same native surface the real interception hands off to.
    expect(body).toContain("previewPetInterceptCard()");
    // Never destructive, and never dependent on catching the cat first.
    expect(body).not.toContain("applyNativePetModeLabTarget");
    expect(body).not.toContain("applyNativeExtremeNudge");
    expect(body).not.toContain("playNativePetModeIntervention");
  });

  it("does not greet a caught cat with the ordinary drift headline", () => {
    // The user just reached out and grabbed the cat. Reusing "Let's get you back
    // in flow." there reads as if the app never noticed the gesture.
    const copy = readFileSync("src/features/companion/driftAlarmCopy.ts", "utf8");
    expect(copy).toContain('petInterceptTitle: "Still drifting?"');
    expect(copy).toContain('case "pet_intercept"');

    // The distinction is copy-only: the event still ships as a drift alarm so
    // surface sizing, actions, and stored interactions stay unchanged.
    const event = readFileSync("src/features/companion/driftAlarmEvent.ts", "utf8");
    expect(event).toContain('mode: input.petIntercepted ? "pet_intercept" : "drift"');
    expect(event).toContain('mode: "drift"');
  });
});
