// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
  DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY,
  DEFAULT_START_OF_DAY_MINUTES,
  START_OF_DAY_STORAGE_KEY,
  clampDemoDashboardReplaySettings,
  persistDemoDashboardReplaySettings,
  resetDemoDashboardReplaySettings,
  resolveInitialDemoDashboardReplaySettings,
  resolveInitialStartOfDayMinutes,
} from "./settingsStorage";

describe("settingsStorage existing behavior", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("resolves the default start of day when storage is missing or malformed", () => {
    // Given: start-of-day storage has no saved value.
    window.localStorage.removeItem(START_OF_DAY_STORAGE_KEY);

    // When: the initial setting is resolved.
    const missingValue = resolveInitialStartOfDayMinutes();

    // Then: the existing default start-of-day value is preserved.
    expect(missingValue).toBe(DEFAULT_START_OF_DAY_MINUTES);

    // Given: start-of-day storage contains a malformed value.
    window.localStorage.setItem(START_OF_DAY_STORAGE_KEY, "not-a-number");

    // When: the initial setting is resolved again.
    const malformedValue = resolveInitialStartOfDayMinutes();

    // Then: malformed input falls back to the same default.
    expect(malformedValue).toBe(DEFAULT_START_OF_DAY_MINUTES);
  });
});

describe("demo dashboard replay settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("resolves default settings when storage is missing", () => {
    // Given: no persisted demo dashboard replay settings exist.
    window.localStorage.removeItem(DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY);
    window.localStorage.removeItem(DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY);

    // When: the replay settings are resolved.
    const settings = resolveInitialDemoDashboardReplaySettings();

    // Then: the configured defaults are returned.
    expect(settings).toEqual({
      preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
      durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
    });
  });

  it("resolves valid persisted values", () => {
    // Given: replay settings are stored as localStorage strings.
    window.localStorage.setItem(DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY, "7");
    window.localStorage.setItem(DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY, "90");

    // When: the replay settings are resolved.
    const settings = resolveInitialDemoDashboardReplaySettings();

    // Then: the parsed values are returned.
    expect(settings).toEqual({
      preRollSeconds: 7,
      durationSeconds: 90,
    });
  });

  it("clamps malformed and out-of-range inputs", () => {
    // Given: malformed, NaN, negative, and too-large external values.
    const malformedSettings = {
      preRollSeconds: "not-a-number",
      durationSeconds: "NaN",
    };
    const outOfRangeSettings = {
      preRollSeconds: -2,
      durationSeconds: 999,
    };

    // When: inputs are clamped into typed replay settings.
    const malformedResult = clampDemoDashboardReplaySettings(malformedSettings);
    const outOfRangeResult = clampDemoDashboardReplaySettings(outOfRangeSettings);

    // Then: malformed values use defaults and out-of-range values respect bounds.
    expect(malformedResult).toEqual({
      preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
      durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
    });
    expect(outOfRangeResult).toEqual({
      preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_MIN_SECONDS,
      durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_MAX_SECONDS,
    });
  });

  it("persists clamped settings and reset clears stored values", () => {
    // Given: a replay settings update contains values outside the allowed range.
    const persistedSettings = persistDemoDashboardReplaySettings({
      preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS + 1,
      durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS - 1,
    });

    // When: settings are persisted.
    const storedPreRoll = window.localStorage.getItem(DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY);
    const storedDuration = window.localStorage.getItem(DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY);

    // Then: clamped values are stored as strings.
    expect(persistedSettings).toEqual({
      preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS,
      durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS,
    });
    expect(storedPreRoll).toBe(String(DEMO_DASHBOARD_REPLAY_PRE_ROLL_MAX_SECONDS));
    expect(storedDuration).toBe(String(DEMO_DASHBOARD_REPLAY_DURATION_MIN_SECONDS));

    // When: settings are reset.
    const resetSettings = resetDemoDashboardReplaySettings();

    // Then: storage is cleared and defaults are returned.
    expect(resetSettings).toEqual({
      preRollSeconds: DEMO_DASHBOARD_REPLAY_PRE_ROLL_DEFAULT_SECONDS,
      durationSeconds: DEMO_DASHBOARD_REPLAY_DURATION_DEFAULT_SECONDS,
    });
    expect(window.localStorage.getItem(DEMO_DASHBOARD_REPLAY_PRE_ROLL_SECONDS_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(DEMO_DASHBOARD_REPLAY_DURATION_SECONDS_STORAGE_KEY)).toBeNull();
  });
});
