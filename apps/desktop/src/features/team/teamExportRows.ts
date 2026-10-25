/**
 * Settings › Export's file (owner decision 2026-10-22, as Rize and
 * RescueTime export): one table, a row per day, person and project, so a
 * spreadsheet sums and groups it however it likes. Rows follow the seat: a
 * person's rows only where people are shared to it, otherwise each team's
 * totals; focus as rows of its own only where the team shares focus.
 */
import type { TeamTotalsRow } from "./teamSharingService";
import { teamBoardCsvCell, teamBoardCsvHours } from "./teamBoardExport";
import { membersInContainer, type TeamFocusDataset } from "./teamFocusModel";
import type { TeamGroup } from "./teamTypes";

export type TeamExportRow = {
  readonly date: string;
  readonly team: string;
  /** Null where the seat sees the team's totals only. */
  readonly person: string | null;
  readonly project: string;
  readonly seconds: number;
  /** Where the row sits among a person's or team's day: projects, then unassigned time, then focus. */
  readonly order: 0 | 1 | 2;
};

/** What a seat may export, as the Dashboard decides it. */
export type TeamExportCut = {
  readonly people: boolean;
  readonly personFocus: boolean;
  readonly teamFocus: boolean;
  /** Where people are not shared: the teams whose totals the seat sees (id null for the open scope itself). */
  readonly teams: readonly { readonly id: string | null; readonly name: string }[];
};

export type TeamExportNames = {
  readonly projectName: (projectId: string | null) => string;
  readonly focusLabel: string;
};

function compareRows(left: TeamExportRow, right: TeamExportRow): number {
  return left.date.localeCompare(right.date)
    || left.team.localeCompare(right.team)
    || (left.person ?? "").localeCompare(right.person ?? "")
    || left.order - right.order
    || left.project.localeCompare(right.project);
}

/** The group directly under the open scope that holds a group, or null when the scope has none above it. */
function childOf(groups: readonly TeamGroup[], scopeId: string | null, groupId: string | null): TeamGroup | null {
  let current = groups.find((group) => group.id === groupId) ?? null;
  while (current && current.parent_group_id !== scopeId) {
    const parentId = current.parent_group_id;
    current = groups.find((group) => group.id === parentId) ?? null;
  }
  return current;
}

/** Rows from the records on hand (the preview), cut as the seat's Dashboard cuts them. */
export function teamExportRowsFromDataset(
  dataset: TeamFocusDataset,
  input: TeamExportNames & {
    readonly window: { readonly start_date: string; readonly end_date: string };
    readonly groupId: string | null;
    readonly scopeName: string;
    readonly cut: TeamExportCut;
  },
): TeamExportRow[] {
  const { window, groupId, scopeName, cut, projectName, focusLabel } = input;
  const members = new Map(membersInContainer(dataset.members, dataset.groups, groupId).map((member) => [member.member_key, member] as const));
  const inWindow = (day: string) => day >= window.start_date && day <= window.end_date;
  const teamOf = (memberKey: string) => {
    const member = members.get(memberKey);
    const child = member ? childOf(dataset.groups, groupId, member.group_id) : null;
    return child ? { id: child.id as string | null, name: child.name } : { id: null, name: scopeName };
  };
  const rows: TeamExportRow[] = [];
  if (cut.people) {
    for (const day of dataset.projectDays) {
      const member = members.get(day.member_key);
      if (!member || !inWindow(day.activity_date) || day.seconds <= 0) continue;
      rows.push({ date: day.activity_date, team: teamOf(day.member_key).name, person: member.display_name, project: projectName(day.organization_project_id), seconds: day.seconds, order: day.organization_project_id === null ? 1 : 0 });
    }
    if (cut.personFocus) {
      for (const day of dataset.focusDays) {
        const member = members.get(day.member_key);
        if (!member || !inWindow(day.activity_date) || day.focus_seconds <= 0) continue;
        rows.push({ date: day.activity_date, team: teamOf(day.member_key).name, person: member.display_name, project: focusLabel, seconds: day.focus_seconds, order: 2 });
      }
    }
    return rows.sort(compareRows);
  }
  // Team totals: each team the seat sees, summed by day and project.
  const shown = new Map(cut.teams.map((team) => [team.id, team.name] as const));
  const sums = new Map<string, TeamExportRow>();
  const add = (date: string, memberKey: string, project: string, seconds: number, order: 0 | 1 | 2) => {
    const team = teamOf(memberKey);
    const name = shown.get(team.id) ?? (team.id !== null ? undefined : shown.get(null));
    if (name === undefined || seconds <= 0) return;
    const key = date + "\n" + name + "\n" + project;
    const previous = sums.get(key);
    sums.set(key, { date, team: name, person: null, project, seconds: (previous?.seconds ?? 0) + seconds, order });
  };
  for (const day of dataset.projectDays) {
    if (members.has(day.member_key) && inWindow(day.activity_date)) add(day.activity_date, day.member_key, projectName(day.organization_project_id), day.seconds, day.organization_project_id === null ? 1 : 0);
  }
  if (cut.teamFocus) {
    for (const day of dataset.focusDays) {
      if (members.has(day.member_key) && inWindow(day.activity_date)) add(day.activity_date, day.member_key, focusLabel, day.focus_seconds, 2);
    }
  }
  return [...sums.values()].sort(compareRows);
}

/** Rows from the server's figures, already cut to the seat: people's where it sent them, the team's otherwise. */
export function teamExportRowsFromTotals(totals: readonly TeamTotalsRow[], input: TeamExportNames & { readonly scopeName: string }): TeamExportRow[] {
  const { scopeName, projectName, focusLabel } = input;
  const hasPeople = totals.some((row) => row.row_kind === "member_project");
  const hasPeopleFocus = totals.some((row) => row.row_kind === "member_focus");
  const rows: TeamExportRow[] = [];
  for (const row of totals) {
    if (row.seconds <= 0) continue;
    const focus = row.row_kind === "team_focus" || row.row_kind === "member_focus";
    const project = focus ? focusLabel : projectName(row.organization_project_id);
    const order = focus ? 2 : row.organization_project_id === null ? 1 : 0;
    if (row.row_kind === "member_project" || row.row_kind === "member_focus") {
      rows.push({ date: row.activity_date, team: scopeName, person: row.member_display_name ?? "", project, seconds: row.seconds, order });
    } else if ((row.row_kind === "team_project" && !hasPeople) || (row.row_kind === "team_focus" && !hasPeopleFocus)) {
      rows.push({ date: row.activity_date, team: scopeName, person: null, project, seconds: row.seconds, order });
    }
  }
  return rows.sort(compareRows);
}

/** The file: a header and a row each; the person column only where there are people's rows. */
export function teamExportCsv(rows: readonly TeamExportRow[], header: { readonly date: string; readonly team: string; readonly person: string; readonly project: string; readonly hours: string }): string {
  const people = rows.some((row) => row.person !== null);
  const head = people ? [header.date, header.team, header.person, header.project, header.hours] : [header.date, header.team, header.project, header.hours];
  const body = rows.map((row) => (people
    ? [row.date, row.team, row.person ?? "", row.project, teamBoardCsvHours(row.seconds)]
    : [row.date, row.team, row.project, teamBoardCsvHours(row.seconds)]));
  return [head, ...body].map((cells) => cells.map(teamBoardCsvCell).join(",")).join("\r\n");
}
