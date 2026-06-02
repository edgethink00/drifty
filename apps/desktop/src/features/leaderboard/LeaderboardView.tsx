import { useMemo, useState } from "react";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";

const leaderboardPeriodOptions = [
  { period: "daily", label: "Daily" },
  { period: "weekly", label: "Weekly" },
  { period: "monthly", label: "Monthly" },
] satisfies ReadonlyArray<{ period: LeaderboardPeriod; label: string }>;

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
  const topRankedRows = useMemo(
    () => leaderboard.slice().sort((left, right) => left.rank - right.rank).slice(0, 3),
    [leaderboard],
  );
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
          <section className="leaderboard-profile-block" aria-label="Leaderboard profile controls">
            <section className="leaderboard-hero" aria-label="Your leaderboard profile">
              <div className="leaderboard-hero__identity">
                <ProfileAvatar className="leaderboard-hero__avatar" name={previewName} src={profileAvatarUrl} />
                <div className="leaderboard-hero__main">
                  <div className="leaderboard-hero__name-row">
                    <h3>{previewName}</h3>
                    {(isSignedIn || onEditProfile) ? (
                      <button type="button" className="settings-btn" onClick={() => onEditProfile?.()} disabled={!onEditProfile}>Edit profile</button>
                    ) : null}
                  </div>
                  {trimmedProfileBio ? <p className="leaderboard-profile-bio">{trimmedProfileBio}</p> : null}
                  {profileLinks.length > 0 ? (
                    <div className="leaderboard-profile-links" aria-label="Public profile links">
                      {profileLinks.map((link) => (
                        <span key={`${link.kind}-${link.label}`}>{link.label}</span>
                      ))}
                    </div>
                  ) : null}
                  {isOptedIn ? (
                    <div className="leaderboard-hero__actions">
                      <button type="button" className="settings-btn" onClick={() => onViewOwnProfile?.()} disabled={!onViewOwnProfile}>View profile</button>
                      <button type="button" className="settings-btn" onClick={() => onShareProfile?.()} disabled={!onShareProfile}>Share</button>
                      <button type="button" className="ghost-button" onClick={() => onOptOut?.()} disabled={isActionLoading || !onOptOut}>{isActionLoading ? "Leaving…" : "Leave leaderboard"}</button>
                    </div>
                  ) : null}
                </div>
              </div>
              {!isOptedIn ? (
                <button
                  type="button"
                  className="settings-btn leaderboard-hero__join"
                  onClick={() => (isSignedIn ? onOptIn?.() : onSignIn?.())}
                  disabled={isActionLoading || (isSignedIn ? !onOptIn : !onSignIn)}
                >
                  {isActionLoading ? "Joining…" : "Join leaderboard"}
                </button>
              ) : null}
              <div className="leaderboard-hero__stats leaderboard-row__meta leaderboard-row__meta--compact" aria-label="Profile ranking summary">
                <div className="leaderboard-stat">
                  <span className="label-mono">Focus time</span>
                  <strong>{formatDuration(focusSeconds7d)}</strong>
                </div>
                {activePeriod !== "daily" ? (
                  <div className="leaderboard-stat">
                    <span className="label-mono">Daily avg</span>
                    <strong>{formatDuration(getDailyAverageSeconds(focusSeconds7d, activePeriod))}</strong>
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

          <section className="leaderboard-board-block" aria-label="Global leaderboard">
            {topRankedRows.length > 0 ? (
              <section className="leaderboard-podium" aria-label="Top leaderboard performers">
                <div className="leaderboard-podium__head">
                  <span className="label-mono">Top focus streaks</span>
                </div>
                <div className="leaderboard-podium__grid">
                  {topRankedRows.map((row) => (
                    <article className={`leaderboard-podium-card leaderboard-podium-card--rank-${row.rank}`} key={`podium-${row.rank}-${row.public_id ?? row.display_name}`}>
                      <span className="leaderboard-podium-card__rank">#{row.rank}</span>
                      <ProfileAvatar className="leaderboard-podium-card__avatar" name={row.display_name} src={row.avatar_url} />
                      <div className="leaderboard-podium-card__copy">
                        <strong>Rank {row.rank}</strong>
                        <span>{formatDuration(row.focus_seconds_7d)}</span>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="leaderboard-toolbar">
              <div className="leaderboard-period-control seg" role="group" aria-label="Leaderboard period">
                {leaderboardPeriodOptions.map((item) => (
                  <button
                    key={item.period}
                    type="button"
                    className={activePeriod === item.period ? "on" : undefined}
                    aria-pressed={activePeriod === item.period}
                    onClick={() => onPeriodChange?.(item.period)}
                  >
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
              <div className="leaderboard-toolbar__stats" aria-label="Leaderboard totals">
                <div>
                  <span className="label-mono">Total users</span>
                  <strong>{leaderboard.length}</strong>
                </div>
                <div>
                  <span className="label-mono">Total worktime</span>
                  <strong>{formatDuration(totalFocusSeconds7d)}</strong>
                </div>
                <div>
                  <span className="label-mono">Showing</span>
                  <strong>{filteredLeaderboard.length === leaderboard.length ? `${leaderboard.length} participants` : `${filteredLeaderboard.length} of ${leaderboard.length}`}</strong>
                </div>
              </div>
              <label className="leaderboard-search">
                <span className="sr-only">Search leaderboard</span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search people or rank…"
                  type="search"
                />
              </label>
            </div>

            {leaderboard.length === 0 ? (
              <StateBlock
                eyebrow="Waiting for entries"
                title="No ranked participants yet"
                detail="Once someone opts in, rankings will appear here."
              />
            ) : filteredLeaderboard.length === 0 ? (
              <StateBlock
                eyebrow="No match"
                title="No one matches that search"
                detail="Try a name or rank number from the current leaderboard."
              />
            ) : (
              <div className="leaderboard-list-frame">
                <div className={`leaderboard-list-head${activePeriod === "daily" ? " leaderboard-list-head--daily" : ""}`} aria-hidden="true">
                  <span>Participant</span>
                  <span>Focus time</span>
                  {activePeriod !== "daily" ? <span>Daily avg</span> : null}
                </div>
                <ol className="leaderboard-list" aria-label="Global focus leaderboard rankings">
                  {filteredLeaderboard.map((row) => {
                    const isCurrentUser = isOptedIn && row.rank === currentUserRank && row.display_name === previewName;
                    const rankTone = row.rank <= 3 ? ` leaderboard-row--rank-${row.rank}` : "";
                    return (
                      <li className={`${isCurrentUser ? "leaderboard-row leaderboard-row--current" : "leaderboard-row"}${rankTone}`} key={`${row.rank}-${row.display_name}-${row.updated_at}`}>
                        <button
                          type="button"
                          className="leaderboard-row__profile-button"
                          onClick={() => onSelectProfile?.(row)}
                          aria-label={`View ${row.display_name} profile`}
                        >
                          <div className="leaderboard-row__main">
                            <span className="leaderboard-row__rank">#{row.rank}</span>
                            <ProfileAvatar className="leaderboard-row__avatar" name={row.display_name} src={row.avatar_url} />
                            <div className="leaderboard-row__copy">
                              <strong>{row.display_name}</strong>
                            </div>
                          </div>

                          <div className="leaderboard-row__meta leaderboard-row__meta--compact">
                            <div className="leaderboard-stat" aria-label={`Focus time ${formatDuration(row.focus_seconds_7d)}`}>
                              <strong>{formatDuration(row.focus_seconds_7d)}</strong>
                            </div>
                            {row.period !== "daily" ? (
                              <div className="leaderboard-stat" aria-label={`Daily average ${formatDuration(getDailyAverageSeconds(row.focus_seconds_7d, row.period))}`}>
                                <strong>{formatDuration(getDailyAverageSeconds(row.focus_seconds_7d, row.period))}</strong>
                              </div>
                            ) : null}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function ProfileAvatar({ className, name, src }: { className: string; name: string; src?: string | null }) {
  const trimmedSrc = src?.trim();
  if (trimmedSrc) return <img className={className} src={trimmedSrc} alt="" aria-hidden="true" />;
  return <span className={className} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}

function ParticipationWindow({
  focusSeconds7d,
  windowStartDay,
  windowEndDay,
}: {
  focusSeconds7d: number;
  windowStartDay?: string | null;
  windowEndDay?: string | null;
}) {
  return (
    <div className="leaderboard-window" aria-label="Rolling focus window preview">
      <span className="label-mono">Your focus window</span>
      <strong>{formatDuration(focusSeconds7d)}</strong>
      <p>{formatWindow(windowStartDay, windowEndDay)}</p>
    </div>
  );
}

function StateBlock({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="empty-state leaderboard-state">
      <span className="eyebrow">{eyebrow}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function resolvePublicNamePreview(profileDisplayName?: string | null, email?: string | null) {
  const trimmedName = profileDisplayName?.trim();
  if (trimmedName) return trimmedName;

  const emailPrefix = email?.split("@")[0]?.trim();
  return emailPrefix || "egt";
}

function buildProfileLinks(website?: string | null, github?: string | null, linkedin?: string | null) {
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

function getDailyAverageSeconds(totalSeconds: number, period: LeaderboardPeriod) {
  if (period === "monthly") return Math.round(totalSeconds / 30);
  if (period === "weekly") return Math.round(totalSeconds / 7);
  return totalSeconds;
}

function formatDuration(totalSeconds: number) {
  if (totalSeconds <= 0) return "0m";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;

  return `${hours}h ${minutes}m`;
}

function formatRank(rank: number | null) {
  return rank === null ? "Not ranked yet" : `#${rank}`;
}

function formatWindow(startDay?: string | null, endDay?: string | null) {
  if (!startDay || !endDay) return "Current focus window";
  return `${startDay} → ${endDay}`;
}
