// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";
import {
  DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
  EMPTY_PET_MODE_DRIFT_HUNT_STATE,
  PET_MODE_CURSOR_MOUTH_X_LEFT,
  PET_MODE_CURSOR_MOUTH_X_RIGHT,
  PET_MODE_CURSOR_MOUTH_Y,
  PET_MODE_DRIFT_NOTICE_SECONDS,
  PET_MODE_DRIFT_STALK_SECONDS,
  advancePetModeDriftHunt,
  persistPetModeDriftHuntSettings,
  resolvePetModeDriftHuntSettings,
  resolvePetModeDriftCursorReturnDuration,
} from "./petModeDriftHunt";

const snapshot = (productivity: "focus" | "neutral" | "drift", durationSeconds: number, contextLabel = "video") => ({
  productivity,
  durationSeconds,
  contextLabel,
} as const);

describe("petModeDriftHunt", () => {
  it("maps cursor movement into calm, alert, and evasive carry tiers", () => {
    expect(resolvePetModeDriftCursorReturnDuration(0)).toBe(8_000);
    expect(resolvePetModeDriftCursorReturnDuration(7)).toBe(8_000);
    expect(resolvePetModeDriftCursorReturnDuration(7.1)).toBe(5_000);
    expect(resolvePetModeDriftCursorReturnDuration(12)).toBe(5_000);
    expect(resolvePetModeDriftCursorReturnDuration(12.1)).toBe(2_500);
    expect(resolvePetModeDriftCursorReturnDuration(18)).toBe(2_500);
    expect(resolvePetModeDriftCursorReturnDuration(40)).toBe(2_500);
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
  });

  it("defaults to one attempt and persists the bounded chase controls", () => {
    expect(resolvePetModeDriftHuntSettings()).toEqual(DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS);
    persistPetModeDriftHuntSettings({ enabled: true, mode: "chase", chaseDurationMs: 8_000, softTurns: false });
    expect(resolvePetModeDriftHuntSettings()).toEqual({ enabled: true, mode: "chase", chaseDurationMs: 8_000, softTurns: false });
  });

  it("keeps a persisted hunt flag inert whenever Dev mode is off", () => {
    persistPetModeDriftHuntSettings({ enabled: true, mode: "chase", chaseDurationMs: 8_000, softTurns: true });
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");

    expect(resolvePetModeDriftHuntSettings().enabled).toBe(false);
  });

  it("falls back when stored chase settings are outside the reviewed options", () => {
    window.localStorage.setItem("drifty.pet.driftHuntMode.v1", "forever");
    window.localStorage.setItem("drifty.pet.driftHuntChaseDuration.v1", "9000");
    expect(resolvePetModeDriftHuntSettings()).toEqual(DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS);
  });

  it("pins the authored walk-mouth centre in both facings", () => {
    expect(PET_MODE_CURSOR_MOUTH_X_RIGHT).toBe(109.2);
    expect(PET_MODE_CURSOR_MOUTH_X_LEFT).toBe(34.8);
    expect(PET_MODE_CURSOR_MOUTH_X_RIGHT + PET_MODE_CURSOR_MOUTH_X_LEFT).toBe(144);
    expect(PET_MODE_CURSOR_MOUTH_Y).toBe(47.8);
  });

  it("gives one notice and one stalk to a continuous drift episode", () => {
    const early = advancePetModeDriftHunt(
      EMPTY_PET_MODE_DRIFT_HUNT_STATE,
      snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS - 1),
      false,
    );
    expect(early.action).toBeNull();

    const noticed = advancePetModeDriftHunt(early.state, snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS), false);
    expect(noticed.action).toBe("notice");

    const stalked = advancePetModeDriftHunt(noticed.state, snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS), false);
    expect(stalked.action).toBe("stalk");
    expect(advancePetModeDriftHunt(stalked.state, snapshot("drift", 90), false).action).toBeNull();
  });

  it("starts a new budget when the context changes or its duration rewinds", () => {
    const first = advancePetModeDriftHunt(
      { contextLabel: "video", lastDurationSeconds: 70, noticed: true, stalked: true },
      snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS, "game"),
      false,
    );
    expect(first.action).toBe("notice");

    const rewound = advancePetModeDriftHunt(
      { contextLabel: "game", lastDurationSeconds: 70, noticed: true, stalked: true },
      snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS, "game"),
      false,
    );
    expect(rewound.action).toBe("notice");
  });

  it("resets outside drift and suppresses translation for Reduced Motion", () => {
    const used = { contextLabel: "video", lastDurationSeconds: 70, noticed: true, stalked: true };
    expect(advancePetModeDriftHunt(used, snapshot("focus", 80), false)).toEqual({
      state: EMPTY_PET_MODE_DRIFT_HUNT_STATE,
      action: null,
    });

    const notice = advancePetModeDriftHunt(
      EMPTY_PET_MODE_DRIFT_HUNT_STATE,
      snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS),
      true,
    );
    expect(notice.action).toBe("notice");
    const held = advancePetModeDriftHunt(notice.state, snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS + 1), true);
    expect(held.action).toBeNull();
    expect(held.state.stalked).toBe(false);
  });
});
