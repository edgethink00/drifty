import type { AuthState } from "../auth/AuthContext";
import { copyTextToClipboard } from "../profile/ProfileModals";
import { TeamWorkspace } from "./TeamWorkspace";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import type { TeamPreviewFixture } from "./teamPreviewScenarios";
import type { AcceptTeamInviteInput } from "./teamService";
import type { TeamFocusClassification } from "./teamFocusPublish";
import type { UseTeamControllerResult } from "./useTeamController";
import type { TeamProjectsSubView } from "./useTeamProjects";

export type TeamsBetaSurfaceProps = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isPolicySignedIn: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  /** Owned by App so route gating and team invite deep links share one controller. */
  readonly controller: UseTeamControllerResult;
  /** A Dev-mode preview scenario's fixture; null for live data. */
  readonly previewFixture?: TeamPreviewFixture | null;
  readonly teamSubView: TeamProjectsSubView;
  readonly onTeamSubViewChange: (subView: TeamProjectsSubView) => void;
  readonly pendingInvite?: PendingTeamInvite | null;
  readonly onAuthRequired: () => void;
  readonly onPendingInviteClear?: () => void;
  /** How the member's own charts classify activity; focus sent to a team uses it. */
  readonly focusClassification?: TeamFocusClassification | null;
};

export function TeamsBetaSurface({
  hasRequiredAccountAuth,
  isPolicySignedIn,
  isSupabaseConfigured,
  startOfDayMinutes,
  user,
  controller,
  previewFixture = null,
  teamSubView,
  onTeamSubViewChange,
  pendingInvite = null,
  onAuthRequired,
  onPendingInviteClear,
  focusClassification = null,
}: TeamsBetaSurfaceProps) {
  const handleAcceptPendingInvite = async (input: AcceptTeamInviteInput) => {
    await controller.handleAcceptInvite(input);
    onPendingInviteClear?.();
  };

  return (
    <div className="page content content--team">
      <TeamWorkspace
        isSupabaseEnabled={isSupabaseConfigured}
        hasRequiredAccountAuth={hasRequiredAccountAuth}
        isSignedIn={isPolicySignedIn}
        startOfDayMinutes={startOfDayMinutes}
        user={user}
        controller={controller}
        previewFixture={previewFixture}
        subView={teamSubView}
        onSubViewChange={onTeamSubViewChange}
        pendingInvite={pendingInvite}
        onSignIn={onAuthRequired}
        onCopyInvite={copyTextToClipboard}
        onAcceptPendingInvite={handleAcceptPendingInvite}
        onPendingInviteClear={onPendingInviteClear}
        focusClassification={focusClassification}
      />
    </div>
  );
}
