import { memo } from "react";
import { isExcludedSegment, type AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import { historyRowTitle } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";
import { excludedActivityLabel, localizedCategoryLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";

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
  const { effectiveLanguage, t } = useLocalization();
  const title = isExcludedSegment(row) ? excludedActivityLabel(row.exclusionSource, t) : historyRowTitle(row);
  const iconKey = row.bundleId ?? row.appName;
  const classification = row.classification;
  const category = localizedCategoryLabel(classification.category, t);
  const isExcluded = isExcludedSegment(row);

  return (
    <label className="history-row" data-selected={selected ? "true" : "false"}>
      <span className="history-row__check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={t("history.selectAria", { title })}
          onChange={(event) => onSelectedChange(row.segmentIds, event.target.checked)}
        />
      </span>
      <div className="history-row__time">
        <span>{formatLocalizedTimeLabel(row.startedAt, effectiveLanguage)} - {formatLocalizedTimeLabel(row.endedAt, effectiveLanguage)}</span>
        <strong>{formatLocalizedCompactDurationFromSeconds(row.durationSeconds, effectiveLanguage)}</strong>
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
          <span>{isExcluded ? t("settings.privacy.excludedAppsDesc") : (row.siteDomain ?? row.appName)}</span>
        </div>
      </div>
      <div className="history-row__category" aria-label={t("history.categoryAria", { category })}>
        <span>{category}</span>
        <span className={`category-dot category-dot--${classification.category}`} aria-hidden="true" />
      </div>
    </label>
  );
});
