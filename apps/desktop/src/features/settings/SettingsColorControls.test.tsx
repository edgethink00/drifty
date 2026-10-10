// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { AccentColorControl, CategoryColorControls } from "./SettingsColorControls";
import { APP_THEME_ACCENT_COLOR_OPTIONS, CATEGORY_COLOR_OPTIONS } from "./settingsStorage";

afterEach(cleanup);

describe("CategoryColorControls", () => {
  it("shows one chip per role at rest and opens a single palette on demand", () => {
    render(
      <LocalizationTestProvider language="en">
        <CategoryColorControls options={CATEGORY_COLOR_OPTIONS} overrides={{}} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "Category colors" });
    expect(within(group).getAllByRole("button", { expanded: false })).toHaveLength(CATEGORY_COLOR_OPTIONS.length);
    expect(within(group).queryByRole("dialog")).toBeNull();

    fireEvent.click(within(group).getByRole("button", { name: "Learning" }));
    expect(within(group).getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(within(group).getByRole("button", { name: "Music" }));
    expect(within(group).getAllByRole("dialog")).toHaveLength(1);
    expect(within(group).getByRole("dialog", { name: "Music color palette" })).toBeTruthy();
  });

  it("marks colors taken by sibling roles and closes on Escape, returning focus to the chip", () => {
    render(
      <LocalizationTestProvider language="en">
        <CategoryColorControls options={CATEGORY_COLOR_OPTIONS} overrides={{}} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "Category colors" });
    const chip = within(group).getByRole("button", { name: "Learning" });
    fireEvent.click(chip);
    // Workspace owns moss (#5f7f31); inside Learning's palette it reads as taken.
    const moss = within(group).getByRole("radio", { name: "Learning Moss preset · used by Workspace" });
    expect(moss.className).toContain("is-used");
    // Learning's own color is selected, not "used".
    expect(within(group).getByRole("radio", { name: "Learning Teal preset" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(group).queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("picks a preset and closes the palette", () => {
    const onColorChange = vi.fn();
    render(
      <LocalizationTestProvider language="ko">
        <CategoryColorControls options={CATEGORY_COLOR_OPTIONS} overrides={{}} onColorChange={onColorChange} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "카테고리 색상" });
    fireEvent.click(within(group).getByRole("button", { name: "학습" }));
    fireEvent.click(within(group).getByRole("radio", { name: "학습 인디고 색상" }));
    expect(onColorChange).toHaveBeenCalledWith("learning", "#5366a3");
    expect(within(group).queryByRole("dialog")).toBeNull();
  });

  it("closes the palette when focus lands elsewhere on the page, but not while focus is outside the window", () => {
    render(
      <LocalizationTestProvider language="en">
        <button type="button">After the row</button>
        <CategoryColorControls options={CATEGORY_COLOR_OPTIONS} overrides={{}} onColorChange={vi.fn()} onColorReset={vi.fn()} />
      </LocalizationTestProvider>,
    );
    const group = screen.getByRole("group", { name: "Category colors" });
    fireEvent.click(within(group).getByRole("button", { name: "Learning" }));
    const more = within(group).getByLabelText("Learning category color");

    // "More colors" opens the native panel: focus leaves the page entirely.
    act(() => {
      more.focus();
      more.blur();
    });
    expect(within(group).getByRole("dialog", { name: "Learning color palette" })).toBeTruthy();

    // Tabbing onto another chip in the row is leaving this palette.
    act(() => within(group).getByRole("button", { name: "Music" }).focus());
    expect(within(group).queryByRole("dialog")).toBeNull();

    fireEvent.click(within(group).getByRole("button", { name: "Learning" }));
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
