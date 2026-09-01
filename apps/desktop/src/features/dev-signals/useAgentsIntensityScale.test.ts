import { describe, expect, it } from "vitest";

import { buildAgentsIntensityBands } from "./agentsPageModel";
import {
  agentsIntensityBandsForScale,
  agentsIntensityLookbackRange,
  agentsIntensityLookbackStart,
  readAgentsIntensityScale,
  resolveAgentsIntensityScale,
} from "./useAgentsIntensityScale";

describe("personal intensity scale", () => {
  it("looks back 28 inclusive calendar days from today", () => {
    expect(agentsIntensityLookbackStart("2026-08-31")).toBe("2026-08-04");
    expect(agentsIntensityLookbackRange("2026-08-31", 4 * 60)).toEqual({
      start: "2026-08-04T04:00:00",
      end: "2026-09-01T03:59:59",
    });
  });

  it("keeps a quiet visible day on the locked personal legend", () => {
    const scale = resolveAgentsIntensityScale({
      visiblePeak: 1,
      lookbackPeak: 9,
      stored: { peak: 9, lockedOnDay: "2026-08-30" },
      todayDay: "2026-08-31",
    });
    expect(scale).toEqual({ peak: 9, lockedOnDay: "2026-08-31" });
    expect(agentsIntensityBandsForScale(scale, 1).map((band) => band.label)).toEqual(
      buildAgentsIntensityBands(9).map((band) => band.label),
    );
  });

  it("opens the last slot when live concurrency outruns the lock", () => {
    const scale = { peak: 9, lockedOnDay: "2026-08-31" };
    const bands = agentsIntensityBandsForScale(scale, 12);
    expect(bands[bands.length - 1]?.label).toBe("×7+");
  });

  it("ignores malformed local scale snapshots", () => {
    const storage = {
      getItem: () => "{not-json",
    };
    expect(readAgentsIntensityScale(storage)).toBeNull();
  });

  it("does not let a missing lookback collapse an existing lock", () => {
    expect(resolveAgentsIntensityScale({
      visiblePeak: 4,
      lookbackPeak: null,
      stored: { peak: 9, lockedOnDay: "2026-08-30" },
      todayDay: "2026-08-31",
    })).toEqual({ peak: 9, lockedOnDay: "2026-08-31" });
  });
});
