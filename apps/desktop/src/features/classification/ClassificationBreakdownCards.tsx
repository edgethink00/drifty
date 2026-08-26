import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatCategoryPercentage, productivityMixAriaLabel, usageItemLabel } from "./classificationViewData";
import type { CategoryBreakdownUsageItem, ClassificationCategoryBreakdown, TimelineItem } from "./classificationViewData";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import { formatCompactDurationFromSeconds, formatDuration } from "../../lib/formatting";
import type { AppIconMap, CategoryDuration } from "@drifty/domain";
import type { CSSProperties } from "react";
import "./classificationBreakdownCards.css";

export type CategoryBreakdownCardStyle = CSSProperties & {
  "--category-breakdown-tone": string;
};

export type ClassificationPanelStyle = CSSProperties & {
  "--classification-selected-tone": string;
};

export function recentSessionDisplayName(item: Pick<TimelineItem, "appName" | "siteDomain" | "siteTitle">) {
  return item.siteDomain ?? item.siteTitle ?? item.appName;
}

export function CategoryStat({ entry, showPercentage = false }: { entry: CategoryDuration; showPercentage?: boolean }) {
  const durationLabel = formatCompactDurationFromSeconds(entry.totalSeconds);

  return (
    <div className="category-stat">
      <div className="category-stat__label"><span className={`category-dot category-dot--${entry.category}`} aria-hidden="true" /><span>{categoryLabel(entry.category)}</span></div>
      {showPercentage ? <span className="category-stat__value"><strong>{durationLabel}</strong><small>{formatCategoryPercentage(entry.ratio * 100)}</small></span> : <strong>{durationLabel}</strong>}
    </div>
  );
}

export function ClassificationCategoryBreakdownCard({
  appIcons,
  breakdown,
}: {
  appIcons: AppIconMap;
  breakdown: ClassificationCategoryBreakdown;
}) {
  const label = categoryLabel(breakdown.category);
  const shareLabel = formatCategoryPercentage(breakdown.shareOfDay * 100);
  const style: CategoryBreakdownCardStyle = { "--category-breakdown-tone": CATEGORY_COLORS[breakdown.category] };
  const longestLabel = breakdown.longestSession ? recentSessionDisplayName(breakdown.longestSession) : "No session";
  const dominantSurfaceLabel = breakdown.dominantSurface ? usageItemLabel(breakdown.dominantSurface) : "No surface";

  return (
    <article className={`classification-category-card classification-category-card--${breakdown.category}`} style={style} aria-label={`${label} category breakdown`}>
      <div className="classification-category-card__header">
        <div className="classification-category-card__identity">
          <span className={`category-dot category-dot--${breakdown.category}`} aria-hidden="true" />
          <div>
            <span className="label-mono">Category</span>
            <h2>{label}</h2>
          </div>
        </div>
        <div className="classification-category-card__total">
          <strong>{formatDuration(breakdown.totalSeconds)}</strong>
          <span>{shareLabel} of selected day</span>
        </div>
      </div>

      <dl className="classification-category-card__stats">
        <div><dt>Sessions</dt><dd>{breakdown.sessionCount}</dd></div>
        <div><dt>Average</dt><dd>{formatCompactDurationFromSeconds(breakdown.averageSessionSeconds)}</dd></div>
        <div><dt>Longest</dt><dd>{breakdown.longestSession ? formatCompactDurationFromSeconds(breakdown.longestSession.durationSeconds) : "0"}<small>{longestLabel}</small></dd></div>
        <div><dt>Dominant</dt><dd>{breakdown.dominantSurface ? formatCategoryPercentage(breakdown.dominantSurface.shareOfTotal * 100) : "0%"}<small>{dominantSurfaceLabel}</small></dd></div>
      </dl>

      {breakdown.productivityMix.length > 0 ? (
        <div className="classification-category-card__productivity" aria-label={`${label} productivity mix`}>
          <div className="classification-category-card__section-head">
            <span className="label-mono">Productivity mix</span>
            <span>{breakdown.dominantProductivity ? productivityLabel(breakdown.dominantProductivity.productivity) : "No signal"}</span>
          </div>
          <div className="classification-category-card__mixbar" role="img" aria-label={productivityMixAriaLabel(label, breakdown.productivityMix)}>
            {breakdown.productivityMix.map((entry) => (
              <span
                key={entry.productivity}
                style={{ width: `${Math.max(entry.ratio * 100, entry.totalSeconds > 0 ? 3 : 0)}%`, background: PRODUCTIVITY_COLORS[entry.productivity] }}
                title={`${productivityLabel(entry.productivity)} · ${formatCompactDurationFromSeconds(entry.totalSeconds)} · ${formatCategoryPercentage(entry.ratio * 100)}`}
              />
            ))}
          </div>
          <div className="classification-category-card__mixlegend" aria-hidden="true">
            {breakdown.productivityMix.map((entry) => (
              <span key={entry.productivity}>
                <span className={`productivity-dot productivity-dot--${entry.productivity}`} />
                {productivityLabel(entry.productivity)}
                <strong>{formatCategoryPercentage(entry.ratio * 100)}</strong>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="classification-category-card__sources">
        <CategoryUsageList appIcons={appIcons} emptyLabel="No app captures" items={breakdown.topApps} label="Apps" />
        <CategoryUsageList appIcons={appIcons} emptyLabel="No browser context" items={breakdown.topSites} label="Sites" />
      </div>

    </article>
  );
}

export function CategoryUsageList({
  appIcons,
  emptyLabel,
  items,
  label,
}: {
  appIcons: AppIconMap;
  emptyLabel: string;
  items: CategoryBreakdownUsageItem[];
  label: string;
}) {
  return (
    <div className="category-usage-list">
      <div className="classification-category-card__section-head">
        <span className="label-mono">{label}</span>
        <span>{items.length > 0 ? `${items.length} tracked` : emptyLabel}</span>
      </div>
      {items.length > 0 ? (
        <ol aria-label={`${label} usage`} role="list">
          {items.map((item) => {
            const displayName = usageItemLabel(item);
            const iconSrc = item.bundleId ? appIcons[item.bundleId] ?? null : appIcons[item.appName] ?? null;
            return (
              <li key={`${item.usageKind}-${item.siteDomain ?? item.bundleId ?? item.appName}`}>
                <div className="category-usage-list__identity">
                  {item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={displayName} iconSrc={iconSrc} size="sm" />}
                  <div>
                    <strong>{displayName}</strong>
                    <span>{item.sessionCount} {item.sessionCount === 1 ? "session" : "sessions"} · {formatCompactDurationFromSeconds(item.averageSessionSeconds)} avg</span>
                  </div>
                </div>
                <div className="category-usage-list__measure">
                  <strong>{formatCompactDurationFromSeconds(item.totalSeconds)}</strong>
                  <span>{formatCategoryPercentage(item.shareOfTotal * 100)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="category-usage-list__empty">{emptyLabel}</p>
      )}
    </div>
  );
}
