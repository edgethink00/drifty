/**
 * How the Overview lists the people of a container: a grid of tiles or one
 * line per person. Either way a person is a name and one figure; their days
 * and blocks are on their own page. The choice is the viewer's, kept on this
 * device, and switched from the members section head.
 */
export const TEAM_MEMBERS_LAYOUTS = ["grid", "list"] as const;
export type TeamMembersLayout = typeof TEAM_MEMBERS_LAYOUTS[number];

export const DEFAULT_TEAM_MEMBERS_LAYOUT: TeamMembersLayout = "grid";
export const TEAM_MEMBERS_LAYOUT_STORAGE_KEY = "drifty.team.membersLayout";

export function parseTeamMembersLayout(value: unknown): TeamMembersLayout | null {
  return typeof value === "string" && (TEAM_MEMBERS_LAYOUTS as readonly string[]).includes(value)
    ? value as TeamMembersLayout
    : null;
}

export function readTeamMembersLayout(): TeamMembersLayout {
  if (typeof window === "undefined") return DEFAULT_TEAM_MEMBERS_LAYOUT;
  try {
    return parseTeamMembersLayout(window.localStorage.getItem(TEAM_MEMBERS_LAYOUT_STORAGE_KEY)) ?? DEFAULT_TEAM_MEMBERS_LAYOUT;
  } catch {
    return DEFAULT_TEAM_MEMBERS_LAYOUT;
  }
}

export function writeTeamMembersLayout(layout: TeamMembersLayout): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEAM_MEMBERS_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // The choice still applies for this session.
  }
}

