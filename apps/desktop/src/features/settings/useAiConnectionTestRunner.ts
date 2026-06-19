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

type UseAiConnectionTestRunnerResult = {
  readonly result: AiConnectionTestResult | null;
  readonly running: boolean;
  readonly clearResult: () => void;
  readonly run: () => Promise<void>;
};

export function useAiConnectionTestRunner({
  localAiSetup,
  onLocalAiConnectionTestResult,
}: UseAiConnectionTestRunnerOptions): UseAiConnectionTestRunnerResult {
  const [result, setResult] = useState<AiConnectionTestResult | null>(null);
  const [running, setRunning] = useState(false);
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
    runningRef.current = true;
    setRunning(true);
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
    }
  }, [onLocalAiConnectionTestResult]);

  const autoFingerprint = useMemo(() => {
    if (localAiSetup.provider !== "managed_local" || localAiSetup.driftyRoute !== "local") return null;
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

  return { result, running, clearResult, run };
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
