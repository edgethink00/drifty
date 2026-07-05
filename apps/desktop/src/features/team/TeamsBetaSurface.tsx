import type { AuthState } from "../auth/AuthContext";
import { copyTextToClipboard } from "../profile/ProfileModals";
import { TeamPage } from "./TeamPage";
import { useTeamController } from "./useTeamController";

export type TeamsBetaSurfaceProps = {
  readonly hasRequiredAccountAuth: boolean;
  readonly isEffectiveAuthRequired: boolean;
  readonly isPolicySignedIn: boolean;
  readonly isSupabaseConfigured: boolean;
  readonly showAiClassificationImpact: boolean;
  readonly startOfDayMinutes: number;
  readonly user: AuthState["user"];
  readonly onAuthRequired: () => void;
};

export function TeamsBetaSurface({
  hasRequiredAccountAuth,
  isEffectiveAuthRequired,
  isPolicySignedIn,
  isSupabaseConfigured,
  showAiClassificationImpact,
  startOfDayMinutes,
  user,
  onAuthRequired,
}: TeamsBetaSurfaceProps) {
  const {
    activeTeamPeriod,
    invites: teamInvites,
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
      rows={teamRows}
      selectedTeam={selectedTeam}
      statusMessage={teamStatusMessage}
      statusTone={teamStatusTone}
      teams={teams}
      onAcceptInvite={handleAcceptInvite}
      onCopyInvite={copyTextToClipboard}
      onCreateInvite={handleCreateInvite}
      onCreateTeam={handleCreateTeam}
      onPeriodChange={setActiveTeamPeriod}
      onPublishTeamFocus={handlePublishTeamFocus}
      onRefresh={refreshTeamData}
      onRevokeInvite={handleRevokeInvite}
      onSelectTeam={selectTeam}
      onSignIn={onAuthRequired}
      onStopTeamFocusSharing={handleStopTeamFocusSharing}
    />
  );
}
