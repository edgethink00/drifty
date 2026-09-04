import { useCallback, useEffect, useRef, useState } from "react";

import type { SshAgentSourceCollectResult } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import {
  loadSshAgentSources,
  saveSshAgentSources,
  subscribeSshAgentSources,
  upsertSshAgentSource,
  type SavedSshAgentSource,
} from "./sshAgentSourcesStorage";

export const SSH_AGENT_AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const SSH_AGENT_AUTO_SYNC_CHECK_INTERVAL_MS = 60 * 1000;
export const SSH_AGENT_INITIAL_BACKFILL_DAYS = 30;

export interface SshAgentSourceSyncStatus {
  readonly autoSyncEnabled: boolean;
  readonly sourceCount: number;
  readonly sourceHosts: readonly string[];
  readonly activeHosts: readonly string[];
  readonly syncing: boolean;
  readonly revision: number;
  readonly lastSuccessAt: string | null;
  readonly lastErrorHost: string | null;
  readonly lastError: string | null;
}

export interface SshAgentSourceSyncController {
  readonly status: SshAgentSourceSyncStatus;
  readonly syncHostNow: (host: string, backfillDays?: number) => Promise<SshAgentSourceCollectResult>;
}

export const INACTIVE_SSH_AGENT_SOURCE_SYNC_STATUS: SshAgentSourceSyncStatus = {
  autoSyncEnabled: false,
  sourceCount: 0,
  sourceHosts: [],
  activeHosts: [],
  syncing: false,
  revision: 0,
  lastSuccessAt: null,
  lastErrorHost: null,
  lastError: null,
};

function parsedCollectionTime(value: string, nowMs: number): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed > nowMs) return 0;
  return parsed;
}

export function sshAgentSourceBackfillDays(lastCollectedAt: string, nowMs: number): number {
  const lastCollectedAtMs = parsedCollectionTime(lastCollectedAt, nowMs);
  if (lastCollectedAtMs === 0) return SSH_AGENT_INITIAL_BACKFILL_DAYS;
  const elapsedDays = Math.floor((nowMs - lastCollectedAtMs) / (24 * 60 * 60 * 1000));
  return Math.max(2, Math.min(SSH_AGENT_INITIAL_BACKFILL_DAYS, elapsedDays + 1));
}

export function isSshAgentSourceSyncDue(input: {
  readonly source: SavedSshAgentSource;
  readonly lastAttemptAtMs: number | null;
  readonly nowMs: number;
}): boolean {
  const lastCollectedAtMs = parsedCollectionTime(input.source.lastCollectedAt, input.nowMs);
  const lastAttemptAtMs = Math.min(input.lastAttemptAtMs ?? 0, input.nowMs);
  return input.nowMs - Math.max(lastCollectedAtMs, lastAttemptAtMs) >= SSH_AGENT_AUTO_SYNC_INTERVAL_MS;
}

export function useSshAgentSourceSyncController({
  enabled,
}: {
  readonly enabled: boolean;
}): SshAgentSourceSyncController {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const mountedRef = useRef(false);
  const inFlightByHostRef = useRef(new Map<string, Promise<SshAgentSourceCollectResult>>());
  const cycleInFlightRef = useRef<Promise<void> | null>(null);
  const lastAttemptAtByHostRef = useRef(new Map<string, number>());
  const [sourceHosts, setSourceHosts] = useState(() => loadSshAgentSources().map((source) => source.host));
  const [activeHosts, setActiveHosts] = useState<ReadonlySet<string>>(() => new Set());
  const [revision, setRevision] = useState(0);
  const [lastSuccessAt, setLastSuccessAt] = useState<string | null>(null);
  const [failuresByHost, setFailuresByHost] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      enabledRef.current = false;
    };
  }, []);

  const refreshSources = useCallback(() => {
    const nextSources = loadSshAgentSources();
    const nextHosts = nextSources.map((source) => source.host);
    const nextHostSet = new Set(nextHosts);
    setSourceHosts(nextHosts);
    setFailuresByHost((current) => {
      if ([...current.keys()].every((host) => nextHostSet.has(host))) return current;
      return new Map([...current].filter(([host]) => nextHostSet.has(host)));
    });
    for (const host of lastAttemptAtByHostRef.current.keys()) {
      if (!nextHostSet.has(host) && !inFlightByHostRef.current.has(host)) {
        lastAttemptAtByHostRef.current.delete(host);
      }
    }
  }, []);

  useEffect(() => {
    refreshSources();
    return subscribeSshAgentSources(refreshSources);
  }, [refreshSources]);

  const clearHostFailure = useCallback((host: string) => {
    if (!mountedRef.current) return;
    setFailuresByHost((current) => {
      if (!current.has(host)) return current;
      const next = new Map(current);
      next.delete(host);
      return next;
    });
  }, []);

  const recordSavedHostFailure = useCallback((host: string, message: string) => {
    if (!mountedRef.current) return;
    if (!loadSshAgentSources().some((source) => source.host === host)) return;
    setFailuresByHost((current) => {
      const next = new Map(current);
      next.delete(host);
      next.set(host, message);
      return next;
    });
  }, []);

  const syncHostNow = useCallback((
    host: string,
    backfillDays = SSH_AGENT_INITIAL_BACKFILL_DAYS,
  ): Promise<SshAgentSourceCollectResult> => {
    const existing = inFlightByHostRef.current.get(host);
    if (existing) return existing;

    lastAttemptAtByHostRef.current.set(host, Date.now());
    if (mountedRef.current) {
      setActiveHosts((current) => new Set([...current, host]));
    }

    const request = trackerClient.collectSshAgentSource(host, backfillDays)
      .then((result) => {
        if (!mountedRef.current) return result;
        if (result.ok) {
          const completedAt = new Date().toISOString();
          setLastSuccessAt(completedAt);
          setRevision((current) => current + 1);
          clearHostFailure(host);
        } else {
          recordSavedHostFailure(host, result.message);
        }
        return result;
      })
      .catch((error: unknown) => {
        if (mountedRef.current) {
          const message = error instanceof Error ? error.message : "SSH collection failed.";
          recordSavedHostFailure(host, message);
        }
        throw error;
      })
      .finally(() => {
        inFlightByHostRef.current.delete(host);
        if (mountedRef.current) {
          setActiveHosts((current) => {
            const next = new Set(current);
            next.delete(host);
            return next;
          });
        }
        if (!loadSshAgentSources().some((source) => source.host === host)) {
          lastAttemptAtByHostRef.current.delete(host);
        }
      });

    inFlightByHostRef.current.set(host, request);
    return request;
  }, [clearHostFailure, recordSavedHostFailure]);

  const runDueSync = useCallback((): Promise<void> => {
    if (!enabledRef.current || cycleInFlightRef.current) {
      return cycleInFlightRef.current ?? Promise.resolve();
    }

    const cycle = (async () => {
      const scheduledSources = loadSshAgentSources();
      for (const source of scheduledSources) {
        if (!enabledRef.current) break;
        const currentSource = loadSshAgentSources().find((candidate) => candidate.host === source.host);
        if (!currentSource) continue;

        const nowMs = Date.now();
        if (!isSshAgentSourceSyncDue({
          source: currentSource,
          lastAttemptAtMs: lastAttemptAtByHostRef.current.get(source.host) ?? null,
          nowMs,
        })) continue;

        try {
          const result = await syncHostNow(
            source.host,
            sshAgentSourceBackfillDays(currentSource.lastCollectedAt, nowMs),
          );
          if (!result.ok) continue;

          const currentSources = loadSshAgentSources();
          if (!currentSources.some((candidate) => candidate.host === source.host)) continue;
          const checkpointSaved = saveSshAgentSources(upsertSshAgentSource(currentSources, {
            host: source.host,
            lastCollectedAt: new Date().toISOString(),
            lastMessage: result.message,
            turnsFound: result.turnsFound,
          }));
          if (!checkpointSaved) {
            recordSavedHostFailure(source.host, "Drifty could not save the automatic SSH collection checkpoint.");
          }
        } catch {
          // A saved source remains active after a transient SSH failure. The
          // in-memory attempt timestamp prevents noisy retries until the next
          // collection interval.
        }
      }
    })();

    cycleInFlightRef.current = cycle;
    const clearCycle = () => {
      if (cycleInFlightRef.current === cycle) cycleInFlightRef.current = null;
    };
    void cycle.then(clearCycle, clearCycle);
    return cycle;
  }, [recordSavedHostFailure, syncHostNow]);

  useEffect(() => {
    if (!enabled || sourceHosts.length === 0) return undefined;

    void runDueSync();
    const intervalId = window.setInterval(() => {
      void runDueSync();
    }, SSH_AGENT_AUTO_SYNC_CHECK_INTERVAL_MS);
    const reconsiderSync = () => {
      void runDueSync();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") reconsiderSync();
    };

    window.addEventListener("focus", reconsiderSync);
    window.addEventListener("online", reconsiderSync);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", reconsiderSync);
      window.removeEventListener("online", reconsiderSync);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, runDueSync, sourceHosts.length]);

  const failures = [...failuresByHost];
  const latestFailure = failures[failures.length - 1] ?? null;

  return {
    status: {
      autoSyncEnabled: enabled && sourceHosts.length > 0,
      sourceCount: sourceHosts.length,
      sourceHosts,
      activeHosts: [...activeHosts],
      syncing: activeHosts.size > 0,
      revision,
      lastSuccessAt,
      lastErrorHost: latestFailure?.[0] ?? null,
      lastError: latestFailure?.[1] ?? null,
    },
    syncHostNow,
  };
}
