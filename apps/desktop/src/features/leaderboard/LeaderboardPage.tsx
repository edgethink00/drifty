import { LeaderboardView } from "./LeaderboardView";
import type { LeaderboardPublicProfileControls } from "./LeaderboardView";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { useLocalization } from "../localization/LocalizationContext";

export type LeaderboardPageProps = {
  actionError?: string | null;
  activePeriod: LeaderboardPeriod;
  email?: string | null;
  error?: string | null;
  isActionLoading: boolean;
  isCatchingUp?: boolean;
  isLoading: boolean;
  isOptedIn: boolean;
  isParticipationResolved?: boolean;
  isSignedIn: boolean;
  isSupabaseEnabled: boolean;
  leaderboard: LeaderboardRow[];
  ownFocusSeconds?: number | null;
  ownParticipantCount?: number | null;
  ownRank?: number | null;
  publiclyValid?: boolean | null;
  profileDisplayName?: string | null;
  publicProfile?: LeaderboardPublicProfileControls;
  statusMessage?: string | null;
  statusTone?: "error" | "neutral";
  totalFocusSeconds7d: number;
  onOptIn: () => void;
  onOptOut: () => void;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  onSelectProfile: (row: LeaderboardRow) => void;
  onSignIn: () => void;
};

export function LeaderboardPage({
  actionError,
  activePeriod,
  email,
  error,
  isActionLoading,
  isCatchingUp = false,
  isLoading,
  isOptedIn,
  isParticipationResolved,
  isSignedIn,
  isSupabaseEnabled,
  leaderboard,
  ownFocusSeconds,
  ownParticipantCount,
  ownRank,
  publiclyValid,
  profileDisplayName,
  publicProfile,
  statusMessage,
  statusTone,
  totalFocusSeconds7d,
  onOptIn,
  onOptOut,
  onPeriodChange,
  onSelectProfile,
  onSignIn,
}: LeaderboardPageProps) {
  const { t } = useLocalization();
  return (
    <div className="page page--lb-flush">
      {/* Both panels start at the top, so the page title stays available to screen readers only. */}
      <h1 className="sr-only">{t("leaderboard.title")}</h1>

      <div className="leaderboard-page-layout">
        <LeaderboardView
          isSupabaseEnabled={isSupabaseEnabled}
          isSignedIn={isSignedIn}
          isLoading={isLoading}
          error={error}
          isOptedIn={isOptedIn}
          isParticipationResolved={isParticipationResolved}
          ownFocusSeconds={ownFocusSeconds}
          ownParticipantCount={ownParticipantCount}
          ownRank={ownRank}
          publiclyValid={publiclyValid}
          activePeriod={activePeriod}
          leaderboard={leaderboard}
          totalFocusSeconds7d={totalFocusSeconds7d}
          profileDisplayName={profileDisplayName}
          email={email}
          isActionLoading={isActionLoading}
          isCatchingUp={isCatchingUp}
          actionError={actionError}
          publicProfile={publicProfile}
          statusMessage={statusMessage}
          statusTone={statusTone}
          onOptIn={onOptIn}
          onSignIn={onSignIn}
          onOptOut={onOptOut}
          onPeriodChange={onPeriodChange}
          onSelectProfile={onSelectProfile}
        />
      </div>
    </div>
  );
}
