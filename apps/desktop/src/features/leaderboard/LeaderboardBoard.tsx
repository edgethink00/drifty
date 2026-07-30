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
  readonly isLoading?: boolean;
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
  isLoading = false,
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
    <section className="leaderboard-board-block" aria-label="Global leaderboard" aria-busy={isLoading || undefined}>
      <LeaderboardToolbar
        activePeriod={activePeriod}
        filteredCount={filteredLeaderboard.length}
        isLoading={isLoading}
        leaderboardCount={leaderboard.length}
        searchQuery={searchQuery}
        statusMessage={statusMessage}
        statusTone={statusTone}
        totalFocusSeconds7d={totalFocusSeconds7d}
        onPeriodChange={onPeriodChange}
        onSearchQueryChange={onSearchQueryChange}
      />

      {isLoading ? (
        <LeaderboardLoadingRankList activePeriod={activePeriod} />
      ) : leaderboard.length === 0 ? (
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
  isLoading,
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
  readonly isLoading: boolean;
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
      <div className="leaderboard-period-control seg" role="group" aria-label="Leaderboard period" aria-hidden={isLoading || undefined}>
        {leaderboardPeriodOptions.map((item) => (
          <button
            key={item.period}
            type="button"
            className={activePeriod === item.period ? "on" : undefined}
            aria-pressed={activePeriod === item.period}
            disabled={isLoading}
            onClick={() => onPeriodChange?.(item.period)}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      <div className="leaderboard-toolbar__status-slot">
        {isLoading ? (
          <span className="leaderboard-refresh-status leaderboard-loading-shell__status" role="status" aria-live="polite">
            Loading latest rankings…
          </span>
        ) : statusMessage ? (
          <span className="leaderboard-refresh-status" data-tone={statusTone} role="status" aria-live="polite">
            {statusMessage}
          </span>
        ) : (
          <span className="leaderboard-refresh-status leaderboard-refresh-status--idle" aria-hidden="true">
            Scores update hourly
          </span>
        )}
      </div>
      <div className="leaderboard-toolbar__stats" aria-label="Leaderboard totals" aria-hidden={isLoading || undefined}>
        <div>
          <span className="label-mono">Total users</span>
          <strong>{isLoading ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value" /> : leaderboardCount}</strong>
        </div>
        <div>
          <span className="label-mono">Total worktime</span>
          <strong>{isLoading ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value" /> : formatRoundedDuration(totalFocusSeconds7d)}</strong>
        </div>
        <div>
          <span className="label-mono">Showing</span>
          <strong>{isLoading
            ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value leaderboard-loading-shell__toolbar-value--wide" />
            : filteredCount === leaderboardCount
              ? `${leaderboardCount} participants`
              : `${filteredCount} of ${leaderboardCount}`}</strong>
        </div>
      </div>
      <label className={`leaderboard-search${isLoading ? " leaderboard-search--loading" : ""}`} aria-hidden={isLoading || undefined}>
        <span className="sr-only">Search leaderboard</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          disabled={isLoading}
          placeholder="Search people or rank…"
          type="search"
        />
      </label>
    </div>
  );
}

function LeaderboardLoadingRankList({ activePeriod }: { readonly activePeriod: LeaderboardPeriod }) {
  return (
    <div className="leaderboard-list-frame" aria-hidden="true">
      <div className={`leaderboard-list-head${activePeriod === "daily" ? " leaderboard-list-head--daily" : ""}`}>
        <span>Participant</span>
        <span>Focus time</span>
        {activePeriod !== "daily" ? <span>Daily avg</span> : null}
      </div>
      <ol className="leaderboard-list">
        {Array.from({ length: 5 }, (_, index) => (
          <li className="leaderboard-row leaderboard-loading-shell__row" key={index}>
            <button className="leaderboard-row__profile-button" type="button" tabIndex={-1}>
              <div className="leaderboard-row__main">
                <span className="leaderboard-row__rank">
                  <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-rank" />
                </span>
                <span className="leaderboard-row__avatar leaderboard-loading-shell__bone" />
                <div className="leaderboard-row__copy">
                  <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-name" />
                </div>
              </div>
              <div className="leaderboard-row__meta leaderboard-row__meta--compact">
                <div className="leaderboard-stat">
                  <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-value" />
                </div>
                {activePeriod !== "daily" ? (
                  <div className="leaderboard-stat">
                    <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-value" />
                  </div>
                ) : null}
              </div>
              <span className="leaderboard-row__chevron leaderboard-loading-shell__bone" />
            </button>
          </li>
        ))}
      </ol>
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
                    {isCurrentUser ? <span className="leaderboard-row__you">You</span> : null}
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
                <span className="leaderboard-row__chevron" aria-hidden="true">›</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
