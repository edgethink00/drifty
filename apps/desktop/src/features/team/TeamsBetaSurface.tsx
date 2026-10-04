import type { AuthState } from "../auth/AuthContext";
import { copyTextToClipboard } from "../profile/ProfileModals";
import { TeamWorkspace } from "./TeamWorkspace";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import type { AcceptTeamInviteInput } from "./teamService";
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
  readonly teamSubView: TeamProjectsSubView;
  readonly onTeamSubViewChange: (subView: TeamProjectsSubView) => void;
  readonly pendingInvite?: PendingTeamInvite | null;
  readonly onAuthRequired: () => void;
  readonly onPendingInviteClear?: () => void;
};

export function TeamsBetaSurface({
  hasRequiredAccountAuth,
  isPolicySignedIn,
  isSupabaseConfigured,
  startOfDayMinutes,
  user,
  controller,
  teamSubView,
  onTeamSubViewChange,
  pendingInvite = null,
  onAuthRequired,
  onPendingInviteClear,
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
        subView={teamSubView}
        onSubViewChange={onTeamSubViewChange}
        pendingInvite={pendingInvite}
        onSignIn={onAuthRequired}
        onCopyInvite={copyTextToClipboard}
        onAcceptPendingInvite={handleAcceptPendingInvite}
        onPendingInviteClear={onPendingInviteClear}
      />
    </div>
  );
}
