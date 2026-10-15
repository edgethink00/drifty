// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { AccentColorControl } from "./SettingsColorControls";
import { APP_THEME_ACCENT_COLOR_OPTIONS } from "./settingsStorage";

afterEach(cleanup);

// Productivity and category colors moved into the category editor, where
// each definition's editor owns its palette. The anchored role-chip palette
// remains for the accent color in General.
describe("AccentColorControl palette", () => {
  it("opens one palette, picks a preset, and closes", () => {
    const onColorChange = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <AccentColorControl accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS} overrides={{}} onColorChange={onColorChange} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "강조 색상" });
    expect(within(group).queryByRole("dialog")).toBeNull();
    fireEvent.click(within(group).getByRole("button", { name: "강조 · 모스 그린" }));
    expect(within(group).getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(within(group).getByRole("radio", { name: "강조 블루 색상" }));
    expect(onColorChange).toHaveBeenCalledWith("accent", "#476f8f");
    expect(within(group).queryByRole("dialog")).toBeNull();
  });

  it("closes on Escape and returns focus to the chip", () => {
    render(
      <LocalizationTestProvider language="en">
        <AccentColorControl accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS} overrides={{}} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "Accent color" });
    const chip = within(group).getByRole("button", { name: /^Accent · / });
    fireEvent.click(chip);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(group).queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("closes the palette when focus lands elsewhere on the page, but not while focus is outside the window", () => {
    render(
      <LocalizationTestProvider language="en">
        <button type="button">After the row</button>
        <AccentColorControl accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS} overrides={{}} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "Accent color" });
    fireEvent.click(within(group).getByRole("button", { name: /^Accent · / }));
    const more = within(group).getByLabelText("Accent theme color");

    // "More colors" opens the native panel: focus leaves the page entirely.
    act(() => {
      more.focus();
      more.blur();
    });
    expect(within(group).getByRole("dialog")).toBeTruthy();

    act(() => screen.getByRole("button", { name: "After the row" }).focus());
    expect(within(group).queryByRole("dialog")).toBeNull();
  });
});

describe("AccentColorControl", () => {
  it("renders the accent as a value chip named after the current preset", () => {
    render(
      <LocalizationTestProvider language="ko">
        <AccentColorControl accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS} overrides={{}} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "강조 색상" });
    const chip = within(group).getByRole("button", { name: "강조 · 모스 그린" });
    expect(chip.textContent).toContain("모스 그린");
    expect(group.className).toContain("settings-color-row--inline");
  });

  it("falls back to the hex for a custom accent", () => {
    render(
      <LocalizationTestProvider language="en">
        <AccentColorControl accentOptions={APP_THEME_ACCENT_COLOR_OPTIONS} overrides={{ accent: "#123456" }} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    expect(screen.getByRole("button", { name: "Accent · #123456" })).toBeTruthy();
  });
});
