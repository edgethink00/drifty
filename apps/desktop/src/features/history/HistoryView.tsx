import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySegment, AppIconMap, ClassificationOptions } from "@drifty/domain";
import { buildHistoryDayGroups, buildHistoryRows, buildHistoryRowsWindow } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";
import { HistoryRow } from "./HistoryRow";
import { ModalPresence } from "../../components/ModalPresence";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import "./history.css";
import { useLocalization } from "../localization/LocalizationContext";

type HistoryViewProps = {
  readonly appIcons: AppIconMap;
  readonly classificationOptions?: ClassificationOptions;
  readonly deleting: boolean;
  readonly hasMoreSegments?: boolean;
  readonly initialLoading?: boolean;
  readonly loadMoreError?: string | null;
  readonly loadingMore?: boolean;
  readonly onDeleteSelected: (ids: readonly string[]) => Promise<void>;
  readonly onLoadMore?: () => Promise<void> | void;
  readonly onOpenDeleteHistory?: () => void;
  readonly onSearchQueryChange?: (query: string) => void;
  readonly searchQuery?: string;
  readonly searchUsesBackend?: boolean;
  readonly segments: readonly ActivitySegment[];
  readonly startOfDayMinutes?: number;
};

const HISTORY_RENDER_STEP = 200;
const EMPTY_HISTORY_ROWS: readonly HistoryRowModel[] = [];

type HistoryDeleteConfirmationProps = {
  readonly deleting: boolean;
  readonly recordCount: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

function HistoryDeleteConfirmation({ deleting, recordCount, onCancel, onConfirm }: HistoryDeleteConfirmationProps) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-history-confirm-cancel]" });

  return (
    <div
      ref={dialogRef}
      className="history-confirm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="history-confirm-title"
      tabIndex={-1}
    >
      <div className="history-confirm__panel modal-shell" data-modal-variant="compact">
        <h2 id="history-confirm-title">{t("history.deleteConfirmTitle")}</h2>
        <p>{t(recordCount === 1 ? "history.deleteConfirmDetailSingle" : "history.deleteConfirmDetail", { count: recordCount })}</p>
        <div className="history-confirm__actions">
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            data-history-confirm-cancel
            disabled={deleting}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} onClick={onConfirm}>
            {t("history.deleteRecords")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HistoryView({
  appIcons,
  classificationOptions,
  deleting,
  hasMoreSegments = false,
  initialLoading = false,
  loadMoreError = null,
  loadingMore = false,
  onDeleteSelected,
  onLoadMore,
  onOpenDeleteHistory,
  onSearchQueryChange,
  searchQuery,
  searchUsesBackend = false,
  segments,
  startOfDayMinutes = 0,
}: HistoryViewProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(HISTORY_RENDER_STEP);
  const query = searchQuery ?? uncontrolledQuery;
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const updateQuery = useCallback((nextQuery: string) => {
    if (onSearchQueryChange) onSearchQueryChange(nextQuery);
    else setUncontrolledQuery(nextQuery);
    setRenderLimit(HISTORY_RENDER_STEP);
  }, [onSearchQueryChange]);

  const recentHistoryWindow = useMemo(
    () => isSearching ? null : buildHistoryRowsWindow(segments, renderLimit, classificationOptions),
    [classificationOptions, isSearching, renderLimit, segments],
  );
  const searchableRows = useMemo(
    () => isSearching ? buildHistoryRows(segments, classificationOptions) : EMPTY_HISTORY_ROWS,
    [classificationOptions, isSearching, segments],
  );

  const visibleRows = useMemo(() => (
    isSearching
      ? searchUsesBackend
        ? searchableRows
        : searchableRows.filter((row) => row.searchText.includes(normalizedQuery))
      : recentHistoryWindow?.rows ?? EMPTY_HISTORY_ROWS
  ), [isSearching, normalizedQuery, recentHistoryWindow, searchableRows, searchUsesBackend]);

  const renderedRows = isSearching && visibleRows.length > renderLimit ? visibleRows.slice(0, renderLimit) : visibleRows;
  const hiddenCount = isSearching ? visibleRows.length - renderedRows.length : 0;
  const hasLocalRowsToReveal = isSearching ? hiddenCount > 0 : recentHistoryWindow?.hasMore === true;
  const canLoadBackendRows = (!isSearching || searchUsesBackend) && !hasLocalRowsToReveal && hasMoreSegments && onLoadMore !== undefined;
  const hasMoreRows = hasLocalRowsToReveal || canLoadBackendRows;

  // Auto-load the next page once the user scrolls near the bottom, like a
  // browser history list. Reveals locally buffered rows and, when those run out,
  // pulls the next cursor page from the backend (guarded against re-entry there).
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(() => {
    setRenderLimit((current) => current + HISTORY_RENDER_STEP);
    if (canLoadBackendRows) void onLoadMore?.();
  }, [canLoadBackendRows, onLoadMore]);

  const retryFailedLoad = useCallback(() => {
    void onLoadMore?.();
  }, [onLoadMore]);

  useEffect(() => {
    if (!hasMoreRows || loadMoreError) return;
    if (typeof IntersectionObserver === "undefined") return;
    const root = scrollRootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (loadingMore) return;
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { root, rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
    // renderedRows.length re-arms the observer after each reveal so a tall
    // viewport keeps filling until the sentinel is pushed out of view.
  }, [hasMoreRows, loadMoreError, loadingMore, loadMore, renderedRows.length]);

  const groups = useMemo(() => buildHistoryDayGroups(renderedRows, startOfDayMinutes, effectiveLanguage), [effectiveLanguage, renderedRows, startOfDayMinutes]);
  const selectedCount = selectedIds.size;
  const hasAnySegments = segments.length > 0;
  const showToolbar = hasAnySegments || isSearching;
  const deleteLabel = t("history.deleteSelectedCount", { count: selectedCount });

  const toggleRow = useCallback((segmentIds: readonly string[], selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const segmentId of segmentIds) {
        if (selected) next.add(segmentId);
        else next.delete(segmentId);
      }
      return next;
    });
  }, []);

  async function confirmDelete() {
    const ids = Array.from(selectedIds);
    await onDeleteSelected(ids);
    setSelectedIds(new Set());
    setConfirmOpen(false);
  }

  return (
    <section className={`history-view${showToolbar ? "" : " history-view--empty"}`} aria-label={t("history.label")}>
      {showToolbar ? (
        <div className="history-view__toolbar">
          <label className="history-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              aria-label={t("history.search")}
              value={query}
              onChange={(event) => {
                updateQuery(event.target.value);
              }}
              placeholder={t("history.search")}
            />
          </label>
          {selectedCount > 0 ? (
            <button
              type="button"
              className="app-btn app-btn--danger"
              disabled={deleting}
              onClick={() => setConfirmOpen(true)}
            >
              {deleteLabel}
            </button>
          ) : null}
          {onOpenDeleteHistory ? (
            <button
              type="button"
              className="app-btn app-btn--secondary history-delete-all"
              disabled={!hasAnySegments || deleting}
              onClick={onOpenDeleteHistory}
            >
              {t("history.deleteAll")}
            </button>
          ) : null}
        </div>
      ) : null}

      {groups.length === 0 ? (
        loadMoreError && !initialLoading ? (
          <div className="history-empty">
            <p className="history-load-more-error" role="alert">{loadMoreError}</p>
            <button
              type="button"
              className="app-btn app-btn--secondary history-show-more"
              disabled={loadingMore}
              onClick={retryFailedLoad}
            >
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <div className="history-empty" role="status">
            <strong>{initialLoading ? t("history.loading") : t("history.empty")}</strong>
            <span>
              {initialLoading
                ? t("history.searching")
                : query
                  ? t("history.tryAnother")
                  : t("history.emptyDetail")}
            </span>
          </div>
        )
      ) : (
        <div className="history-groups" ref={scrollRootRef}>
          {groups.map((group) => (
            <section className="history-group" key={group.dayKey} aria-labelledby={`history-day-${group.dayKey}`}>
              <h2 id={`history-day-${group.dayKey}`}>{group.label}</h2>
              <div className="history-list">
                {group.rows.map((row) => (
                  <HistoryRow
                    appIcons={appIcons}
                    key={row.id}
                    onSelectedChange={toggleRow}
                    row={row}
                    selected={row.segmentIds.every((segmentId) => selectedIds.has(segmentId))}
                  />
                ))}
              </div>
            </section>
          ))}
          {loadingMore ? (
            <p className="history-loading-more" role="status">{t("history.loadingOlder")}</p>
          ) : null}
          {loadMoreError ? (
            <>
              <p className="history-load-more-error" role="alert">{loadMoreError}</p>
              <button
                type="button"
                className="app-btn app-btn--secondary history-show-more"
                disabled={loadingMore}
                onClick={retryFailedLoad}
              >
                {t("common.retry")}
              </button>
            </>
          ) : null}
          {hasMoreRows && !loadMoreError ? (
            <div ref={sentinelRef} className="history-scroll-sentinel" aria-hidden="true" />
          ) : null}
        </div>
      )}

      <ModalPresence
        onDismiss={() => setConfirmOpen(false)}
        dismissDisabled={deleting}
      >
        {confirmOpen ? (
          <HistoryDeleteConfirmation
            deleting={deleting}
            recordCount={selectedCount}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
