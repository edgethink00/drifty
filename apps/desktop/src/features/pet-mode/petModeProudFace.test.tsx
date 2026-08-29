// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PetModeCat } from "./PetModeCat";

describe("proud walk face colour", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ frames: ["M0 0 L1 1"], cycleSeconds: 1 }),
    }));
    vi.stubGlobal("Image", class { src = ""; decode() { return Promise.resolve(); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("inherits the coat ink so every coat keeps a readable face", async () => {
    render(<PetModeCat phase="walk" facing="right" pawFrame={0} proudWalk />);
    const lids = await waitFor(() => {
      const el = document.querySelector(".pet-mode-cat__walk-eyes--proud");
      expect(el).not.toBeNull();
      return el as SVGPathElement;
    });
    // The lids must ride the shared face group rather than hard-coding a colour,
    // otherwise a charcoal or plum coat would render them invisible.
    expect(lids.getAttribute("stroke")).toBe("currentColor");
    expect(lids.closest(".pet-mode-cat__face")).not.toBeNull();
  });

  it("keeps the dot eyes when the flag is off", async () => {
    render(<PetModeCat phase="walk" facing="right" pawFrame={0} />);
    await waitFor(() => {
      expect(document.querySelector('circle[cx="120.4"][cy="46.2"]')).not.toBeNull();
    });
    expect(document.querySelector(".pet-mode-cat__walk-eyes--proud")).toBeNull();
  });
});
