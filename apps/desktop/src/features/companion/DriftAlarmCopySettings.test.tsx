// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarmCopySettings } from "./DriftAlarmCopySettings";
import { buildDefaultDriftAlarmCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";

describe("DriftAlarmCopySettings", () => {
  it("edits and resets production drift alarm copy", () => {
    const onChange = vi.fn<(value: DriftAlarmCopySettingsValue) => void>();

    function Harness() {
      const [copy, setCopy] = useState(buildDefaultDriftAlarmCopy);
      const handleChange = (nextCopy: DriftAlarmCopySettingsValue) => {
        onChange(nextCopy);
        setCopy(nextCopy);
      };

      return <DriftAlarmCopySettings value={copy} onChange={handleChange} />;
    }

    render(<Harness />);

    const alarmCopy = screen.getByRole("group", { name: "Alarm copy" });
    expect(within(alarmCopy).queryByLabelText("Title")).toBeNull();
    fireEvent.click(within(alarmCopy).getByRole("button", { name: "Edit alarm copy" }));

    const dialog = screen.getByRole("dialog", { name: "Edit alarm copy" });
    const tablist = within(dialog).getByRole("tablist", { name: "Alarm copy sections" });
    expect(tablist.closest(".drift-copy-editor")).not.toBeNull();
    expect(tablist.closest(".drift-copy-preview")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" }).textContent).toBe("x");
    expect(within(dialog).queryByLabelText("Summary")).toBeNull();
    expect(within(dialog).queryByLabelText("Current context pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Latest focus pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Break section label")).toBeNull();
    expect(within(dialog).queryByLabelText("Correction action")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
    });
    expect(within(dialog).getByRole("complementary", { name: "Alarm copy preview" }).textContent).toContain("Back from youtube.com");

    fireEvent.click(within(dialog).getByRole("tab", { name: "Break return" }));
    expect(within(dialog).queryByLabelText("Summary")).toBeNull();
    expect(within(dialog).queryByLabelText("Paused from pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Next focus pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Extend break label")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "{breakDuration} Back" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
      breakReturnTitle: "{breakDuration} Back",
    });
    expect(within(dialog).getByRole("complementary", { name: "Alarm copy preview" }).textContent).toContain("Back");

    fireEvent.click(within(dialog).getByRole("tab", { name: "Notification" }));
    expect(within(dialog).queryByLabelText("Dashboard action")).toBeNull();
    expect(within(dialog).queryByLabelText("No focus target text")).toBeNull();
    expect(within(dialog).queryByLabelText("macOS notification body")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Decision needed" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
      breakReturnTitle: "{breakDuration} Back",
      notificationTitle: "Decision needed",
    });
    expect(within(dialog).getByRole("complementary", { name: "Alarm copy preview" }).textContent).not.toContain("Open dashboard");

    fireEvent.click(within(dialog).getByRole("tab", { name: "Extreme nudge" }));
    expect(within(dialog).queryByLabelText("Summary")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Removed {closed}" } });
    expect(onChange).toHaveBeenLastCalledWith({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
      breakReturnTitle: "{breakDuration} Back",
      notificationTitle: "Decision needed",
      extremeNudgeTitle: "Removed {closed}",
    });
    expect(within(dialog).getByRole("complementary", { name: "Alarm copy preview" }).textContent).toContain("Removed youtube.com");

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset alarm copy" }));
    expect(onChange).toHaveBeenLastCalledWith(buildDefaultDriftAlarmCopy());
    expect(within(dialog).getByRole("complementary", { name: "Alarm copy preview" }).textContent).toContain("Closed youtube.com");
  });
});
