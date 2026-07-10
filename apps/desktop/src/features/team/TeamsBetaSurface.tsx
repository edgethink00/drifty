import type { AuthState } from "../auth/AuthContext";
import { copyTextToClipboard } from "../profile/ProfileModals";
import { TeamWorkspace } from "./TeamWorkspace";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import type { AcceptTeamInviteInput } from "./teamService";
import { useTeamController } from "./useTeamController";
import type { TeamProjectsSubView } from "./useTeamProjects";

export type TeamsBetaSurfaceProps = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isEffectiveAuthRequired: boolean;
  readonly isPolicySignedIn: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly teamSubView: TeamProjectsSubView;
  readonly onTeamSubViewChange: (subView: TeamProjectsSubView) => void;
  readonly pendingInvite?: PendingTeamInvite | null;
  readonly onAuthRequired: () => void;
  readonly onPendingInviteClear?: () => void;
};

export function TeamsBetaSurface({
  hasRequiredAccountAuth,
  isEffectiveAuthRequired,
  isPolicySignedIn,
  isSupabaseConfigured,
  startOfDayMinutes,
  user,
  teamSubView,
  onTeamSubViewChange,
  pendingInvite = null,
  onAuthRequired,
  onPendingInviteClear,
}: TeamsBetaSurfaceProps) {
  const controller = useTeamController({
    activeTab: "team",
    hasRequiredAccountAuth,
    isEffectiveAuthRequired,
    isSupabaseConfigured,
    user,
    onAuthRequired,
  });

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
