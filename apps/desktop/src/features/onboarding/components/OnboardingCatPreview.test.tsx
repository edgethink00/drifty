// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingCatPreview } from "./OnboardingCatPreview";

vi.mock("../../pet-mode/petModeHitRegions", () => ({
  preloadPetModeHitRegions: vi.fn().mockResolvedValue(undefined),
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
}));

describe("OnboardingCatPreview", () => {
  afterEach(() => {
    cleanup();
  });

  it("lets a tap turn the cat on and keeps later taps from toggling it off", () => {
    const onEnable = vi.fn();
    const { rerender } = render(
      <OnboardingCatPreview enabled={false} label="Pet the desktop cat" onEnable={onEnable} />,
    );

    const preview = screen.getByRole("button", { name: "Pet the desktop cat" });
    expect(preview.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(preview);
    expect(onEnable).toHaveBeenCalledTimes(1);

    rerender(<OnboardingCatPreview enabled={true} label="Pet the desktop cat" onEnable={onEnable} />);
    expect(preview.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(preview);
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("stops the happy pose when the cat is turned off", () => {
    const { rerender, container } = render(
      <OnboardingCatPreview enabled={true} label="Pet the desktop cat" onEnable={() => undefined} />,
    );
    expect(container.querySelector('[data-phase="happy"]')).not.toBeNull();
    rerender(<OnboardingCatPreview enabled={false} label="Pet the desktop cat" onEnable={() => undefined} />);
    expect(container.querySelector('[data-phase="happy"]')).toBeNull();
    expect(container.querySelector('[data-phase="idle"]')).not.toBeNull();
  });
});
