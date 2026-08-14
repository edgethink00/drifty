import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActivitySegment, AppIconMap } from "@drifty/domain";
import { buildHistoryDayGroups, buildHistoryRows, buildHistoryRowsWindow } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";
import { HistoryRow } from "./HistoryRow";
import { useModalDismiss } from "../../lib/useModalDismiss";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import "./history.css";

type HistoryViewProps = {
  readonly appIcons: AppIconMap;
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
        <h2 id="history-confirm-title">Delete history records?</h2>
        <p>
          This removes {recordCount} local activity {recordCount === 1 ? "record" : "records"} from this Mac.
        </p>
        <div className="history-confirm__actions">
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            data-history-confirm-cancel
            disabled={deleting}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} onClick={onConfirm}>
            Delete records
          </button>
        </div>
      </div>
    </div>
  );
}

export function HistoryView({
  appIcons,
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
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(HISTORY_RENDER_STEP);
  useModalDismiss(() => setConfirmOpen(false), { disabled: !confirmOpen || deleting });
  const query = searchQuery ?? uncontrolledQuery;
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

  const updateQuery = useCallback((nextQuery: string) => {
    if (onSearchQueryChange) onSearchQueryChange(nextQuery);
    else setUncontrolledQuery(nextQuery);
    setRenderLimit(HISTORY_RENDER_STEP);
  }, [onSearchQueryChange]);

  const recentHistoryWindow = useMemo(
    () => isSearching ? null : buildHistoryRowsWindow(segments, renderLimit),
    [isSearching, renderLimit, segments],
  );
  const searchableRows = useMemo(
    () => isSearching ? buildHistoryRows(segments) : EMPTY_HISTORY_ROWS,
    [isSearching, segments],
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

  const groups = useMemo(() => buildHistoryDayGroups(renderedRows, startOfDayMinutes), [renderedRows, startOfDayMinutes]);
  const selectedCount = selectedIds.size;
  const hasAnySegments = segments.length > 0;
  const showToolbar = hasAnySegments || isSearching;
  const deleteLabel = selectedCount === 1 ? "Delete 1 selected" : `Delete ${selectedCount} selected`;

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
    <section className={`history-view${showToolbar ? "" : " history-view--empty"}`} aria-label="History">
      {showToolbar ? (
        <div className="history-view__toolbar">
          <label className="history-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
              <circle cx="11" cy="11" r="6" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              type="search"
              aria-label="Search history"
              value={query}
              onChange={(event) => {
                updateQuery(event.target.value);
              }}
              placeholder="Search history"
            />
          </label>
          <button
            type="button"
            className="app-btn app-btn--danger"
            disabled={selectedCount === 0 || deleting}
            onClick={() => setConfirmOpen(true)}
          >
            {selectedCount === 0 ? "Delete selected" : deleteLabel}
          </button>
          {onOpenDeleteHistory ? (
            <button
              type="button"
              className="app-btn app-btn--danger"
              disabled={!hasAnySegments || deleting}
              onClick={onOpenDeleteHistory}
            >
              Delete history…
            </button>
          ) : null}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="history-empty" role="status">
          <strong>{initialLoading ? "Loading history records..." : "No history records found."}</strong>
          <span>
            {initialLoading
              ? "Searching local history."
              : query
                ? "Try another search."
                : "Activity appears here after the local tracker records segments."}
          </span>
        </div>
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
            <p className="history-loading-more" role="status">Loading older records...</p>
          ) : null}
          {loadMoreError ? (
            <>
              <p className="history-load-more-error" role="alert">{loadMoreError}</p>
              <button
                type="button"
                className="app-btn app-btn--secondary history-show-more"
                disabled={loadingMore}
                onClick={() => loadMore()}
              >
                Retry
              </button>
            </>
          ) : null}
          {hasMoreRows && !loadMoreError ? (
            <div ref={sentinelRef} className="history-scroll-sentinel" aria-hidden="true" />
          ) : null}
        </div>
      )}

      {confirmOpen ? (
        <HistoryDeleteConfirmation
          deleting={deleting}
          recordCount={selectedCount}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  );
}
