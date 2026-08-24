// @vitest-environment jsdom
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarm, buildBreakReturnAlarmEvent, buildDriftAlarmEvent, type DriftAlarmAction } from "./DriftAlarm";

describe("DriftAlarm", () => {
  it("renders drift context, focus targets, break choices, and action callbacks without focus strike copy", async () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const onCancel = vi.fn();
    const event = buildDriftAlarmEvent({
      id: "alarm-1",
      contextLabel: "youtube.com",
      driftDurationSeconds: 2 * 60,
      preservedFocusStrikeSeconds: 32 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      focusTargets: [
        {
          targetId: "site:docs.drifty.so",
          label: "docs.drifty.so",
          detail: "Spec draft · Safari",
          appName: "Safari",
          bundleId: "com.apple.Safari",
          siteDomain: "docs.drifty.so",
          siteTitle: "Spec draft",
          iconSrc: "data:image/png;base64,safari",
        },
        {
          targetId: "app:com.microsoft.VSCode",
          label: "Visual Studio Code",
          detail: "Recent focus app",
          appName: "Visual Studio Code",
          bundleId: "com.microsoft.VSCode",
          siteDomain: null,
          siteTitle: null,
          iconSrc: null,
        },
        {
          targetId: "app:com.figma.Desktop",
          label: "Figma",
          detail: "Notification specs - frame 12",
          appName: "Figma",
          bundleId: "com.figma.Desktop",
          siteDomain: null,
          siteTitle: null,
          iconSrc: null,
        },
        {
          targetId: "app:com.linear",
          label: "Linear",
          detail: "DRF-218 - review polish",
          appName: "Linear",
          bundleId: "com.linear",
          siteDomain: null,
          siteTitle: null,
          iconSrc: null,
        },
        {
          targetId: "app:com.tinyspeck.slackmacgap",
          label: "Slack",
          detail: "Should be capped out",
          appName: "Slack",
          bundleId: "com.tinyspeck.slackmacgap",
          siteDomain: null,
          siteTitle: null,
          iconSrc: null,
        },
      ],
    });

    const { container } = render(<DriftAlarm event={event} onAction={onAction} onCancel={onCancel} />);

    const alarm = screen.getByRole("alertdialog", { name: "Let's get you back in flow." });
    expect(alarm).toBeTruthy();
    expect(alarm.getAttribute("role")).toBe("alertdialog");
    expect(alarm.getAttribute("aria-modal")).toBe("true");
    expect(alarm.getAttribute("aria-labelledby")).toBe("drift-alarm-title");
    expect(alarm.classList.contains("watcher-peek--drift-alarm")).toBe(false);
    expect(alarm.classList.contains("da")).toBe(true);
    expect(alarm.classList.contains("watcher-peek--top-right")).toBe(false);
    expect(screen.getByText("Let's get you back in flow.")).toBeTruthy();
    expect(screen.getByText(/not a drift/i)).toBeTruthy();
    expect(screen.getAllByText(/youtube\.com/i).length).toBeGreaterThan(0);
    expect(screen.getByText("This seems outside your focus flow.")).toBeTruthy();
    expect(screen.getByAltText("Drifty").classList.contains("window-logo")).toBe(true);
    expect(container.querySelector(".da__chrome")).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss drift alarm" })).toBeNull();
    expect(screen.queryByText("(now drifting)")).toBeNull();
    expect(screen.queryByText(/Latest focus/i)).toBeNull();
    expect(container.querySelector(".da__context")).toBeNull();
    expect(container.querySelector(".da__drift-copy")).toBeTruthy();
    expect(screen.queryByText(/streak/i)).toBeNull();

    expect(screen.getByRole("heading", { name: /return to focus/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Other options" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /take a break/i })).toBeNull();
    expect(screen.getByRole("button", { name: /docs\.drifty\.so/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /visual studio code/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /figma/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /linear/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /slack/i })).toBeNull();
    expect(container.querySelectorAll(".da__target")).toHaveLength(4);
    expect(container.querySelector(".site-favicon")).toBeTruthy();
    expect(container.querySelector(".app-glyph")).toBeTruthy();
    expect(screen.getByText("VS")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take a break" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update settings" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "15m" })).toBeNull();
    expect(Array.from(container.querySelectorAll(".da__choice--break, .da__correct, .da__settings-action")).map((element) => element.textContent?.trim())).toEqual([
      "Take a break",
      "Not a drift",
      "Update settings",
    ]);

    const firstTarget = screen.getByRole("button", { name: /docs\.drifty\.so/i });
    const breakTrigger = screen.getByRole("button", { name: "Take a break" });
    const correctionButton = screen.getByRole("button", { name: "Not a drift" });
    vi.useFakeTimers();
    try {
      fireEvent.click(firstTarget);
      expect(firstTarget.classList.contains("is-selected")).toBe(true);
      expect(firstTarget.classList.contains("is-pending")).toBe(true);
      expect(firstTarget.getAttribute("aria-busy")).toBe("true");
      expect(firstTarget.querySelector(".da__target-spinner")).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();
      await advanceBreakActionDelay(300);
      expect(onAction.mock.calls.map(([action]) => action)).toEqual([
        { type: "return_to_focus", targetId: "site:docs.drifty.so" },
      ]);

      fireEvent.click(breakTrigger);
      expect(screen.getByRole("button", { name: "More" })).toBeTruthy();
      const breakButton = screen.getByRole("button", { name: "1h" });
      fireEvent.click(breakButton);
      expect(screen.getByRole("status", { name: "Starting break" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Starting break" }).classList.contains("is-selected")).toBe(true);
      expect(onAction.mock.calls.map(([action]) => action)).toEqual([
        { type: "return_to_focus", targetId: "site:docs.drifty.so" },
      ]);
      await advanceBreakActionDelay(300);
    } finally {
      vi.useRealTimers();
    }

    fireEvent.click(correctionButton);
    expect(correctionButton.classList.contains("is-selected")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Update settings" }));

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: "return_to_focus", targetId: "site:docs.drifty.so" },
      { type: "start_break", minutes: 60 },
      { type: "manual_correction" },
      { type: "settings" },
    ]);
    expect(onCancel).not.toHaveBeenCalled();
    expect(alarm.classList.contains("is-dismissed")).toBe(false);
  });

  it("renders break-return alarm copy and extends a break without changing target actions", async () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildBreakReturnAlarmEvent({
      id: "break-return-15",
      contextLabel: "YouTube",
      driftDurationSeconds: 6 * 60,
      preservedFocusStrikeSeconds: 32 * 60,
      generatedAt: "2026-05-20T13:31:00.000Z",
      breakDurationMinutes: 15,
      pausedFromLabel: "YouTube",
      nextFocusLabel: "VS Code",
      focusTargets: [
        {
          targetId: "app:com.microsoft.VSCode",
          label: "VS Code",
          detail: "companion/DriftAlarm.tsx",
          appName: "VS Code",
          bundleId: "com.microsoft.VSCode",
          siteDomain: null,
          siteTitle: null,
          iconSrc: null,
        },
      ],
    });

    const { container } = render(<DriftAlarm event={event} onAction={onAction} />);

    const alarm = screen.getByRole("alertdialog", { name: "15m Break finished" });
    expect(alarm.classList.contains("da--return")).toBe(true);
    expect(alarm.getAttribute("aria-live")).toBe("polite");
    expect(alarm.getAttribute("aria-labelledby")).toBe("break-return-alarm-title");
    expect(alarm.getAttribute("aria-describedby")).toBe("break-return-alarm-description");
    expect(container.querySelector(".da__hero-title")).toBeTruthy();
    expect(container.querySelector(".da__time-prefix")?.textContent).toBe("15m");
    expect(screen.getByText("Break finished")).toBeTruthy();
    expect(screen.getByText(/Break ·/i)).toBeTruthy();
    expect(screen.getByText("15m complete")).toBeTruthy();
    expect(screen.getByText(/Paused from/i)).toBeTruthy();
    expect(screen.getByText("YouTube")).toBeTruthy();
    expect(screen.getByText(/Next focus/i)).toBeTruthy();
    expect(screen.getAllByText("VS Code").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: /extend break/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: /take a break/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss break return alarm" })).toBeNull();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Extend break" }));
      fireEvent.click(screen.getByRole("button", { name: "15m" }));
      expect(screen.getByRole("status", { name: "Starting break" })).toBeTruthy();
      expect(onAction).not.toHaveBeenCalled();
      await advanceBreakActionDelay(300);
    } finally {
      vi.useRealTimers();
    }

    expect(onAction).toHaveBeenCalledWith({ type: "start_break", minutes: 15 });
  });

  it("renders the current drift source favicon when a site domain is available", () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-site-icon",
      contextLabel: "sbxh6.com",
      sourceSiteDomain: "sbxh6.com",
      sourceAppName: "Google Chrome",
      sourceIconSrc: "data:image/png;base64,drift-site",
      driftDurationSeconds: 2 * 60,
      preservedFocusStrikeSeconds: 30 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      focusTargets: [],
    });

    const { container } = render(<DriftAlarm event={event} onAction={onAction} />);
    const sourceTile = container.querySelector(".da__drift .src-tile");
    expect(sourceTile).toBeTruthy();
    // `.site-favicon` is also on the lettered placeholder, so assert on the
    // image itself: the alarm window has no site-icon context and cannot fetch
    // anything, so a missing payload icon silently degrades to a letter.
    const sourceImage = sourceTile?.querySelector("img.site-favicon");
    expect(sourceImage).toBeTruthy();
    expect(sourceImage?.getAttribute("src")).toBe("data:image/png;base64,drift-site");
    expect(sourceTile?.querySelector(".site-favicon--fallback")).toBeNull();
  });

  it("renders the current drift source app icon when no site domain is available", () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-app-icon",
      contextLabel: "Slack",
      sourceSiteDomain: null,
      sourceAppName: "Slack",
      sourceIconSrc: "data:image/png;base64,slack-icon",
      driftDurationSeconds: 2 * 60,
      preservedFocusStrikeSeconds: 30 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      focusTargets: [],
    });

    const { container } = render(<DriftAlarm event={event} onAction={onAction} />);
    const sourceTile = container.querySelector(".da__drift .src-tile");
    expect(sourceTile).toBeTruthy();
    const img = sourceTile?.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,slack-icon");
  });

  it("moves focus into the alarm, traps Tab, cancels on Escape, and restores opener focus", async () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-focus",
      contextLabel: "youtube.com",
      driftDurationSeconds: 2 * 60,
      preservedFocusStrikeSeconds: 32 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      focusTargets: [
        {
          targetId: "site:docs.drifty.so",
          label: "docs.drifty.so",
          detail: "Spec draft · Safari",
          appName: "Safari",
          bundleId: "com.apple.Safari",
          siteDomain: "docs.drifty.so",
          siteTitle: "Spec draft",
          iconSrc: null,
        },
      ],
    });

    function Harness() {
      const [alarmEvent, setAlarmEvent] = useState<typeof event | null>(null);

      return (
        <>
          <button type="button" onClick={() => setAlarmEvent(event)}>Open alarm</button>
          <DriftAlarm event={alarmEvent} onAction={onAction} onCancel={() => setAlarmEvent(null)} />
        </>
      );
    }

    render(<Harness />);

    const opener = screen.getByRole("button", { name: "Open alarm" });
    opener.focus();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);

    const alarm = screen.getByRole("alertdialog", { name: "Let's get you back in flow." });
    const settingsButton = screen.getByRole("button", { name: "Update settings" });
    const primaryTarget = screen.getByRole("button", { name: /docs\.drifty\.so/i });

    expect(alarm.getAttribute("aria-modal")).toBe("true");
    expect(alarm.getAttribute("aria-labelledby")).toBe("drift-alarm-title");
    await waitFor(() => expect(document.activeElement).toBe(primaryTarget));

    settingsButton.focus();
    fireEvent.keyDown(alarm, { key: "Tab" });
    expect(document.activeElement).toBe(primaryTarget);

    primaryTarget.focus();
    fireEvent.keyDown(alarm, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(settingsButton);

    fireEvent.keyDown(alarm, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Let's get you back in flow." })).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(onAction).not.toHaveBeenCalled();
  });


});

async function advanceBreakActionDelay(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}
