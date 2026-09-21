// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import { NudgesStep } from "./NudgesStep";

vi.mock("../../../pet-mode/petModeHitRegions", () => ({
  preloadPetModeHitRegions: vi.fn().mockResolvedValue(undefined),
  publishPetModeHitRegion: vi.fn().mockResolvedValue(undefined),
  stagePetModeHitRegionTransition: vi.fn().mockResolvedValue(undefined),
}));

describe("NudgesStep cat preview", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the setting toggle and the pettable preview as separate controls", () => {
    const onPetToggle = vi.fn();
    render(
      <LocalizationTestProvider language="en">
        <NudgesStep
          extremeNudgeEnabled={false}
          petModeEnabled={false}
          onExtremeNudgeToggle={() => undefined}
          onPetToggle={onPetToggle}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", { name: "Show desktop cat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pet the desktop cat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pet the desktop cat" }));
    expect(onPetToggle).toHaveBeenCalledTimes(1);
  });

  it("offers automatic close without exposing a drift alert choice", () => {
    const onExtremeNudgeToggle = vi.fn();
    render(
      <LocalizationTestProvider language="en">
        <NudgesStep
          extremeNudgeEnabled={false}
          petModeEnabled={false}
          onExtremeNudgeToggle={onExtremeNudgeToggle}
          onPetToggle={() => undefined}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.queryByText("Alert me")).toBeNull();
    expect(screen.queryByText("Just record")).toBeNull();
    const automaticClose = screen.getByRole("button", { name: "Automatic close" });
    expect(automaticClose.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(automaticClose);
    expect(onExtremeNudgeToggle).toHaveBeenCalledTimes(1);
  });
});
