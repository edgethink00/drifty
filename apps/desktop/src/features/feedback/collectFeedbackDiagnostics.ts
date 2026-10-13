import { getNativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { toAnalyticsInstallLocation, toAnalyticsOpenAtLoginStatus } from "../../lib/analytics/startupEnvironment";
import { readSupportJournal } from "../../lib/diagnostics/supportJournal";
import { buildInterventionLedgerDebugInput } from "../companion/interventionLedger";
import { buildFeedbackDiagnostics, type FeedbackDiagnostics, type FeedbackDiagnosticsInput } from "./feedbackDiagnostics";

/** The app state a report needs; everything read from storage or native code is gathered here. */
export type FeedbackDiagnosticsAppState = Omit<FeedbackDiagnosticsInput, "native" | "recentEvents" | "interventionLedger" | "app"> & {
  readonly app: Omit<FeedbackDiagnosticsInput["app"], "installLocation" | "openAtLoginStatus">;
};

export async function collectFeedbackDiagnostics(state: FeedbackDiagnosticsAppState): Promise<FeedbackDiagnostics> {
  const startupAvailable = startupSettingsClient.isAvailable();
  const [native, installLocation, openAtLogin] = await Promise.all([
    getNativeFeedbackDiagnostics(),
    startupAvailable ? startupSettingsClient.getInstallLocation().catch(() => null) : Promise.resolve(null),
    startupAvailable ? startupSettingsClient.getOpenAtLoginStatus().catch(() => null) : Promise.resolve(null),
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
    interventionLedger: { last7Days: ledger.last7Days, last30Days: ledger.last30Days },
    recentEvents: readSupportJournal(),
  });
}
