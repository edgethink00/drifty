// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PetModeCat } from "./PetModeCat";

const frames = Array.from({ length: 30 }, (_, frame) => `M${frame} 0h1v1h-1z`);

describe("PetModeCat gait continuity", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the arrival silhouette through bite and into the first return frame", async () => {
    let nextAnimationFrameId = 1;
    const animationFrames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      animationFrames.delete(id);
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames, cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class {
      src = "";
      decode() { return Promise.resolve(); }
    });
    vi.spyOn(performance, "now").mockReturnValue(0);

    const view = render(<PetModeCat phase="stalk" facing="right" pawFrame={0} />);
    const cat = await waitFor(() => {
      const element = view.getByLabelText("Drifty pet cat");
      expect(element.getAttribute("data-region-id")).toBe("gait:0");
      return element;
    });

    const [stalkFrameId, stalkFrame] = [...animationFrames.entries()][0] ?? [];
    expect(stalkFrame).toBeDefined();
    animationFrames.delete(stalkFrameId);
    act(() => stalkFrame?.(500));
    const arrivalRegion = cat.getAttribute("data-region-id");
    expect(arrivalRegion).not.toBe("gait:0");

    view.rerender(<PetModeCat phase="bite" facing="right" pawFrame={0} />);
    expect(cat.getAttribute("data-region-id")).toBe(arrivalRegion);
    expect(cat.querySelector(".pet-mode-cat__walk-mouth--bite")).not.toBeNull();

    view.rerender(<PetModeCat phase="return" facing="left" pawFrame={0} />);
    expect(cat.getAttribute("data-region-id")).toBe(arrivalRegion);
    expect(cat.querySelector(".pet-mode-cat__walk-mouth--bite")).not.toBeNull();

    const [firstReturnFrameId, firstReturnFrame] = [...animationFrames.entries()][0] ?? [];
    expect(firstReturnFrame).toBeDefined();
    animationFrames.delete(firstReturnFrameId);
    act(() => firstReturnFrame?.(0));
    expect(cat.getAttribute("data-region-id")).toBe(arrivalRegion);
  });
});
