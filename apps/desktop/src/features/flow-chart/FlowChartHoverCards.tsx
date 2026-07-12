import type { CSSProperties, Ref } from "react";
import { secondsToLabel, type FlowBlock } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { ClassificationSourcePill } from "../classification/ClassificationBreakdownCards";
import { CATEGORY_COLORS, PRODUCTIVITY_COLORS, categoryLabel, productivityLabel } from "../../lib/activityLabels";
import type { FlowBlockHoverGroup } from "./flowHoverGroups";
import type { ProjectLegendEntry } from "./projectFlowView";
import { blockDetailLabel, blockDisplayName, groupContextLabel } from "./flowChartFormat";

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

const FLOW_HOVER_CARD_OFFSET_PX = 16;

function flowHoverCardPosition(x: number, y: number): CSSProperties {
  return { left: x + FLOW_HOVER_CARD_OFFSET_PX, top: y + FLOW_HOVER_CARD_OFFSET_PX };
}

export function moveFlowHoverCardToPointer(card: HTMLDivElement | null, x: number, y: number): void {
  if (!card) return;
  card.style.left = `${x + FLOW_HOVER_CARD_OFFSET_PX}px`;
  card.style.top = `${y + FLOW_HOVER_CARD_OFFSET_PX}px`;
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
              <strong>{secondsToLabel(item.totalSeconds)}</strong>
            </div>
          );
        }) : <span className="category-hover-card__empty">No app breakdown yet.</span>}
      </div>
    </div>
  );
}

export function flowDeviceBadgeLabel(deviceId: string | null | undefined, deviceLabelById?: ReadonlyMap<string, string>): string | null {
  if (!deviceId) return null;
  return deviceLabelById?.get(deviceId) ?? "Synced Mac";
}

export function FlowHoverCard({
  hover,
  appIcons,
  cardRef,
  deviceLabelById,
  projectsById,
}: {
  readonly hover: FlowHoverState;
  readonly appIcons: Record<string, string | null>;
  readonly cardRef?: Ref<HTMLDivElement>;
  readonly deviceLabelById?: ReadonlyMap<string, string>;
  readonly projectsById?: ReadonlyMap<string, ProjectLegendEntry>;
}) {
  const { block } = hover.group;
  const iconSrc = appIcons[block.bundleId ?? block.appName] ?? null;
  const displayName = blockDisplayName(block);
  const detailLabel = blockDetailLabel(block);
  const deviceLabel = flowDeviceBadgeLabel(block.deviceId, deviceLabelById);
  const project = block.projectId ? projectsById?.get(block.projectId) ?? null : null;

  return (
    <div ref={cardRef} className="flow-hover-card" style={flowHoverCardPosition(hover.x, hover.y)}>
      <div className="flow-hover-card__top">
        {block.siteDomain ? <SiteFavicon domain={block.siteDomain} size={24} fallbackIconSrc={iconSrc} /> : <AppGlyph appName={displayName} iconSrc={iconSrc} size="sm" />}
        <div>
          <strong>{displayName}</strong>
          <span>{groupContextLabel(hover.group)}</span>
        </div>
      </div>
      <div className="flow-hover-card__identity-row">
        <FlowIdentityPill color={CATEGORY_COLORS[block.category]} label={categoryLabel(block.category)} />
        <FlowIdentityPill color={PRODUCTIVITY_COLORS[block.productivity]} label={productivityLabel(block.productivity)} />
        {project ? <FlowIdentityPill color={block.projectColor ?? project.color} label={project.name} /> : null}
        {deviceLabel ? <span className="flow-hover-card__device-pill">{deviceLabel}</span> : null}
      </div>
      {detailLabel ? <p className="flow-hover-card__detail">{detailLabel}</p> : null}
      <ClassificationSourcePill source={block.classificationSource} ai={block.aiClassification} aiCached={block.aiCachedClassification} />
    </div>
  );
}

function FlowIdentityPill({ color, label }: { readonly color: string; readonly label: string }) {
  return (
    <span className="flow-hover-card__identity-pill">
      <span className="flow-hover-card__identity-dot" style={{ "--flow-hover-identity-color": color } as CSSProperties & Record<"--flow-hover-identity-color", string>} />
      {label}
    </span>
  );
}
