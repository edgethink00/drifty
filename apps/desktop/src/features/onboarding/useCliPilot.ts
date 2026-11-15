import { useEffect, useState } from "react";
import { cliPilotReviewVariant, readCliPilotAccess, rememberCliPilotAccess, requestCliPilotAssignment, type CliPilotVariant } from "./cliPilot";
import { hasCompletedUserOnboarding } from "./onboardingCompletion";
import { isWindowsHost } from "./cliInstall";

/**
 * A server failure leaves the existing onboarding intact. No local randomization.
 * Windows only restores an existing assignment: native Windows CLI connection
 * and classification are unverified, so new admission is Mac-only for now.
 */
export function useCliPilot(userId: string, accountConnected: boolean, manualReview: boolean, enroll = true) {
  const [assignment, setAssignment] = useState<{ userId: string; variant: CliPilotVariant | null } | null>(null);
  const review = cliPilotReviewVariant();
  useEffect(() => {
    if (review || manualReview || !accountConnected) return;
    const action = enroll && !hasCompletedUserOnboarding(userId) && !isWindowsHost() ? "assign" : "read";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    void requestCliPilotAssignment(controller.signal, action).then(variant => {
      if (!controller.signal.aborted) {
        rememberCliPilotAccess(userId, variant);
        setAssignment({ userId, variant });
      }
    }).catch(() => {}).finally(() => clearTimeout(timer));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [accountConnected, enroll, manualReview, review, userId]);
  return review ?? (assignment?.userId === userId ? assignment.variant : null)
    ?? (!enroll && readCliPilotAccess(userId) ? "cli" : null);
}
