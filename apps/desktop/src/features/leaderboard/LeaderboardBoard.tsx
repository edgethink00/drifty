import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatLocalizedDuration } from "../../lib/formatting";
import { LEADERBOARD_PUBLIC_RESULT_LIMIT } from "./leaderboardConfig";
import type { LeaderboardPeriod, LeaderboardRow } from "./leaderboardService";
import { getDailyAverageSeconds, ProfileAvatar, StateBlock } from "./leaderboardViewHelpers";
import { useLocalization } from "../localization/LocalizationContext";

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
  readonly isSplitPreview?: boolean;
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
  isSplitPreview = false,
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
  const { effectiveLanguage, t } = useLocalization();
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
  const scopeLabel = hasMoreParticipants ? t("leaderboard.topCount", { count: loadedCount }) : t("leaderboard.allRanked");
  // Sentence-safe scope for search copy: "ranked participants" or "top 100".
  const searchScope = hasMoreParticipants
    ? effectiveLanguage === "en" ? scopeLabel.toLowerCase() : scopeLabel
    : t("leaderboard.rankedParticipants");
  const firstVisible = filteredLeaderboard.length === 0 ? 0 : safePageIndex * LEADERBOARD_PAGE_SIZE + 1;
  const lastVisible = Math.min((safePageIndex + 1) * LEADERBOARD_PAGE_SIZE, filteredLeaderboard.length);
  const hasPagination = !isLoading && leaderboard.length > 0 && filteredLeaderboard.length > 0;
  // The split preview shows refresh status in the list header on wide boards so
  // the rows never shift when a transient status appears or clears.
  const statusInListHead = isSplitPreview && (isLoading || hasPagination);
  const status = isLoading ? (
    <span className="leaderboard-refresh-status leaderboard-loading-shell__status" role="status" aria-live="polite">
      {t("leaderboard.loadingLatest")}
    </span>
  ) : statusMessage ? (
    <span className="leaderboard-refresh-status" data-tone={statusTone} role="status" aria-live="polite" title={statusMessage}>
      {statusMessage}
    </span>
  ) : null;

  return (
    <section className={`leaderboard-board-block${hasPagination ? " leaderboard-board-block--paginated" : ""}`} aria-label={t("leaderboard.globalAria")} aria-busy={isLoading || undefined}>
      <LeaderboardToolbar
        activePeriod={activePeriod}
        isEmpty={!isLoading && leaderboard.length === 0}
        isLoading={isLoading}
        participantCount={participantCount}
        searchQuery={searchQuery}
        scopeLabel={scopeLabel}
        searchScope={searchScope}
        status={status}
        statusInListHead={statusInListHead}
        topScopeFocusSeconds={topScopeFocusSeconds}
        onPeriodChange={onPeriodChange}
        onSearchQueryChange={onSearchQueryChange}
      />

      {isLoading ? (
        <LeaderboardLoadingRankList activePeriod={activePeriod} isSplitPreview={isSplitPreview} status={status} />
      ) : leaderboard.length === 0 ? (
        <div className="leaderboard-board__state">
          <StateBlock
            eyebrow={t("leaderboard.waitingEntries")}
            title={t("leaderboard.noParticipants")}
            detail={t("leaderboard.noParticipantsDetail")}
          />
        </div>
      ) : filteredLeaderboard.length === 0 ? (
        <div className="leaderboard-board__state">
          <StateBlock
            eyebrow={t("leaderboard.noMatch")}
            title={t("leaderboard.noMatchTitle")}
            detail={t("leaderboard.noMatchDetail", { scope: searchScope })}
          />
        </div>
      ) : (
        <>
          <LeaderboardRankList
            activePeriod={activePeriod}
            currentUserRank={currentUserRank}
            frameRef={listFrameRef}
            isSplitPreview={isSplitPreview}
            isOptedIn={isOptedIn}
            rows={pageRows}
            status={status}
            onSelectProfile={onSelectProfile}
          />
          <nav className="leaderboard-pagination" aria-label={t("leaderboard.pagesAria")}>
            <span className="leaderboard-pagination__summary" aria-live="polite">
              {searchQuery.trim()
                ? t("leaderboard.showingMatches", { first: firstVisible, last: lastVisible, matches: filteredLeaderboard.length, scope: searchScope })
                : t("leaderboard.showing", { first: firstVisible, last: lastVisible, total: loadedCount })}
            </span>
            <span className="leaderboard-pagination__position">{t("leaderboard.pagePosition", { current: safePageIndex + 1, total: totalPages })}</span>
            <div className="leaderboard-pagination__actions">
              <button
                type="button"
                className="app-btn app-btn--quiet app-btn--compact"
                aria-label={t("leaderboard.previousPage")}
                title={t("leaderboard.previousPage")}
                disabled={safePageIndex === 0}
                onClick={() => moveToPage(safePageIndex - 1)}
              >
                <PaginationArrowIcon direction="previous" />
              </button>
              <button
                type="button"
                className="app-btn app-btn--quiet app-btn--compact"
                aria-label={t("leaderboard.nextPage")}
                title={t("leaderboard.nextPage")}
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
  isEmpty,
  isLoading,
  participantCount,
  searchQuery,
  scopeLabel,
  searchScope,
  status,
  statusInListHead,
  topScopeFocusSeconds,
  onPeriodChange,
  onSearchQueryChange,
}: {
  readonly activePeriod: LeaderboardPeriod;
  readonly isEmpty: boolean;
  readonly isLoading: boolean;
  readonly participantCount: number | null;
  readonly searchQuery: string;
  readonly scopeLabel: string;
  readonly searchScope: string;
  readonly status: ReactNode;
  readonly statusInListHead: boolean;
  readonly topScopeFocusSeconds: number;
  readonly onPeriodChange?: (period: LeaderboardPeriod) => void;
  readonly onSearchQueryChange: (query: string) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <div className="leaderboard-toolbar">
      <div className="leaderboard-toolbar__control-row">
        <div className="leaderboard-period-control seg" role="group" aria-label={t("leaderboard.periodAria")} aria-hidden={isLoading || undefined}>
          {leaderboardPeriodOptions.map((item) => (
            <button
              key={item.period}
              type="button"
              className={activePeriod === item.period ? "on" : undefined}
              aria-pressed={activePeriod === item.period}
              disabled={isLoading}
              onClick={() => onPeriodChange?.(item.period)}
            >
              <span>{t(item.period === "daily" ? "leaderboard.daily" : item.period === "weekly" ? "leaderboard.weekly" : "leaderboard.monthly")}</span>
            </button>
          ))}
        </div>
        <div className={`leaderboard-toolbar__status-slot${statusInListHead ? " leaderboard-toolbar__status-slot--list-backed" : ""}`}>
          {status}
        </div>
      </div>
      <div className="leaderboard-toolbar__stats" aria-label={t("leaderboard.scopeAria")} aria-hidden={isLoading || undefined}>
        <div>
          <span className="label-mono">{t("leaderboard.participants")}</span>
          <strong>{isLoading
            ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value" />
            : participantCount?.toLocaleString(effectiveLanguage === "ko" ? "ko-KR" : "en-US") ?? "—"}</strong>
        </div>
        <div>
          <span className="label-mono">{scopeLabel === t("leaderboard.allRanked")
            ? t("leaderboard.totalFocus")
            : t("leaderboard.scopeFocus", { scope: scopeLabel })}</span>
          <strong>{isLoading ? <span className="leaderboard-loading-shell__bone leaderboard-loading-shell__toolbar-value leaderboard-loading-shell__toolbar-value--wide" /> : formatLocalizedDuration(topScopeFocusSeconds, effectiveLanguage)}</strong>
        </div>
      </div>
      <label className={`leaderboard-search${isLoading ? " leaderboard-search--loading" : ""}`} aria-hidden={isLoading || undefined}>
        <span className="sr-only">{t("leaderboard.searchAria")}</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          // An empty board has nothing to search, but a query left over from
          // another period must stay clearable.
          disabled={isLoading || (isEmpty && !searchQuery)}
          placeholder={t("leaderboard.search", { scope: searchScope })}
          type="search"
        />
      </label>
    </div>
  );
}

function LeaderboardLoadingRankList({ activePeriod, isSplitPreview, status }: { readonly activePeriod: LeaderboardPeriod; readonly isSplitPreview: boolean; readonly status: ReactNode }) {
  return (
    <div className={`leaderboard-list-frame${isSplitPreview && activePeriod === "daily" ? " leaderboard-list-frame--daily" : ""}`} aria-hidden={isSplitPreview ? undefined : "true"}>
      <LeaderboardListHeader activePeriod={activePeriod} isSplitPreview={isSplitPreview} status={status} />
      <ol className="leaderboard-list" aria-hidden={isSplitPreview ? "true" : undefined}>
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

function LeaderboardListHeader({ activePeriod, isSplitPreview, status }: { readonly activePeriod: LeaderboardPeriod; readonly isSplitPreview: boolean; readonly status: ReactNode }) {
  const { t } = useLocalization();
  if (isSplitPreview) {
    return (
      <div className={`leaderboard-list-head${activePeriod === "daily" ? " leaderboard-list-head--daily" : ""}`}>
        <span className="leaderboard-list-head__status">{status}</span>
        <div className="leaderboard-list-head__metrics" aria-hidden="true">
          <span>{t("leaderboard.focusTime")}</span>
          {activePeriod !== "daily" ? <span>{t("leaderboard.dailyAverage")}</span> : null}
        </div>
        <span className="leaderboard-list-head__spacer" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div className={`leaderboard-list-head${activePeriod === "daily" ? " leaderboard-list-head--daily" : ""}`} aria-hidden="true">
      <span>{t("leaderboard.participant")}</span>
      <span>{t("leaderboard.focusTime")}</span>
      {activePeriod !== "daily" ? <span>{t("leaderboard.dailyAverage")}</span> : null}
    </div>
  );
}

function LeaderboardRankList({
  activePeriod,
  currentUserRank,
  frameRef,
  isSplitPreview,
  isOptedIn,
  rows,
  status,
  onSelectProfile,
}: {
  readonly activePeriod: LeaderboardPeriod;
  readonly currentUserRank: number | null;
  readonly frameRef: React.RefObject<HTMLDivElement>;
  readonly isSplitPreview: boolean;
  readonly isOptedIn: boolean;
  readonly rows: readonly LeaderboardRow[];
  readonly status: ReactNode;
  readonly onSelectProfile?: (row: LeaderboardRow) => void;
}) {
  const { effectiveLanguage, t } = useLocalization();
  return (
    <div className={`leaderboard-list-frame${isSplitPreview && activePeriod === "daily" ? " leaderboard-list-frame--daily" : ""}`} ref={frameRef}>
      <LeaderboardListHeader activePeriod={activePeriod} isSplitPreview={isSplitPreview} status={status} />
      <ol className="leaderboard-list" aria-label={t("leaderboard.rankingsAria")}>
        {rows.map((row) => {
          const isCurrentUser = isOptedIn && row.rank === currentUserRank;
          const rankTone = row.rank <= 3 ? ` leaderboard-row--rank-${row.rank}` : "";
          return (
            <li className={`${isCurrentUser ? "leaderboard-row leaderboard-row--current" : "leaderboard-row"}${rankTone}`} key={`${row.rank}-${row.public_id ?? row.display_name}-${row.updated_at}`}>
              <button type="button" className="leaderboard-row__profile-button" onClick={() => onSelectProfile?.(row)} aria-label={t("leaderboard.viewProfileAria", { name: row.display_name })}>
                <div className="leaderboard-row__main">
                  <span className="leaderboard-row__rank">#{row.rank}</span>
                  <ProfileAvatar className="leaderboard-row__avatar" name={row.display_name} src={row.avatar_url} />
                  <div className="leaderboard-row__copy">
                    <strong>{row.display_name}</strong>
                    {isCurrentUser ? <span className="leaderboard-row__you">{t("leaderboard.you")}</span> : null}
                  </div>
                </div>
                <div className="leaderboard-row__meta leaderboard-row__meta--compact">
                  <div className="leaderboard-stat" aria-label={t("leaderboard.focusTimeAria", { duration: formatLocalizedDuration(row.focus_seconds_7d, effectiveLanguage) })}><strong>{formatLocalizedDuration(row.focus_seconds_7d, effectiveLanguage)}</strong></div>
                  {row.period !== "daily" ? (
                    <div className="leaderboard-stat" aria-label={t("leaderboard.dailyAverageAria", { duration: formatLocalizedDuration(getDailyAverageSeconds(row.focus_seconds_7d, row.period), effectiveLanguage) })}>
                      <strong>{formatLocalizedDuration(getDailyAverageSeconds(row.focus_seconds_7d, row.period), effectiveLanguage)}</strong>
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
