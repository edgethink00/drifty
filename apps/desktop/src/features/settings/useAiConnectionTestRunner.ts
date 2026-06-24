import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { localAiSetupFingerprint } from "../ai-connection/aiConnectionHealth";
import { testLocalAiConnection, type AiConnectionTestResult } from "./aiConnectionTest";
import { testCloudAiConnection } from "./cloudAiConnectionTest";
import { isActiveProviderTestable } from "./aiSetupProviderSelection";
import type { LocalAiSetupState } from "./localAiSetup";

type UseAiConnectionTestRunnerOptions = {
  readonly localAiSetup: LocalAiSetupState;
  readonly onLocalAiConnectionTestResult: (setup: LocalAiSetupState, result: AiConnectionTestResult) => void;
};

export type UseAiConnectionTestRunnerResult = {
  readonly result: AiConnectionTestResult | null;
  readonly running: boolean;
  readonly runningFingerprint: string | null;
  readonly clearResult: () => void;
  readonly run: () => Promise<void>;
};

export function useAiConnectionTestRunner({
  localAiSetup,
  onLocalAiConnectionTestResult,
}: UseAiConnectionTestRunnerOptions): UseAiConnectionTestRunnerResult {
  const [result, setResult] = useState<AiConnectionTestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runningFingerprint, setRunningFingerprint] = useState<string | null>(null);
  const runningRef = useRef(false);
  const latestSetupRef = useRef(localAiSetup);
  const completedAutoFingerprintRef = useRef<string | null>(null);

  useEffect(() => {
    latestSetupRef.current = localAiSetup;
  }, [localAiSetup]);

  const clearResult = useCallback(() => {
    setResult(null);
  }, []);

  const runForSetup = useCallback(async (setupSnapshot: LocalAiSetupState): Promise<boolean> => {
    if (runningRef.current) return false;
    const fingerprint = localAiSetupFingerprint(setupSnapshot);
    runningRef.current = true;
    setRunning(true);
    setRunningFingerprint(fingerprint);
    setResult(null);
    try {
      const isCloudRoute = setupSnapshot.provider === "managed_local" && setupSnapshot.driftyRoute === "cloud";
      const nextResult = isCloudRoute ? await testCloudAiConnection() : await testLocalAiConnection(setupSnapshot);
      if (!isConnectionTestResultCurrent(setupSnapshot, latestSetupRef.current)) return false;
      setResult(nextResult);
      if (!isCloudRoute) onLocalAiConnectionTestResult(setupSnapshot, nextResult);
      return true;
    } finally {
      runningRef.current = false;
      setRunning(false);
      setRunningFingerprint(null);
    }
  }, [onLocalAiConnectionTestResult]);

  const autoFingerprint = useMemo(() => {
    if (!isActiveProviderTestable(localAiSetup)) return null;
    return localAiSetupFingerprint(localAiSetup);
  }, [localAiSetup]);

  useEffect(() => {
    if (!autoFingerprint || running) return;
    if (completedAutoFingerprintRef.current === autoFingerprint) return;
    void runForSetup(localAiSetup).then((applied) => {
      if (applied) completedAutoFingerprintRef.current = autoFingerprint;
    });
  }, [autoFingerprint, localAiSetup, runForSetup, running]);

  const run = useCallback(async () => {
    await runForSetup(localAiSetup);
  }, [localAiSetup, runForSetup]);

  return { result, running, runningFingerprint, clearResult, run };
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
