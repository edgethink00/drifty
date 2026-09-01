import type { CSSProperties } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { formatLocalizedDuration, formatLocalizedTimeLabel } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";

export type AppUsagePanelItem = {
  rank: number;
  appName: string;
  bundleId: string | null;
  usageKind: "app" | "site";
  siteDomain: string | null;
  siteTitle: string | null;
  browserName: string | null;
  totalSeconds: number;
  sessionCount: number;
  activeDays: number;
  averageSessionSeconds: number;
  shareOfTotal: number;
  firstStartedAt: string | null;
  lastEndedAt: string | null;
};

export type AppUsagePanelProps = {
  items: AppUsagePanelItem[];
  periodLabel: string;
  totalSeconds: number;
  appIcons: Record<string, string | null>;
  emptyDetail?: string;
  emptyPresentation?: "message" | "blank";
};

type ShareStyle = CSSProperties & {
  "--app-usage-share": string;
};

function formatEnglishDuration(totalSeconds: number): string {
  const roundedSeconds = Math.max(Math.round(totalSeconds), 0);
  if (roundedSeconds < 60) return `${roundedSeconds}s`;

  const totalMinutes = Math.round(roundedSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function normalizeShare(shareOfTotal: number): number {
  const percent = shareOfTotal <= 1 ? shareOfTotal * 100 : shareOfTotal;
  return Math.min(Math.max(percent, 0), 100);
}

function formatShare(shareOfTotal: number): string {
  const percent = normalizeShare(shareOfTotal);
  if (percent < 1 && percent > 0) return "<1%";
  return `${Math.round(percent)}%`;
}

function formatLastUsed(endedAt: string | null, language: "en" | "ko", t: ReturnType<typeof useLocalization>["t"]): string {
  if (!endedAt) return t("dashboard.today.lastUsedPending");

  const endedDate = new Date(endedAt);
  const today = new Date();
  const isToday = endedDate.toDateString() === today.toDateString();
  const label = isToday
    ? formatLocalizedTimeLabel(endedDate, language)
    : new Intl.DateTimeFormat(language === "ko" ? "ko-KR" : "en-US", { month: language === "ko" ? "long" : "short", day: "numeric" }).format(endedDate);
  return t("dashboard.today.lastUsed", { time: label });
}

function resolveIconSrc(item: AppUsagePanelItem, appIcons: Record<string, string | null>): string | null {
  if (item.usageKind === "site") return null;
  if (item.bundleId && appIcons[item.bundleId]) return appIcons[item.bundleId];
  return appIcons[item.appName] ?? null;
}

function displayName(item: AppUsagePanelItem): string {
  return item.usageKind === "site" ? item.siteDomain ?? item.siteTitle ?? item.appName : item.appName;
}

function formatUsageContext(item: AppUsagePanelItem, language: "en" | "ko", t: ReturnType<typeof useLocalization>["t"]): string {
  const lastUsed = formatLastUsed(item.lastEndedAt, language, t);
  if (item.usageKind !== "site") return lastUsed;

  const name = displayName(item);
  const title = item.siteTitle && item.siteTitle !== name ? item.siteTitle : null;
  const browser = item.browserName ? t("dashboard.today.via", { app: item.browserName }) : null;
  return [title, browser, lastUsed].filter(Boolean).join(" · ");
}

function UsageIdentityIcon({ item, iconSrc, size }: { item: AppUsagePanelItem; iconSrc: string | null; size: "sm" | "md" }) {
  const className = `usage-identity-icon usage-identity-icon--${size}`;

  if (item.siteDomain) {
    return (
      <span className={className}>
        <SiteFavicon domain={item.siteDomain} size={size === "md" ? 36 : 20} fallbackIconSrc={iconSrc} />
      </span>
    );
  }

  return (
    <span className={className}>
      <AppGlyph appName={displayName(item)} iconSrc={item.usageKind === "site" ? null : iconSrc} size={size} />
    </span>
  );
}

export function AppUsagePanel({
  items,
  periodLabel,
  appIcons,
  emptyDetail = "App rankings appear once tracked activity is available for this period.",
  emptyPresentation = "message",
}: AppUsagePanelProps) {
  const { effectiveLanguage, t } = useLocalization();
  const formatDuration = (seconds: number) => effectiveLanguage === "ko"
    ? formatLocalizedDuration(seconds, effectiveLanguage)
    : formatEnglishDuration(seconds);
  const formatSessionCount = (count: number) => effectiveLanguage === "ko"
    ? t("dashboard.today.sessionCount", { count })
    : `${count} ${count === 1 ? "session" : "sessions"}`;
  const rankedItems = items.slice().sort((left, right) => left.rank - right.rank || right.totalSeconds - left.totalSeconds);
  const primaryItem = rankedItems[0] ?? null;
  const secondaryItems = rankedItems.slice(1);
  const hasItems = rankedItems.length > 0;

  return (
    <section className="app-usage-panel editorial-panel editorial-panel--soft" aria-label={effectiveLanguage === "ko" ? t("dashboard.today.appUsageAria") : `App usage for ${periodLabel}`}>
      {hasItems && primaryItem ? (
        <div className="app-usage-content">
          <article
            className="app-usage-feature"
            style={{ "--app-usage-share": `${normalizeShare(primaryItem.shareOfTotal)}%` } as ShareStyle}
            aria-label={`${primaryItem.usageKind === "site" ? t("dashboard.today.mostUsedSite") : t("dashboard.today.mostUsedApp")}: ${displayName(primaryItem)}`}
          >
            <div className="app-usage-feature__topline">
              <div className="app-usage-feature__identity">
                <UsageIdentityIcon item={primaryItem} iconSrc={resolveIconSrc(primaryItem, appIcons)} size="md" />
                <div>
                  <span className="app-usage-kicker">{primaryItem.usageKind === "site" ? t("dashboard.today.mostUsedSite") : t("dashboard.today.mostUsedApp")}</span>
                  <div className="app-usage-feature__title">
                    <span className="app-usage-rank app-usage-rank--inline" aria-label={`Rank ${primaryItem.rank}`}>#{primaryItem.rank}</span>
                    <strong>{displayName(primaryItem)}</strong>
                  </div>
                  <p>{formatUsageContext(primaryItem, effectiveLanguage, t)}</p>
                </div>
              </div>
              <div className="app-usage-feature__measure">
                <strong>{formatDuration(primaryItem.totalSeconds)}</strong>
              </div>
            </div>
            <div className="app-usage-feature__meter-block">
              <div className="app-usage-feature__meter-copy">
                <span>{t("dashboard.today.shareMetric")}</span>
                <strong>{formatShare(primaryItem.shareOfTotal)}</strong>
              </div>
              <div className="app-usage-feature__meter" aria-label={effectiveLanguage === "ko" ? t("dashboard.today.usageShareAria", { percent: Math.round(normalizeShare(primaryItem.shareOfTotal)) }) : `${displayName(primaryItem)} accounts for ${formatShare(primaryItem.shareOfTotal)} of tracked time`}>
                <span />
              </div>
            </div>
            <dl className="app-usage-feature__stats">
              <div><dt>{t("dashboard.today.sessions")}</dt><dd>{primaryItem.sessionCount}</dd></div>
              <div><dt>{t("dashboard.today.average")}</dt><dd>{formatDuration(primaryItem.averageSessionSeconds)}</dd></div>
              <div><dt>{t("dashboard.today.days")}</dt><dd>{t("dashboard.today.dayCount", { count: primaryItem.activeDays })}</dd></div>
            </dl>
          </article>

          {secondaryItems.length > 0 ? (
            <ol className="app-usage-list" aria-label={t("dashboard.today.rankedUsage")}>
              {secondaryItems.map((item) => {
                const sharePercent = normalizeShare(item.shareOfTotal);
                const shareStyle: ShareStyle = { "--app-usage-share": `${sharePercent}%` };
                const iconSrc = resolveIconSrc(item, appIcons);
                const name = displayName(item);

                return (
                  <li className="app-usage-row" key={`${item.rank}-${item.usageKind}-${item.siteDomain ?? item.bundleId ?? item.appName}`}>
                    <div className="app-usage-rank" aria-label={`Rank ${item.rank}`}>
                      {item.rank.toString().padStart(2, "0")}
                    </div>
                    <div className="app-usage-row__main">
                      <UsageIdentityIcon item={item} iconSrc={iconSrc} size="sm" />
                      <div className="app-usage-row__copy">
                        <div className="app-usage-row__title">
                          <strong>{name}</strong>
                        </div>
                        <small>{formatUsageContext(item, effectiveLanguage, t)}</small>
                      </div>
                    </div>
                    <div className="app-usage-row__bar" aria-label={effectiveLanguage === "ko" ? t("dashboard.today.usageShareAria", { percent: Math.round(normalizeShare(item.shareOfTotal)) }) : `${name} accounts for ${formatShare(item.shareOfTotal)} of tracked time`}>
                      <span style={shareStyle} />
                    </div>
                    <div className="app-usage-row__figures">
                      <strong>{formatDuration(item.totalSeconds)}</strong>
                      <span>{formatShare(item.shareOfTotal)} · {formatSessionCount(item.sessionCount)} · {t("dashboard.today.averageValue", { duration: formatDuration(item.averageSessionSeconds) })}</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : emptyPresentation === "blank" ? (
        <div className="app-usage-empty app-usage-empty--blank" aria-label={effectiveLanguage === "ko" ? t("dashboard.today.noAppUsage") : `No app usage for ${periodLabel} yet`} />
      ) : (
        <div className="app-usage-empty empty-state">
          <span className="eyebrow">{t("dashboard.today.noUsage")}</span>
          <strong>{t("dashboard.today.usageQuiet")}</strong>
          <p>{effectiveLanguage === "ko" ? t("dashboard.today.usageEmptyDetail") : emptyDetail}</p>
        </div>
      )}
    </section>
  );
}
