import { useMemo, useState } from "react";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { LeaderboardBoard } from "./LeaderboardBoard";
import { LeaderboardProfileCard } from "./LeaderboardProfileCard";
import { StateBlock, type ProfileLink } from "./leaderboardViewHelpers";

export type LeaderboardViewProps = {
  isSupabaseEnabled: boolean;
  isSignedIn: boolean;
  isLoading?: boolean;
  error?: string | null;
  isOptedIn: boolean;
  ownRank?: number | null;
  activePeriod?: LeaderboardPeriod;
  leaderboard?: LeaderboardRow[];
  focusSeconds7d?: number;
  totalFocusSeconds7d?: number;
  windowStartDay?: string | null;
  windowEndDay?: string | null;
  profileDisplayName?: string | null;
  profileAvatarUrl?: string | null;
  profileBio?: string | null;
  profileWebsiteUrl?: string | null;
  profileGithubUrl?: string | null;
  profileLinkedinUrl?: string | null;
  email?: string | null;
  isActionLoading?: boolean;
  actionError?: string | null;
  statusMessage?: string | null;
  statusTone?: "error" | "neutral";
  onOptIn?: () => void;
  onSignIn?: () => void;
  onEditProfile?: () => void;
  onViewOwnProfile?: () => void;
  onShareProfile?: () => void;
  onOptOut?: () => void;
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
  focusSeconds7d = 0,
  totalFocusSeconds7d = 0,
  windowStartDay = null,
  windowEndDay = null,
  profileDisplayName = null,
  profileAvatarUrl = null,
  profileBio = null,
  profileWebsiteUrl = null,
  profileGithubUrl = null,
  profileLinkedinUrl = null,
  email = null,
  isActionLoading = false,
  actionError = null,
  statusMessage = null,
  statusTone = "neutral",
  onOptIn,
  onSignIn,
  onEditProfile,
  onViewOwnProfile,
  onShareProfile,
  onOptOut,
  onPeriodChange,
  onSelectProfile,
}: LeaderboardViewProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const previewName = resolvePublicNamePreview(profileDisplayName, email);
  const profileLinks = useMemo(() => buildProfileLinks(profileWebsiteUrl, profileGithubUrl, profileLinkedinUrl), [profileGithubUrl, profileLinkedinUrl, profileWebsiteUrl]);
  const trimmedProfileBio = profileBio?.trim() ?? "";
  const currentUserRank = ownRank ?? leaderboard.find((row) => row.display_name === previewName)?.rank ?? null;
  const trimmedSearchQuery = searchQuery.trim().toLowerCase();
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
          <LeaderboardProfileCard
            actionError={actionError}
            activePeriod={activePeriod}
            currentUserRank={currentUserRank}
            focusSeconds7d={focusSeconds7d}
            isActionLoading={isActionLoading}
            isOptedIn={isOptedIn}
            isSignedIn={isSignedIn}
            previewName={previewName}
            profileAvatarUrl={profileAvatarUrl}
            profileLinks={profileLinks}
            trimmedProfileBio={trimmedProfileBio}
            windowEndDay={windowEndDay}
            windowStartDay={windowStartDay}
            onEditProfile={onEditProfile}
            onOptIn={onOptIn}
            onOptOut={onOptOut}
            onShareProfile={onShareProfile}
            onSignIn={onSignIn}
            onViewOwnProfile={onViewOwnProfile}
          />

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

function buildProfileLinks(website?: string | null, github?: string | null, linkedin?: string | null): ProfileLink[] {
  return [
    { kind: "website", label: formatProfileLink(website) },
    { kind: "github", label: formatProfileLink(github) },
    { kind: "linkedin", label: formatProfileLink(linkedin) },
  ].filter((link): link is { kind: string; label: string } => Boolean(link.label));
}

function formatProfileLink(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  return trimmed.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/i, "");
}
