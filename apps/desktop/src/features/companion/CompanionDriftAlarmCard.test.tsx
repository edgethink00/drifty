// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildDriftAlarmEvent } from "./driftAlarmEvent";
import { CompanionDriftAlarmCard, toCompanionDriftAlarmMoment } from "./CompanionDriftAlarmCard";

function alarm() {
  return buildDriftAlarmEvent({
    id: "compact-drift",
    contextLabel: "youtube.com",
    driftDurationSeconds: 300,
    preservedFocusStrikeSeconds: 900,
    generatedAt: new Date().toISOString(),
    focusTargets: [{
      targetId: "app:xcode",
      label: "Xcode",
      detail: "Coding session",
      appName: "Xcode",
      bundleId: "com.apple.dt.Xcode",
      siteDomain: null,
      siteTitle: null,
      iconSrc: null,
    }],
  });
}

describe("CompanionDriftAlarmCard", () => {
  it("maps the alarm into the compact Companion decision contract", () => {
    expect(toCompanionDriftAlarmMoment(alarm())).toEqual(expect.objectContaining({
      kind: "driftAlarm",
      mode: "drift",
      returnTargetId: "app:xcode",
      returnLabel: "Return to focus",
      breakLabel: "Take a break",
      correctionLabel: "Not a drift",
    }));
  });

  it("keeps all decision actions on the compact non-modal card", () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    const { container } = render(
      <CompanionDriftAlarmCard
        event={alarm()}
        onAction={onAction}
        onDismiss={onDismiss}
        onOpenDashboard={vi.fn()}
      />,
    );

    expect(screen.getByRole("alertdialog", { name: "Let's get you back in flow." })).toBeTruthy();
    expect(container.querySelector(".drift-alarm-backdrop")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Return to focus" }));
    expect(onAction).toHaveBeenCalledWith({ type: "return_to_focus", targetId: "app:xcode" });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith("explicit");
  });

  it("keeps the copy-editor preview readable but removes its fake actions from keyboard input", () => {
    const { container } = render(
      <CompanionDriftAlarmCard
        event={alarm()}
        isPreview
        onAction={vi.fn()}
        onDismiss={vi.fn()}
        onOpenDashboard={vi.fn()}
      />,
    );

    expect(screen.getByRole("group", {
      name: "Let's get you back in flow. This seems outside your focus flow.",
    })).toBeTruthy();
    expect(container.querySelector(".pill")?.hasAttribute("inert")).toBe(true);
  });
});
