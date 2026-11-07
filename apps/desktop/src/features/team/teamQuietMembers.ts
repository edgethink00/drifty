/**
 * Teammates whose computers sent the team nothing lately (owner decision 2026-11-07): an
 * organization admin sees how many of the team's people have no shared record in the last
 * seven days, as a count only, so a closed or outdated app, or Teams turned off, does not
 * leave the team's pages quietly empty. It reads only what the seat already reads.
 */
import { useEffect, useState } from "react";
import { logicalDayIsoDateForDate, shiftIsoDate } from "@drifty/domain";

import { subscribeTeamTimeShared } from "../../lib/teamProjectMirrorEvents";
import { fetchTeamTotals, type TeamTotalsRow } from "./teamSharingService";

export const TEAM_QUIET_DAYS = 7;
/** Someone who joined this recently has not had a chance to share yet. */
const NEW_MEMBER_GRACE_MS = 24 * 60 * 60 * 1000;

export type TeamQuietRosterMember = { readonly member_key: string; readonly joined_at: string };

/** The people of the roster, past their first day, with no shared record in the window's rows. */
export function quietTeamMemberCount(
  roster: readonly TeamQuietRosterMember[],
  rows: readonly Pick<TeamTotalsRow, "row_kind" | "member_key" | "seconds">[],
  nowMs: number,
): number {
  const sharing = new Set(rows
    .filter((row) => (row.row_kind === "member_project" || row.row_kind === "member_focus") && row.member_key && row.seconds > 0)
    .map((row) => row.member_key));
  return roster.filter((member) => {
    const joined = Date.parse(member.joined_at);
    return Number.isFinite(joined) && nowMs - joined >= NEW_MEMBER_GRACE_MS && !sharing.has(member.member_key);
  }).length;
}

export function teamQuietWindow(nowMs: number, startOfDayMinutes: number): { readonly start_date: string; readonly end_date: string } {
  const today = logicalDayIsoDateForDate(new Date(nowMs), startOfDayMinutes);
  return { start_date: shiftIsoDate(today, -(TEAM_QUIET_DAYS - 1)), end_date: today };
}

/** The count for an organization admin of a team that shares people's records; null when it does not apply or could not be read. */
export function useTeamQuietMembers({ enabled, organizationId, roster, startOfDayMinutes }: {
  readonly enabled: boolean;
  readonly organizationId: string | null;
  readonly roster: readonly TeamQuietRosterMember[] | null;
  readonly startOfDayMinutes: number;
}): number | null {
  const [count, setCount] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  const rosterKey = roster ? roster.map((member) => member.member_key + "@" + member.joined_at).join(",") : null;

  useEffect(() => subscribeTeamTimeShared((sharedId) => {
    if (sharedId === organizationId) setVersion((value) => value + 1);
  }), [organizationId]);

  useEffect(() => {
    setCount(null);
    if (!enabled || !organizationId || !roster || roster.length === 0) return;
    let current = true;
    const nowMs = Date.now();
    void fetchTeamTotals({ organization_id: organizationId, ...teamQuietWindow(nowMs, startOfDayMinutes) })
      .then((result) => {
        if (current && result.success) setCount(quietTeamMemberCount(roster, result.data, nowMs));
      })
      .catch(() => undefined);
    return () => { current = false; };
    // The roster is compared by its key, so a fresh array with the same people reads nothing again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, organizationId, rosterKey, startOfDayMinutes, version]);

  return count;
}
