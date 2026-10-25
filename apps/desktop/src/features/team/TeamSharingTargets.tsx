import { useLocalization } from "../localization/LocalizationContext";
import { SettingsSelect } from "../settings/SettingsSelect";
import { Toggle } from "../../components/Toggle";
import { PRESET_KEYS, SHARE_LEVEL_KEYS } from "./TeamSharingPolicyEditor";
import {
  TEAM_SHARE_FIELDS,
  groupHasOwnSharingPolicy,
  matchingSharingPreset,
  sharingPolicyForGroup,
  type TeamGroupSharingPolicies,
  type TeamSharingPolicy,
} from "./teamSharingPolicy";
import type { TeamGroup } from "./teamTypes";

type Translate = ReturnType<typeof useLocalization>["t"];

/** The value the target menu uses for the organization's default. */
export const DEFAULT_SHARING_TARGET = "__default__";

/** Teams, not divisions: the groups people sit in, named with their division. */
export function leafSharingTeams(groups: readonly TeamGroup[]): readonly { readonly group: TeamGroup; readonly label: string }[] {
  return groups
    .filter((group) => !groups.some((child) => child.parent_group_id === group.id))
    .map((group) => {
      const parent = group.parent_group_id ? groups.find((candidate) => candidate.id === group.parent_group_id) ?? null : null;
      return { group, label: parent ? parent.name + " / " + group.name : group.name };
    });
}

/** A combination's name, or "Picked item by item" when the items match none. */
export function sharingPolicyLabel(policy: TeamSharingPolicy, t: Translate): string {
  const preset = matchingSharingPreset(policy);
  return preset ? t(PRESET_KEYS[preset].title) : t("team.sharingTargets.custom");
}

export type TeamSharingTarget = { readonly group: TeamGroup; readonly label: string; readonly kind: "division" | "team" };

/**
 * Every group sharing can be set on, in the organization's order: a division
 * and then its teams, as an admin console lists units. A team inherits its
 * division's choice until it has its own.
 */
export function sharingTargets(groups: readonly TeamGroup[]): readonly TeamSharingTarget[] {
  const targets: TeamSharingTarget[] = [];
  const seen = new Set<string>();
  const visit = (group: TeamGroup, parent: TeamGroup | null) => {
    if (seen.has(group.id)) return;
    seen.add(group.id);
    const children = groups.filter((child) => child.parent_group_id === group.id);
    targets.push({ group, label: parent ? parent.name + " / " + group.name : group.name, kind: children.length > 0 ? "division" : "team" });
    children.forEach((child) => visit(child, group));
  };
  groups.filter((group) => group.parent_group_id === null || !groups.some((parent) => parent.id === group.parent_group_id)).forEach((group) => visit(group, null));
  return targets;
}

/** The nearest group above this one with its own sharing; null when it comes from the organization's default. */
export function sharingSource(groupPolicies: TeamGroupSharingPolicies | null, groups: readonly TeamGroup[], groupId: string): TeamGroup | null {
  const seen = new Set<string>();
  let current = groups.find((group) => group.id === groupId)?.parent_group_id ?? null;
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    if (groupHasOwnSharingPolicy(groupPolicies, current)) return groups.find((group) => group.id === current) ?? null;
    current = groups.find((group) => group.id === current)?.parent_group_id ?? null;
  }
  return null;
}

export type TeamSharingTargetBarProps = {
  readonly groups: readonly TeamGroup[];
  readonly groupPolicies: TeamGroupSharingPolicies | null;
  /** DEFAULT_SHARING_TARGET or a team's group id. */
  readonly target: string;
  readonly onTarget: (next: string) => void;
  /** For a team: whether it follows the default (or its division) instead of its own policy. */
  readonly follow: boolean;
  readonly onFollow: (next: boolean) => void;
  readonly disabled?: boolean;
  /** Teams with unsaved changes, marked in the menu. */
  readonly editedTeams?: readonly string[];
  /** The table candidate opens one row at a time: a way back to every team instead of the menu. */
  readonly onBack?: () => void;
};

/**
 * Candidate A for many teams: one menu above the sharing table picks the
 * organization's default, a division or one team, and the same table edits
 * it. A team follows its division (or the default) until it is switched to its
 * own policy, and says which one it follows.
 */
export function TeamSharingTargetBar({ groups, groupPolicies, target, onTarget, follow, onFollow, disabled = false, editedTeams = [], onBack }: TeamSharingTargetBarProps): JSX.Element {
  const { t } = useLocalization();
  const targets = sharingTargets(groups);
  const own = targets.filter((entry) => groupHasOwnSharingPolicy(groupPolicies, entry.group.id));
  const options = [
    { value: DEFAULT_SHARING_TARGET, label: t("team.sharingTargets.default") },
    ...targets.map((entry) => ({
      value: entry.group.id,
      label: entry.label,
      statusLabel: editedTeams.includes(entry.group.id)
        ? t("team.sharingTargets.edited")
        : groupHasOwnSharingPolicy(groupPolicies, entry.group.id) ? t("team.sharingTargets.ownShort")
        : entry.kind === "division" ? t("team.sharingTargets.division") : undefined,
    })),
  ];
  const isTeam = target !== DEFAULT_SHARING_TARGET;
  const current = isTeam ? targets.find((entry) => entry.group.id === target) ?? null : null;
  const targetName = current ? current.label : t("team.sharingTargets.default");
  const source = current ? sharingSource(groupPolicies, groups, current.group.id) : null;
  const followLabel = source ? t("team.sharingTargets.followFrom", { source: source.name }) : t("team.sharingTargets.follow");
  const targetHint = current?.kind === "division"
    ? follow ? t("team.sharingTargets.divisionFollowingHint") : t("team.sharingTargets.divisionOwnHint")
    : follow
      ? source ? t("team.sharingTargets.followingFrom", { source: source.name }) : t("team.sharingTargets.followingHint")
      : t("team.sharingTargets.ownHint");
  return (
    <div className="team-sharing-target">
      <div className="team-sharing-target__row">
        {onBack ? (
          <>
            <button type="button" className="team-sharing-target__back" onClick={onBack}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
              {t("team.sharingTargets.allTeams")}
            </button>
            <strong className="team-sharing-target__name">{targetName}</strong>
          </>
        ) : (
          <>
            <span className="team-sharing-target__label">{t("team.sharingTargets.label")}</span>
            <SettingsSelect ariaLabel={t("team.sharingTargets.label")} className="projects-status-filter team-sharing-target__select" value={target} options={options} onChange={onTarget} />
          </>
        )}
        {isTeam ? (
          <label className="team-sharing-target__follow">
            <span>{followLabel}</span>
            <Toggle checked={follow} disabled={disabled} onChange={onFollow} ariaLabel={followLabel} />
          </label>
        ) : null}
      </div>
      <p className="team-sharing-target__hint">
        {isTeam
          ? targetHint
          : own.length > 0
            ? t("team.sharingTargets.exceptions", { count: own.length, teams: own.slice(0, 3).map((entry) => entry.group.name).join(", ") + (own.length > 3 ? " " + t("team.managers.more", { count: own.length - 3 }) : "") })
            : t("team.sharingTargets.noExceptions")}
      </p>
    </div>
  );
}

export type TeamSharingTeamsTableProps = {
  readonly groups: readonly TeamGroup[];
  readonly defaultPolicy: TeamSharingPolicy;
  readonly groupPolicies: TeamGroupSharingPolicies | null;
  readonly memberCounts: Readonly<Record<string, number>>;
  readonly onOpen: (target: string) => void;
  readonly editedTeams?: readonly string[];
};

/**
 * Candidate B for many teams: every team in one table with what it shares,
 * the default on top. Teams on the default read lighter, so the exceptions
 * stand out; a row opens the same editor for that team.
 */
export function TeamSharingTeamsTable({ groups, defaultPolicy, groupPolicies, memberCounts, onOpen, editedTeams = [] }: TeamSharingTeamsTableProps): JSX.Element {
  const { t } = useLocalization();
  const targets = sharingTargets(groups);
  const fieldTitle = { projects: t("team.policy.field.projects"), tasks: t("team.policy.field.tasks"), focus: t("team.policy.field.focus") } as const;
  const row = (key: string, name: string, sub: string | null, policy: TeamSharingPolicy, own: boolean, isDefault: boolean, source: TeamGroup | null = null, division = false) => (
    <tr key={key} className={"team-sharing-teams__row" + (own || isDefault ? "" : " is-inherited") + (isDefault ? " is-default" : "") + (division ? " is-division" : "")}>
      <th scope="row">
        <button type="button" className="team-sharing-teams__open" onClick={() => onOpen(key)}>
          <span className="team-sharing-teams__name">{name}</span>
          {sub ? <span className="team-sharing-teams__sub">{sub}</span> : null}
        </button>
      </th>
      {TEAM_SHARE_FIELDS.map((field) => (
        <td key={field} className={policy[field] === "off" ? "is-off" : undefined}>{t(SHARE_LEVEL_KEYS[policy[field]])}</td>
      ))}
      <td>{policy.memberSummary ? t("team.policy.memberSummaryOn") : t("team.policy.memberSummaryOff")}</td>
      <td className="team-sharing-teams__state">
        {editedTeams.includes(key) ? <span className="chip team-sharing-teams__chip">{t("team.sharingTargets.edited")}</span>
          : isDefault ? null
          : own ? <span className="chip team-sharing-teams__chip">{t("team.sharingTargets.ownShort")}</span>
          : <span className="team-sharing-teams__muted">{source ? t("team.sharingTargets.followFromShort", { source: source.name }) : t("team.sharingTargets.followShort")}</span>}
      </td>
    </tr>
  );
  return (
    <div className="team-sharing-teams">
      <table className="team-sharing-teams__table">
        <thead>
          <tr>
            <th scope="col">{t("team.sharingTargets.colTeam")}</th>
            {TEAM_SHARE_FIELDS.map((field) => <th key={field} scope="col">{fieldTitle[field]}</th>)}
            <th scope="col">{t("team.policy.membersTitle")}</th>
            <th scope="col"><span className="sr-only">{t("team.sharingTargets.colState")}</span></th>
          </tr>
        </thead>
        <tbody>
          {row(DEFAULT_SHARING_TARGET, t("team.sharingTargets.default"), sharingPolicyLabel(defaultPolicy, t), defaultPolicy, false, true)}
          {targets.map((entry) => {
            const own = groupHasOwnSharingPolicy(groupPolicies, entry.group.id);
            const policy = sharingPolicyForGroup(defaultPolicy, groupPolicies, groups, entry.group.id);
            const count = memberCounts[entry.group.id];
            const sub = entry.kind === "division" ? t("team.sharingTargets.division") : count !== undefined ? t("team.settings.memberCount", { count }) : null;
            return row(entry.group.id, entry.label, sub, policy, own, false, sharingSource(groupPolicies, groups, entry.group.id), entry.kind === "division");
          })}
        </tbody>
      </table>
      <p className="team-sharing-target__hint">{t("team.sharingTargets.tableHint")}</p>
    </div>
  );
}

