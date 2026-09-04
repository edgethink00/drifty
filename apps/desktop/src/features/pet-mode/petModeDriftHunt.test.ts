// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEV_MODE_STORAGE_KEY } from "../settings/settingsStorage";
import {
  DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
  EMPTY_PET_MODE_DRIFT_HUNT_STATE,
  PET_MODE_CURSOR_MOUTH_X_LEFT,
  PET_MODE_CURSOR_MOUTH_X_RIGHT,
  PET_MODE_CURSOR_MOUTH_Y,
  PET_MODE_DRIFT_CHASE_DURATION_MS,
  PET_MODE_DRIFT_CHASE_DURATION_REVISION_STORAGE_KEY,
  PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY,
  PET_MODE_DRIFT_NOTICE_SECONDS,
  PET_MODE_DRIFT_CURSOR_RETURN_DISTANCE,
  PET_MODE_DRIFT_CURSOR_RETURN_TIERS,
  PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY,
  PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY,
  PET_MODE_DRIFT_STALK_SECONDS,
  advancePetModeDriftHunt,
  commitPetModeDriftHuntAction,
  persistPetModeDriftHuntSettings,
  resolvePetModeDriftHuntSettings,
  resolvePetModeDriftCursorReturnDuration,
  suppressPetModeDriftHunt,
} from "./petModeDriftHunt";

const snapshot = (productivity: "focus" | "neutral" | "drift", durationSeconds: number, contextLabel = "video") => ({
  productivity,
  durationSeconds,
  contextLabel,
} as const);

describe("petModeDriftHunt", () => {
  it("maps cursor movement into calm, alert, and evasive carry tiers", () => {
    expect(PET_MODE_DRIFT_CURSOR_RETURN_TIERS.map(({ label }) => label)).toEqual([
      "무저항",
      "약한 저항",
      "강한 저항",
    ]);
    expect(resolvePetModeDriftCursorReturnDuration(0)).toBe(6_000);
    expect(resolvePetModeDriftCursorReturnDuration(7)).toBe(6_000);
    expect(resolvePetModeDriftCursorReturnDuration(7.1)).toBe(2_000);
    expect(resolvePetModeDriftCursorReturnDuration(12)).toBe(2_000);
    expect(resolvePetModeDriftCursorReturnDuration(12.1)).toBe(1_000);
    expect(resolvePetModeDriftCursorReturnDuration(18)).toBe(1_000);
    expect(resolvePetModeDriftCursorReturnDuration(40)).toBe(1_000);
  });

  it("keeps even the six-second carry visibly moving", () => {
    // 128pt over six seconds is about 21pt/s. Keep it above the old 16pt/s
    // crawl while pinning the reviewed 6s/2s/1s timing contract above.
    for (const tier of PET_MODE_DRIFT_CURSOR_RETURN_TIERS) {
      const speed = PET_MODE_DRIFT_CURSOR_RETURN_DISTANCE / (tier.durationMs / 1_000);
      expect(speed).toBeGreaterThan(20);
    }
  });

  it("carries a still pointer for longer than one that is being pulled away", () => {
    // Resisting should shorten the carry, not lengthen it: the pet backs off
    // when the user is clearly reacting.
    const durations = PET_MODE_DRIFT_CURSOR_RETURN_TIERS.map((tier) => tier.durationMs);
    expect([...durations].sort((a, b) => b - a)).toEqual(durations);
  });

  it("uses the tuned carry durations without changing resistance classification", () => {
    const tuned = {
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      carryStillDurationMs: 5_000,
      carryNudgeDurationMs: 2_400,
      carryYankDurationMs: 1_200,
    };
    expect(resolvePetModeDriftCursorReturnDuration(7, tuned)).toBe(5_000);
    expect(resolvePetModeDriftCursorReturnDuration(12, tuned)).toBe(2_400);
    expect(resolvePetModeDriftCursorReturnDuration(18, tuned)).toBe(1_200);
  });

  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "1");
  });

  it("defaults to one attempt and persists the bounded chase controls", () => {
    expect(resolvePetModeDriftHuntSettings()).toEqual(DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS);
    expect(DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS.chaseDurationMs).toBe(PET_MODE_DRIFT_CHASE_DURATION_MS);
    persistPetModeDriftHuntSettings({
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      enabled: true,
      mode: "chase",
      chaseDurationMs: 8_000,
      softTurns: false,
      showAlertCue: false,
    });
    expect(resolvePetModeDriftHuntSettings()).toEqual({
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      enabled: true,
      mode: "chase",
      chaseDurationMs: 8_000,
      softTurns: false,
      showAlertCue: false,
    });
  });

  it("migrates the legacy eight-second chase default to a post-approach 2.5-second budget", () => {
    window.localStorage.setItem(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY, "8000");
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY, JSON.stringify({
      chaseDurationMs: 8_000,
      stalkSpeed: 180,
    }));

    expect(resolvePetModeDriftHuntSettings()).toMatchObject({
      chaseDurationMs: 2_500,
      stalkSpeed: 180,
    });
    expect(window.localStorage.getItem(PET_MODE_DRIFT_CHASE_DURATION_STORAGE_KEY)).toBe("2500");
    expect(window.localStorage.getItem(PET_MODE_DRIFT_CHASE_DURATION_REVISION_STORAGE_KEY))
      .toBe("post-approach-2.5");
  });

  it("migrates only the legacy 6s/3s/2s carry defaults to the reviewed 6s/2s/1s tiers", () => {
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY, JSON.stringify({
      stalkSpeed: 180,
      carryStillDurationMs: 6_000,
      carryNudgeDurationMs: 3_000,
      carryYankDurationMs: 2_000,
    }));

    expect(resolvePetModeDriftHuntSettings()).toMatchObject({
      stalkSpeed: 180,
      carryStillDurationMs: 6_000,
      carryNudgeDurationMs: 2_000,
      carryYankDurationMs: 1_000,
    });
    expect(window.localStorage.getItem(PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY))
      .toBe("carry-6-2-1");
    expect(JSON.parse(window.localStorage.getItem(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY) ?? "{}"))
      .toMatchObject({
        stalkSpeed: 180,
        carryStillDurationMs: 6_000,
        carryNudgeDurationMs: 2_000,
        carryYankDurationMs: 1_000,
      });
  });

  it("preserves previously customized carry durations during the default migration", () => {
    window.localStorage.setItem(PET_MODE_DRIFT_HUNT_TUNING_STORAGE_KEY, JSON.stringify({
      carryStillDurationMs: 5_000,
      carryNudgeDurationMs: 2_600,
      carryYankDurationMs: 1_400,
    }));

    expect(resolvePetModeDriftHuntSettings()).toMatchObject({
      carryStillDurationMs: 5_000,
      carryNudgeDurationMs: 2_600,
      carryYankDurationMs: 1_400,
    });
    expect(window.localStorage.getItem(PET_MODE_DRIFT_HUNT_TUNING_REVISION_STORAGE_KEY)).toBeNull();
  });

  it("keeps a persisted hunt flag inert whenever Dev mode is off", () => {
    persistPetModeDriftHuntSettings({
      ...DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS,
      enabled: true,
      mode: "chase",
      chaseDurationMs: 8_000,
      softTurns: true,
      showAlertCue: true,
    });
    window.localStorage.setItem(DEV_MODE_STORAGE_KEY, "0");

    expect(resolvePetModeDriftHuntSettings().enabled).toBe(false);
  });

  it("falls back when stored chase settings are outside the reviewed options", () => {
    window.localStorage.setItem("drifty.pet.driftHuntMode.v1", "forever");
    window.localStorage.setItem("drifty.pet.driftHuntChaseDuration.v1", "9000");
    expect(resolvePetModeDriftHuntSettings()).toEqual(DEFAULT_PET_MODE_DRIFT_HUNT_SETTINGS);
  });

  it("clamps and snaps hand-edited tuning storage to native-safe ranges", () => {
    window.localStorage.setItem("drifty.pet.driftHuntTuning.v1", JSON.stringify({
      stalkSpeed: 999,
      carryDistance: 91,
      cursorLagMs: -40,
      cursorSlack: 999,
      cursorYankDistance: 21,
    }));
    expect(resolvePetModeDriftHuntSettings()).toMatchObject({
      stalkSpeed: 360,
      carryDistance: 88,
      cursorLagMs: 0,
      cursorSlack: 16,
      cursorYankDistance: 22,
    });
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
    expect(advancePetModeDriftHunt(noticed.state, snapshot("drift", 11), false).action).toBe("notice");
    const noticeCommitted = commitPetModeDriftHuntAction(noticed.state, "notice");

    const stalked = advancePetModeDriftHunt(noticeCommitted, snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS), false);
    expect(stalked.action).toBe("stalk");
    expect(advancePetModeDriftHunt(stalked.state, snapshot("drift", 25), false).action).toBe("stalk");
    const stalkCommitted = commitPetModeDriftHuntAction(stalked.state, "stalk");
    expect(advancePetModeDriftHunt(stalkCommitted, snapshot("drift", 90), false).action).toBeNull();
  });

  it("prioritizes the stalk when the first sparse snapshot crosses both thresholds", () => {
    const overdue = advancePetModeDriftHunt(
      EMPTY_PET_MODE_DRIFT_HUNT_STATE,
      snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS + 6),
      false,
    );

    expect(overdue.action).toBe("stalk");
    expect(overdue.state).toMatchObject({
      noticed: false,
      stalked: false,
      pendingAction: "stalk",
    });

    const committed = commitPetModeDriftHuntAction(overdue.state, "stalk");
    expect(committed).toMatchObject({
      noticed: true,
      stalked: true,
      pendingAction: null,
    });
    expect(advancePetModeDriftHunt(committed, snapshot("drift", 60), false).action).toBeNull();
  });

  it("keeps a blocked notice pending and upgrades it to the stronger stalk", () => {
    const notice = advancePetModeDriftHunt(
      EMPTY_PET_MODE_DRIFT_HUNT_STATE,
      snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS),
      false,
    );
    expect(notice.state.pendingAction).toBe("notice");

    const upgraded = advancePetModeDriftHunt(
      notice.state,
      snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS),
      false,
    );
    expect(upgraded.action).toBe("stalk");
    expect(upgraded.state.pendingAction).toBe("stalk");
  });

  it("starts a new budget when the context changes or its duration rewinds", () => {
    const first = advancePetModeDriftHunt(
      { contextLabel: "video", lastDurationSeconds: 70, noticed: true, stalked: true, pendingAction: null },
      snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS, "game"),
      false,
    );
    expect(first.action).toBe("notice");

    const rewound = advancePetModeDriftHunt(
      { contextLabel: "game", lastDurationSeconds: 70, noticed: true, stalked: true, pendingAction: null },
      snapshot("drift", PET_MODE_DRIFT_NOTICE_SECONDS, "game"),
      false,
    );
    expect(rewound.action).toBe("notice");
  });

  it("resets outside drift and suppresses translation for Reduced Motion", () => {
    const used = { contextLabel: "video", lastDurationSeconds: 70, noticed: true, stalked: true, pendingAction: null } as const;
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
    const held = advancePetModeDriftHunt(
      commitPetModeDriftHuntAction(notice.state, "notice"),
      snapshot("drift", PET_MODE_DRIFT_STALK_SECONDS + 1),
      true,
    );
    expect(held.action).toBeNull();
    expect(held.state.stalked).toBe(false);
  });

  it("suppresses stale catch-up after an explicit hide or off transition", () => {
    const suppressed = suppressPetModeDriftHunt(snapshot("drift", 44));
    expect(suppressed).toMatchObject({
      contextLabel: "video",
      noticed: true,
      stalked: true,
      pendingAction: null,
    });
    expect(advancePetModeDriftHunt(suppressed, snapshot("drift", 45), false).action).toBeNull();
  });
});
