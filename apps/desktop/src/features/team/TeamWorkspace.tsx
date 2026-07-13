import { useEffect, useMemo, useRef, useState } from "react";

import type { AuthState } from "../auth/AuthContext";
import TeamDashboardsView from "./TeamDashboardsView";
import TeamProjectsView, { type TeamProjectDraft } from "./TeamProjectsView";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import { isTeamQaMockEnabled, useTeamQaMockProjects } from "./teamQaMock";
import type { AcceptTeamInviteInput } from "./teamService";
import type { TeamPeriod } from "./teamTypes";
import { useTeamProjects, type TeamProjectsSubView } from "./useTeamProjects";
import type { UseTeamControllerResult } from "./useTeamController";
import { ModalCloseButton } from "../../components/ModalCloseButton";
import "./team.css";

/** Sidebar-initiated actions that open a workspace modal (see App's team nav menu). */
export type TeamWorkspaceAction = "invite" | "settings" | "add";

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
  readonly pendingAction?: TeamWorkspaceAction | null;
  readonly onPendingActionConsumed?: () => void;
  readonly onSignIn: () => void;
  readonly onCopyInvite: (text: string) => void | Promise<unknown>;
  readonly onAcceptPendingInvite: (input: AcceptTeamInviteInput) => Promise<void>;
  readonly onPendingInviteClear?: () => void;
};

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function shortDate(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return iso;
  return `${MONTH_LABELS[(month! - 1 + 12) % 12]} ${day}`;
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
  pendingInvite = null,
  pendingAction = null,
  onPendingActionConsumed,
  onSignIn,
  onCopyInvite,
  onAcceptPendingInvite,
  onPendingInviteClear,
}: TeamWorkspaceProps) {
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

  const activeInvite = useMemo(() => invites.find((invite) => invite.status === "pending") ?? null, [invites]);
  const hasTeam = teams.length > 0 && Boolean(selectedTeam);

  // Sidebar menu actions land here as a one-shot prop.
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
  const pageTitle = !isPopulated ? "Teams" : subView === "projects" ? "Projects" : "Dashboards";
  const windowLabel = `${shortDate(projects.window.start_date)} – ${shortDate(projects.window.end_date)}`;
  const atLatestWindow = windowOffset === 0;

  return (
    <>
      <div className="pg-head team-page-head">
        <div>
          <h1>{pageTitle}</h1>
        </div>
        {/* Both sub-views read the same window (chart + the table's Team time column). */}
        {isPopulated ? (
          <div className="classification-range-controls trends-range-controls">
            <div className="settings-mode-switch settings-mode-switch--triple" role="radiogroup" aria-label="Range granularity">
              {([
                { key: "daily", label: "Day" },
                { key: "weekly", label: "Week" },
                { key: "monthly", label: "Month" },
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
            <div className="day-nav" aria-label="Dashboard time window">
              <div className="day-nav__current"><strong>{windowLabel}</strong></div>
              <button
                className="ghost-button day-nav__step"
                type="button"
                aria-label="Previous window"
                onClick={() => setWindowOffset((offset) => offset + 1)}
              >
                &lsaquo;
              </button>
              <button
                className="ghost-button day-nav__today"
                type="button"
                disabled={atLatestWindow}
                onClick={() => setWindowOffset(0)}
              >
                Latest
              </button>
              <button
                className="ghost-button day-nav__step"
                type="button"
                aria-label="Next window"
                disabled={atLatestWindow}
                onClick={() => setWindowOffset((offset) => Math.max(0, offset - 1))}
              >
                &rsaquo;
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="team-page-layout">
        <section className="team-panel" aria-label="Team shared projects">
          {renderBody()}
        </section>
      </div>

      {inviteOpen && selectedTeam ? renderInviteModal() : null}
      {settingsOpen && selectedTeam ? renderSettingsModal() : null}
      {addOpen ? renderAddModal() : null}
    </>
  );

  function renderBody() {
    if (!isSupabaseEnabled && !qaMock) {
      return (
        <div className="empty-state team-state">
          <strong>Cloud sync required</strong>
          <p>Team features need cloud sync configured.</p>
        </div>
      );
    }
    if ((!isSignedIn || !hasRequiredAccountAuth) && !qaMock) {
      return (
        <div className="empty-state team-state">
          <span className="label-mono">Account required</span>
          <strong>Sign in required</strong>
          <p>Use a drifty.so account before creating teams or joining with invites.</p>
          <div className="team-onboard__actions">
            <button type="button" className="settings-btn settings-btn--primary" onClick={onSignIn}>Open sign-in</button>
          </div>
        </div>
      );
    }

    if (pendingInvite) {
      return (
        <section className="team-pending-invite" role="region" aria-label="Pending team invite">
          <div>
            <strong>
              You have a pending team invite
              {pendingInvite.inviteCode ? <> (<code className="team-code-inline">{pendingInvite.inviteCode}</code>)</> : null}
            </strong>
            <p>Joining shares nothing until your first Share my time.</p>
          </div>
          <div className="team-onboard__actions">
            <button
              type="button"
              className="settings-btn settings-btn--primary"
              disabled={teamActionLoading}
              onClick={() => void onAcceptPendingInvite({ inviteKey: pendingInvite.inviteKey })}
            >
              Join team
            </button>
            <button type="button" className="ghost-button" onClick={() => onPendingInviteClear?.()}>Dismiss</button>
          </div>
          {teamActionError ? <p className="team-message team-message--error">{teamActionError}</p> : null}
        </section>
      );
    }

    if (teamLoading && teams.length === 0) {
      return <div className="team-empty">Loading teams…</div>;
    }

    if (!hasTeam) {
      return (
        <>
          <div className="team-onboard" aria-label="Start a team">
            <span className="team-onboard__icon" aria-hidden="true"><TeamBadgeIcon /></span>
            <strong>See where your team's time goes</strong>
            <p>Create a team or join one with an invite code. Define shared projects together — only aggregate time per project is ever shared.</p>
            <div className="team-onboard__actions">
              <button type="button" className="settings-btn settings-btn--primary" onClick={() => openAdd("create")}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                Create a team
              </button>
              <button type="button" className="ghost-button" onClick={() => openAdd("join")}>Join with code</button>
            </div>
          </div>
          {teamError ? <p className="team-message team-message--error">{teamError}</p> : null}
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
            error={projects.error ?? teamError}
            publishNote={projects.publishNote}
            onRefresh={() => void projects.refresh()}
          />
        ) : (
          <TeamProjectsView
            teamName={selectedTeam?.organization_name ?? "Team"}
            projects={projects.projects}
            mix={projects.mix}
            members={projects.members}
            memberDisplayName={selectedTeam?.member_display_name ?? null}
            window={projects.window}
            loading={projects.loading}
            error={projects.error}
            actionError={projects.actionError}
            actionLoading={projects.actionLoading}
            onCreate={onCreateProject}
            onUpdate={(input) => void projects.updateProject(input)}
            onArchive={(projectId, archived) => void projects.archiveProject(projectId, archived)}
          />
        )}

        <p className="team-footnote">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 8.6 4.1-1 7-4.4 7-8.6V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
          Your Mac classifies your own activity locally. Only per-project totals are shared — apps, sites, and windows stay on your device.
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
          className="auth-modal profile-modal team-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-invite-title"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label="Close invite dialog" onClick={() => setInviteOpen(false)} />
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2 id="team-invite-title">Invite to {selectedTeam?.organization_name ?? "your team"}</h2>
              <p>Share one link or code — data stays aggregate-only.</p>
            </div>
          </div>
          <div className="team-modal__body">
            {activeInvite ? (
              <>
                <div className="team-modal__field">
                  <span className="label-mono">Invite link</span>
                  <div className="team-copy-row">
                    <input
                      className="settings-input"
                      readOnly
                      value={inviteUrl || inviteCode}
                      aria-label="Invite link"
                      onFocus={(event) => event.target.select()}
                    />
                    <button type="button" className="modal-btn modal-btn--primary" onClick={() => copyValue("link", inviteUrl || inviteCode)}>
                      {copiedKey === "link" ? "Copied ✓" : "Copy link"}
                    </button>
                  </div>
                </div>
                <div className="team-modal__field">
                  <span className="label-mono">Invite code</span>
                  <div className="team-code">
                    <strong>{inviteCode}</strong>
                    <div className="team-code__actions">
                      <button
                        type="button"
                        className="team-iconbtn"
                        aria-label="Generate a new code"
                        title="Generate a new code"
                        disabled={teamActionLoading}
                        onClick={() => void regenerateInvite()}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.2 12a7.8 7.8 0 0 1 13.2-5.6L20 8.6" /><path d="M19.8 12a7.8 7.8 0 0 1-13.2 5.6L4 15.4" /><path d="M20 4v4.6h-4.6M4 20v-4.6h4.6" /></svg>
                      </button>
                      <button type="button" className="modal-btn modal-btn--ghost" onClick={() => copyValue("code", inviteCode)}>
                        {copiedKey === "code" ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <p className="team-modal__hint">Refreshing the code disables the previous one.</p>
                </div>
              </>
            ) : (
              <p className="team-modal__hint">{teamActionLoading ? "Creating an invite…" : "No live invite yet."}</p>
            )}
            {teamActionError ? <p className="team-message team-message--error">{teamActionError}</p> : null}
          </div>
        </section>
      </div>
    );
  }

  function renderSettingsModal() {
    return (
      <div className="auth-modal__overlay" onClick={() => setSettingsOpen(false)}>
        <section
          className="auth-modal profile-modal team-modal team-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-settings-title"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label="Close" onClick={() => setSettingsOpen(false)} />
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2 id="team-settings-title">Team settings</h2>
              <p>{selectedTeam?.organization_name ?? "Your team"} — membership and sharing.</p>
            </div>
          </div>
          <div className="team-modal__body team-settings">
            <div className="team-set-section">
              <span className="label-mono">Team</span>
              <div className="team-set-member">
                <span className="team-set-member__name">{selectedTeam?.organization_name}</span>
                <span className="team-set-role">{selectedTeam?.member_count ?? 0} members</span>
                <span className="team-set-role--admin">{selectedTeam?.role_label}</span>
              </div>
            </div>

            <div className="team-set-section">
              <div className="team-set-memhead">
                <span className="label-mono">Invites</span>
                <button
                  type="button"
                  className="modal-btn modal-btn--secondary team-set-invite"
                  onClick={() => {
                    setSettingsOpen(false);
                    setInviteOpen(true);
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 19.5v-1.4a3.6 3.6 0 0 0-3.6-3.6H6.1a3.6 3.6 0 0 0-3.6 3.6v1.4" /><circle cx="8.8" cy="7.6" r="3.3" /><path d="M18.5 8v6M15.5 11h6" /></svg>
                  Invite
                </button>
              </div>
              {activeInvite ? (
                <p className="team-modal__hint">One live invite code: {activeInvite.invite_code}</p>
              ) : (
                <p className="team-modal__hint">No live invite right now.</p>
              )}
            </div>

            <div className="team-set-section">
              <span className="label-mono">Your sharing</span>
              <p className="team-modal__hint">
                {projects.publishNote ?? "Share publishes only your per-project totals for the current window. Apps, sites, and windows never leave your Mac."}
              </p>
              <div className="team-set-share">
                <button
                  type="button"
                  className="modal-btn modal-btn--primary"
                  disabled={projects.publishing}
                  aria-label="Share my project time with the team"
                  onClick={() => void projects.publishMyTime()}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4" /><path d="m7 9 5-5 5 5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
                  {projects.publishing ? "Sharing…" : "Share my time"}
                </button>
                <button
                  type="button"
                  className="modal-btn modal-btn--ghost"
                  aria-label="Stop sharing my project time"
                  onClick={() => void projects.stopSharing()}
                >
                  Stop sharing
                </button>
              </div>
              {projects.actionError ? <p className="team-message team-message--error">{projects.actionError}</p> : null}
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
          className="auth-modal profile-modal team-modal team-editor-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-add-title"
          onClick={(event) => event.stopPropagation()}
        >
          <ModalCloseButton label="Close" onClick={() => setAddOpen(false)} />
          <div className="modal-head">
            <div className="modal-head__copy">
              <h2 id="team-add-title">Add a team</h2>
            </div>
          </div>
          <div className="team-modal__body">
            <div className="team-seg" role="tablist" aria-label="Add team mode" style={{ justifySelf: "start" }}>
              <button
                type="button"
                role="tab"
                className={addTab === "create" ? "on" : ""}
                aria-selected={addTab === "create"}
                onClick={() => setAddTab("create")}
              >
                <span>Create</span>
              </button>
              <button
                type="button"
                role="tab"
                className={addTab === "join" ? "on" : ""}
                aria-selected={addTab === "join"}
                onClick={() => setAddTab("join")}
              >
                <span>Join</span>
              </button>
            </div>
            {addTab === "create" ? (
              <>
                <div className="team-modal__field">
                  <span className="label-mono">Team name</span>
                  <input
                    className="settings-input"
                    placeholder="Deep Work Crew"
                    value={teamName}
                    maxLength={120}
                    aria-label="Team name"
                    onChange={(event) => setTeamName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitCreateTeam();
                    }}
                  />
                  <p className="team-modal__hint">You'll manage this team as its admin.</p>
                </div>
                {teamActionError ? <p className="team-message team-message--error">{teamActionError}</p> : null}
                <div className="modal-foot team-modal__actions">
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setAddOpen(false)}>Cancel</button>
                  <button type="button" className="modal-btn modal-btn--primary" disabled={teamActionLoading || !teamName.trim()} onClick={submitCreateTeam}>
                    Create team
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="team-modal__field">
                  <span className="label-mono">Invite code or link</span>
                  <input
                    className="settings-input"
                    placeholder="DRFT-ABCD-2345 or paste an invite link"
                    value={inviteKey}
                    maxLength={500}
                    aria-label="Team invite code or link"
                    onChange={(event) => setInviteKey(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") submitJoin();
                    }}
                  />
                  <p className="team-modal__hint">Joining shares nothing until your first Share my time.</p>
                </div>
                {teamActionError ? <p className="team-message team-message--error">{teamActionError}</p> : null}
                <div className="modal-foot team-modal__actions">
                  <button type="button" className="modal-btn modal-btn--ghost" onClick={() => setAddOpen(false)}>Cancel</button>
                  <button type="button" className="modal-btn modal-btn--primary" disabled={teamActionLoading || !inviteKey.trim()} onClick={submitJoin}>
                    Join team
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
