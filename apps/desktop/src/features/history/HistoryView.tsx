import { memo, useCallback, useMemo, useState } from "react";
import type { ActivitySegment, AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatCompactDurationFromSeconds, formatTimeLabel } from "../../lib/formatting";
import { buildHistoryDayGroups, buildHistoryRows, buildHistoryRowsWindow, historyRowTitle } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";

type HistoryViewProps = {
  readonly appIcons: AppIconMap;
  readonly deleting: boolean;
  readonly onDeleteSelected: (ids: readonly string[]) => Promise<void>;
  readonly segments: readonly ActivitySegment[];
  readonly startOfDayMinutes?: number;
};

// History loads ~90 days of segments (easily 10k+); rendering them all at once
// blocks the main thread, so the list grows in pages instead.
const HISTORY_RENDER_STEP = 200;
const EMPTY_HISTORY_ROWS: readonly HistoryRowModel[] = [];

export function HistoryView({ appIcons, deleting, onDeleteSelected, segments, startOfDayMinutes = 0 }: HistoryViewProps) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renderLimit, setRenderLimit] = useState(HISTORY_RENDER_STEP);
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;

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
      ? searchableRows.filter((row) => row.searchText.includes(normalizedQuery))
      : recentHistoryWindow?.rows ?? EMPTY_HISTORY_ROWS
  ), [isSearching, normalizedQuery, recentHistoryWindow, searchableRows]);

  const renderedRows = isSearching && visibleRows.length > renderLimit ? visibleRows.slice(0, renderLimit) : visibleRows;
  const hiddenCount = isSearching ? visibleRows.length - renderedRows.length : 0;
  const hasMoreRows = isSearching ? hiddenCount > 0 : recentHistoryWindow?.hasMore === true;
  const showMoreLabel = isSearching && hiddenCount > 0
    ? `Show more (${hiddenCount.toLocaleString("en-US")} older ${hiddenCount === 1 ? "record" : "records"})`
    : "Show more older records";

  const groups = useMemo(() => buildHistoryDayGroups(renderedRows, startOfDayMinutes), [renderedRows, startOfDayMinutes]);
  const selectedCount = selectedIds.size;
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
    <section className="history-view" aria-label="History">
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
              setQuery(event.target.value);
              setRenderLimit(HISTORY_RENDER_STEP);
            }}
            placeholder="Search history"
          />
        </label>
        <button
          type="button"
          className="settings-btn settings-btn--danger"
          disabled={selectedCount === 0 || deleting}
          onClick={() => setConfirmOpen(true)}
        >
          {selectedCount === 0 ? "Delete selected" : deleteLabel}
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="history-empty" role="status">
          <strong>No history records found.</strong>
          <span>{query ? "Try another search." : "Activity appears here after the local tracker records segments."}</span>
        </div>
      ) : (
        <div className="history-groups">
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
          {hasMoreRows ? (
            <button
              type="button"
              className="settings-btn history-show-more"
              onClick={() => setRenderLimit((current) => current + HISTORY_RENDER_STEP)}
            >
              {showMoreLabel}
            </button>
          ) : null}
        </div>
      )}

      {confirmOpen ? (
        <div className="history-confirm" role="dialog" aria-modal="true" aria-labelledby="history-confirm-title">
          <div className="history-confirm__panel">
            <h2 id="history-confirm-title">Delete history records?</h2>
            <p>
              This removes {selectedCount} local activity {selectedCount === 1 ? "record" : "records"} from this Mac.
            </p>
            <div className="history-confirm__actions">
              <button type="button" className="settings-btn" disabled={deleting} onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="settings-btn settings-btn--danger" disabled={deleting} onClick={() => void confirmDelete()}>
                Delete records
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const HistoryRow = memo(function HistoryRow({
  appIcons,
  onSelectedChange,
  row,
  selected,
}: {
  readonly appIcons: AppIconMap;
  readonly onSelectedChange: (segmentIds: readonly string[], selected: boolean) => void;
  readonly row: HistoryRowModel;
  readonly selected: boolean;
}) {
  const title = historyRowTitle(row);
  const iconKey = row.bundleId ?? row.appName;
  const classification = row.classification;

  return (
    <article className="history-row" data-selected={selected ? "true" : "false"}>
      <label className="history-row__check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${title}`}
          onChange={(event) => onSelectedChange(row.segmentIds, event.target.checked)}
        />
      </label>
      <div className="history-row__time">
        <span>{formatTimeLabel(row.startedAt)} - {formatTimeLabel(row.endedAt)}</span>
        <strong>{formatCompactDurationFromSeconds(row.durationSeconds)}</strong>
      </div>
      <div className="history-row__identity">
        {row.siteDomain ? (
          <SiteFavicon domain={row.siteDomain} size={20} fallbackIconSrc={appIcons[iconKey] ?? null} />
        ) : (
          <AppGlyph appName={row.appName} iconSrc={appIcons[iconKey] ?? null} size="sm" />
        )}
        <div>
          <strong>{title}</strong>
          <span>{row.siteDomain ?? row.appName}</span>
        </div>
      </div>
      <div className="history-row__category" aria-label={`${classification.categoryLabel} category`}>
        <span>{classification.categoryLabel}</span>
        <span className={`category-dot category-dot--${classification.category}`} aria-hidden="true" />
      </div>
    </article>
  );
});
