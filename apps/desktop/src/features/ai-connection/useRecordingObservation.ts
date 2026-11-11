import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { RECORDING_STATUS_MAX_AGE_MS, type TrackerRunState } from "./recordingHealth";

type StorageObservation = { bytes: number; at: number };
type Observation = { statusAt: number | null; captureAt: number | null; storage: StorageObservation | null; captureRunState: TrackerRunState | null };

function measuredStorage(bytes: number | null | undefined, at: number): StorageObservation | null {
  return typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? { bytes, at } : null;
}

/** Observes existing requests. The timer only expires UI evidence; it does no I/O. */
export function useRecordingObservation(lastEventAt: string | null | undefined) {
  const sequence = useRef(0);
  const acceptedStatus = useRef(0);
  const acceptedCapture = useRef(0);
  const acceptedStorage = useRef(0);
  const [observation, setObservation] = useState<Observation>({ statusAt: null, captureAt: null, storage: null, captureRunState: null });
  const [clock, setClock] = useState(Date.now);
  const beginRequest = useCallback(() => ++sequence.current, []);
  const acceptStatus = useCallback((request: number, status: TrackerStatus | null) => {
    if (request < acceptedStatus.current) return false;
    acceptedStatus.current = request;
    const includesCapture = request >= acceptedCapture.current;
    if (includesCapture) acceptedCapture.current = request;
    const includesStorage = request >= acceptedStorage.current;
    if (includesStorage) acceptedStorage.current = request;
    const checkedAt = status && (status.trackerMode !== "unavailable" || status.statusIssue) ? Date.now() : null;
    const capturedAt = status?.statusIssue ? null : checkedAt;
    setObservation((current) => ({
      statusAt: checkedAt,
      captureAt: includesCapture ? capturedAt : current.captureAt,
      captureRunState: includesCapture ? null : current.captureRunState,
      storage: includesStorage
        ? checkedAt === null ? null : measuredStorage(status?.storageFreeBytes, checkedAt)
        : current.storage,
    }));
    setClock(Date.now());
    return true;
  }, []);
  const acceptCapture = useCallback((request: number, available: boolean, runState: TrackerRunState | null = null) => {
    if (request < acceptedCapture.current) return false;
    acceptedCapture.current = request;
    setObservation((current) => ({
      ...current,
      captureAt: available ? Date.now() : null,
      captureRunState: available ? runState : null,
    }));
    setClock(Date.now());
    return true;
  }, []);
  // The existing live-tail response can update storage without starting
  // another status request or refreshing the entire dashboard.
  const acceptStorage = useCallback((request: number, bytes: number | null) => {
    if (request < acceptedStorage.current) return;
    acceptedStorage.current = request;
    const at = Date.now();
    setObservation((current) => ({ ...current, storage: measuredStorage(bytes, at) }));
    setClock(at);
  }, []);
  const now = Math.max(clock, Date.now());
  const captureFresh = observation.captureAt !== null && now - observation.captureAt < RECORDING_STATUS_MAX_AGE_MS;
  useEffect(() => {
    const deadlines = [observation.statusAt, observation.captureAt, observation.storage?.at ?? null, lastEventAt ? Date.parse(lastEventAt) : null]
      .filter((time): time is number => time !== null && Number.isFinite(time) && time <= Date.now())
      .map((time) => time + RECORDING_STATUS_MAX_AGE_MS)
      .filter((deadline) => deadline > Date.now());
    if (deadlines.length === 0) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(...deadlines) - Date.now());
    return () => window.clearTimeout(timer);
  }, [observation, lastEventAt, clock]);
  return {
    beginRequest, acceptStatus, acceptCapture, acceptStorage, now,
    storageFreeBytes: observation.storage !== null && now - observation.storage.at < RECORDING_STATUS_MAX_AGE_MS
      ? observation.storage.bytes : null,
    statusFresh: observation.statusAt !== null && now - observation.statusAt < RECORDING_STATUS_MAX_AGE_MS,
    captureFresh,
    captureRunState: captureFresh ? observation.captureRunState : null,
  };
}
