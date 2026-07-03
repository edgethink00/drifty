import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { BrowserHistoryImportPreview, BrowserHistoryImportResult } from "@drifty/domain";
import { trackerClient } from "../../lib/api/trackerClient";
import { formatCompactDurationFromSeconds } from "../../lib/formatting";
import type { BrowserHistoryBootstrapNoticeModel } from "./BrowserHistoryBootstrapPrompt";

const BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_DAYS = 2;
const BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL = "last 48 hours";
const READ_FAILURE_MESSAGE = "Could not read local browser history.";

type BrowserHistoryBootstrapState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "importing"; readonly preview: BrowserHistoryImportPreview }
  | { readonly status: "imported"; readonly result: BrowserHistoryImportResult }
  | { readonly status: "empty"; readonly preview: BrowserHistoryImportPreview }
  | { readonly status: "error"; readonly message: string };

type RefreshDashboard = (
  day?: string,
  options?: { readonly requireCurrentSnapshot?: boolean; readonly foreground?: boolean },
) => Promise<boolean>;

type UseBrowserHistoryBootstrapOptions = {
  readonly blocked: boolean;
  readonly enabled: boolean;
  readonly isPreviewSurface: boolean;
  readonly shouldStart: boolean;
  readonly selectedDayRef: MutableRefObject<string>;
  readonly clearLocalActivityCaches: () => void;
  readonly refresh: RefreshDashboard;
  readonly refreshHistoryData: (day?: string) => Promise<boolean>;
  readonly setError: (message: string | null) => void;
};

export function useBrowserHistoryBootstrap({
  blocked,
  clearLocalActivityCaches,
  enabled,
  isPreviewSurface,
  refresh,
  refreshHistoryData,
  shouldStart,
  selectedDayRef,
  setError,
}: UseBrowserHistoryBootstrapOptions): {
  readonly notice: BrowserHistoryBootstrapNoticeModel | null;
  readonly reset: () => void;
} {
  const [state, setState] = useState<BrowserHistoryBootstrapState>({ status: "idle" });
  const attemptedDayRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    attemptedDayRef.current = null;
    setState({ status: "idle" });
  }, []);

  const runBootstrap = useCallback(async () => {
    if (state.status === "checking" || state.status === "importing") return;
    if (blocked) return;

    setError(null);
    try {
      setState({ status: "checking" });
      const preview = await trackerClient.previewBrowserHistoryImport({
        lookbackDays: BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_DAYS,
      });
      if (preview.segmentCount <= 0) {
        setState({ status: "empty", preview });
        return;
      }

      setState({ status: "importing", preview });
      const result = await trackerClient.importBrowserHistory({
        lookbackDays: BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_DAYS,
      });
      clearLocalActivityCaches();
      setState({ status: "imported", result });
      await refresh(selectedDayRef.current, { foreground: true });
      void refreshHistoryData(selectedDayRef.current);
    } catch (error: unknown) {
      if (error instanceof Error || typeof error === "string") {
        setState({ status: "error", message: READ_FAILURE_MESSAGE });
        return;
      }
      throw error;
    }
  }, [blocked, clearLocalActivityCaches, refresh, refreshHistoryData, selectedDayRef, setError, state]);

  useEffect(() => {
    if (!enabled || blocked || isPreviewSurface || !shouldStart) return;
    if (state.status !== "idle") return;
    const selectedDay = selectedDayRef.current;
    if (attemptedDayRef.current === selectedDay) return;
    attemptedDayRef.current = selectedDay;
    void runBootstrap();
  }, [blocked, enabled, isPreviewSurface, runBootstrap, selectedDayRef, shouldStart, state.status]);

  const notice = useMemo(() => {
    if (!enabled || blocked || isPreviewSurface || !shouldStart) return null;
    return browserHistoryBootstrapNoticeForState(state);
  }, [blocked, enabled, isPreviewSurface, shouldStart, state]);

  return { notice, reset };
}

function browserHistoryBootstrapNoticeForState(
  state: BrowserHistoryBootstrapState,
): BrowserHistoryBootstrapNoticeModel | null {
  switch (state.status) {
    case "idle":
      return bootstrapNotice(
        `Importing from browser history (${BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL}).`,
        "Preparing local import...",
        "working",
      );
    case "checking":
      return bootstrapNotice(
        `Importing from browser history (${BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL}).`,
        "Checking local browser history...",
        "working",
      );
    case "importing": {
      const estimatedDuration = formatCompactDurationFromSeconds(state.preview.estimatedSeconds);
      return bootstrapNotice(
        `Importing ${state.preview.segmentCount} estimated blocks (${estimatedDuration}) from browser history (${BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL}).`,
        "Importing estimated activity...",
        "working",
      );
    }
    case "imported": {
      const insertedCount = state.result.insertedCount;
      return bootstrapNotice(
        insertedCount > 0
          ? `Imported ${insertedCount} estimated blocks from browser history (${BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL}).`
          : `Browser history (${BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL}) is already imported.`,
        state.result.skippedDuplicateCount > 0 ? `${state.result.skippedDuplicateCount} duplicates skipped.` : null,
        "success",
      );
    }
    case "empty":
      return bootstrapNotice(
        `No supported browser history was found from the ${BROWSER_HISTORY_BOOTSTRAP_LOOKBACK_LABEL}. Tracking will fill this view as you work.`,
        null,
        "neutral",
      );
    case "error":
      return bootstrapNotice(state.message, null, "error");
    default:
      return null;
  }
}

function bootstrapNotice(
  detail: string,
  statusLabel: string | null,
  tone: BrowserHistoryBootstrapNoticeModel["tone"],
): BrowserHistoryBootstrapNoticeModel {
  return { detail, statusLabel, tone };
}
