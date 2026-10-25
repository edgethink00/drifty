import { useEffect, useMemo, useRef, useState } from "react";

import { trackerClient } from "../../lib/api/trackerClient";
import { activeTeamPauseLock, teamPauseLockSpans, teamsInHoursNow, type TeamManagedHoursSource, type TeamPauseLockSpan } from "./teamManagedHours";
import { fetchOwnTeams } from "./teamService";
import { fetchTeamServerPolicy } from "./teamSharingService";
import type { OwnTeam } from "./teamTypes";

const REFRESH_MS = 60 * 60 * 1000;
const TICK_MS = 30 * 1000;
/** Set once spans reached the native side from this device, so lifting the lock is sent only when there is one. */
const LOCK_SENT_KEY = "drifty.team.pauseLockSent";

function lockWasSent(): boolean {
  try {
    return window.localStorage.getItem(LOCK_SENT_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberLockSent(sent: boolean): void {
  try {
    if (sent) window.localStorage.setItem(LOCK_SENT_KEY, "1");
    else window.localStorage.removeItem(LOCK_SENT_KEY);
  } catch {
    // The next opening sends the spans again.
  }
}

/** Sends the spans, or lifts a lock this device set; nothing is sent when there was never one. */
async function sendSpans(spans: readonly TeamPauseLockSpan[]): Promise<void> {
  if (spans.length === 0 && !lockWasSent()) return;
  // The native side needs the name and the times only.
  await trackerClient.setTeamPauseLock(spans.map(({ teamName, startsAt, endsAt }) => ({ teamName, startsAt, endsAt })));
  rememberLockSent(spans.length > 0);
}

export type UseTeamPauseLockInput = {
  /** The Teams beta is open (Dev mode and its toggle); outside it no team holds tracking. */
  readonly enabled: boolean;
  /** The signed-in account; null keeps the last lock, which a later successful read replaces. */
  readonly accountKey: string | null;
  /** Changes when the Teams page reloads its teams, so a join, a leave or a policy edit applies at once. */
  readonly teamsKey: string;
};

async function readSources(): Promise<TeamManagedHoursSource[] | null> {
  const teams = await fetchOwnTeams();
  if (!teams.success) return null;
  const policies = await Promise.all(teams.data.map((team) => fetchTeamServerPolicy({ organization_id: team.organization_id })));
  return teams.data.map((team: OwnTeam, index) => {
    const server = policies[index]!.success ? policies[index]!.data : null;
    const role = team.membership_role;
    return {
      organizationId: team.organization_id,
      teamName: team.organization_name,
      policy: server?.tracking_policy ?? team.tracking_policy ?? null,
      seat: server?.seat ?? (role === "member" ? "member" : role === "lead" ? "manager" : "admin"),
      schedule: server?.schedule ?? team.recording_schedule ?? null,
    };
  });
}

export type TeamPauseLockState = {
  /** The span holding now, if any: the team keeping tracking on and when its hours end. */
  readonly lock: TeamPauseLockSpan | null;
  /** Every managed team whose hours hold now, by id, for reporting that this computer records. */
  readonly teamsInHours: readonly string[];
};

/**
 * Keeps the native pause lock in step with the person's managed teams and
 * returns the lock in force now, if any, with the teams whose hours hold now.
 * The teams are read when the app opens, every hour and whenever the Teams
 * page reloads them; the spans cover three weeks, so a quiet spell offline
 * does not lift the rule early.
 */
export function useTeamPauseLock({ enabled, accountKey, teamsKey }: UseTeamPauseLockInput): TeamPauseLockState {
  const [spans, setSpans] = useState<readonly TeamPauseLockSpan[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    if (!enabled) {
      setSpans([]);
      void sendSpans([]).catch(() => undefined);
      return;
    }
    if (!accountKey) return;
    const read = async () => {
      const sources = await readSources().catch(() => null);
      if (request !== requestRef.current || sources === null) return;
      const now = Date.now();
      const next = teamPauseLockSpans(sources, now);
      // A join or slow read may cross the start of work hours. Match the
      // native refusal immediately rather than waiting for the next tick.
      setNowMs(now);
      setSpans(next);
      await sendSpans(next).catch(() => undefined);
    };
    void read();
    const timer = setInterval(() => void read(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [accountKey, enabled, teamsKey]);

  useEffect(() => {
    if (spans.length === 0) return;
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [spans.length]);

  const lock = enabled ? activeTeamPauseLock(spans, nowMs) : null;
  const inHoursKey = enabled ? teamsInHoursNow(spans, nowMs).join(",") : "";
  const teamsInHours = useMemo(() => (inHoursKey ? inHoursKey.split(",") : []), [inHoursKey]);
  return { lock, teamsInHours };
}

