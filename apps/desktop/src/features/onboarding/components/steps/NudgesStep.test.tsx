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
          driftAlarmEnabled={false}
          extremeNudgeEnabled={false}
          petModeEnabled={false}
          onInterventionChange={() => undefined}
          onPetToggle={onPetToggle}
        />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", { name: "Show desktop cat" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pet the desktop cat" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pet the desktop cat" }));
    expect(onPetToggle).toHaveBeenCalledTimes(1);
  });
});
