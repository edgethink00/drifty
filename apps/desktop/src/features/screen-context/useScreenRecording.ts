import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import type { ScreenCapturePreferences, ScreenContextStatus } from "@drifty/domain";
import type { ScreenContextClient } from "./screenContextClient";
import { decodeScreenStatus } from "./screenContextWire";
import { markScreenTextNoticed } from "./screenTextUse";

import { screenRecordingAvailable, screenRecordingUsed } from "./screenRecordingSignals";

export { useScreenRecordingAvailable, useScreenRecordingUsed } from "./screenRecordingSignals";

type Bound<T> = { readonly generation: number; readonly value: T };
export const EMPTY_SCREEN_PREFERENCES: ScreenCapturePreferences = { enabled: false, replayEnabled: false, visibleTextEnabled: false,
  ocrEnabled: false, allowedApps: [], intervalSeconds: 10 };
export type ScreenRecordingPhase = "checking" | "unavailable" | "off" | "trackingPaused" | "paused" | "permission"
  | "storage" | "stopped" | "retrying" | "recording" | "waiting";

export function screenRecordingPhase(current: ScreenContextStatus | null): ScreenRecordingPhase {
  if (!current) return "checking";
  if (!current.helperInstalled) return "unavailable";
  if (!current.preferences.enabled) return "off";
  if (current.globalPaused) return "trackingPaused";
  if (current.paused) return "paused";
  if (current.lastFailure === "permission" || current.lastFailure === "accessibility_permission") return "permission";
  if (current.lastFailure === "capture_retrying") return "retrying";
  if (current.lastFailure === "capture_stopped") return "stopped";
  if (current.lastFailure === "storage") return "storage";
  if (!current.captureEnabled) return "stopped";
  if (current.lastFailure === "excluded" || !current.lastAcceptedAtMs) return "waiting";
  return "recording";
}
/** Recording has never been set up, so there is nothing saved to show or delete. */
export function screenRecordingPristine(value: ScreenCapturePreferences): boolean {
  return !value.replayEnabled && !value.visibleTextEnabled && !value.ocrEnabled && value.allowedApps.length === 0;
}
/** Turning it on saves the screen image and its text for every supported app. */
export function withScreenRecordingDefaults(value: ScreenCapturePreferences, status: ScreenContextStatus): ScreenCapturePreferences {
  if (status.generalCaptureSupported) {
    const pristine = !value.replayEnabled && !value.visibleTextEnabled && !value.ocrEnabled;
    return { ...value, scope: "active_display_scene", allowedApps: [], visibleTextEnabled: false,
      replayEnabled: pristine || value.replayEnabled, ocrEnabled: pristine || value.ocrEnabled || value.visibleTextEnabled };
  }
  const sources = value.replayEnabled || value.visibleTextEnabled || value.ocrEnabled ? {} : { replayEnabled: true, visibleTextEnabled: true };
  const apps = value.allowedApps.length > 0 ? {} : { allowedApps: status.supportedApps.filter((app) => ["textedit", "preview", "notepad"].includes(app.id)).map((app) => app.id) };
  return { ...value, ...sources, ...apps };
}
export function isMacScreenRecording(status: ScreenContextStatus | null): boolean {
  return Boolean(status?.supportedApps.some((app) => app.id === "textedit" || app.id === "preview"));
}
/** Browsers save a screen only on automatic memory's chosen work sites, never their whole history. */
export const BROWSER_APP_IDS: readonly string[] = ["aside", "chrome"];
/** Apps whose every visible window can be saved for replay; browsers are described in Memory instead. */
export function replayAppNames(status: ScreenContextStatus): string {
  return status.supportedApps.filter((app) => !BROWSER_APP_IDS.includes(app.id)).map((app) => app.name).join(" · ");
}

/**
 * Set when someone presses Drifty's own Allow for Screen Recording on this
 * computer. macOS answers that press in System Settings and may relaunch
 * Drifty, so startup only turns recording on after such a press. A grant that
 * predates it (an update from a version without recording, or a permission
 * given for another reason) leaves recording off until the person chooses it.
 */
const SCREEN_RECORDING_REQUESTED_KEY = "drifty.screenRecording.requested";
export function screenRecordingRequested(): boolean {
  try { return window.localStorage.getItem(SCREEN_RECORDING_REQUESTED_KEY) === "1"; } catch { return false; }
}
function rememberScreenRecordingRequest(requested: boolean): void {
  try {
    if (requested) window.localStorage.setItem(SCREEN_RECORDING_REQUESTED_KEY, "1");
    else window.localStorage.removeItem(SCREEN_RECORDING_REQUESTED_KEY);
  } catch { /* Without storage a later grant simply leaves recording off. */ }
}

const pendingPermissionRequests = new WeakMap<ScreenContextClient, Promise<boolean>>();

/** Asks macOS once when two surfaces share the same in-flight request. */
export function requestScreenRecordingPermission(client: ScreenContextClient): Promise<boolean> {
  const pending = pendingPermissionRequests.get(client);
  if (pending) return pending;
  const request = askForScreenRecordingPermission(client).finally(() => pendingPermissionRequests.delete(client));
  pendingPermissionRequests.set(client, request);
  return request;
}

async function askForScreenRecordingPermission(client: ScreenContextClient): Promise<boolean> {
  let granted = false;
  rememberScreenRecordingRequest(true);
  await client.mutate("screen_context_request_permission", { permission: "screenRecording" }, (raw) => {
    if (!raw || typeof raw !== "object" || !("granted" in raw) || typeof raw.granted !== "boolean") throw new Error("screen_context_invalid_response");
    return raw.granted;
  }, (value) => { granted = value; });
  return granted;
}

/** Uses the current preferences when reconnecting a recording that is on. */
export async function turnOnScreenRecording(client: ScreenContextClient, reconnect = false): Promise<void> {
  const current = await new Promise<ScreenContextStatus | null>((resolve, reject) => {
    void client.consume("screen_context_get_status", {}, decodeScreenStatus, (value) => resolve(value)).catch(reject);
  });
  if (!current || !current.helperInstalled || (current.preferences.enabled && !reconnect)) return;
  // Recording's own description says its text also helps classify activities.
  markScreenTextNoticed();
  const preferences = current.preferences.enabled ? current.preferences : withScreenRecordingDefaults(current.preferences, current);
  await client.mutate("screen_context_configure", { preferences: { ...preferences, enabled: true }, resume: true },
    decodeScreenStatus, () => {});
  screenRecordingUsed.set(true);
  rememberScreenRecordingRequest(false);
}

/**
 * The choice made during onboarding is saved once tracking has started, because
 * recording attaches screens to the activity being tracked. Startup can take a
 * moment, so a not-ready tracker is retried briefly.
 */
export async function turnOnScreenRecordingAfterTrackingStarts(client: ScreenContextClient, attempts = 5, delayMs = 1_500): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try { await turnOnScreenRecording(client); return; }
    catch (failure) {
      const notReady = failure instanceof Error && failure.message === "screen_context_tracker_not_ready";
      if (!notReady || attempt >= attempts) return;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

/**
 * App-wide. Learns whether recording was ever used on this computer, and on
 * macOS turns it on once tracking runs when the person pressed Drifty's Allow,
 * finished the grant outside that button (in System Settings, or the grant
 * after which macOS relaunches Drifty) and recording was never turned on
 * before. A grant without that press (an update) leaves it off, and someone who
 * turned it on and later off is never restarted.
 */
export function useScreenRecordingStartup(client: ScreenContextClient, { mac, trackingRunning }: { readonly mac: boolean; readonly trackingRunning: boolean }) {
  useEffect(() => {
    if (!client.isDesktop()) return;
    void client.wasConfigured().then((used) => { if (used) screenRecordingUsed.set(true); }).catch(() => undefined);
  }, [client]);
  useEffect(() => {
    if (!client.isDesktop() || !mac || !trackingRunning) return;
    let active = true; let checking = false;
    const check = async () => {
      if (checking || !screenRecordingRequested()) return;
      checking = true;
      try {
        if (await client.wasConfigured()) {
          if (active) rememberScreenRecordingRequest(false);
          return;
        }
        if (!active || !(await client.screenRecordingPermitted())) return;
        if (active && screenRecordingRequested()) await turnOnScreenRecordingAfterTrackingStarts(client);
      } catch { /* Checked again the next time the window gains focus. */ }
      finally { checking = false; }
    };
    void check();
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; window.removeEventListener("focus", onFocus); };
  }, [client, mac, trackingRunning]);
}

/** Status polling and the native actions shared by Settings and onboarding. */
export function useScreenRecording(client: ScreenContextClient) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const [status, setStatus] = useState<Bound<ScreenContextStatus> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = status && client.canDisplay(status.generation) ? status.value : null;
  useLayoutEffect(() => { setStatus(null); }, [snapshot.generation]);
  useEffect(() => {
    if (busy || !client.isDesktop()) return;
    let active = true; let inFlight = false;
    const refresh = async () => {
      if (inFlight) return; inFlight = true;
      try {
        await client.consume("screen_context_get_status", {}, decodeScreenStatus, (value, generation) => {
          screenRecordingAvailable.set(value.helperInstalled);
          if (value.preferences.enabled || !screenRecordingPristine(value.preferences)) screenRecordingUsed.set(true);
          if (active) { setStatus({ value, generation }); setError((old) => old === "unavailable" ? null : old); }
        });
      } catch { if (active) setError("unavailable"); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2_000);
    return () => { active = false; clearInterval(timer); };
  }, [client, busy, snapshot.generation]);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await work(); }
    catch (failure) {
      // A policy or account change cancels the old capability; its content is already cleared.
      if (!(failure instanceof Error && failure.message === "screen_context_account_changed")) setError(failure instanceof Error ? failure.message : "unavailable");
    }
    finally { setBusy(false); }
  };
  const configure = (next: ScreenCapturePreferences, resume = false) => run(async () => {
    if (next.enabled) markScreenTextNoticed();
    await client.mutate("screen_context_configure", { preferences: next, resume }, decodeScreenStatus, (value, generation) => setStatus({ value, generation }));
  });
  const acknowledgeScope = () => run(async () => {
    await client.consume("screen_context_acknowledge_scope", {}, decodeScreenStatus, (value, generation) => setStatus({ value, generation }));
  });
  return { snapshot, current, busy, error, setError, run, configure, acknowledgeScope };
}
