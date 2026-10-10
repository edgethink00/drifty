// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BillingEntitlement } from "../../../billing/billingService";
import { LocalizationTestProvider } from "../../../localization/LocalizationContext";
import type { OnboardingFlow } from "../../useOnboardingFlow";
import { ReadyStep } from "./ReadyStep";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function cloudFlow(billingEntitlement: BillingEntitlement | null): OnboardingFlow {
  return {
    setupChoice: "simple",
    accountSkippedForDev: false,
    billingEntitlement,
    isCompleting: false,
    returnToSetupChoice: vi.fn(),
    openAtLoginEnabled: false,
    setOpenAtLoginEnabled: vi.fn(),
    browserHistoryBootstrapEnabled: true,
    setBrowserHistoryBootstrapEnabled: vi.fn(),
    isUserManagedProviderSetup: false,
    isByokSetup: false,
    managedLocalReady: false,
    promotionActive: false,
    promotionEndsAt: null,
    cloudTrialStartedNotice: null,
  } as unknown as OnboardingFlow;
}

const trialing: BillingEntitlement = {
  plan: "individual", status: "trialing", canUseApp: true,
  trialEndsAt: "2026-12-15T00:00:00.000Z", currentPeriodEnd: null,
};

describe("ReadyStep", () => {
  it("points Windows users to the taskbar icon for pausing", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "windows");
    render(<LocalizationTestProvider language="ko"><ReadyStep flow={cloudFlow(trialing)} /></LocalizationTestProvider>);

    expect(screen.getByText(/작업 표시줄의 Drifty 아이콘에서 언제든 일시 정지할 수 있습니다\./)).toBeTruthy();
    expect(screen.queryByText(/메뉴 막대/)).toBeNull();
  });

  it("keeps the menu bar note on macOS", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "macos");
    render(<LocalizationTestProvider language="ko"><ReadyStep flow={cloudFlow(trialing)} /></LocalizationTestProvider>);

    expect(screen.getByText(/메뉴 막대에서 언제든 Drifty를 일시 정지할 수 있습니다\./)).toBeTruthy();
  });

  it("sums up Cloud readiness in one line with the trial state emphasized", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "macos");
    render(
      <LocalizationTestProvider language="ko">
        <ReadyStep
          flow={cloudFlow({
            plan: "individual", status: "locked", canUseApp: false, trialEndsAt: null, currentPeriodEnd: null,
            lockedReason: "billing_missing", trialActivation: { state: "available", startedAt: null, endsAt: null },
          })}
        />
      </LocalizationTestProvider>,
    );

    const line = document.querySelector(".dc-onb-ready-line");
    expect(line?.textContent).toBe("Drifty Cloud 7일 무료 체험 가능계정 연결됨추적 준비됨");
    expect(line?.querySelector("strong")?.textContent).toBe("7일 무료 체험 가능");
    expect(screen.queryByRole("status")).toBeNull();
    // The Cloud data note joins the pause note in the fine print.
    expect(screen.getByText(/최소 활동 정보를 Cloud에 전송합니다\. 메뉴 막대에서/)).toBeTruthy();
  });

  it("drops the Cloud data note and names the local model state for Local AI", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "macos");
    const flow = { ...cloudFlow(null), setupChoice: "local_ai", managedLocalReady: true } as unknown as OnboardingFlow;
    render(<LocalizationTestProvider language="ko"><ReadyStep flow={flow} /></LocalizationTestProvider>);

    expect(document.querySelector(".dc-onb-ready-line")?.textContent).toBe("로컬 모델 준비됨계정 연결됨추적 준비됨");
    expect(document.querySelector(".dc-onb-ready-line strong")).toBeNull();
    expect(screen.queryByText(/Cloud에 전송합니다/)).toBeNull();
    expect(screen.getByText(/메뉴 막대에서 언제든/)).toBeTruthy();
  });

  it("names the device limit instead of the generic Cloud notice", () => {
    render(
      <LocalizationTestProvider language="ko">
        <ReadyStep flow={cloudFlow({ ...trialing, status: "locked", canUseApp: false, lockedReason: "device_limit_reached" })} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain("Cloud 기기 한도에 도달했습니다");
    expect(screen.queryByText(/Cloud를 이용할 수 없습니다/)).toBeNull();
  });

  it("keeps the generic notice for other Cloud locks", () => {
    render(
      <LocalizationTestProvider language="ko">
        <ReadyStep flow={cloudFlow({ ...trialing, status: "locked", canUseApp: false, lockedReason: "trial_expired" })} />
      </LocalizationTestProvider>,
    );

    expect(screen.getByRole("status").textContent).toContain("Cloud를 이용할 수 없습니다");
    expect(document.querySelector(".dc-onb-ready-line strong")?.textContent).toBe("이용 불가");
  });

  it("lets a device-limited account free a Cloud device without leaving setup", async () => {
    const revokeCloudDevice = vi.fn().mockResolvedValue(undefined);
    const flow = {
      ...cloudFlow({
        ...trialing,
        status: "locked",
        canUseApp: false,
        lockedReason: "device_limit_reached",
        cloudDevices: [
          { id: "old-mac", label: "Old MacBook", platform: "macos", appVersion: "1.11.25", firstSeenAt: "2026-08-01T10:00:00.000Z", lastSeenAt: "2026-09-20T10:00:00.000Z", revokedAt: null, isActive: true, isCurrent: false },
          { id: "studio", label: "Studio iMac", platform: "macos", appVersion: null, firstSeenAt: "2026-09-01T10:00:00.000Z", lastSeenAt: "2026-10-08T10:00:00.000Z", revokedAt: null, isActive: true, isCurrent: false },
        ],
      }),
      revokeCloudDevice,
      cloudDeviceRevokingId: null,
      cloudDeviceActionError: null,
    } as unknown as OnboardingFlow;
    render(<LocalizationTestProvider language="en"><ReadyStep flow={flow} /></LocalizationTestProvider>);

    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Remove one you no longer use below");
    expect(notice.textContent).not.toContain("another device");
    expect(screen.getByRole("list", { name: "Cloud devices" }).textContent).toContain("Old MacBook");

    fireEvent.click(screen.getByRole("button", { name: "Remove: Old MacBook" }));
    // One more press confirms; the row says what removal does first.
    expect(revokeCloudDevice).not.toHaveBeenCalled();
    expect(notice.textContent).toContain("Cloud AI will stop working on that device");
    fireEvent.click(screen.getByRole("button", { name: "Remove device" }));

    await waitFor(() => expect(revokeCloudDevice).toHaveBeenCalledWith("old-mac"));
    expect(screen.getByRole("button", { name: "Choose your setup" })).toBeTruthy();
  });

  it("does not send a device-limited user to another device when the list is unavailable", () => {
    render(
      <LocalizationTestProvider language="en">
        <ReadyStep flow={cloudFlow({ ...trialing, status: "locked", canUseApp: false, lockedReason: "device_limit_reached" })} />
      </LocalizationTestProvider>,
    );

    const text = screen.getByRole("status").textContent ?? "";
    expect(text).toContain("Settings > Account");
    expect(text).not.toContain("another device");
  });
});
