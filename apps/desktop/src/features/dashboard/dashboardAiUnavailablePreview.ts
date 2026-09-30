import type { BillingEntitlement } from "../billing/billingService";
import type { DashboardAiUnavailableInput } from "./dashboardAiUnavailableState";

export type DashboardAiUnavailablePreviewCase = "trial-ended" | "cloud-billing" | "device-limit" | "connect-ai";

export type DashboardAiUnavailablePreviewOption = {
  readonly id: DashboardAiUnavailablePreviewCase;
  readonly label: string;
  readonly detail: string;
};

export type DashboardAiUnavailablePreviewState = {
  readonly caseId: DashboardAiUnavailablePreviewCase;
  readonly appliedDay: string;
};

export const DASHBOARD_AI_UNAVAILABLE_PREVIEW_OPTIONS = [
  {
    id: "trial-ended",
    label: "Trial ended",
    detail: "Cloud plan CTA and plan cards",
  },
  {
    id: "cloud-billing",
    label: "Billing issue",
    detail: "Fix billing in Polar portal",
  },
  {
    id: "device-limit",
    label: "Device limit",
    detail: "Three active desktop devices used",
  },
  {
    id: "connect-ai",
    label: "Connect AI",
    detail: "No provider connected",
  },
] as const satisfies readonly DashboardAiUnavailablePreviewOption[];

const TRIAL_EXPIRED_ENTITLEMENT = {
  plan: "individual",
  status: "locked",
  canUseApp: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  lockedReason: "trial_expired",
} as const satisfies BillingEntitlement;

const BILLING_LOCKED_ENTITLEMENT = {
  ...TRIAL_EXPIRED_ENTITLEMENT,
  lockedReason: "payment_required",
} as const satisfies BillingEntitlement;

const DEVICE_LIMIT_ENTITLEMENT = {
  ...TRIAL_EXPIRED_ENTITLEMENT,
  lockedReason: "device_limit_reached",
  deviceAccess: {
    allowed: false,
    reason: "device_limit_reached",
    message: "This Drifty Pro plan is already active on 2 desktop devices. Remove a device in Account settings to use Cloud AI here.",
    activeDeviceCount: 2,
    maxActiveDevices: 2,
    activeWindowDays: 30,
    deviceId: null,
  },
  cloudDevices: [
    {
      id: "preview-device-1",
      label: "Studio Mac",
      platform: "macos",
      appVersion: "0.9.0",
      firstSeenAt: "2026-06-01T09:00:00.000Z",
      lastSeenAt: "2026-06-26T08:30:00.000Z",
      revokedAt: null,
      isCurrent: true,
      isActive: true,
    },
    {
      id: "preview-device-2",
      label: "Travel MacBook",
      platform: "macos",
      appVersion: "0.9.0",
      firstSeenAt: "2026-06-10T09:00:00.000Z",
      lastSeenAt: "2026-06-25T17:15:00.000Z",
      revokedAt: null,
      isCurrent: false,
      isActive: true,
    },
    {
      id: "preview-device-3",
      label: "Home Mac mini",
      platform: "macos",
      appVersion: "0.9.0",
      firstSeenAt: "2026-06-15T09:00:00.000Z",
      lastSeenAt: "2026-06-24T12:00:00.000Z",
      revokedAt: null,
      isCurrent: false,
      isActive: true,
    },
  ],
} as const satisfies BillingEntitlement;

export function buildDashboardAiUnavailablePreviewInput(caseId: DashboardAiUnavailablePreviewCase): DashboardAiUnavailableInput {
  switch (caseId) {
    case "trial-ended":
      return {
        billingEntitlement: TRIAL_EXPIRED_ENTITLEMENT,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        localAiReady: false,
      };
    case "cloud-billing":
      return {
        billingEntitlement: BILLING_LOCKED_ENTITLEMENT,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        localAiReady: false,
      };
    case "device-limit":
      return {
        billingEntitlement: DEVICE_LIMIT_ENTITLEMENT,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: true,
        isSupabaseConfigured: true,
        localAiReady: false,
      };
    case "connect-ai":
      return {
        billingEntitlement: null,
        billingEntitlementError: null,
        billingEntitlementLoading: false,
        canUseCloudAiClassification: false,
        hasRequiredAccountAuth: false,
        isSupabaseConfigured: false,
        localAiReady: false,
      };
    default:
      return assertNever(caseId);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled dashboard AI preview case: ${value}`);
}
