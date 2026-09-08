// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PetModeCat } from "./PetModeCat";

describe("drowsy walk face", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L1 1"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class { src = ""; decode() { return Promise.resolve(); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("wears the petting drowsy lids in the coat ink while sleepwalking", async () => {
    render(<PetModeCat phase="walk" facing="right" pawFrame={0} drowsyWalk />);
    const lids = await waitFor(() => {
      const el = document.querySelector(".pet-mode-cat__walk-eyes--drowsy");
      expect(el).not.toBeNull();
      return el as SVGPathElement;
    });
    expect(lids.getAttribute("stroke")).toBe("currentColor");
    expect(lids.closest(".pet-mode-cat__face")).not.toBeNull();
    // Same downward-curving lid arc as the sitting drowsy eyes.
    expect(lids.getAttribute("d")).toMatch(/^M118\.3 45\.0 Q120\.4 47\.6 122\.5 45\.0/);
    expect(document.querySelector('circle[cx="120.4"][cy="46.2"]')).toBeNull();
  });

  it("keeps the open dot eyes for an ordinary walk", async () => {
    render(<PetModeCat phase="walk" facing="right" pawFrame={0} />);
    await waitFor(() => {
      expect(document.querySelector('circle[cx="120.4"][cy="46.2"]')).not.toBeNull();
    });
    expect(document.querySelector(".pet-mode-cat__walk-eyes--drowsy")).toBeNull();
  });

  it("marks the drowsy resettle so the petting heart stays off", () => {
    render(<PetModeCat phase="drowsy" facing="right" pawFrame={0} drowsyWalk />);
    const cat = document.querySelector(".pet-mode-cat");
    expect(cat?.classList.contains("is-sleepwalking")).toBe(true);
    expect(cat?.classList.contains("pet-mode-cat--drowsy")).toBe(true);
  });
});
