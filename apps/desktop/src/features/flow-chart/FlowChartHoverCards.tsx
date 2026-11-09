import type { CSSProperties, Ref } from "react";
import type { FlowBlock } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { getViewportSafeHoverPosition, HOVER_CARD_OFFSET } from "../../components/hoverCardPosition";
import { blockDisplayName } from "./flowChartFormat";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";

export type FlowLegendActivityBreakdown = {
  readonly appName: string;
  readonly bundleId?: string | null;
  readonly browserName?: string | null;
  readonly siteDomain?: string | null;
  readonly siteTitle?: string | null;
  readonly totalSeconds: number;
};

export type FlowLegendHoverState = {
  readonly label: string;
  readonly detailLabel: string;
  /** The colour the hovered entry paints, shown before its name. */
  readonly swatch?: string;
  readonly appBreakdown: readonly FlowLegendActivityBreakdown[];
  /** A productivity group's chip lists the categories it used instead of apps. */
  readonly categoryBreakdown?: readonly FlowLegendCategoryBreakdown[];
  readonly x: number;
  readonly y: number;
};

export type FlowLegendCategoryBreakdown = {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly totalSeconds: number;
};

function flowHoverCardPosition(x: number, y: number): CSSProperties {
  return { left: x + HOVER_CARD_OFFSET, top: y + HOVER_CARD_OFFSET };
}

export function moveFlowHoverCardToPointer(card: HTMLDivElement | null, x: number, y: number): void {
  if (!card) return;
  const bounds = card.getBoundingClientRect();
  const position = getViewportSafeHoverPosition(x, y, bounds.width, bounds.height);
  card.style.left = `${position.left}px`;
  card.style.top = `${position.top}px`;
}

export function buildLegendActivityBreakdown(
  blocks: readonly FlowBlock[],
  matchesBlock: (block: FlowBlock) => boolean,
): FlowLegendActivityBreakdown[] {
  const totals = new Map<string, FlowLegendActivityBreakdown>();

  for (const block of blocks) {
    if (!matchesBlock(block)) continue;
    const label = blockDisplayName(block);
    const key = block.siteDomain ? `site:${block.siteDomain}` : block.siteTitle ? `title:${block.siteTitle}` : `app:${block.bundleId ?? block.appName}`;
    const existing = totals.get(key);
    const nextTotalSeconds = (existing?.totalSeconds ?? 0) + block.durationSeconds;
    totals.set(key, existing ? { ...existing, totalSeconds: nextTotalSeconds } : {
      appName: label,
      bundleId: block.siteDomain || block.siteTitle ? null : block.bundleId ?? null,
      browserName: block.browserName ?? null,
      siteDomain: block.siteDomain ?? null,
      siteTitle: block.siteTitle ?? null,
      totalSeconds: nextTotalSeconds,
    });
  }

  return Array.from(totals.values())
    .sort((left, right) => right.totalSeconds - left.totalSeconds || left.appName.localeCompare(right.appName))
    .slice(0, 4);
}

export function FlowLegendHoverCard({ hover, appIcons, cardRef }: { readonly hover: FlowLegendHoverState; readonly appIcons: Record<string, string | null>; readonly cardRef?: Ref<HTMLDivElement> }) {
  const { effectiveLanguage, t } = useLocalization();
  if (hover.categoryBreakdown) {
    return (
      <div ref={cardRef} className="flow-hover-card category-hover-card category-hover-card--group" style={flowHoverCardPosition(hover.x, hover.y)}>
        <div className="category-hover-card__head">
          {hover.swatch ? <span className="category-hover-card__swatch" style={{ background: hover.swatch }} aria-hidden="true" /> : null}
          <strong>{hover.label}</strong>
          <span>{hover.detailLabel}</span>
        </div>
        <div className="category-hover-card__categories">
          {hover.categoryBreakdown.length > 0 ? hover.categoryBreakdown.map((item) => (
            <div className="category-hover-card__category" key={item.key}>
              <span className="category-hover-card__swatch" style={{ background: item.color }} aria-hidden="true" />
              <span>{item.label}</span>
              <strong>{formatLocalizedCompactDurationFromSeconds(item.totalSeconds, effectiveLanguage)}</strong>
            </div>
          )) : <span className="category-hover-card__empty">{t("dashboard.today.noAppBreakdown")}</span>}
        </div>
      </div>
    );
  }
  return (
    <div ref={cardRef} className="flow-hover-card category-hover-card" style={flowHoverCardPosition(hover.x, hover.y)}>
      <div className="category-hover-card__head">
        {hover.swatch ? <span className="category-hover-card__swatch" style={{ background: hover.swatch }} aria-hidden="true" /> : null}
        <strong>{hover.label}</strong>
        <span>{hover.detailLabel}</span>
      </div>
      <div className="category-hover-card__apps">
        {hover.appBreakdown.length > 0 ? hover.appBreakdown.map((item) => {
          const iconSrc = appIcons[item.bundleId ?? item.appName] ?? null;
          const label = item.siteDomain ?? item.siteTitle ?? item.appName;
          return (
            <div className="category-hover-card__app" key={`${item.siteDomain ?? item.siteTitle ?? item.bundleId ?? item.appName}`}>
              <span className="usage-identity-icon usage-identity-icon--sm">
                {item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={label} iconSrc={item.siteTitle ? null : iconSrc} size="sm" />}
              </span>
              <span>{label}</span>
              <strong>{formatLocalizedCompactDurationFromSeconds(item.totalSeconds, effectiveLanguage)}</strong>
            </div>
          );
        }) : <span className="category-hover-card__empty">{t("dashboard.today.noAppBreakdown")}</span>}
      </div>
    </div>
  );
}
