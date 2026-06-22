import { LeaderboardView } from "./LeaderboardView";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";

export type LeaderboardPageProps = {
  actionError?: string | null;
  activePeriod: LeaderboardPeriod;
  email?: string | null;
  error?: string | null;
  focusSeconds7d: number;
  isActionLoading: boolean;
  isLoading: boolean;
  isOptedIn: boolean;
  isSignedIn: boolean;
  isSupabaseEnabled: boolean;
  leaderboard: LeaderboardRow[];
  ownRank?: number | null;
  profileAvatarUrl?: string | null;
  profileBio?: string | null;
  profileDisplayName?: string | null;
  profileError?: string | null;
  profileGithubUrl?: string | null;
  profileLinkedinUrl?: string | null;
  profileMessage?: string | null;
  profileShareMessage?: string | null;
  profileWebsiteUrl?: string | null;
  totalFocusSeconds7d: number;
  windowEndDay: string;
  windowStartDay: string;
  onEditProfile: () => void;
  onOptIn: () => void;
  onOptOut: () => void;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  onSelectProfile: (row: LeaderboardRow) => void;
  onShareProfile: () => void;
  onSignIn: () => void;
  onViewOwnProfile: () => void;
};

export function LeaderboardPage({
  actionError,
  activePeriod,
  email,
  error,
  focusSeconds7d,
  isActionLoading,
  isLoading,
  isOptedIn,
  isSignedIn,
  isSupabaseEnabled,
  leaderboard,
  ownRank,
  profileAvatarUrl,
  profileBio,
  profileDisplayName,
  profileError,
  profileGithubUrl,
  profileLinkedinUrl,
  profileMessage,
  profileShareMessage,
  profileWebsiteUrl,
  totalFocusSeconds7d,
  windowEndDay,
  windowStartDay,
  onEditProfile,
  onOptIn,
  onOptOut,
  onPeriodChange,
  onSelectProfile,
  onShareProfile,
  onSignIn,
  onViewOwnProfile,
}: LeaderboardPageProps) {
  return (
    <div className="page">
      <div className="pg-head">
        <div>
          <div className="eyebrow">Leaderboard</div>
          <h1>Global focus ranking</h1>
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
          focusSeconds7d={focusSeconds7d}
          totalFocusSeconds7d={totalFocusSeconds7d}
          windowStartDay={windowStartDay}
          windowEndDay={windowEndDay}
          profileDisplayName={profileDisplayName}
          profileAvatarUrl={profileAvatarUrl}
          profileBio={profileBio}
          profileWebsiteUrl={profileWebsiteUrl}
          profileGithubUrl={profileGithubUrl}
          profileLinkedinUrl={profileLinkedinUrl}
          email={email}
          isActionLoading={isActionLoading}
          actionError={actionError}
          onOptIn={onOptIn}
          onSignIn={onSignIn}
          onEditProfile={onEditProfile}
          onViewOwnProfile={onViewOwnProfile}
          onShareProfile={onShareProfile}
          onOptOut={onOptOut}
          onPeriodChange={onPeriodChange}
          onSelectProfile={onSelectProfile}
        />
      </div>
      {profileError ? <p className="capture-recency capture-recency--error">{profileError}</p> : null}
      {profileMessage ? <p className="capture-recency">{profileMessage}</p> : null}
      {profileShareMessage ? <div className="leaderboard-share-toast" role="status">{profileShareMessage}</div> : null}
    </div>
  );
}
