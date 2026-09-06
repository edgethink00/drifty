// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";

function renderSelect() {
  const onChange = vi.fn();
  const onUpgrade = vi.fn();
  const onReveal = vi.fn();
  const onDelete = vi.fn();
  const options: readonly SettingsSelectOption<string>[] = [
    { value: "current", label: "Current model" },
    {
      value: "cloud",
      label: "Cloud model",
      disabled: true,
      actionLabel: "Upgrade",
      actionAriaLabel: "Upgrade cloud model",
      onAction: onUpgrade,
    },
    {
      value: "local",
      label: "Local model",
      actions: [
        { key: "reveal", label: "Show Local model in Finder", text: "Show", onAction: onReveal },
        { key: "delete", label: "Delete Local model", text: "Delete", onAction: onDelete },
      ],
    },
  ];
  const view = render(
    <>
      <SettingsSelect
        ariaLabel="AI model"
        value="current"
        options={options}
        onChange={onChange}
      />
      <button type="button">After select</button>
    </>,
  );
  return { onChange, onDelete, onReveal, onUpgrade, ...view };
}

describe("SettingsSelect row actions", () => {
  it("keeps focus and progress in the popup when a download action disables and is replaced", async () => {
    const onChange = vi.fn();
    let focusAtDownloadStart: Element | null = null;
    let completeDownload!: () => void;
    const download = new Promise<void>((resolve) => { completeDownload = resolve; });

    function DownloadSelect() {
      const [state, setState] = useState<"idle" | "downloading" | "installed">("idle");
      return (
        <SettingsSelect
          ariaLabel="AI model"
          value="current"
          onChange={onChange}
          options={[
            { value: "current", label: "Current model" },
            {
              value: "local",
              label: "Local model",
              disabled: state !== "installed",
              description: state === "installed" ? "Installed" : "Local AI",
              actions: state === "installed"
                ? [{ key: "reveal", label: "Show in Finder", text: "Show", onAction: vi.fn() }]
                : [{
                  key: "download",
                  label: "Download Local model",
                  text: state === "downloading" ? "Downloading 42%" : "Download",
                  disabled: state === "downloading",
                  busy: state === "downloading",
                  onAction: () => {
                    focusAtDownloadStart = document.activeElement;
                    setState("downloading");
                    void download.then(() => setState("installed"));
                  },
                }],
            },
          ]}
        />
      );
    }

    render(<DownloadSelect />);
    const trigger = screen.getByRole("combobox", { name: "AI model" });
    fireEvent.click(trigger);
    const downloadAction = screen.getByRole("button", { name: "Download Local model" });
    act(() => downloadAction.focus());
    fireEvent.click(downloadAction);

    // JSDOM does not reproduce native blur on disabling a focused button.
    // Focus must leave that button before the action starts changing its state.
    expect(focusAtDownloadStart).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Downloading 42%")).toBeTruthy();
    expect(downloadAction.hasAttribute("disabled")).toBe(true);
    expect(downloadAction.getAttribute("aria-busy")).toBe("true");

    await act(async () => completeDownload());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show in Finder" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("option", { name: "Local model" }));
    expect(onChange).toHaveBeenCalledWith("local");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("marks the current value with a selected fill instead of a trailing check", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));

    const selected = screen.getByRole("option", { name: "Current model" });
    expect(selected.classList.contains("is-selected")).toBe(true);
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.querySelector(".settings-select-control__check")).toBeNull();
    expect(screen.getByRole("option", { name: "Local model" }).classList.contains("is-selected")).toBe(false);
  });

  it("keeps the popup open while Tab moves from the combobox into row actions", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "AI model" });
    fireEvent.click(trigger);

    for (const option of screen.getAllByRole("option")) {
      expect(option.getAttribute("tabindex")).toBe("-1");
    }

    const upgrade = screen.getByRole("button", { name: "Upgrade cloud model" });
    fireEvent.keyDown(trigger, { key: "Tab" });
    fireEvent.blur(trigger, { relatedTarget: upgrade });
    act(() => upgrade.focus());

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(upgrade);
  });

  it("does not turn Enter on a focused row action into option selection", () => {
    const { onChange, onDelete } = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "AI model" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const deleteAction = screen.getByRole("button", { name: "Delete Local model" });
    act(() => deleteAction.focus());
    fireEvent.keyDown(deleteAction, { key: "Enter" });

    expect(onChange).not.toHaveBeenCalled();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(deleteAction);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on Escape from an action and when focus leaves the control", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "AI model" });
    fireEvent.click(trigger);
    const upgrade = screen.getByRole("button", { name: "Upgrade cloud model" });
    act(() => upgrade.focus());

    fireEvent.blur(upgrade, { relatedTarget: trigger });
    act(() => trigger.focus());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() => upgrade.focus());

    fireEvent.keyDown(upgrade, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    const reopenedUpgrade = screen.getByRole("button", { name: "Upgrade cloud model" });
    act(() => reopenedUpgrade.focus());
    fireEvent.blur(reopenedUpgrade, { relatedTarget: screen.getByRole("button", { name: "After select" }) });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});
