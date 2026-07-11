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
  isSignedIn: boolean;
  isSupabaseEnabled: boolean;
  leaderboard: LeaderboardRow[];
  ownRank?: number | null;
  profileDisplayName?: string | null;
  publicProfile?: LeaderboardPublicProfileControls;
  statusMessage?: string | null;
  statusTone?: "error" | "neutral";
  totalFocusSeconds7d: number;
  onOptIn: () => void;
  onOptOut: () => void;
  onOpenProfile?: () => void;
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
  isSignedIn,
  isSupabaseEnabled,
  leaderboard,
  ownRank,
  profileDisplayName,
  publicProfile,
  statusMessage,
  statusTone,
  totalFocusSeconds7d,
  onOptIn,
  onOptOut,
  onOpenProfile,
  onPeriodChange,
  onSelectProfile,
  onSignIn,
}: LeaderboardPageProps) {
  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <h1>Global focus ranking</h1>
          <p className="page-subhead">Publicly share weekly focus and hourly patterns—not apps, sites, or raw history.</p>
        </div>
      </div>

      <div className="leaderboard-page-layout">
        <LeaderboardView
          isSupabaseEnabled={isSupabaseEnabled}
          isSignedIn={isSignedIn}
          isLoading={isLoading}
          error={error}
          isOptedIn={isOptedIn}
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
          onOpenProfile={onOpenProfile}
          onPeriodChange={onPeriodChange}
          onSelectProfile={onSelectProfile}
        />
      </div>
    </div>
  );
}
