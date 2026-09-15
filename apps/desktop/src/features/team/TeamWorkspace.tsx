import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { AuthState } from "../auth/AuthContext";
import TeamDashboardsView from "./TeamDashboardsView";
import TeamProjectsView, { type TeamProjectDraft } from "./TeamProjectsView";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import { isTeamQaMockEnabled, useTeamQaMockProjects } from "./teamQaMock";
import type { AcceptTeamInviteInput } from "./teamService";
import type { TeamPeriod } from "./teamTypes";
import { useTeamProjects, type TeamProjectsSubView } from "./useTeamProjects";
import type { UseTeamControllerResult } from "./useTeamController";
import { ModalPresence } from "../../components/ModalPresence";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { DateNavigator } from "../../components/DateNavigator";
import { formatLocalizedDateRangeLabel } from "../../lib/formatting";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import "./team.css";

export type TeamWorkspaceAction = "invite" | "settings" | "add";

export type TeamWorkspaceProps = {
  readonly navigationRefreshEnabled: boolean;
  readonly isSupabaseEnabled: boolean;
  readonly hasRequiredAccountAuth: boolean;
  readonly isSignedIn: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly controller: UseTeamControllerResult;
  readonly subView: TeamProjectsSubView;
  readonly onSubViewChange: (subView: TeamProjectsSubView) => void;
  readonly pendingInvite?: PendingTeamInvite | null;
  readonly pendingAction?: TeamWorkspaceAction | null;
  readonly onPendingActionConsumed?: () => void;
  readonly onSignIn: () => void;
  readonly onCopyInvite: (text: string) => void | Promise<unknown>;
  readonly onAcceptPendingInvite: (input: AcceptTeamInviteInput) => Promise<void>;
  readonly onPendingInviteClear?: () => void;
};

function localizedTeamRole(label: string, t: LocalizationController["t"]): string {
  switch (label.trim().toLowerCase()) {
    case "owner": return t("team.role.owner");
    case "member": return t("team.role.member");
    case "admin": return t("team.role.admin");
    default: return label;
  }
}

function localizedTeamError(message: string | null, language: DisplayLanguage, t: LocalizationController["t"]): string | null {
  if (!message || language === "en") return message;
  return t("team.error.withDetail", { detail: message });
}

function localizedPublishNote(message: string | null, language: DisplayLanguage, t: LocalizationController["t"]): string | null {
  if (!message || language === "en") return message;
  if (message.startsWith("No classified team-project time yet")) return t("team.notice.noClassifiedTime");
  if (message === "Stopped sharing your project time.") return t("team.notice.stopped");
  if (message.startsWith("Stopped sharing —")) return t("team.notice.stoppedAndRemoved");
  const sharedMatch = /^Shared (.+) across (\d+) projects? for this window\.$/u.exec(message);
  if (sharedMatch) {
    return t("team.notice.shared", {
      duration: localizedEnglishDuration(sharedMatch[1]!),
      count: sharedMatch[2]!,
    });
  }
  return t("team.notice.withDetail", { detail: message });
}

function localizedEnglishDuration(duration: string): string {
  return duration
    .replace(/(\d+)h\b/gu, "$1시간")
    .replace(/(\d+)m\b/gu, "$1분");
}

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

export function TeamWorkspace({
  navigationRefreshEnabled,
  isSupabaseEnabled,
  hasRequiredAccountAuth,
  isSignedIn,
  startOfDayMinutes,
  user,
  controller,
  subView,
  onSubViewChange,
  pendingInvite = null,
  pendingAction = null,
  onPendingActionConsumed,
  onSignIn,
  onCopyInvite,
  onAcceptPendingInvite,
  onPendingInviteClear,
}: TeamWorkspaceProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [period, setPeriod] = useState<TeamPeriod>("weekly");
  const [windowOffset, setWindowOffset] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<"create" | "join">("create");
  const [teamName, setTeamName] = useState("");
  const [inviteKey, setInviteKey] = useState("");
  const [copiedKey, setCopiedKey] = useState<"link" | "code" | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const addSubmittedRef = useRef(false);
  const inviteRequestedRef = useRef(false);

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
    selectTeam,
  } = controller;

  // QA mock (dev-server-only): swaps in local fixture data so the surface can be
  // exercised without an account. Both hooks always run to keep hook order stable.
  const qaMock = isTeamQaMockEnabled();
  const canUse = qaMock || (isSupabaseEnabled && Boolean(user) && hasRequiredAccountAuth);
  const realProjects = useTeamProjects({
    enabled: canUse && !qaMock,
    organizationId: selectedTeam?.organization_id ?? null,
    memberDisplayName: selectedTeam?.member_display_name ?? null,
    userEmail: user?.email ?? null,
    startOfDayMinutes,
    period,
    windowOffset,
  });
  const qaProjects = useTeamQaMockProjects({ period, windowOffset, startOfDayMinutes });
  const projects = qaMock ? qaProjects : realProjects;
  const displayTeamError = localizedTeamError(teamError, effectiveLanguage, t);
  const displayTeamActionError = localizedTeamError(teamActionError, effectiveLanguage, t);
  const displayProjectError = localizedTeamError(projects.error, effectiveLanguage, t);
  const displayProjectActionError = localizedTeamError(projects.actionError, effectiveLanguage, t);
  const displayPublishNote = localizedPublishNote(projects.publishNote, effectiveLanguage, t);

  const activeInvite = useMemo(() => invites.find((invite) => invite.status === "pending") ?? null, [invites]);
  const hasTeam = teams.length > 0 && Boolean(selectedTeam);

  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction === "add") {
      setAddTab("create");
      setAddOpen(true);
    } else if (pendingAction === "invite" && hasTeam) {
      setInviteOpen(true);
    } else if (pendingAction === "settings" && hasTeam) {
      setSettingsOpen(true);
    }
    onPendingActionConsumed?.();
  }, [hasTeam, onPendingActionConsumed, pendingAction]);

  // Opening the invite modal with no live invite mints one (once per open).
  useEffect(() => {
    if (!inviteOpen) {
      inviteRequestedRef.current = false;
      return;
    }
    if (activeInvite || inviteRequestedRef.current || teamActionLoading || !selectedTeam) return;
    inviteRequestedRef.current = true;
    void handleCreateInvite({ organization_id: selectedTeam.organization_id });
  }, [activeInvite, handleCreateInvite, inviteOpen, selectedTeam, teamActionLoading]);

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

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const copyValue = (key: "link" | "code", value: string) => {
    void onCopyInvite(value);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    setCopiedKey(key);
    copyTimerRef.current = window.setTimeout(() => setCopiedKey(null), 1500);
  };

  const submitCreateTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    addSubmittedRef.current = true;
    void handleCreateTeam({ organizationName: name });
  };

  const submitJoin = () => {
    const key = inviteKey.trim();
    if (!key) return;
    addSubmittedRef.current = true;
    const accept = pendingInvite ? onAcceptPendingInvite : handleAcceptInvite;
    void accept({ inviteKey: key });
  };

  const regenerateInvite = async () => {
    if (!selectedTeam) return;
    if (activeInvite) await handleRevokeInvite({ invite_id: activeInvite.invite_id });
    await handleCreateInvite({ organization_id: selectedTeam.organization_id });
  };

  const onCreateProject = (draft: TeamProjectDraft) => {
    void projects.createProject({ name: draft.name, description: draft.description, color: draft.color, anchors: draft.anchors });
  };

  const openAdd = (tab: "create" | "join") => {
    setAddTab(tab);
    setAddOpen(true);
  };

  const isPopulated = canUse && hasTeam && !pendingInvite;
  const pageTitle = navigationRefreshEnabled
    ? t("team.page.teams")
    : !isPopulated
      ? t("team.page.teams")
      : subView === "projects"
        ? t("team.page.projects")
        : t("team.page.dashboards");
  const windowLabel = formatLocalizedDateRangeLabel(projects.window.start_date, projects.window.end_date, effectiveLanguage);
  const atLatestWindow = windowOffset === 0;
  const moveTeamViewTab = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextSubView = event.key === "Home"
      ? "dashboards"
      : event.key === "End"
        ? "projects"
        : subView === "dashboards" ? "projects" : "dashboards";
    onSubViewChange(nextSubView);
    document.getElementById(`team-view-${nextSubView}`)?.focus();
  };

  return (
    <>
      <div className="pg-head team-page-head">
        <div className={navigationRefreshEnabled ? "team-page-title" : undefined}>
          <h1>{pageTitle}</h1>
          {navigationRefreshEnabled && isPopulated && selectedTeam ? (
            <label className="team-switcher">
              <span className="sr-only">{t("team.nav.yourTeams")}</span>
              <select
                aria-label={t("team.nav.yourTeams")}
                value={selectedTeam.organization_id}
                onChange={(event) => selectTeam(event.currentTarget.value)}
              >
                {teams.map((team) => (
                  <option key={team.organization_id} value={team.organization_id}>{team.organization_name}</option>
                ))}
              </select>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
            </label>
          ) : null}
        </div>
        {/* Both sub-views read the same window (chart + the table's Team time column). */}
        {isPopulated ? (
          <div className="classification-range-controls trends-range-controls">
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
              todayLabel={t("common.latest")}
              isTodayDisabled={atLatestWindow}
              isNextDisabled={atLatestWindow}
              onPrevious={() => setWindowOffset((offset) => offset + 1)}
              onNext={() => setWindowOffset((offset) => Math.max(0, offset - 1))}
              onToday={() => setWindowOffset(0)}
              previousLabel={t("team.range.previous")}
              nextLabel={t("team.range.next")}
            />
          </div>
        ) : null}
      </div>

      {navigationRefreshEnabled && isPopulated ? (
        <div className="team-workspace-nav">
          <div className="team-view-tabs" role="tablist" aria-label={t("team.page.teams")}>
            <button
              id="team-view-dashboards"
              type="button"
              role="tab"
              aria-selected={subView === "dashboards"}
              aria-controls="team-workspace-panel"
              tabIndex={subView === "dashboards" ? 0 : -1}
              className={subView === "dashboards" ? "is-active" : undefined}
              onClick={() => onSubViewChange("dashboards")}
              onKeyDown={moveTeamViewTab}
            >
              {t("team.nav.dashboards")}
            </button>
            <button
              id="team-view-projects"
              type="button"
              role="tab"
              aria-selected={subView === "projects"}
              aria-controls="team-workspace-panel"
              tabIndex={subView === "projects" ? 0 : -1}
              className={subView === "projects" ? "is-active" : undefined}
              onClick={() => onSubViewChange("projects")}
              onKeyDown={moveTeamViewTab}
            >
              {t("team.nav.projects")}
            </button>
          </div>
          <div className="team-workspace-actions">
            <button type="button" className="app-btn app-btn--quiet" onClick={() => setInviteOpen(true)}>{t("team.nav.inviteTeammate")}</button>
            <button type="button" className="app-btn app-btn--quiet" onClick={() => setSettingsOpen(true)}>{t("team.nav.settings")}</button>
            <button type="button" className="app-btn app-btn--quiet team-workspace-add" aria-label={t("team.nav.createOrJoin")} title={t("team.nav.createOrJoin")} onClick={() => openAdd("create")}>+</button>
          </div>
        </div>
      ) : null}

      <div className="team-page-layout">
        <section
          id="team-workspace-panel"
          className="team-panel"
          role={navigationRefreshEnabled && isPopulated ? "tabpanel" : undefined}
          aria-labelledby={navigationRefreshEnabled && isPopulated ? (subView === "projects" ? "team-view-projects" : "team-view-dashboards") : undefined}
          aria-label={navigationRefreshEnabled && isPopulated ? undefined : t("team.panel.sharedProjects")}
        >
          {renderBody()}
        </section>
      </div>

      <ModalPresence onDismiss={() => setInviteOpen(false)}>
        {inviteOpen && selectedTeam ? renderInviteModal() : null}
      </ModalPresence>
      <ModalPresence onDismiss={() => setSettingsOpen(false)}>
        {settingsOpen && selectedTeam ? renderSettingsModal() : null}
      </ModalPresence>
      <ModalPresence onDismiss={() => setAddOpen(false)}>
        {addOpen ? renderAddModal() : null}
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
              onClick={() => void onAcceptPendingInvite({ inviteKey: pendingInvite.inviteKey })}
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
        {subView === "dashboards" ? (
          <TeamDashboardsView
            window={projects.window}
            projects={projects.projects}
            mix={projects.mix}
            members={projects.members}
            memberCount={selectedTeam?.member_count ?? 0}
            memberDisplayName={selectedTeam?.member_display_name ?? null}
            loading={projects.loading}
            error={displayProjectError ?? displayTeamError}
            publishNote={displayPublishNote}
            onRefresh={() => void projects.refresh()}
          />
        ) : (
          <TeamProjectsView
            teamName={selectedTeam?.organization_name ?? t("team.page.teams")}
            projects={projects.projects}
            mix={projects.mix}
            members={projects.members}
            memberDisplayName={selectedTeam?.member_display_name ?? null}
            window={projects.window}
            loading={projects.loading}
            error={displayProjectError}
            actionError={displayProjectActionError}
            actionLoading={projects.actionLoading}
            onCreate={onCreateProject}
            onUpdate={(input) => void projects.updateProject(input)}
            onArchive={(projectId, archived) => void projects.archiveProject(projectId, archived)}
          />
        )}

        <p className="team-footnote">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 8.6 4.1-1 7-4.4 7-8.6V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
          {t("team.privacy.footnote")}
        </p>
      </>
    );
  }

  function renderInviteModal() {
    const inviteUrl = activeInvite?.invite_url || "";
    const inviteCode = activeInvite?.invite_code || "";
    return (
      <div className="auth-modal__overlay" onClick={() => setInviteOpen(false)}>
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
              <p>{t("team.invite.body")}</p>
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
                      {copiedKey === "link" ? t("team.invite.copied") : t("team.invite.copyLink")}
                    </button>
                  </div>
                </div>
                <div className="team-modal__field">
                  <span className="label-mono">{t("team.invite.code")}</span>
                  <div className="team-code">
                    <strong>{inviteCode}</strong>
                    <div className="team-code__actions">
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
                      <button type="button" className="modal-btn modal-btn--ghost" onClick={() => copyValue("code", inviteCode)}>
                        {copiedKey === "code" ? t("team.invite.copied") : t("team.invite.copy")}
                      </button>
                    </div>
                  </div>
                  <p className="team-modal__hint">{t("team.invite.refreshHint")}</p>
                </div>
              </>
            ) : (
              <p className="team-modal__hint">{teamActionLoading ? t("team.invite.creating") : t("team.invite.none")}</p>
            )}
            {displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
          </div>
        </section>
      </div>
    );
  }

  function renderSettingsModal() {
    return (
      <div className="auth-modal__overlay" onClick={() => setSettingsOpen(false)}>
        <section
          className="auth-modal modal-shell profile-modal team-modal team-settings-modal"
          data-modal-variant="workspace"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-settings-title"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label={t("team.settings.close")} onClick={() => setSettingsOpen(false)} />
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2 id="team-settings-title">{t("team.settings.title")}</h2>
              <p>{t("team.settings.subtitle", { team: selectedTeam?.organization_name ?? t("team.settings.defaultTeam") })}</p>
            </div>
          </div>
          <div className="team-modal__body team-settings">
            <div className="team-set-section">
              <span className="label-mono">{t("team.settings.team")}</span>
              <div className="team-set-member">
                <span className="team-set-member__name">{selectedTeam?.organization_name}</span>
                <span className="team-set-role">{t("team.settings.memberCount", { count: selectedTeam?.member_count ?? 0 })}</span>
                <span className="team-set-role--admin">{localizedTeamRole(selectedTeam?.role_label ?? "", t)}</span>
              </div>
            </div>

            <div className="team-set-section">
              <div className="team-set-memhead">
                <span className="label-mono">{t("team.settings.invites")}</span>
                <button
                  type="button"
                  className="modal-btn modal-btn--secondary team-set-invite"
                  onClick={() => {
                    setSettingsOpen(false);
                    setInviteOpen(true);
                  }}
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

            <div className="team-set-section">
              <span className="label-mono">{t("team.settings.yourSharing")}</span>
              <p className="team-modal__hint">
                {displayPublishNote ?? t("team.settings.sharingBody")}
              </p>
              <div className="team-set-share">
                <button
                  type="button"
                  className="modal-btn modal-btn--primary"
                  disabled={projects.publishing}
                  aria-label={t("team.settings.shareAria")}
                  onClick={() => void projects.publishMyTime()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
                  {projects.publishing ? t("team.settings.sharing") : t("team.settings.share")}
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
          </div>
        </section>
      </div>
    );
  }

  function renderAddModal() {
    return (
      <div className="auth-modal__overlay" onClick={() => setAddOpen(false)}>
        <section
          className="auth-modal modal-shell profile-modal team-modal team-editor-modal"
          data-modal-variant="standard"
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
          <div className="team-modal__body">
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
            {addTab === "create" ? (
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
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitCreateTeam();
                    }}
                  />
                  <p className="team-modal__hint">{t("team.add.adminHint")}</p>
                </div>
                {displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
                <div className="modal-foot team-modal__actions">
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setAddOpen(false)}>{t("common.cancel")}</button>
                  <button type="button" className="modal-btn modal-btn--primary" disabled={teamActionLoading || !teamName.trim()} onClick={submitCreateTeam}>
                    {t("team.add.create")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="team-modal__field">
                  <span className="label-mono">{t("team.add.inviteKey")}</span>
                  <input
                    className="settings-input"
                    placeholder={t("team.add.invitePlaceholder")}
                    value={inviteKey}
                    maxLength={500}
                    aria-label={t("team.add.inviteAria")}
                    onChange={(event) => setInviteKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitJoin();
                    }}
                  />
                  <p className="team-modal__hint">{t("team.invite.sharingStartsLater")}</p>
                </div>
                {displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
                <div className="modal-foot team-modal__actions">
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setAddOpen(false)}>{t("common.cancel")}</button>
                  <button type="button" className="modal-btn modal-btn--primary" disabled={teamActionLoading || !inviteKey.trim()} onClick={submitJoin}>
                    {t("team.invite.join")}
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }
}

export default TeamWorkspace;
