import type { CSSProperties, Ref } from "react";
import type { FlowBlock } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { ClassificationSourceBadge } from "../classification/ClassificationSourceBadge";
import { getViewportSafeHoverPosition, HOVER_CARD_OFFSET } from "../../components/hoverCardPosition";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS } from "../../lib/activityLabels";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";
import { blockDetailLabel, blockDisplayName, formatGroupTimeRange } from "./flowChartFormat";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedCategoryLabel, localizedProductivityLabel } from "../localization/activityTranslations";

export type FlowHoverState = {
  readonly group: FlowBlockHoverGroup;
  readonly x: number;
  readonly y: number;
};

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
  readonly appBreakdown: readonly FlowLegendActivityBreakdown[];
  readonly x: number;
  readonly y: number;
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
  return (
    <div ref={cardRef} className="flow-hover-card category-hover-card" style={flowHoverCardPosition(hover.x, hover.y)}>
      <div className="category-hover-card__head">
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

export function flowDeviceBadgeLabel(deviceId: string | null | undefined, deviceLabelById?: ReadonlyMap<string, string>): string | null {
  if (!deviceId) return null;
  return deviceLabelById?.get(deviceId) ?? "Synced device";
}

export function FlowHoverCard({
  hover,
  appIcons,
  cardRef,
  deviceLabelById,
  projectsById,
  showClassificationSource = true,
}: {
  readonly hover: FlowHoverState;
  readonly appIcons: Record<string, string | null>;
  readonly cardRef?: Ref<HTMLDivElement>;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly projectsById?: ReadonlyMap<string, ProjectLegendEntry>;
  readonly showClassificationSource?: boolean;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const { block } = hover.group;
  const iconSrc = appIcons[block.bundleId ?? block.appName] ?? null;
  const displayName = blockDisplayName(block);
  const detailLabel = blockDetailLabel(block);
  const deviceLabel = flowDeviceBadgeLabel(block.deviceId, deviceLabelById);
  const project = block.projectId ? projectsById?.get(block.projectId) ?? null : null;
  const contextLabel = `${block.siteDomain && block.browserName ? `${block.browserName} · ` : ""}${formatGroupTimeRange(hover.group)} · ${formatLocalizedCompactDurationFromSeconds(hover.group.durationSeconds, effectiveLanguage)}`;

  return (
    <div ref={cardRef} className="flow-hover-card" style={flowHoverCardPosition(hover.x, hover.y)} aria-hidden="true">
      <div className="flow-hover-card__top">
        {block.siteDomain ? <SiteFavicon domain={block.siteDomain} size={24} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={displayName} iconSrc={iconSrc} size="sm" />}
        <div>
          <strong>{displayName}</strong>
          <span>{contextLabel}</span>
        </div>
      </div>
      <div className="flow-hover-card__identity-row">
        <FlowIdentityPill color={CATEGORY_COLORS[block.category]} label={localizedCategoryLabel(block.category, t)} />
        <FlowIdentityPill color={PRODUCTIVITY_COLORS[block.productivity]} label={localizedProductivityLabel(block.productivity, t)} />
        {project ? <FlowIdentityPill color={block.projectColor ?? project.color} label={project.name} /> : null}
        {deviceLabel ? <span className="flow-hover-card__device-pill">{effectiveLanguage === "ko" && deviceLabel === "Synced device" ? "동기화 기기" : deviceLabel}</span> : null}
        {showClassificationSource ? <ClassificationSourceBadge source={block.classificationSource} ai={block.aiClassification} aiCached={block.aiCachedClassification} language={effectiveLanguage} /> : null}
      </div>
      {detailLabel ? <p className="flow-hover-card__detail">{detailLabel}</p> : null}
    </div>
  );
}

function FlowIdentityPill({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <span className="hover-metadata-chip flow-hover-card__identity-pill">
      <span className="flow-hover-card__identity-dot" style={{ "--flow-hover-identity-color": color } as CSSProperties & Record<"--flow-hover-identity-color", string>} />
      <span className="flow-hover-card__identity-label">{label}</span>
    </span>
  );
}
