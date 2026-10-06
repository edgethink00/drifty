import { describe, expect, it } from "vitest";
import type { BillingEntitlement } from "../billing/billingService";
import { applyClassificationAvailabilityToAiStatus, resolveBuiltInHeuristicsUnavailableSince, resolveClassificationAvailability, resolveProjectAnalysisConnected, shouldRunClassificationRecoveryBatch, type ClassificationAvailabilityInput } from "./classificationAvailability";

const activeEntitlement = {
  plan: "individual",
  status: "active",
  canUseApp: true,
  trialEndsAt: null,
  currentPeriodEnd: null,
} satisfies BillingEntitlement;

function input(overrides: Partial<ClassificationAvailabilityInput> = {}): ClassificationAvailabilityInput {
  return {
    route: "cloud",
    localProviderStatus: { kind: "unconfigured" },
    localConsecutiveFailures: 0,
    localDisconnectConfirmed: false,
    cloudOnline: true,
    cloudConfigured: true,
    cloudAuthenticated: true,
    billingEntitlement: activeEntitlement,
    billingEntitlementLoading: false,
    billingEntitlementError: null,
    cloudConnectionCheck: null,
    ...overrides,
  };
}

describe("resolveClassificationAvailability", () => {
  it("keeps configured local and BYOK-style routes independent from Cloud billing", () => {
    expect(resolveClassificationAvailability(input({
      route: "local",
      localProviderStatus: { kind: "connected" },
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
    }))).toMatchObject({ state: "ready", route: "local", allowBuiltInHeuristics: true });
  });

  it("stops persistence but keeps a quiet retry after the first local failure", () => {
    expect(resolveClassificationAvailability(input({
      route: "local",
      localProviderStatus: { kind: "connected" },
      localConsecutiveFailures: 1,
    }))).toMatchObject({
      state: "retrying",
      allowAutomaticClassification: true,
      allowBuiltInHeuristics: false,
      showRecovery: false,
    });
  });

  it("surfaces a confirmed local disconnect without a billing action", () => {
    expect(resolveClassificationAvailability(input({
      route: "local",
      localProviderStatus: { kind: "failed", issueKind: "network" },
      localConsecutiveFailures: 2,
      localDisconnectConfirmed: true,
    }))).toMatchObject({
      state: "degraded",
      recoveryAction: "retry",
      issueKind: "network",
    });
  });

  it("maps an active but offline Cloud route to retrying rather than billing lock", () => {
    expect(resolveClassificationAvailability(input({ cloudOnline: false }))).toMatchObject({
      state: "retrying",
      reason: "cloud_offline",
      recoveryAction: null,
    });
  });

  it("keeps a bounded recovery probe after repeated Cloud failures", () => {
    expect(resolveClassificationAvailability(input({
      cloudConnectionCheck: { issueKind: "network", message: "offline", checkedAt: 1, consecutiveFailures: 2 },
    }))).toMatchObject({
      state: "degraded",
      allowAutomaticClassification: false,
      allowRecoveryProbe: true,
      showRecovery: true,
    });
  });

  it("surfaces a billing entitlement error only after the controller's confirmation retry", () => {
    expect(resolveClassificationAvailability(input({
      billingEntitlement: null,
      billingEntitlementError: "Network connection failed while checking billing.",
    }))).toMatchObject({
      state: "degraded",
      reason: "cloud_entitlement_unavailable",
      allowRecoveryProbe: true,
      recoveryAction: "retry",
      issueKind: "entitlement",
    });
  });

  it("locks only the selected Drifty Cloud route when the trial ends", () => {
    expect(resolveClassificationAvailability(input({
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
    }))).toMatchObject({
      state: "cloud_locked",
      reason: "cloud_trial_expired",
      allowAutomaticClassification: false,
      allowBuiltInHeuristics: false,
      recoveryAction: "upgrade",
    });
  });

  it("refreshes a stale locked plan before offering a purchase", () => {
    expect(resolveClassificationAvailability(input({
      billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
      billingEntitlementError: "failed refresh",
    }))).toMatchObject({ reason: "cloud_entitlement_unavailable", recoveryAction: "retry" });
  });

  it("keeps paid quota recovery separate from trial upgrades", () => {
    expect(resolveClassificationAvailability(input({
      cloudQuotaExceeded: true,
      cloudQuotaDaily: true,
    }))).toMatchObject({
      state: "cloud_locked",
      reason: "cloud_quota_exceeded",
      recoveryAction: "retry",
      cloudQuota: { window: "day", retryAtMs: null },
      allowAutomaticClassification: false,
    });
    expect(resolveClassificationAvailability(input({
      cloudQuotaExceeded: true,
      cloudQuotaDaily: false,
    }))).toMatchObject({
      state: "cloud_locked",
      reason: "cloud_quota_exceeded",
      recoveryAction: "retry",
    });
  });

  it.each(["minute", "hour", "day", null] as const)("does not sell another plan to Pro or Enterprise for %s quota", (window) => {
    for (const entitlementOwner of ["individual", "organization"] as const) {
      expect(resolveClassificationAvailability(input({
        billingEntitlement: { ...activeEntitlement, entitlementOwner },
        cloudQuotaExceeded: true, cloudQuotaWindow: window, cloudQuotaRetryAtMs: 1_800_000_000_000,
      }))).toMatchObject({ recoveryAction: "retry", cloudQuota: { window, retryAtMs: 1_800_000_000_000 } });
    }
  });

  it("offers Upgrade only for a verified individual trial daily quota", () => {
    const trial = { ...activeEntitlement, status: "trialing" as const };
    expect(resolveClassificationAvailability(input({ billingEntitlement: trial, cloudQuotaExceeded: true, cloudQuotaWindow: "day" })).recoveryAction).toBe("upgrade");
    for (const overrides of [
      { billingEntitlement: null }, { billingEntitlement: trial, billingEntitlementError: "failed" },
      { billingEntitlement: trial, billingEntitlementLoading: true },
      { billingEntitlement: trial, cloudQuotaWindow: "hour" as const },
    ]) {
      expect(resolveClassificationAvailability(input({ cloudQuotaExceeded: true, cloudQuotaWindow: "day", ...overrides })).recoveryAction).toBe("retry");
    }
  });

  it.each([["payment_required", "manage_billing"], ["device_limit_reached", "manage_devices"]] as const)("routes %s to account recovery", (lockedReason, recoveryAction) => {
    expect(resolveClassificationAvailability(input({ billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason } })).recoveryAction).toBe(recoveryAction);
  });

  it("waits while provider or entitlement readiness is still being checked", () => {
    expect(resolveClassificationAvailability(input({
      route: "local",
      localProviderStatus: { kind: "checking" },
    })).state).toBe("checking");
    expect(resolveClassificationAvailability(input({
      billingEntitlement: null,
      billingEntitlementLoading: true,
    })).state).toBe("checking");
  });
});

describe("resolveProjectAnalysisConnected", () => {
  const lockedCloud = resolveClassificationAvailability(input({
    billingEntitlement: { ...activeEntitlement, status: "locked", canUseApp: false, lockedReason: "trial_expired" },
  }));

  it("gates the Cloud analysis provider with the Cloud entitlement", () => {
    expect(resolveProjectAnalysisConnected({
      analysisConnected: true,
      analysisProvider: "cloud",
      cloudAvailability: lockedCloud,
      gateEnabled: true,
    })).toBe(false);
  });

  it("keeps direct analysis providers independent from Cloud billing", () => {
    expect(resolveProjectAnalysisConnected({
      analysisConnected: true,
      analysisProvider: "self_hosted",
      cloudAvailability: lockedCloud,
      gateEnabled: true,
    })).toBe(true);
  });

  it("restores the legacy behavior when the rollout gate is disabled", () => {
    expect(resolveProjectAnalysisConnected({
      analysisConnected: true,
      analysisProvider: "cloud",
      cloudAvailability: lockedCloud,
      gateEnabled: false,
    })).toBe(true);
  });
});

describe("applyClassificationAvailabilityToAiStatus", () => {
  it("does not present a retrying provider as connected", () => {
    const retrying = resolveClassificationAvailability(input({
      route: "local",
      localProviderStatus: { kind: "connected" },
      localConsecutiveFailures: 1,
    }));
    const status = applyClassificationAvailabilityToAiStatus({
      tone: "ok",
      label: "Connected",
      providerLabel: "Local AI",
      memoryLabel: null,
      issueKind: null,
    }, retrying);

    expect(status).toMatchObject({ tone: "neutral", label: "Checking", issueKind: null });
  });
});

describe("resolveBuiltInHeuristicsUnavailableSince", () => {
  const now = "2026-09-04T10:00:00.000Z";

  it("starts a cutoff on a cold start that is already unavailable", () => {
    expect(resolveBuiltInHeuristicsUnavailableSince({
      gateEnabled: true,
      state: "cloud_locked",
      recoveryPending: false,
      currentValue: null,
      now,
    })).toBe(now);
  });

  it("keeps a persisted cutoff across a restart while availability is interrupted", () => {
    const persisted = "2026-09-03T08:30:00.000Z";
    expect(resolveBuiltInHeuristicsUnavailableSince({
      gateEnabled: true,
      state: "unavailable",
      recoveryPending: true,
      currentValue: persisted,
      now,
    })).toBe(persisted);
  });

  it("keeps the cutoff while recovered activity is still draining", () => {
    expect(resolveBuiltInHeuristicsUnavailableSince({
      gateEnabled: true,
      state: "ready",
      recoveryPending: true,
      currentValue: now,
      now,
    })).toBe(now);
  });

  it("does not start a cutoff during a normal startup check", () => {
    expect(resolveBuiltInHeuristicsUnavailableSince({
      gateEnabled: true,
      state: "checking",
      recoveryPending: false,
      currentValue: null,
      now,
    })).toBeNull();
  });

  it("clears the cutoff after the recovery drain completes or when the rollout gate is disabled", () => {
    expect(resolveBuiltInHeuristicsUnavailableSince({
      gateEnabled: true,
      state: "ready",
      recoveryPending: false,
      currentValue: now,
      now,
    })).toBeNull();
    expect(resolveBuiltInHeuristicsUnavailableSince({
      gateEnabled: false,
      state: "cloud_locked",
      recoveryPending: true,
      currentValue: now,
      now,
    })).toBeNull();
  });
});

describe("shouldRunClassificationRecoveryBatch", () => {
  it("runs once when an actual interruption recovers", () => {
    expect(shouldRunClassificationRecoveryBatch("retrying", "ready")).toBe(true);
    expect(shouldRunClassificationRecoveryBatch("degraded", "ready")).toBe(true);
    expect(shouldRunClassificationRecoveryBatch("unavailable", "ready")).toBe(true);
    expect(shouldRunClassificationRecoveryBatch("cloud_locked", "ready")).toBe(true);
  });

  it("does not treat normal startup checking or a stable ready state as backlog recovery", () => {
    expect(shouldRunClassificationRecoveryBatch("checking", "ready")).toBe(false);
    expect(shouldRunClassificationRecoveryBatch("ready", "ready")).toBe(false);
    expect(shouldRunClassificationRecoveryBatch("degraded", "checking")).toBe(false);
  });
});
