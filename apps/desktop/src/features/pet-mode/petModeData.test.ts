// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  PET_MODE_AWAY_MS,
  PET_MODE_BLINK_DURATION_MS,
  PET_MODE_BLINK_INTERVAL_MAX_MS,
  PET_MODE_BLINK_INTERVAL_MIN_MS,
  PET_MODE_DRAG_PICKUP_MS,
  PET_MODE_DRAG_PICKUP_TIMELINE,
  PET_MODE_DRAG_RELEASE_TIMELINE,
  PET_MODE_DRAG_SETTLE_MS,
  PET_MODE_ENTRY_DURATION_MS,
  PET_MODE_LIFE_MOTION_DURATION_MS,
  PET_MODE_LIFE_MOTION_FPS,
  PET_MODE_LIFE_MOTION_FRAME_COUNT,
  PET_MODE_PRESENCE_RATIO,
  PET_MODE_PAW_CONTACT_FRAME,
  PET_MODE_PAW_TIMELINE,
  PET_MODE_PRESENT_MS,
  PET_MODE_SETTLED_ACTION_INTERVAL_MS,
  PET_MODE_STORAGE_KEY,
  PET_MODE_TAIL_FLICK_DURATION_MS,
  getPetModeGaitFramesPerSecond,
  getPetModeLifeActionInterval,
  getPetModeNextActionInterval,
  buildPetModeInterventionTarget,
  buildPetModeLabBrowserTabTarget,
  buildPetModeLabDriftyWindowTarget,
  buildPetModePreviewInterventionTarget,
  buildPetModeSnapshot,
  resolveInitialPetModeEnabled,
} from "./petModeData";

describe("petModeData", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps Pet Mode opt-in and local", () => {
    expect(resolveInitialPetModeEnabled()).toBe(false);
    window.localStorage.setItem(PET_MODE_STORAGE_KEY, "1");
    expect(resolveInitialPetModeEnabled()).toBe(true);
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

  it("keeps the approved nine-frame pickup and monotonic release", () => {
    expect(PET_MODE_DRAG_PICKUP_TIMELINE).toHaveLength(9);
    expect(PET_MODE_DRAG_RELEASE_TIMELINE).toHaveLength(9);
    expect(PET_MODE_DRAG_PICKUP_MS).toBe(148);
    expect(PET_MODE_DRAG_SETTLE_MS).toBe(156);
    expect(PET_MODE_DRAG_PICKUP_TIMELINE.map((frame) => frame.y)).toEqual([0, -1, -2, -3, -4, -4, -4, -4, -4]);
    expect(PET_MODE_DRAG_RELEASE_TIMELINE.map((frame) => frame.y)).toEqual([-4, -3, -2, -1, 0, 0, 0, 0, 0]);
    expect(PET_MODE_DRAG_RELEASE_TIMELINE.map((frame) => frame.pose)).toEqual([
      "held", "held", "held", "held", "idle", "idle", "idle", "idle", "idle",
    ]);
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

  it("locks the gait to the approved HTML distance ratios", () => {
    expect(PET_MODE_ENTRY_DURATION_MS).toBe(420);
    expect(getPetModeGaitFramesPerSecond("entry")).toBeCloseTo(71.428571, 6);
    expect(getPetModeGaitFramesPerSecond("walk")).toBeCloseTo(21.6, 6);
    expect(getPetModeGaitFramesPerSecond("run")).toBeCloseTo(112.5, 6);
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
    expect(getPetModeLifeActionInterval("neutral")).toBe(12 * 60 * 1000);
    expect(getPetModeLifeActionInterval("focus")).toBe(19.8 * 60 * 1000);
    expect(getPetModeNextActionInterval("neutral", null)).toBe(12 * 60 * 1000);
    expect(getPetModeNextActionInterval("focus", "walk")).toBe(19.8 * 60 * 1000);
    expect(getPetModeNextActionInterval("neutral", "sit")).toBe(PET_MODE_SETTLED_ACTION_INTERVAL_MS);
    expect(getPetModeNextActionInterval("focus", "sleep")).toBe(PET_MODE_SETTLED_ACTION_INTERVAL_MS * 1.65);
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
