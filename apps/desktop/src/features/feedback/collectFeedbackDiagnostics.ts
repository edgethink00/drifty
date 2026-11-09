import { getNativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
import { startupSettingsClient } from "../../lib/api/startupSettingsClient";
import { toAnalyticsInstallLocation, toAnalyticsOpenAtLoginStatus } from "../../lib/analytics/startupEnvironment";
import { readSupportJournal } from "../../lib/diagnostics/supportJournal";
import { readSupportOperations } from "../../lib/diagnostics/supportOperations";
import { buildInterventionLedgerDebugInput } from "../companion/interventionLedger";
import { getManagedLocalAiStatus } from "../settings/managedLocalAiClient";
import type { ScreenContextClient } from "../screen-context/screenContextClient";
import { decodeScreenStatus } from "../screen-context/screenContextWire";
import { decodeMemoryStatus } from "../screen-context/memoryWire";
import { screenHealth, memoryHealth } from "./feedbackFeatureHealth";
import { buildFeedbackDiagnostics, type FeedbackDiagnostics, type FeedbackDiagnosticsInput } from "./feedbackDiagnostics";

export type FeedbackDiagnosticsAppState = Omit<FeedbackDiagnosticsInput, "native" | "recentEvents" | "interventionLedger" | "managedLocal" | "app"> & {
  readonly app: Omit<FeedbackDiagnosticsInput["app"], "installLocation" | "openAtLoginStatus">;
  readonly screenContextClient?: ScreenContextClient;
  readonly memoryAvailable?: boolean;
};
export const FEEDBACK_PROBE_TIMEOUT_MS = 1_200;
type Probe<T> = { readonly value: T | null; readonly status: "collected" | "unavailable" | "failed" | "timeout" | "unsupported" };
/** Lazy callbacks also isolate synchronous failures. Each optional read has its
 * own budget, so a stuck IPC never discards the already available app state. */
export async function feedbackProbe<T>(read: (() => Promise<T | null>) | null): Promise<Probe<T>> {
  if (!read) return { value: null, status: "unsupported" };
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ value: null, status: "timeout" }), FEEDBACK_PROBE_TIMEOUT_MS);
    Promise.resolve().then(read).then(value => {
      clearTimeout(timer); resolve({ value, status: value === null ? "unavailable" : "collected" });
    }, () => { clearTimeout(timer); resolve({ value: null, status: "failed" }); });
  });
}
async function readBound<T>(client: ScreenContextClient, command: string, decode: (raw: unknown) => T): Promise<T | null> {
  const generation = client.getSnapshot().generation;
  let result: T | null = null;
  await client.consume(command, {}, decode, value => { result = value; });
  return client.isCurrent(generation) ? result : null;
}
export async function collectFeedbackDiagnostics(state: FeedbackDiagnosticsAppState): Promise<FeedbackDiagnostics> {
  const startupAvailable = startupSettingsClient.isAvailable();
  // Only query through an already available account-bound client.
  const client = state.screenContextClient;
  const ready = client?.isDesktop() && client.getSnapshot().connection === "ready";
  const [native, installLocation, openAtLogin, managedLocal, screen, memory] = await Promise.all([
    feedbackProbe(() => getNativeFeedbackDiagnostics()),
    feedbackProbe(startupAvailable ? () => startupSettingsClient.getInstallLocation() : null),
    feedbackProbe(startupAvailable ? () => startupSettingsClient.getOpenAtLoginStatus() : null),
    feedbackProbe(state.aiSetup?.provider === "managed_local" ? () => getManagedLocalAiStatus() : null),
    feedbackProbe(ready && client ? () => readBound(client, "screen_context_get_status", decodeScreenStatus) : null),
    feedbackProbe(ready && client && state.memoryAvailable ? () => readBound(client, "memory_get_status", decodeMemoryStatus) : null),
  ]);
  let ledger: ReturnType<typeof buildInterventionLedgerDebugInput> | null = null;
  try { ledger = buildInterventionLedgerDebugInput(); } catch { /* Keep the report. */ }
  const now = (state.now ?? new Date()).getTime();
  return buildFeedbackDiagnostics({
    ...state,
    app: { ...state.app,
      installLocation: startupAvailable ? toAnalyticsInstallLocation(installLocation.value) : null,
      openAtLoginStatus: startupAvailable ? toAnalyticsOpenAtLoginStatus(openAtLogin.value?.status ?? null) : null },
    native: native.value, managedLocal: managedLocal.value,
    collection: { native: native.status, installLocation: installLocation.status, openAtLogin: openAtLogin.status,
      managedLocal: managedLocal.status, screen: screen.status, memory: memory.status },
    screen: screenHealth(screen.value, now), memory: memoryHealth(memory.value, now),
    operations: readSupportOperations(now),
    interventionLedger: ledger ? { last7Days: ledger.last7Days, last30Days: ledger.last30Days } : null,
    recentEvents: readSupportJournal(),
  });
}
