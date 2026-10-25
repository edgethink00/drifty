import type { TeamFocusDataset } from "./teamFocusModel";
import type { TeamGroup } from "./teamTypes";
import type { TeamGroupEdits } from "./useTeamController";

export const NO_TEAM_GROUP_EDITS: TeamGroupEdits = { names: {}, parents: {}, deleted: {} };

/** Whether a team sits inside another, at any depth. */
export function isTeamGroupWithin(groups: readonly TeamGroup[], id: string, ancestor: string): boolean {
  const byId = new Map(groups.map((group) => [group.id, group]));
  let current = byId.get(id)?.parent_group_id ?? null;
  while (current) {
    if (current === ancestor) return true;
    current = byId.get(current)?.parent_group_id ?? null;
  }
  return false;
}

/**
 * The organization's data with Settings › Teams applied: renamed and moved teams, and deleted
 * ones gone, their people moved where the admin chose (or to no team) and their own teams
 * under the deleted team's parent. Each team's size counts its people and its teams' people.
 */
export function applyTeamGroupEdits(dataset: TeamFocusDataset, edits: TeamGroupEdits | undefined): TeamFocusDataset {
  if (!edits || (Object.keys(edits.names).length === 0 && Object.keys(edits.parents).length === 0 && Object.keys(edits.deleted).length === 0)) return dataset;
  const deleted = edits.deleted;
  const original = new Map(dataset.groups.map((group) => [group.id, group]));
  // A deleted team's own teams go up to the nearest team that remains.
  const surviving = (id: string | null): string | null => {
    let current = id;
    while (current && current in deleted) current = (edits.parents[current] !== undefined ? edits.parents[current] : original.get(current)?.parent_group_id) ?? null;
    return current;
  };
  const destination = (id: string | null): string | null => {
    let current = id;
    const seen = new Set<string>();
    while (current && current in deleted && !seen.has(current)) {
      seen.add(current);
      current = deleted[current] ?? null;
    }
    return current && current in deleted ? null : current;
  };
  const kept = dataset.groups
    .filter((group) => !(group.id in deleted))
    .map((group) => {
      const parent = edits.parents[group.id] !== undefined ? edits.parents[group.id]! : group.parent_group_id;
      return { ...group, name: edits.names[group.id] ?? group.name, parent_group_id: surviving(parent) };
    });
  const members = dataset.members.map((member) => (member.group_id && member.group_id in deleted ? { ...member, group_id: destination(member.group_id) } : member));
  const groups = kept.map((group) => ({
    ...group,
    member_count: members.filter((member) => member.group_id === group.id || (member.group_id !== null && isTeamGroupWithin(kept, member.group_id, group.id))).length,
  }));
  return { ...dataset, groups, members };
}
