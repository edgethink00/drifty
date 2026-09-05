// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_COAT_STORAGE_KEY,
  PET_MODE_LEGACY_COAT_STORAGE_KEY,
  PET_MODE_LEGACY_STORAGE_KEY,
  PET_MODE_RUN_BETA_STORAGE_KEY,
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
  resolveInitialPetModeRunBetaEnabled,
  resolveInitialPetModeSize,
} from "./petModeData";

const app = readFileSync("src/App.tsx", "utf8");
const accountMenu = readFileSync("src/features/auth/AccountMenu.tsx", "utf8");
const devSettings = readFileSync("src/features/settings/DevSettingsSection.tsx", "utf8");
const notifications = readFileSync("src/features/settings/NotificationsSettingsSection.tsx", "utf8");
const petModeCatContract = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");
const petModeCssContract = readFileSync("src/features/pet-mode/petMode.css", "utf8");
const petModeDataContract = readFileSync("src/features/pet-mode/petModeData.ts", "utf8");
const petModeWindowContract = readFileSync("src/features/pet-mode/PetModeWindowApp.tsx", "utf8");
const petModeRustContract = readFileSync("../../src-tauri/src/commands/pet_mode.rs", "utf8");
const petPanelRustContract = readFileSync("../../src-tauri/src/commands/pet_panel.rs", "utf8");
const petQuickControlsCssContract = readFileSync("src/features/pet-mode/petModeQuickControls.css", "utf8");
const petQuickControlsRustContract = readFileSync("../../src-tauri/src/commands/pet_quick_controls.rs", "utf8");
const tokensContract = readFileSync("src/styles/tokens-base.css", "utf8");

describe("shared native pet panels", () => {
  it("orders the requested panel instead of always reopening the cat", () => {
    expect(petPanelRustContract).toContain("app.get_webview_panel(window.label())");
    expect(petPanelRustContract).not.toContain("app.get_webview_panel(PET_MODE_WINDOW_LABEL)");
  });
});

describe("pet quick-controls material", () => {
  it("applies one rounded native material only to the quick-controls panel", () => {
    expect(petQuickControlsRustContract).toContain("fn apply_pet_quick_controls_material");
    expect(petQuickControlsRustContract).toContain("NSVisualEffectMaterial::HudWindow");
    expect(petQuickControlsRustContract).toContain("Some(PET_QUICK_CONTROLS_MATERIAL_RADIUS)");
    expect(petQuickControlsRustContract).toContain("apply_pet_quick_controls_material(&window)");
    expect(petPanelRustContract).not.toContain("apply_vibrancy");
  });

  it("uses near-opaque dedicated tints with a browser-only CSS blur fallback", () => {
    expect(tokensContract).toContain("--pet-quick-controls-surface: rgba(250,250,248,.86);");
    expect(tokensContract).toContain("--pet-quick-controls-surface: rgba(23,23,21,.88);");
    expect(petQuickControlsCssContract).toContain("background: var(--pet-quick-controls-surface);");
    expect(petQuickControlsCssContract).toContain(':root[data-runtime="browser"] .pet-quick-controls');
    expect(petQuickControlsCssContract).toContain("backdrop-filter: blur(24px) saturate(1.16);");
    expect(petQuickControlsCssContract).toContain("prefers-reduced-transparency: reduce");
    expect(petQuickControlsCssContract).toContain("prefers-contrast: more");
  });

  it("keeps outward shadows out of the exact-size native panel", () => {
    const surfaceRule = petQuickControlsCssContract.match(
      /\.pet-quick-controls\s*\{([\s\S]*?)\n\}/,
    );
    expect(surfaceRule?.[1]).toContain(
      "box-shadow: inset 0 1px 0 color-mix(in srgb, white 46%, transparent);",
    );
    expect(surfaceRule?.[1]).not.toContain("0 10px 24px");
    expect(petQuickControlsRustContract).toContain(
      "const PET_QUICK_CONTROLS_HEIGHT: f64 = 36.0;",
    );
  });

  it("keeps quick-control buttons seated while preserving hover feedback", () => {
    const hoverRule = petQuickControlsCssContract.match(
      /\.pet-quick-controls__toggle:hover,[\s\S]*?\{([\s\S]*?)\}/,
    );
    expect(hoverRule?.[1]).toContain("background:");
    expect(hoverRule?.[1]).toContain("transform: none;");
  });

  it("keeps the native material appearance aligned with the app theme", () => {
    expect(petQuickControlsRustContract).toContain("fn sync_pet_quick_controls_theme");
    expect(petQuickControlsRustContract).toContain('state.theme == "dark"');
    expect(petQuickControlsRustContract).toContain("Theme::Dark");
    expect(petQuickControlsRustContract).toContain("Theme::Light");
  });
});

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
    for (const phase of ["entry", "walk"]) {
      expect(petModeCssContract).toContain(
        `.pet-mode-cat--${phase} .pet-mode-cat__vector`,
      );
    }
    expect(petModeCatContract).toContain('className="pet-mode-cat__raster pet-mode-cat__raster--run"');
    expect(petModeCatContract).toContain("getPetModeRunFrameSource(renderedRunFrame)");
    expect(petModeCatContract).toContain("fastRunBetaEnabled = false");
    expect(petModeCatContract).toContain("const runUsesVectorFallback = phase === \"run\"");
    expect(petModeWindowContract).toContain("resolveInitialPetModeRunBetaEnabled");
    expect(petModeCssContract).toContain(".pet-mode-cat__landed-vector");
    expect(petModeCssContract).toContain("@keyframes pet-mode-entry-shadow");
    expect(petModeCatContract).toContain('fetch("/pet-mode/walk-frames-v2.json")');
    expect(petModeCatContract).toContain('className="pet-mode-cat__vector pet-mode-cat__landed-vector"');
    expect(petModeCssContract).toContain(
      ".pet-mode-cat.is-entry-landed .pet-mode-cat__motion",
    );
  });
});

describe("pet expressive interactions promoted out of Dev", () => {
  it("retires the preview master switch without weakening Dev-only force controls", () => {
    expect(petModeDataContract).not.toContain("drifty.dev.petModeExperiments.v1");
    expect(petModeWindowContract).not.toContain("expressiveInteractionsEnabled");
    expect(devSettings).not.toContain("Toggle expressive pet interactions");
    expect(devSettings).toContain("Toggle guaranteed expressive outcomes");
    expect(petModeWindowContract).toContain('window.localStorage.getItem(DEV_MODE_STORAGE_KEY) !== "1"');
  });

  it("keeps all four approved beats on the production path", () => {
    expect(petModeWindowContract).toContain("const proudReturn = contacted && !target.preview;");
    expect(petModeWindowContract).toContain("shouldShowPetModeMusicNote(action, Math.random())");
    expect(petModeWindowContract).toContain("Math.random() < PET_MODE_SLEEP_WAKE_ANGER_CHANCE");
    expect(petModeWindowContract).toContain("petStreakRef.current >= PET_MODE_PET_STREAK_TO_SLEEP");
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

  it("keeps the authored fast run behind a persisted beta that defaults off", () => {
    expect(resolveInitialPetModeRunBetaEnabled()).toBe(false);
    window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, "1");
    expect(resolveInitialPetModeRunBetaEnabled()).toBe(true);
    expect(devSettings).toContain("petModeRunBetaEnabled");
    expect(notifications).not.toContain("petModeRunBetaEnabled");
    expect(petModeWindowContract).toContain("PET_MODE_RUN_BETA_STORAGE_KEY");
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

  it("sits or chases from the live frontmost app, not the dashboard day's last row", () => {
    // Observed 2026-08-30: the dashboard was on 2026-08-29 while YouTube was
    // live-drifting. The pet sat on that historical focus row and skipped the
    // chase, so Automatic close ran without the cat.
    expect(app).toContain("const petModeLiveSnapshot = useMemo(() => {");
    expect(app).toContain("buildLiveWatcherSnapshot(");
    expect(app).toContain("buildPetModeSnapshot(petModeLiveSnapshot)");
    expect(app).not.toContain("buildPetModeSnapshot(watcherSnapshot)");
    const evalBlock = app.slice(app.indexOf("const evaluateDriftAlarm = useCallback"));
    expect(evalBlock.slice(0, 1600)).toContain("if (petModeActive && alarmSnapshot)");
    expect(evalBlock.slice(0, 1600)).toContain("petModeLiveObservedAtMsRef.current");
    expect(evalBlock.slice(0, 1600)).toContain("updateNativePetMode(buildPetModeSnapshot(livePetSnapshot))");
    expect(evalBlock.slice(0, 1800)).toContain("petModeLiveSnapshotRef.current = livePetSnapshot");
    expect(evalBlock.slice(0, 1800)).toContain("shouldReplacePetModeLiveSnapshot");
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
    expect(app).toContain(
      "[petModeActive, petModeRevealRevision, petModeSize, petModeSyncRetryNonce]",
    );
  });
});

describe("catching the cat cancels the close", () => {
  const css = readFileSync("src/features/pet-mode/petMode.css", "utf8");
  const petWindow = readFileSync("src/features/pet-mode/PetModeWindowApp.tsx", "utf8");
  const cat = readFileSync("src/features/pet-mode/PetModeCat.tsx", "utf8");

  it("cancels the close only for a real user catch, never for a technical failure", () => {
    // The paw contact frame is the stated cause of the close, so a genuine
    // catch cancels it. But a renderer rejection, timeout, or hung webview is
    // not a user decision: those must fall through to the plain close instead
    // of being misread as mercy (observed 2026-08-29: an 8s contact timeout
    // was translated into pet_intercepted and the drift tab survived).
    const runner = app.slice(app.indexOf("const runExtremeNudge = async () => {"));
    const body = runner.slice(0, runner.indexOf("return applyNativeExtremeNudge"));
    expect(body).toContain("const intervention = await playNativePetModeIntervention");
    expect(body).toContain('if (intervention.outcome === "user_intercepted")');
    expect(body).toContain("pet_intercepted");
    // Technical failures are logged and fall through; a verified context
    // change returns early because the original target is no longer current.
    expect(body).toContain('if (intervention.outcome !== "contacted")');
    expect(body).toContain("extreme_nudge_pet_skipped");
    expect(body).toContain('if (intervention.outcome === "cancelled")');
    expect(body).toContain("pet_context_changed");
    expect(body).not.toContain("if (!contacted)");
  });

  it("hands an intercepted nudge to the companion without an OS notification", () => {
    // The user is already looking at the screen with a hand on the pointer, so
    // a system banner on top of the companion is pure noise.
    expect(app).toContain('const intercepted = result.diagnostic === "pet_intercepted"');
    expect(app).toContain("showFallbackDriftAlarm(intercepted ? false : notifyOnFallback, intercepted, breakReturnAlarm)");
    const interceptedBranch = app.slice(app.indexOf("if (intercepted) {"));
    expect(interceptedBranch.slice(0, interceptedBranch.indexOf("showFallbackDriftAlarm")))
      .toContain("lastDriftAlertSegmentRef.current = null");
  });

  it("keys a caught pet's grace to the continuous drift episode", () => {
    expect(app).toContain("petInterceptionGraceRef.current = buildPetInterceptionGrace(episodeKey)");
    expect(app).toContain("isPetInterceptionGraceActive(currentGrace, episodeKey)");
    expect(app).toContain("pet_intercept_grace");
  });

  it("suppresses delivery before AI gating without consuming an active grace", () => {
    const gate = app.slice(app.indexOf("if (isPetInterceptionGraceActive(currentGrace, episodeKey))"));
    const activeGrace = gate.slice(0, gate.indexOf("if (currentGrace !== null)"));
    expect(activeGrace).toContain("lastDriftAlertSegmentRef.current = null");
    expect(activeGrace).not.toContain("petInterceptionGraceRef.current = null");
    expect(activeGrace).toContain("return;");
    expect(app.indexOf("if (isPetInterceptionGraceActive(currentGrace, episodeKey))"))
      .toBeLessThan(app.indexOf("if (pendingDriftAlarmGateRef.current === alertKey)"));
  });

  it("reports every missed contact exactly once with its real cause", () => {
    // Without this the caller burns the full contact timeout before it can
    // react. Conflating cancellation causes here also grants a catch reprieve
    // for focus changes and technical failures, or leaves a duplicate event
    // that can resolve a later intervention from the same drift episode.
    const finallyBlock = petWindow.slice(petWindow.indexOf("} finally {"));
    const terminalReport = finallyBlock.slice(0, finallyBlock.indexOf("if (movedToTarget)"));
    expect(terminalReport).toContain("!terminalContactReported");
    expect(terminalReport).toContain("userInterceptedInterventionTokenRef.current === token");
    expect(terminalReport).toContain('"activity_context_changed"');
    expect(terminalReport).toContain('"renderer_intervention_failed"');
    expect(terminalReport).toContain('"renderer_action_cancelled"');
    expect(terminalReport).toContain("reportNativePetContact(target.id, false, reason)");
  });

  it("drops a context-changed target without closing it or spending a catch reprieve", () => {
    const branch = app.slice(app.indexOf("if (targetChanged) {"));
    const body = branch.slice(0, branch.indexOf("if (intercepted) {"));
    expect(body).toContain("lastDriftAlertSegmentRef.current = null");
    expect(body).toContain("petInterceptionGraceRef.current = null");
    expect(body).toContain("reason: result.diagnostic");
    expect(body).toContain("return;");
    expect(body).not.toContain("showFallbackDriftAlarm");
    expect(app).toContain('diagnostic: "pet_target_changed"');
    expect(app).toContain('diagnostic: "pet_target_unverified"');
    expect(app).toContain("await confirmFreshDriftAlarmCandidate()");
  });

  it("rejects a guarded intervention loudly instead of letting it time out", () => {
    // A busy/focused/drag-guarded renderer used to drop the event with no
    // reply; the main window could only see an 8-second timeout and misread
    // it as a catch. The guard must answer immediately with its reason.
    const guard = petWindow.slice(petWindow.indexOf("const rejectionReason ="));
    const guardBody = guard.slice(0, guard.indexOf("reportLabState();"));
    expect(guardBody).toContain("renderer_busy_intervention");
    expect(guardBody).toContain("renderer_manual_drag");
    expect(guardBody).toContain("reportNativePetContact(event.target.id, false, rejectionReason)");
  });

  it("never vetoes an automatic close just because the cat is sitting", () => {
    // The alarm only sends an automatic target after its AI gate and a fresh
    // current-activity re-check, and it runs the close anyway when the
    // renderer rejects. A stale seated pose could therefore only delete the
    // cat from a close that still happened (observed 2026-08-30:
    // "renderer_focus_resting elapsedMs=19", then the tab closed with no cat).
    const guard = petWindow.slice(petWindow.indexOf("const rejectionReason ="));
    const guardBody = guard.slice(0, guard.indexOf("reportLabState();"));
    expect(guardBody).not.toContain("focusRestingRef");

    // The approach itself must still be interruptible: a genuine focus change
    // mid-run keeps cancelling the close through activity_context_changed.
    expect(petWindow).toContain("contextChangedInterventionTokenRef.current = actionTokenRef.current");
    expect(petWindow).toContain('"activity_context_changed"');
  });

  it("warns before the close while the approach can still be interrupted", () => {
    expect(cat).toContain('className="pet-mode-cat__alert"');
    expect(css).toContain(".pet-mode-cat--run .pet-mode-cat__alert");
    expect(css).toContain(".pet-mode-cat--paw .pet-mode-cat__alert");
    expect(css).toContain(".pet-mode-cat--stalk.has-hunt-alert .pet-mode-cat__alert");
    expect(css).toContain(".pet-mode-cat.is-quiet-notice .pet-mode-cat__alert");
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
