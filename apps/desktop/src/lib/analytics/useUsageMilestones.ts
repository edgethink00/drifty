import { useEffect } from "react";
import { capturePostHogEvent } from "./posthogClient";
import {
  evaluateUsageMilestones,
  isMeasuring,
  readUsageMilestoneState,
  writeUsageMilestoneState,
} from "./usageMilestones";

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1_000;

/**
 * Checks the local tracked total at startup and every three hours while a new
 * install is still inside its measurement window, and reports each usage
 * milestone once. Stops asking the tracker once nothing is left to measure.
 */
export function useUsageMilestones({
  enabled,
  loadTrackedSeconds,
}: {
  readonly enabled: boolean;
  readonly loadTrackedSeconds: () => Promise<number>;
}) {
  useEffect(() => {
    if (!enabled) return undefined;
    let disposed = false;
    let running = false;
    const check = async () => {
      const current = readUsageMilestoneState();
      if (running || !isMeasuring(current)) return;
      running = true;
      try {
        const trackedSeconds = await loadTrackedSeconds();
        if (disposed || !Number.isFinite(trackedSeconds)) return;
        const result = evaluateUsageMilestones(readUsageMilestoneState(), trackedSeconds, new Date());
        writeUsageMilestoneState(result.state);
        for (const event of result.events) capturePostHogEvent("usage_milestone", event);
      } catch {
        // A tracker read failure is retried at the next check.
      } finally {
        running = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, loadTrackedSeconds]);
}
