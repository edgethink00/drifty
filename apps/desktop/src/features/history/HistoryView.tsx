import { useMemo, useState } from "react";
import { classifyActivityDetailed } from "@drifty/domain";
import type { ActivityCategory, ActivitySegment, AppIconMap, ProductivityLabel } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatTimeLabel } from "../../lib/formatting";

type HistoryViewProps = {
  readonly appIcons: AppIconMap;
  readonly deleting: boolean;
  readonly onDeleteSelected: (ids: readonly string[]) => Promise<void>;
  readonly segments: readonly ActivitySegment[];
};

type HistoryGroup = {
  readonly dayKey: string;
  readonly label: string;
  readonly segments: readonly ActivitySegment[];
};

type HistoryClassification = {
  readonly category: ActivityCategory;
  readonly productivity: ProductivityLabel;
  readonly categoryLabel: string;
  readonly productivityLabel: string;
};

const historyDayFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

export function HistoryView({ appIcons, deleting, onDeleteSelected, segments }: HistoryViewProps) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();

  const visibleSegments = useMemo(() => {
    const sortedSegments = [...segments].sort((left, right) => (
      new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime()
    ));
    if (!normalizedQuery) return sortedSegments;

    return sortedSegments.filter((segment) => historySearchText(segment).includes(normalizedQuery));
  }, [normalizedQuery, segments]);

  const groups = useMemo(() => groupHistorySegments(visibleSegments), [visibleSegments]);
  const selectedCount = selectedIds.size;
  const deleteLabel = selectedCount === 1 ? "Delete 1 selected" : `Delete ${selectedCount} selected`;

  function toggleSegment(segmentId: string, selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (selected) next.add(segmentId);
      else next.delete(segmentId);
      return next;
    });
  }

  async function confirmDelete() {
    const ids = Array.from(selectedIds);
    await onDeleteSelected(ids);
    setSelectedIds(new Set());
    setConfirmOpen(false);
  }

  return (
    <section className="history-view" aria-label="History">
      <header className="history-view__header">
        <div>
          <span className="eyebrow">Local records</span>
          <h1>History</h1>
        </div>
        <div className="history-view__actions">
          <button
            type="button"
            className="settings-btn settings-btn--danger"
            disabled={selectedCount === 0 || deleting}
            onClick={() => setConfirmOpen(true)}
          >
            {selectedCount === 0 ? "Delete selected" : deleteLabel}
          </button>
        </div>
      </header>

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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search history"
          />
        </label>
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
                {group.segments.map((segment) => (
                  <HistoryRow
                    appIcons={appIcons}
                    key={segment.id}
                    onSelectedChange={toggleSegment}
                    segment={segment}
                    selected={selectedIds.has(segment.id)}
                  />
                ))}
              </div>
            </section>
          ))}
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

function HistoryRow({
  appIcons,
  onSelectedChange,
  segment,
  selected,
}: {
  readonly appIcons: AppIconMap;
  readonly onSelectedChange: (segmentId: string, selected: boolean) => void;
  readonly segment: ActivitySegment;
  readonly selected: boolean;
}) {
  const title = historyTitle(segment);
  const iconKey = segment.bundleId ?? segment.appName;
  const classification = historyClassification(segment);

  return (
    <article className="history-row" data-selected={selected ? "true" : "false"}>
      <label className="history-row__check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${title}`}
          onChange={(event) => onSelectedChange(segment.id, event.target.checked)}
        />
      </label>
      <div className="history-row__time">
        <span>{formatTimeLabel(segment.startedAt)} - {formatTimeLabel(segment.endedAt)}</span>
        <strong>{formatCompactDurationFromSeconds(segment.durationSeconds)}</strong>
      </div>
      <div className="history-row__identity">
        {segment.siteDomain ? (
          <SiteFavicon domain={segment.siteDomain} size={20} fallbackIconSrc={appIcons[iconKey] ?? null} />
        ) : (
          <AppGlyph appName={segment.appName} iconSrc={appIcons[iconKey] ?? null} size="sm" />
        )}
        <div>
          <strong>{title}</strong>
          <span>{segment.siteDomain ?? segment.appName}</span>
        </div>
      </div>
      <div className="history-row__category" aria-label={`${classification.categoryLabel} category`}>
        <span>{classification.categoryLabel}</span>
        <span className={`category-dot category-dot--${classification.category}`} aria-hidden="true" />
      </div>
    </article>
  );
}

function groupHistorySegments(segments: readonly ActivitySegment[]): readonly HistoryGroup[] {
  const groups = new Map<string, ActivitySegment[]>();
  for (const segment of segments) {
    const dayKey = segment.startedAt.slice(0, 10);
    const daySegments = groups.get(dayKey) ?? [];
    daySegments.push(segment);
    groups.set(dayKey, daySegments);
  }

  return Array.from(groups.entries()).map(([dayKey, daySegments]) => ({
    dayKey,
    label: historyDayFormatter.format(new Date(`${dayKey}T12:00:00`)),
    segments: daySegments,
  }));
}

function historySearchText(segment: ActivitySegment): string {
  const classification = historyClassification(segment);
  return [
    segment.appName,
    segment.browserName,
    segment.siteDomain,
    segment.siteTitle,
    segment.siteUrl,
    segment.windowTitle,
    classification.categoryLabel,
    classification.productivityLabel,
  ].filter(Boolean).join(" ").toLowerCase();
}

function historyTitle(segment: ActivitySegment): string {
  return segment.siteTitle ?? segment.windowTitle ?? segment.siteDomain ?? segment.appName;
}

function historyClassification(segment: ActivitySegment): HistoryClassification {
  const classification = segment.classification ?? classifyActivityDetailed(segment, { includeAiClassifications: false });
  return {
    category: classification.category,
    productivity: classification.productivity,
    categoryLabel: categoryLabel(classification.category),
    productivityLabel: productivityLabel(classification.productivity),
  };
}
