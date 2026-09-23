// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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

    expect(screen.getByText("작업 표시줄의 Drifty 아이콘에서 언제든 일시 정지할 수 있습니다.")).toBeTruthy();
    expect(screen.queryByText(/메뉴 막대/)).toBeNull();
  });

  it("keeps the menu bar note on macOS", () => {
    vi.stubEnv("VITE_DRIFTY_HOST_PLATFORM", "macos");
    render(<LocalizationTestProvider language="ko"><ReadyStep flow={cloudFlow(trialing)} /></LocalizationTestProvider>);

    expect(screen.getByText("메뉴 막대에서 언제든 Drifty를 일시 정지할 수 있습니다.")).toBeTruthy();
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
  });
});
