import { useMemo, useState } from "react";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { LeaderboardBoard } from "./LeaderboardBoard";
import { StateBlock, formatRank } from "./leaderboardViewHelpers";
import type { DailyProductivityPoint } from "../share/dailyProductivity";
import type { FocusCardControls } from "../share/useFocusCard";
import { ProfileEmbedsSection } from "../profile/ProfileEmbedsSection";
import { ProfileSocialLinks, type ProfileDraft } from "../profile/ProfileModals";

export type LeaderboardPublicProfileControls = {
  readonly card: FocusCardControls;
  readonly dailyProductivity: readonly DailyProductivityPoint[] | null;
  readonly draft: ProfileDraft;
  readonly focusSeconds7d: number;
  readonly profileError: string | null;
  readonly profileMessage: string | null;
  readonly publicId: string | null;
  readonly redesign: boolean;
  readonly shareMessage: string | null;
  readonly webAccountPreview?: boolean;
  readonly onCopyProfileLink: () => void;
  readonly onEditProfile: () => void;
};

export type LeaderboardViewProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  isLoading?: boolean;
  error?: string | null;
  isOptedIn: boolean;
  ownRank?: number | null;
  activePeriod?: LeaderboardPeriod;
  leaderboard?: LeaderboardRow[];
  totalFocusSeconds7d?: number;
  profileDisplayName?: string | null;
  email?: string | null;
  isActionLoading?: boolean;
  actionError?: string | null;
  publicProfile?: LeaderboardPublicProfileControls;
  statusMessage?: string | null;
  statusTone?: "error" | "neutral";
  onOptIn?: () => void;
  onSignIn?: () => void;
  onOptOut?: () => void;
  onOpenProfile?: () => void;
  onPeriodChange?: (period: LeaderboardPeriod) => void;
  onSelectProfile?: (row: LeaderboardRow) => void;
};

export function LeaderboardView({
  isSupabaseEnabled,
  isSignedIn,
  isLoading = false,
  error = null,
  isOptedIn,
  ownRank = null,
  activePeriod = "weekly",
  leaderboard = [],
  totalFocusSeconds7d = 0,
  profileDisplayName = null,
  email = null,
  isActionLoading = false,
  actionError = null,
  publicProfile,
  statusMessage = null,
  statusTone = "neutral",
  onOptIn,
  onSignIn,
  onOptOut,
  onOpenProfile,
  onPeriodChange,
  onSelectProfile,
}: LeaderboardViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const previewName = resolvePublicNamePreview(profileDisplayName, email);
  const currentUserRank = ownRank ?? leaderboard.find((row) => row.display_name === previewName)?.rank ?? null;
  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
  const profileDraft = publicProfile?.draft ?? null;
  const profileBio = profileDraft?.bio.trim() ?? "";
  const profileAvatarUrl = profileDraft?.avatarUrl.trim() ?? "";
  const editProfile = publicProfile?.onEditProfile ?? onOpenProfile ?? null;
  const filteredLeaderboard = useMemo(() => {
    if (!trimmedSearchQuery) return leaderboard;
    return leaderboard.filter((row) => row.display_name.toLowerCase().includes(trimmedSearchQuery) || String(row.rank).includes(trimmedSearchQuery));
  }, [leaderboard, trimmedSearchQuery]);

  return (
    <section className="leaderboard-panel" aria-label="Leaderboard">
      {!isSupabaseEnabled ? (
        <StateBlock
          eyebrow="Sync required"
          title="Leaderboard unavailable"
          detail="Supabase is not configured for this workspace."
        />
      ) : isLoading ? (
        <StateBlock
          eyebrow="Refreshing"
          title="Loading leaderboard"
          detail="Checking the latest opt-in rankings."
        />
      ) : error ? (
        <StateBlock
          eyebrow="Fetch error"
          title="Unable to load leaderboard"
          detail={error}
        />
      ) : (
        <div className="leaderboard-panel__stack">
          <section className="leaderboard-profile-block" aria-label="Leaderboard participation">
            <section className="leaderboard-hero" aria-label="Your leaderboard participation">
              <div className="leaderboard-hero__identity">
                <ProfileIdentityAvatar avatarUrl={profileAvatarUrl} displayName={previewName} className="leaderboard-hero__avatar" />
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
                    {editProfile ? (
                      <button type="button" className="leaderboard-profile-edit-button" aria-label="Edit public profile" onClick={editProfile}>
                        <PencilIcon />
                      </button>
                    ) : null}
                  </div>
                  {profileBio ? <p className="leaderboard-profile-bio">{profileBio}</p> : null}
                  {profileDraft ? (
                    <ProfileSocialLinks profile={{ website_url: profileDraft.websiteUrl, github_url: profileDraft.githubUrl, linkedin_url: profileDraft.linkedinUrl }} />
                  ) : null}
                  <div className="leaderboard-hero__actions">
                    {isOptedIn ? (
                      <button type="button" className="ghost-button leaderboard-hero__participation leaderboard-hero__participation--danger" onClick={() => onOptOut?.()} disabled={isActionLoading || !onOptOut}>{isActionLoading ? "Leaving…" : "Leave leaderboard"}</button>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn leaderboard-hero__participation leaderboard-hero__participation--join"
                        onClick={() => (isSignedIn ? onOptIn?.() : onSignIn?.())}
                        disabled={isActionLoading || (isSignedIn ? !onOptIn : !onSignIn)}
                      >
                        {isActionLoading ? "Joining…" : "Join leaderboard"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>
            {actionError ? <p className="capture-recency capture-recency--error" role="status">{actionError}</p> : null}
            {publicProfile?.profileError || publicProfile?.profileMessage ? (
              <div className="leaderboard-public-profile__messages">
                {publicProfile.profileError ? <p className="capture-recency capture-recency--error">{publicProfile.profileError}</p> : null}
                {publicProfile.profileMessage ? <p className="capture-recency">{publicProfile.profileMessage}</p> : null}
              </div>
            ) : null}
          </section>

          {publicProfile ? (
            <ProfileEmbedsSection
              card={publicProfile.card}
              dailyProductivity={publicProfile.dailyProductivity}
              displayName={previewName}
              draft={publicProfile.draft}
              focusSeconds7d={publicProfile.focusSeconds7d}
              publicId={publicProfile.publicId}
              redesign={publicProfile.redesign}
              webAccountPreview={publicProfile.webAccountPreview}
              onCopyProfileLink={publicProfile.onCopyProfileLink}
              onEditProfile={publicProfile.onEditProfile}
            />
          ) : null}

          <LeaderboardBoard
            activePeriod={activePeriod}
            currentUserRank={currentUserRank}
            filteredLeaderboard={filteredLeaderboard}
            isOptedIn={isOptedIn}
            leaderboard={leaderboard}
            previewName={previewName}
            searchQuery={searchQuery}
            statusMessage={statusMessage}
            statusTone={statusTone}
            totalFocusSeconds7d={totalFocusSeconds7d}
            onPeriodChange={onPeriodChange}
            onSearchQueryChange={setSearchQuery}
            onSelectProfile={onSelectProfile}
          />
          {publicProfile?.shareMessage ? <div className="leaderboard-share-toast" role="status">{publicProfile.shareMessage}</div> : null}
        </div>
      )}
    </section>
  );
}

function resolvePublicNamePreview(profileDisplayName?: string | null, email?: string | null) {
  const trimmedName = profileDisplayName?.trim();
  if (trimmedName) return trimmedName;

  const emailPrefix = email?.split("@")[0]?.trim();
  return emailPrefix || "drifty";
}

function ProfileIdentityAvatar({
  avatarUrl,
  className,
  displayName,
}: {
  readonly avatarUrl: string;
  readonly className: string;
  readonly displayName: string;
}) {
  if (avatarUrl) {
    return <img className={className} src={avatarUrl} alt="" aria-hidden="true" />;
  }

  return <span className={className} aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>;
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4.5 19.5 6 14.1 15.9 4.2a2.1 2.1 0 0 1 3 0l.9.9a2.1 2.1 0 0 1 0 3L9.9 18 4.5 19.5Z" />
      <path d="m14.5 5.6 3.9 3.9" />
    </svg>
  );
}
