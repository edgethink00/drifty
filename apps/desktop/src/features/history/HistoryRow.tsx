import { memo } from "react";
import { isExcludedSegment, type AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactTimeRange } from "../../lib/formatting";
import { historyRowTitle } from "./historyGroups";
import type { HistoryRow as HistoryRowModel } from "./historyGroups";
import { excludedActivityLabel, localizedCategoryLabel } from "../localization/activityTranslations";
import { useLocalization } from "../localization/LocalizationContext";
import { HistoryRowMenu, type HistoryRowMenuActions } from "./HistoryRowMenu";
import { HistoryPageLink } from "./HistoryPageLink";

type HistoryRowProps = {
  readonly appIcons: AppIconMap;
  /** The record History came back to; marked briefly. */
  readonly located?: boolean;
  /** The row's options menu; absent hides it. */
  readonly menu?: HistoryRowMenuActions;
  /** A destination agreed by all the underlying records, independent of display grouping. */
  readonly pageUrl?: string | null;
  readonly onSelectedChange: (segmentIds: readonly string[], selected: boolean) => void;
  readonly row: HistoryRowModel;
  readonly selected: boolean;
};

export const HistoryRow = memo(function HistoryRow({
  appIcons,
  located = false,
  onSelectedChange,
  row,
  selected,
  menu,
  pageUrl,
}: HistoryRowProps) {
  const { effectiveLanguage, t } = useLocalization();
  const title = isExcludedSegment(row) ? excludedActivityLabel(row.exclusionSource, t) : historyRowTitle(row);
  const iconKey = row.bundleId ?? row.appName;
  const classification = row.classification;
  const category = localizedCategoryLabel(classification.category, t);
  const isExcluded = isExcludedSegment(row);

  return (
    // Links and checkboxes have separate targets; the remaining row selects it.
    <div className="history-row-shell" data-row-id={row.id} data-has-menu={menu ? "true" : undefined}>
    <div
      className="history-row"
      onClick={(event) => {
        if (!(event.target instanceof Element) || event.target.closest("a, button, input")) return;
        onSelectedChange(row.segmentIds, !selected);
      }}
      data-selected={selected ? "true" : "false"}
      data-located={located ? "true" : undefined}
    >
      <span className="history-row__check">
        <input
          type="checkbox"
          checked={selected}
          aria-label={t("history.selectAria", { title })}
          onChange={(event) => onSelectedChange(row.segmentIds, event.target.checked)}
        />
      </span>
      <div className="history-row__time">
        <span>{formatLocalizedCompactTimeRange(row.startedAt, row.endedAt, effectiveLanguage)}</span>
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
          <strong>{pageUrl && !isExcluded ? <HistoryPageLink title={title} url={pageUrl} /> : title}</strong>
          <span>{isExcluded ? t("settings.privacy.excludedAppsDesc") : pageUrl ? <>{new URL(pageUrl).host}<i className="history-page-path">{new URL(pageUrl).pathname === "/" ? "" : new URL(pageUrl).pathname}</i></> : (row.siteDomain ?? row.appName)}</span>
        </div>
      </div>
      <div className="history-row__category" aria-label={t("history.categoryAria", { category })}>
        <span>{category}</span>
        <span className={`category-dot category-dot--${classification.category}`} aria-hidden="true" />
      </div>
    </div>
    {menu ? <HistoryRowMenu actions={menu} canOpen={!isExcluded} row={row} title={title} /> : null}
    </div>
  );
});
