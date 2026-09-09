// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_AWAY_MS,
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_RETURN_SPEED,
  PET_MODE_RUN_CYCLE_DURATION_MS,
  PET_MODE_RUN_BETA_STORAGE_KEY,
  PET_MODE_RUN_FRAME_COUNT,
  PET_MODE_BLINK_INTERVAL_MAX_MS,
  PET_MODE_BLINK_INTERVAL_MIN_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_PICKUP_TIMELINE,
  PET_MODE_DRAG_RELEASE_TIMELINE,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_ENTRY_DURATION_MS,
  PET_MODE_ENTRY_FALLBACK_GRACE_MS,
  PET_MODE_ENTRY_HIDDEN_SAFETY_PX,
  PET_MODE_ENTRY_MAX_DURATION_MS,
  PET_MODE_ENTRY_MIN_DURATION_MS,
  PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX,
  PET_MODE_GAIT_BASELINE_SHIFT_PX,
  PET_MODE_GAIT_CENTER_SHIFT_PX,
  PET_MODE_HIDDEN_UNTIL_STORAGE_KEY,
  PET_MODE_HIDE_ONE_HOUR_MS,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_LIFE_MOTION_FPS,
  PET_MODE_LIFE_MOTION_FRAME_COUNT,
  PET_MODE_LIFE_ACTION_INTERVAL_MS,
  PET_MODE_MUSIC_NOTE_CHANCE,
  PET_MODE_PRESENCE_RATIO,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_PAW_TIMELINE,
  PET_MODE_PRESENT_MS,
  PET_MODE_SETTLED_ACTION_INTERVAL_MS,
  PET_MODE_SEAT_CLEAR_CONFIRM_MS,
  PET_MODE_STORAGE_KEY,
  PET_MODE_STALK_SPEED,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  getPetModeDefaultEntryTravelDistance,
  getPetModeEntryDurationMs,
  getPetModeGaitFramesPerSecond,
  getPetModeGaitFrameIndex,
  getPetModeRunFrameIndex,
  getPetModeGaitStride,
  getPetModeEntryProgress,
  getPetModeLifeActionInterval,
  getPetModeNextActionInterval,
  pickPetModePostDropReaction,
  buildPetModeInterventionTarget,
  buildPetModeLabBrowserTabTarget,
  buildPetModeLabDriftyWindowTarget,
  buildPetModePreviewInterventionTarget,
  buildPetModeSnapshot,
  resolveInitialPetModeEnabled,
  resolveInitialPetModeRunBetaEnabled,
  persistPetModeHiddenUntil,
  persistPetModeFloorHomePt,
  PET_MODE_FLOOR_HOME_PT,
  PET_MODE_FLOOR_HOME_STORAGE_KEY,
  clampPetModeFloorHomePt,
  resolveInitialPetModeFloorHomePt,
  resolveInitialPetModeHiddenUntil,
  resolvePetModePresent,
  shouldShowPetModeMusicNote,
} from "./petModeData";

describe("petModeData", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps Pet Mode opt-in and local", () => {
    expect(resolveInitialPetModeEnabled()).toBe(false);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    expect(resolveInitialPetModeEnabled()).toBe(true);
  });

  it("keeps the authored fast run off until its beta is explicitly enabled", () => {
    expect(resolveInitialPetModeRunBetaEnabled()).toBe(false);
    window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, "1");
    expect(resolveInitialPetModeRunBetaEnabled()).toBe(true);
    window.localStorage.setItem(PET_MODE_RUN_BETA_STORAGE_KEY, "0");
    expect(resolveInitialPetModeRunBetaEnabled()).toBe(false);
  });

  it("implements the agreed 60 percent resident loop", () => {
    expect(PET_MODE_PRESENCE_RATIO).toBe(0.6);
    expect(PET_MODE_PRESENT_MS / (PET_MODE_PRESENT_MS + PET_MODE_AWAY_MS)).toBe(0.6);
  });

  it("keeps the calmer reviewed blink timing", () => {
    expect(PET_MODE_BLINK_DURATION_MS).toBe(228);
    expect(PET_MODE_BLINK_INTERVAL_MIN_MS).toBe(4_420);
    expect(PET_MODE_BLINK_INTERVAL_MAX_MS).toBe(7_280);
  });

  it("confirms a clear AX anchor quickly without trusting a single scan", () => {
    expect(PET_MODE_SEAT_CLEAR_CONFIRM_MS).toBe(650);
  });

  it("ships the five percent music note roll for relaxed life motions", () => {
    expect(PET_MODE_MUSIC_NOTE_CHANCE).toBe(0.05);
    expect(shouldShowPetModeMusicNote("stretch", 0)).toBe(true);
    expect(shouldShowPetModeMusicNote("tail_flick", 0.049999)).toBe(true);
    expect(shouldShowPetModeMusicNote("stretch", 0.05)).toBe(false);
    expect(shouldShowPetModeMusicNote("pet", 0)).toBe(false);
    expect(shouldShowPetModeMusicNote("blink", 0)).toBe(false);
    expect(shouldShowPetModeMusicNote("music_note", 0)).toBe(false);
  });

  it("keeps the approved nine-frame pickup and a composite-opaque release", () => {
    expect(PET_MODE_DRAG_PICKUP_TIMELINE).toHaveLength(9);
    expect(PET_MODE_DRAG_RELEASE_TIMELINE).toHaveLength(9);
    expect(PET_MODE_DRAG_PICKUP_MS).toBe(148);
    expect(PET_MODE_DRAG_SETTLE_MS).toBe(156);
    expect(PET_MODE_DRAG_PICKUP_TIMELINE.map((frame) => frame.y)).toEqual([0, -1, -2, -3, -4, -4, -4, -4, -4]);
    expect(PET_MODE_DRAG_RELEASE_TIMELINE.map((frame) => frame.y)).toEqual([-4, -3, -2, -1, 0, 0, 0, 0, 0]);
    expect(PET_MODE_DRAG_RELEASE_TIMELINE.map((frame) => frame.pose)).toEqual([
      "held", "held", "held", "held", "held", "idle", "idle", "idle", "idle",
    ]);
    // The release renders as two stacked layers over a transparent native
    // window. Any frame whose committed opacity drops below 1 reintroduces
    // the drop-flicker where the desktop shows through the cat.
    for (const frame of PET_MODE_DRAG_RELEASE_TIMELINE) {
      expect(frame.opacity, `release frame at y=${frame.y}`).toBe(1);
    }
    expect(PET_MODE_DRAG_RELEASE_TIMELINE[PET_MODE_DRAG_RELEASE_TIMELINE.length - 1]).toMatchObject({
      pose: "idle",
      y: 0,
      opacity: 1,
    });
  });

  it("keeps all selected Flow life motions on one reviewed frame clock", () => {
    expect(PET_MODE_LIFE_MOTION_FPS).toBe(12);
    expect(PET_MODE_LIFE_MOTION_FRAME_COUNT).toBe(37);
    expect(PET_MODE_LIFE_MOTION_DURATION_MS).toBeCloseTo(3_083.333, 2);
    expect(PET_MODE_TAIL_FLICK_DURATION_MS).toBe(PET_MODE_LIFE_MOTION_DURATION_MS);
  });

  it("loops the reviewed run cycle on its own authored frame clock", () => {
    expect(PET_MODE_RUN_FRAME_COUNT).toBe(17);
    expect(PET_MODE_RUN_CYCLE_DURATION_MS).toBe(616);
    expect(getPetModeRunFrameIndex(0)).toBe(0);
    expect(getPetModeRunFrameIndex(PET_MODE_RUN_CYCLE_DURATION_MS / 2)).toBe(8);
    expect(getPetModeRunFrameIndex(PET_MODE_RUN_CYCLE_DURATION_MS - 1)).toBe(16);
    expect(getPetModeRunFrameIndex(PET_MODE_RUN_CYCLE_DURATION_MS)).toBe(0);
    expect(getPetModeRunFrameIndex(PET_MODE_RUN_CYCLE_DURATION_MS * 5 + 1)).toBe(0);
    expect(getPetModeRunFrameIndex(Number.NaN)).toBe(0);
    expect(getPetModeRunFrameIndex(100, 0)).toBe(0);
  });

  it("keeps the authored entry a short distance-based run", () => {
    expect(PET_MODE_ENTRY_DURATION_MS).toBe(482);
    expect(PET_MODE_ENTRY_MIN_DURATION_MS).toBe(180);
    expect(PET_MODE_ENTRY_MAX_DURATION_MS).toBe(700);
    expect(PET_MODE_ENTRY_FALLBACK_GRACE_MS).toBe(500);
    expect(PET_MODE_ENTRY_TRANSPARENT_GUTTER_PX).toBe(24.329);
    expect(PET_MODE_ENTRY_HIDDEN_SAFETY_PX).toBe(1);
    expect(PET_MODE_GAIT_BASELINE_SHIFT_PX).toBe(3.76);
    expect(PET_MODE_GAIT_CENTER_SHIFT_PX).toBe(-6.383);
    expect(getPetModeDefaultEntryTravelDistance()).toBeCloseTo(144.671, 6);
    expect(getPetModeEntryDurationMs(144.671)).toBe(482);
    expect(getPetModeEntryDurationMs(54)).toBe(180);
    expect(getPetModeEntryDurationMs(900)).toBe(700);
    expect(getPetModeGaitFramesPerSecond("entry")).toBeCloseTo(112.5, 6);
    expect(getPetModeGaitStride("run")).toBeCloseTo(80, 6);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.05)).toBeCloseTo(0.0145348837, 9);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.1)).toBeCloseTo(0.0581395349, 9);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.25)).toBeCloseTo(0.2325581395, 9);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.5)).toBeCloseTo(0.523255814, 9);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.75)).toBeCloseTo(0.8139534884, 9);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.82)).toBeCloseTo(0.8953488372, 9);
    expect(getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * 0.91)).toBeCloseTo(0.9738372093, 9);
    const sampledProgress = Array.from(
      { length: 101 },
      (_, index) => getPetModeEntryProgress(PET_MODE_ENTRY_DURATION_MS * index / 100),
    );
    expect(sampledProgress.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(sampledProgress.every((value, index) => index === 0 || value >= sampledProgress[index - 1])).toBe(true);
    expect(getPetModeGaitFrameIndex("entry", 0)).toBe(6);
    expect(getPetModeGaitFrameIndex("entry", PET_MODE_ENTRY_DURATION_MS * 0.1)).toBe(9);
    expect(getPetModeGaitFrameIndex("entry", PET_MODE_ENTRY_DURATION_MS * 0.25)).toBe(18);
    expect(getPetModeGaitFrameIndex("entry", PET_MODE_ENTRY_DURATION_MS * 0.5)).toBe(4);
    expect(getPetModeGaitFrameIndex("entry", PET_MODE_ENTRY_DURATION_MS - 16)).toBe(0);
    expect(getPetModeGaitFrameIndex("entry", PET_MODE_ENTRY_DURATION_MS)).toBe(0);
    expect(getPetModeGaitFrameIndex("entry", PET_MODE_ENTRY_DURATION_MS + 500)).toBe(0);
    expect(getPetModeGaitFrameIndex("entry", 0, 0)).toBe(0);
    expect(getPetModeGaitFramesPerSecond("walk")).toBeCloseTo(21.6, 6);
    expect(getPetModeGaitFramesPerSecond("run")).toBeCloseTo(112.5, 6);
    expect(getPetModeGaitFramesPerSecond("stalk")).toBeCloseTo(95.8064516, 6);
    expect(getPetModeGaitFramesPerSecond("return")).toBeCloseTo(58.6956522, 6);
    expect(PET_MODE_STALK_SPEED).toBe(220);
    expect(PET_MODE_RETURN_SPEED).toBeCloseTo(104.3478261, 6);
    expect(getPetModeGaitFrameIndex("walk", 1_400)).toBe(0);
    const travel = getPetModeDefaultEntryTravelDistance();
    const stride = getPetModeGaitStride("run");
    const cycles = travel / stride;
    expect(cycles).toBeGreaterThan(1.5);
    expect(cycles).toBeLessThan(2);
  });

  it("lands on four planted paws across home distances and supported pet sizes", () => {
    for (const sizeScale of [0.5, 0.75, 1, 1.25]) {
      for (const travelDistance of [1, 54, 90, 144.671, 175, 210, 900]) {
        const durationMs = getPetModeEntryDurationMs(travelDistance);
        const options = { travelDistance, sizeScale, durationMs };
        expect(getPetModeGaitFrameIndex("entry", durationMs, 30, options)).toBe(0);
        expect(getPetModeGaitFrameIndex("entry", durationMs + 500, 30, options)).toBe(0);
      }
    }
  });

  it("keeps the approved F12 v1.6 paw timeline frame-for-frame", () => {
    expect(PET_MODE_PAW_CONTACT_FRAME).toBe(14);
    expect(PET_MODE_PAW_TIMELINE).toHaveLength(29);
    expect(PET_MODE_PAW_TIMELINE.slice(0, 15).map((step) => step.frame)).toEqual(
      Array.from({ length: 15 }, (_, frame) => frame),
    );
    expect(PET_MODE_PAW_TIMELINE.slice(15).map((step) => step.frame)).toEqual(
      Array.from({ length: 14 }, (_, offset) => 13 - offset),
    );
    expect(PET_MODE_PAW_TIMELINE.slice(15).every((step) => step.durationUnits === 0.75)).toBe(true);
  });

  it("only quiets autonomous life actions during focused work", () => {
    expect(PET_MODE_LIFE_ACTION_INTERVAL_MS).toBe(4 * 60 * 1000);
    expect(getPetModeLifeActionInterval("neutral")).toBe(4 * 60 * 1000);
    expect(getPetModeLifeActionInterval("focus")).toBe(6.6 * 60 * 1000);
    expect(getPetModeNextActionInterval("neutral", null)).toBe(4 * 60 * 1000);
    expect(getPetModeNextActionInterval("focus", "walk")).toBe(6.6 * 60 * 1000);
    expect(getPetModeNextActionInterval("neutral", "sit")).toBe(PET_MODE_SETTLED_ACTION_INTERVAL_MS);
    expect(getPetModeNextActionInterval("focus", "sleep")).toBe(PET_MODE_SETTLED_ACTION_INTERVAL_MS * 1.65);
  });

  it("keeps manual landing certain and varies only the 60/30/10 reaction", () => {
    expect(pickPetModePostDropReaction(0, null)).toBe("stay");
    expect(pickPetModePostDropReaction(0.599_999, null)).toBe("stay");
    expect(pickPetModePostDropReaction(0.6, null)).toBe("walk");
    expect(pickPetModePostDropReaction(0.899_999, null)).toBe("walk");
    expect(pickPetModePostDropReaction(0.9, null)).toBe("look_tail");
    expect(pickPetModePostDropReaction(1, null)).toBe("look_tail");
  });

  it("does not repeat a large manual-drop reaction back to back", () => {
    expect(pickPetModePostDropReaction(0.72, "walk")).toBe("stay");
    expect(pickPetModePostDropReaction(0.96, "look_tail")).toBe("stay");
    expect(pickPetModePostDropReaction(0.72, "stay")).toBe("walk");
    expect(pickPetModePostDropReaction(0.96, "stay")).toBe("look_tail");
  });

  it("minimizes the tracker snapshot sent to the pet surface", () => {
    const snapshot = buildPetModeSnapshot({
      productivity: "drift",
      category: "entertainment",
      contextLabel: "youtube.com",
      durationLabel: "8m",
      durationSeconds: 480,
      focusSessionKind: "settled",
      driftPattern: "first",
      driftReminderElapsedSeconds: null,
      recentWatcherResponse: null,
      minutesSinceLastWatcher: null,
      focusSecondsToday: 3600,
      currentHourFocusSeconds: 1200,
      preservedFocusStrikeSeconds: null,
    });

    expect(snapshot).toEqual({
      productivity: "drift",
      contextLabel: "youtube.com",
      durationSeconds: 480,
      surfaceRevision: 0,
    });
    expect(snapshot).not.toHaveProperty("siteUrl");
    expect(snapshot).not.toHaveProperty("windowTitle");
  });

  it("normalizes intervention identity without adding raw activity fields", () => {
    expect(buildPetModeInterventionTarget({
      id: "candidate-1",
      appName: "  Google Chrome  ",
      browserName: "  Google Chrome ",
    })).toEqual({
      id: "candidate-1",
      appName: "Google Chrome",
      browserName: "Google Chrome",
      preview: false,
      labTarget: null,
    });
  });

  it("uses a local observed browser and a separate Drifty target for real X-button Lab tests", () => {
    const browser = buildPetModeLabBrowserTabTarget([
      {
        id: "chrome-live",
        endedAt: "2026-08-03T10:09:00.000Z",
        appName: "Google Chrome",
        browserName: "Google Chrome",
        deviceId: null,
        source: "nsworkspace",
      },
    ]);

    expect(browser).toMatchObject({
      appName: "Google Chrome",
      browserName: "Google Chrome",
      preview: false,
      labTarget: "browser_tab_x",
    });
    expect(buildPetModeLabDriftyWindowTarget()).toMatchObject({
      appName: "Drifty",
      browserName: null,
      labTarget: "drifty_window_x",
    });
  });

  it("previews against the latest local live browser instead of a fake corner", () => {
    const target = buildPetModePreviewInterventionTarget([
      {
        id: "remote-newer",
        endedAt: "2026-08-03T10:10:00.000Z",
        appName: "Google Chrome",
        browserName: "Google Chrome",
        deviceId: "another-mac",
        source: "nsworkspace",
      },
      {
        id: "aside-live",
        endedAt: "2026-08-03T10:09:00.000Z",
        appName: "Aside",
        browserName: "Aside",
        deviceId: null,
        source: "nsworkspace",
      },
      {
        id: "chrome-older",
        endedAt: "2026-08-03T10:08:00.000Z",
        appName: "Google Chrome",
        browserName: "Google Chrome",
        deviceId: null,
        source: "nsworkspace",
      },
    ]);

    expect(target).toMatchObject({
      appName: "Aside",
      browserName: "Aside",
      preview: true,
    });
  });
});

describe("pet temporary hide", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps a future hide and drops one that has already expired", () => {
    const now = Date.now();

    persistPetModeHiddenUntil(now + PET_MODE_HIDE_ONE_HOUR_MS);
    expect(resolveInitialPetModeHiddenUntil(now)).toBe(now + PET_MODE_HIDE_ONE_HOUR_MS);

    // An expired hide must not survive a restart, otherwise a pet hidden for an
    // hour before quitting would come back still hidden and read as broken.
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(now - 1));
    expect(resolveInitialPetModeHiddenUntil(now)).toBeNull();
    expect(window.localStorage.getItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY)).toBeNull();
  });

  it("treats unreadable values as not hidden", () => {
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, "not-a-timestamp");
    expect(resolveInitialPetModeHiddenUntil(Date.now())).toBeNull();
  });

  /* The only escape hatch from a hide is the deadline itself: the account-menu
     toggle already reads on, so a deadline years away would retire the pet with
     nothing left for the user to switch. A hide can never exceed its one hour. */
  it("refuses a deadline further out than one hour", () => {
    const now = Date.now();
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(now + PET_MODE_HIDE_ONE_HOUR_MS * 24));
    expect(resolveInitialPetModeHiddenUntil(now)).toBeNull();
    expect(window.localStorage.getItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(Number.MAX_SAFE_INTEGER));
    expect(resolveInitialPetModeHiddenUntil(now)).toBeNull();
  });

  it("still honours a deadline exactly at the one-hour boundary", () => {
    const now = Date.now();
    window.localStorage.setItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY, String(now + PET_MODE_HIDE_ONE_HOUR_MS));
    expect(resolveInitialPetModeHiddenUntil(now)).toBe(now + PET_MODE_HIDE_ONE_HOUR_MS);
  });

  it("clears the stored hide when the pet is shown again", () => {
    persistPetModeHiddenUntil(Date.now() + PET_MODE_HIDE_ONE_HOUR_MS);
    expect(persistPetModeHiddenUntil(null)).toBeNull();
    expect(window.localStorage.getItem(PET_MODE_HIDDEN_UNTIL_STORAGE_KEY)).toBeNull();
  });

  /* Presence is the only thing either webview may act on. Reading the raw
     enabled flag during a hidden hour is how a restart replays the entry walk
     for a cat the user just put away. */
  it("reports the pet absent while a hide is live and present once it lapses", () => {
    const now = Date.now();
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    expect(resolvePetModePresent(now)).toBe(true);

    persistPetModeHiddenUntil(now + PET_MODE_HIDE_ONE_HOUR_MS);
    expect(resolvePetModePresent(now)).toBe(false);

    // The same stored state read after the hour is up must come back present
    // without anyone having to clear it explicitly.
    expect(resolvePetModePresent(now + PET_MODE_HIDE_ONE_HOUR_MS + 1)).toBe(true);
  });

  it("keeps a disabled pet absent regardless of the hide", () => {
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "0");
    expect(resolvePetModePresent()).toBe(false);
  });
});


describe("pet floor home calibration", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to 20pt and clamps Dev overrides into the catch band", () => {
    expect(PET_MODE_FLOOR_HOME_PT).toBe(20);
    expect(resolveInitialPetModeFloorHomePt()).toBe(20);
    expect(clampPetModeFloorHomePt(-3)).toBe(0);
    expect(clampPetModeFloorHomePt(90)).toBe(65);
    expect(clampPetModeFloorHomePt("12.4")).toBe(12);
    expect(persistPetModeFloorHomePt(12)).toBe(12);
    expect(window.localStorage.getItem(PET_MODE_FLOOR_HOME_STORAGE_KEY)).toBe("12");
    expect(resolveInitialPetModeFloorHomePt()).toBe(12);
  });
});
