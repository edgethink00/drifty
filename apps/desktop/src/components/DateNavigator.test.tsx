// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../features/localization/LocalizationContext";
import { DateNavigator } from "./DateNavigator";
import type { DateJumpPicker } from "./DateJumpCalendar";

afterEach(cleanup);

function renderNavigator(picker: Partial<DateJumpPicker> & Pick<DateJumpPicker, "onPick">, label = "Thu, Oct 29", bracketCaption = false) {
  render(
    <LocalizationTestProvider language="en">
      <DateNavigator
        ariaLabel="Today date selector"
        label={label}
        todayLabel="Now"
        bracketCaption={bracketCaption}
        isTodayDisabled
        isNextDisabled
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onToday={vi.fn()}
        previousLabel="Show previous day"
        nextLabel="Show next day"
        picker={{ unit: "day", selectedDay: "2026-10-29", today: "2026-10-29", startOfWeek: "monday", ...picker }}
      />
    </LocalizationTestProvider>,
  );
  return screen.getByRole("button", { name: label + ", go to " + (picker.unit === "week" ? "another week" : "another day") });
}

describe("DateNavigator month picker", () => {
  it("places the Calendar caption between the previous and next buttons in reading order", () => {
    renderNavigator({ onPick: vi.fn() }, "Thu, Oct 29", true);
    const navigation = screen.getByRole("group", { name: "Today date selector" });
    const buttons = within(navigation).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent)).toEqual([
      "Show previous day",
      "Thu, Oct 29, go to another day",
      "Show next day",
      "Now",
    ]);
  });

  it("opens on the shown day's month, picks an earlier day and returns focus to the caption", () => {
    const onPick = vi.fn();
    const trigger = renderNavigator({ onPick });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Go to a day" });
    expect(within(dialog).getByText("October 2026")).toBeTruthy();
    const shown = within(dialog).getByRole("gridcell", { name: "Thu, Oct 29" });
    expect(shown.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(shown);
    // Days after today are off, and so is the month after this one.
    expect((within(dialog).getByRole("gridcell", { name: "Fri, Oct 30" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Previous month" }));
    expect(within(dialog).getByText("September 2026")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("gridcell", { name: "Mon, Sep 14" }));

    expect(onPick).toHaveBeenCalledWith("2026-09-14");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("moves through days and months from the keyboard and closes on Escape without picking", () => {
    const onPick = vi.fn();
    const trigger = renderNavigator({ onPick, selectedDay: "2026-10-01", today: "2026-10-29" }, "Thu, Oct 1");
    fireEvent.click(trigger);
    const grid = screen.getByRole("grid");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(screen.getByText("September 2026")).toBeTruthy();
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-09-30");
    // Focus stops at today rather than landing on a day that cannot be picked.
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    expect(document.activeElement?.getAttribute("data-day")).toBe("2026-10-29");
    expect(grid.isConnected).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);
  });

  it("picks whole weeks: the row is the target, this week stays whole, later weeks are off", () => {
    const onPick = vi.fn();
    const trigger = renderNavigator({ onPick, unit: "week", selectedDay: "2026-10-14", today: "2026-10-29" }, "Oct 12–18");
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Go to a week" });
    const rows = within(dialog).getAllByRole("row").slice(1);
    const selected = rows.filter((row) => row.classList.contains("is-selected"));
    expect(selected).toHaveLength(1);
    expect(within(selected[0]!).getByRole("gridcell", { name: "Mon, Oct 12" })).toBeTruthy();

    // A later day of this week is still a way to pick this week; the pick never asks for a day after today.
    const saturday = within(dialog).getByRole("gridcell", { name: "Sat, Oct 31" }) as HTMLButtonElement;
    expect(saturday.disabled).toBe(false);
    expect((within(dialog).getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saturday);
    expect(onPick).toHaveBeenLastCalledWith("2026-10-29");

    // Choosing the week already shown just closes.
    fireEvent.click(trigger);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("gridcell", { name: "Fri, Oct 16" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes when the reader presses elsewhere and leaves the caption plain without a picker", () => {
    const trigger = renderNavigator({ onPick: vi.fn() });
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    cleanup();

    render(
      <DateNavigator ariaLabel="Week" label="Oct 26–Nov 1" todayLabel="Now" isTodayDisabled isNextDisabled onPrevious={vi.fn()} onNext={vi.fn()} onToday={vi.fn()} previousLabel="Previous" nextLabel="Next" />,
    );
    expect(screen.queryByRole("button", { name: /go to another/i })).toBeNull();
    expect(screen.getByText("Oct 26–Nov 1").tagName).toBe("STRONG");
  });
});
