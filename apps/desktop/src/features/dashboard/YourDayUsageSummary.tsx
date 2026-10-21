import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import type { AppUsagePanelProps } from "./AppUsagePanel";

/**
 * Most used, as a Breakdown block: the same ranked apps and sites the Most
 * used panel lists, cut to the rail. Carried over from the 2026-10-14
 * side-ranking draft.
 */
export function YourDayUsageSummary({ items, appIcons, totalSeconds }: Pick<AppUsagePanelProps, "items" | "appIcons" | "totalSeconds">) {
  const { effectiveLanguage, t } = useLocalization();
  const ranked = items.slice().sort((a, b) => a.rank - b.rank || b.totalSeconds - a.totalSeconds).slice(0, 5);
  return (
    <section className="week-v2-side-card your-day-usage" aria-label={t("dashboard.today.rankedUsage")}>
      <div className="flow-compact-split-chart__head">
        <span className="label-mono">{t("dashboard.today.apps")}</span>
        <strong>{formatLocalizedCompactDurationFromSeconds(totalSeconds, effectiveLanguage)}</strong>
      </div>
      {ranked.length ? (
        <ol className="your-day-usage__list">
          {ranked.map((item) => {
            const name = item.usageKind === "site" ? item.siteDomain ?? item.appName : item.appName;
            const icon = appIcons[item.bundleId ?? item.appName] ?? appIcons[item.appName] ?? null;
            return (
              <li key={item.rank + "-" + name}>
                <span className="your-day-usage__icon">
                  {item.usageKind === "site"
                    ? <SiteFavicon domain={item.siteDomain ?? name} size={20} fallbackIconSrc={icon} />
                    : <AppGlyph appName={name} iconSrc={icon} size="sm" />}
                </span>
                <span className="your-day-usage__name" title={name}>{name}</span>
                <span className="your-day-usage__duration">{formatLocalizedCompactDurationFromSeconds(item.totalSeconds, effectiveLanguage)}</span>
              </li>
            );
          })}
        </ol>
      ) : <p className="your-day-usage__empty">{t("dashboard.today.noAppUsage")}</p>}
    </section>
  );
}
