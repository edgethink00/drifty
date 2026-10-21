import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { localAiSetupFingerprint } from "../ai-connection/aiConnectionHealth";
import { capturePostHogEvent, toAnalyticsErrorKind, type PostHogEventPropertiesByName } from "../../lib/analytics/posthogClient";
import { testLocalAiConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { testCloudAiConnection } from "./cloudAiConnectionTest";
import { isActiveProviderTestable } from "./aiSetupProviderSelection";
import type { LocalAiSetupState } from "./localAiSetup";

type UseAiConnectionTestRunnerOptions = {
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiConnectionTestResult: (setup: LocalAiSetupState, result: AiConnectionTestResult) => void;
  /** Defers the automatic probe, e.g. while a stored provider key is still loading. */
  readonly autoTestPaused?: boolean;
};

type AiSetupProviderAnalyticsValue = NonNullable<PostHogEventPropertiesByName["ai_setup_action"]["provider_kind"]>;
type RunAiConnectionTestOptions = {
  readonly captureAnalytics: boolean;
};

// Editing a model, URL or key field changes the fingerprint on every keystroke.
// The automatic probe waits until the edit has been still this long, so typing
// a model name sends one request instead of one per completed probe.
export const AUTO_CONNECTION_TEST_SETTLE_MS = 600;

export type UseAiConnectionTestRunnerResult = {
  readonly result: AiConnectionTestResult | null;
  readonly running: boolean;
  readonly runningFingerprint: string | null;
  readonly clearResult: () => void;
  readonly run: () => Promise<void>;
  /** Background re-test: no analytics, bypasses the once-per-fingerprint gate. */
  readonly runAuto: () => Promise<void>;
};

export function useAiConnectionTestRunner({
  localAiSetup,
  onLocalAiConnectionTestResult,
  autoTestPaused = false,
}: UseAiConnectionTestRunnerOptions): UseAiConnectionTestRunnerResult {
  const [taggedResult, setTaggedResult] = useState<{ readonly revision: number; readonly result: AiConnectionTestResult } | null>(null);
  const identity = localAiSetup.provider === "managed_local" && localAiSetup.driftyRoute === "cloud"
    ? "cloud" : `${localAiSetup.provider}:${localAiSetupFingerprint(localAiSetup) ?? "unconfigured"}`;
  const configurationRef = useRef({ identity, revision: 0 });
  if (configurationRef.current.identity !== identity) {
    configurationRef.current = { identity, revision: configurationRef.current.revision + 1 };
  }
  const revision = configurationRef.current.revision;
  const result = taggedResult?.revision === revision ? taggedResult.result : null;
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [runningFingerprint, setRunningFingerprint] = useState<string | null>(null);
  const runningRef = useRef(false);
  const latestSetupRef = useRef(localAiSetup);
  const completedAutoFingerprintRef = useRef<string | null>(null);

  latestSetupRef.current = localAiSetup;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Keep the in-flight claim across StrictMode's effect remount. A real
      // unmount stays guarded by mountedRef; the remount can finish this probe.
    };
  }, []);

  const clearResult = useCallback(() => {
    setTaggedResult(null);
  }, []);

  const runForSetup = useCallback(async (
    setupSnapshot: LocalAiSetupState,
    options: RunAiConnectionTestOptions,
  ): Promise<boolean> => {
    if (!mountedRef.current || runningRef.current) return false;
    const fingerprint = localAiSetupFingerprint(setupSnapshot);
    const snapshotRevision = configurationRef.current.revision;
    const requestId = ++requestRef.current;
    const isCurrent = () => mountedRef.current && requestId === requestRef.current
      && snapshotRevision === configurationRef.current.revision
      && isConnectionTestResultCurrent(setupSnapshot, latestSetupRef.current);
    runningRef.current = true;
    setRunning(true);
    setRunningFingerprint(fingerprint);
    setTaggedResult(null);
    try {
      const isCloudRoute = setupSnapshot.provider === "managed_local" && setupSnapshot.driftyRoute === "cloud";
      const nextResult = isCloudRoute ? await testCloudAiConnection() : await testLocalAiConnection(setupSnapshot, isCurrent);
      if (!isCurrent()) return false;
      setTaggedResult({ revision: snapshotRevision, result: nextResult });
      if (!isCloudRoute) onLocalAiConnectionTestResult(setupSnapshot, nextResult);
      if (options.captureAnalytics) {
        capturePostHogEvent("ai_setup_action", {
          action: "test_connection",
          provider_kind: toAiSetupProviderAnalytics(setupSnapshot),
          result: nextResult.kind === "success" ? "success" : "error",
          ...(nextResult.kind === "error" ? { error_kind: toAnalyticsErrorKind(nextResult.message) } : {}),
        });
      }
      return true;
    } catch {
      if (!isCurrent()) return false;
      const failure: AiConnectionTestResult = { kind: "error", issueKind: "provider", message: "Connection test failed." };
      setTaggedResult({ revision: snapshotRevision, result: failure });
      return true;
    } finally {
      if (mountedRef.current && requestId === requestRef.current) {
        runningRef.current = false;
        setRunning(false);
        setRunningFingerprint(null);
      }
    }
  }, [onLocalAiConnectionTestResult]);

  const autoFingerprint = useMemo(() => {
    if (autoTestPaused || !isActiveProviderTestable(localAiSetup)) return null;
    return localAiSetupFingerprint(localAiSetup);
  }, [autoTestPaused, localAiSetup]);
  // Probe at once for the configuration present at mount, after a provider
  // switch and when a paused probe (key still loading) is released. Only an
  // edit within the same unpaused provider waits for typing to settle.
  const autoChangeRef = useRef({ fingerprint: autoFingerprint, provider: localAiSetup.provider, paused: autoTestPaused, settle: false });
  if (autoChangeRef.current.fingerprint !== autoFingerprint) {
    const previous = autoChangeRef.current;
    autoChangeRef.current = {
      fingerprint: autoFingerprint,
      provider: localAiSetup.provider,
      paused: autoTestPaused,
      settle: previous.provider === localAiSetup.provider && !previous.paused && !autoTestPaused,
    };
  } else {
    autoChangeRef.current.provider = localAiSetup.provider;
    autoChangeRef.current.paused = autoTestPaused;
  }

  useEffect(() => {
    setTaggedResult(null);
    if (!autoFingerprint) completedAutoFingerprintRef.current = null;
  }, [autoFingerprint]);

  useEffect(() => {
    if (!autoFingerprint || running) return;
    if (completedAutoFingerprintRef.current === autoFingerprint) return;
    const start = () => {
      // Claim the fingerprint before the async run: effects can re-fire while the
      // test is still in flight, and a late `.then` would let a duplicate probe
      // start — double-counting one outage in the connection failure tally.
      completedAutoFingerprintRef.current = autoFingerprint;
      const releaseClaim = () => {
        if (completedAutoFingerprintRef.current === autoFingerprint) {
          completedAutoFingerprintRef.current = null;
        }
      };
      void runForSetup(localAiSetup, { captureAnalytics: false }).then((applied) => {
        if (!applied) releaseClaim();
      }, releaseClaim);
    };
    if (!autoChangeRef.current.settle) {
      start();
      return;
    }
    const timeoutId = window.setTimeout(start, AUTO_CONNECTION_TEST_SETTLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [autoFingerprint, localAiSetup, runForSetup, running]);

  const run = useCallback(async () => {
    await runForSetup(localAiSetup, { captureAnalytics: true });
  }, [localAiSetup, runForSetup]);

  const runAuto = useCallback(async () => {
    const setupSnapshot = latestSetupRef.current;
    if (!isActiveProviderTestable(setupSnapshot)) return;
    await runForSetup(setupSnapshot, { captureAnalytics: false });
  }, [runForSetup]);

  return { result, running, runningFingerprint, clearResult, run, runAuto };
}

function toAiSetupProviderAnalytics(setup: LocalAiSetupState): AiSetupProviderAnalyticsValue {
  if (setup.provider === "managed_local" && setup.driftyRoute === "cloud") return "cloud";
  if (setup.provider === "managed_local") return "local";
  return "custom";
}

function isConnectionTestResultCurrent(
  setupSnapshot: LocalAiSetupState,
  currentSetup: LocalAiSetupState,
): boolean {
  const snapshotIsCloudRoute = setupSnapshot.provider === "managed_local" && setupSnapshot.driftyRoute === "cloud";
  const currentIsCloudRoute = currentSetup.provider === "managed_local" && currentSetup.driftyRoute === "cloud";
  if (snapshotIsCloudRoute || currentIsCloudRoute) return snapshotIsCloudRoute && currentIsCloudRoute;
  const snapshotFingerprint = localAiSetupFingerprint(setupSnapshot);
  const currentFingerprint = localAiSetupFingerprint(currentSetup);
  return setupSnapshot.provider === currentSetup.provider && snapshotFingerprint === currentFingerprint;
}
