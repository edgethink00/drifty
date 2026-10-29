import { getNativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { toAnalyticsInstallLocation, toAnalyticsOpenAtLoginStatus } from "../../lib/analytics/startupEnvironment";
import { readSupportJournal } from "../../lib/diagnostics/supportJournal";
import { buildInterventionLedgerDebugInput } from "../companion/interventionLedger";
import { getManagedLocalAiStatus, type ManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import { buildFeedbackDiagnostics, type FeedbackDiagnostics, type FeedbackDiagnosticsInput } from "./feedbackDiagnostics";

/** The app state a report needs; everything read from storage or native code is gathered here. */
export type FeedbackDiagnosticsAppState = Omit<FeedbackDiagnosticsInput, "native" | "recentEvents" | "interventionLedger" | "managedLocal" | "app"> & {
  readonly app: Omit<FeedbackDiagnosticsInput["app"], "installLocation" | "openAtLoginStatus">;
};

/** A status file read; a slow disk must not hold up the report. */
const MANAGED_STATUS_TIMEOUT_MS = 1_500;

export async function collectFeedbackDiagnostics(state: FeedbackDiagnosticsAppState): Promise<FeedbackDiagnostics> {
  const startupAvailable = startupSettingsClient.isAvailable();
  const [native, installLocation, openAtLogin, managedLocal] = await Promise.all([
    getNativeFeedbackDiagnostics(),
    startupAvailable ? startupSettingsClient.getInstallLocation().catch(() => null) : Promise.resolve(null),
    startupAvailable ? startupSettingsClient.getOpenAtLoginStatus().catch(() => null) : Promise.resolve(null),
    state.aiSetup?.provider === "managed_local" ? readManagedLocalStatus() : Promise.resolve(null),
  ]);
  const ledger = buildInterventionLedgerDebugInput();
  return buildFeedbackDiagnostics({
    ...state,
    app: {
      ...state.app,
      installLocation: startupAvailable ? toAnalyticsInstallLocation(installLocation) : null,
      openAtLoginStatus: startupAvailable ? toAnalyticsOpenAtLoginStatus(openAtLogin?.status ?? null) : null,
    },
    native,
    managedLocal,
    interventionLedger: { last7Days: ledger.last7Days, last30Days: ledger.last30Days },
    recentEvents: readSupportJournal(),
  });
}

function readManagedLocalStatus(): Promise<ManagedLocalAiStatus | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), MANAGED_STATUS_TIMEOUT_MS);
    getManagedLocalAiStatus().then(
      (status) => { clearTimeout(timer); resolve(status); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}
