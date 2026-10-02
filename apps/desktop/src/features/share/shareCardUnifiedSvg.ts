// @ts-nocheck
// Unified share-card lineup ported from qa-share-freedom.html.
// Keeps Wispr-style chrome + per-card accent cycling (CARD_LOOKS).
// It is intentionally kept as a self-contained SVG template while the beta
// validates the lineup. Its public renderer boundary below remains typed.

import driftyWordmarkDataUrl from "../../assets/drifty-wordmark.png?inline";
import { escapeXml } from "./badgeSvg";
import { estimateShareCardFocusPercentile } from "./focusPercentile";
import type { CommunityFocusPercentileModels } from "../companion/communityFocusPercentile";
import type { ShareCardData, ShareWeekCardData } from "./shareCard";

export const SHARE_CARD_UNIFIED_SIZE = { width: 1200, height: 900 } as const;

export type UnifiedShareStoryId =
  | "R1c"
  | "WR1"
  | "R2"
  | "R4"
  | "F1"
  | "C1"
  | "W5"
  | "W4"
  | "S1"
  | "X6"
  | "X4"
  | "X5";

export type ShareCardTheme = "light" | "dark";
export type ShareCardLanguage = "en" | "ko";

/**
 * A privacy-safe, live leaderboard fact. The count is returned with the
 * aggregate leaderboard RPC, never derived from activity history.
 */
export type ShareCardLiveRank = {
  readonly rank: number;
  readonly participantCount: number;
  readonly topPercent: number;
  readonly windowStartDay: string;
  readonly windowEndDay: string;
};

export type ShareCardLiveRanks = {
  readonly daily: ShareCardLiveRank | null;
  readonly weekly: ShareCardLiveRank | null;
};

export const UNIFIED_STORY_OPTIONS: ReadonlyArray<{
  readonly value: UnifiedShareStoryId;
  readonly label: string;
}> = [
  { value: "R1c", label: "Curve Card" },
  { value: "WR1", label: "Weekly Curve" },
  { value: "R2", label: "Rank Statement" },
  { value: "F1", label: "Focus time" },
  { value: "C1", label: "Focus + Rank" },
  { value: "W5", label: "Week Average" },
  { value: "W4", label: "Week Range" },
  { value: "S1", label: "Day Dots" },
  { value: "X6", label: "Snapshot" },
  { value: "X4", label: "Categories" },
  { value: "X5", label: "Productivity" },
  // Exact placement is the only leaderboard-gated story. Keep it after the
  // shareable local stories so people do not encounter a lock first.
  { value: "R4", label: "Place Rank" },
];

type UnifiedMetrics = {
  RANK: number | null;
  WEEK_RANK: number | null;
  RANK_SAMPLE_SIZE: number;
  WEEK_RANK_SAMPLE_SIZE: number;
  RANK_IS_LIVE: boolean;
  WEEK_RANK_IS_LIVE: boolean;
  IS_CURRENT_PERIOD: boolean;
  DATE_LABEL: string;
  WEEK_LABEL: string;
  LIVE_RANK_PERCENT: number;
  RANK_PLACE: number;
  WEEK_RANK_PLACE: number;
  FOCUS_MINUTES: number;
  TOTAL_MINUTES: number;
  STREAK_DAYS: number;
  PEAK_MINUTES: number;
  WEEK_MINUTES: number;
  MONTH_MINUTES: number;
  SESSION_COUNT: number;
  CLIMB_PLACES: number;
  HIT_DAYS: number;
  PROD_FOCUS: number;
  PROD_NEUTRAL: number;
  PROD_DRIFT: number;
  TOTAL_USERS: number;
  AVG_DAILY_FOCUS_MINUTES: number;
  WEEK_DAY_MINUTES: number[];
  categorySlices: ReadonlyArray<{ key: string; label: string; pct: number; minutes: number }>;
  productivitySlices: ReadonlyArray<{ key: string; label: string; pct: number; minutes: number }>;
};

function finiteNonNegative(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function validLiveRank(rank: ShareCardLiveRank | null | undefined, startDay: string, endDay: string): ShareCardLiveRank | null {
  if (!rank || rank.windowStartDay !== startDay || rank.windowEndDay !== endDay) return null;
  if (!Number.isFinite(rank.rank) || rank.rank < 1) return null;
  if (!Number.isFinite(rank.participantCount) || rank.participantCount < rank.rank) return null;
  if (!Number.isFinite(rank.topPercent) || rank.topPercent <= 0 || rank.topPercent > 100) return null;
  return rank;
}

function percentage(value: number | null | undefined): number {
  return Math.max(0, Math.min(100, Math.round(finiteNonNegative(value))));
}

function minutesFromSeconds(seconds: number | null | undefined): number {
  return Math.round(finiteNonNegative(seconds) / 60);
}

function localizedProductivityLabel(key: "focus" | "neutral" | "drift"): string {
  if (selectedLanguage !== "ko") return { focus: "Focus", neutral: "Neutral", drift: "Drift" }[key];
  return { focus: "집중", neutral: "중립", drift: "딴짓" }[key];
}

function productivityPercentages(data: Pick<ShareCardData | ShareWeekCardData, "productivitySlices" | "totalSeconds" | "focusPercent">) {
  const percentFor = (key: "focus" | "neutral" | "drift") => {
    const slice = data.productivitySlices.find((entry) => entry.key === key);
    if (!slice) return 0;
    return percentage(finiteNonNegative(slice.ratio) * 100);
  };
  const focus = percentFor("focus") || percentage(data.focusPercent);
  const neutral = percentFor("neutral");
  const drift = percentFor("drift");
  return { focus, neutral, drift };
}

function deriveDayMetrics(data: ShareCardData, liveRanks?: ShareCardLiveRanks, communityModels?: CommunityFocusPercentileModels): UnifiedMetrics {
  const focusMinutes = minutesFromSeconds(data.focusSeconds);
  const totalMinutes = minutesFromSeconds(data.totalSeconds);
  const { focus: focusPct, neutral: neutralPct, drift: driftPct } = productivityPercentages(data);
  const rank = validLiveRank(liveRanks?.daily, data.day, data.day);
  const estimate = estimateShareCardFocusPercentile(data, communityModels);
  const hours = data.hours ?? [];
  const sessionCount = hours.filter((h) => h.focusSeconds > 10 * 60).length;
  const categorySlices = (data.slices ?? []).slice(0, 5).map((s) => ({
    key: String(s.key),
    label: s.label,
    pct: Math.min(100, finiteNonNegative(s.ratio) * 100),
    minutes: minutesFromSeconds(s.seconds),
  }));
  const productivitySlices = (data.productivitySlices ?? []).map((slice) => ({
    key: slice.key,
    label: localizedProductivityLabel(slice.key) ?? (selectedLanguage === "ko" ? "기타" : "Other"),
    pct: Math.min(100, finiteNonNegative(slice.ratio) * 100),
    minutes: minutesFromSeconds(slice.seconds),
  }));
  return {
    RANK: rank?.topPercent ?? estimate?.topPercent ?? null,
    WEEK_RANK: null,
    RANK_SAMPLE_SIZE: estimate?.sampleSize ?? 0,
    WEEK_RANK_SAMPLE_SIZE: 0,
    RANK_IS_LIVE: Boolean(rank),
    WEEK_RANK_IS_LIVE: false,
    IS_CURRENT_PERIOD: data.isCurrentPeriod,
    DATE_LABEL: data.dateLabel,
    WEEK_LABEL: "",
    LIVE_RANK_PERCENT: rank?.topPercent ?? 100,
    RANK_PLACE: rank?.rank ?? 0,
    WEEK_RANK_PLACE: 0,
    FOCUS_MINUTES: focusMinutes,
    TOTAL_MINUTES: totalMinutes,
    STREAK_DAYS: 0,
    PEAK_MINUTES: Math.max(0, ...hours.map((h) => minutesFromSeconds(h.focusSeconds))),
    WEEK_MINUTES: 0,
    MONTH_MINUTES: 0,
    SESSION_COUNT: sessionCount,
    CLIMB_PLACES: 0,
    HIT_DAYS: 0,
    PROD_FOCUS: focusPct,
    PROD_NEUTRAL: neutralPct,
    PROD_DRIFT: driftPct,
    TOTAL_USERS: rank?.participantCount ?? 0,
    AVG_DAILY_FOCUS_MINUTES: 0,
    WEEK_DAY_MINUTES: [],
    categorySlices,
    productivitySlices,
  };
}

function deriveWeekMetrics(data: ShareWeekCardData, liveRanks?: ShareCardLiveRanks, communityModels?: CommunityFocusPercentileModels): UnifiedMetrics {
  const day = deriveDayMetrics({
    focusSeconds: data.focusSeconds,
    totalSeconds: data.totalSeconds,
    focusPercent: data.focusPercent,
    productivitySlices: data.productivitySlices,
    isCurrentPeriod: data.isCurrentPeriod,
    dateLabel: "",
    hours: [],
    slices: data.slices ?? [],
  } as ShareCardData, liveRanks);
  const weekMinutes = minutesFromSeconds(data.focusSeconds);
  const days = (data.days ?? []).map((d) => minutesFromSeconds(d.focusSeconds));
  const weekRank = validLiveRank(liveRanks?.weekly, data.startDay, data.endDay);
  const estimate = estimateShareCardFocusPercentile(data, communityModels);
  return {
    ...day,
    RANK: weekRank?.topPercent ?? estimate?.topPercent ?? null,
    WEEK_RANK: weekRank?.topPercent ?? estimate?.topPercent ?? null,
    RANK_SAMPLE_SIZE: estimate?.sampleSize ?? 0,
    WEEK_RANK_SAMPLE_SIZE: estimate?.sampleSize ?? 0,
    RANK_IS_LIVE: Boolean(weekRank),
    WEEK_RANK_IS_LIVE: Boolean(weekRank),
    IS_CURRENT_PERIOD: data.isCurrentPeriod,
    WEEK_LABEL: data.weekLabel,
    WEEK_MINUTES: weekMinutes,
    AVG_DAILY_FOCUS_MINUTES: minutesFromSeconds(data.avgDailyFocusSeconds),
    WEEK_DAY_MINUTES: days,
  };
}

// --- QA port (helpers + unified renderers) ---
const W = 1200;
const H = 900;
const LOGO = driftyWordmarkDataUrl;
const H_RICH = 1170;

// An SVG drawn as an image cannot use the app's bundled web fonts, and Apple's
// faces cannot be embedded, so each stack names the closest Windows system face
// after the macOS ones. The Apple Hangul faces are named ahead of the Windows
// ones so a Mac that also has Office's Malgun Gothic or Batang renders as
// before. Cambria comes before Georgia because Georgia's default old-style
// figures dropped the "5" in "5h 15m" below the baseline; Batang keeps Korean
// serif titles in a myeongjo face, matching AppleMyungjo on macOS.
const F = {
  sans: "'Avenir Next', -apple-system, BlinkMacSystemFont, 'Segoe UI Variable Display', 'Segoe UI', 'Malgun Gothic', sans-serif",
  grotesk: "'Helvetica Neue', 'Avenir Next', 'Apple SD Gothic Neo', 'Segoe UI Variable Display', 'Segoe UI', 'Malgun Gothic', sans-serif",
  serif: "'Iowan Old Style', 'New York', Baskerville, Cambria, Georgia, AppleMyungjo, Batang, serif",
  mono: "Menlo, 'SF Mono', 'Cascadia Mono', Consolas, 'Apple SD Gothic Neo', 'Malgun Gothic', monospace",
};
// Title locked: Iowan / weight 500 / size 61 (toggles removed).
const TITLE_FONT = { value: F.serif, spacing: -0.8 };
const TITLE_WEIGHT = 500;
const TITLE_SIZE = 61;
let selectedSurface = 'ink'; // ink | paper — collapses color-only card variants
let selectedLanguage: ShareCardLanguage = 'en';
let categoryOverride = null;
let productivityOverride = null;

const lightBase = { bg: '#f3f1e8', paper: '#eceae0', ink: '#181914', soft: '#6d6e65', olive: '#617641', pale: '#d6dfbe', glow: '#b9c998', card: '#fbfaf4' };
const darkBase = { bg: '#171914', paper: '#20231b', ink: '#f1f0e7', soft: '#a6a79c', olive: '#b7d572', pale: '#536143', glow: '#73845e', card: '#23261c' };
const light = { ...lightBase };
const dark = { ...darkBase };
const BG_PRESETS = {
  light: [
    { id: 'wash', label: 'Quiet wash', value: '#f3f1e8' },
    { id: 'stone', label: 'Stone', value: '#ebe7dc' },
    { id: 'fog', label: 'Fog', value: '#e4e8ef' },
    { id: 'sand', label: 'Sand', value: '#f0e6d8' },
    { id: 'olivewash', label: 'Olive wash', value: '#e7ecd9' },
    { id: 'blush', label: 'Blush', value: '#f3e4e1' },
    { id: 'lilac', label: 'Lilac mist', value: '#ebe6f3' },
    { id: 'mint', label: 'Mint mist', value: '#e3efe8' },
    { id: 'butter', label: 'Butter', value: '#f5efd4' },
  ],
  dark: [
    { id: 'night', label: 'Night', value: '#171914' },
    { id: 'graphite', label: 'Graphite', value: '#20231b' },
    { id: 'slate', label: 'Slate', value: '#1a1f27' },
    { id: 'umber', label: 'Umber', value: '#221c16' },
    { id: 'forest', label: 'Forest', value: '#141a12' },
    { id: 'cocoa', label: 'Cocoa', value: '#2a211c' },
    { id: 'navy', label: 'Navy ash', value: '#171c28' },
    { id: 'plum', label: 'Plum dusk', value: '#241820' },
    { id: 'pine', label: 'Pine', value: '#152018' },
  ],
};
const ACCENT_PRESETS = [
  { id: 'olive', label: 'Olive', value: '#617641', pale: '#d6dfbe', glow: '#b9c998', darkValue: '#b7d572', darkPale: '#536143', darkGlow: '#73845e' },
  { id: 'moss', label: 'Moss', value: '#4f7a4a', pale: '#d2e2cd', glow: '#a9c89f', darkValue: '#9fd08f', darkPale: '#405740', darkGlow: '#6f9168' },
  { id: 'teal', label: 'Teal', value: '#2f6f68', pale: '#cfe3df', glow: '#9fc8c0', darkValue: '#7ec9bc', darkPale: '#355652', darkGlow: '#5f8f86' },
  { id: 'clay', label: 'Clay', value: '#9a6240', pale: '#edd9c8', glow: '#d2ae8f', darkValue: '#e0a67a', darkPale: '#5d4535', darkGlow: '#9a7357' },
  { id: 'indigo', label: 'Indigo', value: '#4d5f92', pale: '#d7dced', glow: '#aeb8d8', darkValue: '#9db0e3', darkPale: '#3d4663', darkGlow: '#6f7ea8' },
  { id: 'berry', label: 'Berry', value: '#8a4b68', pale: '#ecd6e0', glow: '#d2a7bb', darkValue: '#e09bbb', darkPale: '#573748', darkGlow: '#9a6780' },
];
let selectedBg = { light: 'sand', dark: 'night' };
let selectedAccent = 'olive';
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};
const mixHex = (a, b, t) => {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const n = (x) => Math.round(x).toString(16).padStart(2, '0');
  return `#${n(ar + (br - ar) * t)}${n(ag + (bg - ag) * t)}${n(ab + (bb - ab) * t)}`;
};
const applyPalette = () => {
  const bgLight = BG_PRESETS.light.find((x) => x.id === selectedBg.light) || BG_PRESETS.light[0];
  const bgDark = BG_PRESETS.dark.find((x) => x.id === selectedBg.dark) || BG_PRESETS.dark[0];
  const accent = ACCENT_PRESETS.find((x) => x.id === selectedAccent) || ACCENT_PRESETS[0];
  Object.assign(light, lightBase, {
    bg: bgLight.value,
    paper: mixHex(bgLight.value, '#ffffff', 0.18),
    olive: accent.value,
    pale: accent.pale,
    glow: accent.glow,
    card: bgLight.id === 'ink' ? '#f7f5ee' : '#fbfaf4',
  });
  Object.assign(dark, darkBase, {
    bg: bgDark.value,
    paper: mixHex(bgDark.value, '#000000', 0.18),
    olive: accent.darkValue,
    pale: accent.darkPale,
    glow: accent.darkGlow,
    card: bgDark.id === 'paper' ? '#1d2118' : '#23261c',
  });
};
applyPalette();

// Wispr-style: each card in a lineup gets a distinct bg+accent look.
// Predefined pairs so adjacent slides feel different without manual tweaking.
const CARD_LOOKS = [
  { light: 'sand', dark: 'night', accent: 'olive' },
  { light: 'fog', dark: 'slate', accent: 'indigo' },
  { light: 'blush', dark: 'plum', accent: 'berry' },
  { light: 'mint', dark: 'forest', accent: 'teal' },
  { light: 'butter', dark: 'umber', accent: 'clay' },
  { light: 'lilac', dark: 'navy', accent: 'indigo' },
  { light: 'olivewash', dark: 'pine', accent: 'moss' },
  { light: 'stone', dark: 'cocoa', accent: 'clay' },
  { light: 'wash', dark: 'graphite', accent: 'olive' },
  { light: 'fog', dark: 'slate', accent: 'teal' },
  { light: 'sand', dark: 'night', accent: 'berry' },
  { light: 'mint', dark: 'forest', accent: 'moss' },
  { light: 'blush', dark: 'plum', accent: 'clay' },
  { light: 'butter', dark: 'umber', accent: 'indigo' },
  { light: 'lilac', dark: 'navy', accent: 'olive' },
];
const lookFor = (index) => CARD_LOOKS[((index % CARD_LOOKS.length) + CARD_LOOKS.length) % CARD_LOOKS.length];
const paletteFromLook = (theme, look) => {
  const base = theme === 'dark' ? { ...darkBase } : { ...lightBase };
  const bgOpt = (BG_PRESETS[theme] || []).find((x) => x.id === look[theme]) || (BG_PRESETS[theme] || [])[0];
  const accent = ACCENT_PRESETS.find((x) => x.id === look.accent) || ACCENT_PRESETS[0];
  if (theme === 'dark') {
    return Object.assign(base, {
      bg: bgOpt.value,
      paper: mixHex(bgOpt.value, '#000000', 0.18),
      olive: accent.darkValue,
      pale: accent.darkPale,
      glow: accent.darkGlow,
      card: '#23261c',
    });
  }
  return Object.assign(base, {
    bg: bgOpt.value,
    paper: mixHex(bgOpt.value, '#ffffff', 0.18),
    olive: accent.value,
    pale: accent.pale,
    glow: accent.glow,
    card: '#fbfaf4',
  });
};
const syncSwatchesToLook = (look) => {
  selectedBg[currentTheme] = look[currentTheme];
  selectedAccent = look.accent;
  applyPalette();
  if (typeof paintSwatches === 'function') paintSwatches();
};

const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SIZE = { label: 34, support: 40, body: 48, footer: 34, metricFloor: 180 };
const clampSize = (size, floor = SIZE.support) => Math.max(size ?? floor, floor);
const tx = (x, y, value, o = {}) => `<text x="${x}" y="${y}" font-family="${o.font ?? F.sans}" font-size="${clampSize(o.size, o.floor ?? SIZE.support)}" fill="${o.fill ?? '#000'}" ${o.weight ? `font-weight="${o.weight}"` : ''} ${o.spacing != null ? `letter-spacing="${o.spacing}"` : ''} ${o.anchor ? `text-anchor="${o.anchor}"` : ''} ${o.italic ? 'font-style="italic"' : ''}>${esc(value)}</text>`;
// Align logo optical center to drifty.so text center (font-size 34 → ~y 813).
const mark = (p, x = 84, y = 834, opacity = 1, inv) => `<svg x="${x}" y="${y - 41}" width="148" height="41" viewBox="48 236 1680 471" preserveAspectRatio="xMinYMid meet" opacity="${opacity}"><image x="0" y="0" width="2030" height="1035" href="${LOGO}"${(inv ?? (p === dark)) ? ' filter="url(#invert)"' : ''}/></svg>`;
const footerY = (h = H) => (h >= H_RICH ? { logo: 1094, url: 1088 } : { logo: 834, url: 828 });
const footer = (p, logo = true, url = true, inv, h = H) => {
  const fy = footerY(h);
  return `${logo ? mark(p, 84, fy.logo, 1, inv) : ''}${url ? tx(1116, fy.url, 'drifty.so', { font: F.sans, size: 36.5, floor: 36.5, fill: inv ? '#e8e6da' : p.soft, anchor: 'end', spacing: 0.6 }) : ''}`;
};
// Wispr-style chrome title: sits ABOVE the white/content window, on the wash.
// Rank-ish chrome frame: equalize title↔panel and panel↔footer breathing room.
// Title baseline 111 → panel top; panel bottom → logo top (~793). Midpoint ≈ 169.
const RANK_PANEL_Y = 169;
const RANK_PANEL_H = 566;
const RANK_DY = RANK_PANEL_Y - 156; // +13 from the old tight frame
const chromeTitle = (p, text, x = 84, y = 111, anchor) => {
  const size = 61;
  return tx(x, y, text, {
    font: F.serif,
    size,
    floor: size,
    fill: p.ink,
    weight: 500,
    spacing: -0.8,
    italic: false,
    anchor,
  });
};
const fieldOf = (p) => (p === dark ? '#e9e7db' : '#1b1c17');
const onField = (p) => (p === dark ? '#1b1c17' : '#f1f0e7');
const subField = (p) => (p === dark ? '#5d5e55' : '#a6a79c');
const panel = (p, id, x, y, w, h, r = 36) => `<rect x="${x + 6}" y="${y + 18}" width="${w}" height="${h}" rx="${r}" fill="#2a2a22" opacity=".18" filter="url(#blur-${id})"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${p.card}"/>`;
const isPaperSurface = () => selectedSurface === 'paper';
const surfacePanel = (p, id, x, y, w, h, r = 36) => (
  isPaperSurface()
    ? panel(p, id, x, y, w, h, r)
    : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fieldOf(p)}"/>`
);
const surfaceInk = (p) => (isPaperSurface() ? p.ink : onField(p));
const surfaceSoft = (p) => (isPaperSurface() ? p.soft : subField(p));
const surfaceChipFill = (p) => p.olive;
const surfaceChipText = (p) => onField(p);
const wrap = (p, id, body, label, h = H) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${h}" viewBox="0 0 1200 ${h}" role="img" aria-label="${esc(label)}"><defs>
    <radialGradient id="wash-${id}" cx="1.06" cy="-0.02" r="1.02"><stop offset="0" stop-color="${p.glow}" stop-opacity=".55"/><stop offset=".44" stop-color="${p.glow}" stop-opacity=".17"/><stop offset="1" stop-color="${p.glow}" stop-opacity="0"/></radialGradient>
    <linearGradient id="trace-${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.olive}" stop-opacity=".1"/><stop offset=".5" stop-color="${p.olive}"/><stop offset="1" stop-color="${p.pale}" stop-opacity=".25"/></linearGradient>
    <linearGradient id="open-${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${p.pale}" stop-opacity=".75"/><stop offset="1" stop-color="${p.olive}" stop-opacity=".05"/></linearGradient>
    <filter id="blur-${id}"><feGaussianBlur stdDeviation="24"/></filter>
    <filter id="fog-${id}"><feTurbulence type="fractalNoise" baseFrequency=".006" numOctaves="2" seed="8" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="28"/></filter>
    <filter id="invert"><feColorMatrix type="matrix" values="-1 0 0 0 1 0 -1 0 0 1 0 0 -1 0 1 0 0 0 1 0"/></filter>
  </defs><rect width="1200" height="${h}" fill="${p.bg}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};
const wash = (id, h = H) => `<rect width="1200" height="${h}" fill="url(#wash-${id})"/>`;
const localized = (english, korean) => selectedLanguage === 'ko' ? korean : english;
const formatDuration = (minutes) => {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (selectedLanguage === 'ko') {
    if (h <= 0) return `${mm}분`;
    if (mm === 0) return `${h}시간`;
    return `${h}시간 ${mm}분`;
  }
  if (h <= 0) return `${mm}m`;
  if (mm === 0) return `${h}h`;
  return `${h}h ${String(mm).padStart(2, '0')}m`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
let RANK = null;
let WEEK_RANK = null;
let RANK_SAMPLE_SIZE = 0;
let WEEK_RANK_SAMPLE_SIZE = 0;
let RANK_IS_LIVE = false;
let WEEK_RANK_IS_LIVE = false;
let IS_CURRENT_PERIOD = false;
let DATE_LABEL = '';
let WEEK_LABEL = '';
let LIVE_RANK_PERCENT = 100;
let RANK_PLACE = 0;
let WEEK_RANK_PLACE = 0;
let FOCUS_MINUTES = 315; // 5h 15m
let TOTAL_MINUTES = 0;
let STREAK_DAYS = 12;
let PEAK_MINUTES = 400; // 6h 40m best day
let WEEK_MINUTES = 1220; // 20h 20m
let MONTH_MINUTES = 4860; // 81h this month
let SESSION_COUNT = 4; // deep sessions today
let CLIMB_PLACES = 47; // places climbed this week
let HIT_DAYS = 5; // focused days this week
// Category / productivity mixes (shareable aggregates, no app names)
let CAT_A = 42; // Workspace %
let CAT_B = 28; // Learning %
let CAT_C = 18; // Communication %
let CAT_D = 12; // Utility %
let PROD_FOCUS = 68;
let PROD_NEUTRAL = 20;
let PROD_DRIFT = 12;
let AVG_DAILY_FOCUS_MINUTES = 0;
const dailyAverageMinutes = () => Math.max(0, Math.round(AVG_DAILY_FOCUS_MINUTES));
const peakDayLabel = () => localized('Tue', '화');
const metric = () => formatDuration(FOCUS_MINUTES);
const pctLabel = (v) => String(parseFloat(v.toPrecision(2)));
let TOTAL_USERS = 2858;
const rankPlace = () => Math.max(1, RANK_PLACE);
const placeLabel = () => `#${rankPlace().toLocaleString('en-US')}`;
const totalUsersLabel = () => TOTAL_USERS.toLocaleString('en-US');
const normsInv = (prob) => {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const p = Math.min(1 - 1e-6, Math.max(1e-6, prob));
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > phigh) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
};
// gaussian marker: peak at (peakX, baseY-height), sigma sigR/sigL; returns {x, y} on the curve for the current RANK
const curveSpot = (peakX, baseY, height, sigR, sigL, minX, maxX, rank = RANK) => {
  const z = normsInv(1 - rank / 100);
  const x = Math.min(maxX, Math.max(minX, peakX + z * (z >= 0 ? sigR : sigL)));
  const y = baseY - height * Math.exp(-(z * z) / 2);
  return { x: Math.round(x), y: Math.round(y) };
};
const tag = (p, x, y, text, anchor) => tx(x, y, text, { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.2, anchor });
// YOU marker: tall lollipop in open space, dot + pill inside the fill when the text zone is in the way
const youLollipop = (p, x, y, stem = 62, r = 12) => `
  <path d="M${x} ${y - 2} V ${y - stem}" stroke="${p.olive}" stroke-width="3"/>
  <circle cx="${x}" cy="${y - stem - 8}" r="${r}" fill="${p.olive}"/>
  ${tx(x, y - stem - 48, localized('YOU', '나'), { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.2, anchor: 'middle' })}`;
const youPill = (p, x, dotY, pillY, r = 12) => `
  <circle cx="${x}" cy="${dotY}" r="${r}" fill="${p.olive}"/>
  <rect x="${x - 52}" y="${pillY}" width="104" height="46" rx="23" fill="${p.olive}"/>
  ${tx(x, pillY + 33, localized('YOU', '나'), { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: onField(p), weight: 700, spacing: 2.2, anchor: 'middle' })}`;
function curveCard(p, id) { if (RANK === null) return wideStatement(p, id); const s = curveSpot(430, 668 + RANK_DY, 68, 245, 117, 150, 1055); const pillMode = s.x < 900 && s.y < (680 + RANK_DY); return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, RANK_IS_LIVE ? localized("Today's focus percentile", "오늘의 집중 백분위") : localized("Estimated focus percentile", "예상 집중 백분위"))}
  ${panel(p, id, 70, RANK_PANEL_Y, 1060, RANK_PANEL_H, 36)}
  ${tx(112, 420 + RANK_DY, localized(`Top ${pctLabel(RANK)}%`, `상위 ${pctLabel(RANK)}%`), { font: F.serif, size: 144, fill: p.ink, spacing: -9 })}
  ${tx(120, 540 + RANK_DY, RANK_IS_LIVE ? localized('from today’s live leaderboard.', '오늘 실시간 리더보드 기준입니다.') : communityEstimateLabel(RANK_SAMPLE_SIZE), { font: F.sans, size: SIZE.support, floor: SIZE.support, fill: p.soft })}
  <path d="M120 ${668 + RANK_DY} C 240 ${664 + RANK_DY} 320 ${618 + RANK_DY} 430 ${600 + RANK_DY} C 560 ${580 + RANK_DY} 680 ${622 + RANK_DY} 810 ${648 + RANK_DY} C 910 ${664 + RANK_DY} 1000 ${668 + RANK_DY} 1080 ${668 + RANK_DY} L 1080 ${668 + RANK_DY} L 120 ${668 + RANK_DY} Z" fill="${p.pale}" opacity=".55"/>
  <path d="M120 ${668 + RANK_DY} C 240 ${664 + RANK_DY} 320 ${618 + RANK_DY} 430 ${600 + RANK_DY} C 560 ${580 + RANK_DY} 680 ${622 + RANK_DY} 810 ${648 + RANK_DY} C 910 ${664 + RANK_DY} 1000 ${668 + RANK_DY} 1080 ${668 + RANK_DY}" fill="none" stroke="${p.olive}" stroke-opacity=".45" stroke-width="3"/>
  ${pillMode ? youPill(p, s.x, s.y - 8, Math.min(s.y + 18, 660 + RANK_DY), 11) : youLollipop(p, s.x, s.y, 50, 11)}
  ${footer(p)}`, localized('Curve Card', '집중 백분위 카드')); }


function communityEstimateLabel(sampleSize) {
  return localized(`From ${sampleSize.toLocaleString('en-US')} leaderboard participants`, `리더보드 참여자 ${sampleSize.toLocaleString('ko-KR')}명 기준 추정`);
}

function weeklyFocusStatement(p, id) { return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, localized('Focus time', '집중 시간'))}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(600, 480, formatDuration(WEEK_MINUTES), { font: F.serif, size: 200, fill: p.ink, spacing: -10, anchor: 'middle' })}
  ${tx(600, 640, IS_CURRENT_PERIOD ? localized('of focused work this week.', '이번 주 집중한 시간입니다.') : localized(`of focused work in ${WEEK_LABEL}.`, `${WEEK_LABEL}에 집중한 시간입니다.`), { font: F.sans, size: SIZE.body, floor: SIZE.body, fill: p.soft, anchor: 'middle' })}
  ${footer(p)}`, localized('Weekly focus time', '주간 집중 시간')); }

function wideStatement(p, id) { return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, localized('Focus time', '집중 시간'))}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(600, 480, metric(), { font: F.serif, size: 240, fill: p.ink, spacing: -13, anchor: 'middle' })}
  ${tx(600, 640, IS_CURRENT_PERIOD ? localized('of focused work today.', '오늘 집중한 시간입니다.') : localized(`of focused work on ${DATE_LABEL}.`, `${DATE_LABEL}에 집중한 시간입니다.`), { font: F.sans, size: SIZE.body, floor: SIZE.body, fill: p.soft, spacing: -.5, anchor: 'middle' })}
  ${footer(p)}`, localized('Wide Statement', '집중 시간 카드')); }


function dayDots(p, id) {
  const count = Math.max(1, Math.min(30, STREAK_DAYS));
  const gap = count <= 1 ? 0 : Math.min(78, 920 / (count - 1));
  const startX = 146;
  const dots = Array.from({ length: count }, (_, i) => {
    const cx = startX + i * gap;
    // Lift dots above the date label so they don't collide optically.
    return i === count - 1
      ? `<circle cx="${cx}" cy="538" r="30" fill="none" stroke="${p.olive}" stroke-width="4"/><circle cx="${cx}" cy="538" r="18" fill="${p.olive}"/>`
      : `<circle cx="${cx}" cy="538" r="24" fill="${p.olive}" fill-opacity="${0.45 + (i / Math.max(1, count - 1)) * 0.55}"/>`;
  }).join('');
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, 'Focus streak')}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(112, 410, plural(STREAK_DAYS, 'day', 'days'), { font: F.serif, size: 200, fill: p.ink, spacing: -11 })}
  ${dots}
  ${tx(1080, 640, 'JUL 24 — AUG 4', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.soft, spacing: 1.6, anchor: 'end' })}
  ${footer(p)}`, 'Day Dots'); }


function rankStatement(p, id) { if (RANK === null) return wideStatement(p, id); return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, RANK_IS_LIVE ? localized("Today's focus percentile", "오늘의 집중 백분위") : localized("Estimated focus percentile", "예상 집중 백분위"))}
  ${surfacePanel(p, id, 70, RANK_PANEL_Y, 1060, RANK_PANEL_H, 36)}
  ${tx(600, 450 + RANK_DY, localized(`Top ${pctLabel(RANK)}%`, `상위 ${pctLabel(RANK)}%`), { font: F.serif, size: 180, fill: surfaceInk(p), spacing: -8, anchor: 'middle' })}
  ${tx(600, 600 + RANK_DY, RANK_IS_LIVE ? localized('from today’s live leaderboard', '오늘 실시간 리더보드 기준') : communityEstimateLabel(RANK_SAMPLE_SIZE), { font: F.sans, size: SIZE.body, floor: SIZE.body, fill: surfaceSoft(p), anchor: 'middle', spacing: -.5 })}
  ${footer(p)}`, localized('Rank Statement', '집중 백분위 카드')); }


function headCount(p, id) {
  // Place number stays primary; cohort size sits beside it as a number: #11 / 2,858
  const place = placeLabel();
  const total = totalUsersLabel();
  const placeSize = 180;
  const placeApproxW = Math.max(180, place.length * 92);
  const scopeX = 112 + placeApproxW + 18;
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, localized("Today's focus rank", "오늘의 집중 순위"))}
  ${panel(p, id, 70, RANK_PANEL_Y, 1060, RANK_PANEL_H, 36)}
  ${tx(112, 430 + RANK_DY, place, { font: F.serif, size: placeSize, fill: p.ink, spacing: -9 })}
  ${tx(scopeX, 430 + RANK_DY, `/ ${total}`, { font: F.sans, size: 42, floor: 42, fill: p.soft, spacing: -0.4 })}
  <rect x="120" y="${486 + RANK_DY}" width="252" height="58" rx="29" fill="${p.olive}"/>
  ${tx(246, 526 + RANK_DY, localized(`TOP ${pctLabel(LIVE_RANK_PERCENT)}%`, `상위 ${pctLabel(LIVE_RANK_PERCENT)}%`), { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: onField(p), weight: 700, spacing: 1.6, anchor: 'middle' })}
  ${tx(120, 620 + RANK_DY, localized('in today’s focus ranking.', '오늘 집중 순위 기준입니다.'), { font: F.sans, size: SIZE.body, floor: SIZE.body, fill: p.soft, spacing: -.5 })}
  ${footer(p)}`, localized('Head Count', '집중 순위 카드'));
}


function weekAverage(p, id) {
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, IS_CURRENT_PERIOD ? localized('This week', '이번 주') : WEEK_LABEL)}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(112, 300, localized('TRACKED-DAY AVG', '기록일 평균'), { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.2 })}
  ${tx(112, 500, formatDuration(dailyAverageMinutes()), { font: F.serif, size: 176, fill: p.ink, spacing: -9 })}
  ${tx(120, 610, IS_CURRENT_PERIOD ? localized('focused per tracked day this week.', '이번 주 기록이 있는 날의 평균 집중 시간입니다.') : localized('focused per tracked day that week.', '해당 주 기록이 있는 날의 평균 집중 시간입니다.'), { font: F.sans, size: SIZE.body, floor: SIZE.body, fill: p.soft, spacing: -.5 })}
  ${footer(p)}`, localized('Week Average', '주간 평균 카드'));
}

function peakDay(p, id) {
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, 'This week')}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(112, 300, 'BEST DAY', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.2 })}
  ${tx(112, 500, formatDuration(PEAK_MINUTES), { font: F.serif, size: 160, fill: p.ink, spacing: -8 })}
  ${tx(120, 650, peakDayLabel(), { font: F.serif, size: 64, fill: p.ink, spacing: -1.2 })}
  ${tx(1080, 650, 'AUG 5', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.soft, spacing: 1.6, anchor: 'end' })}
  ${footer(p)}`, 'Peak Day');
}


function weekRange(p, id) { return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, 'This week')}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  <path d="M820 218 V 668" stroke="${p.bg}" stroke-width="5" stroke-dasharray="2 20" stroke-linecap="round"/>
  <circle cx="820" cy="218" r="14" fill="${p.bg}"/><circle cx="820" cy="668" r="14" fill="${p.bg}"/>
  ${tx(112, 500, formatDuration(WEEK_MINUTES), { font: F.serif, size: 168, fill: p.ink, spacing: -9 })}
  ${tx(950, 360, 'WEEK 32', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.2, anchor: 'middle' })}
  ${tx(950, 480, 'Pass', { font: F.serif, size: 68, fill: p.ink, spacing: -1.5, italic: true, anchor: 'middle' })}
  ${tx(950, 560, 'AUG 3 – 9', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.soft, spacing: 1.6, anchor: 'middle' })}
  ${footer(p)}`, 'Week Range'); }



// Unique paper variants kept after merge (others were near-duplicates of Current).

function weeklyCurve(p, id) {
  if (WEEK_RANK === null) return weeklyFocusStatement(p, id);
  const s = curveSpot(430, 668 + RANK_DY, 68, 245, 117, 150, 1055, WEEK_RANK);
  const pillMode = s.x < 900 && s.y < (680 + RANK_DY);
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, WEEK_RANK_IS_LIVE ? localized('This week’s focus percentile', '이번 주 집중 백분위') : localized('Estimated weekly percentile', '예상 주간 백분위'))}
  ${panel(p, id, 70, RANK_PANEL_Y, 1060, RANK_PANEL_H, 36)}
  ${tx(112, 420 + RANK_DY, localized(`Top ${pctLabel(WEEK_RANK)}%`, `상위 ${pctLabel(WEEK_RANK)}%`), { font: F.serif, size: 144, fill: p.ink, spacing: -9 })}
  ${tx(120, 540 + RANK_DY, WEEK_RANK_IS_LIVE ? localized('from the live weekly leaderboard.', '실시간 주간 리더보드 기준입니다.') : communityEstimateLabel(WEEK_RANK_SAMPLE_SIZE), { font: F.sans, size: SIZE.support, floor: SIZE.support, fill: p.soft })}
  <path d="M120 ${668 + RANK_DY} C 240 ${664 + RANK_DY} 320 ${618 + RANK_DY} 430 ${600 + RANK_DY} C 560 ${580 + RANK_DY} 680 ${622 + RANK_DY} 810 ${648 + RANK_DY} C 910 ${664 + RANK_DY} 1000 ${668 + RANK_DY} 1080 ${668 + RANK_DY} L 1080 ${668 + RANK_DY} L 120 ${668 + RANK_DY} Z" fill="${p.pale}" opacity=".55"/>
  <path d="M120 ${668 + RANK_DY} C 240 ${664 + RANK_DY} 320 ${618 + RANK_DY} 430 ${600 + RANK_DY} C 560 ${580 + RANK_DY} 680 ${622 + RANK_DY} 810 ${648 + RANK_DY} C 910 ${664 + RANK_DY} 1000 ${668 + RANK_DY} 1080 ${668 + RANK_DY}" fill="none" stroke="${p.olive}" stroke-opacity=".45" stroke-width="3"/>
  ${pillMode ? youPill(p, s.x, s.y - 8, Math.min(s.y + 18, 660 + RANK_DY), 11) : youLollipop(p, s.x, s.y, 50, 11)}
  ${footer(p)}`, localized('Weekly Curve Card', '주간 집중 백분위 카드'));
}


function comboFocus(p, id) {
  if (RANK === null) return wideStatement(p, id);
  // Hours stay the hero; rank becomes a compact olive seal.
  // Ink/Paper surface is controlled by the global toggle (not a separate card).
  const chipText = selectedLanguage === 'ko'
    ? `${RANK_IS_LIVE ? '상위' : '예상 상위'} ${pctLabel(RANK)}%`
    : `${RANK_IS_LIVE ? 'TOP' : 'EST. TOP'} ${pctLabel(RANK)}%`;
  const chipW = Math.max(236, 56 + chipText.length * 22);
  const chipX = 140;
  const chipY = 552;
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, localized('Focus time', '집중 시간'))}
  ${surfacePanel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(140, 286, IS_CURRENT_PERIOD ? localized('TODAY', '오늘') : DATE_LABEL.toUpperCase(), { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.4 })}
  ${tx(140, 488, metric(), { font: F.serif, size: 168, fill: surfaceInk(p), spacing: -8.5 })}
  <rect x="${chipX}" y="${chipY}" width="${chipW}" height="64" rx="32" fill="${p.olive}"/>
  ${tx(chipX + chipW / 2, chipY + 42, chipText, { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: onField(p), weight: 700, spacing: 1.8, anchor: 'middle' })}
  ${footer(p)}`, localized('Focus + Rank', '집중 시간과 백분위'));
}




const CATEGORY_COLORS_LIGHT = {
  workspace: '#5f7f31',
  learning: '#2f7f78',
  communication: '#476f8f',
  utility: '#66707a',
  other: '#8b877e',
  unknown: '#b2aea5',
};
const CATEGORY_COLORS_DARK = {
  workspace: '#9bbf5a',
  learning: '#5fb7ad',
  communication: '#7fa2c2',
  utility: '#8a98a4',
  other: '#77756e',
  unknown: '#5f5e58',
};
const PRODUCTIVITY_COLORS_LIGHT = {
  focus: '#4f751e',
  neutral: '#9b968b',
  drift: '#a34139',
};
const PRODUCTIVITY_COLORS_DARK = {
  focus: '#b7d96b',
  neutral: '#8f897d',
  drift: '#e87568',
};
const categoryPalette = (p) => (p === dark ? CATEGORY_COLORS_DARK : CATEGORY_COLORS_LIGHT);
const productivityPalette = (p) => (p === dark ? PRODUCTIVITY_COLORS_DARK : PRODUCTIVITY_COLORS_LIGHT);
const formatHoursDecimal = (minutes) => {
  const hours = Math.max(0, Math.round((minutes / 60) * 10) / 10);
  return selectedLanguage === 'ko' ? `${hours.toFixed(1)}시간` : `${hours.toFixed(1)}h`;
};
const pointOnCircle = (cx, cy, r, ratio) => {
  const radians = ratio * 360 * (Math.PI / 180);
  return { x: cx + Math.cos(radians) * r, y: cy + Math.sin(radians) * r };
};
const donutArcPath = (cx, cy, radius, startRatio, endRatio) => {
  const arcRatio = Math.max(0, endRatio - startRatio);
  if (arcRatio >= 1) {
    return `M ${cx + radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx - radius} ${cy} A ${radius} ${radius} 0 1 1 ${cx + radius} ${cy}`;
  }
  const start = pointOnCircle(cx, cy, radius, startRatio);
  const end = pointOnCircle(cx, cy, radius, endRatio);
  const largeArcFlag = arcRatio > 0.5 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
};
const buildDonutArcSegments = (entries, getRatio, cx, cy, radius, gapRatio = 0) => {
  let cursor = 0;
  return entries.map((entry) => {
    const ratio = Math.max(0, getRatio(entry));
    const visibleRatio = Math.max(0, ratio - gapRatio);
    const pathData = donutArcPath(cx, cy, radius, cursor, cursor + visibleRatio);
    cursor += ratio;
    return { entry, pathData };
  });
};
const categoryEntries = () => (categoryOverride ?? []).map((entry) => ({
  key: entry.key,
  label: entry.label,
  pct: entry.pct,
  minutes: entry.minutes,
}));
const productivityEntries = () => productivityOverride ?? ([
  { key: 'focus', label: localized('Focus', '집중'), pct: PROD_FOCUS },
  { key: 'neutral', label: localized('Neutral', '중립'), pct: PROD_NEUTRAL },
  { key: 'drift', label: localized('Drift', '딴짓'), pct: PROD_DRIFT },
]);
const categoryColorsForEntries = (p, entries) => {
  const palette = categoryPalette(p);
  const fallback = p === dark
    ? ['#b7d96b', '#7fa2c2', '#d6aa79', '#cc95bb']
    : ['#4f751e', '#476f8f', '#a96e42', '#8a4b68'];
  return Object.fromEntries(entries.map((entry, index) => [entry.key, palette[entry.key] ?? fallback[index % fallback.length]]));
};
const compactStackedBar = (p, id, x, y, w, h, entries, colors, getPct) => {
  let cursor = x;
  const segments = entries.map((entry) => {
    const segW = Math.max(0, w * (getPct(entry) / 100));
    const seg = segW > 0.5
      ? `<rect x="${cursor}" y="${y}" width="${segW}" height="${h}" fill="${colors[entry.key]}"/>`
      : '';
    cursor += segW;
    return seg;
  }).join('');
  const track = p === dark ? '#2a2a22' : '#e8e6dc';
  return `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${track}" opacity=".42"/>
  <clipPath id="bar-clip-${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/></clipPath>
  <g clip-path="url(#bar-clip-${id})">${segments}</g>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="none" stroke="${p.ink}" stroke-opacity=".08" stroke-width="2"/>`;
};
const PANEL_TOP = 188;
const PANEL_H = 510;
const PANEL_MID_Y = PANEL_TOP + PANEL_H / 2;
const compactLegendRows = (p, x, y, entries, colors, getPct, formatValue, rowGap = 72, valueX = 540, labelSize = 36, valueSize = 30, swatchR = 10) => entries.map((entry, i) => {
  const ly = y + i * rowGap;
  const pct = getPct(entry);
  const value = formatValue(pct, entry);
  return `
  <circle cx="${x}" cy="${ly}" r="${swatchR}" fill="${colors[entry.key]}"/>
  ${tx(x + 32 + (swatchR - 10), ly + 10, entry.label, { font: F.sans, size: labelSize, floor: labelSize, fill: p.ink, spacing: -.2 })}
  ${tx(valueX, ly + 10, value, { font: F.mono, size: valueSize, floor: valueSize, fill: p.soft, anchor: 'end' })}`;
}).join('');
const compactDonut = (p, entries, colors, cx, cy, size = 300) => {
  const active = entries.filter((entry) => entry.pct > 0);
  const gap = active.length > 1 ? 1.6 / (2 * Math.PI * 40) : 0;
  const segments = buildDonutArcSegments(active, (entry) => entry.pct / 100, 50, 50, 40, gap);
  const trackColor = p === dark ? 'rgba(241,240,231,0.08)' : 'rgba(27,28,23,0.07)';
  const ringStroke = p === dark ? 'rgba(241,240,231,0.12)' : 'rgba(27,28,23,0.09)';
  const half = size / 2;
  const arcs = segments.map(({ entry, pathData }) => `<path d="${pathData}" fill="none" stroke="${colors[entry.key]}" stroke-width="18" stroke-linecap="butt"/>`).join('');
  return `
  <svg x="${cx - half}" y="${cy - half}" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="40.8" fill="none" stroke="${ringStroke}" stroke-width="1.2"/>
    <circle cx="50" cy="50" r="40" fill="none" stroke="${trackColor}" stroke-width="18"/>
    <g transform="rotate(-90 50 50)">${arcs}</g>
  </svg>`;
};

// --- Extra lineup: unique shareable stories NOT covered by Unified ---
// Keep out of Unified space: today rank curve/statement/place, focus hours,
// hours+rank combo, week total/avg, week rank curve, streak dots.
function dashMonth(p, id) {
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, 'This month')}
  ${panel(p, id, 70, 188, 1060, 510, 36)}
  ${tx(112, 340, 'MONTH TOTAL', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.2 })}
  ${tx(112, 520, formatDuration(MONTH_MINUTES), { font: F.serif, size: 176, fill: p.ink, spacing: -9 })}
  ${tx(120, 640, 'AUG 2026', { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.soft, spacing: 1.6 })}
  ${footer(p)}`, 'Month Marathon');
}
function dashCategory(p, id) {
  const entries = categoryEntries();
  const colors = categoryColorsForEntries(p, entries);
  const innerX = 140;
  const innerW = 920;
  const valueX = innerX + innerW;
  const barH = 52;
  const barLegendGap = 48;
  const rowGap = 72;
  const legendRows = entries.length;
  const blockH = barH + barLegendGap + (legendRows - 1) * rowGap + 36;
  const barY = Math.round(PANEL_MID_Y - blockH / 2);
  const legendY = barY + barH + barLegendGap;
  const content = entries.length > 0
    ? `${compactStackedBar(p, id, innerX, barY, innerW, barH, entries, colors, (entry) => entry.pct)}
  ${compactLegendRows(p, innerX, legendY, entries, colors, (entry) => entry.pct, (_pct, entry) => formatDuration(entry.minutes), rowGap, valueX)}`
    : `${tx(600, PANEL_MID_Y + 12, localized('No categorized activity yet.', '아직 분류된 활동이 없습니다.'), { font: F.sans, size: SIZE.body, floor: SIZE.body, fill: p.soft, anchor: 'middle' })}`;
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, localized('Categories', '카테고리'))}
  ${panel(p, id, 70, PANEL_TOP, 1060, PANEL_H, 36)}
  ${content}
  ${footer(p)}`, localized('Categories', '카테고리'));
}
function dashProductivity(p, id) {
  const colors = productivityPalette(p);
  const entries = productivityEntries().filter((entry) => entry.pct > 0);
  const panelX = 70;
  const panelW = 1060;
  // ~20% larger dial + wider legend gaps; shrink side margins by centering a wider block.
  const dialSize = 336;
  const legendGap = 72;
  const legendColW = 360;
  const rowGap = 100;
  const blockW = dialSize + legendGap + legendColW;
  const blockLeft = panelX + Math.round((panelW - blockW) / 2);
  const dialCx = blockLeft + dialSize / 2;
  const dialCy = PANEL_MID_Y;
  const legendX = blockLeft + dialSize + legendGap;
  const valueX = legendX + legendColW;
  const legendY = dialCy - rowGap;
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, localized('Productivity', '생산성'))}
  ${panel(p, id, 70, PANEL_TOP, 1060, PANEL_H, 36)}
  ${compactDonut(p, entries, colors, dialCx, dialCy, dialSize)}
  ${tx(dialCx, dialCy + 18, `${PROD_FOCUS}%`, { font: F.mono, size: 58, floor: 58, fill: p.ink, weight: 760, anchor: 'middle' })}
  ${compactLegendRows(p, legendX, legendY, entries, colors, (entry) => entry.pct, (_pct, entry) => formatHoursDecimal(entry.minutes), rowGap, valueX, 48, 44, 14)}
  ${footer(p)}`, localized('Productivity', '생산성'));
}


let WEEK_DAY_MINUTES = [280, 420, 315, 190, 360, 1220 / 7 | 0, 240];
const WEEK_DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const FLOW_BLOCKS = [
  { label: 'Focus', minutes: 95, tone: 'focus' },
  { label: 'Neutral', minutes: 42, tone: 'neutral' },
  { label: 'Drift', minutes: 28, tone: 'drift' },
  { label: 'Focus', minutes: 72, tone: 'focus' },
  { label: 'Neutral', minutes: 38, tone: 'neutral' },
  { label: 'Focus', minutes: 50, tone: 'focus' },
];
const DRIFT_FOCUS = [18, 24, 32, 48, 62, 74, 68, 58, 44, 36, 28, 22];
const DRIFT_DRIFT = [8, 10, 12, 10, 8, 6, 5, 7, 9, 12, 14, 10];
const toneColor = (p, tone) => {
  const pal = productivityPalette(p);
  return pal[tone] || pal.neutral;
};
const smoothLine = (points) => {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const cur = points[i];
    const cx = (prev.x + cur.x) / 2;
    d += ` C ${cx} ${prev.y}, ${cx} ${cur.y}, ${cur.x} ${cur.y}`;
  }
  return d;
};
const chartFrame = (p, x, y, w, h) => `
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="22" fill="${p === dark ? '#1f2119' : '#f4f2ea'}" stroke="${p.ink}" stroke-opacity=".06" stroke-width="2"/>
  <line x1="${x + 24}" y1="${y + h - 36}" x2="${x + w - 24}" y2="${y + h - 36}" stroke="${p.ink}" stroke-opacity=".08" stroke-width="2"/>
  <line x1="${x + 24}" y1="${y + 24}" x2="${x + 24}" y2="${y + h - 36}" stroke="${p.ink}" stroke-opacity=".08" stroke-width="2"/>`;
const statChip = (p, x, y, label, value, width = 220) => `
  <rect x="${x}" y="${y}" width="${width}" height="72" rx="18" fill="${p === dark ? '#2a2d22' : '#ffffff'}" stroke="${p.ink}" stroke-opacity=".06" stroke-width="2"/>
  ${tx(x + 18, y + 28, label, { font: F.mono, size: 26, floor: 26, fill: p.olive, weight: 700, spacing: 1.4 })}
  ${tx(x + width - 18, y + 52, value, { font: F.mono, size: 30, floor: 30, fill: p.ink, weight: 650, anchor: 'end' })}`;
const chipRow = (p, rightX, y, items, gap = 16) => {
  const widths = items.map(([, , width = 220]) => width);
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, items.length - 1);
  let cursor = rightX - total;
  return items.map(([label, value, width = 220]) => {
    const chip = statChip(p, cursor, y, label, value, width);
    cursor += width + gap;
    return chip;
  }).join('');
};
const miniFlowBlocks = (p, x, y, w, h, blocks) => {
  const total = blocks.reduce((sum, b) => sum + b.minutes, 0) || 1;
  const focusMin = blocks.filter((b) => b.tone === 'focus').reduce((sum, b) => sum + b.minutes, 0);
  const driftMin = blocks.filter((b) => b.tone === 'drift').reduce((sum, b) => sum + b.minutes, 0);
  const neutralMin = blocks.filter((b) => b.tone === 'neutral').reduce((sum, b) => sum + b.minutes, 0);
  let cursor = x + 36;
  const innerW = w - 72;
  const barH = 96;
  const barY = y + Math.round((h - barH) / 2) - 8;
  const segs = blocks.map((block) => {
    const segW = Math.max(14, (innerW - 20) * (block.minutes / total));
    const seg = `<rect x="${cursor}" y="${barY}" width="${segW}" height="${barH}" rx="16" fill="${toneColor(p, block.tone)}"/>`;
    cursor += segW + 4;
    return seg;
  }).join('');
  return `${chartFrame(p, x, y, w, h)}
  ${tx(x + 36, y + 44, 'TODAY FLOW', { font: F.mono, size: 30, floor: 30, fill: p.ink, weight: 700, spacing: 1.6 })}
  <circle cx="${x + 250}" cy="${y + 36}" r="7" fill="${toneColor(p, 'focus')}"/>
  ${tx(x + 266, y + 42, 'Focus', { font: F.sans, size: 24, floor: 24, fill: p.soft })}
  <circle cx="${x + 360}" cy="${y + 36}" r="7" fill="${toneColor(p, 'neutral')}"/>
  ${tx(x + 376, y + 42, 'Neutral', { font: F.sans, size: 24, floor: 24, fill: p.soft })}
  <circle cx="${x + 488}" cy="${y + 36}" r="7" fill="${toneColor(p, 'drift')}"/>
  ${tx(x + 504, y + 42, 'Drift', { font: F.sans, size: 24, floor: 24, fill: p.soft })}
  ${tx(x + w - 36, y + 42, `${formatDuration(focusMin)} focus · ${formatDuration(driftMin)} drift`, { font: F.mono, size: 24, floor: 24, fill: p.soft, anchor: 'end' })}
  ${segs}
  ${tx(x + 36, barY + barH + 42, 'MORNING', { font: F.mono, size: 24, floor: 24, fill: p.soft })}
  ${tx(x + w / 2, barY + barH + 42, 'MIDDAY', { font: F.mono, size: 24, floor: 24, fill: p.soft, anchor: 'middle' })}
  ${tx(x + w - 36, barY + barH + 42, 'EVENING', { font: F.mono, size: 24, floor: 24, fill: p.soft, anchor: 'end' })}
  <line x1="${x + 36}" y1="${y + h - 54}" x2="${x + w - 36}" y2="${y + h - 54}" stroke="${p.ink}" stroke-opacity=".08" stroke-width="2"/>
  ${tx(x + 36, y + h - 24, `${blocks.length} blocks · ${formatDuration(neutralMin)} neutral`, { font: F.mono, size: 24, floor: 24, fill: p.soft })}`;
};
const driftGraph = (p, id, x, y, w, h, focusVals, driftVals) => {
  const padL = 24;
  const padR = 24;
  const padT = 28;
  const padB = 36;
  const plotX = x + padL;
  const plotY = y + padT;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxV = Math.max(...focusVals, ...driftVals, 1);
  const pts = (vals, color, opacity = 1) => {
    const points = vals.map((v, i) => ({
      x: plotX + (i / Math.max(1, vals.length - 1)) * plotW,
      y: plotY + plotH - (v / maxV) * plotH,
    }));
    const line = smoothLine(points);
    const area = `${line} L ${points[points.length - 1].x} ${plotY + plotH} L ${points[0].x} ${plotY + plotH} Z`;
    return `<path d="${area}" fill="${color}" fill-opacity="${opacity * 0.18}"/><path d="${line}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
  };
  return `${chartFrame(p, x, y, w, h)}
  ${pts(driftVals, toneColor(p, 'drift'), 0.9)}
  ${pts(focusVals, toneColor(p, 'focus'), 1)}
  ${tx(x + 24, y + 24, 'FOCUS VS DRIFT', { font: F.mono, size: 28, floor: 28, fill: p.soft, weight: 700, spacing: 1.6 })}
  ${tx(x + w - 24, y + h - 12, 'TODAY', { font: F.mono, size: 24, floor: 24, fill: p.soft, anchor: 'end', spacing: 1.4 })}`;
};
const weekRhythm = (p, x, y, w, h, values, labels) => {
  const max = Math.max(...values, 1);
  const gap = 22;
  const barW = (w - 64 - gap * (values.length - 1)) / values.length;
  const baseY = y + h - 44;
  const bars = values.map((v, i) => {
    const barH = Math.max(24, (v / max) * (h - 112));
    const bx = x + 32 + i * (barW + gap);
    const by = baseY - barH;
    const tone = i === 5 ? p.olive : toneColor(p, 'focus');
    return `
    <rect x="${bx}" y="${by}" width="${barW}" height="${barH}" rx="12" fill="${tone}" opacity="${i === 5 ? 1 : 0.72}"/>
    ${tx(bx + barW / 2, baseY + 28, labels[i], { font: F.mono, size: 26, floor: 26, fill: p.soft, anchor: 'middle' })}`;
  }).join('');
  return `${chartFrame(p, x, y, w, h)}
  ${tx(x + 32, y + 36, 'WEEKLY ATTENTION', { font: F.mono, size: 28, floor: 28, fill: p.soft, weight: 700, spacing: 1.6 })}
  ${tx(x + w - 32, y + 36, `avg ${formatDuration(Math.round(values.reduce((a,b)=>a+b,0)/values.length))}`, { font: F.mono, size: 24, floor: 24, fill: p.soft, anchor: 'end' })}
  ${bars}`;
};

function richDrift(p, id) {
  const ox = 70;
  const oy = 202;
  const pw = 1060;
  const ph = 760;
  const pad = 48;
  const ix = ox + pad;
  const iw = pw - pad * 2;
  const chipY = 334;
  const chartY = 454;
  const chartH = 440;
  return wrap(p, id, `${wash(id, H_RICH)}
  ${chromeTitle(p, 'Focus drift')}
  ${panel(p, id, ox, oy, pw, ph, 40)}
  ${tx(ix, 284, formatDuration(FOCUS_MINUTES), { font: F.serif, size: 100, fill: p.ink, spacing: -3.2 })}
  ${tx(ix + 380, 284, RANK === null ? '' : `${RANK_IS_LIVE ? 'TOP' : 'EST. TOP'} ${pctLabel(RANK)}%`, { font: F.mono, size: 36, floor: 36, fill: p.olive, weight: 700, spacing: 1.4 })}
  ${statChip(p, ix, chipY, 'QUALITY', `${PROD_FOCUS}%`, 220)}
  ${statChip(p, ix + 244, chipY, 'DRIFT', `${PROD_DRIFT}%`, 200)}
  ${statChip(p, ix + 468, chipY, 'SESSIONS', String(SESSION_COUNT), 200)}
  ${statChip(p, ix + 692, chipY, 'RANK', `#${rankPlace().toLocaleString('en-US')}`, 200)}
  ${driftGraph(p, id, ix, chartY, iw, chartH, DRIFT_FOCUS, DRIFT_DRIFT)}
  ${footer(p, true, true, undefined, H_RICH)}`, 'Focus Drift', H_RICH);
}

function richFlow(p, id) {
  const ox = 70;
  const oy = 202;
  const pw = 1060;
  const ph = 760;
  const pad = 48;
  const ix = ox + pad;
  const iw = pw - pad * 2;
  const chipY = 334;
  const flowY = 454;
  const flowH = 440;
  return wrap(p, id, `${wash(id, H_RICH)}
  ${chromeTitle(p, 'Flow chart')}
  ${panel(p, id, ox, oy, pw, ph, 40)}
  ${tx(ix, 284, metric(), { font: F.serif, size: 100, fill: p.ink, spacing: -3.2 })}
  ${tx(ix + 380, 284, RANK === null ? '' : `${RANK_IS_LIVE ? 'TOP' : 'EST. TOP'} ${pctLabel(RANK)}%`, { font: F.mono, size: 36, floor: 36, fill: p.olive, weight: 700, spacing: 1.4 })}
  ${statChip(p, ix, chipY, 'FOCUS', `${PROD_FOCUS}%`, 210)}
  ${statChip(p, ix + 234, chipY, 'DRIFT', `${PROD_DRIFT}%`, 200)}
  ${statChip(p, ix + 458, chipY, 'NEUTRAL', `${PROD_NEUTRAL}%`, 210)}
  ${statChip(p, ix + 692, chipY, 'STREAK', plural(STREAK_DAYS, 'day', 'days'), 200)}
  ${miniFlowBlocks(p, ix, flowY, iw, flowH, FLOW_BLOCKS)}
  ${footer(p, true, true, undefined, H_RICH)}`, 'Flow Chart', H_RICH);
}

function richWeekly(p, id) {
  const ox = 70;
  const oy = 202;
  const pw = 1060;
  const ph = 760;
  const pad = 48;
  const ix = ox + pad;
  const iw = pw - pad * 2;
  const chipY = 334;
  const chartY = 454;
  const chartH = 440;
  const weekVals = WEEK_DAY_MINUTES.map((m, i) => i === 5 ? Math.max(...WEEK_DAY_MINUTES) : Math.round(m));
  return wrap(p, id, `${wash(id, H_RICH)}
  ${chromeTitle(p, 'Weekly attention rhythm')}
  ${panel(p, id, ox, oy, pw, ph, 40)}
  ${tx(ix, 284, formatDuration(WEEK_MINUTES), { font: F.serif, size: 100, fill: p.ink, spacing: -3.2 })}
  ${tx(ix + 380, 284, WEEK_RANK === null ? '' : `${WEEK_RANK_IS_LIVE ? 'WEEK TOP' : 'EST. WEEK TOP'} ${pctLabel(WEEK_RANK)}%`, { font: F.mono, size: 36, floor: 36, fill: p.olive, weight: 700, spacing: 1.4 })}
  ${statChip(p, ix, chipY, 'DAILY AVG', formatDuration(dailyAverageMinutes()), 230)}
  ${statChip(p, ix + 254, chipY, 'FOCUSED', `${HIT_DAYS}/7`, 180)}
  ${statChip(p, ix + 458, chipY, 'BEST DAY', formatDuration(PEAK_MINUTES), 220)}
  ${statChip(p, ix + 702, chipY, 'CLIMBED', `+${CLIMB_PLACES}`, 180)}
  ${weekRhythm(p, ix, chartY, iw, chartH, weekVals, WEEK_DAY_LABELS)}
  ${footer(p, true, true, undefined, H_RICH)}`, 'Weekly Rhythm', H_RICH);
}

function richBoard(p, id) {
  const gap = 24;
  const tileW = (1060 - gap) / 2;
  const tileH = (760 - gap) / 2;
  const ox = 70;
  const oy = 202;
  const colors = categoryPalette(p);
  const prodColors = productivityPalette(p);
  const entries = categoryEntries();
  const prodEntries = productivityEntries().filter((e) => e.pct > 0);
  const tiles = [
    {
      title: 'FOCUS TIME',
      body: (x, y) => `${tx(x + 40, y + 170, metric(), { font: F.serif, size: 104, fill: p.ink, spacing: -3 })}
      ${tx(x + 40, y + 250, RANK === null ? '' : `${RANK_IS_LIVE ? 'TOP' : 'EST. TOP'} ${pctLabel(RANK)}%`, { font: F.mono, size: 36, floor: 36, fill: p.olive, weight: 700, spacing: 1.4 })}
      ${tx(x + 40, y + 310, `#${rankPlace().toLocaleString('en-US')} / ${totalUsersLabel()}`, { font: F.mono, size: 30, floor: 30, fill: p.soft, spacing: 1.1 })}
      ${tx(x + 40, y + 360, `${SESSION_COUNT} sessions`, { font: F.sans, size: 30, floor: 30, fill: p.soft })}`,
    },
    {
      title: 'PRODUCTIVITY',
      body: (x, y) => `${compactDonut(p, prodEntries, prodColors, x + 130, y + 220, 220)}
      ${tx(x + 130, y + 236, `${PROD_FOCUS}%`, { font: F.mono, size: 42, floor: 42, fill: p.ink, weight: 760, anchor: 'middle' })}
      ${compactLegendRows(p, x + 270, y + 160, prodEntries, prodColors, (e) => e.pct, (_pct, entry) => formatHoursDecimal(entry.minutes), 64, x + tileW - 36, 34, 30, 10)}`,
    },
    {
      title: 'CATEGORIES',
      body: (x, y) => `${compactStackedBar(p, id + '-b', x + 40, y + 150, tileW - 80, 52, entries, colors, (e) => e.pct)}
      ${compactLegendRows(p, x + 40, y + 240, entries, colors, (e) => e.pct, (_pct, entry) => formatDuration(entry.minutes), 52, x + tileW - 36, 28, 26, 8)}`,
    },
    {
      title: 'WEEK SNAPSHOT',
      body: (x, y) => `${tx(x + 40, y + 170, formatDuration(WEEK_MINUTES), { font: F.serif, size: 96, fill: p.ink, spacing: -2.8 })}
      ${tx(x + 40, y + 250, WEEK_RANK === null ? '' : `${WEEK_RANK_IS_LIVE ? 'WEEK TOP' : 'EST. WEEK TOP'} ${pctLabel(WEEK_RANK)}%`, { font: F.mono, size: 34, floor: 34, fill: p.olive, weight: 700, spacing: 1.4 })}
      ${tx(x + 40, y + 310, `${HIT_DAYS}/7 focused days`, { font: F.sans, size: 32, floor: 32, fill: p.soft })}
      ${tx(x + 40, y + 360, plural(STREAK_DAYS, 'day', 'days') + ' streak', { font: F.sans, size: 32, floor: 32, fill: p.soft })}
      ${tx(x + 40, y + 410, `+${CLIMB_PLACES} places · ${formatDuration(MONTH_MINUTES)} month`, { font: F.sans, size: 30, floor: 30, fill: p.soft })}`,
    },
  ];
  const blocks = tiles.map((tile, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = ox + col * (tileW + gap);
    const y = oy + row * (tileH + gap);
    return `
    <rect x="${x + 4}" y="${y + 10}" width="${tileW}" height="${tileH}" rx="30" fill="#2a2a22" opacity=".12" filter="url(#blur-${id})"/>
    <rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="30" fill="${p.card}"/>
    ${tx(x + 40, y + 56, tile.title, { font: F.mono, size: 30, floor: 30, fill: p.olive, weight: 700, spacing: 1.8 })}
    ${tile.body(x, y)}`;
  }).join('');
  return wrap(p, id, `${wash(id, H_RICH)}
  ${chromeTitle(p, 'Dashboard board')}
  ${blocks}
  ${footer(p, true, true, undefined, H_RICH)}`, 'Dashboard Board', H_RICH);
}

function richPulse(p, id) {
  const ox = 70;
  const oy = 202;
  const pw = 1060;
  const ph = 760;
  const pad = 48;
  const ix = ox + pad;
  const leftW = 430;
  const rightX = ix + leftW + 36;
  const rightW = pw - pad * 2 - leftW - 36;
  const colors = productivityPalette(p);
  const entries = productivityEntries().filter((e) => e.pct > 0);
  const cats = categoryEntries();
  const catColors = categoryPalette(p);
  return wrap(p, id, `${wash(id, H_RICH)}
  ${chromeTitle(p, 'Today pulse')}
  ${panel(p, id, ox, oy, pw, ph, 40)}
  ${tx(ix, 284, metric(), { font: F.serif, size: 100, fill: p.ink, spacing: -3.2 })}
  ${tx(ix, 350, `#${rankPlace().toLocaleString('en-US')} / ${totalUsersLabel()}`, { font: F.mono, size: 32, floor: 32, fill: p.soft, spacing: 1.2 })}
  ${statChip(p, ix, 390, 'SESSIONS', String(SESSION_COUNT), 200)}
  ${statChip(p, ix + 220, 390, 'STREAK', plural(STREAK_DAYS, 'day', 'days'), 210)}
  ${compactDonut(p, entries, colors, ix + 210, 590, 250)}
  ${tx(ix + 210, 606, `${PROD_FOCUS}%`, { font: F.mono, size: 44, floor: 44, fill: p.ink, weight: 760, anchor: 'middle' })}
  ${compactStackedBar(p, id + '-pulse-cat', ix, 760, leftW, 34, cats, catColors, (e) => e.pct)}
  ${driftGraph(p, id + '-p', rightX, 284, rightW, 580, DRIFT_FOCUS, DRIFT_DRIFT)}
  ${footer(p, true, true, undefined, H_RICH)}`, 'Today Pulse', H_RICH);
}

function dashQuad(p, id) {
  // Four separate white tiles (not one panel with divider lines).
  const tiles = [
    { label: 'SESSIONS', value: String(SESSION_COUNT) },
    { label: 'CLIMBED', value: String(CLIMB_PLACES) },
    { label: 'FOCUSED', value: `${HIT_DAYS}/7` },
    { label: 'STREAK', value: String(STREAK_DAYS) },
  ];
  const gap = 28;
  const tileW = (1060 - gap) / 2;
  const tileH = (510 - gap) / 2;
  const originX = 70;
  const originY = 188;
  const blocks = tiles.map((t, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = originX + col * (tileW + gap);
    const y = originY + row * (tileH + gap);
    const cx = x + 36;
    const cy = y + 78;
    // Small inset cards: soft shadow + white fill, matching panel() language.
    return `
    <rect x="${x + 4}" y="${y + 10}" width="${tileW}" height="${tileH}" rx="28" fill="#2a2a22" opacity=".14" filter="url(#blur-${id})"/>
    <rect x="${x}" y="${y}" width="${tileW}" height="${tileH}" rx="28" fill="${p.card}"/>
    ${tx(cx, cy, t.label, { font: F.mono, size: SIZE.label, floor: SIZE.label, fill: p.olive, weight: 700, spacing: 2.0 })}
    ${tx(cx, cy + 100, t.value, { font: F.serif, size: 96, fill: p.ink, spacing: -3 })}`;
  }).join('');
  return wrap(p, id, `${wash(id)}
  ${chromeTitle(p, 'Today’s snapshot')}
  ${blocks}
  ${footer(p)}`, 'Snapshot');
}



const RENDERERS: Record<UnifiedShareStoryId, (p: typeof light, id: string) => string> = {
  R1c: curveCard,
  WR1: weeklyCurve,
  R2: rankStatement,
  R4: headCount,
  F1: wideStatement,
  C1: comboFocus,
  W5: weekAverage,
  W4: weekRange,
  S1: dayDots,
  X6: dashQuad,
  X4: dashCategory,
  X5: dashProductivity,
};

function applyMetrics(metrics: UnifiedMetrics) {
  RANK = metrics.RANK;
  RANK_SAMPLE_SIZE = metrics.RANK_SAMPLE_SIZE;
  WEEK_RANK_SAMPLE_SIZE = metrics.WEEK_RANK_SAMPLE_SIZE;
  WEEK_RANK = metrics.WEEK_RANK;
  RANK_IS_LIVE = metrics.RANK_IS_LIVE;
  WEEK_RANK_IS_LIVE = metrics.WEEK_RANK_IS_LIVE;
  IS_CURRENT_PERIOD = metrics.IS_CURRENT_PERIOD;
  DATE_LABEL = metrics.DATE_LABEL;
  WEEK_LABEL = metrics.WEEK_LABEL;
  LIVE_RANK_PERCENT = metrics.LIVE_RANK_PERCENT;
  RANK_PLACE = metrics.RANK_PLACE;
  WEEK_RANK_PLACE = metrics.WEEK_RANK_PLACE;
  FOCUS_MINUTES = metrics.FOCUS_MINUTES;
  TOTAL_MINUTES = metrics.TOTAL_MINUTES;
  STREAK_DAYS = metrics.STREAK_DAYS;
  PEAK_MINUTES = metrics.PEAK_MINUTES;
  WEEK_MINUTES = metrics.WEEK_MINUTES;
  MONTH_MINUTES = metrics.MONTH_MINUTES;
  SESSION_COUNT = metrics.SESSION_COUNT;
  CLIMB_PLACES = metrics.CLIMB_PLACES;
  HIT_DAYS = metrics.HIT_DAYS;
  PROD_FOCUS = metrics.PROD_FOCUS;
  PROD_NEUTRAL = metrics.PROD_NEUTRAL;
  PROD_DRIFT = metrics.PROD_DRIFT;
  TOTAL_USERS = metrics.TOTAL_USERS;
  AVG_DAILY_FOCUS_MINUTES = metrics.AVG_DAILY_FOCUS_MINUTES;
  WEEK_DAY_MINUTES = [...metrics.WEEK_DAY_MINUTES];
  categoryOverride = metrics.categorySlices;
  productivityOverride = metrics.productivitySlices;
}

function applyLook(theme: ShareCardTheme, lookIndex: number) {
  const look = lookFor(lookIndex);
  selectedBg = { light: look.light, dark: look.dark };
  selectedAccent = look.accent;
  applyPalette();
  return theme === 'dark' ? dark : light;
}

function unwrapSvg(dataUrlOrSvg: string): string {
  if (dataUrlOrSvg.startsWith('data:image/svg+xml')) {
    return decodeURIComponent(dataUrlOrSvg.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
  }
  return dataUrlOrSvg;
}

export function renderUnifiedShareCardSvg(options: {
  readonly data: ShareCardData;
  readonly theme?: ShareCardTheme;
  readonly story?: UnifiedShareStoryId;
  readonly lookIndex?: number;
  readonly surface?: 'ink' | 'paper';
  readonly liveRanks?: ShareCardLiveRanks;
  readonly communityModels?: CommunityFocusPercentileModels;
  readonly language?: ShareCardLanguage;
}): string {
  const story = options.story ?? 'R1c';
  const theme = options.theme ?? 'light';
  const lookIndex = options.lookIndex ?? UNIFIED_STORY_OPTIONS.findIndex((entry) => entry.value === story);
  selectedSurface = options.surface ?? 'ink';
  selectedLanguage = options.language ?? options.data.language ?? 'en';
  applyMetrics(deriveDayMetrics(options.data, options.liveRanks, options.communityModels));
  const palette = applyLook(theme, lookIndex < 0 ? 0 : lookIndex);
  const renderer = RENDERERS[story] ?? curveCard;
  return unwrapSvg(renderer(palette, `${story}-${theme}`));
}

export function renderUnifiedShareWeekCardSvg(options: {
  readonly data: ShareWeekCardData;
  readonly theme?: ShareCardTheme;
  readonly story?: UnifiedShareStoryId;
  readonly lookIndex?: number;
  readonly surface?: 'ink' | 'paper';
  readonly liveRanks?: ShareCardLiveRanks;
  readonly communityModels?: CommunityFocusPercentileModels;
  readonly language?: ShareCardLanguage;
}): string {
  const story = options.story ?? 'WR1';
  const theme = options.theme ?? 'light';
  const lookIndex = options.lookIndex ?? UNIFIED_STORY_OPTIONS.findIndex((entry) => entry.value === story);
  selectedSurface = options.surface ?? 'ink';
  selectedLanguage = options.language ?? options.data.language ?? 'en';
  applyMetrics(deriveWeekMetrics(options.data, options.liveRanks, options.communityModels));
  const palette = applyLook(theme, lookIndex < 0 ? 0 : lookIndex);
  const renderer = RENDERERS[story] ?? weeklyCurve;
  return unwrapSvg(renderer(palette, `${story}-${theme}`));
}

/** Precise #place / participant-count cards require an opted-in live rank. */
export function renderLockedShareRankSvg(options: {
  readonly theme?: ShareCardTheme;
  readonly period: "daily" | "weekly";
  readonly lookIndex?: number;
  readonly language?: ShareCardLanguage;
}): string {
  const theme = options.theme ?? "light";
  const lookIndex = options.lookIndex ?? 0;
  selectedLanguage = options.language ?? 'en';
  const palette = applyLook(theme, lookIndex);
  const title = options.period === "daily" ? localized("Today's focus rank", "오늘의 집중 순위") : localized("This week's focus rank", "이번 주 집중 순위");
  const scope = options.period === "daily" ? localized("today", "오늘") : localized("this week", "이번 주");
  return unwrapSvg(wrap(palette, `locked-rank-${options.period}-${theme}`, `${wash(`locked-rank-${options.period}-${theme}`)}
  ${chromeTitle(palette, title)}
  ${panel(palette, `locked-rank-${options.period}-${theme}`, 70, RANK_PANEL_Y, 1060, RANK_PANEL_H, 36)}
  <circle cx="600" cy="380" r="42" fill="${palette.pale}"/>
  <path d="M582 382v-14c0-10 8-18 18-18s18 8 18 18v14" fill="none" stroke="${palette.olive}" stroke-width="7" stroke-linecap="round"/>
  <rect x="576" y="378" width="48" height="42" rx="9" fill="${palette.olive}"/>
  ${tx(600, 508, localized('Join the leaderboard', '리더보드에 참여하세요'), { font: F.serif, size: 76, fill: palette.ink, spacing: -2.4, anchor: 'middle' })}
  ${tx(600, 572, localized(`to reveal your live focus rank for ${scope}.`, `${scope}의 실시간 집중 순위를 확인할 수 있습니다.`), { font: F.sans, size: SIZE.support, floor: SIZE.support, fill: palette.soft, anchor: 'middle' })}
  ${footer(palette)}`, localized('Locked focus rank', '잠긴 집중 순위')));
}
