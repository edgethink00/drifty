import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyHint } from "../../components/KeyHint";
import type { ActivitySegment, AppIconMap, ClassificationOptions } from "@drifty/domain";
import { buildHistoryDayGroups, buildHistoryRows, buildHistoryRowsWindow } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";
import { HistoryRow } from "./HistoryRow";
import type { HistoryRecordSurface, HistoryRowMenuActions } from "./HistoryRowMenu";
import { historyToolbarActionReserve } from "./historyToolbar";
import { ActionLabel } from "../../components/ActionLabel";
import { ModalPresence } from "../../components/ModalPresence";
import { useModalFocusTrap } from "../../lib/useModalFocusTrap";
import { useAnchoredDialog } from "../../lib/useAnchoredDialog";
import "./history.css";
import { useLocalization } from "../localization/LocalizationContext";
import type { HistoryDeletionResult } from "./historyDeletion";
import { describeActionError, type DescribedActionError } from "../../lib/actionErrors";

type HistoryViewProps = {
  readonly appIcons: AppIconMap;
  readonly classificationOptions?: ClassificationOptions;
  readonly deleting: boolean;
  readonly hasMoreSegments?: boolean;
  readonly initialLoading?: boolean;
  readonly loadMoreError?: string | null;
  /** The original wording behind `loadMoreError`, for hover and assistive technology. */
  readonly loadMoreErrorDetail?: string | null;
  readonly loadingMore?: boolean;
  readonly onDeleteSelected: (ids: readonly string[]) => Promise<HistoryDeletionResult | void>;
  readonly onRefreshAfterDelete?: () => Promise<void>;
  readonly onLoadMore?: () => Promise<void> | void;
  readonly onOpenDeleteHistory?: () => void;
  readonly onSearchQueryChange?: (query: string) => void;
  readonly searchQuery?: string;
  readonly searchUsesBackend?: boolean;
  readonly segments: readonly ActivitySegment[];
  readonly startOfDayMinutes?: number;
  /** Scrolls to and briefly marks the row holding this segment, once it renders. */
  readonly locateSegmentId?: string | null;
  /** Called when the mark has faded, or the search answered without the record. */
  readonly onLocateSettled?: () => void;
  /** Opens a record in Your Week or Your Day from its row menu. */
  readonly onOpenRecord?: (row: HistoryRowModel, surface: HistoryRecordSurface) => void;
};

const HISTORY_RENDER_STEP = 200;
const EMPTY_HISTORY_ROWS: readonly HistoryRowModel[] = [];
/** Matches the highlight in history.css, plus a short hold. */
const HISTORY_LOCATE_MARK_MS = 1800;

type HistoryDeleteConfirmationProps = {
  readonly deleting: boolean;
  readonly recordCount: number;
  readonly error: DescribedActionError | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

function HistoryDeleteConfirmation({ deleting, recordCount, error, onCancel, onConfirm }: HistoryDeleteConfirmationProps) {
  const { t } = useLocalization();
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalFocusTrap(dialogRef, { initialFocusSelector: "[data-history-confirm-cancel]" });
  useAnchoredDialog(panelRef);

  return (
    <div
      ref={dialogRef}
      className="history-confirm"
      role="dialog"
      aria-modal="true"
      aria-busy={deleting}
      aria-labelledby="history-confirm-title"
      tabIndex={-1}
    >
      <div ref={panelRef} className="history-confirm__panel modal-shell" data-modal-variant="compact">
        <h2 id="history-confirm-title">{t("history.deleteConfirmTitle")}</h2>
        {/* The outcome of a failed request takes the body line's place. Both are
            laid out in one cell, so the panel keeps the taller of the two and
            nothing below moves. */}
        <div className={`history-confirm__body${error ? " has-error" : ""}`}>
          <p>{t(recordCount === 1 ? "history.deleteConfirmDetailSingle" : "history.deleteConfirmDetail", { count: recordCount })}</p>
          {error ? <p className="history-confirm__error" role="alert" title={error.detail ?? undefined}>{error.message}{error.detail ? <span className="sr-only"> {error.detail}</span> : null}</p> : null}
        </div>
        {deleting ? <span className="action-status" role="status">{t("settings.deleteHistory.deleting")}</span> : null}
        <div className="history-confirm__actions">
          <button
            type="button"
            className="modal-btn modal-btn--ghost"
            data-history-confirm-cancel
            disabled={deleting}
            onClick={onCancel}
          >
            {t("common.cancel")}
            <KeyHint shortcut="escape" />
          </button>
          <button type="button" className="modal-btn modal-btn--danger" disabled={deleting} aria-busy={deleting} onClick={onConfirm}>
            <ActionLabel busy={deleting} busyLabel={t("settings.deleteHistory.deleting")}>{t("history.deleteRecords")}</ActionLabel>
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
  loadMoreErrorDetail = null,
  loadingMore = false,
  onDeleteSelected,
  onRefreshAfterDelete,
  onLoadMore,
  onOpenDeleteHistory,
  onSearchQueryChange,
  searchQuery,
  searchUsesBackend = false,
  segments,
  startOfDayMinutes = 0,
  locateSegmentId = null,
  onLocateSettled,
  onOpenRecord,
}: HistoryViewProps) {
  const { effectiveLanguage, t } = useLocalization();
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<DescribedActionError | null>(null);
  const [confirmDeleting, setConfirmDeleting] = useState(false);
  const [pendingRecordCount, setPendingRecordCount] = useState(0);
  // A row menu's delete confirms that row alone; the toolbar confirms the selection.
  const [rowDeleteIds, setRowDeleteIds] = useState<readonly string[] | null>(null);
  // After a row is deleted from its menu, focus continues from its neighbour.
  const [focusRowIdAfterDelete, setFocusRowIdAfterDelete] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [retryingRefresh, setRetryingRefresh] = useState(false);
  const requestInFlight = useRef(false);
  const isDeleting = deleting || confirmDeleting;
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

  const locatedRowId = useMemo(() => {
    if (!locateSegmentId) return null;
    return renderedRows.find((row) => row.segmentIds.includes(locateSegmentId))?.id ?? null;
  }, [locateSegmentId, renderedRows]);
  // The app re-renders on live ticks; a ref keeps that from restarting the mark's timer.
  const onLocateSettledRef = useRef(onLocateSettled);
  onLocateSettledRef.current = onLocateSettled;

  useEffect(() => {
    if (!locateSegmentId) return;
    if (locatedRowId === null) {
      // The search answered without that record: it was deleted, or no longer matches.
      if (!initialLoading && !loadingMore) onLocateSettledRef.current?.();
      return;
    }
    const locatedRow = scrollRootRef.current?.querySelector<HTMLElement>('[data-located="true"]');
    locatedRow?.scrollIntoView?.({ block: "center" });
    // Coming back from a calendar leaves focus on the page; continue from the
    // record instead, unless the user has already moved focus somewhere.
    if (!document.activeElement || document.activeElement === document.body) {
      locatedRow?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
    }
    const timeoutId = window.setTimeout(() => onLocateSettledRef.current?.(), HISTORY_LOCATE_MARK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [initialLoading, loadingMore, locateSegmentId, locatedRowId]);

  const selectedCount = selectedIds.size;
  const hasAnySegments = segments.length > 0;
  const showToolbar = hasAnySegments || isSearching;
  const deleteLabel = t("history.deleteSelectedCount", { count: selectedCount });
  const actionReserve = historyToolbarActionReserve(t);

  const openRowDelete = useCallback((row: HistoryRowModel) => {
    setDeleteError(null);
    setRowDeleteIds(row.segmentIds);
    setConfirmOpen(true);
  }, []);
  const rowMenu = useMemo<HistoryRowMenuActions>(() => ({
    onOpen: onOpenRecord,
    onDelete: openRowDelete,
    deleteDisabled: isDeleting || retryingRefresh,
  }), [isDeleting, onOpenRecord, openRowDelete, retryingRefresh]);

  useEffect(() => {
    if (!focusRowIdAfterDelete || confirmOpen) return;
    const shell = Array.from(scrollRootRef.current?.querySelectorAll<HTMLElement>("[data-row-id]") ?? [])
      .find((element) => element.dataset.rowId === focusRowIdAfterDelete);
    // The closing confirmation still holds focus while it fades, and its own
    // return target was the deleted row's button. Leave focus alone only if
    // the user already moved it somewhere else.
    const active = document.activeElement;
    if (!active || active === document.body || active.closest(".history-confirm")) {
      shell?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.focus({ preventScroll: true });
    }
    setFocusRowIdAfterDelete(null);
  }, [confirmOpen, focusRowIdAfterDelete]);

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
    const ids = rowDeleteIds ? [...rowDeleteIds] : Array.from(selectedIds);
    if (requestInFlight.current || ids.length === 0) return;
    requestInFlight.current = true;
    setConfirmDeleting(true);
    setDeleteError(null);
    setPendingRecordCount(ids.length);
    const deletedRowIndex = rowDeleteIds ? renderedRows.findIndex((row) => row.segmentIds.includes(ids[0]!)) : -1;
    const neighbourRow = deletedRowIndex < 0 ? undefined : renderedRows[deletedRowIndex + 1] ?? renderedRows[deletedRowIndex - 1];
    try {
      const result = await onDeleteSelected(ids);
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of ids) next.delete(id);
        return next;
      });
      setConfirmOpen(false);
      setFocusRowIdAfterDelete(neighbourRow?.id ?? null);
      setRefreshFailed(result?.refreshFailed ?? false);
    } catch (failure) {
      setDeleteError(describeActionError(failure, t("history.deleteError")));
    } finally {
      setConfirmDeleting(false);
      requestInFlight.current = false;
    }
  }

  async function retryRefreshAfterDelete() {
    if (!onRefreshAfterDelete || requestInFlight.current) return;
    requestInFlight.current = true;
    setRetryingRefresh(true);
    try {
      await onRefreshAfterDelete();
      setRefreshFailed(false);
    } catch {
      setRefreshFailed(true);
    } finally {
      setRetryingRefresh(false);
      requestInFlight.current = false;
    }
  }

  return (
    <section className={`history-view${showToolbar ? "" : " history-view--empty"}${refreshFailed ? " history-view--refresh-failed" : ""}`} aria-label={t("history.label")}>
      {refreshFailed ? (
        <div className="history-refresh-result" aria-busy={retryingRefresh}>
          <p role="alert">{t("history.deletedRefreshFailed")}</p>
          {onRefreshAfterDelete ? (
            <button type="button" className="app-btn app-btn--secondary" disabled={retryingRefresh} aria-busy={retryingRefresh} onClick={() => void retryRefreshAfterDelete()}>
              <ActionLabel busy={retryingRefresh} busyLabel={t("settings.deleteHistory.refreshing")}>{t("history.refreshView")}</ActionLabel>
            </button>
          ) : null}
        </div>
      ) : null}
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
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                updateQuery(event.target.value);
              }}
              placeholder={t("history.search")}
            />
          </label>
          {/* One slot: the selection's delete takes the place of "Delete
              history…" while rows are selected, and both labels are reserved,
              so the search field keeps its width as the selection comes and
              goes. "Delete history…" removes a date range, so a search that
              matches nothing does not disable it. */}
          {selectedCount > 0 ? (
            <button
              type="button"
              className="app-btn app-btn--danger history-toolbar-action"
              disabled={isDeleting || retryingRefresh}
              onClick={() => { setDeleteError(null); setRowDeleteIds(null); setConfirmOpen(true); }}
            >
              <ActionLabel busy={false} reserve={actionReserve}>{deleteLabel}</ActionLabel>
            </button>
          ) : onOpenDeleteHistory ? (
            <button
              type="button"
              className="app-btn app-btn--secondary history-delete-all history-toolbar-action"
              disabled={deleting}
              onClick={onOpenDeleteHistory}
            >
              <ActionLabel busy={false} reserve={actionReserve}>{t("history.deleteAll")}</ActionLabel>
            </button>
          ) : null}
        </div>
      ) : null}

      {groups.length === 0 ? (
        loadMoreError && !initialLoading ? (
          <div className="history-empty">
            <p className="history-load-more-error" role="alert" title={loadMoreErrorDetail ?? undefined}>{loadMoreError}{loadMoreErrorDetail ? <span className="sr-only"> {loadMoreErrorDetail}</span> : null}</p>
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
                    key={row.id}
                    appIcons={appIcons}
                    located={row.id === locatedRowId}
                    menu={rowMenu}
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
              <p className="history-load-more-error" role="alert" title={loadMoreErrorDetail ?? undefined}>{loadMoreError}{loadMoreErrorDetail ? <span className="sr-only"> {loadMoreErrorDetail}</span> : null}</p>
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
        dismissDisabled={isDeleting}
      >
        {confirmOpen ? (
          <HistoryDeleteConfirmation
            deleting={isDeleting}
            recordCount={confirmDeleting ? pendingRecordCount : rowDeleteIds?.length ?? selectedCount}
            error={deleteError}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => void confirmDelete()}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
