import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { AnchoredPresence } from "../../components/AnchoredPresence";
import { PageTabs, pageTabId } from "../../components/PageTabs";

import type { AuthState } from "../auth/AuthContext";
import { useCopyFeedback } from "../../lib/useCopyFeedback";
import TeamDashboardsView from "./TeamDashboardsView";
import TeamProjectsView, { type TeamProjectDraft } from "./TeamProjectsView";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import { isTeamQaMockEnabled, useTeamQaMockProjects } from "./teamQaMock";
import type { AcceptTeamInviteInput } from "./teamService";
import { canInviteToTeam, isTeamOwner, type TeamPeriod } from "./teamTypes";
import { useTeamProjects, type TeamProjectsSubView } from "./useTeamProjects";
import type { UseTeamControllerResult } from "./useTeamController";
import { ModalPresence } from "../../components/ModalPresence";
import { Toggle } from "../../components/Toggle";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import { DateNavigator } from "../../components/DateNavigator";
import { formatLocalizedDateRangeLabel } from "../../lib/formatting";
import { useLocalization, type LocalizationController } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import { localizedPublishNote } from "./teamPublishNote";
import "./team.css";

export type TeamWorkspaceProps = {
  readonly isSupabaseEnabled: boolean;
  readonly hasRequiredAccountAuth: boolean;
  readonly isSignedIn: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly controller: UseTeamControllerResult;
  readonly subView: TeamProjectsSubView;
  readonly onSubViewChange: (subView: TeamProjectsSubView) => void;
  readonly pendingInvite?: PendingTeamInvite | null;
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
  isSupabaseEnabled,
  hasRequiredAccountAuth,
  isSignedIn,
  startOfDayMinutes,
  user,
  controller,
  subView,
  onSubViewChange,
  pendingInvite = null,
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
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherTriggerRef = useRef<HTMLButtonElement>(null);
  const switcherMenuRef = useRef<HTMLDivElement>(null);
  const [inviteKey, setInviteKey] = useState("");
  const { copiedKey, showCopied } = useCopyFeedback<"link" | "code">();
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
    handleSetMemberInvites,
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
  const qaProjects = useTeamQaMockProjects({
    organizationId: selectedTeam?.organization_id ?? null,
    period,
    windowOffset,
    startOfDayMinutes,
  });
  const projects = qaMock ? qaProjects : realProjects;
  const displayTeamError = localizedTeamError(teamError, effectiveLanguage, t);
  const displayTeamActionError = localizedTeamError(teamActionError, effectiveLanguage, t);
  const displayProjectError = localizedTeamError(projects.error, effectiveLanguage, t);
  const displayProjectActionError = localizedTeamError(projects.actionError, effectiveLanguage, t);
  const displayPublishNote = localizedPublishNote(projects.publishNote, effectiveLanguage, t);

  const activeInvite = useMemo(() => invites.find((invite) => invite.status === "pending") ?? null, [invites]);
  const hasTeam = teams.length > 0 && Boolean(selectedTeam);
  const isOwner = isTeamOwner(selectedTeam);
  const canInvite = canInviteToTeam(selectedTeam);

  // The switcher closes on an outside press or Escape, and opens on the current team.
  useEffect(() => {
    if (!switcherOpen) return;
    switcherMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')?.focus();
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
  useEffect(() => {
    if (!isPopulated) setSwitcherOpen(false);
  }, [isPopulated]);
  const windowLabel = formatLocalizedDateRangeLabel(projects.window.start_date, projects.window.end_date, effectiveLanguage);
  const atLatestWindow = windowOffset === 0;
  const viewTabs = [
    { id: "dashboards" as const, label: t("team.tab.overview") },
    { id: "projects" as const, label: t("team.tab.projects") },
  ];

  const closeSwitcher = (restoreFocus: boolean) => {
    setSwitcherOpen(false);
    if (restoreFocus) switcherTriggerRef.current?.focus();
  };

  const chooseTeam = (organizationId: string) => {
    if (organizationId !== selectedTeam?.organization_id) selectTeam(organizationId);
    closeSwitcher(true);
  };

  const handleSwitcherMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      closeSwitcher(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
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

  return (
    <>
      <div className="pg-head team-page-head">
        <div className="team-title">
          <h1>{t("team.page.teams")}</h1>
          {isPopulated && selectedTeam ? (
            <>
              <span className="team-title__separator" aria-hidden="true">/</span>
              <div className="team-switcher">
                <button
                  ref={switcherTriggerRef}
                  type="button"
                  className="team-switcher__trigger"
                  aria-haspopup="menu"
                  aria-expanded={switcherOpen}
                  aria-label={t("team.switcher.aria", { team: selectedTeam.organization_name })}
                  onClick={() => setSwitcherOpen((open) => !open)}
                >
                  <span className="team-switcher__name" title={selectedTeam.organization_name}>{selectedTeam.organization_name}</span>
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
            </>
          ) : null}
        </div>
        {isPopulated ? (
          <div className="team-header-actions">
            {canInvite ? (
              <button type="button" className="app-btn app-btn--secondary" onClick={() => setInviteOpen(true)}>
                {t("team.nav.inviteTeammate")}
              </button>
            ) : null}
            <button
              type="button"
              className="app-btn app-btn--secondary team-header-actions__icon"
              aria-label={t("team.nav.settings")}
              title={t("team.nav.settings")}
              onClick={() => setSettingsOpen(true)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>
            </button>
          </div>
        ) : null}
      </div>

      {/* Both views read the same window (chart + the table's Team time column),
          so the range sits on the tab rule like Insights. */}
      {isPopulated ? (
        <div className="page-toolbar team-toolbar">
          <PageTabs
            tabs={viewTabs}
            activeTab={subView}
            onChange={onSubViewChange}
            ariaLabel={t("team.tabs.aria")}
            idPrefix="team-view"
            panelId="team-workspace-panel"
          />
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
        </div>
      ) : null}

      <div className="team-page-layout">
        <section
          id="team-workspace-panel"
          className="team-panel"
          role={isPopulated ? "tabpanel" : undefined}
          aria-labelledby={isPopulated ? pageTabId("team-view", subView) : undefined}
          aria-label={isPopulated ? undefined : t("team.panel.sharedProjects")}
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
                {/* The server role, not the invite label, decides the badge: a label is display text. */}
                <span className={isOwner ? "team-set-role--admin" : "team-set-role"}>
                  {localizedTeamRole(selectedTeam?.membership_role ?? "member", t)}
                </span>
              </div>
            </div>

            {canInvite ? (
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
            ) : null}

            {/* Owner-only. Hidden while the server cannot report the setting yet. */}
            {isOwner && selectedTeam && selectedTeam.members_can_invite !== null ? (
              <div className="team-set-section">
                <span className="label-mono">{t("team.settings.invitePermission")}</span>
                <div className="team-set-permission">
                  <div className="team-set-permission__copy">
                    <span id="team-member-invites-label" className="team-set-permission__title">{t("team.settings.membersCanInvite")}</span>
                    <p id="team-member-invites-hint" className="team-modal__hint">
                      {selectedTeam.members_can_invite ? t("team.settings.membersCanInviteOn") : t("team.settings.membersCanInviteOff")}
                    </p>
                  </div>
                  <Toggle
                    checked={selectedTeam.members_can_invite}
                    disabled={teamActionLoading}
                    ariaLabel={t("team.settings.membersCanInvite")}
                    ariaDescribedBy="team-member-invites-hint"
                    onChange={(enabled) => void handleSetMemberInvites({ organization_id: selectedTeam.organization_id, enabled })}
                  />
                </div>
                {displayTeamActionError ? <p className="team-message team-message--error">{displayTeamActionError}</p> : null}
              </div>
            ) : null}

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
