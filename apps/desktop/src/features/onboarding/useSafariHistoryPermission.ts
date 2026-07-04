import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserHistoryEnvironment } from "@drifty/domain";
import { openFullDiskAccessSettingsPane } from "../../lib/api/systemSettingsClient";
import { trackerClient } from "../../lib/api/trackerClient";
import type { OnboardingStep } from "./onboardingFlow";

// Show the Safari Full Disk Access row only for likely Safari users: either Safari is
// the default browser, or the supported-browser (Chromium/Firefox) history preview
// found (almost) nothing. Chrome/Arc/Whale users with real history never see it.
const SAFARI_ROW_SEGMENT_THRESHOLD = 5;
const SAFARI_HISTORY_POLL_INTERVAL_MS = 2000;
const SAFARI_PREVIEW_LOOKBACK_DAYS = 2;

function isDesktopRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type SafariHistoryPermission = {
  /** Whether the Safari Full Disk Access row should render on the permissions step. */
  readonly show: boolean;
  /** True once Safari's History.db is readable (Full Disk Access granted). */
  readonly readable: boolean;
  /** True while the Full Disk Access pane is being opened. */
  readonly opening: boolean;
  readonly onEnable: () => void;
};

/**
 * Drives the optional Safari history / Full Disk Access onboarding row. Full Disk
 * Access can only be granted by a manual toggle in System Settings (no OS prompt
 * API), so this hook opens the pane, registers Drifty in the FDA list by attempting
 * one Safari history read, and polls until the read succeeds. It never gates Continue.
 */
export function useSafariHistoryPermission(step: OnboardingStep): SafariHistoryPermission {
  const [show, setShow] = useState(false);
  const [readable, setReadable] = useState(false);
  const [opening, setOpening] = useState(false);

  const active = step === "permissions" && isDesktopRuntime();

  // On step mount, decide whether to show the row and seed the readable state.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        // The environment probe failing (e.g. an older sidecar without the command)
        // must not hide the row when the history preview alone qualifies the user.
        const [environment, preview] = await Promise.all([
          trackerClient
            .getBrowserHistoryEnvironment()
            .catch((): BrowserHistoryEnvironment => ({ safariHistoryReadable: false, defaultBrowserIsSafari: false })),
          trackerClient.previewBrowserHistoryImport({ lookbackDays: SAFARI_PREVIEW_LOOKBACK_DAYS }),
        ]);
        if (cancelled) return;
        setReadable(environment.safariHistoryReadable);
        setShow(environment.defaultBrowserIsSafari || preview.segmentCount < SAFARI_ROW_SEGMENT_THRESHOLD);
      } catch {
        // Soft feature: without a preview we cannot judge, so leave the row hidden.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const shouldPoll = active && show && !readable;
  const shouldPollRef = useRef(shouldPoll);
  shouldPollRef.current = shouldPoll;

  // Poll every ~2s while the row is visible and not yet readable; stop on success.
  useEffect(() => {
    if (!shouldPoll) return;
    let cancelled = false;
    async function checkReadable() {
      if (cancelled) return;
      try {
        const environment = await trackerClient.getBrowserHistoryEnvironment();
        if (!cancelled && environment.safariHistoryReadable) setReadable(true);
      } catch {
        // Ignore transient sidecar errors; the next tick retries.
      }
    }
    const intervalId = window.setInterval(() => void checkReadable(), SAFARI_HISTORY_POLL_INTERVAL_MS);
    function handleFocus() {
      // Re-check immediately when returning from System Settings.
      if (shouldPollRef.current) void checkReadable();
    }
    window.addEventListener("focus", handleFocus);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleFocus);
    };
  }, [shouldPoll]);

  const onEnable = useCallback(() => {
    setOpening(true);
    void (async () => {
      try {
        // (1) One Safari history read attempt registers Drifty in the Full Disk Access list.
        await trackerClient.getBrowserHistoryEnvironment();
        // (2) Open the Full Disk Access pane so the user can flip the toggle.
        await openFullDiskAccessSettingsPane();
      } catch {
        // Soft-block: opening the pane may be unavailable; polling still recovers state.
      } finally {
        setOpening(false);
      }
    })();
  }, []);

  return { show, readable, opening, onEnable };
}
