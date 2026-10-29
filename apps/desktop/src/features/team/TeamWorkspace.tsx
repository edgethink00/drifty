import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { KeyHint } from "../../components/KeyHint";
import { useModalSubmitShortcut } from "../../lib/useModalSubmitShortcut";

import { AnchoredPresence } from "../../components/AnchoredPresence";
import { PageTabs, pageTabId } from "../../components/PageTabs";

import type { AuthState } from "../auth/AuthContext";
import { useCopyFeedback } from "../../lib/useCopyFeedback";
import { useOverlayDismiss } from "../../lib/useOverlayDismiss";
import TeamDashboardsView from "./TeamDashboardsView";
import { TeamBoardView } from "./TeamBoardView";
import { TeamGettingStarted } from "./TeamGettingStarted";
import { teamBoardWidgetLock, type TeamBoardAccess } from "./teamBoardModel";
import { TeamExportPanel } from "./TeamExportPanel";
import { shiftIsoDate } from "@drifty/domain";
import type { TeamExportWindow } from "./teamExportRange";
import { teamExportRowsFromDataset, teamExportRowsFromTotals } from "./teamExportRows";
import { deleteTeamServerBoard, fetchTeamServerBoards, fetchTeamTotals, saveTeamServerBoard } from "./teamSharingService";
import type { TeamBoardsRemote } from "./useTeamBoardsStore";
import TeamOverviewView from "./TeamOverviewView";
import TeamMemberDetailView from "./TeamMemberDetailView";
import TeamProjectsView, { type TeamProjectDraft } from "./TeamProjectsView";
import { toShareableTeamInviteUrl, type PendingTeamInvite } from "./teamInviteDeepLinks";
import { previewMemberSlots, teamProjectRowsFromDataset, useTeamPreviewData } from "./teamPreview";
import { isWithinTeamRecordingHours } from "./teamManagedHours";
import { useTeamOverviewClock } from "./useTeamOverviewClock";
import { useTeamInvitePreview } from "./useTeamInvitePreview";
import {
  DEFAULT_TEAM_MEMBER_PAGE,
  TEAM_ACROSS_RULE,
  TEAM_DASHBOARD_TAB,
  TEAM_HOURS_ZONE,
  TEAM_MANAGER_EDIT,
  TEAM_MEMBER_SELF_VIEW,
  TEAM_PAGE_TITLE,
  TEAM_TITLE_SWITCHER,
  TEAM_SHARING_SETTINGS_LAYOUT,
  readTeamMemberPage,
  readTeamMemberHistoryPosition,
  readTeamManagerDelegation,
  readTeamProjectPanelCandidate,
  teamMemberPageWindowCount,
  writeTeamManagerDelegation,
  type TeamPreviewFixture,
} from "./teamPreviewScenarios";
import { buildTeamMemberDetailModel, buildTeamOverviewModel, groupPath, membersInContainer, scopeDatasetToGroups, type TeamFocusDataset } from "./teamFocusModel";
import { teamMemberGroupKey } from "./teamMemberIdentity";
import { datasetFromProjectRows, datasetFromTeamTotals } from "./teamFocusAdapters";
import { DEFAULT_TEAM_RECORDING_SCHEDULE, TEAM_SCOPE_DESCRIPTIONS, TEAM_SCOPE_PRIVATE_KEYS, type TeamSharingScope } from "./teamSharingScope";
import { TeamPrivacyNote, describeScope } from "./TeamFocusParts";
import type { AcceptTeamInviteInput } from "./teamService";
import { canInviteToTeam, isTeamAdmin, isTeamOwner, type TeamPeriod } from "./teamTypes";
import { useTeamProjects, type TeamProjectsSubView } from "./useTeamProjects";
import { useTeamPresence } from "./useTeamPresence";
import type { UseTeamControllerResult } from "./useTeamController";
import { ModalPresence } from "../../components/ModalPresence";
import { Toggle } from "../../components/Toggle";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { DateNavigator } from "../../components/DateNavigator";
import { formatLocalizedDateRangeLabel, formatLocalizedDayLabel } from "../../lib/formatting";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import { localizedPublishNote } from "./teamPublishNote";
import { TeamConfirmDialog } from "./TeamConfirmDialog";
import { TeamGeneralSettings } from "./TeamGeneralSettings";
import { TeamGroupsSettings } from "./TeamGroupsSettings";
import { TeamSubnavStrip } from "./TeamSubnav";
import { TeamSharingNotice } from "./TeamSharingNotice";
import { applyTeamGroupEdits } from "./teamGroupEdits";
import { TeamCreateWizard } from "./TeamCreateWizard";
import { TeamPolicySummary } from "./TeamPolicySummary";
import { TeamRoster, managerTeamsLabel } from "./TeamRoster";
import { SHARE_FIELD_KEYS, TeamSharingPolicyEditor, TeamSharingWindowEditor } from "./TeamSharingPolicyEditor";
import { DEFAULT_SHARING_TARGET, TeamSharingTargetBar, TeamSharingTeamsTable, leafSharingTeams, sharingPolicyLabel, sharingTargets } from "./TeamSharingTargets";
import { SettingsSelect } from "../settings/SettingsSelect";
import {
  compareTeamSharingPolicies,
  completeTeamSharingPolicy,
  draftFromPolicy,
  isValidSharingWindow,
  legacyScopeForPolicy,
  policyForLegacyScope,
  policyForPreset,
  policyWithinCeiling,
  shareLevelRank,
  sharingPolicyAcrossTeams,
  sharingPolicyForGroup,
  TEAM_SHARE_FIELDS,
  teamSharingVisibility,
  teamsByFocusSharing,
  teamsWithoutSharedProjects,
  type TeamShareField,
  type TeamSharingPolicy,
  type TeamSharingItem,
  type TeamSharingPolicyDraft,
  type TeamSharingWindow,
} from "./teamSharingPolicy";
import type { TeamTrackingPolicy } from "./teamSharingScope";
import type { TeamFocusClassification } from "./teamFocusPublish";
import "./team.css";
import { ActionLabel } from "../../components/ActionLabel";


/** The Leaderboard's public refresh cadence, for the same kind of data: other people's published totals. */
const TEAM_AUTO_REFRESH_MS = 5 * 60 * 1000;

type TeamSettingsTab = "general" | "sharing" | "hours" | "teams" | "members" | "export";


export type TeamWorkspaceProps = {
  readonly isSupabaseEnabled: boolean;
  readonly hasRequiredAccountAuth: boolean;
  readonly isSignedIn: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly controller: UseTeamControllerResult;
  /** A Dev-mode preview scenario's fixture; null for live data. */
  readonly previewFixture?: TeamPreviewFixture | null;
  readonly subView: TeamProjectsSubView;
  readonly onSubViewChange: (subView: TeamProjectsSubView) => void;
  readonly pendingInvite?: PendingTeamInvite | null;
  readonly onSignIn: () => void;
  readonly onCopyInvite: (text: string) => void | Promise<unknown>;
  readonly onAcceptPendingInvite: (input: AcceptTeamInviteInput) => Promise<boolean | void>;
  readonly onPendingInviteClear?: () => void;
  /** How the member's own charts classify activity, so focus sent to a team matches what they see. */
  readonly focusClassification?: TeamFocusClassification | null;
};

function localizedTeamRole(label: string, t: LocalizationController["t"]): string {
  switch (label.trim().toLowerCase()) {
    case "owner": return t("team.role.owner");
    case "member": return t("team.role.member");
    case "admin": return t("team.role.admin");
    case "lead": return t("team.role.lead");
    default: return label;
  }
}

function localizedTeamError(message: string | null, language: DisplayLanguage, t: LocalizationController["t"]): string | null {
  if (message === "Team sharing changed. Review the current settings before joining.") return t("team.join.policyChanged");
  if (!message || language === "en") return message;
  return t("team.error.withDetail", { detail: message });
}

function minuteClock(minute: number): string {
  return String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
}

/** "Security, Finance" or "A, B, C +2", for teams named in one line. */
function namesWithMore(names: readonly string[], t: LocalizationController["t"]): string {
  const shown = names.filter(Boolean);
  return shown.length > 3 ? shown.slice(0, 3).join(", ") + " " + t("team.managers.more", { count: shown.length - 3 }) : shown.join(", ");
}

/** Candidate C's ceiling in the preview: the organization admin would set it; here, work and focus by day. */
const PREVIEW_MANAGER_CEILING = policyForPreset("work_and_focus", true);

function TeamBadgeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
      <circle cx="10" cy="8" r="3.2" />
      <path d="M20 20v-1.4a3.4 3.4 0 0 0-2.6-3.3" />
      <path d="M15.2 5.1a3.2 3.2 0 0 1 0 6" />
    </svg>
  );
}

/** What the confirmation over settings is about. */
type PendingTeamConfirm =
  | { readonly kind: "leave" }
  | { readonly kind: "delete" }
  | { readonly kind: "remove"; readonly memberKey: string; readonly name: string }
  /** Handing the team to one of its organization admins. */
  | { readonly kind: "transfer"; readonly memberKey: string }
  /** Deleting a team of the organization; its people move to another team, or to none. */
  | { readonly kind: "deleteGroup"; readonly groupId: string; readonly moveTo: string }
  /** Deleting what someone who left had shared (2026-10-25). */
  | { readonly kind: "deleteFormer"; readonly memberKey: string; readonly name: string };

/** Where a deleted team's people go when they join no other team. */
const NO_GROUP = "__none__";

export function TeamWorkspace({
  isSupabaseEnabled,
  hasRequiredAccountAuth,
  isSignedIn,
  startOfDayMinutes,
  user,
  controller,
  previewFixture = null,
  subView,
  onSubViewChange,
  pendingInvite = null,
  onSignIn,
  onCopyInvite,
  onAcceptPendingInvite,
  onPendingInviteClear,
  focusClassification = null,
}: TeamWorkspaceProps) {
  const { effectiveLanguage, t } = useLocalization();
  const pageHeadRef = useRef<HTMLDivElement>(null);
  const wasMemberDetailOpenRef = useRef(false);
  const [period, setPeriod] = useState<TeamPeriod>("weekly");
  const [windowOffset, setWindowOffset] = useState(0);
  // Focus dashboards: which group is open (null = the whole team) and which member's detail is open.
  const [groupId, setGroupId] = useState<string | null>(null);
  const [selectedMemberKey, setSelectedMemberKey] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Candidate D: a member's own records tab, open until another tab is chosen.
  const [selfTab, setSelfTab] = useState(true);
  // The Dashboard tab (draft): its own state beside the routed Overview and Projects, like Settings.
  const [boardTab, setBoardTab] = useState(false);
  const [memberFromBoard, setMemberFromBoard] = useState(false);
  // Leaving, removing someone and deleting the team ask first in a small dialog over settings.
  const [pendingConfirm, setPendingConfirm] = useState<PendingTeamConfirm | null>(null);
  /** Leaving Settings with sharing or hours edits waiting: where the page was going, held until they are saved or dropped. */
  const [pendingLeave, setPendingLeave] = useState<TeamProjectsSubView | "self" | "board" | null>(null);
  const [leaveSaving, setLeaveSaving] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);
  // Which settings section shows the latest action error, so it appears once, next to its control.
  const [failedAction, setFailedAction] = useState<"member" | "delete" | null>(null);
  const settingsModalRef = useRef<HTMLElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"create" | "join">("create");
  const addModalRef = useRef<HTMLElement>(null);
  const [teamName, setTeamName] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherTriggerRef = useRef<HTMLButtonElement>(null);
  const switcherMenuRef = useRef<HTMLDivElement>(null);
  const [inviteKey, setInviteKey] = useState("");
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const { copiedKey, showCopied } = useCopyFeedback<"link" | "code">();
  // Each open invite in the members list copies its own link.
  const inviteCopy = useCopyFeedback<string>();
  const addSubmittedRef = useRef(false);
  const inviteRequestedRef = useRef(false);
  // Per-item sharing: the settings tab, unsaved edits to the policy and hours, and a fresh wizard per open.
  const [settingsTab, setSettingsTab] = useState<TeamSettingsTab>("general");
  const [policyDraft, setPolicyDraft] = useState<TeamSharingPolicyDraft | null>(null);
  const [windowDraft, setWindowDraft] = useState<TeamSharingWindow | null>(null);
  const [trackingDraft, setTrackingDraft] = useState<TeamTrackingPolicy | null>(null);
  const [wizardKey, setWizardKey] = useState(0);
  // Sharing for many teams: which one the editor holds (the default or a team), unsaved per-team edits,
  // and for the table candidate whether a row is open. The invite names the team the code joins.
  const [sharingTarget, setSharingTarget] = useState<string>(DEFAULT_SHARING_TARGET);
  // Decision candidate D in the preview: the items the organization admin leaves to team managers.
  const [delegatedFields, setDelegatedFields] = useState<readonly TeamShareField[]>(readTeamManagerDelegation);
  const [groupDrafts, setGroupDrafts] = useState<Readonly<Record<string, { readonly follow: boolean; readonly draft: TeamSharingPolicyDraft }>>>({});
  const [sharingRowOpen, setSharingRowOpen] = useState(false);
  const [inviteGroupId, setInviteGroupId] = useState<string | null>(null);

  const {
    teams,
    selectedTeam,
    teamError,
    teamLoading,
    teamActionError,
    teamActionLoading,
    invites,
    handleCreateTeam,
    handleAcceptInvite,
    handleCreateInvite,
    handleRevokeInvite,
    handleSetMemberInvites,
    handleSetSharingScope,
    handleSetTrackingPolicy,
    members,
    refreshMembers,
    handleRemoveMember,
    handleLeaveTeam,
    handleDeleteTeam,
    refreshTeamData,
    selectTeam,
  } = controller;

  // An outside click never closes a dialog mid-request or one holding typed input.
  const inviteOverlayDismiss = useOverlayDismiss(() => setInviteOpen(false));
  // Unsaved sharing or hours edits keep the dialog open on an outside click, as the category editor does.
  const settingsDirty = policyDraft !== null || windowDraft !== null || trackingDraft !== null || Object.keys(groupDrafts).length > 0;
  const addOverlayDismiss = useOverlayDismiss(() => setAddOpen(false), {
    disabled: teamActionLoading,
    keepOpen: (addTab === "create" ? teamName : inviteKey).trim().length > 0,
  });

  // Dev-mode preview: swaps in a scenario's fixture so the surface can be
  // exercised without an account. Both hooks always run to keep hook order stable.
  const qaMock = previewFixture !== null;
  const canUse = qaMock || (isSupabaseEnabled && Boolean(user) && hasRequiredAccountAuth);
  const invitePreview = useTeamInvitePreview(inviteKey, !qaMock && canUse && addOpen && addTab === "join");
  // A server that stores per-item sharing reports it on the team; otherwise the single scope applies.
  const teamPolicy = controller.handleSetSharingPolicy ? selectedTeam?.sharing_policy ?? null : null;
  const realProjects = useTeamProjects({
    enabled: canUse && !qaMock,
    organizationId: selectedTeam?.organization_id ?? null,
    memberDisplayName: selectedTeam?.member_display_name ?? null,
    userEmail: user?.email ?? null,
    startOfDayMinutes,
    period,
    windowOffset,
    sharing: teamPolicy ? { projects: teamPolicy.projects !== "off", focus: teamPolicy.focus !== "off" } : null,
    focusClassification,
  });
  const preview = useTeamPreviewData({ fixture: previewFixture, period, windowOffset, startOfDayMinutes });
  const projects = qaMock ? preview.projects : realProjects;
  const groupPolicies = teamPolicy ? selectedTeam?.group_sharing_policies ?? null : null;
  const trackingPolicy = selectedTeam?.tracking_policy ?? "free";
  const viewerRole = selectedTeam?.membership_role ?? "member";
  const viewerAssignment = controller.viewerAssignment ?? null;
  const clock = useTeamOverviewClock(startOfDayMinutes, qaMock);
  // Tracking status only means something inside the team's recording hours; outside them it is said once.
  const recordingWindow = selectedTeam?.sharing_window ?? selectedTeam?.recording_schedule ?? null;
  const withinRecordingHours = !recordingWindow || isWithinTeamRecordingHours(recordingWindow, clock.nowMs);
  // Who is recording now, under managed tracking, for the seats that see people (the server checks the same);
  // a manager with team totals sees no one, so no status either.
  const seesPresence = viewerRole === "owner" || viewerRole === "admin" || (viewerRole === "lead" && viewerAssignment?.access !== "summary");
  const livePresence = useTeamPresence({
    enabled: !qaMock && trackingPolicy === "managed" && withinRecordingHours && seesPresence,
    organizationId: selectedTeam?.organization_id ?? null,
  });
  // What this seat may see: admins the whole organization, a manager the teams
  // assigned to them, anyone else their own team. Everything outside leaves the
  // dataset, so no screen below can show it.
  const viewerScopeGroupIds = useMemo<readonly string[] | null>(() => {
    if (viewerRole === "owner" || viewerRole === "admin") return null;
    if (viewerAssignment) return viewerAssignment.group_ids.length > 0 ? viewerAssignment.group_ids : null;
    const own = selectedTeam?.viewer_group_id ?? null;
    return own ? [own] : null;
  }, [selectedTeam?.viewer_group_id, viewerAssignment, viewerRole]);
  // One team or one division opens as itself; several teams open on all of them together.
  const leadGroupId = viewerScopeGroupIds && viewerScopeGroupIds.length === 1 ? viewerScopeGroupIds[0]! : null;
  const effectiveGroupId = groupId ?? leadGroupId;
  // A server that predates sharing scopes keeps the project-totals dashboard.
  const focusDashboards = qaMock || teamPolicy !== null || (selectedTeam?.sharing_scope ?? null) !== null;
  const createdGroups = controller.createdGroups;
  const fullDataset: TeamFocusDataset = useMemo(() => {
    // A server that stores sharing returns figures by day (people's, or only the team's for a seat shown totals); otherwise the breakdown's window totals.
    const totals = realProjects.totals;
    const byDay = totals !== null && totals.length > 0;
    const read = qaMock
      ? preview.dataset
      : byDay ? datasetFromTeamTotals(totals) : datasetFromProjectRows(realProjects.members, realProjects.window, selectedTeam?.member_display_name ?? null);
    const base = qaMock || livePresence.length === 0 ? read : { ...read, presence: livePresence };
    // A team made from the members list shows at once, before anyone is in it.
    const withCreated = createdGroups && createdGroups.length > 0 ? { ...base, groups: [...base.groups, ...createdGroups] } : base;
    // People who left keep their shared records in the team, named as former members (2026-10-25);
    // records an organization admin deleted leave the preview's data.
    const purged = new Set(controller.purgedMemberKeys ?? []);
    const former = new Set((controller.formerMembers ?? []).map((person) => person.member_key));
    const withFormer = purged.size === 0 && former.size === 0 ? withCreated : {
      ...withCreated,
      members: withCreated.members.filter((member) => !purged.has(member.member_key)).map((member) => (former.has(member.member_key) ? { ...member, role_label: t("team.former.badge"), membership_role: "member" as const } : member)),
      focusDays: withCreated.focusDays.filter((row) => !purged.has(row.member_key)),
      projectDays: withCreated.projectDays.filter((row) => !purged.has(row.member_key)),
      presence: withCreated.presence.filter((row) => !purged.has(row.member_key) && !former.has(row.member_key)),
    };
    // Settings › Teams: renamed, moved and deleted teams apply over the data.
    return applyTeamGroupEdits(withFormer, controller.groupEdits);
  }, [controller.formerMembers, controller.groupEdits, controller.purgedMemberKeys, createdGroups, livePresence, preview.dataset, qaMock, realProjects.members, realProjects.totals, realProjects.window, selectedTeam?.member_display_name, t]);
  // Every group, for walking up to a division's policy; the seat's dataset keeps only its part.
  const allGroups = fullDataset.groups;
  const seatDataset = useMemo(() => scopeDatasetToGroups(fullDataset, viewerScopeGroupIds), [fullDataset, viewerScopeGroupIds]);
  // Teams can share on different policies, so a view adding several of them shows project time only,
  // and teams that keep project time to themselves leave its sums.
  const acrossTeams = seatDataset.groups.length > 0
    && (effectiveGroupId === null || seatDataset.groups.some((group) => group.parent_group_id === effectiveGroupId));
  // Decision candidates, read only in the Dev preview; a live team keeps the first of each.
  const acrossRule = qaMock ? TEAM_ACROSS_RULE.read() : "projects";
  const managerEditRule = qaMock ? TEAM_MANAGER_EDIT.read() : "admins";
  const hoursZoneChoice = qaMock && TEAM_HOURS_ZONE.read() === "choose";
  // The teams added together in view, split by whether they share focus (for candidates B and C).
  const teamsInView = useMemo(() => {
    if (!acrossTeams) return [] as string[];
    const groups = seatDataset.groups;
    const under = (id: string): boolean => {
      let current: string | null = id;
      while (current !== null) {
        if (current === effectiveGroupId) return true;
        current = groups.find((group) => group.id === current)?.parent_group_id ?? null;
      }
      return effectiveGroupId === null;
    };
    return groups.filter((group) => !groups.some((child) => child.parent_group_id === group.id) && under(group.id)).map((group) => group.id);
  }, [acrossTeams, effectiveGroupId, seatDataset.groups]);
  const focusSplit = teamPolicy && acrossTeams ? teamsByFocusSharing(teamPolicy, groupPolicies, allGroups, teamsInView) : null;
  const acrossFocus = focusSplit !== null && focusSplit.sharing.length > 0
    && (acrossRule === "sharedFocus" || (acrossRule === "allFocus" && focusSplit.withheld.length === 0));
  const datasetAcrossTeams = useMemo(() => {
    if (!teamPolicy || seatDataset.groups.length === 0) return seatDataset;
    const withheld = new Set(teamsWithoutSharedProjects(teamPolicy, groupPolicies, allGroups));
    // Candidate C adds focus only from teams that share it.
    const noFocus = new Set(acrossRule === "sharedFocus" ? focusSplit?.withheld ?? [] : []);
    if (withheld.size === 0 && noFocus.size === 0) return seatDataset;
    const keys = new Set(seatDataset.members.filter((member) => member.group_id !== null && withheld.has(member.group_id)).map((member) => member.member_key));
    const focusKeys = new Set(seatDataset.members.filter((member) => member.group_id !== null && noFocus.has(member.group_id)).map((member) => member.member_key));
    return {
      ...seatDataset,
      focusDays: seatDataset.focusDays.filter((row) => !keys.has(row.member_key) && !focusKeys.has(row.member_key)),
      projectDays: seatDataset.projectDays.filter((row) => !keys.has(row.member_key)),
    };
  }, [acrossRule, allGroups, focusSplit?.withheld, groupPolicies, seatDataset, teamPolicy]);
  const focusDataset = acrossTeams ? datasetAcrossTeams : seatDataset;
  /** What a team shares: its own policy, its division's, or the organization's default. */
  const policyForGroup = (id: string | null): TeamSharingPolicy | null => (teamPolicy ? sharingPolicyForGroup(teamPolicy, groupPolicies, allGroups, id) : null);
  // The policy for what is on screen: one team's, or across teams project totals only.
  const activePolicy: TeamSharingPolicy | null = teamPolicy
    ? acrossTeams
      ? { ...sharingPolicyAcrossTeams(teamPolicy), ...(acrossFocus ? { focus: "team" as const } : {}) }
      : sharingPolicyForGroup(teamPolicy, groupPolicies, allGroups, effectiveGroupId)
    : null;
  const focusNote = acrossFocus && acrossRule === "sharedFocus" && focusSplit && focusSplit.withheld.length > 0
    ? t("team.decide.focusLeftOut", { teams: namesWithMore(focusSplit.withheld.map((id) => allGroups.find((group) => group.id === id)?.name ?? ""), t) })
    : null;
  const sharingScope: TeamSharingScope | null = activePolicy ? legacyScopeForPolicy(activePolicy) : selectedTeam?.sharing_scope ?? null;
  // No people cards and no member pages for a manager with team totals, nor for anyone looking at
  // others in a team that shares nothing per person. A member keeps their own card. Across teams
  // people are listed by name only, and open inside their own team.
  const sharesPerPerson = activePolicy ? teamSharingVisibility(activePolicy).personal : true;
  const peopleHidden = viewerAssignment?.access === "summary" || (!sharesPerPerson && viewerRole !== "member" && !acrossTeams);
  // A manager's own reach, said once on the Overview and in their settings.
  const viewerReachLabel = viewerAssignment
    ? t("team.focus.managerScope", {
        teams: managerTeamsLabel(viewerAssignment, focusDataset.groups, t) ?? t("team.managers.wholeTeam"),
        access: t(viewerAssignment.access === "detail" ? "team.managers.access.detail" : "team.managers.access.summary"),
      })
    : null;
  const presencePolicy: TeamTrackingPolicy = trackingPolicy === "managed" && withinRecordingHours && seesPresence ? "managed" : "free";
  const offHoursNote = trackingPolicy === "managed" && !withinRecordingHours && seesPresence ? t("team.overview.offHours") : null;
  const focusContext = useMemo(() => ({
    scope: sharingScope ?? "projects",
    policy: presencePolicy,
    window: projects.window,
    today: clock.today,
    nowMs: clock.nowMs,
    groupId: effectiveGroupId,
    knownMemberCount: !qaMock && effectiveGroupId === null ? selectedTeam?.member_count : undefined,
    projects: projects.projects,
    viewerRole,
    expectedWeekdays: selectedTeam?.recording_schedule?.days ?? (qaMock ? preview.expectedWeekdays : DEFAULT_TEAM_RECORDING_SCHEDULE.days),
    dailyGoalSeconds: 3 * 3600,
  }), [clock.nowMs, clock.today, effectiveGroupId, preview.expectedWeekdays, presencePolicy, projects.projects, projects.window, qaMock, selectedTeam?.member_count, selectedTeam?.recording_schedule?.days, sharingScope, viewerRole]);
  const overviewModel = useMemo(() => (focusDashboards ? buildTeamOverviewModel(focusDataset, focusContext) : null), [focusContext, focusDashboards, focusDataset]);
  const memberPageLayout = qaMock ? readTeamMemberPage() : DEFAULT_TEAM_MEMBER_PAGE;
  const memberDetailModel = useMemo(() => (
    focusDashboards && selectedMemberKey ? buildTeamMemberDetailModel(focusDataset, { ...focusContext, memberKey: selectedMemberKey, windowCount: teamMemberPageWindowCount(memberPageLayout) }) : null
  ), [focusContext, focusDashboards, focusDataset, memberPageLayout, selectedMemberKey]);
  // Previous / next member walk the container's members by name.
  const memberOrder = useMemo(() => {
    const container = membersInContainer(focusDataset.members, focusDataset.groups, effectiveGroupId);
    const visible = viewerRole === "member" ? container.filter((member) => member.is_self) : container;
    return [...visible].sort((left, right) => left.display_name.localeCompare(right.display_name)).map((member) => member.member_key);
  }, [effectiveGroupId, focusDataset.groups, focusDataset.members, viewerRole]);
  const memberIndex = selectedMemberKey ? memberOrder.indexOf(selectedMemberKey) : -1;
  // A member's own page (candidates C and D): the page managers open of them, on their own team's sharing.
  const selfView = qaMock ? TEAM_MEMBER_SELF_VIEW.read() : "preview";
  const selfKey = viewerRole === "member" ? memberOrder[0] ?? null : null;
  const selfPersonal = activePolicy ? teamSharingVisibility(activePolicy).personal : false;
  const selfPageShown = viewerRole === "member" && focusDashboards && (selfView === "page" || selfView === "tab");
  const selfDetailModel = useMemo(() => (
    selfPageShown && selfPersonal && selfKey ? buildTeamMemberDetailModel(focusDataset, { ...focusContext, memberKey: selfKey, windowCount: teamMemberPageWindowCount(memberPageLayout) }) : null
  ), [focusContext, focusDataset, memberPageLayout, selfKey, selfPageShown, selfPersonal]);
  const containerPath = useMemo(() => groupPath(focusDataset.groups, effectiveGroupId), [effectiveGroupId, focusDataset.groups]);
  // Decision candidate for the page title. B and C put where the seat is into the title
  // (organization, then division and team), so the small path above the headline goes.
  const pageTitle = qaMock ? TEAM_PAGE_TITLE.read() : "section";
  const pathInTitle = pageTitle === "path" || pageTitle === "sectionPath";
  /** Where a board belongs, from the top the seat can open; its last entry names the board's own scope. */
  const boardPath = (organizationName: string): { readonly id: string | null; readonly name: string }[] => [
    ...(leadGroupId === null ? [{ id: null, name: organizationName }] : []),
    ...containerPath.filter((group) => leadGroupId === null || containerPath.indexOf(group) >= containerPath.findIndex((entry) => entry.id === leadGroupId)).map((group) => ({ id: group.id, name: group.name })),
  ];
  // Switcher candidate B (Rize): with the path in the title, its chevron sits on where the seat is
  // and lists the teams the seat can open; other organizations move to the menu's foot.
  const teamSwitcher = pathInTitle && TEAM_TITLE_SWITCHER.read() === "team";
  const [switcherQuery, setSwitcherQuery] = useState("");
  const switcherTargets = useMemo(() => (teamSwitcher ? sharingTargets(seatDataset.groups) : []), [seatDataset.groups, teamSwitcher]);
  const leadPath = useMemo(() => groupPath(focusDataset.groups, leadGroupId), [focusDataset.groups, leadGroupId]);
  // Switching teams or scenarios leaves any open group or member behind.
  useEffect(() => {
    setGroupId(null);
    setSelectedMemberKey(null);
    setSelfTab(true);
    setBoardTab(false);
  }, [selectedTeam?.organization_id, previewFixture]);
  const displayTeamError = localizedTeamError(teamError, effectiveLanguage, t);
  const displayTeamActionError = localizedTeamError(teamActionError, effectiveLanguage, t);
  const displayProjectError = localizedTeamError(projects.error, effectiveLanguage, t);
  const displayProjectActionError = localizedTeamError(projects.actionError, effectiveLanguage, t);
  const displayPublishNote = localizedPublishNote(projects.publishNote, effectiveLanguage, t);

  const activeInvite = useMemo(() => invites.find((invite) => invite.status === "pending") ?? null, [invites]);
  const hasTeam = teams.length > 0 && Boolean(selectedTeam);
  const isOwner = isTeamOwner(selectedTeam);
  const canInvite = canInviteToTeam(selectedTeam);
  const isTeamAdminViewer = isOwner || selectedTeam?.membership_role === "admin";
  // A member sees the team's summary whenever the team turns it on, at any team size (owner decision 2026-10-22).
  const teamSummaryHidden = activePolicy !== null && viewerRole === "member" && !activePolicy.memberSummary;
  const memberProjectFigure = activePolicy ? shareLevelRank(activePolicy.projects) >= 2 : true;
  // A member's own team, for what they consent to and what their managers see of them.
  const viewerTeamPolicy = policyForGroup(selectedTeam?.viewer_group_id ?? null);

  // The Projects tab follows the Overview's rules: the seat's own part of the
  // organization, no totals for a member whose team keeps its summary, sums
  // across teams without teams that keep project time to themselves, and a
  // per-person split only for people whose own team shares projects per person.
  const projectsTab = useMemo(() => {
    const totalsWithheld = viewerRole === "member" && teamSummaryHidden;
    const rows = qaMock && selectedTeam
      ? teamProjectRowsFromDataset(datasetAcrossTeams, projects.projects, selectedTeam.organization_id, projects.window)
      : { mix: projects.mix, members: projects.members };
    const totalsShown = !totalsWithheld;
    // Rows name people by slot; the preview's slots map back to each person's team.
    const slots = previewMemberSlots(datasetAcrossTeams);
    const groupOfMember = new Map(datasetAcrossTeams.members.map((member) => ["slot:" + String(slots.get(member.member_key)), member.group_id] as const));
    const splitRows = teamPolicy
      ? rows.members.filter((row) => {
          const policy = sharingPolicyForGroup(teamPolicy, groupPolicies, allGroups, groupOfMember.get(teamMemberGroupKey(row)) ?? null);
          return shareLevelRank(policy.projects) >= 2;
        })
      : memberProjectFigure ? rows.members : [];
    const memberSplitShown = totalsShown && viewerAssignment?.access !== "summary" && viewerRole !== "member" && splitRows.length > 0;
    return {
      mix: totalsShown ? rows.mix : [],
      members: memberSplitShown ? splitRows : [],
      totalsShown,
      memberSplitShown,
    };
  }, [allGroups, datasetAcrossTeams, groupPolicies, memberProjectFigure, projects.members, projects.mix, projects.projects, projects.window, qaMock, selectedTeam, teamPolicy, teamSummaryHidden, viewerAssignment?.access, viewerRole]);

  // Unsaved sharing and hours belong to the team: leaving the Settings tab keeps them, switching teams drops them.
  useEffect(() => {
    setPolicyDraft(null);
    setWindowDraft(null);
    setTrackingDraft(null);
    setGroupDrafts({});
  }, [selectedTeam?.organization_id]);

  // The owner's roster loads when the Settings tab opens; a pending confirmation never outlives it.
  useEffect(() => {
    setPendingConfirm(null);
    setConfirmBusy(false);
    setConfirmFailed(false);
    setFailedAction(null);
    // With edits waiting, the tab reopens where they are; otherwise inside one team or division it starts on its sharing.
    if (!settingsDirty) {
      setSharingRowOpen(false);
      const openTeam = groupId ?? leadGroupId;
      setSharingTarget(settingsOpen && openTeam && isTeamAdmin(selectedTeam) ? openTeam : DEFAULT_SHARING_TARGET);
      if (settingsOpen && openTeam && isTeamAdmin(selectedTeam)) setSharingRowOpen(true);
    }
    if (settingsOpen && isOwner && selectedTeam) void refreshMembers(selectedTeam.organization_id);
  }, [settingsOpen, isOwner, selectedTeam?.organization_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each invite starts on the team in view, or the inviter's own.
  useEffect(() => {
    if (inviteOpen) setInviteGroupId(null);
  }, [inviteOpen]);

  const askToConfirm = (next: PendingTeamConfirm) => {
    setConfirmFailed(false);
    setFailedAction(null);
    setPendingConfirm(next);
  };

  /** Runs the confirmed action; the dialog closes on success and stays with the error otherwise. */
  const runConfirmed = async (typed: string) => {
    if (!selectedTeam || !pendingConfirm || confirmBusy) return;
    const target = pendingConfirm;
    if (target.kind === "delete" && typed.trim().toLowerCase() !== selectedTeam.organization_name.trim().toLowerCase()) return;
    setConfirmBusy(true);
    setConfirmFailed(false);
    const organization_id = selectedTeam.organization_id;
    const done = target.kind === "remove"
      ? await handleRemoveMember({ organization_id, member_key: target.memberKey })
      : target.kind === "leave"
        ? await handleLeaveTeam({ organization_id })
        : target.kind === "transfer"
          ? await (controller.handleTransferOwnership?.({ organization_id, member_key: target.memberKey }) ?? Promise.resolve(false))
          : target.kind === "deleteGroup"
            ? await (controller.handleDeleteGroup?.({ group_id: target.groupId, move_to: target.moveTo === NO_GROUP ? null : target.moveTo }) ?? Promise.resolve(false))
            : target.kind === "deleteFormer"
              ? await (controller.handleDeleteFormerRecords?.({ organization_id, member_key: target.memberKey }) ?? Promise.resolve(false))
            // The server compares the same way: case and surrounding spaces do not matter.
            : await handleDeleteTeam({ organization_id, confirmation_name: typed });
    setConfirmBusy(false);
    if (!done) {
      setConfirmFailed(true);
      setFailedAction(target.kind === "delete" ? "delete" : "member");
      return;
    }
    setPendingConfirm(null);
    if (target.kind === "leave" || target.kind === "delete") setSettingsOpen(false);
  };

  // The switcher closes on an outside press or Escape, and opens on the current team.
  useEffect(() => {
    if (!switcherOpen) return;
    const menu = switcherMenuRef.current;
    (menu?.querySelector<HTMLElement>("[data-switcher-search]") ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]'))?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (switcherTriggerRef.current?.contains(target) || switcherMenuRef.current?.contains(target)) return;
      setSwitcherOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setSwitcherOpen(false);
      switcherTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [switcherOpen]);

  // Opening the invite modal with no live invite mints one (once per open).
  useEffect(() => {
    if (!inviteOpen) {
      inviteRequestedRef.current = false;
      return;
    }
    if (activeInvite || inviteRequestedRef.current || teamActionLoading || !selectedTeam || !canInvite) return;
    inviteRequestedRef.current = true;
    void handleCreateInvite({ organization_id: selectedTeam.organization_id });
  }, [activeInvite, canInvite, handleCreateInvite, inviteOpen, selectedTeam, teamActionLoading]);

  // Close the add-team modal once its create/join round-trip succeeds. `teams`
  // is a dependency so a roster change also closes it (covers flows where the
  // action resolves without a loading cycle, e.g. the QA mock).
  useEffect(() => {
    if (!addSubmittedRef.current || teamActionLoading) return;
    if (teamActionError) {
      addSubmittedRef.current = false;
      return;
    }
    addSubmittedRef.current = false;
    setAddOpen(false);
    setTeamName("");
    setInviteKey("");
  }, [teamActionError, teamActionLoading, teams]);

  const copyValue = (key: "link" | "code", value: string) => {
    void onCopyInvite(value);
    showCopied(key);
  };

  const submitCreateTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    addSubmittedRef.current = true;
    void handleCreateTeam({ organizationName: name });
  };

  const submitJoin = async () => {
    const key = inviteKey.trim();
    if (!key || joinSubmitting || (!qaMock && !invitePreview.preview)) return;
    const accept = pendingInvite ? onAcceptPendingInvite : handleAcceptInvite;
    setJoinSubmitting(true);
    try {
      const accepted = await accept({ inviteKey: key, ...(!qaMock && invitePreview.preview ? { expectedPolicyVersion: invitePreview.preview.policyVersion } : {}) });
      if (accepted === true) { setAddOpen(false); setInviteKey(""); }
      else if (!qaMock) invitePreview.refresh();
    } finally { setJoinSubmitting(false); }
  };
  // Joining a team that shares on a policy is consent, which never takes plain Enter.
  const joinNeedsConsent = addTab === "join" && (!qaMock || Boolean(teamPolicy && selectedTeam && inviteKey.trim()));
  useModalSubmitShortcut(addModalRef, "enter", addTab === "create" ? submitCreateTeam : submitJoin, {
    // The create wizard handles Enter itself, step by step.
    disabled:
      !addOpen ||
      teamActionLoading ||
      !(addTab === "create" ? teamName : inviteKey).trim() ||
      (addTab === "create" && Boolean(controller.handleCreateTeamWithPolicy)) ||
      joinNeedsConsent,
  });

  useModalSubmitShortcut(settingsModalRef, "modEnter", () => {
    const edit = policyEdit();
    if (edit && !policySaveBlocked(edit)) void edit.save();
  }, { disabled: !settingsOpen || !settingsDirty || pendingConfirm !== null || teamActionLoading });

  const regenerateInvite = async () => {
    if (!selectedTeam) return;
    if (activeInvite) await handleRevokeInvite({ invite_id: activeInvite.invite_id });
    await handleCreateInvite({ organization_id: selectedTeam.organization_id });
  };

  const onCreateProject = (draft: TeamProjectDraft) => {
    void projects.createProject({ name: draft.name, description: draft.description, color: draft.color, anchors: draft.anchors });
  };

  // Teammates publish on their own schedule, so the page refreshes itself as the
  // Leaderboard does (every five minutes while visible, and on returning to the
  // window) and only surfaces a status while it updates or after it failed.
  const refreshTeamView = useCallback(() => {
    void projects.refresh();
    void refreshTeamData();
  }, [projects, refreshTeamData]);
  const autoRefreshRef = useRef(refreshTeamView);
  autoRefreshRef.current = refreshTeamView;
  const autoRefreshActive = canUse && hasTeam && !qaMock;
  const hasTeamData = projects.projects.length > 0 || projects.mix.length > 0;
  useEffect(() => {
    if (!autoRefreshActive) return undefined;
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") autoRefreshRef.current();
    };
    const intervalId = window.setInterval(refreshIfVisible, TEAM_AUTO_REFRESH_MS);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [autoRefreshActive]);

  const openAdd = (tab: "create" | "join") => {
    setAddTab(tab);
    setWizardKey((key) => key + 1);
    setAddOpen(true);
  };

  const isPopulated = canUse && hasTeam && !pendingInvite;
  const memberDetailOpen = isPopulated && subView === "dashboards" && focusDashboards && overviewModel !== null && memberDetailModel !== null;
  useEffect(() => {
    if (memberDetailOpen || wasMemberDetailOpenRef.current) {
      pageHeadRef.current?.scrollIntoView?.({ block: "start" });
    }
    wasMemberDetailOpenRef.current = memberDetailOpen;
  }, [memberDetailOpen, selectedMemberKey]);
  useEffect(() => {
    if (!isPopulated) setSwitcherOpen(false);
  }, [isPopulated]);
  const windowLabel = formatLocalizedDateRangeLabel(projects.window.start_date, projects.window.end_date, effectiveLanguage);
  const atLatestWindow = windowOffset === 0;
  const [projectsListResetSignal, setProjectsListResetSignal] = useState(0);
  const [projectCreateSignal, setProjectCreateSignal] = useState(0);
  const handleSubViewChange = (next: TeamProjectsSubView) => {
    // Pressing the open Projects tab again leaves a project's detail for the list.
    if (next === "projects" && subView === "projects") setProjectsListResetSignal((value) => value + 1);
    // Pressing the open Overview tab again leaves a member's detail or a group for the top level.
    if (next === "dashboards" && subView === "dashboards") {
      setSelectedMemberKey(null);
      setGroupId(null);
    }
    if (next !== subView) setSelectedMemberKey(null);
    onSubViewChange(next);
  };
  // Team settings is a tab of the team page, beside Overview and Projects (owner decision 2026-10-19).
  const settingsPageOpen = settingsOpen && selectedTeam !== null;
  // Candidate D: the member's own records first, where their team shares anything per person; the
  // Overview keeps the team's totals and goes when the team keeps them from members.
  const selfTabShown = isPopulated && selfPageShown && selfView === "tab" && selfPersonal;
  const selfTabOpen = selfTabShown && (selfTab || (teamSummaryHidden && subView === "dashboards"));
  // E: a member whose team keeps its summary has nothing on the Overview, so the team page opens on Projects.
  // F: with the summary kept from members and nothing shared per person, the Overview would hold nothing at all.
  const overviewDropped = viewerRole === "member" && teamSummaryHidden && ((selfTabShown) || (qaMock && focusDashboards && (selfView === "none" || (selfView === "rize" && !selfPersonal))));
  // The Dashboard (2026-10-20): admins and managers only. The Dev preview keeps each scope's boards on this
  // device; a live team on a server that stores sharing keeps them on the server with the leader's account.
  const serverKeepsBoards = !qaMock && controller.handleSetSharingPolicy !== undefined;
  const boardShown = isPopulated && focusDashboards && viewerRole !== "member" && overviewModel !== null && (qaMock ? TEAM_DASHBOARD_TAB.read() === "tab" : serverKeepsBoards);
  const boardOrganizationId = selectedTeam?.organization_id ?? null;
  const boardRemote = useMemo<TeamBoardsRemote | null>(() => {
    if (!serverKeepsBoards || !boardOrganizationId) return null;
    return {
      load: () => fetchTeamServerBoards({ organization_id: boardOrganizationId }),
      save: (board) => saveTeamServerBoard({ organization_id: boardOrganizationId, ...board }),
      remove: (dashboardId) => deleteTeamServerBoard({ dashboard_id: dashboardId }),
    };
  }, [boardOrganizationId, serverKeepsBoards]);
  const boardOwnerNames = useMemo(() => new Map(members.map((member) => [member.member_key, member.display_name])), [members]);
  // The preview has no other leaders' boards on a server; one of its leaders shares one, to review that view.
  const previewBoardLeader = qaMock ? focusDataset.members.find((member) => !member.is_self && member.membership_role !== "member")?.member_key ?? null : null;
  const boardOpen = boardShown && boardTab && !settingsPageOpen && !selfTabOpen;
  const boardPolicy: TeamSharingPolicy = activePolicy ?? policyForLegacyScope(sharingScope ?? "projects");
  const boardAccess: TeamBoardAccess | null = overviewModel ? {
    visibility: teamSharingVisibility(boardPolicy),
    acrossTeams,
    summarySeat: viewerAssignment?.access === "summary",
    hasTeams: overviewModel.groupCards.length > 0,
  } : null;
  const viewTabs: readonly { readonly id: TeamProjectsSubView | "settings" | "self" | "board"; readonly label: string }[] = [
    ...(selfTabShown ? [{ id: "self" as const, label: t("team.tab.self") }] : []),
    ...(overviewDropped ? [] : [{ id: "dashboards" as const, label: t("team.tab.overview") }]),
    ...(boardShown ? [{ id: "board" as const, label: t("team.tab.board") }] : []),
    { id: "projects", label: t("team.tab.projects") },
    ...(selectedTeam ? [{ id: "settings" as const, label: t("team.tab.settings") }] : []),
  ];
  useEffect(() => {
    if (overviewDropped && !selfTabShown && subView === "dashboards") onSubViewChange("projects");
  }, [onSubViewChange, overviewDropped, selfTabShown, subView]);
  const activeViewTab: TeamProjectsSubView | "settings" | "self" | "board" = settingsPageOpen ? "settings" : selfTabOpen ? "self" : boardOpen ? "board" : subView;
  const handleViewTabChange = (next: TeamProjectsSubView | "settings" | "self" | "board") => {
    // Edits that would otherwise wait unseen in Settings are saved or dropped first (2026-10-25), as the category editor asks.
    if (next !== "settings" && settingsPageOpen && settingsDirty && pendingLeave === null) {
      setPendingLeave(next);
      return;
    }
    goToView(next);
  };
  const goToView = (next: TeamProjectsSubView | "settings" | "self" | "board") => {
    if (next !== "board") {
      setMemberFromBoard(false);
    }
    if (next === "settings") {
      setSettingsOpen(true);
      return;
    }
    if (next === "board") {
      setSettingsOpen(false);
      setSelectedMemberKey(null);
      setSelfTab(false);
      setBoardTab(true);
      return;
    }
    setBoardTab(false);
    if (next === "self") {
      setSettingsOpen(false);
      setSelectedMemberKey(null);
      setSelfTab(true);
      return;
    }
    setSelfTab(false);
    // Leaving settings returns to the view as it was, without the reset a second press of its tab does.
    if (settingsPageOpen) {
      setSettingsOpen(false);
      if (next !== subView) handleSubViewChange(next);
      return;
    }
    handleSubViewChange(next);
  };
  const openMember = (memberKey: string) => {
    if (peopleHidden) return;
    // Across teams a person opens inside their own team, on its sharing: their page where
    // it shares per person, the team itself where it does not.
    if (acrossTeams) {
      const person = focusDataset.members.find((member) => member.member_key === memberKey);
      if (person?.group_id) {
        setGroupId(person.group_id);
        const policy = policyForGroup(person.group_id);
        if (policy && !teamSharingVisibility(policy).personal) {
          setSelectedMemberKey(null);
          return;
        }
      }
    }
    setSelectedMemberKey(memberKey);
  };
  const openGroup = (nextGroupId: string | null) => {
    setSelectedMemberKey(null);
    setGroupId(nextGroupId);
  };

  const closeSwitcher = (restoreFocus: boolean) => {
    setSwitcherOpen(false);
    if (restoreFocus) switcherTriggerRef.current?.focus();
  };

  const chooseTeam = (organizationId: string) => {
    if (organizationId !== selectedTeam?.organization_id) selectTeam(organizationId);
    closeSwitcher(true);
  };
  // A team picked in the title opens on its Overview, the view the title names.
  const chooseGroup = (nextGroupId: string | null, current: boolean) => {
    closeSwitcher(true);
    if (current) return;
    if (settingsPageOpen || subView !== "dashboards") handleViewTabChange("dashboards");
    openGroup(nextGroupId);
  };

  const handleSwitcherMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      closeSwitcher(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    // Home and End move the caret in the team search.
    if (event.target instanceof HTMLInputElement && (event.key === "Home" || event.key === "End")) return;
    const items = Array.from(switcherMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const activeIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (activeIndex + 1 + items.length) % items.length
          : (activeIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  // A member's own records are the page managers open of them, so the page explains itself: no line
  // naming what managers see (what a team shares is shown before joining and in Settings). In the
  // Overview (C) the records carry a section title like the people they replace; the tab (D) is its own title.
  const selfHead = selfView === "page" ? (
    <div className="team-focus__tools">
      <h3 className="team-focus__section-title label-mono">{t("team.tab.self")}</h3>
    </div>
  ) : null;
  // Nothing shared per person: no records at all, not a notice in their place.
  const selfPage = selfPageShown && selfDetailModel && selectedTeam ? (
    <TeamMemberDetailView
      teamName={selectedTeam.organization_name}
      model={selfDetailModel}
      projects={projects.projects}
      window={projects.window}
      nowMinuteOfDay={clock.nowMinuteOfDay}
      hasPrevious={false}
      hasNext={false}
      onBack={() => undefined}
      onPrevious={() => undefined}
      onNext={() => undefined}
      projectPanel={qaMock ? readTeamProjectPanelCandidate() : "donut"}
      layout={memberPageLayout}
      historyPosition={qaMock ? readTeamMemberHistoryPosition() : "below"}
      privacyNoteShown={false}
      head={selfHead}
    />
  ) : null;

  // One date range control follows its subject: the team tab or the member page head.
  // Held, it keeps its place unseen and out of reach, so the tabs beside it never move.
  const rangeControlsFor = (held: boolean) => (
    <div className={held ? "classification-range-controls trends-range-controls is-held" : "classification-range-controls trends-range-controls"} aria-hidden={held || undefined}>
      {/* The Leaderboard's refresh status: shown only while updating, or as a retry after a failure.
          First in the right-aligned group, so the period and window controls never move when it comes and goes. */}
      {projects.loading && hasTeamData ? (
        <span className="leaderboard-refresh-status team-refresh-status" role="status" aria-live="polite">{t("team.refresh.updating")}</span>
      ) : projects.error ? (
        <button type="button" className="leaderboard-refresh-status team-refresh-status" data-tone="error" onClick={refreshTeamView} title={projects.error}>{t("team.refresh.retry")}</button>
      ) : null}
      <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label={t("team.range.aria")}>
        {([
          { key: "daily", label: t("common.day") },
          { key: "weekly", label: t("common.week") },
          { key: "monthly", label: t("common.month") },
        ] as const).map((option) => (
          <button
            type="button"
            className={period === option.key ? "settings-mode-option is-active" : "settings-mode-option"}
            role="radio"
            aria-checked={period === option.key}
            key={option.key}
            onClick={() => {
              setPeriod(option.key);
              setWindowOffset(0);
            }}
          >
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      {/* Shared with Dashboard/Trends/Projects/Classification so the step
          controls cannot drift from the rest of the app again. */}
      <DateNavigator
        ariaLabel={t("team.range.windowAria")}
        label={windowLabel}
        todayLabel={t("team.range.latest")}
        isTodayDisabled={atLatestWindow}
        isNextDisabled={atLatestWindow}
        onPrevious={() => setWindowOffset((offset) => offset + 1)}
        onNext={() => setWindowOffset((offset) => Math.max(0, offset - 1))}
        onToday={() => setWindowOffset(0)}
        previousLabel={t("team.range.previous")}
        nextLabel={t("team.range.next")}
      />
    </div>
  );
  const rangeControls = rangeControlsFor(false);

  // B and C: the title holds the seat's path on the Overview and a person's page; the
  // organization name returns to the top when inside it, and its chevron switches organizations.
  // With the team switcher the title names what every tab shows: the open team on the Overview and a
  // person's page, and the seat's own part elsewhere, so a member reads their team on each tab.
  const titlePath = !pathInTitle || !focusDashboards
    ? []
    : teamSwitcher
      ? !settingsPageOpen && (subView === "dashboards" || boardOpen || selectedMemberKey !== null) ? containerPath : leadPath
      : subView === "dashboards" || boardOpen || selectedMemberKey !== null ? containerPath : [];
  const titleRootLink = pathInTitle && leadGroupId === null && (titlePath.length > 0 || selectedMemberKey !== null);
  const switcherCurrent = titlePath.length > 0 ? titlePath[titlePath.length - 1]! : null;
  // A manager's teams together are not the organization, so the title names them as such.
  const switcherOnAssigned = switcherCurrent === null && viewerScopeGroupIds !== null;
  const switcherCurrentName = switcherCurrent?.name ?? (switcherOnAssigned ? t("team.switcher.assignedTeams") : selectedTeam?.organization_name ?? "");
  const switcherQueryText = switcherQuery.trim().toLocaleLowerCase();
  const switcherMatches = switcherQueryText ? switcherTargets.filter((target) => target.label.toLocaleLowerCase().includes(switcherQueryText)) : switcherTargets;
  const switcherCheck = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>;
  const switcherGroupItem = (id: string | null, label: string, hint: string | null, current: boolean) => (
    <button
      key={id ?? "organization"}
      type="button"
      role="menuitemradio"
      aria-checked={current}
      className={current ? "team-switcher-menu__item is-current" : "team-switcher-menu__item"}
      onClick={() => chooseGroup(id, current)}
    >
      <span className="team-switcher-menu__check" aria-hidden="true">{current ? switcherCheck : null}</span>
      <span className="team-switcher-menu__name" title={label}>{label}</span>
      {hint ? <span className="team-switcher-menu__hint">{hint}</span> : null}
    </button>
  );
  // A crumb above where the seat is: a link where the seat can open it (the organization for its
  // admins; a division in the path is always in the seat's part), plain text otherwise.
  const titleCrumb = (key: string, name: string, onOpen: () => void, linked: boolean, className = "team-title__crumb") => (
    linked
      ? <button key={key} type="button" className={className} title={name} onClick={onOpen}>{name}</button>
      : <span key={key} className={className + " team-title__crumb--static"} title={name}>{name}</span>
  );

  return (
    <>
      <div ref={pageHeadRef} className="pg-head team-page-head">
        <div className={"team-title" + (pathInTitle ? " team-title--path" : "")}>
          {pageTitle === "path"
            ? <h1 className="sr-only">{t("team.page.teams")}</h1>
            : <h1>{pageTitle === "kind" && allGroups.length > 0 ? t("team.page.organization") : t("team.page.teams")}</h1>}
          {isPopulated && selectedTeam && teamSwitcher ? (
            <>
              {pageTitle === "path" ? null : <span className="team-title__separator" aria-hidden="true">/</span>}
              {switcherCurrent || switcherOnAssigned ? (
                <>
                  {titleCrumb("organization", selectedTeam.organization_name, () => openGroup(null), viewerScopeGroupIds === null, "team-title__crumb team-title__crumb--org")}
                  {titlePath.slice(0, -1).map((group) => (
                    <Fragment key={group.id}>
                      <span className="team-title__separator" aria-hidden="true">/</span>
                      {titleCrumb(group.id, group.name, () => openGroup(group.id), true)}
                    </Fragment>
                  ))}
                  <span className="team-title__separator" aria-hidden="true">/</span>
                </>
              ) : null}
              <div className="team-switcher">
                <button
                  ref={switcherTriggerRef}
                  type="button"
                  className="team-switcher__trigger team-switcher__trigger--current"
                  aria-haspopup="menu"
                  aria-expanded={switcherOpen}
                  aria-label={t("team.switcher.aria", { team: switcherCurrentName })}
                  onClick={() => {
                    setSwitcherQuery("");
                    setSwitcherOpen((open) => !open);
                  }}
                >
                  <span className="team-switcher__name" title={switcherCurrentName}>{switcherCurrentName}</span>
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                </button>
                <AnchoredPresence>{switcherOpen ? (
                  <div
                    ref={switcherMenuRef}
                    className="team-switcher-menu team-switcher-menu--teams"
                    role="menu"
                    aria-label={t("team.switcher.teams")}
                    onKeyDown={handleSwitcherMenuKeyDown}
                  >
                    {/* Past a screenful of teams the menu searches, as Rize's team picker does. */}
                    {switcherTargets.length > 8 ? (
                      <span className="projects-search team-switcher-menu__search">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                        <input data-switcher-search className="settings-input" type="text" placeholder={t("team.switcher.search")} aria-label={t("team.switcher.search")} value={switcherQuery} onChange={(event) => setSwitcherQuery(event.target.value)} />
                      </span>
                    ) : null}
                    <div className="team-switcher-menu__label" aria-hidden="true">{t("team.switcher.teams")}</div>
                    {/* The top: the whole organization for its admins, a manager's teams together otherwise. */}
                    {leadGroupId === null && !switcherQueryText ? switcherGroupItem(null, viewerScopeGroupIds === null ? t("team.switcher.wholeOrganization") : t("team.switcher.assignedTeams"), null, switcherCurrent === null) : null}
                    {switcherMatches.map((target) => switcherGroupItem(target.group.id, target.label, target.kind === "division" ? t("team.sharingTargets.division") : null, target.group.id === switcherCurrent?.id))}
                    {switcherMatches.length === 0 ? <div className="team-switcher-menu__empty">{t("team.switcher.noMatch")}</div> : null}
                    {teams.length > 1 ? (
                      <>
                        <div className="team-switcher-menu__divider" role="separator" />
                        <div className="team-switcher-menu__label" aria-hidden="true">{t("team.switcher.organizations")}</div>
                        {teams.map((team) => {
                          const isCurrent = team.organization_id === selectedTeam.organization_id;
                          return (
                            <button
                              key={team.organization_id}
                              type="button"
                              role="menuitemradio"
                              aria-checked={isCurrent}
                              className={isCurrent ? "team-switcher-menu__item is-current" : "team-switcher-menu__item"}
                              onClick={() => chooseTeam(team.organization_id)}
                            >
                              <span className="team-switcher-menu__check" aria-hidden="true">{isCurrent ? switcherCheck : null}</span>
                              <span className="team-switcher-menu__name" title={team.organization_name}>{team.organization_name}</span>
                            </button>
                          );
                        })}
                      </>
                    ) : null}
                    <div className="team-switcher-menu__divider" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="team-switcher-menu__item"
                      onClick={() => {
                        closeSwitcher(false);
                        openAdd("create");
                      }}
                    >
                      <span className="team-switcher-menu__check" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      </span>
                      <span className="team-switcher-menu__name">{t("team.switcher.createOrJoinOrganization")}</span>
                    </button>
                  </div>
                ) : null}</AnchoredPresence>
              </div>
            </>
          ) : isPopulated && selectedTeam ? (
            <>
              {pageTitle === "path" ? null : <span className="team-title__separator" aria-hidden="true">/</span>}
              <div className="team-switcher">
                {titleRootLink ? (
                  <button type="button" className="team-title__crumb team-title__crumb--org" title={selectedTeam.organization_name} onClick={() => openGroup(null)}>
                    {selectedTeam.organization_name}
                  </button>
                ) : null}
                <button
                  ref={switcherTriggerRef}
                  type="button"
                  className={"team-switcher__trigger" + (titleRootLink ? " team-switcher__trigger--chevron" : "")}
                  aria-haspopup="menu"
                  aria-expanded={switcherOpen}
                  aria-label={t("team.switcher.aria", { team: selectedTeam.organization_name })}
                  onClick={() => setSwitcherOpen((open) => !open)}
                >
                  {titleRootLink ? null : <span className="team-switcher__name" title={selectedTeam.organization_name}>{selectedTeam.organization_name}</span>}
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
                </button>
                <AnchoredPresence>{switcherOpen ? (
                  <div
                    ref={switcherMenuRef}
                    className="team-switcher-menu"
                    role="menu"
                    aria-label={t("team.nav.yourTeams")}
                    onKeyDown={handleSwitcherMenuKeyDown}
                  >
                    <div className="team-switcher-menu__label" aria-hidden="true">{t("team.nav.yourTeams")}</div>
                    {teams.map((team) => {
                      const isCurrent = team.organization_id === selectedTeam.organization_id;
                      return (
                        <button
                          key={team.organization_id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={isCurrent}
                          className={isCurrent ? "team-switcher-menu__item is-current" : "team-switcher-menu__item"}
                          onClick={() => chooseTeam(team.organization_id)}
                        >
                          <span className="team-switcher-menu__check" aria-hidden="true">
                            {isCurrent ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg> : null}
                          </span>
                          <span className="team-switcher-menu__name" title={team.organization_name}>{team.organization_name}</span>
                        </button>
                      );
                    })}
                    <div className="team-switcher-menu__divider" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="team-switcher-menu__item"
                      onClick={() => {
                        closeSwitcher(false);
                        openAdd("create");
                      }}
                    >
                      <span className="team-switcher-menu__check" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      </span>
                      <span className="team-switcher-menu__name">{t("team.nav.createOrJoin")}</span>
                    </button>
                  </div>
                ) : null}</AnchoredPresence>
              </div>
              {titlePath.map((group, index) => (
                <Fragment key={group.id}>
                  <span className="team-title__separator" aria-hidden="true">/</span>
                  {index === titlePath.length - 1 && selectedMemberKey === null ? (
                    <span className="team-title__current" aria-current="page" title={group.name}>{group.name}</span>
                  ) : (
                    <button type="button" className="team-title__crumb" title={group.name} onClick={() => openGroup(group.id)}>{group.name}</button>
                  )}
                </Fragment>
              ))}
            </>
          ) : null}
        </div>
        {isPopulated ? (
          <div className="team-header-actions">
            {qaMock ? <span className="chip gold team-preview-badge" title={t("team.preview.badgeHint")}>{t("team.preview.badge")}</span> : null}
            {canInvite ? (
              <button type="button" className="app-btn app-btn--secondary" onClick={() => setInviteOpen(true)}>
                {t("team.nav.inviteTeammate")}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Both views read the same window (chart + the table's Team time column),
          so the range sits on the tab rule like Insights. */}
      {isPopulated && (!memberDetailOpen || settingsPageOpen) ? (
        <div className="page-toolbar team-toolbar">
          <PageTabs
            tabs={viewTabs}
            activeTab={activeViewTab}
            onChange={handleViewTabChange}
            ariaLabel={t("team.tabs.aria")}
            idPrefix="team-view"
            panelId="team-workspace-panel"
          />
          {/* Settings reads no period; the controls keep their height there, so the tabs stay put. */}
          {settingsPageOpen ? rangeControlsFor(true) : rangeControls}
        </div>
      ) : null}

      <div className="team-page-layout">
        <section
          id="team-workspace-panel"
          className="team-panel"
          role={isPopulated && (!memberDetailOpen || settingsPageOpen) ? "tabpanel" : undefined}
          aria-labelledby={isPopulated && (!memberDetailOpen || settingsPageOpen) ? pageTabId("team-view", activeViewTab) : undefined}
          aria-label={isPopulated ? undefined : t("team.panel.sharedProjects")}
        >
          {settingsPageOpen ? null : renderScheduledDeletions()}
          {settingsPageOpen ? null : renderSharingNotice()}
          {settingsPageOpen ? renderSettingsPage() : renderBody()}
        </section>
      </div>

      <ModalPresence onDismiss={() => setInviteOpen(false)}>
        {inviteOpen && selectedTeam ? renderInviteModal() : null}
      </ModalPresence>
      <ModalPresence onDismiss={() => setAddOpen(false)}>
        {addOpen ? renderAddModal() : null}
      </ModalPresence>
      <ModalPresence>
        {settingsOpen && pendingConfirm ? renderConfirmDialog() : null}
        {pendingLeave !== null ? renderLeaveSettingsDialog() : null}
      </ModalPresence>
    </>
  );

  function renderBody() {
    if (!isSupabaseEnabled && !qaMock) {
      return (
        <div className="empty-state team-state">
          <strong>{t("team.state.cloudTitle")}</strong>
          <p>{t("team.state.cloudBody")}</p>
        </div>
      );
    }
    if ((!isSignedIn || !hasRequiredAccountAuth) && !qaMock) {
      return (
        <div className="empty-state team-state">
          <span className="label-mono">{t("team.state.accountLabel")}</span>
          <strong>{t("team.state.signInTitle")}</strong>
          <p>{t("team.state.signInBody")}</p>
          <div className="team-onboard__actions">
            <button type="button" className="app-btn app-btn--primary" onClick={onSignIn}>{t("team.state.openSignIn")}</button>
          </div>
        </div>
      );
    }

    if (pendingInvite) {
      return (
        <section className="team-pending-invite" role="region" aria-label={t("team.invite.pendingAria")}>
          <div>
            <strong>
              {t("team.invite.pendingTitle")}
              {pendingInvite.inviteCode ? <> (<code className="team-code-inline">{pendingInvite.inviteCode}</code>)</> : null}
            </strong>
            <p>{t("team.invite.sharingStartsLater")}</p>
          </div>
          <div className="team-onboard__actions">
            <button
              type="button"
              className="app-btn app-btn--primary"
              disabled={teamActionLoading}
              onClick={() => { setInviteKey(pendingInvite.inviteKey); setAddTab("join"); setAddOpen(true); }}
            >
              {t("team.invite.join")}
            </button>
            <button type="button" className="app-btn app-btn--quiet" onClick={() => onPendingInviteClear?.()}>{t("team.invite.dismiss")}</button>
          </div>
          {displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
        </section>
      );
    }

    if (teamLoading && teams.length === 0) {
      return <div className="team-empty">{t("team.state.loadingTeams")}</div>;
    }

    if (!hasTeam) {
      return (
        <>
          <div className="team-onboard" aria-label={t("team.onboarding.aria")}>
            <span className="team-onboard__icon" aria-hidden="true"><TeamBadgeIcon /></span>
            <strong>{t("team.onboarding.title")}</strong>
            <p>{t("team.onboarding.body")}</p>
            <div className="team-onboard__actions">
              <button type="button" className="app-btn app-btn--primary" onClick={() => openAdd("create")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                {t("team.onboarding.create")}
              </button>
              <button type="button" className="app-btn app-btn--secondary" onClick={() => openAdd("join")}>{t("team.onboarding.joinWithCode")}</button>
            </div>
          </div>
          {displayTeamError ? <p className="team-message team-message--error">{displayTeamError}</p> : null}
        </>
      );
    }

    return (
      <>
        {boardOpen && overviewModel && boardAccess && selectedTeam ? (
          <TeamBoardView
            organizationId={selectedTeam.organization_id}
            model={overviewModel}
            dataset={focusDataset}
            groupId={effectiveGroupId}
            window={projects.window}
            access={boardAccess}
            projects={projects.projects}
            path={pathInTitle ? [] : boardPath(selectedTeam.organization_name)}
            onOpenMember={(memberKey) => {
              setBoardTab(false);
              setMemberFromBoard(true);
              if (subView !== "dashboards") onSubViewChange("dashboards");
              openMember(memberKey);
            }}
            onOpenGroup={openGroup}
            remote={boardRemote}
            ownerNames={boardOwnerNames}
            previewSharedFrom={previewBoardLeader}
          />
        ) : selfTabOpen ? selfPage : subView === "dashboards" && focusDashboards && overviewModel && memberDetailModel && selectedTeam ? (
          <TeamMemberDetailView
            teamName={[selectedTeam.organization_name, ...containerPath.map((group) => group.name)].join(" / ")}
            rangeControls={rangeControls}
            contextLabel={containerPath.length > 0 && !pathInTitle ? containerPath.map((group) => group.name).join(" / ") : null}
            model={memberDetailModel}
            projects={projects.projects}
            window={projects.window}
            nowMinuteOfDay={clock.nowMinuteOfDay}
            hasPrevious={memberIndex > 0}
            hasNext={memberIndex >= 0 && memberIndex < memberOrder.length - 1}
            onBack={() => {
              setSelectedMemberKey(null);
              // A person opened from the Dashboard returns to it.
              if (memberFromBoard) {
                setMemberFromBoard(false);
                setBoardTab(true);
              }
            }}
            onPrevious={() => { const key = memberOrder[memberIndex - 1]; if (key) setSelectedMemberKey(key); }}
            onNext={() => { const key = memberOrder[memberIndex + 1]; if (key) setSelectedMemberKey(key); }}
            projectPanel={qaMock ? readTeamProjectPanelCandidate() : "donut"}
            layout={memberPageLayout}
            historyPosition={qaMock ? readTeamMemberHistoryPosition() : "below"}
            privacyNoteShown={!teamPolicy}
          />
        ) : subView === "dashboards" && focusDashboards && overviewModel && selectedTeam && canInvite && viewerRole !== "member" && (selectedTeam.member_count ?? 0) <= 1 ? (
          // A team of only the person who made it opens on the two steps that start it (2026-10-25).
          <TeamGettingStarted
            projectCount={projects.projects.length}
            onInvite={() => setInviteOpen(true)}
            onProjects={() => {
              if (projects.projects.length === 0) setProjectCreateSignal((count) => count + 1);
              goToView("projects");
            }}
          />
        ) : subView === "dashboards" && focusDashboards && overviewModel && selectedTeam ? (
          <TeamOverviewView
            teamName={selectedTeam.organization_name}
            scope={sharingScope ?? "projects"}
            model={overviewModel}
            dataset={focusDataset}
            context={focusContext}
            groups={focusDataset.groups}
            projects={projects.projects}
            containerPath={containerPath}
            window={projects.window}
            viewerRole={viewerRole}
            loading={projects.loading}
            error={displayProjectError ?? displayTeamError}
            onOpenMember={openMember}
            onOpenGroup={openGroup}
            projectPanel={qaMock ? readTeamProjectPanelCandidate() : "donut"}
            summaryHidden={teamSummaryHidden}
            projectsShared={activePolicy ? activePolicy.projects !== "off" : true}
            memberProjectFigure={memberProjectFigure}
            peopleHidden={peopleHidden || (viewerRole === "member" && selfView === "rize" && !selfPersonal)}
            scopeLine={viewerReachLabel}
            organizationReachable={leadGroupId === null}
            acrossTeams={acrossTeams}
            memberPolicy={viewerRole === "member" ? activePolicy : null}
            selfView={selfView}
            selfPage={selfView === "page" ? selfPage : null}
            offHoursNote={offHoursNote}
            focusNote={focusNote}
            privacyNoteShown={!teamPolicy}
            crumbsInTitle={pathInTitle}
          />
        ) : subView === "dashboards" ? (
          <TeamDashboardsView
            window={projects.window}
            isLatestWindow={atLatestWindow}
            projects={projects.projects}
            mix={projects.mix}
            members={projects.members}
            memberCount={selectedTeam?.member_count ?? 0}
            memberDisplayName={selectedTeam?.member_display_name ?? null}
            loading={projects.loading}
            error={displayProjectError ?? displayTeamError}
            publishNote={displayPublishNote}
            onRefresh={() => {
              // The team list carries the member count, so refresh it with the totals.
              void projects.refresh();
              void refreshTeamData();
            }}
          />
        ) : (
          <TeamProjectsView
            teamName={selectedTeam?.organization_name ?? t("team.page.teams")}
            projects={projects.projects}
            mix={projectsTab.mix}
            members={projectsTab.members}
            totalsShown={projectsTab.totalsShown}
            memberSplitShown={projectsTab.memberSplitShown}
            memberDisplayName={selectedTeam?.member_display_name ?? null}
            window={projects.window}
            isLatestWindow={atLatestWindow}
            listResetSignal={projectsListResetSignal}
            createSignal={projectCreateSignal}
            onCreateSignalHandled={() => setProjectCreateSignal(0)}
            loading={projects.loading}
            error={displayProjectError}
            actionError={displayProjectActionError}
            actionLoading={projects.actionLoading}
            onCreate={onCreateProject}
            onUpdate={(input) => void projects.updateProject(input)}
            onArchive={(projectId, archived) => void projects.archiveProject(projectId, archived)}
          />
        )}

        {/*
          Only the single-scope beta keeps a footnote. With per-item sharing the
          team pages carry none: what is shared is settled on joining and listed
          in Team settings (owner decision 2026-10-18).
        */}
        {(!focusDashboards || subView === "projects") && !teamPolicy ? (
          <TeamPrivacyNote>{sharingScope !== null ? describeScope(sharingScope, t) : t("team.privacy.footnote")}</TeamPrivacyNote>
        ) : null}
      </>
    );
  }

  /**
   * The link and code fields before the dialog's link exists. They hold the
   * ready layout's place, so the dialog keeps its size while the link is made
   * and nothing moves when it arrives; a failed request is retried from the
   * link field itself (owner request 2026-10-29).
   */
  function renderPendingInviteFields() {
    const creating = teamActionLoading;
    const failed = !creating && Boolean(teamActionError);
    return (
      <>
        <div className="team-modal__field" aria-busy={creating || undefined}>
          <span className="label-mono">{t("team.invite.link")}</span>
          <div className="team-copy-row">
            <input
              className="settings-input modal-code"
              readOnly
              value=""
              placeholder={creating ? t("team.invite.creating") : t("team.invite.none")}
              aria-label={t("team.invite.link")}
            />
            {failed ? (
              <button type="button" className="modal-btn modal-btn--secondary" onClick={() => { if (selectedTeam) void handleCreateInvite({ organization_id: selectedTeam.organization_id }); }}>
                {t("common.retry")}
              </button>
            ) : (
              <button type="button" className="modal-btn modal-btn--primary" disabled>
                <ActionLabel busy={creating} reserve={[t("team.invite.copied")]}>{t("team.invite.copyLink")}</ActionLabel>
              </button>
            )}
          </div>
          <span className="sr-only" role="status">{creating ? t("team.invite.creating") : ""}</span>
        </div>
        <div className="team-modal__field">
          <span className="label-mono">{t("team.invite.code")}</span>
          <div className="team-code team-code--pending">
            <strong aria-hidden="true">DRFT-····-····</strong>
            <div className="team-code__actions">
              <button type="button" className="modal-btn modal-btn--ghost" disabled>{t("team.invite.copy")}</button>
            </div>
          </div>
          {isOwner ? <p className="team-modal__hint">{t("team.invite.refreshHint")}</p> : null}
        </div>
      </>
    );
  }

  function renderInviteModal() {
    const inviteUrl = activeInvite?.invite_url ? toShareableTeamInviteUrl(activeInvite.invite_url) : "";
    const inviteCode = activeInvite?.invite_code || "";
    // In an organization of teams the code joins one team, and the invitee consents to that team's sharing.
    const invitableTeams = leafSharingTeams(allGroups).filter((entry) => (
      isTeamAdminViewer || (viewerAssignment ? leafTeamsWithin(viewerAssignment.group_ids).includes(entry.group.id) : entry.group.id === selectedTeam?.viewer_group_id)
    ));
    const openLeaf = effectiveGroupId && invitableTeams.some((entry) => entry.group.id === effectiveGroupId) ? effectiveGroupId : null;
    const ownLeaf = invitableTeams.some((entry) => entry.group.id === selectedTeam?.viewer_group_id) ? selectedTeam?.viewer_group_id ?? null : null;
    const inviteTeam = invitableTeams.find((entry) => entry.group.id === (inviteGroupId ?? openLeaf ?? ownLeaf))?.group.id ?? invitableTeams[0]?.group.id ?? null;
    const invitePolicy = inviteTeam ? policyForGroup(inviteTeam) : teamPolicy;
    return (
      <div className="auth-modal__overlay" {...inviteOverlayDismiss}>
        <section
          className="auth-modal modal-shell profile-modal team-modal"
          data-modal-variant="standard"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-invite-title"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label={t("team.invite.close")} onClick={() => setInviteOpen(false)} />
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2 id="team-invite-title">{t("team.invite.title", { team: selectedTeam?.organization_name ?? t("team.invite.defaultTeam") })}</h2>
              {/* With sharing scopes the invite names what the team actually sees. */}
              <p>{teamPolicy ? t("team.invite.bodyLink") + " " + t("team.invite.policyBody") : sharingScope !== null ? t("team.invite.bodyLink") + " " + describeScope(sharingScope, t) : t("team.invite.body")}</p>
            </div>
          </div>
          <div className="team-modal__body">
            {activeInvite ? (
              <>
                <div className="team-modal__field">
                  <span className="label-mono">{t("team.invite.link")}</span>
                  <div className="team-copy-row">
                    <input
                      className="settings-input modal-code"
                      readOnly
                      value={inviteUrl || inviteCode}
                      aria-label={t("team.invite.link")}
                      onFocus={(event) => event.target.select()}
                    />
                    <button type="button" className="modal-btn modal-btn--primary" onClick={() => copyValue("link", inviteUrl || inviteCode)}>
                      <ActionLabel busy={false} reserve={[t("team.invite.copied")]}>{copiedKey === "link" ? t("team.invite.copied") : t("team.invite.copyLink")}</ActionLabel>
                    </button>
                  </div>
                </div>
                <div className="team-modal__field">
                  <span className="label-mono">{t("team.invite.code")}</span>
                  <div className="team-code">
                    <strong>{inviteCode}</strong>
                    <div className="team-code__actions">
                      {/* Replacing a live code cuts off links already shared, so it stays with the owner. */}
                      {isOwner ? (
                        <button
                          type="button"
                          className="team-iconbtn"
                          aria-label={t("team.invite.newCode")}
                          title={t("team.invite.newCode")}
                          disabled={teamActionLoading}
                          onClick={() => void regenerateInvite()}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.2 12a7.8 7.8 0 0 1 13.2-5.6L20 8.6" /><path d="M19.8 12a7.8 7.8 0 0 1-13.2 5.6L4 15.4" /><path d="M20 4v4.6h-4.6M4 20v-4.6h4.6" /></svg>
                        </button>
                      ) : null}
                      <button type="button" className="modal-btn modal-btn--ghost" onClick={() => copyValue("code", inviteCode)}>
                        {copiedKey === "code" ? t("team.invite.copied") : t("team.invite.copy")}
                      </button>
                    </div>
                  </div>
                  {isOwner ? <p className="team-modal__hint">{t("team.invite.refreshHint")}</p> : null}
                </div>
              </>
            ) : (
              renderPendingInviteFields()
            )}
            {teamPolicy && selectedTeam ? (
              <>
              {invitableTeams.length > 0 && inviteTeam ? (
                <div className="team-modal__field">
                  <span className="label-mono">{t("team.invite.teamLabel")}</span>
                  {invitableTeams.length > 1 ? (
                    <SettingsSelect
                      ariaLabel={t("team.invite.teamLabel")}
                      className="projects-status-filter team-invite__team"
                      value={inviteTeam}
                      options={invitableTeams.map((entry) => ({ value: entry.group.id, label: entry.label }))}
                      onChange={setInviteGroupId}
                    />
                  ) : (
                    <p className="team-invite__team-name">{invitableTeams[0]!.label}</p>
                  )}
                </div>
              ) : null}
              <div className="team-modal__field">
                <span className="label-mono">{t("team.policy.summary.heading")}</span>
                <TeamPolicySummary policy={invitePolicy ?? teamPolicy} window={selectedTeam.sharing_window ?? DEFAULT_TEAM_RECORDING_SCHEDULE} tracking={selectedTeam.tracking_policy ?? "free"} showZone={hoursZoneChoice} />
              </div>
              </>
            ) : null}
            {displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
          </div>
        </section>
      </div>
    );
  }

  function renderTeamInfoSection() {
    return (
      <div className="team-set-section">
        <span className="label-mono">{t("team.settings.team")}</span>
        <div className="team-set-member">
          <span className="team-set-member__name">{selectedTeam?.organization_name}</span>
          <span className="team-set-role">{t("team.settings.memberCount", { count: selectedTeam?.member_count ?? 0 })}</span>
          {/* The server role, not the invite label, decides the badge: a label is display text. */}
          <span className={isOwner ? "team-set-role--admin" : "team-set-role"}>
            {localizedTeamRole(selectedTeam?.membership_role ?? "member", t)}
          </span>
        </div>
      </div>
    );
  }

  function renderRosterSection() {
    if (!isOwner || !selectedTeam) return null;
    return (
      <div className="team-set-section">
        <span className="label-mono">{t("team.settings.members")}</span>
        {members.length > 0 ? (
          <ul className="team-set-members" aria-label={t("team.settings.members")}>
            {members.map((member) => {
              return (
                <li key={member.member_key} className="team-set-member">
                  <span className="team-set-member__name">
                    {member.display_name}
                    {member.is_self ? <span className="team-set-you">{t("team.settings.you")}</span> : null}
                    {member.membership_role === "owner" ? <span className="team-set-role--admin">{localizedTeamRole("owner", t)}</span> : null}
                  </span>
                  {member.membership_role !== "owner" ? (
                    <button
                      type="button"
                      // Quiet in the list; the dialog says what removing ends.
                      className="modal-btn modal-btn--ghost team-set-remove"
                      disabled={teamActionLoading}
                      aria-label={t("team.settings.removeAria", { name: member.display_name })}
                      onClick={() => askToConfirm({ kind: "remove", memberKey: member.member_key, name: member.display_name })}
                    >
                      {t("team.settings.remove")}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="team-modal__hint">{t("team.settings.membersLoading")}</p>
        )}
      </div>
    );
  }

  function renderInvitesSection() {
    if (!canInvite) return null;
    return (
      <div className="team-set-section">
        <div className="team-set-memhead">
          <span className="label-mono">{t("team.settings.invites")}</span>
          <button
            type="button"
            className="modal-btn modal-btn--secondary team-set-invite"
            onClick={() => setInviteOpen(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19.5v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.1a3.6 3.6 0 0 0-3.6 3.6v1.4" /><circle cx="8.8" cy="7.6" r="3.3" /><path d="M18.5 8v6M15.5 11h6" /></svg>
            {t("team.settings.invite")}
          </button>
        </div>
        {activeInvite ? (
          <p className="team-modal__hint">{t("team.settings.liveInvite", { code: activeInvite.invite_code })}</p>
        ) : (
          <p className="team-modal__hint">{t("team.settings.noInvite")}</p>
        )}
      </div>
    );
  }

  function renderInvitePermissionSection() {
    // Owner-only. Hidden while the server cannot report the setting yet.
    if (!isOwner || !selectedTeam || selectedTeam.members_can_invite === null) return null;
    // In the members tab the switch sits under the list it affects, in a settings row like every other tab's.
    const compact = Boolean(teamPolicy);
    if (compact) {
      return (
        <>
        <div className="team-form-rows">
          <div className="team-form-row">
            <div className="team-form-row__copy"><strong id="team-member-invites-label">{t("team.settings.membersCanInvite")}</strong></div>
            <div className="team-form-row__control">
              <Toggle
                checked={selectedTeam.members_can_invite}
                disabled={teamActionLoading}
                ariaLabel={t("team.settings.membersCanInvite")}
                onChange={(enabled) => {
                  setFailedAction(null);
                  void handleSetMemberInvites({ organization_id: selectedTeam.organization_id, enabled });
                }}
              />
            </div>
          </div>
        </div>
        {failedAction === null && displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
        </>
      );
    }
    return (
      <div className="team-set-section">
        {compact ? null : <span className="label-mono">{t("team.settings.invitePermission")}</span>}
        <div className="team-set-permission">
          <div className="team-set-permission__copy">
            <span id="team-member-invites-label" className="team-set-permission__title">{t("team.settings.membersCanInvite")}</span>
            {compact ? null : (
              <p id="team-member-invites-hint" className="team-modal__hint">
                {selectedTeam.members_can_invite ? t("team.settings.membersCanInviteOn") : t("team.settings.membersCanInviteOff")}
              </p>
            )}
          </div>
          <Toggle
            checked={selectedTeam.members_can_invite}
            disabled={teamActionLoading}
            ariaLabel={t("team.settings.membersCanInvite")}
            ariaDescribedBy={compact ? undefined : "team-member-invites-hint"}
            onChange={(enabled) => {
              setFailedAction(null);
              void handleSetMemberInvites({ organization_id: selectedTeam.organization_id, enabled });
            }}
          />
        </div>
        {failedAction === null && displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
      </div>
    );
  }

  function renderLegacyScopeSection() {
    // What the team shares, chosen by the owner. A server without scopes shows nothing here.
    if (!selectedTeam || sharingScope === null) return null;
    return (
      <div className="team-set-section">
        <span className="label-mono">{t("team.settings.sharingScope")}</span>
        <p className="team-modal__hint">{isOwner ? t("team.settings.sharingScopeOwnerHint") : t("team.settings.sharingScopeMemberHint")}</p>
        <div className="team-scope-list" role="radiogroup" aria-label={t("team.settings.sharingScope")}>
          {TEAM_SCOPE_DESCRIPTIONS.map((description) => {
            const checked = description.scope === sharingScope;
            return (
              <button
                key={description.scope}
                type="button"
                role="radio"
                aria-checked={checked}
                className={"team-scope-option" + (checked ? " is-checked" : "")}
                disabled={!isOwner || teamActionLoading}
                onClick={() => {
                  if (checked) return;
                  setFailedAction(null);
                  void handleSetSharingScope({ organization_id: selectedTeam.organization_id, sharing_scope: description.scope });
                }}
              >
                <span className="team-scope-option__radio" aria-hidden="true" />
                <span className="team-scope-option__copy">
                  <strong>{t(description.titleKey)}</strong>
                  <span>{t(description.bodyKey)}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="team-modal__hint team-scope-private">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2.2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          {t("team.settings.alwaysPrivate")} {TEAM_SCOPE_PRIVATE_KEYS.map((key) => t(key)).join(" · ")}
        </p>
        {isOwner ? <p className="team-modal__hint">{t("team.settings.scopeChangeHint")}</p> : null}
      </div>
    );
  }

  function renderLegacyTrackingSection() {
    if (!selectedTeam || selectedTeam.tracking_policy === null || selectedTeam.tracking_policy === undefined) return null;
    return (
      <div className="team-set-section">
        <span className="label-mono">{t("team.settings.trackingPolicy")}</span>
        <div className="team-set-permission">
          <div className="team-set-permission__copy">
            <span id="team-tracking-policy-label" className="team-set-permission__title">{t("team.settings.managedTracking")}</span>
            <p id="team-tracking-policy-hint" className="team-modal__hint">
              {selectedTeam.tracking_policy === "managed" ? t("team.settings.managedTrackingOn") : t("team.settings.managedTrackingOff")}
            </p>
          </div>
          <Toggle
            checked={selectedTeam.tracking_policy === "managed"}
            disabled={!isOwner || teamActionLoading}
            ariaLabel={t("team.settings.managedTracking")}
            ariaDescribedBy="team-tracking-policy-hint"
            onChange={(enabled) => {
              setFailedAction(null);
              void handleSetTrackingPolicy({ organization_id: selectedTeam.organization_id, tracking_policy: enabled ? "managed" : "free" });
            }}
          />
        </div>
        {selectedTeam.tracking_policy === "managed" ? (
          <p className="team-modal__hint">
            {t("team.settings.recordingSchedule", {
              days: t("team.settings.weekdays"),
              start: minuteClock((selectedTeam.recording_schedule ?? DEFAULT_TEAM_RECORDING_SCHEDULE).start_minute),
              end: minuteClock((selectedTeam.recording_schedule ?? DEFAULT_TEAM_RECORDING_SCHEDULE).end_minute),
            })}
          </p>
        ) : null}
      </div>
    );
  }

  function renderPublishSection() {
    return (
      <div className="team-set-section">
        <span className="label-mono">{t("team.settings.yourSharing")}</span>
        <p className="team-modal__hint">
          {displayPublishNote ?? (sharingScope !== null ? describeScope(sharingScope, t) : t("team.settings.sharingBody"))}
        </p>
        <div className="team-set-share">
          <button
            type="button"
            className="modal-btn modal-btn--primary"
            disabled={projects.publishing}
            aria-busy={projects.publishing}
            aria-label={t("team.settings.shareAria")}
            onClick={() => void projects.publishMyTime()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
            <ActionLabel busy={projects.publishing} busyLabel={t("team.settings.sharing")}>{t("team.settings.share")}</ActionLabel>
          </button>
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            aria-label={t("team.settings.stopAria")}
            onClick={() => void projects.stopSharing()}
          >
            {t("team.settings.stop")}
          </button>
        </div>
        {displayProjectActionError ? <p className="team-message team-message--error">{displayProjectActionError}</p> : null}
      </div>
    );
  }

  function renderLeaveSection() {
    // Members can leave; the owner cannot until ownership can be transferred.
    if (isOwner || !selectedTeam) return null;
    // Membership is the organization's, so with teams in it the button says so.
    const label = t(allGroups.length > 0 ? "team.general.leaveOrg" : "team.settings.leave");
    return (
      // One button names the section; the dialog says what leaving means.
      <div className="team-set-section team-set-leave-section" role="group" aria-label={label}>
        <div className="team-set-leave">
          <button type="button" className="modal-btn modal-btn--danger" disabled={teamActionLoading} onClick={() => askToConfirm({ kind: "leave" })}>
            {label}
          </button>
        </div>
      </div>
    );
  }

  function renderDeleteSection() {
    // The owner deletes the team instead of leaving it.
    if (!isOwner || !selectedTeam) return null;
    return (
      <div className="team-set-section team-set-leave-section" role="group" aria-label={t("team.settings.deleteSection")}>
        <div className="team-set-leave">
          <button type="button" className="modal-btn modal-btn--danger" disabled={teamActionLoading} onClick={() => askToConfirm({ kind: "delete" })}>
            {t("team.settings.delete")}
          </button>
        </div>
      </div>
    );
  }

  /** Leaving Settings with unsaved sharing or hours: save and go, go without them, or stay. */
  function renderLeaveSettingsDialog() {
    const edit = policyEdit();
    const next = pendingLeave;
    if (!edit || next === null) return null;
    const widened = [...new Set([...edit.change.widened, ...edit.groups.widened])];
    const narrowed = [...new Set([...edit.change.narrowed, ...edit.groups.narrowed])];
    const items = [
      ...(widened.length > 0 ? [t("team.policy.change.widened", { items: sharingItemsLabel(widened) })] : []),
      ...(narrowed.length > 0 ? [t("team.policy.change.narrowed", { items: sharingItemsLabel(narrowed) })] : []),
      ...(edit.hoursChanged ? [t("team.policy.change.hours")] : []),
    ];
    return (
      <TeamConfirmDialog
        title={t("team.settings.unsavedTitle")}
        items={items.length > 0 ? items : [t("team.settings.unsavedBody")]}
        confirmLabel={t("team.settings.unsavedSave")}
        busyLabel={t("team.settings.unsavedSaving")}
        busy={leaveSaving}
        error={null}
        tone="primary"
        secondary={{ label: t("team.settings.unsavedDiscard"), onClick: () => { edit.discard(); setPendingLeave(null); goToView(next); } }}
        onCancel={() => { if (!leaveSaving) setPendingLeave(null); }}
        onConfirm={() => {
          if (policySaveBlocked(edit)) return;
          setLeaveSaving(true);
          void edit.save().finally(() => {
            setLeaveSaving(false);
            setPendingLeave(null);
            goToView(next);
          });
        }}
      />
    );
  }

  /** The confirmation over settings for leaving, removing someone, or deleting the team. */
  function renderConfirmDialog() {
    if (!pendingConfirm || !selectedTeam) return null;
    const error = confirmFailed ? displayTeamActionError ?? t("team.confirm.error") : null;
    const common = { busy: confirmBusy, error, onCancel: () => { if (!confirmBusy) setPendingConfirm(null); }, onConfirm: (typed: string) => void runConfirmed(typed) };
    if (pendingConfirm.kind === "leave") {
      return (
        <TeamConfirmDialog
          {...common}
          title={t("team.confirm.leaveTitle", { team: selectedTeam.organization_name })}
          items={teamPolicy
            ? [t("team.confirm.leaveAccess"), t("team.confirm.sharedKept"), t("team.confirm.localKept"), t("team.confirm.rejoin")]
            : [t("team.settings.leaveHint"), t("team.confirm.localKept")]}
          confirmLabel={t("team.confirm.leave")}
          busyLabel={t("team.confirm.leaving")}
        />
      );
    }
    if (pendingConfirm.kind === "remove") {
      return (
        <TeamConfirmDialog
          {...common}
          title={t("team.confirm.removeTitle", { name: pendingConfirm.name })}
          items={teamPolicy
            ? [t("team.confirm.removeAccess"), t("team.confirm.sharedKept"), t("team.confirm.removeRejoin")]
            : [t("team.settings.removeHint")]}
          confirmLabel={t("team.confirm.remove")}
          busyLabel={t("team.confirm.removing")}
        />
      );
    }
    if (pendingConfirm.kind === "deleteFormer") {
      return (
        <TeamConfirmDialog
          {...common}
          title={t("team.confirm.deleteFormerTitle", { name: pendingConfirm.name })}
          items={[t("team.confirm.deleteFormerRecords"), t("team.confirm.deleteFormerTotals"), t("team.confirm.deleteFormerFinal")]}
          confirmLabel={t("team.confirm.deleteFormer")}
          busyLabel={t("team.confirm.deletingFormer")}
        />
      );
    }
    if (pendingConfirm.kind === "transfer") {
      // Whom to hand the team to: one of its organization admins.
      const admins = members.filter((member) => member.membership_role === "admin");
      return (
        <TeamConfirmDialog
          {...common}
          tone="primary"
          title={t("team.confirm.transferTitle", { team: selectedTeam.organization_name })}
          items={[t("team.confirm.transferOwner"), t("team.confirm.transferStay")]}
          choice={{
            label: t("team.confirm.transferTo"),
            options: admins.map((admin) => ({ value: admin.member_key, label: admin.display_name })),
            value: pendingConfirm.memberKey,
            onChange: (memberKey) => setPendingConfirm({ kind: "transfer", memberKey }),
          }}
          confirmLabel={t("team.general.transferAction")}
          busyLabel={t("team.confirm.transferring")}
        />
      );
    }
    if (pendingConfirm.kind === "deleteGroup") {
      const group = allGroups.find((candidate) => candidate.id === pendingConfirm.groupId);
      const people = group?.member_count ?? 0;
      // Its people can go to any other team; a division keeps its own teams' people in place.
      const destinations = allGroups.filter((candidate) => candidate.id !== pendingConfirm.groupId && candidate.parent_group_id !== pendingConfirm.groupId);
      return (
        <TeamConfirmDialog
          {...common}
          title={t("team.groups.deleteTitle", { team: group?.name ?? "" })}
          items={people > 0 ? [t("team.groups.deleteMove", { count: people }), t("team.groups.deleteKept")] : [t("team.groups.deleteKept")]}
          choice={people > 0 ? {
            label: t("team.groups.moveTo"),
            options: [...destinations.map((candidate) => ({ value: candidate.id, label: groupPathLabel(candidate.id) })), { value: NO_GROUP, label: t("team.groups.noTeam") }],
            value: pendingConfirm.moveTo,
            onChange: (moveTo) => setPendingConfirm({ ...pendingConfirm, moveTo }),
          } : undefined}
          confirmLabel={t("team.groups.delete")}
          busyLabel={t("team.confirm.deleting")}
        />
      );
    }
    // Deleting an organization with teams in it takes every team with it, and says so. A server
    // that stores sharing (and the preview) keeps a deleted team for 30 days for its owner to restore.
    const organization = allGroups.length > 0;
    const grace = Boolean(controller.handleRestoreTeam);
    return (
      <TeamConfirmDialog
        {...common}
        title={t(organization ? "team.general.deleteOrgTitle" : "team.confirm.deleteTitle")}
        items={grace
          ? [t("team.confirm.graceAccess"), t("team.confirm.graceRestore"), t(organization ? "team.confirm.gracePurgeOrg" : "team.confirm.gracePurge")]
          : [t(organization ? "team.general.deleteOrgHint" : "team.settings.deleteHint")]}
        typed={{ label: t(organization ? "team.general.deleteOrgConfirmLabel" : "team.settings.deleteConfirmLabel", { team: selectedTeam.organization_name }), target: selectedTeam.organization_name }}
        // With the grace period nothing is gone at once, so the button does not say "permanently".
        confirmLabel={grace ? t(organization ? "team.general.deleteOrg" : "team.settings.delete") : t("team.settings.deleteConfirm")}
        busyLabel={t("team.confirm.deleting")}
      />
    );
  }

  /** "Consumer / Growth" for a team inside a division, its own name otherwise. */
  function groupPathLabel(id: string): string {
    const group = allGroups.find((candidate) => candidate.id === id);
    const parent = group?.parent_group_id ? allGroups.find((candidate) => candidate.id === group.parent_group_id) : null;
    return parent ? parent.name + " / " + (group?.name ?? "") : group?.name ?? "";
  }

  /**
   * Settings › General: the name, a manager's own teams and reach, then the
   * danger zone (deleting for the owner, leaving for anyone else).
   */
  function renderGeneralTab() {
    if (!selectedTeam) return null;
    const organization = allGroups.length > 0;
    const renameTeam = controller.handleRenameTeam;
    const rename = isTeamAdminViewer && renameTeam
      ? (name: string) => renameTeam({ organization_id: selectedTeam.organization_id, name })
      : null;
    const details = !isTeamAdminViewer && viewerAssignment
      ? [
          { label: t("team.decide.managerTitle"), value: managerTeamsLabel(viewerAssignment, focusDataset.groups, t) ?? t("team.managers.wholeTeam") },
          { label: t("team.managers.access"), value: t(viewerAssignment.access === "detail" ? "team.managers.access.detail" : "team.managers.access.summary") },
        ]
      : [];
    const grace = Boolean(controller.handleRestoreTeam);
    // The owner hands the team to an organization admin (RescueTime keeps one owner over its admins).
    const admins = members.filter((member) => member.membership_role === "admin");
    const transfer = isOwner && controller.handleTransferOwnership
      ? [{
          key: "transfer",
          title: t("team.general.transfer"),
          hint: admins.length > 0 ? t("team.general.transferHint") : t("team.general.transferNoAdmin"),
          action: t("team.general.transferAction"),
          onClick: () => { if (admins[0]) askToConfirm({ kind: "transfer", memberKey: admins[0].member_key }); },
          disabled: teamActionLoading || admins.length === 0,
        }]
      : [];
    const danger = isOwner
      ? [...transfer, {
          key: "delete",
          title: t(organization ? "team.general.deleteOrg" : "team.settings.delete"),
          hint: grace
            ? t(organization ? "team.general.deleteOrgGraceHint" : "team.general.deleteGraceHint")
            : t(organization ? "team.general.deleteOrgHint" : "team.settings.deleteHint"),
          onClick: () => askToConfirm({ kind: "delete" }),
          disabled: teamActionLoading,
        }]
      : [{
          key: "leave",
          title: t(organization ? "team.general.leaveOrg" : "team.settings.leave"),
          hint: t("team.general.leaveHint"),
          onClick: () => askToConfirm({ kind: "leave" }),
          disabled: teamActionLoading,
        }];
    return (
      <TeamGeneralSettings
        nameLabel={t(organization ? "team.general.orgName" : "team.general.teamName")}
        name={selectedTeam.organization_name}
        onRename={rename}
        details={details}
        danger={danger}
      />
    );
  }

  function sharingItemsLabel(items: readonly TeamSharingItem[]): string {
    return items.map((item) => (item === "memberSummary" ? t("team.policy.memberSummary") : t(SHARE_FIELD_KEYS[item].title))).join(", ");
  }

  /** The admin's unsaved sharing and hours edits, shared by both tabs and the save bar. */
  function policyEdit() {
    if (!selectedTeam || !teamPolicy) return null;
    const currentWindow = selectedTeam.sharing_window ?? DEFAULT_TEAM_RECORDING_SCHEDULE;
    const currentTracking = selectedTeam.tracking_policy ?? "free";
    const draft = policyDraft ?? draftFromPolicy(teamPolicy);
    const hours = windowDraft ?? currentWindow;
    const tracking = trackingDraft ?? currentTracking;
    const complete = completeTeamSharingPolicy(draft);
    const change = complete ? compareTeamSharingPolicies(teamPolicy, complete) : { widened: [], narrowed: [] };
    const policyChanged = change.widened.length + change.narrowed.length > 0;
    const hoursChanged = tracking !== currentTracking
      || hours.start_minute !== currentWindow.start_minute
      || hours.end_minute !== currentWindow.end_minute
      || hours.days.join(",") !== currentWindow.days.join(",")
      || hours.timezone !== currentWindow.timezone;
    const groups = groupSharingEdits(complete ?? teamPolicy);
    const discard = () => {
      setPolicyDraft(null);
      setWindowDraft(null);
      setTrackingDraft(null);
      setGroupDrafts({});
    };
    const save = async () => {
      if (!complete || !isValidSharingWindow(hours) || !groups.complete) return;
      if (policyChanged) await controller.handleSetSharingPolicy?.({ organization_id: selectedTeam.organization_id, policy: complete });
      if (hoursChanged) await controller.handleSetSharingWindow?.({ organization_id: selectedTeam.organization_id, window: hours, tracking_policy: tracking });
      for (const change of groups.changes) {
        await controller.handleSetGroupSharingPolicy?.({ organization_id: selectedTeam.organization_id, group_id: change.groupId, policy: change.policy, ...(isTeamAdminViewer ? {} : { by: "manager" as const }) });
      }
      discard();
    };
    return { currentWindow, currentTracking, draft, hours, tracking, complete, change, policyChanged, hoursChanged, groups, discard, save };
  }

  /** One team's sharing as the editor holds it: following the default (or its division), or on its own policy. */
  function groupEditFor(id: string, defaultPolicy: TeamSharingPolicy) {
    const own = groupPolicies?.[id] ?? null;
    const parent = allGroups.find((group) => group.id === id)?.parent_group_id ?? null;
    const inherited = sharingPolicyForGroup(defaultPolicy, groupPolicies, allGroups, parent);
    const pending = groupDrafts[id];
    const follow = pending ? pending.follow : own === null;
    const draft = pending ? pending.draft : draftFromPolicy(own ?? inherited);
    return { own, inherited, follow, draft };
  }

  /** Every team edited in this sitting, against what it shares now; the default's own edit is passed in. */
  function groupSharingEdits(nextDefault: TeamSharingPolicy) {
    const changes: { readonly groupId: string; readonly policy: TeamSharingPolicy | null; readonly before: TeamSharingPolicy; readonly after: TeamSharingPolicy }[] = [];
    let complete = true;
    for (const [id, pending] of Object.entries(groupDrafts)) {
      if (!teamPolicy) break;
      const edit = groupEditFor(id, teamPolicy);
      const before = edit.own ?? edit.inherited;
      if (pending.follow) {
        if (edit.own === null) continue;
        changes.push({ groupId: id, policy: null, before, after: groupEditFor(id, nextDefault).inherited });
        continue;
      }
      const done = completeTeamSharingPolicy(pending.draft);
      if (!done) {
        complete = false;
        continue;
      }
      const delta = compareTeamSharingPolicies(before, done);
      if (edit.own === null || delta.widened.length + delta.narrowed.length > 0) changes.push({ groupId: id, policy: done, before, after: done });
    }
    const widened = new Set<TeamSharingItem>();
    const narrowed = new Set<TeamSharingItem>();
    for (const change of changes) {
      const delta = compareTeamSharingPolicies(change.before, change.after);
      delta.widened.forEach((item) => widened.add(item));
      delta.narrowed.forEach((item) => narrowed.add(item));
    }
    return { changes, complete, widened: [...widened], narrowed: [...narrowed] };
  }

  /** Leaf teams under the given groups, for a manager whose teams may share differently. */
  function leafTeamsWithin(ids: readonly string[]): readonly string[] {
    const leaves = leafSharingTeams(allGroups).map((entry) => entry.group.id);
    const under = (leaf: string, root: string): boolean => {
      let current: string | null = leaf;
      while (current !== null) {
        if (current === root) return true;
        current = allGroups.find((group) => group.id === current)?.parent_group_id ?? null;
      }
      return false;
    };
    return leaves.filter((leaf) => ids.some((id) => under(leaf, id)));
  }

  /** Decision candidates B to E: a manager edits their own teams' sharing under a ceiling; under E only once allowed to. */
  function managerEditing(): boolean {
    return !isTeamAdminViewer && managerEditRule !== "admins" && Boolean(teamPolicy) && viewerAssignment !== null
      && (managerEditRule !== "grant" || viewerAssignment.sharing === "narrow")
      && leafTeamsWithin(viewerAssignment.group_ids).length > 0;
  }

  /** B: what the organization admin set for the team; C: the organization's ceiling; D: the admin's choice on locked items, anything on the rest. */
  function managerCeiling(id: string): TeamSharingPolicy {
    if (managerEditRule === "ceiling" || !teamPolicy) return PREVIEW_MANAGER_CEILING;
    const admin = managerAdminPolicy(id);
    if (managerEditRule !== "delegate") return admin;
    // Items left to managers open up to times of day, the most detail every item has.
    const open = (field: TeamShareField) => delegatedFields.includes(field);
    return {
      projects: open("projects") ? "hourly" : admin.projects,
      tasks: open("tasks") ? "hourly" : admin.tasks,
      focus: open("focus") ? "hourly" : admin.focus,
      memberSummary: true,
    };
  }

  /** What the organization admin set for one of the manager's teams. */
  function managerAdminPolicy(id: string): TeamSharingPolicy {
    return sharingPolicyForGroup(teamPolicy!, selectedTeam?.group_sharing_admin_policies ?? groupPolicies, allGroups, id);
  }

  function renderManagerSharingEditor(managedTeams: readonly string[]) {
    if (!teamPolicy) return null;
    const target = managedTeams.includes(sharingTarget) ? sharingTarget : managedTeams[0]!;
    const edit = groupEditFor(target, teamPolicy);
    const ceiling = managerCeiling(target);
    const delegate = managerEditRule === "delegate";
    const lockedFields = delegate ? TEAM_SHARE_FIELDS.filter((field) => !delegatedFields.includes(field)) : [];
    const admin = delegate ? managerAdminPolicy(target) : ceiling;
    const within = policyWithinCeiling(edit.draft, ceiling) ? edit.draft : draftFromPolicy(admin);
    // Locked items stay at the admin's choice whatever the team had before.
    const draft = lockedFields.reduce<TeamSharingPolicyDraft>((current, field) => ({ ...current, [field]: admin[field] }), within);
    const nameOf = (id: string) => allGroups.find((group) => group.id === id)?.name ?? "";
    const hint = managerEditRule === "narrow" || managerEditRule === "grant"
      ? t("team.decide.managerNarrowHint")
      : delegate
        ? lockedFields.length > 0 ? t("team.decide.managerDelegateHint", { items: lockedFields.map((field) => t(SHARE_FIELD_KEYS[field].title)).join(", ") }) : t("team.decide.managerDelegateAll")
        : t("team.decide.managerCeilingHint", { ceiling: sharingPolicyLabel(ceiling, t) });
    return (
      <>
        <div className="team-sharing-target">
          <div className="team-sharing-target__row">
            <span className="team-sharing-target__label">{t("team.decide.managerTitle")}</span>
            {managedTeams.length > 1 ? (
              <SettingsSelect ariaLabel={t("team.decide.managerTitle")} className="projects-status-filter team-sharing-target__select" value={target} options={managedTeams.map((id) => ({ value: id, label: nameOf(id) }))} onChange={setSharingTarget} />
            ) : (
              <strong className="team-sharing-target__name">{nameOf(target)}</strong>
            )}
          </div>
          <p className="team-sharing-target__hint">{hint}</p>
        </div>
        <TeamSharingPolicyEditor
          key={target}
          draft={draft}
          onChange={(draft) => setGroupDrafts((current) => ({ ...current, [target]: { follow: false, draft } }))}
          ceiling={ceiling}
          lockedFields={lockedFields}
          disabled={teamActionLoading}
          idPrefix={"team-manager-policy-" + target}
        />
      </>
    );
  }

  function renderPolicySharingTab() {
    const edit = policyEdit();
    if (!edit || !teamPolicy) return null;
    if (!isTeamAdminViewer) {
      // A member reads their own team's sharing; a manager of several teams reads each team's.
      const managedTeams = viewerAssignment ? leafTeamsWithin(viewerAssignment.group_ids) : [];
      if (managerEditing()) return renderManagerSharingEditor(managedTeams);
      const ownPolicy = viewerTeamPolicy ?? teamPolicy;
      return (
        <div className="team-set-section">
          <span className="label-mono">{t("team.policy.summary.heading")}</span>
          {managedTeams.length > 1 ? (
            <ul className="team-sharing-managed" aria-label={t("team.sharingTargets.managedAria")}>
              {managedTeams.map((id) => (
                <li key={id}>
                  <span>{allGroups.find((group) => group.id === id)?.name}</span>
                  <span>{sharingPolicyLabel(policyForGroup(id) ?? teamPolicy, t)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <TeamPolicySummary policy={managedTeams.length === 1 ? policyForGroup(managedTeams[0]!) ?? ownPolicy : ownPolicy} window={edit.currentWindow} tracking={edit.currentTracking} showZone={hoursZoneChoice} />
          )}
          {viewerReachLabel ? <p className="team-modal__hint">{viewerReachLabel}</p> : null}
          <p className="team-modal__hint">{t("team.policy.readonlyHint")}</p>
        </div>
      );
    }
    const teams = leafSharingTeams(allGroups);
    // Candidate D: the organization admin locks each item or leaves it to team managers, on the default.
    const delegation = qaMock && managerEditRule === "delegate"
      ? { fields: delegatedFields, onChange: (fields: readonly TeamShareField[]) => { setDelegatedFields(fields); writeTeamManagerDelegation(fields); } }
      : null;
    if (teams.length === 0) return <TeamSharingPolicyEditor draft={edit.draft} onChange={setPolicyDraft} disabled={teamActionLoading} idPrefix="team-settings-policy" delegation={delegation} />;
    // Many teams: the default and each team in the same editor, picked from a menu (A) or a table (B).
    const layout = qaMock ? TEAM_SHARING_SETTINGS_LAYOUT.read() : "picker";
    const nextDefault = edit.complete ?? teamPolicy;
    const editedTeams = edit.groups.changes.map((change) => change.groupId);
    if (layout === "table" && !sharingRowOpen) {
      const memberCounts: Record<string, number> = {};
      for (const member of fullDataset.members) if (member.group_id) memberCounts[member.group_id] = (memberCounts[member.group_id] ?? 0) + 1;
      return (
        <TeamSharingTeamsTable
          groups={allGroups}
          defaultPolicy={nextDefault}
          groupPolicies={groupPolicies}
          memberCounts={memberCounts}
          editedTeams={editedTeams}
          onOpen={(target) => {
            setSharingTarget(target);
            setSharingRowOpen(true);
          }}
        />
      );
    }
    const groupEdit = sharingTarget !== DEFAULT_SHARING_TARGET ? groupEditFor(sharingTarget, nextDefault) : null;
    const setGroup = (patch: { readonly follow?: boolean; readonly draft?: TeamSharingPolicyDraft }) => {
      if (!groupEdit) return;
      setGroupDrafts((current) => ({
        ...current,
        [sharingTarget]: { follow: patch.follow ?? groupEdit.follow, draft: patch.draft ?? current[sharingTarget]?.draft ?? groupEdit.draft },
      }));
    };
    return (
      <>
        <TeamSharingTargetBar
          groups={allGroups}
          groupPolicies={groupPolicies}
          target={sharingTarget}
          onTarget={setSharingTarget}
          follow={groupEdit?.follow ?? false}
          onFollow={(follow) => setGroup({ follow })}
          disabled={teamActionLoading}
          editedTeams={editedTeams}
          onBack={layout === "table" ? () => setSharingRowOpen(false) : undefined}
        />
        {groupEdit ? (
          <TeamSharingPolicyEditor
            key={sharingTarget}
            draft={groupEdit.follow ? draftFromPolicy(groupEdit.inherited) : groupEdit.draft}
            onChange={(draft) => setGroup({ follow: false, draft })}
            disabled={groupEdit.follow || teamActionLoading}
            idPrefix={"team-settings-policy-" + sharingTarget}
          />
        ) : (
          <TeamSharingPolicyEditor draft={edit.draft} onChange={setPolicyDraft} disabled={teamActionLoading} idPrefix="team-settings-policy" delegation={delegation} />
        )}
      </>
    );
  }

  function renderPolicyHoursTab() {
    const edit = policyEdit();
    if (!edit) return null;
    return <TeamSharingWindowEditor window={edit.hours} onWindowChange={setWindowDraft} tracking={edit.tracking} onTrackingChange={setTrackingDraft} disabled={teamActionLoading} idPrefix="team-settings-hours" zoneChoice={hoursZoneChoice} />;
  }

  function policySaveBlocked(edit: NonNullable<ReturnType<typeof policyEdit>>): boolean {
    return !edit.complete || !edit.groups.complete || !isValidSharingWindow(edit.hours) || teamActionLoading;
  }

  /** Pinned under the tabs' scrolling body, so it stays in place on whichever tab the edit began. */
  function renderPolicySaveBar() {
    const edit = policyEdit();
    if (!edit || !(isTeamAdminViewer || managerEditing()) || !(edit.policyChanged || edit.hoursChanged || edit.groups.changes.length > 0)) return null;
    const widened = [...new Set([...edit.change.widened, ...edit.groups.widened])];
    const narrowed = [...new Set([...edit.change.narrowed, ...edit.groups.narrowed])];
    const teamNames = edit.groups.changes.map((change) => allGroups.find((group) => group.id === change.groupId)?.name ?? "").filter(Boolean);
    return (
      <div className="team-policy-save" role="status">
        <div className="team-policy-save__copy">
          {teamNames.length > 0 ? <p className="team-policy-save__teams">{t("team.sharingTargets.saveTeams", { teams: teamNames.join(", ") })}</p> : null}
          {widened.length > 0 ? <p>{t("team.policy.change.widened", { items: sharingItemsLabel(widened) })}</p> : null}
          {narrowed.length > 0 ? <p>{t("team.policy.change.narrowed", { items: sharingItemsLabel(narrowed) })}</p> : null}
          {edit.hoursChanged ? <p>{t("team.policy.change.hours")}</p> : null}
        </div>
        <div className="team-policy-save__actions">
          <button type="button" className="modal-btn modal-btn--ghost" onClick={edit.discard}>{t("team.policy.discard")}</button>
          <button type="button" className="modal-btn modal-btn--primary" disabled={policySaveBlocked(edit)} onClick={() => void edit.save()}>
            {t("team.policy.save")}
            <KeyHint shortcut="modEnter" />
          </button>
        </div>
      </div>
    );
  }

  /** Settings › Teams: the organization's divisions and teams, made, renamed, moved and deleted here. */
  function renderTeamsTab() {
    if (!selectedTeam) return null;
    const organizationId = selectedTeam.organization_id;
    // Where a deleted team's people go by default: a team beside it, else any other team, else none.
    const defaultDestination = (groupId: string) => {
      const group = allGroups.find((candidate) => candidate.id === groupId);
      const others = allGroups.filter((candidate) => candidate.id !== groupId && candidate.parent_group_id !== groupId);
      return (others.find((candidate) => group && candidate.parent_group_id === group.parent_group_id && candidate.parent_group_id !== null) ?? others[0])?.id ?? NO_GROUP;
    };
    return (
      <TeamGroupsSettings
        groups={allGroups}
        managers={controller.managers ?? []}
        busy={teamActionLoading}
        suspended={pendingConfirm !== null}
        onCreate={controller.handleCreateGroup
          ? async (input) => (await controller.handleCreateGroup!({ organization_id: organizationId, ...input }))?.id ?? null
          : undefined}
        onRename={controller.handleRenameGroup ? (groupId, name) => controller.handleRenameGroup!({ group_id: groupId, name }) : undefined}
        onMove={controller.handleMoveGroup ? (groupId, parent) => controller.handleMoveGroup!({ group_id: groupId, parent_group_id: parent }) : undefined}
        onDelete={(groupId) => askToConfirm({ kind: "deleteGroup", groupId, moveTo: defaultDestination(groupId) })}
      />
    );
  }

  /** Once, after the team starts sharing more of a person's records (see TeamSharingNotice). */
  function renderSharingNotice() {
    if (!selectedTeam || !teamPolicy || isTeamAdminViewer || !isPopulated) return null;
    return (
      <TeamSharingNotice
        key={selectedTeam.organization_id}
        organizationId={selectedTeam.organization_id}
        policy={viewerTeamPolicy ?? teamPolicy}
        itemsLabel={sharingItemsLabel}
        onOpenSettings={() => handleViewTabChange("settings")}
      />
    );
  }

  /**
   * A team its owner deleted leaves every list at once and waits 30 days; its owner sees it here,
   * above whatever the page shows, with Restore.
   */
  function renderScheduledDeletions() {
    const scheduled = controller.scheduledDeletions ?? [];
    const restore = controller.handleRestoreTeam;
    if (scheduled.length === 0 || !restore) return null;
    return (
      <section className="team-scheduled" aria-label={t("team.scheduled.aria")}>
        <div className="team-form-rows">
          {scheduled.map((team) => (
            <div key={team.organization_id} className="team-form-row">
              <div className="team-form-row__copy">
                <strong>{t("team.scheduled.title", { team: team.organization_name })}</strong>
                <span>{t("team.scheduled.body", { date: formatLocalizedDayLabel(team.purge_after.slice(0, 10), effectiveLanguage) })}</span>
              </div>
              <div className="team-form-row__control">
                <button type="button" className="modal-btn modal-btn--secondary" disabled={teamActionLoading} onClick={() => void restore(team.organization_id)}>
                  {t("team.scheduled.restore")}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  /**
   * One list of people and their roles, with the invite button beside its
   * search; the owner's team-wide switches follow it. Members see the team and
   * how to leave.
   */
  function renderPolicyMembersTab() {
    if (!selectedTeam) return null;
    // Organization admins (the owner and its admins) manage people; leaving is in General.
    if (!isTeamAdminViewer) return renderTeamInfoSection();
    const inviteAction = canInvite ? (
      <button
        type="button"
        className="modal-btn modal-btn--secondary team-set-invite"
        onClick={() => setInviteOpen(true)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 19.5v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.1a3.6 3.6 0 0 0-3.6 3.6v1.4" /><circle cx="8.8" cy="7.6" r="3.3" /><path d="M18.5 8v6M15.5 11h6" /></svg>
        {t("team.settings.invite")}
      </button>
    ) : null;
    return (
      <>
        <TeamRoster
          members={members}
          people={focusDataset.members}
          groups={focusDataset.groups}
          managers={controller.managers ?? []}
          onManagersChange={(managers) => void controller.handleSetManagers?.({ organization_id: selectedTeam.organization_id, managers })}
          canRemove={isTeamAdminViewer}
          onRemove={(memberKey) => askToConfirm({ kind: "remove", memberKey, name: members.find((member) => member.member_key === memberKey)?.display_name ?? "" })}
          formerMembers={controller.formerMembers}
          onDeleteFormer={isTeamAdminViewer && controller.handleDeleteFormerRecords
            ? (memberKey) => askToConfirm({ kind: "deleteFormer", memberKey, name: controller.formerMembers?.find((person) => person.member_key === memberKey)?.display_name ?? "" })
            : undefined}
          busy={teamActionLoading}
          loading={members.length === 0}
          inviteAction={inviteAction}
          sharingGrant={qaMock && managerEditRule === "grant"}
          suspended={pendingConfirm !== null}
          footer={renderInvitePermissionSection()}
          viewerIsOwner={isOwner}
          onRoleChange={controller.handleSetMemberRole
            ? (memberKey, role) => void controller.handleSetMemberRole!({ organization_id: selectedTeam.organization_id, member_key: memberKey, role })
            : undefined}
          invites={canInvite ? invites : undefined}
          onCopyInvite={(invite) => {
            void onCopyInvite(invite.invite_url ? toShareableTeamInviteUrl(invite.invite_url) : invite.invite_code);
            inviteCopy.showCopied(invite.invite_id);
          }}
          copiedInviteId={inviteCopy.copiedKey}
          onRevokeInvite={canInvite ? (invite) => void handleRevokeInvite({ invite_id: invite.invite_id }) : undefined}
          formatDay={(iso) => formatLocalizedDayLabel(iso.slice(0, 10), effectiveLanguage)}
          onCreateTeam={controller.handleCreateGroup
            ? async (input) => (await controller.handleCreateGroup!({ organization_id: selectedTeam.organization_id, ...input }))?.id ?? null
            : undefined}
        />
      </>
    );
  }

  /**
   * Settings › Export (owner decision 2026-10-22): a start day, an end day and
   * one CSV of a row per day, person and project, cut as this seat's Dashboard
   * is: people's rows where people are shared, each team's totals otherwise,
   * focus where the team shares it. The preview's records are on hand; a live
   * team's are read from the server, already cut to the seat.
   */
  function renderExportTab() {
    if (!selectedTeam || !overviewModel || !boardAccess) return null;
    const access = boardAccess;
    const model = overviewModel;
    const scopeName = boardPath(selectedTeam.organization_name).slice(-1)[0]?.name ?? selectedTeam.organization_name;
    const today = clock.today;
    // The preview holds ten weeks of records; the server keeps far more and reads up to a year at a time.
    const earliest = qaMock
      ? focusDataset.projectDays.reduce((first, row) => (row.activity_date < first ? row.activity_date : first), today)
      : shiftIsoDate(today, -730);
    const organizationId = selectedTeam.organization_id;
    const projectList = projects.projects;
    const names = {
      projectName: (projectId: string | null) => (projectId === null ? t("team.focus.unassigned") : projectList.find((project) => project.id === projectId)?.name ?? t("team.focus.unassigned")),
      focusLabel: t("team.export.focusRow"),
    };
    const people = teamBoardWidgetLock("peopleProjectTable", access) === null;
    const cut = {
      people,
      personFocus: people && model.memberFocusVisible,
      teamFocus: model.teamFocusVisible,
      teams: access.acrossTeams
        ? model.groupCards.map((card) => ({ id: card.group.id as string | null, name: card.group.name }))
        : [{ id: null, name: scopeName }],
    };
    const readRows = async (range: TeamExportWindow) => {
      if (qaMock) return teamExportRowsFromDataset(focusDataset, { ...names, window: range, groupId: effectiveGroupId, scopeName, cut });
      const read = await fetchTeamTotals({ organization_id: organizationId, start_date: range.start_date, end_date: range.end_date });
      return read.success ? teamExportRowsFromTotals(read.data, { ...names, scopeName }) : null;
    };
    return <TeamExportPanel key={organizationId + "/" + (effectiveGroupId ?? "")} scopeName={scopeName} today={today} earliest={earliest} readRows={readRows} />;
  }

  /** What the Settings tab holds: its own tabs for admins, a short page for a member, or the single-scope list. */
  function settingsParts() {
    // Per-item sharing splits settings into tabs; a single-scope server keeps the one scrolling list.
    // Admins and managers get tabs, General first as in Rize's team settings. A member has one short page:
    // what the team shares, then leaving.
    const managerTabs = Boolean(teamPolicy) && !isTeamAdminViewer && viewerRole === "lead";
    // As Rize keeps Data Export in Settings: a period and the tables, downloaded at once.
    const exportTab = boardAccess ? [{ id: "export" as const, label: t("team.settings.tab.export") }] : [];
    const tabs: readonly { readonly id: TeamSettingsTab; readonly label: string }[] = teamPolicy && isTeamAdminViewer
      ? [
          { id: "general", label: t("team.settings.tab.general") },
          { id: "sharing", label: t("team.settings.tab.sharing") },
          { id: "hours", label: t("team.settings.tab.hours") },
          // An organization of teams keeps its teams beside its people, as Rize and RescueTime do.
          ...(allGroups.length > 0 ? [{ id: "teams" as const, label: t("team.settings.tab.teams") }] : []),
          { id: "members", label: t("team.settings.tab.members") },
          ...exportTab,
        ]
      : managerTabs
        ? [
            { id: "general", label: t("team.settings.tab.general") },
            { id: "sharing", label: t("team.settings.tab.sharing") },
            ...exportTab,
          ]
        : [];
    const memberPolicyView = Boolean(teamPolicy) && !isTeamAdminViewer && !managerTabs;
    const tab: TeamSettingsTab | null = tabs.length === 0 ? null : tabs.some((candidate) => candidate.id === settingsTab) ? settingsTab : tabs[0]!.id;
    const tabBar = tab ? (
      // Drawn as the Dashboard's boards are (decided 2026-10-25).
      <TeamSubnavStrip className="team-subnav team-settings__tabs" role="tablist" ariaLabel={t("team.settings.tabsAria")}>
        {tabs.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            className={"team-subnav__tab" + (tab === candidate.id ? " on" : "")}
            onClick={() => setSettingsTab(candidate.id)}
          >
            <span data-text={candidate.label}>{candidate.label}</span>
          </button>
        ))}
      </TeamSubnavStrip>
    ) : null;
    const body = (
      <div className="team-modal__body team-settings">
        {memberPolicyView ? (
          <>
            {renderPolicySharingTab()}
            {renderLeaveSection()}
          </>
        ) : null}
        {tab === null && !memberPolicyView ? (
          <>
            {renderTeamInfoSection()}
            {renderRosterSection()}
            {renderInvitesSection()}
            {renderInvitePermissionSection()}
            {renderLegacyScopeSection()}
            {renderLegacyTrackingSection()}
            {renderPublishSection()}
            {renderLeaveSection()}
            {renderDeleteSection()}
          </>
        ) : null}
        {tab === "general" ? renderGeneralTab() : null}
        {tab === "sharing" ? renderPolicySharingTab() : null}
        {tab === "hours" ? renderPolicyHoursTab() : null}
        {tab === "teams" ? renderTeamsTab() : null}
        {tab === "members" ? renderPolicyMembersTab() : null}
        {tab === "export" ? renderExportTab() : null}
      </div>
    );
    return { tabs, tab, tabBar, body, saveBar: tab || managerEditing() ? renderPolicySaveBar() : null };
  }

  /** The Settings tab of the team page. At most one dialog opens over it: a person, or a confirmation. */
  function renderSettingsPage() {
    const { tabBar, body, saveBar } = settingsParts();
    return (
      <section ref={settingsModalRef} className="team-modal team-settings-page" aria-label={t("team.settings.title")}>
        {tabBar}
        {body}
        {saveBar}
      </section>
    );
  }

  function renderJoinConsent() {
    const invite = qaMock
      ? teamPolicy && selectedTeam && inviteKey.trim() ? { organizationName: selectedTeam.organization_name, policy: teamPolicy, schedule: selectedTeam.sharing_window ?? DEFAULT_TEAM_RECORDING_SCHEDULE, trackingPolicy: selectedTeam.tracking_policy ?? "free" } : null
      : invitePreview.preview;
    if (!invite) return null;
    return (
      <div className="team-join-consent">
        <span className="team-set-permission__title">{t("team.join.consentTitle", { team: invite.organizationName })}</span>
        <TeamPolicySummary policy={invite.policy} window={invite.schedule} tracking={invite.trackingPolicy} showZone detailed />
      </div>
    );
  }

  function renderAddModal() {
    // With per-item sharing both tabs share one fixed frame, so switching never resizes the dialog.
    const policyLayout = addTab === "join" || Boolean(controller.handleCreateTeamWithPolicy);
    const wizard = addTab === "create" && policyLayout;
    const joinConsent = addTab === "join" ? renderJoinConsent() : null;
    const joinField = (
      <div className="team-modal__field">
        <span className="label-mono">{t("team.add.inviteKey")}</span>
        <input
          className="settings-input"
          placeholder={t("team.add.invitePlaceholder")}
          value={inviteKey}
          disabled={joinSubmitting || teamActionLoading}
          maxLength={500}
          aria-label={t("team.add.inviteAria")}
          onChange={(event) => setInviteKey(event.target.value)}
        />
        <p className="team-modal__hint">{t("team.join.noPastRecords")}</p>
      </div>
    );
    // A failure takes the footer note's place beside the button that retries it, so the dialog does not grow and shift.
    const joinActions = (
      <div className="modal-foot team-modal__actions">
        {displayTeamActionError ? <p className="modal-foot__note modal-foot__note--error" role="alert">{displayTeamActionError}</p> : null}
        <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setAddOpen(false)}>{t("common.cancel")}<KeyHint shortcut="escape" /></button>
        <button type="button" className="modal-btn modal-btn--primary" disabled={teamActionLoading || joinSubmitting || !inviteKey.trim() || (!qaMock && !invitePreview.preview)} aria-busy={teamActionLoading || joinSubmitting || undefined} onClick={() => void submitJoin()}>
          <ActionLabel busy={teamActionLoading || joinSubmitting}>{t("team.join.accept")}</ActionLabel>
        </button>
      </div>
    );
    return (
      <div className="auth-modal__overlay" {...addOverlayDismiss}>
        <section
          ref={addModalRef}
          className="auth-modal modal-shell profile-modal team-modal team-editor-modal"
          data-modal-variant="standard"
          data-team-layout={policyLayout ? "policy" : undefined}
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-add-title"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label={t("team.add.close")} onClick={() => setAddOpen(false)} />
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2 id="team-add-title">{t("team.add.title")}</h2>
            </div>
          </div>
          <div className="team-modal__body team-add__body">
            <div className="team-seg" role="tablist" aria-label={t("team.add.modeAria")}>
              <button
                type="button"
                role="tab"
                className={addTab === "create" ? "on" : ""}
                aria-selected={addTab === "create"}
                onClick={() => setAddTab("create")}
              >
                <span>{t("team.add.createTab")}</span>
              </button>
              <button
                type="button"
                role="tab"
                className={addTab === "join" ? "on" : ""}
                aria-selected={addTab === "join"}
                onClick={() => setAddTab("join")}
              >
                <span>{t("team.add.joinTab")}</span>
              </button>
            </div>
            {wizard ? (
              <TeamCreateWizard
                key={wizardKey}
                name={teamName}
                onNameChange={setTeamName}
                busy={teamActionLoading}
                error={displayTeamActionError}
                invite={activeInvite ? { url: activeInvite.invite_url ? toShareableTeamInviteUrl(activeInvite.invite_url) : "", code: activeInvite.invite_code } : null}
                copiedKey={copiedKey}
                previewNote={qaMock}
                onCopy={copyValue}
                onCancel={() => setAddOpen(false)}
                escapeHint={<KeyHint shortcut="escape" />}
                zoneChoice={hoursZoneChoice}
                onCreate={(input) => controller.handleCreateTeamWithPolicy?.(input) ?? Promise.resolve(false)}
                onDone={() => {
                  setAddOpen(false);
                  setTeamName("");
                }}
              />
            ) : addTab === "create" ? (
              <>
                <div className="team-modal__field">
                  <span className="label-mono">{t("team.add.name")}</span>
                  <input
                    className="settings-input"
                    placeholder={t("team.add.namePlaceholder")}
                    value={teamName}
                    maxLength={120}
                    aria-label={t("team.add.name")}
                    onChange={(event) => setTeamName(event.target.value)}
                  />
                  <p className="team-modal__hint">{t("team.add.adminHint")}</p>
                </div>
                <div className="modal-foot team-modal__actions">
                  {/* A failure takes the footer note's place beside the button
                      that retries it, so the dialog does not grow and shift. */}
                  {displayTeamActionError ? <p className="modal-foot__note modal-foot__note--error" role="alert" title={displayTeamActionError}>{displayTeamActionError}</p> : null}
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setAddOpen(false)}>{t("common.cancel")}<KeyHint shortcut="escape" /></button>
                  <button type="button" className="modal-btn modal-btn--primary" disabled={teamActionLoading || !teamName.trim()} aria-busy={teamActionLoading || undefined} onClick={submitCreateTeam}>
                    <ActionLabel busy={teamActionLoading}>{t("team.add.create")}</ActionLabel>
                    <KeyHint shortcut="enter" />
                  </button>
                </div>
              </>
            ) : policyLayout ? (
              <div className="team-join">
                <div className="team-join__grid">
                  {joinField}
                  {joinConsent ?? <div className="team-join__waiting" role="status">
                    <p>{invitePreview.loading ? t("team.join.loading") : invitePreview.error ? t("team.join.loadFailed") : t("team.join.waiting")}</p>
                    {invitePreview.error ? <button className="modal-btn modal-btn--secondary" type="button" onClick={invitePreview.refresh}>{t("team.join.retry")}</button> : null}
                  </div>}
                </div>
                {joinActions}
              </div>
            ) : (
              <>
                {joinField}
                {joinConsent}
                {joinActions}
              </>
            )}
          </div>
        </section>
      </div>
    );
  }
}

export default TeamWorkspace;
