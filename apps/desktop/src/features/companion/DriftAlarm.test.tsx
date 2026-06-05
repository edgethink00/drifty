// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DriftAlarm, buildDriftAlarmEvent, type DriftAlarmAction } from "./DriftAlarm";

describe("DriftAlarm", () => {
  it("renders preserved focus strike context, focus targets, break choices, and action callbacks", () => {
    const onAction = vi.fn<(action: DriftAlarmAction) => void>();
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
      ],
    });

    const { container } = render(<DriftAlarm event={event} onAction={onAction} />);

    const alarm = screen.getByLabelText("Drifty drift alarm");
    expect(alarm).toBeTruthy();
    expect(alarm.classList.contains("watcher-peek--drift-alarm")).toBe(true);
    expect(alarm.classList.contains("watcher-peek--top-right")).toBe(true);
    expect(screen.getByText(/your 32-minute focus flame is still alive/i)).toBeTruthy();
    expect(screen.getByText(/ember check/i)).toBeTruthy();
    expect(screen.getByText(/youtube\.com/i)).toBeTruthy();

    expect(screen.getByRole("heading", { name: /return to a warm focus trail/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /bank the ember break/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /docs\.drifty\.so/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /visual studio code/i })).toBeTruthy();
    expect(container.querySelector(".site-favicon")).toBeTruthy();
    expect(container.querySelector(".app-glyph")).toBeTruthy();
    expect(screen.getByText("VS")).toBeTruthy();
    expect(screen.getByRole("button", { name: "5m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "15m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "30m" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "1h" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /docs\.drifty\.so/i }));
    fireEvent.click(screen.getByRole("button", { name: "1h" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct timeline" }));
    fireEvent.click(screen.getByRole("button", { name: "Alarm settings" }));

    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: "return_to_focus", targetId: "site:docs.drifty.so" },
      { type: "start_break", minutes: 60 },
      { type: "manual_correction" },
      { type: "settings" },
    ]);
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

    expect(screen.getByText(/your 2-hour focus flame is still alive/i)).toBeTruthy();
    expect(screen.getByText(/this drift has been pulling heat for 1 hour/i)).toBeTruthy();
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
