// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriftAlarmCopySettings } from "./DriftAlarmCopySettings";
import { buildDefaultDriftAlarmCopy } from "./driftAlarmCopy";
import { resolveDriftAlarmCopy, type DriftAlarmCopyOverrides } from "./driftAlarmCopyStorage";
import { LocalizationTestProvider, type DisplayLanguage } from "../localization/LocalizationContext";

describe("DriftAlarmCopySettings", () => {
  afterEach(cleanup);

  it("previews draft edits and saves only the fields that differ from the defaults", async () => {
    const onChange = renderSettings();

    const alarmCopy = screen.getByRole("group", { name: "Alert wording" });
    expect(within(alarmCopy).queryByLabelText("Title")).toBeNull();
    fireEvent.click(within(alarmCopy).getByRole("button", { name: "Edit alert wording" }));

    const dialog = screen.getByRole("dialog", { name: "Edit alert wording" });
    const tablist = within(dialog).getByRole("tablist", { name: "Alert wording sections" });
    expect(tablist.closest(".drift-copy-editor")).not.toBeNull();
    expect(tablist.closest(".drift-copy-preview")).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Close" }).classList.contains("modal-x")).toBe(true);
    // Context pills and the dashboard/no-target labels stay fixed to the capsule width.
    expect(within(dialog).queryByLabelText("Current context pill")).toBeNull();
    expect(within(dialog).queryByLabelText("Latest focus pill")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    fireEvent.change(within(dialog).getByLabelText("Description"), { target: { value: "{driftDuration} detour on {context}" } });
    fireEvent.change(within(dialog).getByLabelText("Return button"), { target: { value: "Resume now" } });
    expect(onChange).not.toHaveBeenCalled();
    const driftPreview = within(dialog).getByRole("complementary", { name: "Alert wording preview" });
    expect(driftPreview.textContent).toContain("Back from youtube.com");
    expect(driftPreview.textContent).toContain("5 minutes detour on youtube.com");
    expect(driftPreview.textContent).toContain("Resume now");
    expect(driftPreview.textContent).not.toContain("Latest focus");
    expect(driftPreview.querySelector(".companion-drift-alarm-card .view--drift")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Break over" }));
    expect(within(dialog).queryByLabelText("Paused from pill")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "{breakDuration} Back" } });
    expect(within(dialog).getByRole("complementary", { name: "Alert wording preview" }).textContent).toContain("15m Back");

    fireEvent.click(within(dialog).getByRole("tab", { name: "macOS notification" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Decision needed" } });
    fireEvent.change(within(dialog).getByLabelText("Body"), { target: { value: "{place} for {driftDuration}" } });
    const notificationPreview = within(dialog).getByRole("complementary", { name: "Alert wording preview" });
    expect(notificationPreview.textContent).toContain("Drifty");
    expect(notificationPreview.textContent).toContain("Decision needed");
    expect(notificationPreview.textContent).toContain("youtube.com for 5 minutes");

    fireEvent.click(within(dialog).getByRole("tab", { name: "Automatic close" }));
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Removed {closed}" } });
    const automaticClosePreview = within(dialog).getByRole("complementary", { name: "Alert wording preview" });
    expect(automaticClosePreview.textContent).toContain("Removed youtube.com");
    expect(automaticClosePreview.textContent).toContain("Back in");
    expect(automaticClosePreview.textContent).toContain("Xcode");
    expect(automaticClosePreview.querySelector(".view--nudge")).toBeTruthy();

    await waitFor(() => expect(dialog.closest("[data-modal-presence]")?.getAttribute("data-modal-presence")).toBe("open"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenLastCalledWith({
      driftTitle: "Back from {context}",
      driftSummary: "{driftDuration} detour on {context}",
      returnToFocusLabel: "Resume now",
      breakReturnTitle: "{breakDuration} Back",
      notificationTitle: "Decision needed",
      notificationBody: "{place} for {driftDuration}",
      extremeNudgeTitle: "Removed {closed}",
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit alert wording" })).toBeNull());
  });

  it("treats a blank field as the default and resets or cancels without saving", () => {
    const onChange = renderSettings();

    fireEvent.click(screen.getByRole("button", { name: "Edit alert wording" }));
    const dialog = screen.getByRole("dialog", { name: "Edit alert wording" });

    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "" } });
    expect(within(dialog).getByRole("complementary", { name: "Alert wording preview" }).textContent).toContain("Let's get you back in flow.");

    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    expect(within(dialog).getByRole("complementary", { name: "Alert wording preview" }).textContent).toContain("Back from youtube.com");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset wording" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("complementary", { name: "Alert wording preview" }).textContent).toContain("Let's get you back in flow.");

    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Back from {context}" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit alert wording" }));
    const reopenedDialog = screen.getByRole("dialog", { name: "Edit alert wording" });
    expect(within(reopenedDialog).getByRole("complementary", { name: "Alert wording preview" }).textContent).toContain("Let's get you back in flow.");
  });

  it("shows Korean defaults in the preview and keeps a user edit across languages", () => {
    renderSettings("ko", { driftTitle: "Back from {context}" });

    fireEvent.click(screen.getByRole("button", { name: "알림 문구 편집" }));
    const dialog = screen.getByRole("dialog", { name: "알림 문구 편집" });
    const preview = within(dialog).getByRole("complementary", { name: "알림 문구 미리보기" });
    expect(preview.textContent).toContain("Back from youtube.com");
    expect(preview.textContent).toContain("집중 흐름에서 벗어난 것 같아요.");
    expect(preview.textContent).toContain("집중으로 돌아가기");
    expect(preview.textContent).toContain("휴식하기");
    expect(preview.textContent).toContain("딴짓 아님");
    expect((within(dialog).getByLabelText("설명") as HTMLInputElement).placeholder).toBe("집중 흐름에서 벗어난 것 같아요.");

    fireEvent.click(within(dialog).getByRole("tab", { name: "macOS 알림" }));
    expect(within(dialog).getByRole("complementary", { name: "알림 문구 미리보기" }).textContent).toContain("youtube.com에서 5분째예요");
  });
});

function renderSettings(language: DisplayLanguage = "en", initialOverrides: DriftAlarmCopyOverrides = {}) {
  const onChange = vi.fn<(overrides: DriftAlarmCopyOverrides) => void>();
  const defaults = buildDefaultDriftAlarmCopy(language);

  function Harness() {
    const [overrides, setOverrides] = useState<DriftAlarmCopyOverrides>(initialOverrides);
    const handleChange = (nextOverrides: DriftAlarmCopyOverrides) => {
      onChange(nextOverrides);
      setOverrides(nextOverrides);
    };

    return (
      <LocalizationTestProvider language={language}>
        <DriftAlarmCopySettings
          value={resolveDriftAlarmCopy(overrides, language)}
          defaults={defaults}
          onChange={handleChange}
        />
      </LocalizationTestProvider>
    );
  }

  render(<Harness />);
  return onChange;
}
