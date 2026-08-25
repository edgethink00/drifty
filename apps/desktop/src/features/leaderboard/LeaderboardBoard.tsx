import { useEffect, useMemo, useRef, useState } from "react";
import { formatRoundedDuration } from "../../lib/formatting";
import { LEADERBOARD_PUBLIC_RESULT_LIMIT } from "./leaderboardConfig";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { getDailyAverageSeconds, ProfileAvatar, StateBlock } from "./leaderboardViewHelpers";

export const LEADERBOARD_PAGE_SIZE = 25;

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
  readonly participantCount: number | null;
  readonly searchQuery: string;
  readonly statusMessage: string | null;
  readonly statusTone: "error" | "neutral";
  readonly topScopeFocusSeconds: number;
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
  participantCount,
  searchQuery,
  statusMessage,
  statusTone,
  topScopeFocusSeconds,
  onPeriodChange,
  onSearchQueryChange,
  onSelectProfile,
}: LeaderboardBoardProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const listFrameRef = useRef<HTMLDivElement>(null);
  const totalPages = Math.max(1, Math.ceil(filteredLeaderboard.length / LEADERBOARD_PAGE_SIZE));
  const safePageIndex = Math.min(pageIndex, totalPages - 1);
  const pageRows = useMemo(() => {
    const start = safePageIndex * LEADERBOARD_PAGE_SIZE;
    return filteredLeaderboard.slice(start, start + LEADERBOARD_PAGE_SIZE);
  }, [filteredLeaderboard, safePageIndex]);

  useEffect(() => {
    setPageIndex(0);
  }, [activePeriod, searchQuery]);

  useEffect(() => {
    if (pageIndex >= totalPages) setPageIndex(totalPages - 1);
  }, [pageIndex, totalPages]);

  const moveToPage = (nextPageIndex: number) => {
    setPageIndex(nextPageIndex);
    if (typeof listFrameRef.current?.scrollTo === "function") listFrameRef.current.scrollTo({ top: 0 });
  };

  const loadedCount = leaderboard.length;
  const hasMoreParticipants = participantCount === null
    ? loadedCount >= LEADERBOARD_PUBLIC_RESULT_LIMIT || (currentUserRank ?? 0) > loadedCount
    : participantCount > loadedCount;
  const scopeLabel = hasMoreParticipants ? `Top ${loadedCount}` : "All ranked";
  const firstVisible = filteredLeaderboard.length === 0 ? 0 : safePageIndex * LEADERBOARD_PAGE_SIZE + 1;
  const lastVisible = Math.min((safePageIndex + 1) * LEADERBOARD_PAGE_SIZE, filteredLeaderboard.length);
  const hasPagination = !isLoading && leaderboard.length > 0 && filteredLeaderboard.length > 0;

  return (
    <section className={`leaderboard-board-block${hasPagination ? " leaderboard-board-block--paginated" : ""}`} aria-label="Global leaderboard" aria-busy={isLoading || undefined}>
      <LeaderboardToolbar
        activePeriod={activePeriod}
        isLoading={isLoading}
        loadedCount={loadedCount}
        participantCount={participantCount}
        searchQuery={searchQuery}
        scopeLabel={scopeLabel}
        statusMessage={statusMessage}
        statusTone={statusTone}
        topScopeFocusSeconds={topScopeFocusSeconds}
        onPeriodChange={onPeriodChange}
        onSearchQueryChange={onSearchQueryChange}
      />

      {isLoading ? (
        <LeaderboardLoadingRankList activePeriod={activePeriod} />
      ) : leaderboard.length === 0 ? (
        <div className="leaderboard-board__state">
          <StateBlock
            eyebrow="Waiting for entries"
            title="No ranked participants yet"
            detail="Once someone opts in, rankings will appear here."
          />
        </div>
      ) : filteredLeaderboard.length === 0 ? (
        <div className="leaderboard-board__state">
          <StateBlock
            eyebrow="No match"
            title="No one matches that search"
            detail={`Try a name or rank number from the current ${scopeLabel.toLowerCase()}.`}
          />
        </div>
      ) : (
        <>
          <LeaderboardRankList
            activePeriod={activePeriod}
            currentUserRank={currentUserRank}
            frameRef={listFrameRef}
            isOptedIn={isOptedIn}
            rows={pageRows}
            onSelectProfile={onSelectProfile}
          />
          <nav className="leaderboard-pagination" aria-label="Leaderboard pages">
            <span className="leaderboard-pagination__summary" aria-live="polite">
              Showing <strong>{firstVisible}–{lastVisible}</strong> {searchQuery.trim()
                ? `of ${filteredLeaderboard.length} matches in ${scopeLabel.toLowerCase()}`
                : `of ${loadedCount}`}
            </span>
            <span className="leaderboard-pagination__position">Page {safePageIndex + 1} of {totalPages}</span>
            <div className="leaderboard-pagination__actions">
              <button
                type="button"
                className="app-btn app-btn--quiet app-btn--compact"
                aria-label="Previous leaderboard page"
                title="Previous page"
                disabled={safePageIndex === 0}
                onClick={() => moveToPage(safePageIndex - 1)}
              >
                <PaginationArrowIcon direction="previous" />
              </button>
              <button
                type="button"
                className="app-btn app-btn--quiet app-btn--compact"
                aria-label="Next leaderboard page"
                title="Next page"
                disabled={safePageIndex >= totalPages - 1}
                onClick={() => moveToPage(safePageIndex + 1)}
              >
                <PaginationArrowIcon direction="next" />
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}

function PaginationArrowIcon({ direction }: { readonly direction: "previous" | "next" }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={direction === "previous" ? "m9.5 3.5-4 4.5 4 4.5" : "m6.5 3.5 4 4.5-4 4.5"} />
    </svg>
  );
}

function LeaderboardToolbar({
  activePeriod,
  isLoading,
  loadedCount,
  participantCount,
  searchQuery,
  scopeLabel,
  statusMessage,
  statusTone,
  topScopeFocusSeconds,
  onPeriodChange,
  onSearchQueryChange,
}: {
  readonly activePeriod: LeaderboardPeriod;
  readonly isLoading: boolean;
  readonly loadedCount: number;
  readonly participantCount: number | null;
  readonly searchQuery: string;
  readonly scopeLabel: string;
  readonly statusMessage: string | null;
  readonly statusTone: "error" | "neutral";
  readonly topScopeFocusSeconds: number;
  readonly onPeriodChange?: (period: LeaderboardPeriod) => void;
  readonly onSearchQueryChange: (query: string) => void;
}) {
  const searchScope = scopeLabel === "All ranked" ? "ranked participants" : scopeLabel.toLowerCase();
  return (
    <div className="leaderboard-toolbar">
      <div className="leaderboard-toolbar__control-row">
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
              Scores refresh throughout the day
            </span>
          )}
        </div>
      </div>
      <div className="leaderboard-toolbar__stats" aria-label="Leaderboard scope" aria-hidden={isLoading || undefined}>
        <div>
          <span className="label-mono">Participants</span>
          <strong>{isLoading
            ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value" />
            : participantCount?.toLocaleString() ?? "—"}</strong>
        </div>
        <div>
          <span className="label-mono">Board</span>
          <strong>{isLoading ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value" /> : scopeLabel}</strong>
        </div>
        <div>
          <span className="label-mono">{scopeLabel} focus</span>
          <strong>{isLoading ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value leaderboard-loading-shell__toolbar-value--wide" /> : formatRoundedDuration(topScopeFocusSeconds)}</strong>
        </div>
      </div>
      <label className={`leaderboard-search${isLoading ? " leaderboard-search--loading" : ""}`} aria-hidden={isLoading || undefined}>
        <span className="sr-only">Search leaderboard</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          disabled={isLoading}
          placeholder={`Search ${searchScope}…`}
          type="search"
        />
      </label>
    </div>
  );
}

function LeaderboardLoadingRankList({ activePeriod }: { readonly activePeriod: LeaderboardPeriod }) {
  return (
    <div className="leaderboard-list-frame" aria-hidden="true">
      <LeaderboardListHeader activePeriod={activePeriod} />
      <ol className="leaderboard-list">
        {Array.from({ length: 5 }, (_, index) => (
          <li className="leaderboard-row leaderboard-loading-shell__row" key={index}>
            <button className="leaderboard-row__profile-button" type="button" tabIndex={-1}>
              <div className="leaderboard-row__main">
                <span className="leaderboard-row__rank"><span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-rank" /></span>
                <span className="leaderboard-row__avatar leaderboard-loading-shell__bone" />
                <div className="leaderboard-row__copy"><span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-name" /></div>
              </div>
              <div className="leaderboard-row__meta leaderboard-row__meta--compact">
                <div className="leaderboard-stat"><span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-value" /></div>
                {activePeriod !== "daily" ? <div className="leaderboard-stat"><span className="leaderboard-loading-shell__bone leaderboard-loading-shell__row-value" /></div> : null}
              </div>
              <span className="leaderboard-row__chevron leaderboard-loading-shell__bone" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LeaderboardListHeader({ activePeriod }: { readonly activePeriod: LeaderboardPeriod }) {
  return (
    <div className={`leaderboard-list-head${activePeriod === "daily" ? " leaderboard-list-head--daily" : ""}`} aria-hidden="true">
      <span>Participant</span>
      <span>Focus time</span>
      {activePeriod !== "daily" ? <span>Daily avg</span> : null}
    </div>
  );
}

function LeaderboardRankList({
  activePeriod,
  currentUserRank,
  frameRef,
  isOptedIn,
  rows,
  onSelectProfile,
}: {
  readonly activePeriod: LeaderboardPeriod;
  readonly currentUserRank: number | null;
  readonly frameRef: React.RefObject<HTMLDivElement>;
  readonly isOptedIn: boolean;
  readonly rows: readonly LeaderboardRow[];
  readonly onSelectProfile?: (row: LeaderboardRow) => void;
}) {
  return (
    <div className="leaderboard-list-frame" ref={frameRef}>
      <LeaderboardListHeader activePeriod={activePeriod} />
      <ol className="leaderboard-list" aria-label="Global focus leaderboard rankings">
        {rows.map((row) => {
          const isCurrentUser = isOptedIn && row.rank === currentUserRank;
          const rankTone = row.rank <= 3 ? ` leaderboard-row--rank-${row.rank}` : "";
          return (
            <li className={`${isCurrentUser ? "leaderboard-row leaderboard-row--current" : "leaderboard-row"}${rankTone}`} key={`${row.rank}-${row.public_id ?? row.display_name}-${row.updated_at}`}>
              <button type="button" className="leaderboard-row__profile-button" onClick={() => onSelectProfile?.(row)} aria-label={`View ${row.display_name} profile`}>
                <div className="leaderboard-row__main">
                  <span className="leaderboard-row__rank">#{row.rank}</span>
                  <ProfileAvatar className="leaderboard-row__avatar" name={row.display_name} src={row.avatar_url} />
                  <div className="leaderboard-row__copy">
                    <strong>{row.display_name}</strong>
                    {isCurrentUser ? <span className="leaderboard-row__you">You</span> : null}
                  </div>
                </div>
                <div className="leaderboard-row__meta leaderboard-row__meta--compact">
                  <div className="leaderboard-stat" aria-label={`Focus time ${formatRoundedDuration(row.focus_seconds_7d)}`}><strong>{formatRoundedDuration(row.focus_seconds_7d)}</strong></div>
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
