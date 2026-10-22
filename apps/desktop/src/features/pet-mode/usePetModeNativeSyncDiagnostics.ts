import { useCallback, useRef, useState } from "react";
import {
  beginPetModeNativeSyncDiagnostic,
  classifyPetModeNativeSyncError,
  settlePetModeNativeSyncDiagnostic,
  updatePetModeNativeSyncReadiness,
  type PetModeNativeSyncDiagnostic,
} from "./petModeNativeSyncDiagnostics";
import type { PetModeReadinessStatus } from "./petModeNativeReadiness";

export function usePetModeNativeSyncDiagnostics() {
  const [records, setRecords] = useState<readonly PetModeNativeSyncDiagnostic[]>([]);
  const tokenRef = useRef(0);
  const begin = useCallback((request: Pick<PetModeNativeSyncDiagnostic, "enabled" | "width" | "height" | "forceReveal" | "attempt" | "maxAttempts">) => {
    const token = ++tokenRef.current;
    const record = { ...request, token, requestedAtMs: Date.now(), outcome: "pending" as const };
    setRecords((current) => beginPetModeNativeSyncDiagnostic(current, record));
    return token;
  }, []);
  const resolve = useCallback((token: number) => {
    setRecords((current) => settlePetModeNativeSyncDiagnostic(current, token, "resolved", Date.now()));
  }, []);
  const reject = useCallback((token: number, error: unknown) => {
    const category = classifyPetModeNativeSyncError(error);
    setRecords((current) => settlePetModeNativeSyncDiagnostic(current, token, "rejected", Date.now(), category));
  }, []);
  const cancel = useCallback((token: number) => {
    setRecords((current) => settlePetModeNativeSyncDiagnostic(current, token, "cancelled", Date.now()));
  }, []);
  const readiness = useCallback((token: number, status: PetModeReadinessStatus) => {
    setRecords((current) => updatePetModeNativeSyncReadiness(current, token, status));
  }, []);
  return { records, begin, resolve, reject, cancel, readiness };
}
