import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { TrayCommandMap } from "@drifty/domain";
import type { BillingEntitlement } from "./billingService";

export type NativeTrialStatus = Readonly<TrayCommandMap["tray_update_trial_status"]["args"]>;

export function buildNativeTrialStatus(entitlement: BillingEntitlement | null, confirmed: boolean): NativeTrialStatus {
  const reset: NativeTrialStatus = { trialEndsAt: null, trialExpired: false };
  if (!confirmed || !entitlement || entitlement.entitlementOwner === "organization" || entitlement.organization) return reset;
  const expiryMs = entitlement.trialEndsAt ? Date.parse(entitlement.trialEndsAt) : NaN;
  const trialEndsAt = Number.isFinite(expiryMs) ? new Date(expiryMs).toISOString() : null;
  if (entitlement.status === "locked" && !entitlement.canUseApp && entitlement.lockedReason === "trial_expired") {
    return { trialEndsAt, trialExpired: true };
  }
  if (entitlement.status === "trialing" && entitlement.canUseApp && trialEndsAt) return { trialEndsAt, trialExpired: false };
  return reset;
}

// Preserve the existing tray safeInvoke boundary; the payload is registered
// alongside all native tray commands in the shared domain contract.
export async function safeInvokeTrialStatus(status: NativeTrialStatus): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    await invoke<void>("tray_update_trial_status", status);
  } catch (error) {
    throw new Error(`Unable to update native trial status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Serialize across controller remounts too: an old in-flight update must finish
// before a newer account/sign-out reset reaches native state.
let nativeTrialStatusQueue: Promise<void> = Promise.resolve();

export function useNativeTrialStatus(entitlement: BillingEntitlement | null, confirmed: boolean): void {
  const { trialEndsAt, trialExpired } = buildNativeTrialStatus(entitlement, confirmed);
  useEffect(() => {
    let disposed = false;
    nativeTrialStatusQueue = nativeTrialStatusQueue.catch(() => undefined).then(async () => {
      for (let attempt = 0; attempt < 3 && !disposed; attempt += 1) {
        try {
          await safeInvokeTrialStatus({ trialEndsAt, trialExpired });
          return;
        } catch {
          // Transient IPC failure must not strand the previous account's label.
          // Keep retries in the same queue; disposal skips an obsolete request.
          if (attempt < 2 && !disposed) await new Promise<void>((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
        }
      }
    }).catch(() => {
      // Native presentation failure must not change billing or local tracking.
    });
    return () => { disposed = true; };
  }, [trialEndsAt, trialExpired]);
}
