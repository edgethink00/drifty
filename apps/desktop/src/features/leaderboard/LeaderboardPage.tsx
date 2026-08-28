import { LeaderboardView } from "./LeaderboardView";
import type { LeaderboardPublicProfileControls } from "./LeaderboardView";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";

export type LeaderboardPageProps = {
  actionError?: string | null;
  activePeriod: LeaderboardPeriod;
  email?: string | null;
  error?: string | null;
  isActionLoading: boolean;
  isLoading: boolean;
  isOptedIn: boolean;
  isParticipationResolved?: boolean;
  isSignedIn: boolean;
  isSupabaseEnabled: boolean;
  leaderboard: LeaderboardRow[];
  ownFocusSeconds?: number | null;
  ownParticipantCount?: number | null;
  ownRank?: number | null;
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
  isLoading,
  isOptedIn,
  isParticipationResolved,
  isSignedIn,
  isSupabaseEnabled,
  leaderboard,
  ownFocusSeconds,
  ownParticipantCount,
  ownRank,
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
  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h1>Leaderboard</h1>
        </div>
      </div>

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
          activePeriod={activePeriod}
          leaderboard={leaderboard}
          totalFocusSeconds7d={totalFocusSeconds7d}
          profileDisplayName={profileDisplayName}
          email={email}
          isActionLoading={isActionLoading}
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
