import { formatRoundedDuration } from "../../lib/formatting";
import type { LeaderboardPeriod } from "./leaderboardService";
import { formatRank, getDailyAverageSeconds, ParticipationWindow, ProfileAvatar, type ProfileLink } from "./leaderboardViewHelpers";

export type LeaderboardProfileCardProps = {
  readonly actionError: string | null;
  readonly activePeriod: LeaderboardPeriod;
  readonly currentUserRank: number | null;
  readonly focusSeconds7d: number;
  readonly isActionLoading: boolean;
  readonly isOptedIn: boolean;
  readonly isSignedIn: boolean;
  readonly previewName: string;
  readonly profileAvatarUrl?: string | null;
  readonly profileLinks: readonly ProfileLink[];
  readonly trimmedProfileBio: string;
  readonly windowEndDay?: string | null;
  readonly windowStartDay?: string | null;
  readonly onEditProfile?: () => void;
  readonly onOptIn?: () => void;
  readonly onOptOut?: () => void;
  readonly onShareProfile?: () => void;
  readonly onSignIn?: () => void;
  readonly onViewOwnProfile?: () => void;
};

export function LeaderboardProfileCard({
  actionError,
  activePeriod,
  currentUserRank,
  focusSeconds7d,
  isActionLoading,
  isOptedIn,
  isSignedIn,
  previewName,
  profileAvatarUrl,
  profileLinks,
  trimmedProfileBio,
  windowEndDay,
  windowStartDay,
  onEditProfile,
  onOptIn,
  onOptOut,
  onShareProfile,
  onSignIn,
  onViewOwnProfile,
}: LeaderboardProfileCardProps) {
  return (
    <section className="leaderboard-profile-block" aria-label="Leaderboard profile controls">
      <div className="leaderboard-section-kicker">
        <div>
          <span className="label-mono">My public profile</span>
          <p>Control what appears next to your aggregate focus total.</p>
        </div>
        <span className="leaderboard-privacy-badge">Aggregates only</span>
      </div>

      <section className="leaderboard-hero" aria-label="Your leaderboard profile">
        <div className="leaderboard-hero__identity">
          <ProfileAvatar className="leaderboard-hero__avatar" name={previewName} src={profileAvatarUrl} />
          <div className="leaderboard-hero__main">
            <div className="leaderboard-hero__name-row">
              <h3>{previewName}</h3>
              <span className={`leaderboard-hero__status${isOptedIn ? " leaderboard-hero__status--live" : ""}`}>
                {isOptedIn
                  ? currentUserRank !== null
                    ? `On the board · ${formatRank(currentUserRank)}`
                    : "On the board"
                  : "Not on the board yet"}
              </span>
              <button type="button" className="settings-btn" onClick={() => onEditProfile?.()} disabled={!onEditProfile}>Edit profile</button>
            </div>
            {trimmedProfileBio ? <p className="leaderboard-profile-bio">{trimmedProfileBio}</p> : <p className="leaderboard-profile-bio">Add a short bio so your public card feels complete.</p>}
            {profileLinks.length > 0 ? (
              <div className="leaderboard-profile-links" aria-label="Public profile links">
                {profileLinks.map((link) => (
                  <span key={`${link.kind}-${link.label}`}>{link.label}</span>
                ))}
              </div>
            ) : (
              <div className="leaderboard-profile-links leaderboard-profile-links--empty" aria-label="Public profile links">
                <span>No public links yet</span>
              </div>
            )}
            <div className={`leaderboard-hero__actions${isOptedIn ? " leaderboard-hero__actions--live" : ""}`}>
              <div className="leaderboard-participation-summary" aria-label="Leaderboard publishing status">
                <span className={`leaderboard-participation-summary__dot${isOptedIn ? " leaderboard-participation-summary__dot--live" : ""}`} aria-hidden="true" />
                <div>
                  <strong>{isOptedIn ? "Public board active" : "Private until you join"}</strong>
                  <p>{isOptedIn ? "Your profile card and aggregate focus total are visible." : "Nothing is published until you opt in."}</p>
                </div>
              </div>
              <div className="leaderboard-hero__button-group">
                {isOptedIn ? (
                  <>
                    <button type="button" className="settings-btn" onClick={() => onViewOwnProfile?.()} disabled={!onViewOwnProfile}>View profile</button>
                    <button type="button" className="settings-btn" onClick={() => onShareProfile?.()} disabled={!onShareProfile}>Share</button>
                    <button type="button" className="ghost-button leaderboard-hero__participation" onClick={() => onOptOut?.()} disabled={isActionLoading || !onOptOut}>{isActionLoading ? "Leaving…" : "Leave leaderboard"}</button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="settings-btn leaderboard-hero__participation"
                    onClick={() => (isSignedIn ? onOptIn?.() : onSignIn?.())}
                    disabled={isActionLoading || (isSignedIn ? !onOptIn : !onSignIn)}
                  >
                    {isActionLoading ? "Joining…" : "Join leaderboard"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="leaderboard-hero__stats leaderboard-row__meta leaderboard-row__meta--compact" aria-label="Profile ranking summary">
          <div className="leaderboard-stat">
            <span className="label-mono">Focus time</span>
            <strong>{formatRoundedDuration(focusSeconds7d)}</strong>
          </div>
          {activePeriod !== "daily" ? (
            <div className="leaderboard-stat">
              <span className="label-mono">Daily avg</span>
              <strong>{formatRoundedDuration(getDailyAverageSeconds(focusSeconds7d, activePeriod))}</strong>
            </div>
          ) : null}
          <div className="leaderboard-stat">
            <span className="label-mono">Rank</span>
            <strong>{isOptedIn ? formatRank(currentUserRank) : "—"}</strong>
          </div>
        </div>
      </section>

      {!isSignedIn ? (
        <div className="leaderboard-preview" aria-label="Beta leaderboard participation">
          <span className="label-mono">Public board</span>
          <strong>Join in beta</strong>
          <p>Apps, sites, windows, and sessions are not published to the leaderboard.</p>
          <ParticipationWindow
            focusSeconds7d={focusSeconds7d}
            windowStartDay={windowStartDay}
            windowEndDay={windowEndDay}
          />
        </div>
      ) : !isOptedIn ? (
        <div className="leaderboard-preview" aria-label="Public name preview">
          <span className="label-mono">Ready when you are</span>
          <strong>{previewName}</strong>
          <p>Apps, sites, windows, and sessions are not published to the leaderboard.</p>
          <ParticipationWindow
            focusSeconds7d={focusSeconds7d}
            windowStartDay={windowStartDay}
            windowEndDay={windowEndDay}
          />
        </div>
      ) : null}
      {actionError ? <p className="capture-recency capture-recency--error" role="status">{actionError}</p> : null}
    </section>
  );
}
