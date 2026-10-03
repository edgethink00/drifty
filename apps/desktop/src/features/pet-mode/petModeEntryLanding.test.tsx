// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetModeCat } from "./PetModeCat";
import { PET_MODE_ENTRY_SETTLE_DURATION_MS } from "./petModeData";

const bridge = vi.hoisted(() => ({ stage: vi.fn().mockResolvedValue(undefined), publish: vi.fn() }));
vi.mock("./petModeHitRegions", () => ({
  stagePetModeHitRegionTransition: bridge.stage,
  publishPetModeHitRegion: bridge.publish,
}));
const frames = Array.from({ length: 30 }, (_, frame) => `M${frame} 0h1v1h-1z`);
let clock = 0;
let nextId = 0;
let callbacks: Map<number, FrameRequestCallback>;
async function tick(time: number) {
  clock = time;
  const pending = [...callbacks.values()];
  callbacks.clear();
  await act(async () => { pending.forEach((callback) => callback(time)); });
}

describe("entry landing", () => {
  beforeEach(() => {
    clock = 0;
    callbacks = new Map();
    bridge.stage.mockReset().mockResolvedValue(undefined);
    bridge.publish.mockClear();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ json: async () => ({ frames }) }));
    vi.stubGlobal("Image", class { src = ""; decode() { return Promise.resolve(); } });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function start() {
    const view = render(<PetModeCat phase="entry" facing="left" pawFrame={0} entrySequence={1} />);
    await act(async () => undefined);
    return { view, cat: view.getByLabelText("Drifty pet cat") };
  }

  it("retains the planted SVG at completion and resumes breathing without a body swap", async () => {
    const { view, cat } = await start();
    await tick(482);
    expect(cat.getAttribute("data-region-id")).toBe("gait:0");
    const svg = cat.querySelector(".pet-mode-cat__vector");
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding />);
    expect(cat.querySelector(".pet-mode-cat__landed-vector")).toBe(svg);
    expect(cat.getAttribute("data-region-id")).toBe("idle");
    expect(cat.classList.contains("is-entry-settled")).toBe(true);
    expect(callbacks.size).toBe(0);
  });

  it("keeps the entry clock when run artwork finishes decoding mid-entry", async () => {
    let decode!: () => void;
    const decoded = new Promise<void>((resolve) => { decode = resolve; });
    vi.stubGlobal("Image", class { src = ""; decode() { return decoded; } });
    const view = render(<PetModeCat phase="entry" facing="left" pawFrame={0} entrySequence={1} fastRunEnabled />);
    await act(async () => undefined);
    const cat = view.getByLabelText("Drifty pet cat");
    await tick(360);
    const before = cat.getAttribute("data-region-id");
    await act(async () => decode());
    expect(cat.getAttribute("data-region-id")).toBe(before);
    await tick(482);
    expect(cat.getAttribute("data-region-id")).toBe("gait:0");
  });

  it("does not rewind while the parent waits to commit idle after native arrival", async () => {
    const { view, cat } = await start();
    await tick(360);
    const before = cat.getAttribute("data-region-id");
    // entry_complete requests preservation before its native stage resolves.
    view.rerender(<PetModeCat phase="entry" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding />);
    expect(cat.getAttribute("data-region-id")).toBe(before);
    await tick(482);
    expect(cat.getAttribute("data-region-id")).toBe("gait:0");
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding />);
    expect(cat.getAttribute("data-region-id")).toBe("idle");
  });

  it("finishes a late renderer step instead of freezing its mid-stride frame", async () => {
    const { view, cat } = await start();
    await tick(360);
    const before = cat.getAttribute("data-region-id");
    expect(before).not.toBe("gait:0");
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding hitRegionInteractive />);
    expect(cat.getAttribute("data-region-id")).toBe(before);
    expect(bridge.publish).toHaveBeenLastCalledWith({ regionId: before, mirrored: true, interactive: false });
    await tick(360 + PET_MODE_ENTRY_SETTLE_DURATION_MS);
    expect(bridge.stage).toHaveBeenCalledWith({ regionId: "transition:idle", mirrored: true });
    expect(cat.getAttribute("data-region-id")).toBe("idle");
    expect(bridge.publish).toHaveBeenLastCalledWith({ regionId: "idle", mirrored: true, interactive: true });
    expect(cat.classList.contains("is-entry-settled")).toBe(true);
    await tick(600);
    expect(callbacks.size).toBe(0);
  });

  it.each(["drag", "sit", "sleep", "walk"] as const)("cannot restore a landing after %s interrupts a pending hit-region acknowledgement", async (phase) => {
    const { view, cat } = await start();
    await tick(360);
    let acknowledge!: () => void;
    bridge.stage.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding hitRegionInteractive />);
    await tick(520);
    view.rerender(<PetModeCat phase={phase} facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding />);
    const region = cat.getAttribute("data-region-id");
    await act(async () => acknowledge());
    expect(cat.getAttribute("data-phase")).toBe(phase);
    expect(cat.getAttribute("data-region-id")).toBe(region);
    expect(cat.classList.contains("is-entry-settled")).toBe(false);
  });

  it("restarts entry without an old settling callback overwriting the new stride", async () => {
    const { view, cat } = await start();
    await tick(360);
    let acknowledge!: () => void;
    bridge.stage.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding hitRegionInteractive />);
    await tick(520);
    view.rerender(<PetModeCat phase="entry" facing="right" pawFrame={0} entrySequence={2} entryTravelDistance={90} />);
    const startRegion = cat.getAttribute("data-region-id");
    await act(async () => acknowledge());
    await tick(520);
    expect(cat.getAttribute("data-region-id")).toBe(startRegion);
    expect(cat.getAttribute("data-phase")).toBe("entry");
  });

  it("retries a rejected hit-region stage without painting an unstaged pose", async () => {
    const { view, cat } = await start();
    await tick(360);
    const before = cat.getAttribute("data-region-id");
    bridge.stage.mockRejectedValueOnce(new Error("temporary IPC failure"));
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding hitRegionInteractive />);
    await tick(520);
    expect(cat.getAttribute("data-region-id")).toBe(before);
    await tick(536);
    await tick(552);
    expect(cat.getAttribute("data-region-id")).toBe("idle");
  });

  it("skips the finishing motion when reduced motion is requested", async () => {
    const { view, cat } = await start();
    await tick(360);
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    view.rerender(<PetModeCat phase="idle" facing="left" pawFrame={0} entrySequence={1} preserveEntryLanding />);
    await tick(360);
    expect(cat.getAttribute("data-region-id")).toBe("idle");
  });
});
