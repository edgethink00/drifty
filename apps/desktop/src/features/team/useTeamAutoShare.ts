import { useEffect, useRef } from "react";

import type { ActivityBlockLabelLanguage } from "@drifty/domain";

import { trackerClient } from "../../lib/api/trackerClient";
import { notifyTeamProjectMirrorChanged, notifyTeamTimeShared } from "../../lib/teamProjectMirrorEvents";
import { shareOwnTeamTime, type TeamAutoShareResult } from "./teamAutoShare";
import type { TeamFocusClassification } from "./teamFocusPublish";
import { fetchOwnTeams, fetchTeamProjects } from "./teamService";
import { fetchTeamServerPolicy } from "./teamSharingService";
import { recordTeamShareResult } from "./teamShareStatus";
import { toLocalTeamProjectInputs } from "./useTeamProjects";

/** Often enough that a leader sees the morning by lunch, rarely enough to stay quiet. */
export const TEAM_AUTO_SHARE_INTERVAL_MS = 30 * 60 * 1000;
/** Lets the app finish opening before the first two-week read. */
export const TEAM_AUTO_SHARE_FIRST_DELAY_MS = 15 * 1000;

export type UseTeamAutoShareInput = {
  /** The Teams beta is on (Settings › General) on a configured server, and classification settings are settled. */
  readonly enabled: boolean;
  /** The signed-in account; nothing is sent while signed out. */
  readonly accountKey: string | null;
  /** Changes when the Teams page reloads its teams, so a join or a sharing edit is picked up soon. */
  readonly teamsKey: string;
  readonly startOfDayMinutes: number;
  readonly focusClassification: TeamFocusClassification | null;
  /** The language Your Day names blocks in. */
  readonly language?: ActivityBlockLabelLanguage;
};

/** Copies a team's projects to this computer so the project pass can find them without the Teams page open. */
async function mirrorTeamProjects(organizationId: string): Promise<void> {
  const projects = await fetchTeamProjects({ organization_id: organizationId });
  // An empty or failed read never replaces the copy: a bulk write of none would drop the stored assignments.
  if (!projects.success || !projects.data || projects.data.length === 0) return;
  await trackerClient.upsertTeamProjects(organizationId, toLocalTeamProjectInputs(projects.data));
  notifyTeamProjectMirrorChanged();
}

/** One pass over the person's teams; resolves to each team's outcome, for tests and diagnostics. */
export async function shareToTeamsOnce(input: {
  readonly startOfDayMinutes: number;
  readonly focusClassification: TeamFocusClassification | null;
  readonly language?: ActivityBlockLabelLanguage;
  readonly isCurrent?: () => boolean;
  /** The signed-in account, under which each team's sharing status is kept on this computer. */
  readonly accountKey?: string | null;
}): Promise<ReadonlyMap<string, TeamAutoShareResult>> {
  const outcomes = new Map<string, TeamAutoShareResult>();
  const teams = await fetchOwnTeams();
  if (!teams.success) return outcomes;
  for (const team of teams.data) {
    if (input.isCurrent && !input.isCurrent()) break;
    const stored = await fetchTeamServerPolicy({ organization_id: team.organization_id });
    // A team without stored sharing keeps its Share button and is never sent anything automatically.
    if (!stored.success || !stored.data?.policy) continue;
    await mirrorTeamProjects(team.organization_id).catch(() => undefined);
    if (input.isCurrent && !input.isCurrent()) break;
    const result = await shareOwnTeamTime({
      organizationId: team.organization_id,
      displayName: team.member_display_name?.trim() || "Drifty member",
      policy: stored.data.policy,
      schedule: stored.data.schedule,
    }, { startOfDayMinutes: input.startOfDayMinutes, focusClassification: input.focusClassification, ...(input.language ? { language: input.language } : {}) })
      .catch((caught: unknown): TeamAutoShareResult => ({ status: "failed", error: caught instanceof Error ? caught.message : String(caught) }));
    outcomes.set(team.organization_id, result);
    if (input.accountKey) recordTeamShareResult(input.accountKey, team.organization_id, result);
    if (result.status === "shared") notifyTeamTimeShared(team.organization_id);
  }
  return outcomes;
}

/**
 * Shares this person's own time with each team that stores its sharing, inside the
 * team's hours (product decision 2026-10-18): shortly after the app opens, every half
 * hour and when the Teams page reloads its teams. A failed pass is tried again on the
 * next one; nothing is sent outside the Teams beta or while signed out.
 */
export function useTeamAutoShare({ enabled, accountKey, teamsKey, startOfDayMinutes, focusClassification, language }: UseTeamAutoShareInput): void {
  const requestRef = useRef(0);
  const runningRef = useRef(false);
  const includeAi = focusClassification?.includeAiClassifications ?? null;
  const includeHeuristics = focusClassification?.includeBuiltInHeuristics ?? null;
  const heuristicsSince = focusClassification?.builtInHeuristicsUnavailableSince ?? null;

  useEffect(() => {
    const request = ++requestRef.current;
    if (!enabled || !accountKey) return;
    const classification: TeamFocusClassification | null = includeAi === null ? null : {
      includeAiClassifications: includeAi,
      ...(includeHeuristics === null ? {} : { includeBuiltInHeuristics: includeHeuristics }),
      builtInHeuristicsUnavailableSince: heuristicsSince,
    };
    const isCurrent = () => requestRef.current === request;
    const run = () => {
      if (runningRef.current || !isCurrent()) return;
      runningRef.current = true;
      void shareToTeamsOnce({ startOfDayMinutes, focusClassification: classification, ...(language ? { language } : {}), isCurrent, accountKey })
        .catch(() => undefined)
        .finally(() => { runningRef.current = false; });
    };
    const first = setTimeout(run, TEAM_AUTO_SHARE_FIRST_DELAY_MS);
    const timer = setInterval(run, TEAM_AUTO_SHARE_INTERVAL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [accountKey, enabled, heuristicsSince, includeAi, includeHeuristics, language, startOfDayMinutes, teamsKey]);
}
