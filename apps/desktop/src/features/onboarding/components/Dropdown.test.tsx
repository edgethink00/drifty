// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dropdown } from "./Dropdown";

function ControlledDropdown() {
  const [value, setValue] = useState<string | null>(null);

  return (
    <Dropdown
      ariaLabel="Your role"
      onChange={setValue}
      options={["Design", "Software Development", "Other"]}
      placeholder="What's your role?"
      searchable
      value={value}
    />
  );
}

function TransientOtherDropdown({ disabled = false }: { readonly disabled?: boolean }) {
  return (
    <Dropdown
      ariaLabel="Add work activity"
      disabled={disabled}
      keepOpenForOther={false}
      onChange={() => undefined}
      options={["Coding", "Other"]}
      placeholder="Add activity..."
      searchable
      value={null}
    />
  );
}

describe("Dropdown", () => {
  const originalInnerHeight = window.innerHeight;
  const originalInnerWidth = window.innerWidth;
  const originalRequestAnimationFrame = window.requestAnimationFrame;

  afterEach(() => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    window.requestAnimationFrame = originalRequestAnimationFrame;
    vi.restoreAllMocks();
  });

  it("positions the open menu within the viewport instead of a clipped ancestor", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 430 });
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    }) as typeof window.requestAnimationFrame;

    render(<ControlledDropdown />);

    const trigger = screen.getByRole("combobox", { name: /your role/i });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      bottom: 324,
      height: 44,
      left: 20,
      right: 380,
      top: 280,
      width: 360,
      x: 20,
      y: 280,
      toJSON: () => undefined,
    });

    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox");
    await waitFor(() => expect(listbox.style.position).toBe("fixed"));

    expect(listbox.dataset.placement).toBe("top");
    expect(listbox.style.left).toBe("20px");
    expect(listbox.style.top).toBe("42px");
    expect(listbox.style.width).toBe("360px");
    expect(listbox.style.maxHeight).toBe("238px");

    const menuBottom = Number.parseFloat(listbox.style.top) + Number.parseFloat(listbox.style.maxHeight);
    expect(menuBottom).toBeLessThanOrEqual(window.innerHeight - 12);
  });

  it("closes after Other when configured as a transient add picker", async () => {
    render(<TransientOtherDropdown />);

    const trigger = screen.getByRole("combobox", { name: /add work activity/i });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Other" }));

    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("does not open when disabled", () => {
    render(<TransientOtherDropdown disabled />);

    fireEvent.click(screen.getByRole("combobox", { name: /add work activity/i }));

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
