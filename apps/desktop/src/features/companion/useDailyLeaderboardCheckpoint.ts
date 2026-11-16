import { useCallback, useEffect, useRef } from "react";
import type { LeaderboardCheckpointPublishResult } from "../leaderboard/useLeaderboardProfileController";
import { END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY } from "./endOfDayReviewData";

const RETRY_DELAY_MS = 5 * 60 * 1000;
const REVIEW_WAIT_MS = 2_000;

/** Publish once per account and day, retrying transient failures without holding up Day Review. */
export function useDailyLeaderboardCheckpoint({
  ready, day, userScopeKey, optedIn, syncPublication, publishCheckpoint,
}: {
  readonly ready: boolean;
  readonly day: string;
  readonly userScopeKey: string | null;
  readonly optedIn: boolean;
  readonly syncPublication: () => Promise<void>;
  readonly publishCheckpoint: (day: string) => Promise<LeaderboardCheckpointPublishResult>;
}) {
  const actionsRef = useRef({ syncPublication, publishCheckpoint });
  actionsRef.current = { syncPublication, publishCheckpoint };
  const inFlightRef = useRef<{ day: string; promise: Promise<void> } | null>(null);
  const ineligibleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !userScopeKey) return undefined;
    const scope = `${userScopeKey}:${day}`;
    const storageKey = `${END_OF_DAY_LEADERBOARD_CHECKPOINT_STORAGE_KEY}.v2:${userScopeKey}`;
    let cancelled = false;
    let retryTimer = 0;
    if (optedIn && ineligibleRef.current === scope) ineligibleRef.current = null;

    const run = () => {
      if (cancelled || ineligibleRef.current === scope) return;
      if (inFlightRef.current) {
        void inFlightRef.current.promise.then(() => { if (!cancelled) run(); });
        return;
      }
      if (window.localStorage.getItem(storageKey) === day) return;
      const promise = (async () => {
        let result: LeaderboardCheckpointPublishResult = "retry";
        try {
          await actionsRef.current.syncPublication();
          result = await actionsRef.current.publishCheckpoint(day);
        } catch {
          // A failed refresh or publication can be retried later in this window.
        }
        if (cancelled) return;
        if (result === "published") {
          try { window.localStorage.setItem(storageKey, day); } catch { /* Storage is best effort. */ }
        } else if (result === "not_participating") {
          ineligibleRef.current = scope;
        } else {
          retryTimer = window.setTimeout(run, RETRY_DELAY_MS);
        }
      })();
      inFlightRef.current = { day, promise };
      void promise.finally(() => {
        if (inFlightRef.current?.promise === promise) inFlightRef.current = null;
      });
    };

    run();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
    };
  }, [day, optedIn, ready, userScopeKey]);

  return useCallback(async (reviewDay: string) => {
    const pending = inFlightRef.current;
    if (!pending || pending.day !== reviewDay) return;
    let timer = 0;
    await Promise.race([
      pending.promise,
      new Promise<void>((resolve) => { timer = window.setTimeout(resolve, REVIEW_WAIT_MS); }),
    ]);
    window.clearTimeout(timer);
  }, []);
}
