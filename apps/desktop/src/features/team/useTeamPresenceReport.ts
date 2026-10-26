import { useEffect, useMemo } from "react";

import { recordingSchedulePayload, useCapturePolicy } from "../feedback-requests/capturePolicy";
import { recordingAllowedAt } from "../feedback-requests/recordingSchedule";
import { reportTeamPresence } from "./teamSharingService";

/** Under the server's ten-minute freshness, so a recording member never reads as away between reports. */
export const TEAM_PRESENCE_REPORT_MS = 4 * 60 * 1000;
/** Set while this device may have left a status on the server, so it is cleared once the hours end. */
const REPORTED_KEY = "drifty.team.presenceReported";

function reportedBefore(): boolean {
  try {
    return window.localStorage.getItem(REPORTED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberReported(reported: boolean): void {
  try {
    if (reported) window.localStorage.setItem(REPORTED_KEY, "1");
    else window.localStorage.removeItem(REPORTED_KEY);
  } catch {
    // The next report or clearing tries again.
  }
}

export type UseTeamPresenceReportInput = {
  /** The Teams beta is open (Dev mode and its toggle) on a configured server. */
  readonly enabled: boolean;
  /** The signed-in account; nothing is sent while signed out. */
  readonly accountKey: string | null;
  /** The managed teams whose hours hold now on this computer's clock. */
  readonly teamsInHours: readonly string[];
  /** Whether this computer is running, unpaused and inside its personal recording hours. */
  readonly recording: boolean;
};

/**
 * Managed tracking (owner decision 2026-10-17): while this computer records
 * inside a managed team's hours it tells the team so, every few minutes, and
 * leaders see a status only. A stop or personal off-hours sends nothing, so the status simply goes
 * stale (another of the person's computers may still be recording); when the
 * hours end, or the beta closes, the status this device left is cleared.
 */
export function useTeamPresenceReport({ enabled, accountKey, teamsInHours, recording }: UseTeamPresenceReportInput): void {
  const capturePolicy = useCapturePolicy();
  const schedule = useMemo(() => recordingSchedulePayload(capturePolicy), [capturePolicy]);
  const teamsKey = teamsInHours.join(",");
  useEffect(() => {
    if (!accountKey) return;
    const teams = enabled && teamsKey ? teamsKey.split(",") : [];
    if (teams.length === 0) {
      if (reportedBefore()) {
        void reportTeamPresence([])
          .then((result) => { if (result.success) rememberReported(false); })
          .catch(() => undefined);
      }
      return;
    }
    if (!recording) return;
    const send = () => {
      // The timer can cross an hours boundary before App refreshes its clock.
      // Use hours only: a private window must never change the team's report.
      const effectiveRecordingAllowed = recordingAllowedAt(schedule, new Date());
      if (!effectiveRecordingAllowed) return;
      rememberReported(true);
      void reportTeamPresence(teams).catch(() => undefined);
    };
    send();
    const timer = setInterval(send, TEAM_PRESENCE_REPORT_MS);
    return () => clearInterval(timer);
  }, [accountKey, enabled, recording, schedule, teamsKey]);
}
