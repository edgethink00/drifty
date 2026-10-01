import type { CSSProperties } from "react";
import layout from "./render-layout-v1.json";

// This artifact is also compiled into native. The scene remains the authored
// body coordinate system; padding belongs only to the rendering surface.
export const PET_MODE_RENDER_LAYOUT = layout;

export function getPetModeRenderSize(percent: number): { readonly width: number; readonly height: number } {
  const scale = percent / 100;
  const { sceneWidth, sceneHeight, padding } = layout;
  return {
    width: (sceneWidth + padding.left + padding.right) * scale,
    height: (sceneHeight + padding.top + padding.bottom) * scale,
  };
}

export function getPetModeSceneStyle(percent: number): CSSProperties {
  const scale = percent / 100;
  return {
    left: `${layout.padding.left * scale}px`,
    top: `${layout.padding.top * scale}px`,
    bottom: "auto",
    transformOrigin: "0 0",
  };
}

export const PET_MODE_BODY_EFFECT_STYLE = {
  "--pet-body-effect-left": `${-layout.padding.left - 11.4}px`,
  "--pet-body-effect-top": `${-layout.padding.top - 4.2}px`,
  "--pet-body-effect-width": `${layout.sceneWidth + layout.padding.left + layout.padding.right}px`,
  "--pet-body-effect-height": `${layout.sceneHeight + layout.padding.top + layout.padding.bottom}px`,
  "--pet-body-register-left": `${layout.padding.left + 11.4}px`,
  "--pet-body-register-top": `${layout.padding.top + 4.2}px`,
} as CSSProperties;
