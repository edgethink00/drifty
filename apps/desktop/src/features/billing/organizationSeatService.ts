import { supabase } from "../../lib/supabase/client";

/**
 * Releasing an organization seat is the member-side off-ramp: it is the only
 * way a member can stop occupying a paid seat, and it is what unblocks their
 * own account deletion. The seat path talks to Polar, so a reply that does not
 * definitively confirm the release must never be shown as a release. The
 * server keeps the seat in `revocation_pending` in exactly that case.
 */
export type OrganizationSeatReleaseResult =
  | { readonly outcome: "released" }
  | { readonly outcome: "pending"; readonly error: string }
  | { readonly outcome: "refused"; readonly error: string }
  | { readonly outcome: "unavailable"; readonly error: string };

/**
 * Dissolving is the owner-side off-ramp, and the owner has no other one:
 * account deletion is refused while the account still owns an Enterprise
 * organization. It cancels the subscription immediately and removes every
 * member, so an unconfirmed reply must never be shown as a completed
 * dissolution.
 */
export type OrganizationDissolveResult =
  | { readonly outcome: "dissolved" }
  | { readonly outcome: "pending"; readonly error: string }
  | { readonly outcome: "refused"; readonly error: string }
  | { readonly outcome: "unavailable"; readonly error: string };

type SeatFunctionInvokeOptions = {
  readonly body?: unknown;
  readonly timeout?: number;
};

type SeatFunctionInvoker = {
  invoke<T>(functionName: string, options?: SeatFunctionInvokeOptions): Promise<{ data: T | null; error: unknown }>;
};

export type OrganizationSeatClient = {
  readonly functions: SeatFunctionInvoker;
} | null;

type SeatReleaseResponse = {
  readonly ok?: unknown;
  readonly action?: unknown;
  readonly seatId?: unknown;
  readonly error?: unknown;
};

// The seat path spends its budget on Polar, not on the local database.
export const ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS = 30_000;

const UNAVAILABLE_ERROR = "Organization seat release is unavailable because Supabase is not configured.";
const PENDING_ERROR = "Seat release did not confirm. Refresh your plan before trying again.";
const GENERIC_ERROR = "Unable to release the organization seat.";
const DISSOLVE_UNAVAILABLE_ERROR = "Organization dissolution is unavailable because Supabase is not configured.";
const DISSOLVE_PENDING_ERROR = "Dissolution did not confirm. Refresh your plan before trying again.";
const DISSOLVE_GENERIC_ERROR = "Unable to dissolve the organization.";

export async function dissolveOwnOrganization(
  client: OrganizationSeatClient = supabase,
): Promise<OrganizationDissolveResult> {
  if (!client) return { outcome: "unavailable", error: DISSOLVE_UNAVAILABLE_ERROR };

  try {
    const { data, error } = await client.functions.invoke<SeatReleaseResponse>("manage-enterprise-seats", {
      timeout: ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS,
      body: { action: "dissolve-organization" },
    });
    if (error) return await classifyDissolveFailure(error);
    if (isRecord(data) && readNonEmptyString(data.error)) {
      return { outcome: "refused", error: readNonEmptyString(data.error) ?? DISSOLVE_GENERIC_ERROR };
    }
    // The server answers a repeat of a completed dissolution with the same
    // success envelope, so a retry after a lost reply reads as done rather
    // than as a new failure.
    if (!isRecord(data) || data.ok !== true || data.action !== "dissolve-organization") {
      return { outcome: "pending", error: DISSOLVE_PENDING_ERROR };
    }
    return { outcome: "dissolved" };
  } catch (error) {
    return {
      outcome: "unavailable",
      error: error instanceof Error && error.message ? error.message : DISSOLVE_GENERIC_ERROR,
    };
  }
}

async function classifyDissolveFailure(error: unknown): Promise<OrganizationDissolveResult> {
  const status = readResponseStatus(error);
  const body = await readFunctionErrorBody(error);
  const message = readNonEmptyString(isRecord(body) ? body.error : null);

  // 502 is the server saying the provider call or the local cleanup did not
  // settle. An unknown status is treated the same way, because the one thing
  // this must never do is claim the subscription is untouched when it may
  // already be cancelled.
  if (status === null || status === 502 || status === 504) {
    return { outcome: "pending", error: message ?? DISSOLVE_PENDING_ERROR };
  }
  if (status >= 400 && status < 500) {
    return { outcome: "refused", error: message ?? DISSOLVE_GENERIC_ERROR };
  }
  return { outcome: "unavailable", error: message ?? DISSOLVE_GENERIC_ERROR };
}

export async function releaseOwnOrganizationSeat(
  seatId: string,
  client: OrganizationSeatClient = supabase,
): Promise<OrganizationSeatReleaseResult> {
  if (!client) return { outcome: "unavailable", error: UNAVAILABLE_ERROR };
  const trimmedSeatId = seatId.trim();
  if (!trimmedSeatId) return { outcome: "refused", error: "Choose your Enterprise seat to release." };

  try {
    const { data, error } = await client.functions.invoke<SeatReleaseResponse>("manage-enterprise-seats", {
      timeout: ORGANIZATION_SEAT_RELEASE_TIMEOUT_MS,
      body: { action: "release-own-seat", seatId: trimmedSeatId },
    });
    if (error) return await classifyReleaseFailure(error);
    if (isRecord(data) && readNonEmptyString(data.error)) {
      return { outcome: "refused", error: readNonEmptyString(data.error) ?? GENERIC_ERROR };
    }
    // Anything other than the exact success envelope stays pending. A seat can
    // be locally paused while Polar reconciliation is still outstanding, and
    // reporting that as released would hide a half-finished revocation.
    if (!isRecord(data) || data.ok !== true || data.action !== "release-own-seat") {
      return { outcome: "pending", error: PENDING_ERROR };
    }
    return { outcome: "released" };
  } catch (error) {
    return {
      outcome: "unavailable",
      error: error instanceof Error && error.message ? error.message : GENERIC_ERROR,
    };
  }
}

async function classifyReleaseFailure(error: unknown): Promise<OrganizationSeatReleaseResult> {
  const status = readResponseStatus(error);
  const body = await readFunctionErrorBody(error);
  const message = readNonEmptyString(isRecord(body) ? body.error : null);

  // 502 is the server's own "the seat is not settled yet" reply. Treat an
  // unknown status the same way rather than claiming the seat is untouched.
  if (status === null || status === 502 || status === 504) {
    return { outcome: "pending", error: message ?? PENDING_ERROR };
  }
  if (status >= 400 && status < 500) {
    return { outcome: "refused", error: message ?? GENERIC_ERROR };
  }
  return { outcome: "unavailable", error: message ?? GENERIC_ERROR };
}

function readResponseStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (!isRecord(context)) return null;
  return typeof context.status === "number" && Number.isFinite(context.status) ? context.status : null;
}

async function readFunctionErrorBody(error: unknown): Promise<unknown> {
  if (!isRecord(error)) return null;
  const context = error.context;
  if (!isRecord(context) || typeof context.json !== "function") return null;
  try {
    return await (context.json as () => Promise<unknown>)();
  } catch {
    return null;
  }
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
