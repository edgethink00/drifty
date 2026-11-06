import { useCallback, useMemo, useState } from "react";

import { shiftIsoDate } from "@drifty/domain";

import { logicalTodayIsoDate } from "../../lib/formatting";
import { getTeamFocusWindow } from "./teamAggregate";
import type { TeamFocusDataset } from "./teamFocusModel";
import { DEFAULT_TEAM_RECORDING_SCHEDULE, type TeamSharingScope, type TeamTrackingPolicy } from "./teamSharingScope";
import {
  legacyScopeForPolicy,
  policyForLegacyScope,
  policyForPreset,
  type TeamGroupSharingPolicies,
  type TeamManagerAssignment,
  type TeamSharingPolicy,
  type TeamSharingWindow,
} from "./teamSharingPolicy";
import {
  DEFAULT_TEAM_PREVIEW_SCENARIO,
  buildTeamPreviewFixture,
  parseTeamPreviewScenario,
  teamPreviewScenarioKey,
  type TeamPreviewFixture,
  type TeamPreviewScenario,
} from "./teamPreviewScenarios";
import type { OwnEmailInvite, OwnTeam, TeamEmailInvite, TeamEmailInviteResult, TeamGroup, TeamMember, TeamMembershipRole, TeamPeriod, TeamProject, TeamProjectMemberRow, TeamProjectMixRow } from "./teamTypes";
import { canInviteToTeam, isTeamAdmin } from "./teamTypes";
import { NO_TEAM_GROUP_EDITS } from "./teamGroupEdits";
import type { TeamGroupEdits, UseTeamControllerResult } from "./useTeamController";
import type { TeamProjectsWindow, UseTeamProjectsResult } from "./useTeamProjects";

/**
 * Dev-mode team preview: a scenario picked in Dev settings replaces the live
 * team controller and data with a deterministic fixture, so every team screen
 * can be reviewed without an account, teammates or a server. Nothing is
 * published while a preview is active, and the surface says so.
 *
 * `VITE_TEAM_QA_MOCK=1` on a dev server forces the default scenario on without
 * Dev mode; the flag requires `import.meta.env.DEV`, so release builds cannot
 * enable it.
 */
export const TEAM_PREVIEW_STORAGE_KEY = "drifty.dev.teamPreview";

export function isTeamQaMockEnabled(): boolean {
  return Boolean(import.meta.env.DEV) && import.meta.env.VITE_TEAM_QA_MOCK === "1";
}

export function resolveInitialTeamPreviewScenario(): TeamPreviewScenario | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEAM_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    return parseTeamPreviewScenario(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function persistTeamPreviewScenario(scenario: TeamPreviewScenario | null): void {
  if (typeof window === "undefined") return;
  try {
    if (scenario) window.localStorage.setItem(TEAM_PREVIEW_STORAGE_KEY, JSON.stringify(scenario));
    else window.localStorage.removeItem(TEAM_PREVIEW_STORAGE_KEY);
  } catch {
    // Persistence is optional; the preview still applies for this session.
  }
}

/** The scenario in effect: the Dev-settings choice, or the dev-server flag's default. */
export function resolveEffectiveTeamPreviewScenario(
  devModeActive: boolean,
  scenario: TeamPreviewScenario | null,
): TeamPreviewScenario | null {
  if (devModeActive && scenario) return scenario;
  if (isTeamQaMockEnabled()) return scenario ?? DEFAULT_TEAM_PREVIEW_SCENARIO;
  return null;
}

export type TeamPreviewClock = {
  readonly today: string;
  readonly nowMinuteOfDay: number;
  readonly nowMs: number;
};

/** The preview pretends it is mid-afternoon, so today reads as a partial workday at any real hour. */
export const TEAM_PREVIEW_NOW_MINUTE = 14 * 60 + 10;

export function resolveTeamPreviewClock(startOfDayMinutes: number, now = new Date(), preview = false): TeamPreviewClock {
  return {
    today: logicalTodayIsoDate(startOfDayMinutes),
    nowMinuteOfDay: preview ? TEAM_PREVIEW_NOW_MINUTE : now.getHours() * 60 + now.getMinutes(),
    nowMs: preview ? previewNowMs(now) : now.getTime(),
  };
}

function previewNowMs(now: Date): number {
  const pinned = new Date(now);
  pinned.setHours(Math.floor(TEAM_PREVIEW_NOW_MINUTE / 60), TEAM_PREVIEW_NOW_MINUTE % 60, 0, 0);
  return pinned.getTime();
}

const NO_KEYS: readonly string[] = [];
const NO_EMAIL_INVITES: readonly TeamEmailInvite[] = [];
const NO_OWN_EMAIL_INVITES: readonly OwnEmailInvite[] = [];
/** A preview send waits about as long as a real one, so its busy state shows. */
const PREVIEW_SEND_DELAY_MS = 650;

const fixtureCache = new Map<string, TeamPreviewFixture>();

export function useTeamPreviewFixture(scenario: TeamPreviewScenario | null, startOfDayMinutes: number): TeamPreviewFixture | null {
  // The fixture is keyed by scenario and day; the minute of day only shapes
  // today's partial numbers, so it is read once per fixture build.
  const clock = useMemo(() => resolveTeamPreviewClock(startOfDayMinutes, new Date(), true), [startOfDayMinutes]);
  return useMemo(() => {
    if (!scenario) return null;
    const key = teamPreviewScenarioKey(scenario) + "@" + clock.today;
    const cached = fixtureCache.get(key);
    if (cached) return cached;
    const fixture = buildTeamPreviewFixture({ scenario, ...clock });
    fixtureCache.set(key, fixture);
    return fixture;
  }, [clock, scenario]);
}

export function useTeamPreviewController(fixture: TeamPreviewFixture | null): UseTeamControllerResult {
  const [membersCanInvite, setMembersCanInvite] = useState(true);
  // Settings changed in the preview apply on top of the scenario until it changes.
  const [overrides, setOverrides] = useState<PreviewOverrides | null>(null);
  const [managerState, setManagerState] = useState<{ readonly key: string; readonly managers: readonly TeamManagerAssignment[] } | null>(null);
  // Settings belong to the organization, so switching who is looking keeps them: an admin's
  // change previews at once from a member's seat. Picking another combination in Dev starts over.
  const scenarioKey = fixture
    ? [fixture.scenario.scale, fixture.scenario.scope, fixture.scenario.policy, fixture.scenario.sharing ?? "", String(fixture.scenario.memberSummary ?? true)].join("/")
    : null;
  const active = overrides && overrides.key === scenarioKey ? overrides : null;
  const team = useMemo<OwnTeam | null>(() => {
    if (!fixture) return null;
    const policy = active?.policy ?? fixture.team.tracking_policy ?? "free";
    const memberSummary = fixture.scenario.memberSummary ?? true;
    const scenarioSharing = fixture.scenario.sharing
      ? policyForPreset(fixture.scenario.sharing, memberSummary)
      : { ...policyForLegacyScope(active?.scope ?? fixture.team.sharing_scope ?? fixture.scenario.scope), memberSummary };
    const sharing = active?.sharing ?? scenarioSharing;
    const window = active?.window ?? fixture.team.recording_schedule ?? DEFAULT_TEAM_RECORDING_SCHEDULE;
    // Teams on their own sharing: the scenario's starting ones, then any an admin changed in settings
    // (null puts one back on the default), then any a manager narrowed under a decision candidate.
    const adminGroupPolicies: Record<string, TeamSharingPolicy> = {};
    for (const [groupId, preset] of Object.entries(fixture.groupSharing)) adminGroupPolicies[groupId] = policyForPreset(preset, memberSummary);
    for (const [groupId, policy] of Object.entries(active?.groupSharing ?? {})) {
      if (policy) adminGroupPolicies[groupId] = policy;
      else delete adminGroupPolicies[groupId];
    }
    const groupPolicies: Record<string, TeamSharingPolicy> = { ...adminGroupPolicies };
    for (const [groupId, policy] of Object.entries(active?.managerGroupSharing ?? {})) if (policy) groupPolicies[groupId] = policy;
    return {
      ...fixture.team,
      organization_name: active?.name ?? fixture.team.organization_name,
      // Handing the team over leaves the previous owner an organization admin.
      membership_role: active?.owner && fixture.team.membership_role === "owner" ? "admin" : fixture.team.membership_role,
      members_can_invite: membersCanInvite,
      sharing_scope: active?.sharing || fixture.scenario.sharing ? legacyScopeForPolicy(sharing) : active?.scope ?? fixture.team.sharing_scope ?? null,
      sharing_policy: sharing,
      group_sharing_policies: groupPolicies as TeamGroupSharingPolicies,
      group_sharing_admin_policies: adminGroupPolicies as TeamGroupSharingPolicies,
      sharing_window: window,
      tracking_policy: policy,
      // The team's hours apply under either tracking policy; the dashboards read them for expected days.
      recording_schedule: window,
    };
  }, [active, fixture, membersCanInvite]);
  // A deleted team leaves the list at once and waits 30 days for its owner to restore it.
  const purgeAfter = active?.purgeAfter ?? null;
  const teams = useMemo(() => (team && !purgeAfter ? [team] : []), [purgeAfter, team]);
  const scheduledDeletions = useMemo(() => (team && purgeAfter ? [{ organization_id: team.organization_id, organization_name: team.organization_name, purge_after: purgeAfter }] : []), [purgeAfter, team]);
  // Organization admins read the members; roles changed in the preview apply over the scenario's.
  const members = useMemo<readonly TeamMember[]>(() => {
    if (!fixture || !isTeamAdmin(team)) return [];
    const roleOf = (member: TeamMember): TeamMembershipRole => {
      if (active?.owner) {
        if (member.member_key === active.owner) return "owner";
        if (member.membership_role === "owner") return "admin";
      }
      return active?.roles?.[member.member_key] ?? member.membership_role;
    };
    // Someone removed in the preview leaves the roster; what they shared stays (2026-10-25).
    const gone = new Set([...Object.keys(active?.former ?? {}), ...(active?.purged ?? [])]);
    return fixture.roster.filter((member) => !gone.has(member.member_key)).map((member) => ({ ...member, membership_role: roleOf(member) }));
  }, [active?.former, active?.owner, active?.purged, active?.roles, fixture, team]);
  const formerMembers = useMemo(() => Object.entries(active?.former ?? {}).map(([member_key, person]) => ({ member_key, ...person })), [active?.former]);
  const purgedMemberKeys = active?.purged ?? NO_KEYS;
  const invites = useMemo(() => (fixture && canInviteToTeam(team) && !(active?.revokedInvites ?? []).includes(fixture.invite.invite_id) ? [fixture.invite] : []), [active?.revokedInvites, fixture, team]);
  // Email invites sent in the preview stay until the scenario changes; no mail leaves.
  const [emailState, setEmailState] = useState<{ readonly key: string; readonly invites: readonly TeamEmailInvite[] } | null>(null);
  const emailInvites = emailState && emailState.key === scenarioKey && canInviteToTeam(team) ? emailState.invites : NO_EMAIL_INVITES;
  const handleSendEmailInvites = useCallback(async (input: { readonly organization_id: string; readonly emails: readonly string[] }) => {
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_SEND_DELAY_MS));
    const now = new Date();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const emails = [...new Set(input.emails.map((email) => email.trim().toLowerCase()))];
    const results: TeamEmailInviteResult[] = emails.map((email) => ({
      email,
      outcome: emailInvites.some((invite) => invite.invited_email === email && invite.status === "pending") ? "again" : "sent",
    }));
    if (scenarioKey) {
      const refreshed = emailInvites.map((invite) => (emails.includes(invite.invited_email) && invite.status === "pending"
        ? { ...invite, last_sent_at: nowIso, expires_at: expiresAt, send_count: invite.send_count + 1 }
        : invite));
      const added = results.filter((result) => result.outcome === "sent").map((result, index): TeamEmailInvite => ({
        invite_id: "qa-email-invite-" + now.getTime() + "-" + index,
        invited_email: result.email,
        status: "pending",
        expires_at: expiresAt,
        last_sent_at: nowIso,
        send_count: 1,
        created_at: nowIso,
        sent_by_me: true,
      }));
      setEmailState({ key: scenarioKey, invites: [...added, ...refreshed] });
    }
    return { ok: true as const, results };
  }, [emailInvites, scenarioKey]);
  const handleCancelEmailInvite = useCallback(async (input: { readonly invite_id: string }) => {
    if (!scenarioKey) return false;
    setEmailState({ key: scenarioKey, invites: emailInvites.filter((invite) => invite.invite_id !== input.invite_id) });
    return true;
  }, [emailInvites, scenarioKey]);
  const noop = useCallback(async () => undefined, []);
  const ok = useCallback(async () => true, []);
  const handleSetMemberInvites = useCallback(async (input: { readonly organization_id: string; readonly enabled: boolean }) => {
    setMembersCanInvite(input.enabled);
  }, []);
  const handleSetSharingScope = useCallback(async (input: { readonly organization_id: string; readonly sharing_scope: TeamSharingScope }) => {
    if (scenarioKey) setOverrides((current) => ({ ...(current?.key === scenarioKey ? current : {}), key: scenarioKey, scope: input.sharing_scope }));
  }, [scenarioKey]);
  const handleSetTrackingPolicy = useCallback(async (input: { readonly organization_id: string; readonly tracking_policy: TeamTrackingPolicy }) => {
    if (scenarioKey) setOverrides((current) => ({ ...(current?.key === scenarioKey ? current : {}), key: scenarioKey, policy: input.tracking_policy }));
  }, [scenarioKey]);
  const handleSetSharingPolicy = useCallback(async (input: { readonly organization_id: string; readonly policy: TeamSharingPolicy }) => {
    if (scenarioKey) setOverrides((current) => ({ ...(current?.key === scenarioKey ? current : {}), key: scenarioKey, sharing: input.policy }));
  }, [scenarioKey]);
  const handleSetGroupSharingPolicy = useCallback(async (input: { readonly organization_id: string; readonly group_id: string; readonly policy: TeamSharingPolicy | null; readonly by?: "manager" }) => {
    if (scenarioKey) setOverrides((current) => {
      const base = current?.key === scenarioKey ? current : null;
      if (input.by === "manager") {
        return { ...(base ?? {}), key: scenarioKey, managerGroupSharing: { ...(base?.managerGroupSharing ?? {}), [input.group_id]: input.policy } };
      }
      // An admin's choice replaces whatever a manager had narrowed.
      return {
        ...(base ?? {}),
        key: scenarioKey,
        groupSharing: { ...(base?.groupSharing ?? {}), [input.group_id]: input.policy },
        managerGroupSharing: { ...(base?.managerGroupSharing ?? {}), [input.group_id]: null },
      };
    });
  }, [scenarioKey]);
  const handleSetSharingWindow = useCallback(async (input: { readonly organization_id: string; readonly window: TeamSharingWindow; readonly tracking_policy: TeamTrackingPolicy }) => {
    if (scenarioKey) setOverrides((current) => ({ ...(current?.key === scenarioKey ? current : {}), key: scenarioKey, window: input.window, policy: input.tracking_policy }));
  }, [scenarioKey]);
  const handleRenameTeam = useCallback(async (input: { readonly organization_id: string; readonly name: string }) => {
    const name = input.name.trim();
    if (!scenarioKey || !name) return false;
    setOverrides((current) => ({ ...(current?.key === scenarioKey ? current : {}), key: scenarioKey, name }));
    return true;
  }, [scenarioKey]);
  const override = useCallback((change: (current: PreviewOverrides | null) => Omit<PreviewOverrides, "key">) => {
    if (!scenarioKey) return false;
    setOverrides((current) => {
      const base = current?.key === scenarioKey ? current : null;
      return { ...(base ?? {}), ...change(base), key: scenarioKey };
    });
    return true;
  }, [scenarioKey]);
  const handleRemoveMember = useCallback(async (input: { readonly organization_id: string; readonly member_key: string }) => {
    const person = fixture?.roster.find((member) => member.member_key === input.member_key);
    if (!person) return false;
    return override((base) => ({ former: { ...(base?.former ?? {}), [input.member_key]: { display_name: person.display_name, departure: "removed" as const, left_at: new Date().toISOString() } } }));
  }, [fixture, override]);
  const handleDeleteFormerRecords = useCallback(async (input: { readonly organization_id: string; readonly member_key: string }) => (
    override((base) => {
      const { [input.member_key]: _gone, ...former } = base?.former ?? {};
      return { former, purged: [...(base?.purged ?? []), input.member_key] };
    })
  ), [override]);
  const handleTransferOwnership = useCallback(async (input: { readonly organization_id: string; readonly member_key: string }) => (
    override(() => ({ owner: input.member_key }))
  ), [override]);
  const handleDeleteTeam = useCallback(async () => (
    override(() => ({ purgeAfter: shiftIsoDate(logicalTodayIsoDate(0), 30) }))
  ), [override]);
  const handleRestoreTeam = useCallback(async () => override(() => ({ purgeAfter: undefined })), [override]);
  const handleRevokeInvite = useCallback(async (input: { readonly invite_id: string }) => {
    override((base) => ({ revokedInvites: [...(base?.revokedInvites ?? []), input.invite_id] }));
  }, [override]);
  const groupEdits = active?.groups ?? NO_TEAM_GROUP_EDITS;
  const editGroups = useCallback((change: (edits: TeamGroupEdits) => TeamGroupEdits) => (
    override((base) => ({ groups: change(base?.groups ?? NO_TEAM_GROUP_EDITS) }))
  ), [override]);
  const handleRenameGroup = useCallback(async (input: { readonly group_id: string; readonly name: string }) => {
    const name = input.name.trim();
    return name ? editGroups((edits) => ({ ...edits, names: { ...edits.names, [input.group_id]: name } })) : false;
  }, [editGroups]);
  const handleMoveGroup = useCallback(async (input: { readonly group_id: string; readonly parent_group_id: string | null }) => (
    editGroups((edits) => ({ ...edits, parents: { ...edits.parents, [input.group_id]: input.parent_group_id } }))
  ), [editGroups]);
  const handleDeleteGroup = useCallback(async (input: { readonly group_id: string; readonly move_to: string | null }) => (
    editGroups((edits) => ({ ...edits, deleted: { ...edits.deleted, [input.group_id]: input.move_to } }))
  ), [editGroups]);
  const defaultManagers = useMemo(() => (fixture ? initialPreviewManagers(fixture) : []), [fixture]);
  const managers = managerState && managerState.key === scenarioKey ? managerState.managers : defaultManagers;
  const viewerAssignment = useMemo(() => (fixture ? previewViewerAssignment(fixture) : null), [fixture]);
  const handleSetManagers = useCallback(async (input: { readonly organization_id: string; readonly managers: readonly TeamManagerAssignment[] }) => {
    if (scenarioKey) setManagerState({ key: scenarioKey, managers: input.managers });
  }, [scenarioKey]);
  // Teams made in the preview stay until the scenario changes; they start with nobody in them.
  const [groupState, setGroupState] = useState<{ readonly key: string; readonly groups: readonly TeamGroup[] } | null>(null);
  const createdGroups = useMemo(() => (groupState && groupState.key === scenarioKey ? groupState.groups : []), [groupState, scenarioKey]);
  const handleCreateGroup = useCallback(async (input: { readonly organization_id: string; readonly name: string; readonly parent_group_id: string | null }) => {
    const name = input.name.trim();
    if (!scenarioKey || !name) return null;
    const group: TeamGroup = { id: "qa-group-created-" + (createdGroups.length + 1), organization_id: input.organization_id, parent_group_id: input.parent_group_id, name, lead_display_name: null, member_count: 0 };
    setGroupState({ key: scenarioKey, groups: [...createdGroups, group] });
    return group;
  }, [createdGroups, scenarioKey]);
  const handleSetMemberRole = useCallback(async (input: { readonly organization_id: string; readonly member_key: string; readonly role: "admin" | "member" }) => {
    // An organization admin is no team manager: their manager assignment ends with the change.
    if (input.role === "admin" && scenarioKey) setManagerState({ key: scenarioKey, managers: managers.filter((manager) => manager.member_key !== input.member_key) });
    return override((base) => ({ roles: { ...(base?.roles ?? {}), [input.member_key]: input.role } }));
  }, [managers, override, scenarioKey]);
  return {
    selectedTeam: team,
    teamActionError: null,
    teamActionLoading: false,
    teamError: null,
    teamLoading: false,
    teamStatusMessage: null,
    teamStatusTone: "neutral",
    teams,
    invites,
    emailInvites,
    handleSendEmailInvites,
    handleCancelEmailInvite,
    ownEmailInvites: NO_OWN_EMAIL_INVITES,
    refreshTeamData: noop,
    handleCreateTeam: noop,
    handleAcceptInvite: ok,
    handleCreateInvite: noop,
    handleRevokeInvite,
    handleSetMemberInvites,
    handleSetSharingScope,
    handleSetTrackingPolicy,
    members,
    refreshMembers: noop,
    handleRemoveMember,
    handleLeaveTeam: ok,
    handleDeleteTeam,
    selectTeam: () => undefined,
    managers,
    viewerAssignment,
    // The preview never creates a team; the wizard shows the invite step against the scenario's invite.
    handleCreateTeamWithPolicy: ok,
    handleSetSharingPolicy,
    handleSetGroupSharingPolicy,
    handleSetSharingWindow,
    handleSetManagers,
    handleCreateGroup,
    createdGroups,
    handleRenameTeam,
    handleSetMemberRole,
    handleTransferOwnership,
    scheduledDeletions,
    handleRestoreTeam,
    formerMembers,
    handleDeleteFormerRecords,
    purgedMemberKeys,
    handleRenameGroup,
    handleMoveGroup,
    handleDeleteGroup,
    groupEdits,
  };
}

type PreviewOverrides = {
  readonly key: string;
  /** The team's name as renamed in Settings › General. */
  readonly name?: string;
  /** People made organization admins (or members again) in the preview. */
  readonly roles?: Readonly<Record<string, "admin" | "member">>;
  /** Whom the owner handed the team to. */
  readonly owner?: string;
  /** The day a deleted team is purged; until then its owner may restore it. */
  readonly purgeAfter?: string;
  readonly revokedInvites?: readonly string[];
  /** People removed in the preview, whose shared records stay until deleted. */
  readonly former?: Readonly<Record<string, { readonly display_name: string; readonly departure: "left" | "removed"; readonly left_at: string }>>;
  /** People whose shared records were deleted after they left. */
  readonly purged?: readonly string[];
  /** Teams renamed, moved or deleted in Settings › Teams. */
  readonly groups?: TeamGroupEdits;
  readonly scope?: TeamSharingScope;
  readonly policy?: TeamTrackingPolicy;
  readonly sharing?: TeamSharingPolicy;
  readonly window?: TeamSharingWindow;
  /** Per-team changes made in settings; null puts a team back on the organization's default. */
  readonly groupSharing?: Readonly<Record<string, TeamSharingPolicy | null>>;
  /** Per-team changes a manager made under a decision candidate, on top of the admin's. */
  readonly managerGroupSharing?: Readonly<Record<string, TeamSharingPolicy | null>>;
};

/**
 * Managers a scenario starts with: each group's lead over their own group with
 * individual detail, plus one head over several teams who sees totals only, so
 * both grants are on screen. A team without groups starts with one manager.
 */
export function initialPreviewManagers(fixture: TeamPreviewFixture): TeamManagerAssignment[] {
  const own = previewViewerAssignment(fixture);
  const others = initialOtherManagers(fixture);
  return own ? [own, ...others.filter((manager) => manager.member_key !== own.member_key)] : others;
}

function initialOtherManagers(fixture: TeamPreviewFixture): TeamManagerAssignment[] {
  const { groups, members } = fixture.dataset;
  if (groups.length === 0) {
    const first = members.find((member) => !member.is_self && member.membership_role === "member");
    return first ? [{ member_key: first.member_key, display_name: first.display_name, group_ids: [], access: "detail" }] : [];
  }
  const leads: TeamManagerAssignment[] = [];
  for (const group of groups) {
    const lead = members.find((member) => member.membership_role === "lead" && member.group_id === group.id);
    if (lead) leads.push({ member_key: lead.member_key, display_name: lead.display_name, group_ids: [group.id], access: "detail", sharing: "view" });
  }
  const topLevel = groups.filter((group) => group.parent_group_id === null);
  const nested = topLevel.some((group) => groups.some((child) => child.parent_group_id === group.id));
  const headGroupIds = nested ? topLevel.slice(0, 1).map((group) => group.id) : topLevel.slice(0, 2).map((group) => group.id);
  const headHome = nested ? groups.find((group) => group.parent_group_id === headGroupIds[0])?.id : headGroupIds[0];
  const head = members.find((member) => !member.is_self && member.membership_role === "member" && member.group_id === headHome);
  // A division head may narrow sharing under candidate E; team leads read it.
  return head ? [{ member_key: head.member_key, display_name: head.display_name, group_ids: headGroupIds, access: "summary", sharing: "narrow" }, ...leads] : leads;
}

/**
 * The manager seat's own assignment. One team is their own; several are their
 * own plus two teams elsewhere in the organization; a division is the one
 * their team sits in. A team without groups is managed whole.
 */
export function previewViewerAssignment(fixture: TeamPreviewFixture): TeamManagerAssignment | null {
  const { scenario } = fixture;
  if (scenario.viewer !== "manager") return null;
  const self = fixture.dataset.members.find((member) => member.is_self);
  if (!self) return null;
  const access = scenario.managerAccess ?? "detail";
  const { groups } = fixture.dataset;
  const home = groups.find((group) => group.id === self.group_id) ?? null;
  const base = { member_key: self.member_key, display_name: self.display_name, access, sharing: scenario.managerSharing ?? "narrow" } as const;
  if (!home) return { ...base, group_ids: [] };
  const reach = scenario.managerReach ?? "one";
  if (reach === "division" && home.parent_group_id) return { ...base, group_ids: [home.parent_group_id] };
  if (reach === "several") {
    const leaves = groups.filter((group) => !groups.some((child) => child.parent_group_id === group.id) && group.id !== home.id);
    // Spread the others across the organization: a team from the middle and one from the end.
    const others = leaves.length > 2 ? [leaves[Math.floor(leaves.length / 2)]!, leaves[leaves.length - 1]!] : leaves;
    return { ...base, group_ids: [home.id, ...others.map((group) => group.id)] };
  }
  return { ...base, group_ids: [home.id] };
}

export type UseTeamPreviewDataInput = {
  readonly fixture: TeamPreviewFixture | null;
  readonly period: TeamPeriod;
  readonly windowOffset: number;
  readonly startOfDayMinutes: number;
};

export type TeamPreviewData = {
  readonly projects: UseTeamProjectsResult;
  readonly dataset: TeamFocusDataset;
  readonly expectedWeekdays: readonly number[];
};

export function resolveTeamWindow(period: TeamPeriod, windowOffset: number, startOfDayMinutes: number): TeamProjectsWindow {
  const latestEndDay = logicalTodayIsoDate(startOfDayMinutes);
  const windowDays = period === "daily" ? 1 : period === "monthly" ? 30 : 7;
  const endDay = shiftIsoDate(latestEndDay, -Math.max(0, windowOffset) * windowDays);
  const focusWindow = getTeamFocusWindow(period, endDay);
  if (focusWindow) return { start_date: focusWindow.window_start_date, end_date: focusWindow.window_end_date };
  return { start_date: endDay, end_date: endDay };
}

const EMPTY_DATASET: TeamFocusDataset = { members: [], groups: [], focusDays: [], projectDays: [], presence: [] };

/**
 * The Projects tab's rows (per project per day, and per project per member
 * over the window) from per-member project days, the shape the server
 * returns. The caller passes the dataset a seat may see.
 */
/** The member slot each preview person gets in project rows: their place by name, from 1. */
export function previewMemberSlots(dataset: TeamFocusDataset): ReadonlyMap<string, number> {
  return new Map([...dataset.members].sort((left, right) => left.display_name.localeCompare(right.display_name)).map((member, index) => [member.member_key, index + 1]));
}

export function teamProjectRowsFromDataset(
  dataset: TeamFocusDataset,
  projects: readonly TeamProject[],
  organizationId: string,
  window: TeamProjectsWindow,
): { readonly mix: TeamProjectMixRow[]; readonly members: TeamProjectMemberRow[] } {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const memberByKey = new Map(dataset.members.map((member) => [member.member_key, member]));
  const slotByKey = previewMemberSlots(dataset);
  const mixByKey = new Map<string, TeamProjectMixRow>();
  const memberByPair = new Map<string, TeamProjectMemberRow>();
  for (const row of dataset.projectDays) {
    if (row.organization_project_id === null) continue;
    if (row.activity_date < window.start_date || row.activity_date > window.end_date) continue;
    const project = projectById.get(row.organization_project_id);
    const member = memberByKey.get(row.member_key);
    if (!project || !member) continue;
    const mixKey = project.id + "|" + row.activity_date;
    const mixRow = mixByKey.get(mixKey);
    mixByKey.set(mixKey, mixRow
      ? { ...mixRow, seconds: mixRow.seconds + row.seconds }
      : {
          organization_id: organizationId,
          organization_project_id: project.id,
          project_name: project.name,
          project_color: project.color,
          project_status: project.status,
          activity_date: row.activity_date,
          seconds: row.seconds,
        });
    const pairKey = project.id + "|" + row.member_key;
    const memberRow = memberByPair.get(pairKey);
    memberByPair.set(pairKey, memberRow
      ? { ...memberRow, seconds: memberRow.seconds + row.seconds }
      : {
          organization_id: organizationId,
          organization_project_id: project.id,
          project_name: project.name,
          member_display_name: member.display_name,
          member_key: member.member_key,
          member_slot: slotByKey.get(member.member_key) ?? null,
          is_self: member.is_self,
          seconds: row.seconds,
        });
  }
  return { mix: [...mixByKey.values()], members: [...memberByPair.values()] };
}

export function useTeamPreviewData(input: UseTeamPreviewDataInput): TeamPreviewData {
  const { fixture, period, windowOffset, startOfDayMinutes } = input;
  const window = useMemo(() => resolveTeamWindow(period, windowOffset, startOfDayMinutes), [period, startOfDayMinutes, windowOffset]);

  // The project tab and the project-totals dashboard read the same shape the
  // server returns, derived from the fixture's per-member project days.
  const { mix, members } = useMemo(() => (
    fixture
      ? teamProjectRowsFromDataset(fixture.dataset, fixture.projects, fixture.team.organization_id, window)
      : { mix: [] as TeamProjectMixRow[], members: [] as TeamProjectMemberRow[] }
  ), [fixture, window]);

  const noop = useCallback(async () => undefined, []);
  const ok = useCallback(async () => true, []);
  const projects: UseTeamProjectsResult = {
    projects: fixture?.projects ?? [],
    mix,
    members,
    totals: null,
    workBlocks: [],
    window,
    loading: false,
    hasLoaded: true,
    error: null,
    actionError: null,
    actionLoading: false,
    publishing: false,
    publishNote: null,
    refresh: noop,
    createProject: ok,
    updateProject: ok,
    archiveProject: ok,
    publishMyTime: noop,
    stopSharing: noop,
  };

  return {
    projects,
    dataset: fixture?.dataset ?? EMPTY_DATASET,
    expectedWeekdays: fixture?.expectedWeekdays ?? [1, 2, 3, 4, 5],
  };
}

