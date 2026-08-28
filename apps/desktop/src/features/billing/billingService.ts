import { supabase } from "../../lib/supabase/client";
import { withCloudDevicePayload } from "../cloud-devices/cloudDeviceIdentity";
import type { CloudDeviceAccess, CloudDeviceRecord } from "../cloud-devices/cloudDeviceService";

export type BillingEntitlement = {
  plan: "individual";
  status: "trialing" | "active" | "locked";
  canUseApp: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  accessSource?: "standard_trial" | "promotion" | "subscription";
  lockedReason?: "trial_expired" | "payment_required" | "billing_missing" | "device_limit_reached";
  deviceAccess?: CloudDeviceAccess;
  cloudDevices?: readonly CloudDeviceRecord[];
};

export type BillingResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type CouponRedemption = {
  readonly status: "redeemed" | "already_redeemed";
  readonly grantedDays: number;
  readonly trialEndsAt: string;
  readonly redeemedAt: string;
};

export type CouponRedemptionFailureCode =
  | "coupon_invalid"
  | "coupon_inactive"
  | "coupon_not_started"
  | "coupon_expired"
  | "coupon_exhausted"
  | "coupon_rate_limited"
  | "coupon_already_subscribed"
  | "full_account_required"
  | "sign_in_required"
  | "coupon_unavailable";

export type CouponRedemptionResult =
  | { readonly success: true; readonly data: CouponRedemption }
  | { readonly success: false; readonly code: CouponRedemptionFailureCode; readonly error: string };

export type BillingInterval = "monthly" | "quarterly" | "yearly";

type BillingEntitlementResponse = {
  entitlement?: BillingEntitlement;
  deviceAccess?: unknown;
  cloudDevices?: unknown;
  error?: string;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
};

type BillingPortalResponse = {
  url?: string;
  customer_portal_url?: string;
  customerPortalUrl?: string;
  error?: string;
};

type CouponRedemptionResponse = {
  readonly redemption?: unknown;
  readonly code?: unknown;
  readonly error?: unknown;
};

type BillingFunctionInvokeOptions = {
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly timeout?: number;
};

type BillingFunctionInvoker = {
  invoke<T>(functionName: string, options?: BillingFunctionInvokeOptions): Promise<{ data: T | null; error: unknown }>;
};

type BillingClient = {
  readonly functions: BillingFunctionInvoker;
} | null;

const GENERIC_BILLING_ERROR = "Unable to check billing status.";
// The Edge path has independent 8-second auth and RPC budgets. Keep the
// desktop budget above their combined ceiling so a successful database commit
// is not routinely reported as a client timeout.
export const COUPON_REDEMPTION_TIMEOUT_MS = 20_000;

export async function fetchBillingEntitlement(client: BillingClient = supabase): Promise<BillingResult<BillingEntitlement>> {
  if (!client) return { success: false, error: "Billing is unavailable because Supabase is not configured." };

  try {
    const body = await withCloudDevicePayload({});
    const { data, error } = await client.functions.invoke<BillingEntitlementResponse>("get-billing-entitlement", {
      body,
    });

    if (error) return { success: false, error: await readFunctionError(error, GENERIC_BILLING_ERROR) };
    if (data?.error) return { success: false, error: data.error };
    const entitlement = enrichBillingEntitlement(data);
    if (!isBillingEntitlement(entitlement)) return { success: false, error: "Billing entitlement returned an invalid response." };

    return { success: true, data: entitlement };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.message ? error.message : GENERIC_BILLING_ERROR };
  }
}

export async function createIndividualCheckout(
  billingInterval: BillingInterval,
  client: BillingClient = supabase,
): Promise<BillingResult<{ url: string }>> {
  if (!client) return { success: false, error: "Billing is unavailable because Supabase is not configured." };

  try {
    const { data, error } = await client.functions.invoke<CheckoutResponse>("create-polar-checkout", {
      body: { plan: "individual", billingInterval },
    });

    if (error) return { success: false, error: await readFunctionError(error, "Unable to create checkout.") };
    if (data?.error) return { success: false, error: data.error };
    if (!data?.url) return { success: false, error: "Checkout did not return a redirect URL." };

    return { success: true, data: { url: data.url } };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.message ? error.message : "Unable to create checkout." };
  }
}

export async function createBillingPortalSession(client: BillingClient = supabase): Promise<BillingResult<{ url: string }>> {
  if (!client) return { success: false, error: "Billing is unavailable because Supabase is not configured." };

  try {
    const { data, error } = await client.functions.invoke<BillingPortalResponse>("create-polar-customer-portal", {
      body: {},
    });

    if (error) return { success: false, error: await readFunctionError(error, "Unable to open billing management.") };
    if (data?.error) return { success: false, error: data.error };
    const url = readBillingPortalUrl(data);
    if (!url) return { success: false, error: "Billing management did not return a redirect URL." };

    return { success: true, data: { url } };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.message ? error.message : "Unable to open billing management." };
  }
}

export async function redeemTrialCoupon(
  code: string,
  client: BillingClient = supabase,
): Promise<CouponRedemptionResult> {
  if (!client) {
    return {
      success: false,
      code: "coupon_unavailable",
      error: "Trial code redemption is unavailable because Supabase is not configured.",
    };
  }

  try {
    const { data, error } = await invokeCouponWithTimeout(client, code);

    if (error) return readCouponFunctionFailure(error);
    if (isRecord(data) && typeof data.error === "string") {
      return {
        success: false,
        code: readCouponFailureCode(data.code),
        error: data.error,
      };
    }
    const redemption = readCouponRedemption(data?.redemption);
    return redemption
      ? { success: true, data: redemption }
      : {
        success: false,
        code: "coupon_unavailable",
        error: "Trial code redemption returned an invalid response.",
      };
  } catch (error) {
    return {
      success: false,
      code: "coupon_unavailable",
      error: error instanceof Error && error.message ? error.message : "Unable to redeem the trial code.",
    };
  }
}

async function invokeCouponWithTimeout(
  client: NonNullable<BillingClient>,
  code: string,
): Promise<{ readonly data: CouponRedemptionResponse | null; readonly error: unknown }> {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("Trial code redemption timed out."));
    }, COUPON_REDEMPTION_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      client.functions.invoke<CouponRedemptionResponse>("redeem-coupon", {
        body: { code },
        signal: controller.signal,
        timeout: COUPON_REDEMPTION_TIMEOUT_MS,
      }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

type JsonResponseLike = {
  readonly json: () => Promise<unknown>;
};

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  const body = await readFunctionErrorBody(error);
  return readErrorMessage(body) ?? fallback;
}

async function readCouponFunctionFailure(error: unknown): Promise<CouponRedemptionResult> {
  const body = await readFunctionErrorBody(error);
  return {
    success: false,
    code: isRecord(body) ? readCouponFailureCode(body.code) : "coupon_unavailable",
    error: readErrorMessage(body) ?? "Unable to redeem the trial code.",
  };
}

async function readFunctionErrorBody(error: unknown): Promise<unknown> {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (!isJsonResponseLike(context)) return null;
  try {
    return await context.json();
  } catch {
    return null;
  }
}

function readBillingPortalUrl(data: BillingPortalResponse | null): string | null {
  return readNonEmptyString(data?.url)
    ?? readNonEmptyString(data?.customer_portal_url)
    ?? readNonEmptyString(data?.customerPortalUrl);
}

function readErrorMessage(body: unknown): string | null {
  if (!isRecord(body)) return null;
  return readNonEmptyString(body.error);
}

function readCouponFailureCode(value: unknown): CouponRedemptionFailureCode {
  switch (value) {
    case "coupon_invalid":
    case "coupon_inactive":
    case "coupon_not_started":
    case "coupon_expired":
    case "coupon_exhausted":
    case "coupon_rate_limited":
    case "coupon_already_subscribed":
    case "full_account_required":
    case "sign_in_required":
    case "coupon_unavailable":
      return value;
    default:
      return "coupon_unavailable";
  }
}

function readCouponRedemption(value: unknown): CouponRedemption | null {
  if (!isRecord(value)) return null;
  const status = value.status;
  const grantedDays = value.grantedDays;
  const trialEndsAt = value.trialEndsAt;
  const redeemedAt = value.redeemedAt;
  if ((status !== "redeemed" && status !== "already_redeemed")
    || typeof grantedDays !== "number"
    || !Number.isInteger(grantedDays)
    || grantedDays < 1
    || typeof trialEndsAt !== "string"
    || Number.isNaN(Date.parse(trialEndsAt))
    || typeof redeemedAt !== "string"
    || Number.isNaN(Date.parse(redeemedAt))) {
    return null;
  }
  return { status, grantedDays, trialEndsAt, redeemedAt };
}

function isJsonResponseLike(value: unknown): value is JsonResponseLike {
  return isRecord(value) && typeof value.json === "function";
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBillingEntitlement(value: unknown): value is BillingEntitlement {
  if (!value || typeof value !== "object") return false;
  const entitlement = value as Partial<BillingEntitlement>;
  return entitlement.plan === "individual"
    && (entitlement.status === "trialing" || entitlement.status === "active" || entitlement.status === "locked")
    && (entitlement.accessSource === undefined
      || entitlement.accessSource === "standard_trial"
      || entitlement.accessSource === "promotion"
      || entitlement.accessSource === "subscription")
    && typeof entitlement.canUseApp === "boolean";
}

function enrichBillingEntitlement(data: BillingEntitlementResponse | null | undefined): BillingEntitlement | undefined {
  const entitlement = data?.entitlement;
  if (!isBillingEntitlement(entitlement)) return entitlement;
  return {
    ...entitlement,
    ...(isCloudDeviceAccess(data?.deviceAccess) ? { deviceAccess: data.deviceAccess } : {}),
    ...(Array.isArray(data?.cloudDevices) ? { cloudDevices: data.cloudDevices.flatMap(toCloudDeviceRecord) } : {}),
  };
}

function isCloudDeviceAccess(value: unknown): value is CloudDeviceAccess {
  if (!isRecord(value)) return false;
  return typeof value.allowed === "boolean"
    && (value.reason === null || value.reason === "device_limit_reached" || value.reason === "invalid_device" || value.reason === "unavailable")
    && (value.message === null || typeof value.message === "string")
    && (value.activeDeviceCount === null || typeof value.activeDeviceCount === "number")
    && typeof value.maxActiveDevices === "number"
    && typeof value.activeWindowDays === "number"
    && (value.deviceId === null || typeof value.deviceId === "string");
}

function toCloudDeviceRecord(value: unknown): CloudDeviceRecord[] {
  if (!isRecord(value)) return [];
  if (
    typeof value.id !== "string"
    || typeof value.label !== "string"
    || typeof value.platform !== "string"
    || typeof value.firstSeenAt !== "string"
    || typeof value.lastSeenAt !== "string"
    || typeof value.isCurrent !== "boolean"
    || typeof value.isActive !== "boolean"
  ) {
    return [];
  }
  return [{
    id: value.id,
    label: value.label,
    platform: value.platform,
    appVersion: typeof value.appVersion === "string" ? value.appVersion : null,
    firstSeenAt: value.firstSeenAt,
    lastSeenAt: value.lastSeenAt,
    revokedAt: typeof value.revokedAt === "string" ? value.revokedAt : null,
    isCurrent: value.isCurrent,
    isActive: value.isActive,
  }];
}
