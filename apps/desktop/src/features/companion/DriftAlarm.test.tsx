// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarm, buildBreakReturnAlarmEvent, buildDriftAlarmEvent, type DriftAlarmAction } from "./DriftAlarm";

describe("DriftAlarm", () => {
  it("renders drift context, focus targets, break choices, and action callbacks without focus strike copy", () => {
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

    const alarm = screen.getByRole("alertdialog", { name: "Drift detected" });
    expect(alarm).toBeTruthy();
    expect(alarm.getAttribute("role")).toBe("alertdialog");
    expect(alarm.getAttribute("aria-modal")).toBe("true");
    expect(alarm.getAttribute("aria-labelledby")).toBe("drift-alarm-title");
    expect(alarm.classList.contains("watcher-peek--drift-alarm")).toBe(false);
    expect(alarm.classList.contains("da")).toBe(true);
    expect(alarm.classList.contains("watcher-peek--top-right")).toBe(false);
    expect(screen.getByText(/drift detected/i)).toBeTruthy();
    expect(screen.getByText(/not a drift/i)).toBeTruthy();
    expect(screen.getAllByText(/youtube\.com/i).length).toBeGreaterThan(0);
    expect(screen.getByAltText("Drifty").classList.contains("window-logo")).toBe(true);
    expect(container.querySelector(".da__chrome")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss drift alarm" })).toBeTruthy();
    expect(screen.getByText(/Latest focus/i)).toBeTruthy();
    expect(screen.queryByText(/streak/i)).toBeNull();

    expect(screen.getByRole("heading", { name: /return to focus/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /take a break/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /docs\.drifty\.so/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /visual studio code/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /figma/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /linear/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /slack/i })).toBeNull();
    expect(container.querySelectorAll(".da__target")).toHaveLength(4);
    expect(container.querySelector(".site-favicon")).toBeTruthy();
    expect(container.querySelector(".app-glyph")).toBeTruthy();
    expect(screen.getByText("VS")).toBeTruthy();
    expect(screen.getByRole("button", { name: "5m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "15m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "30m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1h" })).toBeTruthy();

    const firstTarget = screen.getByRole("button", { name: /docs\.drifty\.so/i });
    const breakButton = screen.getByRole("button", { name: "1h" });
    const correctionButton = screen.getByRole("button", { name: "Not a drift" });
    fireEvent.click(firstTarget);
    expect(firstTarget.classList.contains("is-selected")).toBe(true);
    fireEvent.click(breakButton);
    expect(breakButton.classList.contains("is-selected")).toBe(true);
    fireEvent.click(correctionButton);
    expect(correctionButton.classList.contains("is-selected")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Alarm settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss drift alarm" }));

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: "return_to_focus", targetId: "site:docs.drifty.so" },
      { type: "start_break", minutes: 60 },
      { type: "manual_correction" },
      { type: "settings" },
    ]);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(alarm.classList.contains("is-dismissed")).toBe(true);
  });

  it("renders break-return alarm copy and extends a break without changing target actions", () => {
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
    expect(screen.getByRole("heading", { name: /extend break/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /take a break/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss break return alarm" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "15m" }));
    expect(onAction).toHaveBeenCalledWith({ type: "start_break", minutes: 15 });
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

    const alarm = screen.getByRole("alertdialog", { name: "Drift detected" });
    const settingsButton = screen.getByRole("button", { name: "Alarm settings" });
    const primaryTarget = screen.getByRole("button", { name: /docs\.drifty\.so/i });
    const manualCorrectionButton = screen.getByRole("button", { name: "Not a drift" });

    expect(alarm.getAttribute("aria-modal")).toBe("true");
    expect(alarm.getAttribute("aria-labelledby")).toBe("drift-alarm-title");
    await waitFor(() => expect(document.activeElement).toBe(primaryTarget));

    settingsButton.focus();
    fireEvent.keyDown(alarm, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(manualCorrectionButton);

    fireEvent.keyDown(alarm, { key: "Tab" });
    expect(document.activeElement).toBe(settingsButton);

    fireEvent.keyDown(alarm, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "Drift detected" })).toBeNull());
    expect(document.activeElement).toBe(opener);
    expect(onAction).not.toHaveBeenCalled();
  });


  it("uses fallback context text and hour labels for long preview events", () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-no-context",
      contextLabel: "",
      driftDurationSeconds: 60 * 60,
      preservedFocusStrikeSeconds: 2 * 60 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
    });

    render(<DriftAlarm event={event} onAction={onAction} />);

    expect(screen.getByText(/drift detected/i)).toBeTruthy();
    expect(screen.getAllByText(/this drift/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 hour drift/i)).toBeTruthy();
    expect(screen.queryByText(/streak/i)).toBeNull();
  });

  it("caps custom break options at one hour and falls back when focus targets are empty", () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
    const event = buildDriftAlarmEvent({
      id: "alarm-empty-focus",
      contextLabel: "x.com",
      driftDurationSeconds: 8 * 60,
      preservedFocusStrikeSeconds: 45 * 60,
      generatedAt: "2026-05-20T13:16:00.000Z",
      breakOptions: [5, 90],
      focusTargets: [],
    });

    render(<DriftAlarm event={event} onAction={onAction} />);

    expect(screen.getByText(/no recent focus destination yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "5m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1h" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "90m" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to dashboard" }));
    expect(onAction).toHaveBeenCalledWith({ type: "return_to_focus", targetId: "dashboard" });
  });
});
