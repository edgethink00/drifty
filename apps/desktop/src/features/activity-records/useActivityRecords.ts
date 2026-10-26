import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { trackerClient } from "../../lib/api/trackerClient";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import {
  createProductAnalyticsDeliveryGuard,
  PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT,
  readProductAnalyticsEnabled,
} from "../../lib/analytics/productAnalyticsPreference";
import { readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import {
  ACTIVITY_RECORDS_ACCOUNT_KEY,
  ACTIVITY_RECORDS_SINCE_KEY,
  CLEARED_ACTIVITY_RECORDS_STATE,
  runActivityRecordCycle,
} from "./activityRecordEngine";
import { sendActivityRecords } from "./activityRecordApi";

export const ACTIVITY_RECORDS_FIRST_DELAY_MS = 90 * 1000;
export const ACTIVITY_RECORDS_INTERVAL_MS = 15 * 60 * 1000;

/** null while sign-in is still being restored; "none" once there is no full account. */
export type ActivityRecordsAccount = string | "none" | null;

export type ActivityRecordsGate = "run" | "stop" | "wait";

/**
 * Activity records (product decision 2026-10-26) run only while all three
 * hold: a signed-in full account, the Drifty Cloud AI connection chosen and
 * product analytics on. Any of them ending stops sending and forgets where the
 * computer was, so activity from a time they did not all hold is never sent
 * later. Sign-in still being restored is neither: nothing runs or resets.
 */
export function activityRecordsGate(input: {
  readonly account: ActivityRecordsAccount;
  readonly cloudConnectionChosen: boolean;
  readonly analyticsEnabled: boolean;
}): ActivityRecordsGate {
  if (!input.analyticsEnabled || !input.cloudConnectionChosen || input.account === "none") return "stop";
  return input.account === null ? "wait" : "run";
}

function isDesktopApp(): boolean {
  try {
    return isTauri() && !shouldUsePreviewData();
  } catch {
    return false;
  }
}

/** Forgets where this computer was, so the next start begins from that moment. */
async function forgetActivityRecordsPlace(): Promise<void> {
  const snapshot = await trackerClient.getSyncState();
  if (!snapshot.state[ACTIVITY_RECORDS_ACCOUNT_KEY] && !snapshot.state[ACTIVITY_RECORDS_SINCE_KEY]) return;
  await trackerClient.setSyncState(CLEARED_ACTIVITY_RECORDS_STATE);
}

export function useActivityRecords({
  account,
  cloudConnectionChosen,
}: {
  readonly account: ActivityRecordsAccount;
  readonly cloudConnectionChosen: boolean;
}): void {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(readProductAnalyticsEnabled);
  const runningRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    const refresh = () => setAnalyticsEnabled(readProductAnalyticsEnabled());
    window.addEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PRODUCT_ANALYTICS_PREFERENCE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const gate = activityRecordsGate({ account, cloudConnectionChosen, analyticsEnabled });
  const accountId = gate === "run" ? account : null;

  useEffect(() => {
    if (gate === "wait" || !isDesktopApp()) return undefined;
    if (gate === "stop" || !accountId) {
      void forgetActivityRecordsPlace().catch((error: unknown) => {
        console.warn("Activity records could not reset", error);
      });
      return undefined;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const runOnce = async () => {
      if (runningRef.current) return;
      // Revoked the moment product analytics is turned off, even mid-cycle.
      const analyticsGuard = createProductAnalyticsDeliveryGuard();
      const cycle = runActivityRecordCycle({
        tracker: trackerClient,
        accountId,
        send: (batch) => sendActivityRecords(accountId, batch),
        privacySettings: readAiPrivacyRequestSettings,
        isAllowed: () => !cancelled && analyticsGuard(),
      }).then(
        () => undefined,
        (error: unknown) => { console.warn("Activity records cycle failed", error); },
      );
      runningRef.current = cycle;
      try {
        await cycle;
      } finally {
        runningRef.current = null;
      }
    };
    const schedule = (delay: number) => {
      timer = setTimeout(() => {
        void runOnce().finally(() => {
          if (!cancelled) schedule(ACTIVITY_RECORDS_INTERVAL_MS);
        });
      }, delay);
    };
    schedule(ACTIVITY_RECORDS_FIRST_DELAY_MS);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accountId, gate]);
}
