import type { TeamFocusDataset, TeamWindow } from "./teamFocusModel";
import { isOwnTeamMemberRow, teamMemberGroupKey } from "./teamMemberIdentity";
import type { TeamTotalsRow } from "./teamSharingService";
import type { TeamDirectoryMember, TeamMemberProjectDay, TeamProjectMemberRow } from "./teamTypes";

/**
 * Builds a focus dataset from the project-totals breakdown a current server
 * returns, so the new dashboards render for a team whose server shares only
 * projects. Rows carry window totals, so they land on the window's last day;
 * focus days and presence stay empty until the server shares them.
 */
export function datasetFromProjectRows(
  rows: readonly TeamProjectMemberRow[],
  window: TeamWindow,
  memberDisplayName: string | null,
): TeamFocusDataset {
  const members = new Map<string, TeamDirectoryMember>();
  const projectDays: TeamMemberProjectDay[] = [];
  for (const row of rows) {
    const key = row.member_key ?? teamMemberGroupKey(row);
    if (!members.has(key)) {
      members.set(key, {
        member_key: key,
        display_name: row.member_display_name,
        role_label: "",
        membership_role: "member",
        group_id: null,
        is_self: isOwnTeamMemberRow(row, memberDisplayName),
        weekly_goal_seconds: null,
      });
    }
    if (row.seconds > 0) {
      projectDays.push({ member_key: key, organization_project_id: row.organization_project_id, activity_date: window.end_date, seconds: row.seconds });
    }
  }
  return { members: [...members.values()], groups: [], focusDays: [], projectDays, presence: [] };
}

/**
 * Builds the dataset from the per-day figures a server that stores sharing
 * returns, already cut to the seat: people's project time and focus by day.
 * The server sends day totals only, so a focus day has no blocks; a day with
 * focus counts as tracked. Team-only rows (a seat that sees totals but not
 * people) are left to the project mix for now.
 */
export function datasetFromTeamTotals(rows: readonly TeamTotalsRow[]): TeamFocusDataset {
  const members = new Map<string, TeamDirectoryMember>();
  const projectDays: TeamMemberProjectDay[] = [];
  const focusDays: TeamFocusDataset["focusDays"][number][] = [];
  for (const row of rows) {
    if (row.row_kind !== "member_project" && row.row_kind !== "member_focus") continue;
    if (!row.member_key) continue;
    if (!members.has(row.member_key)) {
      members.set(row.member_key, {
        member_key: row.member_key,
        display_name: row.member_display_name ?? "",
        role_label: "",
        membership_role: "member",
        group_id: null,
        is_self: row.is_self,
        weekly_goal_seconds: null,
      });
    }
    if (row.seconds <= 0) continue;
    if (row.row_kind === "member_project") {
      projectDays.push({ member_key: row.member_key, organization_project_id: row.organization_project_id, activity_date: row.activity_date, seconds: row.seconds });
    } else {
      focusDays.push({
        member_key: row.member_key,
        activity_date: row.activity_date,
        focus_seconds: row.seconds,
        tracked_seconds: row.seconds,
        deep_block_count: 0,
        deep_block_seconds: 0,
        longest_block_seconds: 0,
        longest_block_start_minute: null,
        blocks: null,
      });
    }
  }
  return { members: [...members.values()], groups: [], focusDays, projectDays, presence: [] };
}

