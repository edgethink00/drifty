// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PetModeCat } from "./PetModeCat";

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

describe("entry uses the outing return's artwork at a faster pace", () => {
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

  it.each(["left", "right"] as const)("renders the same gait and resting artwork facing %s", async (facing) => {
    const view = render(<>
      <PetModeCat phase="entry" facing={facing} pawFrame={0} entrySequence={1} />
      <PetModeCat phase="walk" facing={facing} pawFrame={0} />
    </>);
    await act(async () => undefined);
    const [entry, outing] = view.getAllByLabelText("Drifty pet cat");
    for (const time of [0, 140, 482, 900, 2000, 5500, 7212, 12000, 36058]) {
      await tick(time);
      const entryFrame = entry.getAttribute("data-region-id");
      const entryDrawing = entry.querySelector(".pet-mode-cat__vector path")?.getAttribute("d");
      await tick(time * 1.2);
      expect(entryFrame).toBe(outing.getAttribute("data-region-id"));
      expect(entryDrawing)
        .toBe(outing.querySelector(".pet-mode-cat__vector path")?.getAttribute("d"));
    }
    view.rerender(<>
      <PetModeCat phase="idle" facing={facing} pawFrame={0} entrySequence={1} />
      <PetModeCat phase="idle" facing={facing} pawFrame={0} />
    </>);
    expect(entry.getAttribute("data-region-id")).toBe("idle");
    expect(entry.querySelector(".pet-mode-cat__vector")).toBeNull();
    expect(entry.querySelector("img")?.getAttribute("src")).toBe(outing.querySelector("img")?.getAttribute("src"));
    expect(entry.className).toBe(outing.className);
  });

  it("does not rewind the walk when run artwork decodes mid-entry", async () => {
    let decode!: () => void;
    const decoded = new Promise<void>((resolve) => { decode = resolve; });
    vi.stubGlobal("Image", class { src = ""; decode() { return decoded; } });
    const view = render(<PetModeCat phase="entry" facing="left" pawFrame={0} entrySequence={1} />);
    await act(async () => undefined);
    const cat = view.getByLabelText("Drifty pet cat");
    await tick(1100);
    const before = cat.getAttribute("data-region-id");
    await act(async () => decode());
    expect(cat.getAttribute("data-region-id")).toBe(before);
  });

  it.each(["drag", "sit", "sleep", "idle"] as const)("cannot restore an old walk frame after %s interrupts a pending acknowledgement", async (phase) => {
    const view = render(<PetModeCat phase="entry" facing="left" pawFrame={0} entrySequence={1} hitRegionInteractive />);
    await act(async () => undefined);
    let acknowledge!: () => void;
    bridge.stage.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
    await tick(200);
    view.rerender(<PetModeCat phase={phase} facing="left" pawFrame={0} entrySequence={1} hitRegionInteractive />);
    const cat = view.getByLabelText("Drifty pet cat");
    const region = cat.getAttribute("data-region-id");
    await act(async () => acknowledge());
    await tick(500);
    expect(cat.getAttribute("data-phase")).toBe(phase);
    expect(cat.getAttribute("data-region-id")).toBe(region);
  });
});
