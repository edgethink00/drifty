import { useId } from "react";
import type { AchievementId } from "./achievementCatalog";
import { ACHIEVEMENT_GLYPH_PATHS, type AchievementGlyphName } from "./AchievementGlyph";
import { useLocalization } from "../localization/LocalizationContext";

type FigureSource =
  | { readonly amount: number; readonly unit: "minute" | "hour" | "day" | "percent"; readonly shown?: string }
  | { readonly clock: string };

/** The figure each achievement is about; units follow the display language. */
const FIGURES: Readonly<Record<AchievementId, FigureSource>> = {
  firstFlow: { amount: 25, unit: "minute" },
  flow90: { amount: 90, unit: "minute" },
  flow180: { amount: 3, unit: "hour" },
  focusDay8h: { amount: 8, unit: "hour" },
  earlyStart: { clock: "5:00" },
  nightOwl: { clock: "2:00" },
  weekendShift: { amount: 2, unit: "hour", shown: "2+2" },
  streak7: { amount: 7, unit: "day" },
  streak30: { amount: 30, unit: "day" },
  focus100h: { amount: 100, unit: "hour" },
  driftDay: { amount: 50, unit: "percent" },
  noDriftDay: { amount: 0, unit: "minute" },
  comeback: { amount: 4, unit: "hour" },
};

export type AchievementFigure = { readonly value: string; readonly unit: string };

export function useAchievementFigure(id: AchievementId): AchievementFigure {
  const { effectiveLanguage } = useLocalization();
  const figure = FIGURES[id];
  if ("clock" in figure) return { value: figure.clock, unit: "" };
  const parts = new Intl.NumberFormat(effectiveLanguage, { style: "unit", unit: figure.unit, unitDisplay: "narrow" }).formatToParts(figure.amount);
  return {
    value: figure.shown ?? parts.filter((part) => part.type === "integer" || part.type === "group" || part.type === "decimal" || part.type === "fraction").map((part) => part.value).join(""),
    unit: parts.filter((part) => part.type === "unit" || part.type === "percentSign").map((part) => part.value).join("").trim(),
  };
}

/** Rough width of a run of text at a font size, counting wide (CJK) letters as a full em. */
export function textWidth(text: string, size: number): number {
  return [...text].reduce((width, letter) => width + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af]/u.test(letter) ? 0.98 : 0.6) * size, 0);
}

/** One of the achievement line marks, centred on x, y and drawn size across. */
export function GlyphMark({ name, x, y, size, className }: { readonly name: AchievementGlyphName; readonly x: number; readonly y: number; readonly size: number; readonly className: string }) {
  return (
    <g className={className} transform={"translate(" + (x - size / 2) + " " + (y - size / 2) + ") scale(" + size / 24 + ")"}>
      {ACHIEVEMENT_GLYPH_PATHS[name].map((d) => <path key={d} d={d} />)}
    </g>
  );
}

/** An id for defs inside one badge, safe to use in url(#...). */
export function useArtId(prefix: string): string {
  return prefix + "-" + useId().replace(/:/gu, "");
}
