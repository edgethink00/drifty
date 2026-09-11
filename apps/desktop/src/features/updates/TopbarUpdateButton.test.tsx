// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalizationTestProvider } from "../localization/LocalizationContext";
import { TopbarUpdateButton } from "./TopbarUpdateButton";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function visibleLabel(): string {
  return document.querySelector(".topbar-update-button__label-text")?.textContent ?? "";
}

describe("TopbarUpdateButton", () => {
  it("offers the install action while no update is running", () => {
    const onInstall = vi.fn();
    render(<TopbarUpdateButton onInstall={onInstall} status="available" version="1.12.0" />);

    const button = screen.getByRole("button", { name: "Install Drifty 1.12.0 update" });
    expect(visibleLabel()).toBe("Update");
    expect(button.getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(button);
    expect(onInstall).toHaveBeenCalledOnce();
  });

  it("says only what it knows while the update source reports no size", () => {
    const onInstall = vi.fn();
    render(<TopbarUpdateButton onInstall={onInstall} status="downloading" version="1.12.0" />);

    const button = screen.getByRole("button", { name: "Preparing Drifty 1.12.0 update" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.className).not.toContain("topbar-update-button--progress");
    // Marked disabled without `disabled`, so the tooltip still reaches the user.
    fireEvent.click(button);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("turns the pill itself into the progress bar once the transfer reports its size", () => {
    render(<TopbarUpdateButton onInstall={vi.fn()} progress={0.42} status="downloading" version="1.12.0" />);

    const button = screen.getByRole("button", { name: /Preparing Drifty 1\.12\.0 update · 42%/ });
    expect(visibleLabel()).toBe("42%");
    expect(button.className).toContain("topbar-update-button--progress");
    expect(button.style.getPropertyValue("--topbar-update-progress")).toBe("42%");
  });

  it("keeps the action word when the transfer never reports a size", () => {
    render(<TopbarUpdateButton onInstall={vi.fn()} status="downloading" version="1.12.0" />);

    // No size means no number to show, and "Preparing" would say less than the
    // dimmed pill already does.
    expect(visibleLabel()).toBe("Update");
  });

  it("holds one width for every state so a chrome control never resizes mid-update", () => {
    // jsdom has no layout, so the contract is the reserved stack: the widest
    // thing the pill can say is always present behind whatever it says now.
    const { rerender } = render(<TopbarUpdateButton onInstall={vi.fn()} status="available" version="1.12.0" />);
    const reserved = () => Array.from(document.querySelector(".topbar-update-button__label-reserve")?.children ?? [])
      .map((node) => node.textContent);

    expect(reserved()).toEqual(["Update", "100%"]);
    const labels = [visibleLabel()];
    for (const progress of [null, 0, 0.42, 1]) {
      rerender(<TopbarUpdateButton onInstall={vi.fn()} progress={progress} status="downloading" version="1.12.0" />);
      expect(reserved()).toEqual(["Update", "100%"]);
      labels.push(visibleLabel());
    }

    expect(labels).toEqual(["Update", "Update", "0%", "42%", "100%"]);
  });

  it("can only ever show a label the reserve already holds, across every state", () => {
    // The pixel width was measured by hand in a browser once; this is the
    // invariant behind it, checked over the whole state surface rather than the
    // handful of states someone thought to sample.
    const statuses = ["idle", "available", "downloading", "installing"] as const;
    const progresses = [null, 0, 0.005, 0.42, 0.999, 1];
    const { rerender } = render(<TopbarUpdateButton onInstall={vi.fn()} status="available" version="1.12.0" />);

    for (const status of statuses) {
      for (const progress of progresses) {
        rerender(<TopbarUpdateButton onInstall={vi.fn()} progress={progress} status={status} version="1.12.0" />);
        const reserved = Array.from(document.querySelector(".topbar-update-button__label-reserve")?.children ?? [])
          .map((node) => node.textContent ?? "");
        const shown = visibleLabel();
        // A shown label the reserve does not hold is exactly how the pill would
        // grow past the width the reserve is there to guarantee.
        expect(reserved.some((candidate) => candidate.length >= shown.length)).toBe(true);
        expect(reserved).toContain("Update");
      }
    }
  });

  it("puts the remaining time where it costs no space in the chrome", () => {
    vi.useFakeTimers();
    const { rerender } = render(<TopbarUpdateButton onInstall={vi.fn()} progress={0.1} status="downloading" version="1.12.0" />);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(<TopbarUpdateButton onInstall={vi.fn()} progress={0.2} status="downloading" version="1.12.0" />);
    act(() => {
      vi.advanceTimersByTime(1_200);
    });

    const button = screen.getByRole("button", { name: /about 1 min left/ });
    // The percentage is on the pill; the remaining time stays in the tooltip.
    expect(visibleLabel()).toBe("20%");
    expect(button.textContent).not.toContain("min left");
    expect(button.getAttribute("title")).toContain("about 1 min left");
  });

  it("localizes the whole button rather than mixing languages in one label", () => {
    render(
      <LocalizationTestProvider language="ko">
        <TopbarUpdateButton onInstall={vi.fn()} progress={0.42} status="downloading" version="1.12.0" />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("button", { name: /Drifty 1\.12\.0 업데이트 준비 중 · 42%/ })).toBeTruthy();
    expect(visibleLabel()).toBe("42%");
    expect(Array.from(document.querySelector(".topbar-update-button__label-reserve")?.children ?? [])
      .map((node) => node.textContent)).toEqual(["업데이트", "100%"]);
  });
});
