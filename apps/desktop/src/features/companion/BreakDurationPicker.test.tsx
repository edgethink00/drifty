// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BreakDurationPicker } from "./BreakDurationPicker";

describe("BreakDurationPicker", () => {
  it("keeps preset times collapsed until the single trigger is opened", () => {
    const onSelect = vi.fn<(minutes: number) => void>();

    render(<BreakDurationPicker label="Take a break" options={[5, 15, 30, 60]} selectedMinutes={null} onSelect={onSelect} />);

    const trigger = screen.getByRole("button", { name: "Take a break" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toBe("Take a break");
    expect(screen.queryByRole("button", { name: "15m" })).toBeNull();

    fireEvent.click(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "15m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("selects More and submits a custom break duration", () => {
    const onSelect = vi.fn<(minutes: number) => void>();

    render(<BreakDurationPicker label="Take a break" options={[5, 15, 30, 60]} selectedMinutes={null} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Take a break" }));
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Custom break minutes" }), { target: { value: "22" } });
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(onSelect).toHaveBeenCalledWith(22);
  });
});
