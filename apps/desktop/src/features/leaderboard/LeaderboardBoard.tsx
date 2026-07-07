import { formatRoundedDuration } from "../../lib/formatting";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { getDailyAverageSeconds, ProfileAvatar, StateBlock } from "./leaderboardViewHelpers";

const leaderboardPeriodOptions = [
  { period: "daily", label: "Daily" },
  { period: "weekly", label: "Weekly" },
  { period: "monthly", label: "Monthly" },
] satisfies ReadonlyArray<{ readonly period: LeaderboardPeriod; readonly label: string }>;

export type LeaderboardBoardProps = {
  readonly activePeriod: LeaderboardPeriod;
  readonly currentUserRank: number | null;
  readonly filteredLeaderboard: readonly LeaderboardRow[];
  readonly isOptedIn: boolean;
  readonly leaderboard: readonly LeaderboardRow[];
  readonly previewName: string;
  readonly searchQuery: string;
  readonly statusMessage: string | null;
  readonly statusTone: "error" | "neutral";
  readonly totalFocusSeconds7d: number;
  readonly onPeriodChange?: (period: LeaderboardPeriod) => void;
  readonly onSearchQueryChange: (query: string) => void;
  readonly onSelectProfile?: (row: LeaderboardRow) => void;
};

export function LeaderboardBoard({
  activePeriod,
  currentUserRank,
  filteredLeaderboard,
  isOptedIn,
  leaderboard,
  previewName,
  searchQuery,
  statusMessage,
  statusTone,
  totalFocusSeconds7d,
  onPeriodChange,
  onSearchQueryChange,
  onSelectProfile,
}: LeaderboardBoardProps) {
  return (
    <section className="leaderboard-board-block" aria-label="Global leaderboard">
      <LeaderboardToolbar
        activePeriod={activePeriod}
        filteredCount={filteredLeaderboard.length}
        leaderboardCount={leaderboard.length}
        searchQuery={searchQuery}
        statusMessage={statusMessage}
        statusTone={statusTone}
        totalFocusSeconds7d={totalFocusSeconds7d}
        onPeriodChange={onPeriodChange}
        onSearchQueryChange={onSearchQueryChange}
      />

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
        <LeaderboardRankList
          activePeriod={activePeriod}
          currentUserRank={currentUserRank}
          isOptedIn={isOptedIn}
          previewName={previewName}
          rows={filteredLeaderboard}
          onSelectProfile={onSelectProfile}
        />
      )}
    </section>
  );
}

function LeaderboardToolbar({
  activePeriod,
  filteredCount,
  leaderboardCount,
  searchQuery,
  statusMessage,
  statusTone,
  totalFocusSeconds7d,
  onPeriodChange,
  onSearchQueryChange,
}: {
  readonly activePeriod: LeaderboardPeriod;
  readonly filteredCount: number;
  readonly leaderboardCount: number;
  readonly searchQuery: string;
  readonly statusMessage: string | null;
  readonly statusTone: "error" | "neutral";
  readonly totalFocusSeconds7d: number;
  readonly onPeriodChange?: (period: LeaderboardPeriod) => void;
  readonly onSearchQueryChange: (query: string) => void;
}) {
  return (
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
      <div className="leaderboard-toolbar__status-slot">
        {statusMessage ? (
          <span className="leaderboard-refresh-status" data-tone={statusTone} role="status" aria-live="polite">
            {statusMessage}
          </span>
        ) : (
          <span className="leaderboard-refresh-status leaderboard-refresh-status--placeholder" aria-hidden="true">
            Refreshing leaderboard
          </span>
        )}
      </div>
      <div className="leaderboard-toolbar__stats" aria-label="Leaderboard totals">
        <div>
          <span className="label-mono">Total users</span>
          <strong>{leaderboardCount}</strong>
        </div>
        <div>
          <span className="label-mono">Total worktime</span>
          <strong>{formatRoundedDuration(totalFocusSeconds7d)}</strong>
        </div>
        <div>
          <span className="label-mono">Showing</span>
          <strong>{filteredCount === leaderboardCount ? `${leaderboardCount} participants` : `${filteredCount} of ${leaderboardCount}`}</strong>
        </div>
      </div>
      <label className="leaderboard-search">
        <span className="sr-only">Search leaderboard</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search people or rank…"
          type="search"
        />
      </label>
    </div>
  );
}

function LeaderboardRankList({
  activePeriod,
  currentUserRank,
  isOptedIn,
  previewName,
  rows,
  onSelectProfile,
}: {
  readonly activePeriod: LeaderboardPeriod;
  readonly currentUserRank: number | null;
  readonly isOptedIn: boolean;
  readonly previewName: string;
  readonly rows: readonly LeaderboardRow[];
  readonly onSelectProfile?: (row: LeaderboardRow) => void;
}) {
  return (
    <div className="leaderboard-list-frame">
      <div className={`leaderboard-list-head${activePeriod === "daily" ? " leaderboard-list-head--daily" : ""}`} aria-hidden="true">
        <span>Participant</span>
        <span>Focus time</span>
        {activePeriod !== "daily" ? <span>Daily avg</span> : null}
      </div>
      <ol className="leaderboard-list" aria-label="Global focus leaderboard rankings">
        {rows.map((row) => {
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
                  <div className="leaderboard-stat" aria-label={`Focus time ${formatRoundedDuration(row.focus_seconds_7d)}`}>
                    <strong>{formatRoundedDuration(row.focus_seconds_7d)}</strong>
                  </div>
                  {row.period !== "daily" ? (
                    <div className="leaderboard-stat" aria-label={`Daily average ${formatRoundedDuration(getDailyAverageSeconds(row.focus_seconds_7d, row.period))}`}>
                      <strong>{formatRoundedDuration(getDailyAverageSeconds(row.focus_seconds_7d, row.period))}</strong>
                    </div>
                  ) : null}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
