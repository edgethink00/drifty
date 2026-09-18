// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarmCopySettings } from "./DriftAlarmCopySettings";
import { buildDefaultDriftAlarmCopy, type DriftAlarmCopySettingsValue } from "./driftAlarmCopy";

describe("DriftAlarmCopySettings", () => {
  it("previews draft edits and saves production drift alarm copy on command", async () => {
    const onChange = renderSettings();

    const alarmCopy = screen.getByRole("group", { name: "Alert wording" });
    expect(within(alarmCopy).queryByLabelText("Title")).toBeNull();
    fireEvent.click(within(alarmCopy).getByRole("button", { name: "Edit alert wording" }));

    const dialog = screen.getByRole("dialog", { name: "Edit alert wording" });
    const tablist = within(dialog).getByRole("tablist", { name: "Alert title sections" });
    expect(tablist.closest(".drift-copy-editor")).not.toBeNull();
    expect(tablist.closest(".drift-copy-preview")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" }).classList.contains("modal-x")).toBe(true);
    expect(within(dialog).queryByLabelText("Summary")).toBeNull();
    expect(within(dialog).queryByLabelText("Current context pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Latest focus pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Break section label")).toBeNull();
    expect(within(dialog).queryByLabelText("Correction action")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    expect(onChange).not.toHaveBeenCalled();
    const driftPreview = within(dialog).getByRole("complementary", { name: "Alert title preview" });
    expect(driftPreview.textContent).toContain("Back from youtube.com");
    expect(driftPreview.textContent).toContain("This seems outside your focus flow.");
    expect(driftPreview.textContent).not.toContain("(now drifting)");
    expect(driftPreview.textContent).not.toContain("Latest focus");
    expect(driftPreview.textContent).not.toContain("Now youtube.com");
    expect(driftPreview.querySelector(".companion-drift-alarm-card .view--drift")).toBeTruthy();
    expect(driftPreview.querySelector(".drift-alarm-backdrop")).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Break over" }));
    expect(within(dialog).queryByLabelText("Summary")).toBeNull();
    expect(within(dialog).queryByLabelText("Paused from pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Next focus pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Extend break label")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "{breakDuration} Back" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("complementary", { name: "Alert title preview" }).textContent).toContain("Back");

    fireEvent.click(within(dialog).getByRole("tab", { name: "macOS notification" }));
    expect(within(dialog).queryByLabelText("Dashboard action")).toBeNull();
    expect(within(dialog).queryByLabelText("No focus target text")).toBeNull();
    expect(within(dialog).queryByLabelText("Desktop notification body")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Decision needed" } });
    expect(onChange).not.toHaveBeenCalled();
    const notificationPreview = within(dialog).getByRole("complementary", { name: "Alert title preview" });
    expect(notificationPreview.textContent).not.toContain("Open dashboard");
    expect(notificationPreview.textContent).toContain("Drifty");
    expect(notificationPreview.textContent).toContain("5 minutes on youtube.com");
    expect(notificationPreview.querySelector(".drift-copy-preview__notification-source")).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Automatic close" }));
    expect(within(dialog).queryByLabelText("Summary")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Removed {closed}" } });
    expect(onChange).not.toHaveBeenCalled();
    const automaticClosePreview = within(dialog).getByRole("complementary", { name: "Alert title preview" });
    expect(automaticClosePreview.textContent).toContain("Removed youtube.com");
    expect(automaticClosePreview.textContent).toContain("Back in");
    expect(automaticClosePreview.textContent).toContain("Xcode");
    expect(automaticClosePreview.querySelector(".extreme-nudge-toast")).toBeNull();
    expect(automaticClosePreview.querySelector(".view--nudge")).toBeTruthy();

    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...buildDefaultDriftAlarmCopy(),
      driftTitle: "Back from {context}",
      breakReturnTitle: "{breakDuration} Back",
      notificationTitle: "Decision needed",
      extremeNudgeTitle: "Removed {closed}",
    });
    expect(screen.getByRole("dialog", { name: "Edit alert wording" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit alert wording" })).toBeNull());
  });

  it("resets and cancels draft alarm copy without saving", () => {
    const onChange = renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Edit alert wording" }));
    const dialog = screen.getByRole("dialog", { name: "Edit alert wording" });

    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    expect(within(dialog).getByRole("complementary", { name: "Alert title preview" }).textContent).toContain("Back from youtube.com");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset titles" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("complementary", { name: "Alert title preview" }).textContent).toContain("Let's get you back in flow.");

    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit alert wording" }));
    const reopenedDialog = screen.getByRole("dialog", { name: "Edit alert wording" });
    expect(within(reopenedDialog).getByRole("complementary", { name: "Alert title preview" }).textContent).toContain("Let's get you back in flow.");
  });
});

function renderSettings() {
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
  return onChange;
}
