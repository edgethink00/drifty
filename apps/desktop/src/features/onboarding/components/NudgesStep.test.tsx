// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { NudgesStep } from "./NudgesStep";

function NudgesStepHarness() {
  const [driftAlarmEnabled, setDriftAlarmEnabled] = useState(false);
  const [extremeNudgeEnabled, setExtremeNudgeEnabled] = useState(false);

  return (
    <>
      <NudgesStep
        driftAlarmEnabled={driftAlarmEnabled}
        extremeNudgeEnabled={extremeNudgeEnabled}
        onDriftAlarmChange={setDriftAlarmEnabled}
        onExtremeNudgeChange={setExtremeNudgeEnabled}
      />
      <button type="button" onClick={() => setExtremeNudgeEnabled(true)}>
        Enable extreme externally
      </button>
    </>
  );
}

describe("NudgesStep", () => {
  it("closes the extreme nudge confirmation when the selected state changes outside the dialog", () => {
    // Given: the confirmation dialog is open after the user asks for Extreme Nudge.
    render(<NudgesStepHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Extreme nudge" }));
    expect(screen.getByRole("alertdialog", { name: /let drifty close drift/i })).toBeTruthy();

    // When: the selected state changes from outside the dialog.
    fireEvent.click(screen.getByRole("button", { name: /enable extreme externally/i }));

    // Then: the stale confirmation window is removed.
    expect(screen.queryByRole("alertdialog", { name: /let drifty close drift/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Extreme nudge" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("cancels the extreme nudge confirmation when the backdrop is clicked", () => {
    // Given: the confirmation dialog is open.
    render(<NudgesStepHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Extreme nudge" }));
    const dialog = screen.getByRole("alertdialog", { name: /let drifty close drift/i });
    const backdrop = dialog.parentElement;
    if (!(backdrop instanceof HTMLElement)) throw new Error("Confirmation backdrop was not rendered");

    // When: the user clicks outside the dialog window.
    fireEvent.mouseDown(backdrop);

    // Then: the confirmation closes without enabling Extreme Nudge.
    expect(screen.queryByRole("alertdialog", { name: /let drifty close drift/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Extreme nudge" }).getAttribute("aria-pressed")).toBe("false");
  });
});
