import { canStartCloudTrial } from "../billing/billingEligibility";
import type { BillingEntitlement } from "../billing/billingService";
import type { SetupChoice } from "./onboardingFlow";

/** Local readiness precedes the irreversible account grant. Retrying reuses server history. */
export async function prepareOnboardingAccess(input: {
  readonly setupChoice: SetupChoice | null;
  readonly entitlement: BillingEntitlement | null;
  readonly skipCloudAccessCheck: boolean;
  readonly assertCurrentAccount: () => void;
  readonly startTracking: () => Promise<void>;
  readonly activateCloudTrial?: () => Promise<BillingEntitlement>;
  readonly refreshEntitlement?: () => Promise<BillingEntitlement | null>;
  readonly unavailableMessage: string;
  /** Shown instead of `unavailableMessage` when this device is over the account's device limit. */
  readonly deviceLimitMessage?: string;
}): Promise<void> {
  const cloud = input.setupChoice === "simple" && !input.skipCloudAccessCheck;
  const blockedMessage = (entitlement: BillingEntitlement | null) => (
    entitlement?.lockedReason === "device_limit_reached" && input.deviceLimitMessage
      ? input.deviceLimitMessage
      : input.unavailableMessage
  );
  input.assertCurrentAccount();
  // A user may leave onboarding open past expiry or lose access on another
  // device. Decide from the final-click response before enabling Cloud.
  const entitlement = cloud && input.refreshEntitlement ? await input.refreshEntitlement() : input.entitlement;
  input.assertCurrentAccount();
  if (cloud && (!entitlement || (!entitlement.canUseApp && !canStartCloudTrial(entitlement)))) {
    throw new Error(blockedMessage(entitlement));
  }
  await input.startTracking();
  input.assertCurrentAccount();
  if (cloud && canStartCloudTrial(entitlement)) {
    if (!input.activateCloudTrial) throw new Error(input.unavailableMessage);
    const granted = await input.activateCloudTrial();
    input.assertCurrentAccount();
    if (!granted.canUseApp) throw new Error(blockedMessage(granted));
  }
}
