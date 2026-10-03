import { useRef, type CSSProperties } from "react";
import type { AppIconMap } from "@drifty/domain";
import { SiteFavicon } from "../../components/SiteFavicon";
import type { FirstDayDiscoveries, FirstDayDiscoveryItem } from "./firstDayPreparationStory";
import { useTokenMotion } from "./firstDayPrepMotion";

/** Skeleton icons that keep the motion going while history is still being read. */
const PLACEHOLDER_TOKENS = 6;

function SourceIcon({ item, appIcons }: { readonly item: FirstDayDiscoveryItem; readonly appIcons: AppIconMap }) {
  if (item.kind === "site" && item.siteDomain) return <SiteFavicon domain={item.siteDomain} size={24} />;
  const iconSrc = (item.bundleId ? appIcons[item.bundleId] : null) ?? appIcons[item.label] ?? null;
  return iconSrc
    ? <img className="first-day-prep__token-app-icon" src={iconSrc} alt="" width={24} height={24} />
    : <span className="first-day-prep__token-letter">{item.label[0]?.toUpperCase() ?? "•"}</span>;
}

/**
 * The found apps and sites, always moving while they wait for a verdict: around the Drifty hourglass.
 * A token whose verdict arrives is sent off by useVerdictFlights; without motion its face simply fades.
 */
export function FirstDayTokenStage({ discoveries, appIcons = {} }: {
  readonly discoveries: FirstDayDiscoveries | null;
  readonly appIcons?: AppIconMap;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  useTokenMotion(stageRef);
  const items = discoveries?.items ?? [];
  return (
    <div ref={stageRef} className="first-day-prep__stage" aria-hidden="true">
      {items.length
        ? items.map((item, index) => (
          <span
            key={item.key}
            className="first-day-prep__token"
            data-token=""
            data-find-key={item.key}
            data-verdict={item.verdict}
            data-seed={index * 1.618}
            style={{ "--token-index": index } as CSSProperties}
            title={item.label}
          >
            <span className="first-day-prep__token-face"><SourceIcon item={item} appIcons={appIcons} /></span>
          </span>
        ))
        : Array.from({ length: PLACEHOLDER_TOKENS }, (_, index) => (
          <span key={"slot-" + index} className="first-day-prep__token first-day-prep__token--slot" data-token="" data-verdict="pending" data-seed={index * 1.618} style={{ "--token-index": index } as CSSProperties}>
            <span className="first-day-prep__token-face" />
          </span>
        ))}
    </div>
  );
}
