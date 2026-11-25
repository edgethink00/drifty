import { useEffect, useRef, useState, type CSSProperties } from "react";
import { achievementBadgeStage, achievementBadgeUrl, type AchievementBadgeStage } from "../../achievementBadge";
import type { AchievementItem } from "../../useAchievements";

type MedalProps = {
  readonly item: AchievementItem;
  /** The small image, for marks under about 3rem. */
  readonly small?: boolean;
  readonly className?: string;
};

/** The medal image as baked; its box is sized by the layout's CSS. */
export function C15Medal({ item, small = false, className = "c15-medal" }: MedalProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage, small);
  return (
    // The image also serves as a mask, so a light can pass over the medal's shape alone.
    <span className={className} data-stage={stage} aria-hidden="true" style={src ? ({ "--c15-medal-src": 'url("' + src + '")' } as CSSProperties) : undefined}>
      {src ? <img src={src} alt="" draggable={false} /> : null}
    </span>
  );
}

/** The milestone count each medal stage is modelled at, as in the bake. */
const STAGE_TIER: Readonly<Record<AchievementBadgeStage, number>> = { locked: 0, concealed: 0, silver: 1, gold: 3, ring: 5 };

type SpinProps = {
  readonly item: AchievementItem;
  /** Engraved on the back of an earned medal: its name and the day it was first earned. */
  readonly engraving: readonly string[];
  readonly className?: string;
};

/**
 * The medal in 3D, to hold and turn: it shows the baked image at once, then
 * loads three.js and takes over with a live medal that turns while held and
 * leans toward the pointer otherwise. If WebGL is unavailable the image
 * simply stays.
 */
export function C15SpinMedal({ item, engraving, className = "c15-medal" }: SpinProps) {
  const stage = achievementBadgeStage(item);
  const src = achievementBadgeUrl(item.definition.id, stage);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState(false);
  const { id, group } = item.definition;
  const engraved = engraving.join("\n");

  useEffect(() => {
    let cancelled = false;
    let handle: { dispose: () => void } | null = null;
    setLive(false);
    import("../../render3d/liveMedal")
      .then(({ mountLiveMedal }) => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        try {
          handle = mountLiveMedal(canvas, {
            art: { id, group, state: stage === "locked" ? "locked" : stage === "concealed" ? "concealed" : "earned", detail: true, tier: STAGE_TIER[stage] },
            engraving: engraved ? engraved.split("\n") : [],
            onReady: () => { if (!cancelled) setLive(true); },
          });
        } catch {
          handle = null;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [id, group, stage, engraved]);

  return (
    <span className={className + " c15-spin"} data-stage={stage} data-live={live ? "" : undefined} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : null}
      <canvas ref={canvasRef} className="c15-spin__canvas" />
    </span>
  );
}
