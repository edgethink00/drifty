import { useEffect, useRef, useState } from "react";
import type { AchievementArtProps } from "./achievementArt";
import type { BadgeImages, Render3dKind } from "./render3d";

const SIZES = [64, 128, 192, 256, 384, 512] as const;
const renders = new Map<string, Promise<BadgeImages>>();

function bucket(px: number): number {
  return SIZES.find((size) => size >= px) ?? 512;
}

/**
 * A badge rendered in 3D (glass, metal, light) by three.js in the page, then
 * shown as a still image. three.js loads only when a rendered badge is on
 * screen; each render is kept for the session.
 */
export function AchievementRender3d({ kind, ...props }: AchievementArtProps & { readonly kind: Render3dKind }) {
  const box = useRef<HTMLSpanElement>(null);
  const [images, setImages] = useState<BadgeImages | null>(null);
  const { id, state, tier } = props;
  const level = state === "earned" ? tier : 0;

  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const width = element.getBoundingClientRect().width || 96;
    const px = bucket(width * (window.devicePixelRatio || 1));
    const key = [kind, id, state, level, px].join(":");
    let render = renders.get(key);
    if (!render) {
      render = import("./render3d").then((module) => module.renderBadge(kind, { ...props, tier: level }, px));
      renders.set(key, render);
      render.catch(() => renders.delete(key));
    }
    let live = true;
    render.then((next) => { if (live) setImages(next); }, () => undefined);
    return () => { live = false; };
    // props beyond these do not change the render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id, state, level]);

  return (
    <span ref={box} className="achievement-art achievement-render3d" data-state={state} data-kind={kind} aria-hidden="true">
      {images ? (
        <>
          <img className="achievement-render3d__transmit" src={images.transmit} alt="" draggable={false} />
          <img className="achievement-render3d__light" src={images.light} alt="" draggable={false} />
        </>
      ) : null}
    </span>
  );
}
