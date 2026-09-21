// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrackerStatus } from "@drifty/domain";
import { useOnboardingPermissions } from "./useOnboardingPermissions";

afterEach(cleanup);

// Capture starts when the user grants Accessibility during onboarding. Native
// startup no longer starts the daemon on its own, so this hook is the moment a
// first-ever install begins recording.
describe("useOnboardingPermissions early tracking start", () => {
  function setup(accessibilityGrantedFromApp: boolean) {
    const onEarlyTrackingStart = vi.fn();
    const view = renderHook(
      (props: { accessibilityGrantedFromApp: boolean }) => useOnboardingPermissions({
        accessibilityGrantedFromApp: props.accessibilityGrantedFromApp,
        accessibilityRequired: true,
        onCheckAccessibility: async () => props.accessibilityGrantedFromApp,
        onEarlyTrackingStart,
        onRequestAccessibility: async () => props.accessibilityGrantedFromApp,
        setSetupError: () => {},
        step: "permissions",
        trackerStatus: null as TrackerStatus | null,
      }),
      { initialProps: { accessibilityGrantedFromApp } },
    );
    return { onEarlyTrackingStart, view };
  }

  it("starts tracking when Accessibility is granted during onboarding", () => {
    const { onEarlyTrackingStart, view } = setup(false);
    expect(onEarlyTrackingStart).not.toHaveBeenCalled();

    view.rerender({ accessibilityGrantedFromApp: true });
    expect(onEarlyTrackingStart).toHaveBeenCalledTimes(1);
  });

  it("does not start tracking before the grant", () => {
    const { onEarlyTrackingStart, view } = setup(false);
    view.rerender({ accessibilityGrantedFromApp: false });
    expect(onEarlyTrackingStart).not.toHaveBeenCalled();
  });

  it("starts only once across later re-renders", () => {
    const { onEarlyTrackingStart, view } = setup(false);
    view.rerender({ accessibilityGrantedFromApp: true });
    view.rerender({ accessibilityGrantedFromApp: true });
    view.rerender({ accessibilityGrantedFromApp: true });
    expect(onEarlyTrackingStart).toHaveBeenCalledTimes(1);
  });

  it("does not start for an install that already granted Accessibility", () => {
    // An existing install arrives already granted; its activation was migrated
    // natively, so onboarding must not treat that as a fresh start signal.
    const { onEarlyTrackingStart } = setup(true);
    expect(onEarlyTrackingStart).not.toHaveBeenCalled();
  });
});
