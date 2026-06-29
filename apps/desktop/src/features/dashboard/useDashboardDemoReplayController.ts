import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardPeriod } from "./dashboardPeriods";
import {
  buildDemoDashboardReplayAnchor,
  buildDemoDashboardReplayFixture,
  resolveDemoDashboardReplayCurrentLogicalDay,
  resolveDemoDashboardReplayProgress,
  type DemoDashboardReplayAnchor,
  type DemoDashboardReplayFixture,
  type DemoDashboardReplayKind,
  type DemoDashboardReplayPhase,
} from "./demoDashboardReplay";
import { buildDashboardReplayFixtureFromSegments, type DashboardReplaySegmentSource } from "./dashboardDemoReplaySource";
import { clampDemoDashboardReplaySettings, type DemoDashboardReplaySettings, type StartOfWeek } from "../settings/settingsStorage";

const ONE_MINUTE_MS = 60_000;
const MIN_REPLAY_PROGRESS_INTERVAL_MS = 10;
const MAX_REPLAY_PROGRESS_INTERVAL_MS = 250;

export type DashboardDemoReplayIdleState = {
  readonly kind: "idle";
};

export type DashboardDemoReplayActiveState = {
  readonly kind: "active";
  readonly anchor: DemoDashboardReplayAnchor;
  readonly fixture: DemoDashboardReplayFixture;
  readonly phase: Exclude<DemoDashboardReplayPhase, "idle">;
  readonly playingStartedAtMs: number | null;
  readonly progress: number;
  readonly replayKind: DemoDashboardReplayKind;
  readonly runId: number;
  readonly settings: DemoDashboardReplaySettings;
};

export type DashboardDemoReplayControllerState = DashboardDemoReplayIdleState | DashboardDemoReplayActiveState;
export type DashboardDemoReplayStartSource = DashboardReplaySegmentSource;

type DashboardDemoReplayControllerOptions = {
  readonly settings: DemoDashboardReplaySettings;
  readonly startOfDayMinutes: number;
  readonly startOfWeek: StartOfWeek;
  readonly onNavigateDashboard: (period: DashboardPeriod) => void;
  readonly onSelectDay: (day: string) => void;
};

export function resolveDemoDashboardReplayProgressIntervalMs(input: {
  readonly anchor: DemoDashboardReplayAnchor;
  readonly durationSeconds: number;
}): number {
  if (!Number.isFinite(input.durationSeconds) || input.durationSeconds <= 0) return MAX_REPLAY_PROGRESS_INTERVAL_MS;

  const rangeStartMs = new Date(input.anchor.rangeStart).getTime();
  const rangeEndExclusiveMs = new Date(input.anchor.rangeEnd).getTime() + 1000;
  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndExclusiveMs) || rangeEndExclusiveMs <= rangeStartMs) {
    return MAX_REPLAY_PROGRESS_INTERVAL_MS;
  }

  const virtualMinuteCount = Math.max(1, Math.round((rangeEndExclusiveMs - rangeStartMs) / ONE_MINUTE_MS));
  const intervalMs = Math.floor((input.durationSeconds * 1000) / virtualMinuteCount);
  return Math.min(MAX_REPLAY_PROGRESS_INTERVAL_MS, Math.max(MIN_REPLAY_PROGRESS_INTERVAL_MS, intervalMs));
}

export function useDashboardDemoReplayController({
  settings,
  startOfDayMinutes,
  startOfWeek,
  onNavigateDashboard,
  onSelectDay,
}: DashboardDemoReplayControllerOptions) {
  const [replayState, setReplayState] = useState<DashboardDemoReplayControllerState>({ kind: "idle" });
  const playingReplayAnchor = replayState.kind === "active" && replayState.phase === "playing" ? replayState.anchor : null;
  const playingReplayDurationSeconds = replayState.kind === "active" && replayState.phase === "playing" ? replayState.settings.durationSeconds : null;
  const playingReplayRunId = replayState.kind === "active" && replayState.phase === "playing" ? replayState.runId : null;
  const playingReplayStartedAtMs = replayState.kind === "active" && replayState.phase === "playing" ? replayState.playingStartedAtMs : null;

  const startReplay = useCallback((replayKind: DemoDashboardReplayKind, source?: DashboardDemoReplayStartSource) => {
    const replaySettings = clampDemoDashboardReplaySettings(settings);
    const currentLogicalDay = resolveDemoDashboardReplayCurrentLogicalDay({
      currentDate: new Date(),
      startOfDayMinutes,
    });
    const anchor = source?.anchor ?? buildDemoDashboardReplayAnchor({
      kind: replayKind,
      currentLogicalDay,
      startOfDayMinutes,
      startOfWeek,
    });
    const fixture = source ? buildDashboardReplayFixtureFromSegments(source) : buildDemoDashboardReplayFixture(anchor);

    onSelectDay(anchor.anchorDay);
    onNavigateDashboard(replayKind === "day" ? "Today" : "Week");
    setReplayState((current) => ({
      kind: "active",
      anchor,
      fixture,
      phase: "pre_roll",
      playingStartedAtMs: null,
      progress: 0,
      replayKind,
      runId: current.kind === "active" ? current.runId + 1 : 1,
      settings: replaySettings,
    }));
  }, [onNavigateDashboard, onSelectDay, settings, startOfDayMinutes, startOfWeek]);

  const stopReplay = useCallback(() => {
    setReplayState({ kind: "idle" });
  }, []);

  const restartReplay = useCallback(() => {
    setReplayState((current) => {
      if (current.kind !== "active") return current;
      return {
        ...current,
        phase: "pre_roll",
        playingStartedAtMs: null,
        progress: 0,
        runId: current.runId + 1,
      };
    });
  }, []);

  useEffect(() => {
    if (replayState.kind !== "active") return undefined;
    if (replayState.phase !== "pre_roll") return undefined;

    const timeoutId = window.setTimeout(() => {
      setReplayState((current) => {
        if (current.kind !== "active" || current.runId !== replayState.runId || current.phase !== "pre_roll") return current;
        return { ...current, phase: "playing", playingStartedAtMs: Date.now(), progress: 0 };
      });
    }, replayState.settings.preRollSeconds * 1000);

    return () => window.clearTimeout(timeoutId);
  }, [replayState]);

  useEffect(() => {
    if (playingReplayAnchor === null || playingReplayDurationSeconds === null || playingReplayRunId === null || playingReplayStartedAtMs === null) return undefined;

    const intervalId = window.setInterval(() => {
      setReplayState((current) => {
        if (current.kind !== "active" || current.runId !== playingReplayRunId || current.phase !== "playing") return current;
        if (current.playingStartedAtMs === null) return current;

        const progress = resolveDemoDashboardReplayProgress({
          durationSeconds: current.settings.durationSeconds,
          elapsedMs: Date.now() - current.playingStartedAtMs,
        });
        if (progress >= 1) return { ...current, phase: "complete", progress: 1 };
        return { ...current, progress };
      });
    }, resolveDemoDashboardReplayProgressIntervalMs({
      anchor: playingReplayAnchor,
      durationSeconds: playingReplayDurationSeconds,
    }));

    return () => window.clearInterval(intervalId);
  }, [playingReplayAnchor, playingReplayDurationSeconds, playingReplayRunId, playingReplayStartedAtMs]);

  return useMemo(() => ({
    replayState,
    restartReplay,
    startReplay,
    stopReplay,
  }), [replayState, restartReplay, startReplay, stopReplay]);
}
