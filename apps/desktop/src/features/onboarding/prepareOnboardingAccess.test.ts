import { describe, expect, it, vi } from "vitest";
import type { BillingEntitlement } from "../billing/billingService";
import { prepareOnboardingAccess } from "./prepareOnboardingAccess";

const available: BillingEntitlement = {
  plan: "individual", status: "locked", canUseApp: false,
  trialEndsAt: null, currentPeriodEnd: null, lockedReason: "billing_missing",
  trialActivation: { state: "available", startedAt: null, endsAt: null },
};
const active: BillingEntitlement = {
  plan: "individual", status: "trialing", canUseApp: true,
  trialEndsAt: "2026-09-21T01:00:00.000Z", currentPeriodEnd: null,
};
function fixture(overrides: Partial<Parameters<typeof prepareOnboardingAccess>[0]> = {}) {
  return {
    setupChoice: "simple" as const, entitlement: available,
    skipCloudAccessCheck: false, assertCurrentAccount: vi.fn(),
    startTracking: vi.fn().mockResolvedValue(undefined),
    activateCloudTrial: vi.fn().mockResolvedValue(active),
    unavailableMessage: "Choose another AI option or retry Cloud access.", ...overrides,
  };
}

describe("Cloud onboarding completion boundary", () => {
  it("starts the trial only after local tracking is ready", async () => {
    let ready!: () => void;
    const input = fixture({ startTracking: vi.fn(() => new Promise<void>((resolve) => { ready = resolve; })) });
    const completion = prepareOnboardingAccess(input);
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
    ready();
    await completion;
    expect(input.activateCloudTrial).toHaveBeenCalledTimes(1);
  });

  it.each(["local_ai", "byok", "custom_endpoint"] as const)("preserves the trial for %s", async (setupChoice) => {
    const input = fixture({ setupChoice, entitlement: null });
    await prepareOnboardingAccess(input);
    expect(input.startTracking).toHaveBeenCalledOnce();
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });

  it("does not spend the trial when tracking cannot start", async () => {
    const input = fixture({ startTracking: vi.fn().mockRejectedValue(new Error("Permissions missing")) });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow("Permissions missing");
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });

  it("does not grant after the account changes during preparation", async () => {
    let sameAccount = true;
    const input = fixture({
      startTracking: vi.fn(async () => { sameAccount = false; }),
      assertCurrentAccount: () => { if (!sameAccount) throw new Error("Account changed"); },
    });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow("Account changed");
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });

  it("aborts completion if the account changes while the grant is in flight", async () => {
    let sameAccount = true;
    const input = fixture({
      activateCloudTrial: vi.fn(async () => { sameAccount = false; return active; }),
      assertCurrentAccount: () => { if (!sameAccount) throw new Error("Account changed"); },
    });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow("Account changed");
  });

  it.each([null, { ...available, lockedReason: "device_limit_reached" }, {
    ...available, lockedReason: "trial_expired", trialActivation: undefined,
  }] as Array<BillingEntitlement | null>)("refuses unknown or blocked access", async (entitlement) => {
    const input = fixture({ entitlement });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow(input.unavailableMessage);
    expect(input.startTracking).not.toHaveBeenCalled();
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });

  it("reuses existing legacy or paid access without a new grant", async () => {
    const input = fixture({ entitlement: active });
    await prepareOnboardingAccess(input);
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });

  it("preserves the completion gate after a lost response and recovers from a later read", async () => {
    const input = fixture({ activateCloudTrial: vi.fn().mockRejectedValue(new Error("Response lost")) });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow("Response lost");
    await prepareOnboardingAccess({ ...input, entitlement: active });
    expect(input.activateCloudTrial).toHaveBeenCalledTimes(1);
  });
  it("rechecks existing access on the final click and refuses newly expired access", async () => {
    const input = fixture({ entitlement: active, refreshEntitlement: vi.fn().mockResolvedValue({
      ...available, trialActivation: { state: "started", startedAt: "2026-09-01T00:00:00Z", endsAt: "2026-09-08T00:00:00Z" }, lockedReason: "trial_expired",
    }) });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow(input.unavailableMessage);
    expect(input.startTracking).not.toHaveBeenCalled();
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });
  it("reuses a grant started on another device instead of issuing another request", async () => {
    const input = fixture({ refreshEntitlement: vi.fn().mockResolvedValue(active) });
    await prepareOnboardingAccess(input);
    expect(input.startTracking).toHaveBeenCalledOnce();
    expect(input.activateCloudTrial).not.toHaveBeenCalled();
  });
  it("fails closed if the final access refresh loses the account or connection", async () => {
    const input = fixture({ entitlement: active, refreshEntitlement: vi.fn().mockResolvedValue(null) });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow(input.unavailableMessage);
    expect(input.startTracking).not.toHaveBeenCalled();
  });

  it("names the device limit when this device is over the account's limit", async () => {
    const input = fixture({
      entitlement: active,
      deviceLimitMessage: "Remove a device you no longer use.",
      refreshEntitlement: vi.fn().mockResolvedValue({
        ...active, status: "locked", canUseApp: false, lockedReason: "device_limit_reached",
      }),
    });
    await expect(prepareOnboardingAccess(input)).rejects.toThrow("Remove a device you no longer use.");
    expect(input.startTracking).not.toHaveBeenCalled();
  });

});
