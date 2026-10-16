import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyHint } from "../../components/KeyHint";
import type { ActivitySegment, AppIconMap, ClassificationOptions, ExcludedAppRule } from "@drifty/domain";
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
import { trackerClient } from "../../lib/api/trackerClient";
import { AppGlyph } from "../../components/AppGlyph";
import { FloatingNoticePortal } from "../../components/FloatingNoticePortal";
import { useFloatingNotice } from "../../components/useFloatingNotice";
import "../settings/HistoryDeletionNotice.css";
import { ExcludedAppHistoryConfirmation } from "../settings/ExcludedAppHistoryConfirmation";
import { HistoryExcludeConfirmation } from "./HistoryExcludeConfirmation";
import {
  coveringExclusionRule,
  exclusionHistoryQuery,
  exclusionRuleFor,
  historyExclusionTarget,
  type HistoryExclusionOutcome,
  type HistoryExclusionRequest,
  type HistoryExclusionTarget,
} from "./historyExclusion";

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
  /**
   * Keeps a row's site or app out of history (the Settings exclusion list) and
   * optionally deletes its past records. Absent hides "Don't record" from the
   * row menu.
   */
  readonly onExcludeActivity?: (request: HistoryExclusionRequest) => Promise<HistoryExclusionOutcome>;
};

type ExcludeDialogState =
  | { readonly mode: "add"; readonly row: HistoryRowModel; readonly target: HistoryExclusionTarget }
  | { readonly mode: "past"; readonly row: HistoryRowModel; readonly rule: ExcludedAppRule; readonly count: number };

type ExclusionNoticeState = {
  readonly key: number;
  readonly title: string;
  readonly detail: string;
};

/** The short confirmation after a row's site or app was kept out, in the History deletion notice's frame. */
function HistoryExclusionNotice({ notice, onDismiss }: { readonly notice: ExclusionNoticeState; readonly onDismiss: () => void }) {
  const { t } = useLocalization();
  const floating = useFloatingNotice(onDismiss);
  const className = ["history-deletion-notice", floating.isLeaving ? "is-leaving" : floating.hasEntered ? "is-settled" : "is-entering", floating.isTimerPaused ? "is-paused" : ""].filter(Boolean).join(" ");
  if (typeof document === "undefined") return null;
  return <FloatingNoticePortal>
    <section ref={floating.rootRef} className={className} role="status" aria-atomic="true" aria-label={notice.title} {...floating.handlers}>
      <span className="history-deletion-notice__copy">
        <strong>{notice.title}</strong>
        <span>{notice.detail}</span>
      </span>
      <button className="history-deletion-notice__dismiss" type="button" aria-label={t("settings.deleteHistory.dismissNotice")} onClick={floating.requestLeave}>
        <svg className="history-deletion-notice__ring" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
          <circle className="history-deletion-notice__ring-track" cx="14" cy="14" r="11" />
          <circle className="history-deletion-notice__ring-progress" cx="14" cy="14" r="11" />
        </svg>
        <span className="history-deletion-notice__dismiss-icon" aria-hidden="true"><svg viewBox="0 0 16 16" focusable="false"><path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" /></svg></span>
      </button>
      <span className="sr-only" role="timer" aria-label={t("settings.deleteHistory.noticeTimer")} />
    </section>
  </FloatingNoticePortal>;
}

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
  onExcludeActivity,
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
  // The saved exclusion list, so a row whose site is already kept out offers
  // to delete its past records instead of adding the rule again.
  const [exclusionRules, setExclusionRules] = useState<readonly ExcludedAppRule[]>([]);
  const [excludeDialog, setExcludeDialog] = useState<ExcludeDialogState | null>(null);
  const [excludePastCount, setExcludePastCount] = useState<number | null | "error">(null);
  const [excludeSaving, setExcludeSaving] = useState(false);
  const [excludeError, setExcludeError] = useState<DescribedActionError | null>(null);
  const [exclusionNotice, setExclusionNotice] = useState<ExclusionNoticeState | null>(null);
  const excludeRequestRef = useRef(0);
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
  useEffect(() => {
    if (!onExcludeActivity) return undefined;
    let cancelled = false;
    void trackerClient.getExcludedApps().then((rules) => {
      if (!cancelled) setExclusionRules(rules);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [onExcludeActivity]);

  const excludeLabel = useCallback((row: HistoryRowModel) => {
    const target = historyExclusionTarget(row);
    if (!target) return null;
    const covering = coveringExclusionRule(exclusionRules, target);
    return covering
      ? t("history.rowMenu.deleteExcludedPast", { name: covering.name })
      : t("history.rowMenu.exclude", { name: target.name });
  }, [exclusionRules, t]);

  const openRowExclude = useCallback((row: HistoryRowModel) => {
    const target = historyExclusionTarget(row);
    if (!target) return;
    const request = ++excludeRequestRef.current;
    setExcludeError(null);
    const covering = coveringExclusionRule(exclusionRules, target);
    if (covering) {
      // Already kept out: the row can only offer to delete the past records
      // the rule did not stop. The confirmation names their count, so it opens
      // once the count arrives.
      void trackerClient.getExcludedAppHistoryCount(exclusionHistoryQuery(covering)).then(({ count }) => {
        if (excludeRequestRef.current === request) setExcludeDialog({ mode: "past", row, rule: covering, count });
      }).catch(() => {
        if (excludeRequestRef.current === request) {
          setExclusionNotice({ key: request, title: t("history.exclude.countErrorTitle"), detail: t("history.exclude.countError", { name: covering.name }) });
        }
      });
      return;
    }
    setExcludePastCount(null);
    setExcludeDialog({ mode: "add", row, target });
    void trackerClient.getExcludedAppHistoryCount(exclusionHistoryQuery(exclusionRuleFor(target))).then(({ count }) => {
      if (excludeRequestRef.current === request) setExcludePastCount(count);
    }).catch(() => {
      if (excludeRequestRef.current === request) setExcludePastCount("error");
    });
  }, [exclusionRules, t]);

  const rowMenu = useMemo<HistoryRowMenuActions>(() => ({
    onOpen: onOpenRecord,
    onDelete: openRowDelete,
    deleteDisabled: isDeleting || retryingRefresh,
    ...(onExcludeActivity ? { excludeLabel, onExclude: openRowExclude } : {}),
  }), [excludeLabel, isDeleting, onExcludeActivity, onOpenRecord, openRowDelete, openRowExclude, retryingRefresh]);

  function closeExcludeDialog() {
    if (excludeSaving) return;
    excludeRequestRef.current += 1;
    setExcludeDialog(null);
    setExcludeError(null);
  }

  async function confirmExclude(deletePast: boolean) {
    if (!excludeDialog || !onExcludeActivity || requestInFlight.current) return;
    const rule = excludeDialog.mode === "add" ? exclusionRuleFor(excludeDialog.target) : excludeDialog.rule;
    const save = excludeDialog.mode === "add";
    const deleting = excludeDialog.mode === "past" || deletePast;
    // Deleting the past records takes this row with them; focus continues from its neighbour.
    const rowIndex = renderedRows.findIndex((candidate) => candidate.id === excludeDialog.row.id);
    const neighbourRow = rowIndex < 0 ? undefined : renderedRows[rowIndex + 1] ?? renderedRows[rowIndex - 1];
    requestInFlight.current = true;
    setExcludeSaving(true);
    setExcludeError(null);
    try {
      const outcome = await onExcludeActivity({ rule, save, deletePast: deleting });
      if (save) setExclusionRules((current) => [rule, ...current.filter((existing) => existing.id !== rule.id)]);
      setExcludeDialog(null);
      if (deleting) setFocusRowIdAfterDelete(neighbourRow?.id ?? null);
      if (outcome.refreshFailed) setRefreshFailed(true);
      const deletedDetail = t(outcome.deleted === 1 ? "history.exclude.noticeDeletedOne" : "history.exclude.noticeDeleted", { count: outcome.deleted });
      setExclusionNotice({
        key: Date.now(),
        title: t(save ? "history.exclude.noticeTitle" : "history.exclude.noticePastTitle", { name: rule.name }),
        detail: deleting ? deletedDetail : t("history.exclude.noticeKept"),
      });
    } catch (failure) {
      setExcludeError(describeActionError(failure, t(deleting && !save ? "settings.privacy.excludedAppsError.delete" : "history.exclude.error")));
    } finally {
      setExcludeSaving(false);
      requestInFlight.current = false;
    }
  }

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

      {/* Both confirmations own their dismissal, as they do in Settings. */}
      <ModalPresence>
        {excludeDialog?.mode === "add" ? (
          <HistoryExcludeConfirmation
            key={excludeDialog.row.id}
            target={excludeDialog.target}
            icon={excludeDialog.target.kind === "site"
              // The lettered mark the Settings list shows for this rule.
              ? <span className="site-favicon site-favicon--fallback" style={{ width: 24, height: 24 }}>{excludeDialog.target.name[0]?.toUpperCase() ?? "•"}</span>
              : <AppGlyph appName={excludeDialog.row.appName} iconSrc={appIcons[excludeDialog.row.bundleId ?? excludeDialog.row.appName] ?? null} size="sm" />}
            pastCount={excludePastCount}
            saving={excludeSaving}
            error={excludeError}
            onCancel={closeExcludeDialog}
            onConfirm={(deletePast) => void confirmExclude(deletePast)}
          />
        ) : excludeDialog?.mode === "past" ? (
          <ExcludedAppHistoryConfirmation
            appName={excludeDialog.rule.name}
            count={excludeDialog.count}
            deleting={excludeSaving}
            error={excludeError}
            onCancel={closeExcludeDialog}
            onConfirm={() => void confirmExclude(true)}
          />
        ) : null}
      </ModalPresence>
      {exclusionNotice ? (
        <HistoryExclusionNotice key={exclusionNotice.key} notice={exclusionNotice} onDismiss={() => setExclusionNotice(null)} />
      ) : null}
    </section>
  );
}
