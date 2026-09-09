// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useLayoutEffect } from "react";
import { PetModeCat, type PetModeCatPhase } from "./PetModeCat";

const hitRegion = vi.hoisted(() => ({ publish: vi.fn(), stage: vi.fn() }));
const imageLoads = vi.hoisted(() => vi.fn());
vi.mock("./petModeHitRegions", () => ({
  publishPetModeHitRegion: hitRegion.publish,
  stagePetModeHitRegionTransition: hitRegion.stage,
}));
const walkAsset = JSON.parse(readFileSync("public/pet-mode/walk-frames-v2.json", "utf8"));

describe("PetModeCat suspension", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hitRegion.publish.mockResolvedValue(undefined);
    hitRegion.stage.mockResolvedValue(undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => walkAsset }));
    vi.stubGlobal("Image", class {
      constructor() { imageLoads(); }
      src = "";
      decode() { return Promise.resolve(); }
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  async function advance(milliseconds: number) {
    for (let elapsed = 0; elapsed < milliseconds; elapsed += 20) {
      await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    }
  }

  it("defers artwork loading until a cold-suspended pet is first revealed", async () => {
    const props = {
      phase: "idle" as const,
      facing: "right" as const,
      pawFrame: 0,
      fastRunBetaEnabled: true,
    };
    const view = render(<PetModeCat {...props} suspended />);
    await act(async () => undefined);

    expect(fetch).not.toHaveBeenCalled();
    expect(imageLoads).not.toHaveBeenCalled();

    view.rerender(<PetModeCat {...props} />);
    await act(async () => undefined);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(imageLoads).toHaveBeenCalled();
  });

  it("does not duplicate in-flight artwork loads across a rapid hide and reveal", async () => {
    let resolveWalk!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((resolve) => { resolveWalk = resolve; }));
    vi.stubGlobal("Image", class {
      constructor() { imageLoads(); }
      src = "";
      decode() { return new Promise<void>(() => undefined); }
    });
    const props = {
      phase: "idle" as const,
      facing: "right" as const,
      pawFrame: 0,
      fastRunBetaEnabled: true,
    };
    const view = render(<PetModeCat {...props} />);
    await act(async () => undefined);
    const initialImageLoads = imageLoads.mock.calls.length;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(initialImageLoads).toBeGreaterThan(0);

    view.rerender(<PetModeCat {...props} suspended />);
    view.rerender(<PetModeCat {...props} />);
    await act(async () => undefined);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(imageLoads).toHaveBeenCalledTimes(initialImageLoads);

    await act(async () => {
      resolveWalk({ json: async () => walkAsset } as Response);
      await Promise.resolve();
    });
  });

  it("does not duplicate preload effects during a Strict Mode replay", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("Image", class {
      constructor() { imageLoads(); }
      src = "";
      decode() { return new Promise<void>(() => undefined); }
    });
    const cat = <PetModeCat phase="idle" facing="right" pawFrame={0} fastRunBetaEnabled />;

    render(cat);
    await act(async () => undefined);
    const ordinaryImageLoads = imageLoads.mock.calls.length;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ordinaryImageLoads).toBeGreaterThan(0);

    cleanup();
    vi.mocked(fetch).mockClear();
    imageLoads.mockClear();
    render(<StrictMode>{cat}</StrictMode>);
    await act(async () => undefined);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(imageLoads).toHaveBeenCalledTimes(ordinaryImageLoads);
  });

  it.each<PetModeCatPhase>(["entry", "walk", "run", "stalk", "return", "stretch", "tail"])(
    "stops %s clocks and clears once, then resumes without reloading assets",
    async (phase) => {
      const props = { phase, facing: "right" as const, pawFrame: 0, fastRunBetaEnabled: true, hitRegionInteractive: true };
      const view = render(<PetModeCat {...props} />);
      await act(async () => undefined);
      await advance(100);
      expect(view.queryByLabelText("Drifty pet cat")).not.toBeNull();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      const fetchCount = vi.mocked(fetch).mock.calls.length;
      hitRegion.publish.mockClear();

      view.rerender(<PetModeCat {...props} suspended />);
      await act(async () => undefined);
      expect(view.queryByLabelText("Drifty pet cat")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(hitRegion.publish).toHaveBeenCalledExactlyOnceWith({ regionId: "idle", mirrored: false, interactive: false });
      view.rerender(<PetModeCat {...props} suspended facing="left" hitRegionCommitRevision={9} />);
      await advance(1000);
      expect(vi.getTimerCount()).toBe(0);
      expect(hitRegion.publish).toHaveBeenCalledTimes(1);

      hitRegion.publish.mockClear();
      view.rerender(<PetModeCat {...props} />);
      await advance(100);
      expect(view.queryByLabelText("Drifty pet cat")).not.toBeNull();
      expect(vi.getTimerCount()).toBeGreaterThan(0);
      expect(hitRegion.publish.mock.calls.some(([request]) => request.interactive)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(fetchCount);
    },
  );

  it("does not start live-sit blink timers on a suspended mount", async () => {
    const props = { phase: "sit" as const, facing: "right" as const, pawFrame: 0 };
    const view = render(<PetModeCat {...props} suspended />);
    await act(async () => undefined);
    expect(vi.getTimerCount()).toBe(0);
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<PetModeCat {...props} />);
    await advance(6200);
    expect(view.container.querySelector(".pet-mode-cat__d-live-eyes.is-blinking")).not.toBeNull();
    view.rerender(<PetModeCat {...props} suspended />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("invalidates an old frame before the suspension commit finishes", async () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    let oldFrame: FrameRequestCallback | undefined;
    function LayoutProbe({ suspended }: { suspended: boolean }) {
      useLayoutEffect(() => {
        // Exercise the commit window before passive cleanup: a callback that
        // was already dispatched must not stage a newer mask after our clear.
        if (suspended) oldFrame?.(performance.now() + 500);
      }, [suspended]);
      return <PetModeCat phase="walk" facing="right" pawFrame={0} hitRegionInteractive suspended={suspended} />;
    }
    const view = render(<LayoutProbe suspended={false} />);
    await act(async () => undefined);
    oldFrame = raf.mock.calls[raf.mock.calls.length - 1]?.[0];
    expect(oldFrame).toBeDefined();
    hitRegion.stage.mockClear();
    view.rerender(<LayoutProbe suspended />);
    await act(async () => undefined);
    expect(hitRegion.stage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"])("ignores a late %s from an in-flight frame transition", async (outcome) => {
    let resolveStage!: () => void;
    let rejectStage!: (error: Error) => void;
    hitRegion.stage.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      resolveStage = resolve;
      rejectStage = reject;
    }));
    const props = { phase: "walk" as const, facing: "right" as const, pawFrame: 0, hitRegionInteractive: true };
    const view = render(<PetModeCat {...props} />);
    await act(async () => undefined);
    await advance(200);
    expect(hitRegion.stage).toHaveBeenCalledTimes(1);
    view.rerender(<PetModeCat {...props} suspended />);
    hitRegion.publish.mockClear();
    await act(async () => {
      if (outcome === "resolve") resolveStage();
      else rejectStage(new Error("delayed acknowledgement failure"));
    });
    await advance(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(hitRegion.publish).not.toHaveBeenCalled();
    expect(view.container.childElementCount).toBe(0);
    view.rerender(<PetModeCat {...props} />);
    await advance(200);
    expect(hitRegion.stage.mock.calls.length).toBeGreaterThan(1);
    expect(view.queryByLabelText("Drifty pet cat")).not.toBeNull();
  });
});
