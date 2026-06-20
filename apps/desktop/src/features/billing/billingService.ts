import { supabase } from "../../lib/supabase/client";

export type BillingEntitlement = {
  plan: "individual";
  status: "trialing" | "active" | "locked";
  canUseApp: boolean;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  lockedReason?: "trial_expired" | "payment_required" | "billing_missing";
};

export type BillingResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export type BillingInterval = "monthly" | "quarterly" | "yearly";

type BillingEntitlementResponse = {
  entitlement?: BillingEntitlement;
  error?: string;
};

type CheckoutResponse = {
  url?: string;
  error?: string;
};

type BillingPortalResponse = {
  url?: string;
  customer_portal_url?: string;
  error?: string;
};

type BillingFunctionInvokeOptions = {
  readonly body?: unknown;
};

type BillingFunctionInvoker = {
  invoke<T>(functionName: string, options?: BillingFunctionInvokeOptions): Promise<{ data: T | null; error: unknown }>;
};

type BillingClient = {
  readonly functions: BillingFunctionInvoker;
} | null;

const GENERIC_BILLING_ERROR = "Unable to check billing status.";

export async function fetchBillingEntitlement(client: BillingClient = supabase): Promise<BillingResult<BillingEntitlement>> {
  if (!client) return { success: false, error: "Billing is unavailable because Supabase is not configured." };

  try {
    const { data, error } = await client.functions.invoke<BillingEntitlementResponse>("get-billing-entitlement", {
      body: {},
    });

    if (error) return { success: false, error: await readFunctionError(error, GENERIC_BILLING_ERROR) };
    if (data?.error) return { success: false, error: data.error };
    if (!isBillingEntitlement(data?.entitlement)) return { success: false, error: "Billing entitlement returned an invalid response." };

    return { success: true, data: data.entitlement };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.message ? error.message : GENERIC_BILLING_ERROR };
  }
}

export async function createIndividualCheckout(
  billingInterval: BillingInterval = "monthly",
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
    const url = data?.url ?? data?.customer_portal_url;
    if (!url) return { success: false, error: "Billing management did not return a redirect URL." };

    return { success: true, data: { url } };
  } catch (error) {
    return { success: false, error: error instanceof Error && error.message ? error.message : "Unable to open billing management." };
  }
}

async function readFunctionError(error: unknown, fallback: string): Promise<string> {
  if (!error || typeof error !== "object" || !("context" in error)) return fallback;
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return fallback;
  try {
    const body = await context.json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      return (body as { error: string }).error;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

function isBillingEntitlement(value: unknown): value is BillingEntitlement {
  if (!value || typeof value !== "object") return false;
  const entitlement = value as Partial<BillingEntitlement>;
  return entitlement.plan === "individual"
    && (entitlement.status === "trialing" || entitlement.status === "active" || entitlement.status === "locked")
    && typeof entitlement.canUseApp === "boolean";
}
