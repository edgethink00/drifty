// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const bridge = vi.hoisted(() => ({
  updateNativePetHitRegion: vi.fn(),
}));

vi.mock("./petModeBridge", () => ({
  updateNativePetHitRegion: bridge.updateNativePetHitRegion,
}));

import { publishPetModeHitRegion, stagePetModeHitRegionTransition, PET_MODE_HIT_REGION_ACK_TIMEOUT_MS } from "./petModeHitRegions";

describe("Pet Mode hit-region transitions", () => {
  beforeEach(() => {
    bridge.updateNativePetHitRegion.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries a lost transition acknowledgement with a newer empty revision", async () => {
    bridge.updateNativePetHitRegion.mockRejectedValueOnce(new Error("acknowledgement lost"));

    await stagePetModeHitRegionTransition({ regionId: "transition:gait:4", mirrored: true });

    expect(bridge.updateNativePetHitRegion).toHaveBeenCalledTimes(2);
    const first = bridge.updateNativePetHitRegion.mock.calls[0][0];
    const second = bridge.updateNativePetHitRegion.mock.calls[1][0];
    expect(first).toMatchObject({
      version: 1,
      regionId: "transition:gait:4",
      mirrored: true,
      spans: [],
    });
    expect(second).toMatchObject({
      generation: first.generation,
      version: 1,
      regionId: "transition:gait:4",
      mirrored: true,
      spans: [],
      revision: first.revision + 1,
    });
  });

  it("retries an unanswered stage without letting its late reply replace newer state", async () => {
    vi.useFakeTimers();
    let acknowledge!: () => void;
    bridge.updateNativePetHitRegion.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    const earlier = stagePetModeHitRegionTransition({ regionId: "transition:idle", mirrored: false });
    await stagePetModeHitRegionTransition({ regionId: "transition:drag", mirrored: false });
    await vi.advanceTimersByTimeAsync(PET_MODE_HIT_REGION_ACK_TIMEOUT_MS);
    await earlier;
    const [first, newer, retry] = bridge.updateNativePetHitRegion.mock.calls.map(([request]) => request);
    expect(first.revision).toBeLessThan(retry.revision);
    expect(retry.revision).toBeLessThan(newer.revision);
    acknowledge();
    await Promise.resolve();
    expect(bridge.updateNativePetHitRegion).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects after both acknowledgements time out so the caller can recover", async () => {
    vi.useFakeTimers();
    bridge.updateNativePetHitRegion.mockImplementation(() => new Promise(() => undefined));
    const result = stagePetModeHitRegionTransition({ regionId: "transition:idle", mirrored: false });
    const assertion = expect(result).rejects.toThrow("acknowledgement timed out");
    await vi.advanceTimersByTimeAsync(2 * PET_MODE_HIT_REGION_ACK_TIMEOUT_MS);
    await assertion;
    expect(bridge.updateNativePetHitRegion).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects when native cannot confirm either fail-closed update", async () => {
    bridge.updateNativePetHitRegion.mockRejectedValue(new Error("native unavailable"));

    await expect(stagePetModeHitRegionTransition({
      regionId: "transition:facing:left",
      mirrored: true,
    })).rejects.toThrow("native unavailable");
    expect(bridge.updateNativePetHitRegion).toHaveBeenCalledTimes(2);
  });

  it("keeps a delayed retry older than a transition that started later", async () => {
    let rejectFirst!: (error: Error) => void;
    const firstAttempt = new Promise<void>((_, reject) => { rejectFirst = reject; });
    bridge.updateNativePetHitRegion
      .mockImplementationOnce(() => firstAttempt)
      .mockResolvedValue(undefined);

    const earlier = stagePetModeHitRegionTransition({ regionId: "transition:gait:1", mirrored: false });
    const later = stagePetModeHitRegionTransition({ regionId: "transition:gait:2", mirrored: false });
    await later;
    rejectFirst(new Error("late acknowledgement failure"));
    await earlier;

    const earlierFirst = bridge.updateNativePetHitRegion.mock.calls[0][0];
    const laterFirst = bridge.updateNativePetHitRegion.mock.calls[1][0];
    const earlierRetry = bridge.updateNativePetHitRegion.mock.calls[2][0];
    expect(earlierFirst.revision).toBeLessThan(earlierRetry.revision);
    expect(earlierRetry.revision).toBeLessThan(laterFirst.revision);
  });

  it("retries an artifact load after a transient failure", async () => {
    const artifact = {
      version: 1,
      width: 288,
      height: 198,
      logicalWidth: 144,
      logicalHeight: 99,
      subpixelResolution: 2,
      alphaThreshold: 16,
      tolerancePx: 4,
      mirrorResamplingToleranceXPx: 2,
      regions: { idle: [20, 40, 60] },
    };
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("startup fetch failed"))
      .mockResolvedValueOnce({ ok: true, json: async () => artifact });
    vi.stubGlobal("fetch", fetchMock);

    await publishPetModeHitRegion({ regionId: "idle", mirrored: false, interactive: true });
    await publishPetModeHitRegion({ regionId: "idle", mirrored: false, interactive: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = bridge.updateNativePetHitRegion.mock.calls;
    expect(calls[calls.length - 1]?.[0]).toMatchObject({
      regionId: "idle",
      spans: [20, 40, 60],
    });
  });

  it("keeps a frame awaiting its artifact older than a suspension clear", async () => {
    vi.resetModules();
    const { publishPetModeHitRegion: publish } = await import("./petModeHitRegions");
    let finishFetch!: (response: unknown) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { finishFetch = resolve; })));
    const pending = publish({ regionId: "idle", mirrored: false, interactive: true });
    await publish({ regionId: "idle", mirrored: false, interactive: false });
    finishFetch({ ok: true, json: async () => JSON.parse(readFileSync("public/pet-mode/hit-regions-v1.json", "utf8")) });
    await pending;
    const [clear, lateFrame] = bridge.updateNativePetHitRegion.mock.calls.map(([request]) => request);
    expect(clear.spans).toEqual([]);
    expect(lateFrame.spans.length).toBeGreaterThan(0);
    expect(lateFrame.generation).toBe(clear.generation);
    expect(lateFrame.revision).toBeLessThan(clear.revision);
  });

  it("keeps a failed suspension clear retry older than a subsequent reveal", async () => {
    vi.resetModules();
    const { publishPetModeHitRegion: publish } = await import("./petModeHitRegions");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true, json: async () => JSON.parse(readFileSync("public/pet-mode/hit-regions-v1.json", "utf8")),
    }));
    let rejectClear!: (error: Error) => void;
    bridge.updateNativePetHitRegion.mockImplementationOnce(() => new Promise((_, reject) => { rejectClear = reject; }));
    const pendingClear = publish({ regionId: "idle", mirrored: false, interactive: false });
    await publish({ regionId: "idle", mirrored: true, interactive: true });
    rejectClear(new Error("late clear acknowledgement failure"));
    await pendingClear;
    const [clear, reveal, retry] = bridge.updateNativePetHitRegion.mock.calls.map(([request]) => request);
    expect(reveal.spans.length).toBeGreaterThan(0);
    expect(retry.spans).toEqual([]);
    expect(clear.revision).toBeLessThan(retry.revision);
    expect(retry.revision).toBeLessThan(reveal.revision);
  });
});
