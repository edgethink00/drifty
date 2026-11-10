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
  it("keeps keyboard dismissal available when a pointer click does not focus the trigger", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "AI model" });

    // WebKit does not focus buttons on pointer click. Dispatching the key to
    // the actual focused element reproduces that path instead of assuming focus.
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on a second press of the open trigger instead of reopening", () => {
    renderSelect();
    const trigger = screen.getByRole("combobox", { name: "AI model" });

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    // WebKit blurs a focused button on mousedown unless the press is
    // cancelled. That blur closed the popup before the click toggled it,
    // so the popup closed and opened again.
    expect(fireEvent.mouseDown(trigger)).toBe(false);
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

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

  it("marks the current value with a check independently of hover", () => {
    renderSelect();
    fireEvent.click(screen.getByRole("combobox", { name: "AI model" }));

    const selected = screen.getByRole("option", { name: "Current model" });
    expect(selected.classList.contains("is-selected")).toBe(true);
    expect(selected.getAttribute("aria-selected")).toBe("true");
    expect(selected.querySelector(".settings-select-control__check")?.textContent).toBe("✓");
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

describe("SettingsSelect selected-row placement", () => {
  const options = [{ value: "en", label: "English" }, { value: "ko", label: "한국어" }];

  it("keeps selection distinct from hover and restores trigger focus after choosing", () => {
    const onChange = vi.fn();
    render(<SettingsSelect placement="selected" ariaLabel="Language" value="ko" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    const english = screen.getByRole("option", { name: "English" });
    fireEvent.mouseEnter(english);
    expect(english.classList.contains("is-active")).toBe(true);
    expect(english.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("option", { name: "한국어" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(english);
    expect(onChange).toHaveBeenCalledWith("en");
    expect(document.activeElement).toBe(trigger);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("supports arrow opening, Escape cancellation, and closes when the surrounding surface scrolls", () => {
    const onChange = vi.fn();
    render(<SettingsSelect placement="selected" ariaLabel="Language" value="ko" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "Language" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    fireEvent.keyDown(trigger, { key: "Home" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(trigger);
    fireEvent.scroll(screen.getByRole("listbox"));
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.scroll(document);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});


describe("SettingsSelect popup integration", () => {
  it.each([{ metaKey: true }, { ctrlKey: true }])("passes modifier Enter to the dialog only when the picker is closed: %j", (modifier) => {
    const onChange = vi.fn();
    const handled: boolean[] = [];
    render(<div onKeyDown={event => { if (event.key === "Enter") handled.push(event.defaultPrevented); }}>
      <SettingsSelect ariaLabel="Range" value="today" options={[{ value: "today", label: "Today" }, { value: "all", label: "All time" }]} onChange={onChange} />
    </div>);
    const trigger = screen.getByRole("combobox", { name: "Range" });
    expect(fireEvent.keyDown(trigger, { key: "Enter", ...modifier })).toBe(true);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(handled).toEqual([false]);
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(fireEvent.keyDown(trigger, { key: "Enter", ...modifier })).toBe(false);
    expect(onChange).toHaveBeenCalledExactlyOnceWith("all");
    expect(handled).toEqual([false, true, true]);
  });

  it("renders no partial control when the option list is empty", () => {
    render(<SettingsSelect ariaLabel="Empty" value="" options={[]} onChange={vi.fn()} />);
    expect(screen.queryByRole("combobox", { name: "Empty" })).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("dismisses an open popup when the control becomes disabled", () => {
    const options = [{ value: "today", label: "Today" }];
    const view = render(<SettingsSelect ariaLabel="Range" value="today" options={options} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Range" }));
    expect(screen.getByRole("listbox")).toBeTruthy();

    view.rerender(<SettingsSelect ariaLabel="Range" value="today" options={options} disabled onChange={vi.fn()} />);

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Range" }).hasAttribute("disabled")).toBe(true);
  });

  it("consumes Escape before it reaches a parent dialog", () => {
    const onParentKey = vi.fn();
    render(<div onKeyDown={onParentKey}><SettingsSelect ariaLabel="Range" value="today" options={[{ value: "today", label: "Today" }]} onChange={vi.fn()} /></div>);
    const trigger = screen.getByRole("combobox", { name: "Range" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(onParentKey).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps icon-only triggers on their existing compact placement", () => {
    render(<SettingsSelect ariaLabel="Detail" value="3" options={[{ value: "3", label: "3m" }]} triggerVisual={<span>•••</span>} onChange={vi.fn()} />);
    const trigger = screen.getByRole("combobox", { name: "Detail: 3m" });
    expect(trigger.parentElement?.getAttribute("data-placement")).toBe("below");
  });
});
