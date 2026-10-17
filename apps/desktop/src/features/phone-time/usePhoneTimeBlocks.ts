import { useEffect, useMemo, useState } from "react";
import { logicalDayEndExclusiveMs, logicalDayStartMs } from "@drifty/domain";
import { shouldUsePreviewData } from "../../lib/api/previewData";
import { DeviceSyncHttpError, fetchPhoneTimeBlocks } from "../device-sync/deviceSyncApi";
import { previewPhoneTimeBlocks, type PhoneTimeBlock } from "./phoneFlowCells";

/** The iPhone sends at most every five minutes; read today's again as often. */
export const PHONE_TIME_REFRESH_MS = 5 * 60 * 1000;
const EMPTY_PHONE_TIME_BLOCKS: readonly PhoneTimeBlock[] = [];

/** The browser preview shows sample phone time only when asked to. */
function previewPhoneTimeRequested(): boolean {
  if (!shouldUsePreviewData()) return false;
  return new URLSearchParams(window.location.search).get("driftyPreviewPhone") === "1";
}

/**
 * The phone time the account's iPhone sent for one logical day. It is read
 * only while device sync is on for this Mac (Pro), and it is kept in memory for
 * the flow chart alone; nothing here reaches the tracker database.
 */
export function usePhoneTimeBlocks({
  active,
  accountId,
  day,
  startOfDayMinutes,
}: {
  readonly active: boolean;
  readonly accountId: string | null;
  readonly day: string;
  readonly startOfDayMinutes: number;
}): readonly PhoneTimeBlock[] {
  const preview = shouldUsePreviewData();
  const previewPhone = previewPhoneTimeRequested();
  const key = active && accountId && !preview ? `${accountId}|${day}|${startOfDayMinutes}` : null;
  const [loaded, setLoaded] = useState<{ readonly key: string; readonly blocks: readonly PhoneTimeBlock[] } | null>(null);

  useEffect(() => {
    if (!key || !accountId) return undefined;
    let cancelled = false;
    const fromMs = logicalDayStartMs(day, startOfDayMinutes);
    const toMs = logicalDayEndExclusiveMs(day, startOfDayMinutes);
    const load = () => {
      fetchPhoneTimeBlocks(accountId, new Date(fromMs).toISOString(), new Date(toMs).toISOString())
        .then((blocks) => {
          if (!cancelled) setLoaded({ key, blocks });
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // Losing Pro, a paused sync or a changed account hides what was shown.
          if (error instanceof DeviceSyncHttpError && error.status >= 400 && error.status < 500) {
            setLoaded({ key, blocks: EMPTY_PHONE_TIME_BLOCKS });
          }
          console.warn("Failed to read iPhone time", error instanceof Error ? error.message : "unknown error");
        });
    };
    load();
    const now = Date.now();
    if (now < fromMs || now >= toMs) return () => { cancelled = true; };
    const intervalId = window.setInterval(load, PHONE_TIME_REFRESH_MS);
    const reloadWhenVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", reloadWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", reloadWhenVisible);
    };
  }, [accountId, day, key, startOfDayMinutes]);

  const previewBlocks = useMemo(
    () => (previewPhone ? previewPhoneTimeBlocks(day, startOfDayMinutes) : EMPTY_PHONE_TIME_BLOCKS),
    [day, previewPhone, startOfDayMinutes],
  );
  if (preview) return previewBlocks;
  return key && loaded?.key === key ? loaded.blocks : EMPTY_PHONE_TIME_BLOCKS;
}
