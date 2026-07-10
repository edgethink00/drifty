import { useMemo, useState } from "react";

import type { AuthState } from "../auth/AuthContext";
import TeamDashboardsView from "./TeamDashboardsView";
import TeamProjectsView, { type TeamProjectDraft } from "./TeamProjectsView";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import type { AcceptTeamInviteInput } from "./teamService";
import { useTeamProjects, type TeamProjectsSubView } from "./useTeamProjects";
import type { UseTeamControllerResult } from "./useTeamController";
import "./team-projects.css";

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
  const [teamName, setTeamName] = useState("");
  const [inviteKey, setInviteKey] = useState("");

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

  const canUse = isSupabaseEnabled && Boolean(user) && hasRequiredAccountAuth;
  const projects = useTeamProjects({
    enabled: canUse,
    organizationId: selectedTeam?.organization_id ?? null,
    memberDisplayName: selectedTeam?.member_display_name ?? null,
    userEmail: user?.email ?? null,
    startOfDayMinutes,
  });

  const activeInvite = useMemo(() => invites.find((invite) => invite.status === "pending") ?? null, [invites]);

  const submitCreateTeam = () => {
    const name = teamName.trim();
    if (!name) return;
    void handleCreateTeam({ organizationName: name });
    setTeamName("");
  };
  const submitJoin = () => {
    const key = inviteKey.trim();
    if (!key) return;
    const accept = pendingInvite ? onAcceptPendingInvite : handleAcceptInvite;
    void accept({ inviteKey: key });
    setInviteKey("");
  };

  const onCreateProject = (draft: TeamProjectDraft) => {
    void projects.createProject({ name: draft.name, description: draft.description, color: draft.color, anchors: draft.anchors });
  };

  const body = renderBody();

  return (
    <div className="tpj-root">
      <h2 className="tpj-title">Teams</h2>
      {body}
    </div>
  );

  function renderBody() {
    if (!isSupabaseEnabled) {
      return <div className="tpj-empty">Team features need cloud sync configured.</div>;
    }
    if (!isSignedIn || !hasRequiredAccountAuth) {
      return (
        <div className="tpj-gate">
          <p>Sign in with a full drifty.so account to use Teams.</p>
          <button type="button" className="tpj-btn tpj-btn--primary" onClick={onSignIn}>Sign in</button>
        </div>
      );
    }

    if (pendingInvite) {
      return (
        <section className="tpj-gate" role="region" aria-label="Pending team invite">
          <p>You have a pending invite{pendingInvite.inviteCode ? <> (<code className="tpj-code">{pendingInvite.inviteCode}</code>)</> : null}.</p>
          <div className="tpj-row">
            <button type="button" className="tpj-btn tpj-btn--primary" disabled={teamActionLoading} onClick={() => void onAcceptPendingInvite({ inviteKey: pendingInvite.inviteKey })}>Join team</button>
            <button type="button" className="tpj-btn" onClick={() => onPendingInviteClear?.()}>Dismiss</button>
          </div>
          {teamActionError ? <p className="tpj-warn">{teamActionError}</p> : null}
        </section>
      );
    }

    if (teamLoading && teams.length === 0) {
      return <div className="tpj-empty">Loading teams…</div>;
    }

    if (teams.length === 0) {
      return (
        <div className="tpj-onboard">
          <form className="tpj-panel" aria-label="Create team" onSubmit={(event) => { event.preventDefault(); submitCreateTeam(); }}>
            <h3>Create a team</h3>
            <p className="tpj-muted">Start a shared workspace. Anyone you invite can add shared projects.</p>
            <div className="tpj-row">
              <input className="tpj-input" aria-label="Team name" placeholder="Team name" value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} />
              <button type="submit" className="tpj-btn tpj-btn--primary" disabled={teamActionLoading || !teamName.trim()}>Create</button>
            </div>
          </form>
          <form className="tpj-panel" aria-label="Join team" onSubmit={(event) => { event.preventDefault(); submitJoin(); }}>
            <h3>Join a team</h3>
            <p className="tpj-muted">Paste an invite code or link a teammate shared with you.</p>
            <div className="tpj-row">
              <input className="tpj-input" aria-label="Team invite code or link" placeholder="DRFT-XXXX-XXXX" value={inviteKey} maxLength={500} onChange={(event) => setInviteKey(event.target.value)} />
              <button type="submit" className="tpj-btn" disabled={teamActionLoading || !inviteKey.trim()}>Join</button>
            </div>
          </form>
          {teamActionError ? <p className="tpj-warn">{teamActionError}</p> : null}
          {teamError ? <p className="tpj-warn">{teamError}</p> : null}
        </div>
      );
    }

    return renderWorkspace();
  }

  function renderWorkspace() {
    return (
    <div className="tpj-workspace">
      <div className="tpj-workspace__bar">
        <label className="tpj-selector">
          <span className="tpj-selector__label">Team</span>
          <select
            className="tpj-select"
            value={selectedTeam?.organization_id ?? ""}
            onChange={(event) => selectTeam(event.target.value)}
          >
            {teams.map((team) => (
              <option key={team.organization_id} value={team.organization_id}>{team.organization_name}</option>
            ))}
          </select>
        </label>
        <div className="tpj-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={subView === "dashboards"} className={subView === "dashboards" ? "tpj-tab tpj-tab--active" : "tpj-tab"} onClick={() => onSubViewChange("dashboards")}>Dashboards</button>
          <button type="button" role="tab" aria-selected={subView === "projects"} className={subView === "projects" ? "tpj-tab tpj-tab--active" : "tpj-tab"} onClick={() => onSubViewChange("projects")}>Projects</button>
        </div>
        <div className="tpj-workspace__invite">
          {activeInvite ? (
            <>
              <code className="tpj-code">{activeInvite.invite_code}</code>
              <button type="button" className="tpj-btn tpj-btn--sm" onClick={() => void onCopyInvite(activeInvite.invite_url || activeInvite.invite_code)}>Copy</button>
              <button type="button" className="tpj-btn tpj-btn--sm" onClick={() => void handleRevokeInvite({ invite_id: activeInvite.invite_id })}>Revoke</button>
            </>
          ) : (
            <button type="button" className="tpj-btn tpj-btn--sm" disabled={teamActionLoading || !selectedTeam} onClick={() => selectedTeam && void handleCreateInvite({ organization_id: selectedTeam.organization_id })}>Invite teammate</button>
          )}
        </div>
      </div>

      {subView === "dashboards" ? (
        <TeamDashboardsView
          teamName={selectedTeam?.organization_name ?? "Team"}
          window={projects.window}
          projects={projects.projects}
          mix={projects.mix}
          members={projects.members}
          loading={projects.loading}
          error={projects.error}
          actionError={projects.actionError}
          publishing={projects.publishing}
          publishNote={projects.publishNote}
          onPublishMyTime={() => void projects.publishMyTime()}
          onStopSharing={() => void projects.stopSharing()}
          onRefresh={() => void projects.refresh()}
        />
      ) : (
        <TeamProjectsView
          teamName={selectedTeam?.organization_name ?? "Team"}
          projects={projects.projects}
          loading={projects.loading}
          error={projects.error}
          actionError={projects.actionError}
          actionLoading={projects.actionLoading}
          onCreate={onCreateProject}
          onUpdate={(input) => void projects.updateProject(input)}
          onArchive={(projectId, archived) => void projects.archiveProject(projectId, archived)}
        />
      )}
    </div>
  );
  }
}

export default TeamWorkspace;
