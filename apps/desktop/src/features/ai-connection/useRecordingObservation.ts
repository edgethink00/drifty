import { useCallback, useEffect, useRef, useState } from "react";
import type { TrackerStatus } from "@drifty/domain";
import { RECORDING_STATUS_MAX_AGE_MS } from "./recordingHealth";

type Observation = { statusAt: number | null; captureAt: number | null };

/** Observes existing requests. The timer only expires UI evidence; it does no I/O. */
export function useRecordingObservation(lastEventAt: string | null | undefined) {
  const sequence = useRef(0);
  const acceptedStatus = useRef(0);
  const acceptedCapture = useRef(0);
  const [observation, setObservation] = useState<Observation>({ statusAt: null, captureAt: null });
  const [clock, setClock] = useState(Date.now);
  const beginRequest = useCallback(() => ++sequence.current, []);
  const acceptStatus = useCallback((request: number, status: TrackerStatus | null) => {
    if (request < acceptedStatus.current) return false;
    acceptedStatus.current = request;
    const includesCapture = request >= acceptedCapture.current;
    if (includesCapture) acceptedCapture.current = request;
    const checkedAt = status && status.trackerMode !== "unavailable" ? Date.now() : null;
    setObservation((current) => ({ statusAt: checkedAt, captureAt: includesCapture ? checkedAt : current.captureAt }));
    setClock(Date.now());
    return true;
  }, []);
  const acceptCapture = useCallback((request: number, available: boolean) => {
    if (request < acceptedCapture.current) return false;
    acceptedCapture.current = request;
    setObservation((current) => ({ ...current, captureAt: available ? Date.now() : null }));
    setClock(Date.now());
    return true;
  }, []);
  const now = Math.max(clock, Date.now());
  useEffect(() => {
    const deadlines = [observation.statusAt, observation.captureAt, lastEventAt ? Date.parse(lastEventAt) : null]
      .filter((time): time is number => time !== null && Number.isFinite(time) && time <= Date.now())
      .map((time) => time + RECORDING_STATUS_MAX_AGE_MS)
      .filter((deadline) => deadline > Date.now());
    if (deadlines.length === 0) return;
    const timer = window.setTimeout(() => setClock(Date.now()), Math.min(...deadlines) - Date.now());
    return () => window.clearTimeout(timer);
  }, [observation, lastEventAt, clock]);
  return {
    beginRequest, acceptStatus, acceptCapture, now,
    statusFresh: observation.statusAt !== null && now - observation.statusAt < RECORDING_STATUS_MAX_AGE_MS,
    captureFresh: observation.captureAt !== null && now - observation.captureAt < RECORDING_STATUS_MAX_AGE_MS,
  };
}
