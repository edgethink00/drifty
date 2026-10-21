import { useEffect, useRef } from "react";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { consumeRemoteSyncControl, dismissRemoteSyncControl, pollRemoteSyncControl } from "./deviceSyncApi";
import { clearRemoteSyncDismissal, markRemoteSyncDismissal, readRemoteSyncDismissal } from "./remoteSyncDismissal";

export const REMOTE_SYNC_POLL_MS = 30_000;
type Options = {
  active: boolean;
  accountId: string | null;
  enabled: boolean;
  getLocalRevision: () => number;
  onEnable: (generation: number, isCurrent: () => boolean) => Promise<void>;
};

/** Metadata-only receiver: remains active when activity upload is OFF. A
 * consumed request is never retried; local OFF, purge and account changes win
 * over an outstanding response. Only new explicit iPhone consent can retry. */
export function useRemoteSyncControl(options: Options): void {
  const latest = useRef(options);
  latest.current = options;
  const { accountId, active } = options;
  const previousAccount = useRef(accountId);
  useEffect(() => {
    if (previousAccount.current !== accountId) {
      markRemoteSyncDismissal(previousAccount.current);
      previousAccount.current = accountId;
    }
  }, [accountId]);

  useEffect(() => {
    if (!active || !accountId || shouldUsePreviewData()) return;
    let disposed = false;
    let running = false;
    const tick = async () => {
      if (disposed || running) return;
      running = true;
      const revision = latest.current.getLocalRevision();
      const isCurrent = () => !disposed && latest.current.active
        && latest.current.accountId === accountId && latest.current.getLocalRevision() === revision;
      try {
        const dismissal = readRemoteSyncDismissal(accountId);
        if (dismissal) {
          await dismissRemoteSyncControl(accountId, latest.current.enabled);
          if (isCurrent()) clearRemoteSyncDismissal(accountId, dismissal);
          return;
        }
        const pending = await pollRemoteSyncControl(accountId, latest.current.enabled);
        if (!isCurrent() || !pending.requestId || readRemoteSyncDismissal(accountId)) return;
        const received = await consumeRemoteSyncControl(accountId, pending.requestId);
        if (!isCurrent() || readRemoteSyncDismissal(accountId) || !received.accepted) return;
        const generation = received.syncGeneration;
        if (typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) return;
        await latest.current.onEnable(generation, isCurrent);
      } catch {
        // Old edge deployments, offline computers and exhausted admission all
        // leave local consent OFF. The iPhone continues to show waiting.
      } finally {
        running = false;
      }
    };
    void tick();
    const interval = window.setInterval(() => { void tick(); }, REMOTE_SYNC_POLL_MS);
    const focus = () => { void tick(); };
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", focus);
      window.removeEventListener("online", focus);
    };
  }, [active, accountId]);
}
