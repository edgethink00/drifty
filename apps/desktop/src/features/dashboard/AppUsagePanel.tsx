import type { CSSProperties } from "react";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";

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
};

type ShareStyle = CSSProperties & {
  "--app-usage-share": string;
};

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatDuration(totalSeconds: number): string {
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

function formatLastUsed(endedAt: string | null): string {
  if (!endedAt) return "Last used pending";

  const endedDate = new Date(endedAt);
  const today = new Date();
  const isToday = endedDate.toDateString() === today.toDateString();
  return isToday ? `Last used ${timeFormatter.format(endedDate)}` : `Last used ${dateFormatter.format(endedDate)}`;
}

function formatSessionCount(count: number): string {
  return `${count} ${count === 1 ? "session" : "sessions"}`;
}

function resolveIconSrc(item: AppUsagePanelItem, appIcons: Record<string, string | null>): string | null {
  if (item.usageKind === "site") return null;
  if (item.bundleId && appIcons[item.bundleId]) return appIcons[item.bundleId];
  return appIcons[item.appName] ?? null;
}

function displayName(item: AppUsagePanelItem): string {
  return item.usageKind === "site" ? item.siteDomain ?? item.siteTitle ?? item.appName : item.appName;
}

function usageNoun(item: AppUsagePanelItem): "app" | "site" {
  return item.usageKind === "site" ? "site" : "app";
}

function formatUsageContext(item: AppUsagePanelItem): string {
  const lastUsed = formatLastUsed(item.lastEndedAt);
  if (item.usageKind !== "site") return lastUsed;

  const name = displayName(item);
  const title = item.siteTitle && item.siteTitle !== name ? item.siteTitle : null;
  const browser = item.browserName ? `via ${item.browserName}` : null;
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
}: AppUsagePanelProps) {
  const rankedItems = items.slice().sort((left, right) => left.rank - right.rank || right.totalSeconds - left.totalSeconds);
  const primaryItem = rankedItems[0] ?? null;
  const secondaryItems = rankedItems.slice(1);
  const hasItems = rankedItems.length > 0;

  return (
    <section className="app-usage-panel editorial-panel editorial-panel--soft" aria-label={`App usage for ${periodLabel}`}>
      {hasItems && primaryItem ? (
        <div className="app-usage-content">
          <article
            className="app-usage-feature"
            style={{ "--app-usage-share": `${normalizeShare(primaryItem.shareOfTotal)}%` } as ShareStyle}
            aria-label={`Most used ${usageNoun(primaryItem)}: ${displayName(primaryItem)}`}
          >
            <div className="app-usage-feature__topline">
              <div className="app-usage-feature__identity">
                <UsageIdentityIcon item={primaryItem} iconSrc={resolveIconSrc(primaryItem, appIcons)} size="md" />
                <div>
                  <span className="app-usage-kicker">Most used {usageNoun(primaryItem)}</span>
                  <div className="app-usage-feature__title">
                    <span className="app-usage-rank app-usage-rank--inline" aria-label={`Rank ${primaryItem.rank}`}>#{primaryItem.rank}</span>
                    <strong>{displayName(primaryItem)}</strong>
                  </div>
                  <p>{formatUsageContext(primaryItem)}</p>
                </div>
              </div>
              <div className="app-usage-feature__measure">
                <strong>{formatDuration(primaryItem.totalSeconds)}</strong>
              </div>
            </div>
            <div className="app-usage-feature__meter-block">
              <div className="app-usage-feature__meter-copy">
                <span>Share</span>
                <strong>{formatShare(primaryItem.shareOfTotal)}</strong>
              </div>
              <div className="app-usage-feature__meter" aria-label={`${displayName(primaryItem)} accounts for ${formatShare(primaryItem.shareOfTotal)} of tracked time`}>
                <span />
              </div>
            </div>
            <dl className="app-usage-feature__stats">
              <div><dt>Sessions</dt><dd>{primaryItem.sessionCount}</dd></div>
              <div><dt>Average</dt><dd>{formatDuration(primaryItem.averageSessionSeconds)}</dd></div>
              <div><dt>Days</dt><dd>{primaryItem.activeDays}d</dd></div>
            </dl>
          </article>

          {secondaryItems.length > 0 ? (
            <ol className="app-usage-list" aria-label="Ranked app usage">
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
                        <small>{formatUsageContext(item)}</small>
                      </div>
                    </div>
                    <div className="app-usage-row__bar" aria-label={`${name} accounts for ${formatShare(item.shareOfTotal)} of tracked time`}>
                      <span style={shareStyle} />
                    </div>
                    <div className="app-usage-row__figures">
                      <strong>{formatDuration(item.totalSeconds)}</strong>
                      <span>{formatShare(item.shareOfTotal)} · {formatSessionCount(item.sessionCount)} · {formatDuration(item.averageSessionSeconds)} avg</span>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : (
        <div className="app-usage-empty empty-state">
          <span className="eyebrow">No usage ranking</span>
          <strong>Usage is still quiet</strong>
          <p>{emptyDetail}</p>
        </div>
      )}
    </section>
  );
}
