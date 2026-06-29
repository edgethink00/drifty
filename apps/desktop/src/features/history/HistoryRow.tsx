import { memo } from "react";
import type { AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatCompactDurationFromSeconds, formatTimeLabel } from "../../lib/formatting";
import { historyRowTitle } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";

type HistoryRowProps = {
  readonly appIcons: AppIconMap;
  readonly onSelectedChange: (segmentIds: readonly string[], selected: boolean) => void;
  readonly row: HistoryRowModel;
  readonly selected: boolean;
};

export const HistoryRow = memo(function HistoryRow({
  appIcons,
  onSelectedChange,
  row,
  selected,
}: HistoryRowProps) {
  const title = historyRowTitle(row);
  const iconKey = row.bundleId ?? row.appName;
  const classification = row.classification;

  return (
    <label className="history-row" data-selected={selected ? "true" : "false"}>
      <span className="history-row__check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={`Select ${title}`}
          onChange={(event) => onSelectedChange(row.segmentIds, event.target.checked)}
        />
      </span>
      <div className="history-row__time">
        <span>{formatTimeLabel(row.startedAt)} - {formatTimeLabel(row.endedAt)}</span>
        <strong>{formatCompactDurationFromSeconds(row.durationSeconds)}</strong>
      </div>
      <div className="history-row__identity">
        <span className="usage-identity-icon usage-identity-icon--sm history-row__identity-icon">
          {row.siteDomain ? (
            <SiteFavicon domain={row.siteDomain} size={20} fallbackIconSrc={appIcons[iconKey] ?? null} />
          ) : (
            <AppGlyph appName={row.appName} iconSrc={appIcons[iconKey] ?? null} size="sm" />
          )}
        </span>
        <div className="history-row__identity-copy">
          <strong>{title}</strong>
          <span>{row.siteDomain ?? row.appName}</span>
        </div>
      </div>
      <div className="history-row__category" aria-label={`${classification.categoryLabel} category`}>
        <span>{classification.categoryLabel}</span>
        <span className={`category-dot category-dot--${classification.category}`} aria-hidden="true" />
      </div>
    </label>
  );
});
