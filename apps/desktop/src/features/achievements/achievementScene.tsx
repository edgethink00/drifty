import { useId, type ReactNode } from "react";
import type { AchievementArtProps } from "./achievementArt";

/** A four-pointed glint. */
export function sparklePath(cx: number, cy: number, r: number): string {
  const w = r * 0.28;
  return "M" + cx + " " + (cy - r) + "Q" + (cx + w) + " " + (cy - w) + " " + (cx + r) + " " + cy
    + "Q" + (cx + w) + " " + (cy + w) + " " + cx + " " + (cy + r)
    + "Q" + (cx - w) + " " + (cy + w) + " " + (cx - r) + " " + cy
    + "Q" + (cx - w) + " " + (cy - w) + " " + cx + " " + (cy - r) + "Z";
}

/**
 * The softly lit tile the cat badges use, in the achievement's colour, with
 * the gold rims an achievement earns at 5, 10 and 25 times. Children are
 * drawn on its 150 x 150 grid, clipped to the tile.
 */
export function SceneTile({ group, state, tier, className, children, after, stone }: Pick<AchievementArtProps, "group" | "state" | "tier"> & { readonly className: string; readonly children: ReactNode; readonly after?: ReactNode; readonly stone?: string }) {
  const uid = "achievement-tile-" + useId().replace(/:/gu, "");
  const rimTier = state === "earned" ? Math.min(tier, 4) : 0;
  return (
    <svg className={"achievement-art achievement-scene " + className} viewBox="0 0 150 150" data-group={group} data-state={state} data-tier={rimTier >= 2 ? rimTier : undefined} data-stone={stone} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={uid}><rect x="0" y="0" width="150" height="150" rx="38" /></clipPath>
        <radialGradient id={uid + "-glow"} cx="50%" cy="40%" r="65%">
          <stop offset="0" style={{ stopColor: "var(--ac-glow)" }} />
          <stop offset="1" style={{ stopColor: "var(--ac-tile)" }} />
        </radialGradient>
      </defs>
      <rect className="ac-tile" x="0" y="0" width="150" height="150" rx="38" style={{ fill: "url(#" + uid + "-glow)" }} />
      <g clipPath={"url(#" + uid + ")"}>{children}</g>
      {rimTier >= 2 ? <rect className="ac-tier-rim" x="2.5" y="2.5" width="145" height="145" rx="35.5" /> : null}
      {rimTier >= 4 ? <rect className="ac-tier-rim ac-tier-rim--inner" x="9.5" y="9.5" width="131" height="131" rx="29" /> : null}
      {after}
    </svg>
  );
}
