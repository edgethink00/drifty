import type { AiConnectionStatus, LocalAiProviderStatus } from "../ai-connection/AiConnectionStatusBar";
import { aiConnectionIssueKindFromMessage, type AiConnectionIssueKind, type CloudAiConnectionCheck } from "../ai-connection/aiConnectionHealth";
import type { BillingEntitlement } from "../billing/billingService";
import type { AnalysisProvider } from "../settings/analysisModelSetup";

export type ClassificationAvailabilityState =
  | "ready"
  | "checking"
  | "retrying"
  | "unavailable"
  | "degraded"
  | "cloud_locked";

export type ClassificationProviderRoute = "local" | "cloud" | "none";

export type ClassificationAvailabilityReason =
  | "ready"
  | "provider_not_configured"
  | "provider_checking"
  | "provider_retrying"
  | "provider_disconnected"
  | "cloud_not_configured"
  | "cloud_auth_required"
  | "cloud_entitlement_checking"
  | "cloud_entitlement_unavailable"
  | "cloud_offline"
  | "cloud_retrying"
  | "cloud_disconnected"
  | "cloud_trial_expired"
  | "cloud_payment_required"
  | "cloud_billing_missing"
  | "cloud_device_limit";

export type ClassificationRecoveryAction = "connect" | "retry" | "upgrade" | "choose_local" | null;

export type ClassificationAvailability = {
  readonly state: ClassificationAvailabilityState;
  readonly route: ClassificationProviderRoute;
  readonly reason: ClassificationAvailabilityReason;
  /** True for normal work and the quiet first-failure recovery probe. */
  readonly allowAutomaticClassification: boolean;
  /** A confirmed Cloud outage still needs a bounded probe to detect recovery. */
  readonly allowRecoveryProbe: boolean;
  readonly allowBuiltInHeuristics: boolean;
  readonly showRecovery: boolean;
  readonly recoveryAction: ClassificationRecoveryAction;
  readonly issueKind: AiConnectionIssueKind | null;
};

export type ClassificationAvailabilityInput = {
  readonly route: ClassificationProviderRoute;
  readonly localProviderStatus: LocalAiProviderStatus;
  readonly localConsecutiveFailures: number;
  readonly localDisconnectConfirmed: boolean;
  readonly cloudOnline: boolean;
  readonly cloudConfigured: boolean;
  readonly cloudAuthenticated: boolean;
  readonly billingEntitlement: BillingEntitlement | null;
  readonly billingEntitlementLoading: boolean;
  readonly billingEntitlementError: string | null;
  readonly cloudConnectionCheck: CloudAiConnectionCheck | null;
};

export function resolveClassificationAvailability(input: ClassificationAvailabilityInput): ClassificationAvailability {
  switch (input.route) {
    case "local":
      return resolveLocalAvailability(input);
    case "cloud":
      return resolveCloudAvailability(input);
    case "none":
      return availability("unavailable", "none", "provider_not_configured", {
        showRecovery: true,
        recoveryAction: "connect",
      });
    default:
      return assertNever(input.route);
  }
}

export function resolveProjectAnalysisConnected(input: {
  readonly analysisConnected: boolean;
  readonly analysisProvider: AnalysisProvider;
  readonly cloudAvailability: ClassificationAvailability;
  readonly gateEnabled: boolean;
}): boolean {
  if (!input.analysisConnected) return false;
  if (!input.gateEnabled || input.analysisProvider !== "cloud") return true;
  return input.cloudAvailability.state === "ready";
}

export function resolveBuiltInHeuristicsUnavailableSince(input: {
  readonly gateEnabled: boolean;
  readonly state: ClassificationAvailabilityState;
  readonly recoveryPending: boolean;
  readonly currentValue: string | null;
  readonly now: string;
}): string | null {
  if (!input.gateEnabled) return null;
  if (input.state === "ready" && !input.recoveryPending) return null;
  if (input.currentValue && Number.isFinite(new Date(input.currentValue).getTime())) return input.currentValue;
  // A normal startup briefly checks the provider before it knows whether an
  // interruption exists. Do not manufacture a recovery range for that state.
  if (input.state === "checking" || input.state === "ready") return null;
  return input.now;
}

export function shouldRunClassificationRecoveryBatch(
  previousState: ClassificationAvailabilityState,
  currentState: ClassificationAvailabilityState,
): boolean {
  if (currentState !== "ready") return false;
  return previousState === "retrying"
    || previousState === "degraded"
    || previousState === "unavailable"
    || previousState === "cloud_locked";
}

export function applyClassificationAvailabilityToAiStatus(
  status: AiConnectionStatus,
  availability: ClassificationAvailability,
): AiConnectionStatus {
  if (availability.state !== "checking" && availability.state !== "retrying") return status;
  return {
    tone: "neutral",
    label: "Checking",
    providerLabel: availability.route === "cloud" ? "Drifty Cloud" : status.providerLabel,
    memoryLabel: status.memoryLabel,
    issueKind: null,
  };
}

function resolveLocalAvailability(input: ClassificationAvailabilityInput): ClassificationAvailability {
  switch (input.localProviderStatus.kind) {
    case "connected":
      if (input.localConsecutiveFailures > 0) {
        return availability("retrying", "local", "provider_retrying", {
          allowAutomaticClassification: true,
        });
      }
      return availability("ready", "local", "ready", {
        allowAutomaticClassification: true,
        allowBuiltInHeuristics: true,
      });
    case "checking":
      return availability("checking", "local", "provider_checking");
    case "unconfigured":
      return availability("unavailable", "local", "provider_not_configured", {
        showRecovery: true,
        recoveryAction: "connect",
      });
    case "failed":
      if (!input.localDisconnectConfirmed) {
        return availability("retrying", "local", "provider_retrying", {
          allowAutomaticClassification: true,
          issueKind: input.localProviderStatus.issueKind,
        });
      }
      return availability("degraded", "local", "provider_disconnected", {
        showRecovery: true,
        recoveryAction: "retry",
        issueKind: input.localProviderStatus.issueKind,
      });
    default:
      return assertNever(input.localProviderStatus);
  }
}

function resolveCloudAvailability(input: ClassificationAvailabilityInput): ClassificationAvailability {
  if (!input.cloudConfigured) {
    return availability("unavailable", "cloud", "cloud_not_configured", {
      showRecovery: true,
      recoveryAction: "connect",
    });
  }
  if (!input.cloudAuthenticated) {
    return availability("unavailable", "cloud", "cloud_auth_required", {
      showRecovery: true,
      recoveryAction: "connect",
    });
  }
  if (input.billingEntitlement?.status === "locked") {
    return lockedCloudAvailability(input.billingEntitlement.lockedReason);
  }
  if (input.billingEntitlementLoading) {
    return availability("checking", "cloud", "cloud_entitlement_checking");
  }

  // The billing controller keeps loading=true while it silently confirms the
  // first transport failure. An exposed error therefore already represents a
  // repeated failure and should move from quiet retrying to visible recovery.
  if (input.billingEntitlementError) {
    return availability("degraded", "cloud", "cloud_disconnected", {
      allowRecoveryProbe: true,
      showRecovery: true,
      recoveryAction: "retry",
      issueKind: aiConnectionIssueKindFromMessage(input.billingEntitlementError),
    });
  }

  const cloudFailures = input.cloudConnectionCheck?.consecutiveFailures ?? 0;
  const cloudIssueKind = input.cloudConnectionCheck?.issueKind ?? null;
  if (cloudFailures >= 2) {
    return availability("degraded", "cloud", "cloud_disconnected", {
      allowRecoveryProbe: true,
      showRecovery: true,
      recoveryAction: "retry",
      issueKind: cloudIssueKind,
    });
  }
  if (!input.cloudOnline) {
    return availability("retrying", "cloud", "cloud_offline", {
      allowAutomaticClassification: true,
      issueKind: "network",
    });
  }
  if (cloudFailures > 0) {
    return availability("retrying", "cloud", "cloud_retrying", {
      allowAutomaticClassification: true,
      issueKind: cloudIssueKind,
    });
  }
  if (input.billingEntitlement?.canUseApp === true) {
    return availability("ready", "cloud", "ready", {
      allowAutomaticClassification: true,
      allowBuiltInHeuristics: true,
    });
  }
  return availability("unavailable", "cloud", "cloud_entitlement_unavailable", {
    showRecovery: true,
    recoveryAction: "choose_local",
  });
}

function lockedCloudAvailability(reason: BillingEntitlement["lockedReason"]): ClassificationAvailability {
  switch (reason) {
    case "trial_expired":
      return availability("cloud_locked", "cloud", "cloud_trial_expired", {
        showRecovery: true,
        recoveryAction: "upgrade",
      });
    case "payment_required":
      return availability("cloud_locked", "cloud", "cloud_payment_required", {
        showRecovery: true,
        recoveryAction: "upgrade",
      });
    case "device_limit_reached":
      return availability("cloud_locked", "cloud", "cloud_device_limit", {
        showRecovery: true,
        recoveryAction: "upgrade",
      });
    case "billing_missing":
    case undefined:
      return availability("cloud_locked", "cloud", "cloud_billing_missing", {
        showRecovery: true,
        recoveryAction: "upgrade",
      });
    default:
      return assertNever(reason);
  }
}

function availability(
  state: ClassificationAvailabilityState,
  route: ClassificationProviderRoute,
  reason: ClassificationAvailabilityReason,
  overrides: Partial<Omit<ClassificationAvailability, "state" | "route" | "reason">> = {},
): ClassificationAvailability {
  return {
    state,
    route,
    reason,
    allowAutomaticClassification: false,
    allowRecoveryProbe: false,
    allowBuiltInHeuristics: false,
    showRecovery: false,
    recoveryAction: null,
    issueKind: null,
    ...overrides,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled classification availability value: ${String(value)}`);
}
