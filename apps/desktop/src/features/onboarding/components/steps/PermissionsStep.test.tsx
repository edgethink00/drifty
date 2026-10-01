// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { PermissionsStep } from "./PermissionsStep";

vi.mock("../../useLiveTrackingPreview", () => ({
  useLiveTrackingPreview: () => null,
}));
afterEach(cleanup);

function permissionFlow(granted: boolean, required = true) {
  return {
    accessibilityRequired: required,
    accessibilityGranted: granted,
    notificationsReady: false,
    safariHistoryPermission: { show: false },
    handleRequestAccessibilityClick: vi.fn(),
    handleNotificationPermissionClick: vi.fn(),
  } as unknown as OnboardingFlow;
}

describe("PermissionsStep settings guidance", () => {
  it("shows the macOS path before the request and removes it when permission is confirmed", () => {
    const pending = permissionFlow(false);
    const { rerender } = render(
      <LocalizationTestProvider language="ko">
        <PermissionsStep flow={pending} />
      </LocalizationTestProvider>,
    );
    expect(
      screen.getByText(/시스템 설정 → 개인정보 보호 및 보안/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "설정에서 허용" }));
    expect(pending.handleRequestAccessibilityClick).toHaveBeenCalledOnce();
    rerender(
      <LocalizationTestProvider language="ko">
        <PermissionsStep flow={permissionFlow(true)} />
      </LocalizationTestProvider>,
    );
    expect(
      screen.queryByText(/시스템 설정 → 개인정보 보호 및 보안/),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "허용됨" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("keeps macOS instructions out of the Windows permission step", () => {
    render(
      <LocalizationTestProvider language="en">
        <PermissionsStep flow={permissionFlow(false, false)} />
      </LocalizationTestProvider>,
    );
    expect(screen.queryByText("Finish in macOS Settings")).toBeNull();
    expect(screen.getByText("Notifications")).toBeTruthy();
  });
});
