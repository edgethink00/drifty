// Self-contained SVG renderer for Drifty's single shareable focus statement.
//
// The card deliberately exposes one aggregate only: focused time. It never
// renders app names, sites, projects, raw timeline rows, category breakdowns,
// or session history. This keeps the shared artifact instantly legible and
// preserves the local-first privacy boundary.

import driftyWordmarkDataUrl from "../../assets/drifty-wordmark.png?inline";
import { escapeXml, formatFocusDuration } from "./badgeSvg";
import type { CommunityFocusPercentileModels } from "../companion/communityFocusPercentile";
import type { ShareCardData, ShareWeekCardData } from "./shareCard";
import {
  UNIFIED_STORY_OPTIONS,
  type ShareCardLiveRanks,
  type UnifiedShareStoryId,
  SHARE_CARD_UNIFIED_SIZE,
  renderUnifiedShareCardSvg,
  renderUnifiedShareWeekCardSvg,
} from "./shareCardUnifiedSvg";
export { UNIFIED_STORY_OPTIONS, SHARE_CARD_UNIFIED_SIZE };

export type ShareCardTheme = "light" | "dark";
export type ShareCardFormat = "portrait" | "square" | "landscape";
export type ShareCardStory = UnifiedShareStoryId | "focus_time" | "focus_share" | "deep_work"; // unified primary; legacy kept for tests
export type ShareCardBackground =
  | "hourglass"
  | "halo"
  | "beam"
  | "quiet"
  | "quiet_wash"
  | "quiet_drift"
  | "quiet_bloom";

export interface ShareCardRenderOptions {
  readonly data: ShareCardData;
  readonly format: ShareCardFormat;
  readonly theme: ShareCardTheme;
  readonly language?: "en" | "ko" | "es";
  readonly story?: ShareCardStory;
  readonly background?: ShareCardBackground;
  readonly lookIndex?: number;
  readonly liveRanks?: ShareCardLiveRanks;
  readonly communityModels?: CommunityFocusPercentileModels;
}

export interface ShareWeekCardRenderOptions {
  readonly data: ShareWeekCardData;
  readonly format: ShareCardFormat;
  readonly theme: ShareCardTheme;
  readonly language?: "en" | "ko" | "es";
  readonly story?: ShareCardStory;
  readonly background?: ShareCardBackground;
  readonly lookIndex?: number;
  readonly liveRanks?: ShareCardLiveRanks;
  readonly communityModels?: CommunityFocusPercentileModels;
}

export const SHARE_CARD_EXPORT_SIZES: Record<ShareCardFormat, { width: number; height: number }> = {
  landscape: { width: SHARE_CARD_UNIFIED_SIZE.width, height: SHARE_CARD_UNIFIED_SIZE.height },
  square: { width: 1080, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

const SQUARE = { width: 340, height: 340 } as const;
const PORTRAIT = { width: 324, height: 576 } as const;
// Windows faces follow the Apple ones; see the stack note in shareCardUnifiedSvg.ts.
const FONT_SANS = "-apple-system, 'SF Pro Display', 'Helvetica Neue', 'Segoe UI Variable Display', 'Segoe UI', 'Malgun Gothic', sans-serif";
const FONT_MONO = "'SF Mono', ui-monospace, Menlo, 'Cascadia Mono', Consolas, 'Apple SD Gothic Neo', 'Malgun Gothic', monospace";

type ShareCardPalette = {
  readonly canvas: string;
  readonly canvasGlow: string;
  readonly text: string;
  readonly soft: string;
  readonly accent: string;
};

const DARK_PALETTE: ShareCardPalette = {
  canvas: "#141412",
  canvasGlow: "#1c2213",
  text: "#dcd9d0",
  soft: "#96938a",
  accent: "#b7d96b",
};

const LIGHT_PALETTE: ShareCardPalette = {
  canvas: "#f2f1ed",
  canvasGlow: "#e9ecdf",
  text: "#1c1c19",
  soft: "#79776f",
  accent: "#4f751e",
};

type PosterContent = {
  readonly story: ShareCardStory;
  readonly datePrimary: string;
  readonly dateSecondary: string;
  readonly kicker: string;
  readonly metric: string;
  readonly lineOne: string;
  readonly lineTwo: string;
  readonly accessibleLabel: string;
};

function paletteFor(theme: ShareCardTheme): ShareCardPalette {
  return theme === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function renderDefs(palette: ShareCardPalette, width: number, height: number): string {
  return `<defs>
<radialGradient id="posterCanvas" cx="0.88" cy="0.18" r="1.08">
  <stop offset="0" stop-color="${palette.canvasGlow}"/>
  <stop offset="0.62" stop-color="${palette.canvas}"/>
</radialGradient>
<linearGradient id="focusMark" x1="0" y1="0" x2="0.86" y2="1">
  <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.22"/>
  <stop offset="1" stop-color="${palette.accent}" stop-opacity="0.045"/>
</linearGradient>
<radialGradient id="quietWash" cx="1.04" cy="0.02" r="0.92">
  <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.17"/>
  <stop offset="0.42" stop-color="${palette.accent}" stop-opacity="0.075"/>
  <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
</radialGradient>
<linearGradient id="quietDrift" x1="1" y1="0" x2="0.08" y2="0.92">
  <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.14"/>
  <stop offset="0.46" stop-color="${palette.accent}" stop-opacity="0.045"/>
  <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
</linearGradient>
<radialGradient id="quietBloomA" cx="1.08" cy="0.04" r="1.14">
  <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.13"/>
  <stop offset="0.72" stop-color="${palette.accent}" stop-opacity="0.025"/>
  <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
</radialGradient>
<radialGradient id="quietBloomB" cx="0.1" cy="1.06" r="1.08">
  <stop offset="0" stop-color="${palette.accent}" stop-opacity="0.065"/>
  <stop offset="1" stop-color="${palette.accent}" stop-opacity="0"/>
</radialGradient>
<filter id="brandWordmarkLight" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/>
</filter>
<clipPath id="posterBounds"><rect width="${width}" height="${height}" rx="18"/></clipPath>
</defs>
<rect width="${width}" height="${height}" rx="18" fill="url(#posterCanvas)"/>`;
}

function text(
  x: number,
  y: number,
  content: string,
  options: {
    readonly size: number;
    readonly fill: string;
    readonly weight?: number;
    readonly font?: string;
    readonly spacing?: number;
    readonly anchor?: "start" | "end" | "middle";
  },
): string {
  const attributes = [
    `x="${round2(x)}"`,
    `y="${round2(y)}"`,
    `font-family="${options.font ?? FONT_SANS}"`,
    `font-size="${options.size}"`,
    `fill="${escapeXml(options.fill)}"`,
    options.weight ? `font-weight="${options.weight}"` : null,
    options.spacing ? `letter-spacing="${options.spacing}"` : null,
    options.anchor ? `text-anchor="${options.anchor}"` : null,
  ].filter(Boolean).join(" ");
  return `<text ${attributes}>${escapeXml(content)}</text>`;
}

function renderDateLine(
  x: number,
  baselineY: number,
  primary: string,
  secondary: string,
  palette: ShareCardPalette,
): string {
  const primaryText = primary.toUpperCase();
  const secondaryText = secondary.toUpperCase();
  const separatorX = x + primaryText.length * 6.9 + 8;
  return [
    text(x, baselineY, primaryText, { size: 9, fill: palette.accent, font: FONT_MONO, weight: 650, spacing: 1.1 }),
    text(separatorX, baselineY, "·", { size: 9, fill: palette.soft, font: FONT_MONO }),
    text(separatorX + 13, baselineY, secondaryText, { size: 9, fill: palette.soft, font: FONT_MONO, spacing: 1.1 }),
  ].join("\n");
}

function renderMetric(
  x: number,
  baselineY: number,
  label: string,
  maxWidth: number,
  palette: ShareCardPalette,
  preferredSize: number,
): string {
  const estimatedWidth = label.length * preferredSize * 0.49;
  const size = estimatedWidth > maxWidth ? preferredSize * (maxWidth / estimatedWidth) : preferredSize;
  return text(x, baselineY, label, {
    size: round2(size),
    fill: palette.text,
    weight: 760,
    spacing: -2.4,
  });
}

function renderBrand(x: number, baselineY: number, palette: ShareCardPalette): string {
  const height = 13;
  const width = height * (1680 / 471);
  const y = baselineY - height + 2;
  const filter = palette === DARK_PALETTE ? ' filter="url(#brandWordmarkLight)"' : "";
  return `<svg x="${round2(x)}" y="${round2(y)}" width="${round2(width)}" height="${height}" viewBox="48 236 1680 471" preserveAspectRatio="xMinYMid meet">` +
    `<image x="0" y="0" width="2030" height="1035" href="${escapeXml(driftyWordmarkDataUrl)}"${filter}/>` +
  `</svg>`;
}

function renderFooter(
  x: number,
  baselineY: number,
  width: number,
  palette: ShareCardPalette,
): string {
  return [
    renderBrand(x, baselineY, palette),
    text(width - x, baselineY, "drifty.so", {
      size: 9,
      fill: palette.soft,
      font: FONT_MONO,
      spacing: 0.9,
      anchor: "end",
    }),
  ].join("\n");
}

function renderSquareBackground(background: ShareCardBackground, palette: ShareCardPalette): string {
  if (background === "quiet_wash") {
    return `<g id="background-quiet_wash" clip-path="url(#posterBounds)">
  <rect width="340" height="340" fill="url(#quietWash)"/>
</g>`;
  }
  if (background === "quiet_drift") {
    return `<g id="background-quiet_drift" clip-path="url(#posterBounds)">
  <rect width="340" height="340" fill="url(#quietDrift)"/>
</g>`;
  }
  if (background === "quiet_bloom") {
    return `<g id="background-quiet_bloom" clip-path="url(#posterBounds)">
  <rect width="340" height="340" fill="url(#quietBloomA)"/>
  <rect width="340" height="340" fill="url(#quietBloomB)"/>
</g>`;
  }
  if (background === "halo") {
    return `<g id="background-halo" clip-path="url(#posterBounds)">
  <circle cx="296" cy="151" r="92" fill="none" stroke="${palette.accent}" stroke-width="30" stroke-opacity="0.1"/>
  <circle cx="296" cy="151" r="92" fill="none" stroke="${palette.accent}" stroke-width="3" stroke-opacity="0.34" stroke-dasharray="118 470" transform="rotate(-90 296 151)"/>
  <circle cx="296" cy="59" r="4" fill="${palette.accent}" fill-opacity="0.72"/>
</g>`;
  }
  if (background === "beam") {
    return `<g id="background-beam" clip-path="url(#posterBounds)" fill="${palette.accent}">
  <rect x="184" y="57" width="210" height="40" rx="20" fill-opacity="0.08"/>
  <rect x="211" y="110" width="183" height="40" rx="20" fill-opacity="0.12"/>
  <rect x="245" y="163" width="149" height="40" rx="20" fill-opacity="0.18"/>
  <circle cx="245" cy="183" r="4" fill-opacity="0.72"/>
</g>`;
  }
  if (background === "quiet") {
    return `<g id="background-quiet" clip-path="url(#posterBounds)">
  <circle cx="306" cy="69" r="84" fill="${palette.accent}" fill-opacity="0.045"/>
  <circle cx="302" cy="73" r="4" fill="${palette.accent}" fill-opacity="0.56"/>
</g>`;
  }
  return `<g id="background-hourglass" clip-path="url(#posterBounds)" fill="url(#focusMark)">
  <path d="M164 40h226L277 151z"/>
  <path d="m277 155 113 111H164z"/>
</g>
<circle cx="277" cy="153" r="4" fill="${palette.accent}" fill-opacity="0.66"/>`;
}

function renderPortraitBackground(background: ShareCardBackground, palette: ShareCardPalette): string {
  if (background === "quiet_wash") {
    return `<g id="background-quiet_wash" clip-path="url(#posterBounds)">
  <rect width="324" height="576" fill="url(#quietWash)"/>
</g>`;
  }
  if (background === "quiet_drift") {
    return `<g id="background-quiet_drift" clip-path="url(#posterBounds)">
  <rect width="324" height="576" fill="url(#quietDrift)"/>
</g>`;
  }
  if (background === "quiet_bloom") {
    return `<g id="background-quiet_bloom" clip-path="url(#posterBounds)">
  <rect width="324" height="576" fill="url(#quietBloomA)"/>
  <rect width="324" height="576" fill="url(#quietBloomB)"/>
</g>`;
  }
  if (background === "halo") {
    return `<g id="background-halo" clip-path="url(#posterBounds)">
  <circle cx="282" cy="233" r="126" fill="none" stroke="${palette.accent}" stroke-width="42" stroke-opacity="0.1"/>
  <circle cx="282" cy="233" r="126" fill="none" stroke="${palette.accent}" stroke-width="4" stroke-opacity="0.36" stroke-dasharray="180 612" transform="rotate(-90 282 233)"/>
  <circle cx="282" cy="107" r="4" fill="${palette.accent}" fill-opacity="0.72"/>
</g>`;
  }
  if (background === "beam") {
    return `<g id="background-beam" clip-path="url(#posterBounds)" fill="${palette.accent}">
  <rect x="122" y="92" width="250" height="52" rx="26" fill-opacity="0.08"/>
  <rect x="158" y="161" width="214" height="52" rx="26" fill-opacity="0.12"/>
  <rect x="204" y="230" width="168" height="52" rx="26" fill-opacity="0.18"/>
  <circle cx="204" cy="256" r="4" fill-opacity="0.72"/>
</g>`;
  }
  if (background === "quiet") {
    return `<g id="background-quiet" clip-path="url(#posterBounds)">
  <circle cx="292" cy="118" r="112" fill="${palette.accent}" fill-opacity="0.045"/>
  <circle cx="286" cy="116" r="4" fill="${palette.accent}" fill-opacity="0.56"/>
</g>`;
  }
  return `<g id="background-hourglass" clip-path="url(#posterBounds)" fill="url(#focusMark)">
  <path d="M116 76h280L256 216z"/>
  <path d="m256 222 140 140H116z"/>
</g>
<circle cx="256" cy="219" r="4" fill="${palette.accent}" fill-opacity="0.66"/>`;
}

function wrapSvg(
  content: string,
  logicalWidth: number,
  logicalHeight: number,
  exportSize: { readonly width: number; readonly height: number },
  label: string,
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${exportSize.width}" height="${exportSize.height}" viewBox="0 0 ${logicalWidth} ${logicalHeight}" role="img" aria-label="${escapeXml(label)}">
<title>${escapeXml(label)}</title>
${content}
</svg>`;
}

function renderSquare(content: PosterContent, theme: ShareCardTheme, background: ShareCardBackground): string {
  const palette = paletteFor(theme);
  const padX = 26;
  const parts = [
    renderDefs(palette, SQUARE.width, SQUARE.height),
    renderSquareBackground(background, palette),
    renderDateLine(padX, 39, content.datePrimary, content.dateSecondary, palette),
    text(padX, 91, content.kicker, { size: content.kicker.length > 16 ? 11 : 13, fill: palette.accent, font: FONT_MONO, weight: 650, spacing: 1.8 }),
    renderMetric(padX - 2, 176, content.metric, 292, palette, 80),
    text(padX, 220, content.lineOne, { size: content.lineOne.length > 13 ? 27 : 31, fill: palette.text, weight: 720, spacing: -0.9 }),
    content.lineTwo ? text(padX, 255, content.lineTwo, { size: content.lineTwo.length > 13 ? 27 : 31, fill: palette.text, weight: 720, spacing: -0.9 }) : "",
    renderFooter(padX, 319, SQUARE.width, palette),
  ];
  return wrapSvg(parts.join("\n"), SQUARE.width, SQUARE.height, SHARE_CARD_EXPORT_SIZES.square, content.accessibleLabel);
}

function renderPortrait(content: PosterContent, theme: ShareCardTheme, background: ShareCardBackground): string {
  const palette = paletteFor(theme);
  const padX = 24;
  const parts = [
    renderDefs(palette, PORTRAIT.width, PORTRAIT.height),
    renderPortraitBackground(background, palette),
    renderDateLine(padX, 44, content.datePrimary, content.dateSecondary, palette),
    text(padX, 154, content.kicker, { size: content.kicker.length > 16 ? 12 : 14, fill: palette.accent, font: FONT_MONO, weight: 650, spacing: 1.9 }),
    renderMetric(padX - 3, 273, content.metric, 282, palette, 92),
    text(padX, 329, content.lineOne, { size: content.lineOne.length > 13 ? 33 : 38, fill: palette.text, weight: 720, spacing: -1 }),
    content.lineTwo ? text(padX, 372, content.lineTwo, { size: content.lineTwo.length > 13 ? 33 : 38, fill: palette.text, weight: 720, spacing: -1 }) : "",
    text(padX, 431, "TIME, FOUND.", { size: 9, fill: palette.soft, font: FONT_MONO, spacing: 1.7 }),
    renderFooter(padX, 551, PORTRAIT.width, palette),
  ];
  return wrapSvg(parts.join("\n"), PORTRAIT.width, PORTRAIT.height, SHARE_CARD_EXPORT_SIZES.portrait, content.accessibleLabel);
}

function renderPoster(content: PosterContent, format: ShareCardFormat, theme: ShareCardTheme, background: ShareCardBackground): string {
  return format === "portrait" ? renderPortrait(content, theme, background) : renderSquare(content, theme, background);
}

function dayPosterContent(data: ShareCardData, story: ShareCardStory): PosterContent {
  const duration = formatFocusDuration(data.focusSeconds);
  if (story === "focus_share") {
    return {
      story,
      datePrimary: data.weekdayLabel,
      dateSecondary: data.dateLabel,
      kicker: "TODAY WAS",
      metric: `${data.focusPercent}%`,
      lineOne: "IN FOCUS.",
      lineTwo: "",
      accessibleLabel: `Drifty focus card — ${data.focusPercent}% of today was in focus`,
    };
  }
  if (story === "deep_work") {
    const stretch = formatFocusDuration(data.longestFocusSeconds);
    return {
      story,
      datePrimary: data.weekdayLabel,
      dateSecondary: data.dateLabel,
      kicker: "I STAYED WITH IT",
      metric: stretch,
      lineOne: "IN ONE FOCUS",
      lineTwo: "STRETCH.",
      accessibleLabel: `Drifty focus card — ${stretch} in one focus stretch`,
    };
  }
  return {
    story,
    datePrimary: data.weekdayLabel,
    dateSecondary: data.dateLabel,
    kicker: "I FOUND",
    metric: duration,
    lineOne: "OF FOCUS",
    lineTwo: "TODAY.",
    accessibleLabel: `Drifty focus card — I found ${duration} of focus today`,
  };
}

function weekPosterContent(data: ShareWeekCardData, story: ShareCardStory): PosterContent {
  const duration = formatFocusDuration(data.focusSeconds);
  if (story === "focus_share") {
    return {
      story,
      datePrimary: data.weekLabel,
      dateSecondary: data.rangeLabel,
      kicker: "THIS WEEK WAS",
      metric: `${data.focusPercent}%`,
      lineOne: "IN FOCUS.",
      lineTwo: "",
      accessibleLabel: `Drifty focus card — ${data.focusPercent}% of this week was in focus`,
    };
  }
  if (story === "deep_work") {
    const stretch = formatFocusDuration(data.longestFocusSeconds);
    return {
      story,
      datePrimary: data.weekLabel,
      dateSecondary: data.rangeLabel,
      kicker: "I STAYED WITH IT",
      metric: stretch,
      lineOne: "IN ONE FOCUS",
      lineTwo: "STRETCH.",
      accessibleLabel: `Drifty focus card — ${stretch} in one focus stretch this week`,
    };
  }
  return {
    story,
    datePrimary: data.weekLabel,
    dateSecondary: data.rangeLabel,
    kicker: "I FOUND",
    metric: duration,
    lineOne: "OF FOCUS",
    lineTwo: "THIS WEEK.",
    accessibleLabel: `Drifty focus card — I found ${duration} of focus this week`,
  };
}

function isUnifiedStory(story: ShareCardStory): story is UnifiedShareStoryId {
  return UNIFIED_STORY_OPTIONS.some((entry) => entry.value === story);
}

export function renderShareCardSvg({ data, format, theme, language, story = "R1c", background = "quiet_wash", lookIndex, liveRanks, communityModels }: ShareCardRenderOptions): string {
  if (isUnifiedStory(story) || format === "landscape") {
    const unifiedStory = isUnifiedStory(story) ? story : "R1c";
    return renderUnifiedShareCardSvg({ data, theme, language, story: unifiedStory, lookIndex, liveRanks, communityModels });
  }
  const legacyStory = story === "focus_share" || story === "deep_work" || story === "focus_time" ? story : "focus_time";
  return renderPoster(dayPosterContent(data, legacyStory), format, theme, background);
}

export function renderShareWeekCardSvg({ data, format, theme, language, story = "WR1", background = "quiet_wash", lookIndex, liveRanks, communityModels }: ShareWeekCardRenderOptions): string {
  if (isUnifiedStory(story) || format === "landscape") {
    const unifiedStory = isUnifiedStory(story) ? story : "WR1";
    return renderUnifiedShareWeekCardSvg({ data, theme, language, story: unifiedStory, lookIndex, liveRanks, communityModels });
  }
  const legacyStory = story === "focus_share" || story === "deep_work" || story === "focus_time" ? story : "focus_time";
  return renderPoster(weekPosterContent(data, legacyStory), format, theme, background);
}
