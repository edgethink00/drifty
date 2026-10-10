import type { TeamProjectMemberRow } from "./teamTypes";

/**
 * Groups breakdown rows by member. The server's member_slot keeps two people who
 * share under the same name apart; an older server without it falls back to the
 * display name, which was the previous behavior.
 */
export function teamMemberGroupKey(row: TeamProjectMemberRow): string {
  return row.member_slot === null ? `name:${row.member_display_name}` : `slot:${row.member_slot}`;
}

/** The server marks the caller's own rows; an older server is matched by name. */
export function isOwnTeamMemberRow(row: TeamProjectMemberRow, memberDisplayName: string | null): boolean {
  return row.is_self ?? row.member_display_name === memberDisplayName;
}
