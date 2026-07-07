import { useMemo, useState } from "react";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { LeaderboardBoard } from "./LeaderboardBoard";
import { StateBlock, formatRank } from "./leaderboardViewHelpers";

// The Leaderboard tab is just the ranking board plus a slim join/leave strip.
// Everything about YOUR public presence (profile fields, focus card, embeds)
// lives in the Profile tab.
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
                  </div>
                  <p className="leaderboard-profile-bio">
                    {isOptedIn
                      ? "Only your aggregate focus total is published."
                      : "Nothing is published until you join."}
                    {" "}Your public card &amp; embeds live in the Profile tab.
                  </p>
                  <div className="leaderboard-hero__actions">
                    {onOpenProfile ? (
                      <button type="button" className="settings-btn" onClick={onOpenProfile}>Open Profile</button>
                    ) : null}
                    {isOptedIn ? (
                      <button type="button" className="ghost-button leaderboard-hero__participation" onClick={() => onOptOut?.()} disabled={isActionLoading || !onOptOut}>{isActionLoading ? "Leaving…" : "Leave leaderboard"}</button>
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
            </section>
            {actionError ? <p className="capture-recency capture-recency--error" role="status">{actionError}</p> : null}
          </section>

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
