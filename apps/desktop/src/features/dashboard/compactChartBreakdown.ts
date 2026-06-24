import { buildAppUsageSummaries } from "@drifty/domain";
import type { ActivitySegment, FlowBlock } from "@drifty/domain";
import type { CompactClassificationBreakdownRow } from "./HoverCards";

export function buildCompactActivityBreakdown(segments: ActivitySegment[], divisor = 1): CompactClassificationBreakdownRow[] {
  const safeDivisor = Math.max(divisor, 1);
  return buildAppUsageSummaries(segments, { limit: 4 }).map((item) => ({
    appName: item.appName,
    bundleId: item.bundleId,
    browserName: item.browserName,
    siteDomain: item.siteDomain,
    siteTitle: item.siteTitle,
    totalSeconds: item.totalSeconds / safeDivisor,
  }));
}

export function buildCompactClassificationBreakdown(blocks: FlowBlock[], matchesSegment: (block: FlowBlock) => boolean): CompactClassificationBreakdownRow[] {
  const totals = new Map<string, CompactClassificationBreakdownRow>();

  for (const block of blocks) {
    if (!matchesSegment(block)) continue;
    const label = block.siteDomain ?? block.siteTitle ?? block.appName;
    const key = block.siteDomain ? `site:${block.siteDomain}` : block.siteTitle ? `title:${block.siteTitle}` : `app:${block.bundleId ?? block.appName}`;
    const existing = totals.get(key) ?? {
      appName: label,
      bundleId: block.siteDomain || block.siteTitle ? null : block.bundleId ?? null,
      browserName: block.browserName ?? null,
      siteDomain: block.siteDomain ?? null,
      siteTitle: block.siteTitle ?? null,
      totalSeconds: 0,
    };
    existing.totalSeconds += block.durationSeconds;
    totals.set(key, existing);
  }

  return Array.from(totals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.appName.localeCompare(right.appName))
    .slice(0, 4);
}
