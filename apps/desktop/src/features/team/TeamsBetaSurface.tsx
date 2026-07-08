import type { AuthState } from "../auth/AuthContext";
import { copyTextToClipboard } from "../profile/ProfileModals";
import { TeamPage } from "./TeamPage";
import type { PendingTeamInvite } from "./teamInviteDeepLinks";
import type { AcceptTeamInviteInput } from "./teamService";
import { useTeamController } from "./useTeamController";

export type TeamsBetaSurfaceProps = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isEffectiveAuthRequired: boolean;
  readonly isPolicySignedIn: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly showAiClassificationImpact: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly pendingInvite?: PendingTeamInvite | null;
  readonly onAuthRequired: () => void;
  readonly onPendingInviteClear?: () => void;
};

export function TeamsBetaSurface({
  hasRequiredAccountAuth,
  isEffectiveAuthRequired,
  isPolicySignedIn,
  isSupabaseConfigured,
  showAiClassificationImpact,
  startOfDayMinutes,
  user,
  pendingInvite = null,
  onAuthRequired,
  onPendingInviteClear,
}: TeamsBetaSurfaceProps) {
  const {
    activeTeamPeriod,
    invites: teamInvites,
    liveRows: teamLiveRows,
    rows: teamRows,
    selectedTeam,
    teamActionError,
    teamActionLoading,
    teamError,
    teamLoading,
    teamStatusMessage,
    teamStatusTone,
    teams,
    handleAcceptInvite,
    handleCreateInvite,
    handleCreateTeam,
    handlePublishTeamFocus,
    handleRevokeInvite,
    handleStopTeamFocusSharing,
    refreshTeamData,
    selectTeam,
    setActiveTeamPeriod,
  } = useTeamController({
    activeTab: "team",
    hasRequiredAccountAuth,
    isEffectiveAuthRequired,
    isSupabaseConfigured,
    showAiClassificationImpact,
    startOfDayMinutes,
    user,
    onAuthRequired,
  });

  const handleAcceptPendingInvite = async (input: AcceptTeamInviteInput) => {
    await handleAcceptInvite(input);
    onPendingInviteClear?.();
  };

  return (
    <TeamPage
      actionError={teamActionError}
      activePeriod={activeTeamPeriod}
      error={teamError}
      hasRequiredAccountAuth={hasRequiredAccountAuth}
      isActionLoading={teamActionLoading}
      isLoading={teamLoading}
      isSignedIn={isPolicySignedIn}
      isSupabaseEnabled={isSupabaseConfigured}
      invites={teamInvites}
      liveRows={teamLiveRows}
      pendingInvite={pendingInvite}
      rows={teamRows}
      selectedTeam={selectedTeam}
      statusMessage={teamStatusMessage}
      statusTone={teamStatusTone}
      teams={teams}
      onAcceptInvite={pendingInvite ? handleAcceptPendingInvite : handleAcceptInvite}
      onCopyInvite={copyTextToClipboard}
      onCreateInvite={handleCreateInvite}
      onCreateTeam={handleCreateTeam}
      onPeriodChange={setActiveTeamPeriod}
      onPublishTeamFocus={handlePublishTeamFocus}
      onRefresh={refreshTeamData}
      onRevokeInvite={handleRevokeInvite}
      onSelectTeam={selectTeam}
      onSignIn={onAuthRequired}
      onPendingInviteClear={onPendingInviteClear}
      onStopTeamFocusSharing={handleStopTeamFocusSharing}
    />
  );
}
