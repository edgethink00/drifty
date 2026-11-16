import { getNativeFeedbackDiagnostics } from "../../lib/api/feedbackDiagnosticsClient";
import { getFeedbackTrackerStatus } from "../../lib/api/trackerClient";
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
import type { TrackerStatus } from "@drifty/domain";

export type FeedbackDiagnosticsAppState = Omit<FeedbackDiagnosticsInput, "native" | "recentEvents" | "interventionLedger" | "managedLocal" | "app"> & {
  readonly app: Omit<FeedbackDiagnosticsInput["app"], "installLocation" | "openAtLoginStatus">;
  readonly screenContextClient?: ScreenContextClient;
  readonly memoryAvailable?: boolean;
};
export const FEEDBACK_PROBE_TIMEOUT_MS = 1_200;
// Leave native Windows cold-start allowance plus IPC/cleanup margin, within
// the feedback form's five-second collection cutoff. Other probes stay short.
const WINDOWS_TRACKER_PROBE_TIMEOUT_MS = 4_200;
let trackerStatusInFlight: Promise<TrackerStatus | null> | null = null;
/** Share a pending optional read; never reuse a settled observation as fresh. */
function readTrackerStatus(): Promise<TrackerStatus | null> {
  if (trackerStatusInFlight) return trackerStatusInFlight;
  const request = Promise.resolve().then(() => getFeedbackTrackerStatus()).then(status =>
    status?.trackerMode === "unavailable" && status.statusIssue !== "databaseUnavailable" ? null : status);
  trackerStatusInFlight = request;
  const release = () => { if (trackerStatusInFlight === request) trackerStatusInFlight = null; };
  void request.then(release, release);
  return request;
}
type Probe<T> = { readonly value: T | null; readonly status: "collected" | "unavailable" | "failed" | "timeout" | "unsupported" };
/** Lazy callbacks also isolate synchronous failures. Each optional read has its
 * own budget, so a stuck IPC never discards the already available app state. */
export async function feedbackProbe<T>(read: (() => Promise<T | null>) | null, timeoutMs = FEEDBACK_PROBE_TIMEOUT_MS): Promise<Probe<T>> {
  if (!read) return { value: null, status: "unsupported" };
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve({ value: null, status: "timeout" }), timeoutMs);
    Promise.resolve().then(read).then(value => {
      clearTimeout(timer); resolve({ value, status: value === null ? "unavailable" : "collected" });
    }, error => {
      clearTimeout(timer);
      resolve({ value: null, status: error === "feedback_tracker_status_timeout" ? "timeout" : "failed" });
    });
  });
}
async function readBound<T>(client: ScreenContextClient, command: string, decode: (raw: unknown) => T): Promise<T | null> {
  const generation = client.getSnapshot().generation;
  let result: T | null = null;
  await client.consume(command, {}, decode, value => { result = value; });
  return client.isCurrent(generation) ? result : null;
}
export async function collectFeedbackDiagnostics(state: FeedbackDiagnosticsAppState): Promise<FeedbackDiagnostics> {
  const desktopRuntime = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const startupAvailable = startupSettingsClient.isAvailable();
  // Only query through an already available account-bound client.
  const client = state.screenContextClient;
  const ready = client?.isDesktop() && client.getSnapshot().connection === "ready";
  const [tracker, native, installLocation, openAtLogin, managedLocal, screen, memory] = await Promise.all([
    feedbackProbe(desktopRuntime ? readTrackerStatus : null,
      state.app.platform === "windows" ? WINDOWS_TRACKER_PROBE_TIMEOUT_MS : FEEDBACK_PROBE_TIMEOUT_MS),
    feedbackProbe(desktopRuntime ? () => getNativeFeedbackDiagnostics() : null),
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
    app: { ...state.app, runtime: desktopRuntime ? "desktop" : "browser",
      installLocation: startupAvailable ? toAnalyticsInstallLocation(installLocation.value) : null,
      openAtLoginStatus: startupAvailable ? toAnalyticsOpenAtLoginStatus(openAtLogin.value?.status ?? null) : null },
    tracker: { ...state.tracker, status: tracker.value, cachedStatus: state.tracker?.status ?? null,
      statusSource: !desktopRuntime ? "unsupported" : tracker.status === "collected" ? "fresh" : "unavailable",
      accessibilityGranted: tracker.value?.accessibilityGranted ?? false },
    native: native.value, managedLocal: managedLocal.value,
    collection: { tracker: tracker.status, native: native.status, installLocation: installLocation.status, openAtLogin: openAtLogin.status,
      managedLocal: managedLocal.status, screen: screen.status, memory: memory.status },
    screen: screenHealth(screen.value, now), memory: memoryHealth(memory.value, now),
    operations: readSupportOperations(now),
    interventionLedger: ledger ? { last7Days: ledger.last7Days, last30Days: ledger.last30Days } : null,
    recentEvents: readSupportJournal(),
  });
}
