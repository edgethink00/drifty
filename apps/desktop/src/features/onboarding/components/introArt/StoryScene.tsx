import { useId, type CSSProperties, type ReactNode } from "react";
import type { PostOnboardingSidebarGuideStep } from "../../postOnboardingSidebarGuide";
import type { HostPlatform } from "../../../../lib/api/accessibilityClient";
import { AppIcon, Bar, DAY_SHARES, TrayMenu, TrayRing, trayMenuHeight, trayRowTop, type ArtTheme } from "./artKit";
import { APP_W, AppShell, ClassificationPage, CorrectionEditor, Scaled, TodayPage, type NavActive, type RealLabels } from "./realApp";
import { WIN_APP, WIN_OVERFLOW_TRAY, WIN_TASKBAR, WindowsTaskbar } from "./windowsShell";
import type { FirstDayRecap, FirstDayRecapBlock, FirstDayVerdict } from "../../firstDayStory";
import type { DisplayLanguage } from "../../../localization/languagePreference";
import type { FirstDaySource } from "../../firstDayPreparationStory";
import { useSiteIcon } from "../../../../components/SiteIconContext";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactHourLabel } from "../../../../lib/formatting";
import { CATEGORY_COLORS } from "../../../../lib/activityLabels";
import { useLocalization } from "../../../localization/LocalizationContext";
import { breakdownContent, hasReadingCard, noFocusCardVariant, readingView } from "../../noFocusCardVariants";
import { introLayout, layoutOpensByKind } from "../../postOnboardingSidebarGuide";
import { storyCategoryName } from "../../storyCategories";

/*
 * The post-onboarding introduction's illustrations, drawn from real Drifty surfaces. The menu bar and Dock
 * appear only on the first and last cards, where they are the subject. The middle cards show one window,
 * a faded, cropped Dock for context, and at most one hand-drawn arrow. The Automatic close card is the
 * only one that changes over time (see SwatScene and NarrativeGuideIllustration).
 */


export type SceneProps = { readonly theme: ArtTheme; readonly language?: DisplayLanguage; readonly ko: boolean; readonly platform: HostPlatform; readonly labels: RealLabels };
type Pt = { readonly x: number; readonly y: number };
/**
 * The hand-drawn arrow, as one even arc: both control points sit the same distance off the
 * straight line, so every arrow bends with the same curvature. lift > 0 bows to the left of travel.
 * The head follows the arc's final tangent and stops short of the target.
 */
function Arc({ from, to, lift }: { from: Pt; to: Pt; lift: number }) {
  const vx = to.x - from.x, vy = to.y - from.y, len = Math.hypot(vx, vy);
  const nx = -vy / len, ny = vx / len;
  const c1 = { x: from.x + vx * 0.18 + nx * lift, y: from.y + vy * 0.18 + ny * lift };
  const c2 = { x: from.x + vx * 0.72 + nx * lift, y: from.y + vy * 0.72 + ny * lift };
  const angle = Math.atan2(to.y - c2.y, to.x - c2.x) * 180 / Math.PI;
  return <g fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d={"M" + from.x + " " + from.y + "C" + c1.x + " " + c1.y + " " + c2.x + " " + c2.y + " " + to.x + " " + to.y} />
    <path d="M-8 -6.2L0 0-8 6.2" transform={"translate(" + to.x + " " + to.y + ") rotate(" + angle + ")"} />
  </g>;
}

/*
 * macOS menu bar status area, drawn at 1.25 art units per point: the 24pt bar becomes 30 units and the
 * real 18pt tray icon 22.5. Only the app's own item keeps full colour; the
 * stock items (battery, Wi-Fi, Control Center, clock) stay as faint silhouettes in their real order so
 * the ring is the one thing the eye lands on. The clock shows the sample "now" (18:08).
 */
const BAR_H = 30, PT = 1.25, RING = { x: 196, y: BAR_H / 2 };
const MENU_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Apple SD Gothic Neo", system-ui, sans-serif';
function StatusBar({ theme, clock, lit = false }: { theme: ArtTheme; clock: string; lit?: boolean }) {
  const cy = RING.y, ink = "var(--text)", faint = theme === "dark" ? 0.3 : 0.24;
  const wifi = (cx: number) => {
    const base = cy + 6, arc = (r: number) => { const dx = r * Math.sin(Math.PI / 4.2), dy = r * Math.cos(Math.PI / 4.2); return "M" + (cx - dx) + " " + (base - dy) + "A" + r + " " + r + " 0 0 1 " + (cx + dx) + " " + (base - dy); };
    return <g stroke={ink} strokeWidth="1.9" strokeLinecap="round" fill="none"><path d={arc(11.2) + arc(7.4) + arc(3.7)} /><circle cx={cx} cy={base - 0.4} r={1.35} fill={ink} stroke="none" /></g>;
  };
  return <g style={{ fontFamily: MENU_FONT }}>
    <rect x={-400} y={-350} width={1200} height={BAR_H + 350} className="real-art__menubar" />
    {lit && <rect x={RING.x - 15} y={3} width={30} height={BAR_H - 6} rx={6} fill={ink} opacity={theme === "dark" ? .2 : .1} />}
    <TrayRing cx={RING.x} cy={cy} s={PT} shares={DAY_SHARES} theme={theme} />
    <g opacity={faint}>
      <rect x={222} y={cy - 5.8} width={24} height={11.6} rx={3.6} fill="none" stroke={ink} strokeWidth="1.2" />
      <path d={"M247.6 " + (cy - 2) + "a1.6 1.6 0 0 1 0 4"} fill="none" stroke={ink} strokeWidth="1.5" strokeLinecap="round" />
      <rect x={224} y={cy - 3.8} width={16} height={7.6} rx={2} fill={ink} />
      {wifi(265.5)}
      <g fill="none" stroke={ink} strokeWidth="1.3"><rect x={284} y={cy - 7} width={15} height={6.2} rx={3.1} /><rect x={284} y={cy + 0.8} width={15} height={6.2} rx={3.1} /></g>
      <circle cx={295.9} cy={cy - 3.9} r={2.1} fill={ink} /><circle cx={287.1} cy={cy + 3.9} r={2.1} fill={ink} />
    </g>
    <text x={388} y={cy + 4.4} fontSize="12.5" fontWeight="500" fill={ink} opacity={faint + 0.14} textAnchor="end" letterSpacing="0">{clock}</text>
  </g>;
}

/** The Dock: full on the first card, cropped and faded below the window on the middle cards. */
function DeskDock({ faded = false }: { faded?: boolean }) {
  const y = faded ? 300 : 258, tile = 50, gap = 10, x0 = 200 - (tile * 5 + gap * 4) / 2;
  return <g opacity={faded ? 0.38 : 1}>
    <rect x={38} y={y} width={324} height={72} rx={22} className="real-art__dock" />
    {[0, 1, 2, 3, 4].map(i => {
      const x = x0 + i * (tile + gap), ty = y + 11;
      return i === 2
        ? <g key={i}><AppIcon x={x} y={ty} size={tile} />{!faded && <circle cx={x + tile / 2} cy={ty + tile + 5} r={1.8} fill="var(--text-soft)" />}</g>
        : <rect key={i} x={x} y={ty} width={tile} height={tile} rx={12} fill="var(--line-strong)" opacity=".55" />;
    })}
  </g>;
}

/** The measured app window, showing its top srcH app pixels at width w. */
function AppWindow({ x, y, w, srcH = 660, opacity = 1, active, labels, theme, page, accountHot = false }: { x: number; y: number; w: number; srcH?: number; opacity?: number; active: NavActive; labels: RealLabels; theme: ArtTheme; page: ReactNode; accountHot?: boolean }) {
  const id = useId(), k = w / APP_W, h = srcH * k;
  return <g opacity={opacity}>
    <rect x={x} y={y} width={w} height={h} rx={10} className="real-art__window" />
    <clipPath id={id}><rect x={x} y={y} width={w} height={h} rx={10} /></clipPath>
    <g clipPath={"url(#" + id + ")"}><Scaled x={x} y={y} k={k}><AppShell active={active} labels={labels} theme={theme} accountHot={accountHot}>{page}</AppShell></Scaled></g>
  </g>;
}

/*
 * The pet card's cat is the real PetModeCat, an HTML component. WebKit (the Mac app's engine) ignores SVG
 * transforms for positioned HTML inside foreignObject and drew it at the art's origin, so the cat is laid
 * over the SVG as HTML by NarrativeGuideIllustration. The scene reports where the 144x99 cat sits in art units.
 */
export type ArtCatPlacement = { readonly x: number; readonly y: number; readonly k: number };
/** Where the cat stops on the Automatic close card. Its paw tip (about 12, 43 in the 144x99 cat box) lands just inside the drift window's right edge. */
export const CAT_SWAT: ArtCatPlacement = { x: 226, y: 196, k: 1 };
export const SWAT_POINT = { x: CAT_SWAT.x + 12, y: CAT_SWAT.y + 43 } as const;
export type StoryDriftChoice = "watch" | "close";
export function storyCatPlacement(step: PostOnboardingSidebarGuideStep, _choice: StoryDriftChoice = "close"): ArtCatPlacement | null {
  // The cat sits by the drift window whether or not it is about to close it.
  return step === "account" ? CAT_SWAT : null;
}

/*
 * The Automatic close card tells one event: a drifting video window is open, the cat runs in and swats it, and the
 * window closes, leaving the work behind it. There is no button or arrow to explain; the window closes
 * from the point the paw lands (a slight shrink and fade), so the cause is the paw itself.
 */
function SwatScene({ windows, closed, labels, driftTitle }: { windows: boolean; closed: boolean; labels: RealLabels; driftTitle?: string }) {
  const drift = "var(--productivity-drift)";
  const work = { x: 150, y: 40, w: 230, h: 176 }, win = { x: 22, y: 100, w: SWAT_POINT.x + 6 - 22, h: 160 };
  const chrome = (x: number, y: number, w: number) => windows
    ? <g fill="none" stroke="var(--text-soft)" strokeWidth="1.2" strokeLinecap="round"><path d={"M" + (x + w - 58) + " " + (y + 13) + "h8"} /><rect x={x + w - 40} y={y + 9} width={8} height={8} rx={1} /><path d={"M" + (x + w - 20) + " " + (y + 9) + "l8 8M" + (x + w - 12) + " " + (y + 9) + "l-8 8"} /></g>
    : <g>{["#ee6a5f", "#f5be4f", "#61c554"].map((c, i) => <circle key={c} cx={x + 13 + i * 11} cy={y + 13} r={3.3} fill={c} />)}</g>;
  const vid = { x: win.x + 12, y: win.y + 48, w: win.w - 24, h: 96 };
  return <g>
    {!windows && <DeskDock faded />}
    {/* the work the user came back to: a plain document window, faint until the drift is gone */}
    <g style={{ opacity: closed ? 1 : 0.5, transition: "opacity 520ms ease 80ms" }}>
      <rect x={work.x} y={work.y} width={work.w} height={work.h} rx={10} className="real-art__window" />
      {chrome(work.x, work.y, work.w)}
      <path d={"M" + work.x + " " + (work.y + 26) + "H" + (work.x + work.w)} stroke="var(--line)" />
      <Bar x={work.x + 18} y={work.y + 42} w={120} h={8} fill="var(--text)" opacity={.7} />
      {[0, 1, 2, 3, 4, 5].map(i => <Bar key={i} x={work.x + 18} y={work.y + 64 + i * 17} w={[190, 172, 196, 150, 184, 120][i]} h={5} fill="var(--text)" opacity={.22} />)}
    </g>
    {/* the drifting window, tagged with the app's own drift chip */}
    <g style={{ opacity: closed ? 0 : 1, transform: closed ? "scale(.95)" : "none", transformOrigin: SWAT_POINT.x + "px " + SWAT_POINT.y + "px", transformBox: "view-box", transition: "opacity 420ms ease, transform 520ms cubic-bezier(.22,.8,.3,1)" } as CSSProperties}>
      <rect x={win.x} y={win.y} width={win.w} height={win.h} rx={10} className="real-art__window" />
      {chrome(win.x, win.y, win.w)}
      {driftTitle ? <text x={win.x + (windows ? 12 : 50)} y={win.y + 16.6} fontSize="9" fontWeight="600" fill="var(--text-soft)">{driftTitle}</text> : null}
      <path d={"M" + win.x + " " + (win.y + 26) + "H" + (win.x + win.w)} stroke="var(--line)" />
      <rect x={win.x + 12} y={win.y + 32} width={44} height={14} rx={7} fill="color-mix(in srgb, var(--productivity-drift) 14%, var(--surface))" stroke="color-mix(in srgb, var(--productivity-drift) 40%, transparent)" />
      <circle cx={win.x + 20} cy={win.y + 39} r={2.8} fill={drift} />
      <text x={win.x + 26} y={win.y + 42.2} fontSize="8.5" fontWeight="600" fill={drift}>{labels.drift}</text>
      <rect x={vid.x} y={vid.y} width={vid.w} height={vid.h} rx={6} fill="#24251f" />
      <path d={"M" + (vid.x + vid.w / 2 - 7) + " " + (vid.y + vid.h / 2 - 10) + "l18 10-18 10z"} fill="#f4f3ee" opacity=".9" />
      <rect x={vid.x + 8} y={vid.y + vid.h - 9} width={vid.w - 16} height={3} rx={1.5} fill="#f4f3ee" opacity=".25" />
      <rect x={vid.x + 8} y={vid.y + vid.h - 9} width={(vid.w - 16) * 0.62} height={3} rx={1.5} fill={drift} />
    </g>
  </g>;
}

const WIN = { x: 40, y: 58, w: 320 } as const;
const WK = WIN.w / APP_W;
const onWin = (ax: number, ay: number) => ({ x: WIN.x + ax * WK, y: WIN.y + ay * WK });

/* ---------- The user's own first day (story cards) ---------- */
const VERDICT_FILL: Record<FirstDayVerdict, string> = {
  focus: "var(--productivity-focus)", drift: "var(--productivity-drift)", neutral: "var(--productivity-neutral)", pending: "var(--line-strong)",
};
const minuteOf = (hourIndex: number, minute: number) => hourIndex * 60 + minute;
function inLongestRun(block: FirstDayRecapBlock, recap: FirstDayRecap): boolean {
  const run = recap.longestFocus;
  if (!run || block[3] !== "focus") return false;
  const from = minuteOf(run.from.hourIndex, run.from.minute) - 0.01, to = minuteOf(run.to.hourIndex, run.to.minute) + 0.01;
  return minuteOf(block[0], block[1]) >= from && minuteOf(block[0], block[2]) <= to;
}

let measureContext: CanvasRenderingContext2D | null | undefined;
/**
 * Advance width of SVG text in the app font, so labels can be padded and aligned exactly. Falls back
 * to an estimate where there is no canvas (tests).
 */
function textWidth(text: string, size: number, weight = 600): number {
  if (measureContext === undefined) {
    try { measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d"); } catch { measureContext = null; }
  }
  if (measureContext && typeof getComputedStyle === "function") {
    measureContext.font = weight + " " + size + "px " + getComputedStyle(document.body).fontFamily;
    const measured = measureContext.measureText(text).width;
    if (measured > 0) return measured * 0.99;
  }
  let width = 0;
  for (const ch of text) width += /[가-힣]/.test(ch) ? size * 0.98 : ch === " " ? size * 0.3 : /[.·]/.test(ch) ? size * 0.32 : size * 0.58;
  return width;
}

/** The source's own icon from the native site-icon cache, or its initial on a soft tile. */
function SourceGlyph({ x, y, size, source }: { x: number; y: number; size: number; source: FirstDaySource }) {
  const icon = useSiteIcon(source.siteDomain);
  const clip = useId();
  if (icon) return <g>
    <clipPath id={clip}><rect x={x} y={y} width={size} height={size} rx={size * 0.26} /></clipPath>
    <image href={icon} x={x} y={y} width={size} height={size} clipPath={"url(#" + clip + ")"} preserveAspectRatio="xMidYMid slice" />
  </g>;
  return <g>
    <rect x={x} y={y} width={size} height={size} rx={size * 0.26} fill="var(--line-strong)" />
    <text x={x + size / 2} y={y + size * 0.74} fontSize={size * 0.62} fontWeight="700" textAnchor="middle" fill="var(--text-muted)">{source.label[0]?.toUpperCase() ?? ""}</text>
  </g>;
}

/**
 * The card's one fact on the chart, the way the app's chart answers a hover: the hours it describes are
 * selected (a light tint with dashed edges) and a dark tooltip above them names the source and its time.
 * The tooltip is centred over the hours and, near an edge, aligned with the chart's own edge.
 */
function FactMark({ source, duration, color, span, chart, name: nameOverride }: {
  source: FirstDaySource | null; duration: string; color: string;
  span: { x0: number; x1: number }; chart: { x: number; y: number; w: number; h: number };
  /** Names the fact when it is a time of day rather than a source. */
  name?: string;
}) {
  const name = nameOverride ?? source?.label ?? "";
  const icon = 14, gap = 6, pad = 6, padEnd = 10, h = 26, sep = 6;
  const nameW = textWidth(name, 10, 600), durW = textWidth(duration, 10, 700);
  const width = pad + (source ? icon + gap : 0) + nameW + (name ? sep : 0) + durW + padEnd;
  const cx = (span.x0 + span.x1) / 2;
  const left = Math.max(chart.x, Math.min(chart.x + chart.w - width, cx - width / 2));
  const top = chart.y - h - 8, mid = top + h / 2;
  const caret = Math.max(left + 12, Math.min(left + width - 12, cx));
  const textX = left + pad + (source ? icon + gap : 0);
  return <g className="story-day__fact">
    <rect x={span.x0} y={chart.y} width={span.x1 - span.x0} height={chart.h} fill={color} opacity=".1" />
    <path d={"M" + (span.x0 + 0.5) + " " + chart.y + "V" + (chart.y + chart.h) + "M" + (span.x1 - 0.5) + " " + chart.y + "V" + (chart.y + chart.h)}
      stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity=".55" />
    <rect x={left} y={top} width={width} height={h} rx={h / 2} fill="var(--text)" />
    <path d={"M" + (caret - 5) + " " + (top + h - 1) + "L" + caret + " " + (top + h + 5) + "L" + (caret + 5) + " " + (top + h - 1) + "Z"} fill="var(--text)" />
    {source ? <g>
      <rect x={left + pad} y={mid - icon / 2} width={icon} height={icon} rx={icon / 2} fill="var(--surface)" />
      <SourceGlyph x={left + pad + 2} y={mid - icon / 2 + 2} size={icon - 4} source={source} />
    </g> : null}
    <text x={textX} y={mid + 3.5} fontSize="10">
      {name ? <tspan fontWeight="600" fill="var(--surface)">{name}</tspan> : null}
      <tspan x={textX + nameW + (name ? sep : 0)} fontWeight="700" fill="var(--surface)" opacity=".7">{duration}</tspan>
    </text>
  </g>;
}


/**
 * The first day as the Today canvas draws it: one column per hour, blocks by minute, coloured by
 * productivity. "focus" lights the longest focus stretch, "drift" lights the drift, and "day" lights every
 * classified block for a day with almost no focus, whose card names where the time went; the rest steps back.
 */
function RecapDayScene({ recap, lit, ko, labels, language = ko ? "ko" : "en", factTitle, rhythm = false }: {
  recap: FirstDayRecap; lit: "focus" | "drift" | "day"; ko: boolean; labels: RealLabels; language?: DisplayLanguage;
  /** Review prototype: names the focus stretch by the page title Drifty read instead of its site. */
  factTitle?: string;
  /** Review prototype ("rhythm" layout): the day by kind again, with the two hours it leaned on lit. */
  rhythm?: boolean;
}) {
  const { t } = useLocalization();
  // A day with almost no focus opens on its time by kind; the dev server can compare other cards
  // (rhythm, stays, places; see noFocusCardVariants).
  const variant = lit === "day" ? noFocusCardVariant() : null;
  const byCategory = rhythm || variant === "kinds";
  const busiest = rhythm || variant === "rhythm" ? recap.busiestHours : null;
  const stay = !rhythm && variant === "stays" ? recap.stays.longest : null;
  const panel = { x: 14, y: 34, w: 372, h: 282 };
  const chart = { x: panel.x + 16, y: panel.y + 66, w: panel.w - 32, h: 168 };
  const cw = chart.w / recap.hourCount;
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  // With almost no drift there is no source to point at: the drift card lights the day's focus and
  // neutral time instead, a day that stayed mostly on track, and shows no label.
  const clean = lit === "drift" && !recap.topDrift;
  const wholeDay = lit === "day";
  const inStay = (block: FirstDayRecapBlock) => {
    if (!stay || block[4] !== stay.source.key) return false;
    return minuteOf(block[0], block[1]) >= minuteOf(stay.from.hourIndex, stay.from.minute) - 0.01
      && minuteOf(block[0], block[2]) <= minuteOf(stay.to.hourIndex, stay.to.minute) + 0.01;
  };
  const isLit = (block: FirstDayRecapBlock) => wholeDay
    ? block[3] !== "pending" && (busiest ? block[0] >= busiest.fromHour && block[0] < busiest.toHour : stay ? inStay(block) : true)
    : lit === "focus" ? inLongestRun(block, recap)
    : clean ? block[3] === "focus" || block[3] === "neutral" : block[3] === "drift";
  const litColumns = recap.blocks.filter(isLit).map((block) => block[0]);
  // Drift: point at the hour holding the most drift; focus: at the stretch's first hour.
  const driftMinutes = new Map<number, number>();
  for (const block of recap.blocks) if (block[3] === "drift") driftMinutes.set(block[0], (driftMinutes.get(block[0]) ?? 0) + block[2] - block[1]);
  const pillColumn = lit === "focus"
    ? (recap.longestFocus ? (recap.longestFocus.from.hourIndex + recap.longestFocus.to.hourIndex) / 2 : litColumns[0] ?? 0)
    : Array.from(driftMinutes.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const factSource = lit === "focus" ? recap.longestFocus?.source ?? null : recap.topDrift?.source ?? null;
  const factDuration = lit === "focus"
    ? duration(recap.longestFocus ? recap.longestFocus.seconds : recap.focusSeconds)
    : duration(recap.topDrift ? recap.topDrift.seconds : recap.driftSeconds);
  const spanFrom = lit === "focus" && recap.longestFocus ? recap.longestFocus.from.hourIndex : pillColumn;
  const spanTo = lit === "focus" && recap.longestFocus ? recap.longestFocus.to.hourIndex : pillColumn;
  const color = lit === "focus" ? VERDICT_FILL.focus : VERDICT_FILL.drift;
  const step = recap.hourCount > 12 ? 3 : 2;
  // By kind, the three largest categories keep their colours and the rest share one quiet "Other". Time
  // Drifty could not sort (a browser with no page) is no kind at all, so it is left out of this chart.
  const namedCategories = new Set(recap.categories.slice(0, 3).map((entry) => entry.category));
  const otherFill = "var(--line-strong)";
  const legend: readonly (readonly [string, string])[] = byCategory
    ? [
      ...recap.categories.slice(0, 3).map((entry) => [CATEGORY_COLORS[entry.category], storyCategoryName(entry.category, t)] as const),
      ...(recap.categories.length > 3 ? [[otherFill, t("activity.category.custom")] as const] : []),
    ]
    : [[VERDICT_FILL.focus, labels.focus], [VERDICT_FILL.neutral, labels.neutral], [VERDICT_FILL.drift, labels.drift]];
  // Category names run long in some languages (エンターテインメント): tighten the gaps to fit the panel,
  // and leave Other out of the legend when even that is not enough.
  const legendRoom = panel.w - 32;
  const legendWidth = (items: readonly (readonly [string, string])[]) => items.reduce((total, [, text]) => total + 12 + textWidth(text, 10, 600), 0);
  const fittedLegend = byCategory && legend.length > 3 && legendWidth(legend) + 8 * (legend.length - 1) > legendRoom ? legend.slice(0, 3) : legend;
  const legendGap = fittedLegend.length > 1 ? Math.max(8, Math.min(24, (legendRoom - legendWidth(fittedLegend)) / (fittedLegend.length - 1))) : 0;
  const legendX = fittedLegend.reduce<number[]>((xs, _entry, i) => [...xs, i === 0 ? panel.x + 16 : xs[i - 1] + 12 + textWidth(fittedLegend[i - 1][1], 10, 600) + legendGap], []);
  const blockFill = (block: FirstDayRecapBlock) => !byCategory ? VERDICT_FILL[block[3]]
    : block[5] && namedCategories.has(block[5]) ? CATEGORY_COLORS[block[5]] : otherFill;
  const neutralMark = "var(--text-soft)";
  return <g>
    <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} rx={12} className="real-art__window" />
    {(byCategory ? fittedLegend : legend).map(([fill, text], i) => {
      const x = byCategory ? legendX[i] : panel.x + 16 + i * (ko ? 52 : 64);
      const on = wholeDay || (clean ? i < 2 : (lit === "focus" && i === 0) || (lit === "drift" && i === 2));
      return <g key={text} opacity={on ? 1 : 0.55}><circle cx={x + 4} cy={panel.y + 22} r={4} fill={fill} /><text x={x + 12} y={panel.y + 25.5} fontSize="10" fontWeight={on ? 700 : 500} fill="var(--text)">{text}</text></g>;
    })}
    <g transform={"translate(" + chart.x + " " + chart.y + ")"}>
      {Array.from({ length: recap.hourCount }, (_, i) => <rect key={i} x={i * cw} width={cw} height={chart.h} fill="var(--line)" opacity={i % 2 ? 0.16 : 0.34} />)}
      {recap.blocks.map((block, i) => byCategory && block[3] === "pending" ? null : <rect key={i} className="story-day__block" data-lit={isLit(block) || undefined} style={{ "--hour": block[0] } as CSSProperties}
        x={block[0] * cw} y={(block[1] / 60) * chart.h} width={cw + 0.4} height={Math.max(1, ((block[2] - block[1]) / 60) * chart.h)}
        fill={blockFill(block)} stroke="var(--surface)" strokeWidth=".7" opacity={isLit(block) ? 0.95 : 0.2} />)}
      {Array.from({ length: Math.floor((recap.hourCount - 1) / step) + 1 }, (_, i) => i * step).map((i) =>
        <text key={i} x={i * cw + cw / 2} y={chart.h + 16} fontSize="9.5" fill="var(--text-soft)" textAnchor="middle">{formatLocalizedCompactHourLabel((recap.firstHour + i) % 24, language)}</text>)}
    </g>
    {busiest ? <FactMark source={null} name={formatLocalizedCompactHourLabel((recap.firstHour + busiest.fromHour) % 24, language) + "–" + formatLocalizedCompactHourLabel((recap.firstHour + busiest.toHour) % 24, language)}
      duration={duration(busiest.seconds)} color={neutralMark} chart={chart}
      span={{ x0: chart.x + busiest.fromHour * cw, x1: chart.x + busiest.toHour * cw }} /> : null}
    {stay ? <FactMark source={stay.source} duration={duration(stay.seconds)} color={neutralMark} chart={chart}
      span={{ x0: chart.x + stay.from.hourIndex * cw, x1: chart.x + (stay.to.minute === 0 && stay.to.hourIndex > stay.from.hourIndex ? stay.to.hourIndex : stay.to.hourIndex + 1) * cw }} /> : null}
    {clean || wholeDay ? null : <FactMark source={factSource} duration={factDuration} color={color} chart={chart}
      name={lit === "focus" && factTitle ? clipText(factTitle, 10, chart.w - 110, 600) : undefined}
      span={{ x0: chart.x + Math.floor(spanFrom) * cw, x1: chart.x + (Math.floor(spanTo) + 1) * cw }} />}
  </g>;
}

/** A label cut to fit max units at the given size, with an ellipsis when it was cut. */
function clipText(text: string, size: number, max: number, weight = 650): string {
  if (textWidth(text, size, weight) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(cut + "…", size, weight) > max) cut = cut.slice(0, -1);
  return cut + "…";
}

/** A page title in quotes, unless it already opens with one (“1등이면 겸손해야지”에 긁힌 사람들). */
function quoted(title: string): string {
  return /^[‘’“”"'「『]/u.test(title) ? title : "‘" + title + "’";
}

const READING_COPY = {
  ko: { caption: "Drifty가 읽은 페이지", siteCaption: "제목을 보고 가른 페이지", more: "외 {n}개", pages: "페이지 {n}개" },
  en: { caption: "Pages Drifty read", siteCaption: "Told apart by title", more: "+{n} more", pages: "{n} pages" },
} as const;

/**
 * Review prototype: how Drifty read pages by their titles. With a site it sorted several ways (YouTube
 * as entertainment, music and work), the site's time as one bar split by kind, then a row per kind in
 * the bar's order: its page title, or a page count when no one page stands for the kind. Without such a
 * site, the day's longest page in each of up to three kinds. Each row ends in the kind, coloured like the
 * Classification page.
 */
function ReadingScene({ recap, language }: { recap: FirstDayRecap; language: DisplayLanguage }) {
  const { t } = useLocalization();
  const clip = useId();
  const copy = READING_COPY[language === "ko" ? "ko" : "en"];
  const count = (template: string, n: number) => template.replace("{n}", String(n));
  const { site, rows } = readingView(recap);
  const panel = { x: 14, y: 34, w: 372, h: 282 };
  const left = panel.x + 22, right = panel.x + panel.w - 22, width = right - left;
  const rowH = 42, rowGap = 8, headH = site ? 24 + 14 + 12 + 30 + 28 : 26;
  let y = panel.y + (panel.h - (headH + rows.length * rowH + Math.max(0, rows.length - 1) * rowGap)) / 2;
  const parts: ReactNode[] = [];
  if (site) {
    // At most four kinds on the bar; the rest join as one grey part. Every part stays visible (6 units).
    const shown = site.kinds.slice(0, 4).map((kind) => ({ key: kind.category, fill: CATEGORY_COLORS[kind.category], seconds: kind.seconds }));
    const restSeconds = site.kinds.slice(4).reduce((total, kind) => total + kind.seconds, 0);
    const barParts = restSeconds > 0 ? [...shown, { key: "rest", fill: "var(--line-strong)", seconds: restSeconds }] : shown;
    const gap = 2, minW = 6, room = width - gap * (barParts.length - 1);
    const natural = barParts.map((part) => (part.seconds / site.seconds) * room);
    const fixed = natural.filter((w) => w < minW).length * minW;
    const scalable = natural.filter((w) => w >= minW).reduce((total, w) => total + w, 0);
    const widths = natural.map((w) => (w < minW ? minW : (w * (room - fixed)) / scalable));
    // The legend under the bar: each kind's name and time, left to right; a kind that no longer fits is left to its colour.
    const legend: { key: string; x: number; fill: string; name: string; time: string }[] = [];
    let cursor = left;
    for (const kind of site.kinds.slice(0, 4)) {
      const name = storyCategoryName(kind.category, t), time = formatLocalizedCompactDurationFromSeconds(kind.seconds, language);
      const w = 11 + textWidth(name, 10.5, 650) + textWidth(" " + time, 10.5, 500);
      if (cursor + w > right) break;
      legend.push({ key: kind.category, x: cursor, fill: CATEGORY_COLORS[kind.category], name, time });
      cursor += w + 14;
    }
    let x = left;
    parts.push(<g key="site">
      <SourceGlyph x={left} y={y} size={24} source={site.source} />
      <text x={left + 33} y={y + 17} fontSize="14.5" fontWeight="700" fill="var(--text)">{site.source.label}</text>
      <text x={right} y={y + 17} fontSize="12" fontWeight="600" fill="var(--text-soft)" textAnchor="end">{formatLocalizedCompactDurationFromSeconds(site.seconds, language)}</text>
      <clipPath id={clip}><rect x={left} y={y + 38} width={width} height={12} rx={6} /></clipPath>
      <g clipPath={"url(#" + clip + ")"}>
        {barParts.map((part, i) => {
          const rect = <rect key={part.key} x={x} y={y + 38} width={widths[i]} height={12} fill={part.fill} />;
          x += widths[i] + gap;
          return rect;
        })}
      </g>
      {legend.map((entry) => <g key={"l" + entry.key}>
        <circle cx={entry.x + 3.5} cy={y + 68} r={3.5} fill={entry.fill} />
        <text x={entry.x + 11} y={y + 71.5} fontSize="10.5" fontWeight="650" fill="var(--text)">{entry.name}
          <tspan fontWeight="500" fill="var(--text-soft)">{" " + entry.time}</tspan></text>
      </g>)}
      <text x={left} y={y + 104} fontSize="10" fontWeight="600" fill="var(--text-soft)" letterSpacing=".3">{copy.siteCaption}</text>
    </g>);
  } else {
    parts.push(<text key="caption" x={left} y={y + 11} fontSize="10" fontWeight="600" fill="var(--text-soft)" letterSpacing=".3">{copy.caption}</text>);
  }
  y += headH;
  rows.forEach((row, i) => {
    const top = y + i * (rowH + rowGap), mid = top + rowH / 2;
    const name = storyCategoryName(row.category, t);
    const pillW = textWidth(name, 10.5, 650) + 27, pillX = right - 9 - pillW;
    const textX = left + (site ? 13 : 37);
    const suffix = row.title && row.pages > 0 ? count(copy.more, row.pages) : "";
    const suffixW = suffix ? textWidth(suffix, 10.5, 500) + 6 : 0;
    const label = row.title ? clipText(quoted(row.title), 12.5, pillX - 12 - textX - suffixW) : count(copy.pages, row.pages);
    const labelW = textWidth(label, 12.5, row.title ? 650 : 600);
    parts.push(<g key={"r" + i}>
      <rect x={left} y={top} width={width} height={rowH} rx={10} fill="var(--line)" opacity=".34" />
      {site ? null : <SourceGlyph x={left + 12} y={mid - 8} size={16} source={row.source} />}
      <text x={textX} y={mid + 4.4} fontSize="12.5" fontWeight={row.title ? 650 : 600} fill={row.title ? "var(--text)" : "var(--text-soft)"}>{label}</text>
      {suffix ? <text x={textX + labelW + 6} y={mid + 4} fontSize="10.5" fontWeight="500" fill="var(--text-soft)">{suffix}</text> : null}
      <rect x={pillX} y={mid - 11} width={pillW} height={22} rx={11} fill={CATEGORY_COLORS[row.category]} opacity=".17" />
      <circle cx={pillX + 11.5} cy={mid} r={3.6} fill={CATEGORY_COLORS[row.category]} />
      <text x={pillX + 20} y={mid + 3.7} fontSize="10.5" fontWeight="650" fill="var(--text)">{name}</text>
    </g>);
  });
  return <g>
    <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h} rx={12} className="real-art__window" />
    {parts}
  </g>;
}


export function StoryScene({ step, theme, ko, platform, labels, language, driftClosed = false, recap = null, driftChoice = "close" }: SceneProps & {
  step: PostOnboardingSidebarGuideStep; driftClosed?: boolean; recap?: FirstDayRecap | null; driftChoice?: StoryDriftChoice;
}) {
  if (step === "recap" && recap?.lead === "kinds" && noFocusCardVariant() === "reading" && hasReadingCard(recap)) {
    return <ReadingScene recap={recap} language={language ?? (ko ? "ko" : "en")} />;
  }
  // Review prototypes of the six-card orders (see introLayout): the middle card is the focus stretch named
  // by its page title, the titles Drifty read, or the day by kind.
  const layout = introLayout();
  if (step === "breakdown" && recap) {
    const middle = breakdownContent(recap, layout);
    if (middle === "focus") return <RecapDayScene recap={recap} lit="focus" ko={ko} labels={labels} language={language} factTitle={recap.longestFocus?.title} />;
    if (middle === "reading") return <ReadingScene recap={recap} language={language ?? (ko ? "ko" : "en")} />;
    if (middle === "rhythm") return <RecapDayScene recap={recap} lit="day" rhythm ko={ko} labels={labels} language={language} />;
    return <RecapDayScene recap={recap} lit="day" ko={ko} labels={labels} language={language} />;
  }
  const opensByKind = recap?.lead === "kinds" || layoutOpensByKind(layout);
  if ((step === "recap" || step === "drift") && recap) return <RecapDayScene recap={recap}
    lit={step === "drift" ? "drift" : opensByKind ? "day" : "focus"} ko={ko} labels={labels} language={language} />;
  if (step === "account") return <SwatScene windows={platform === "windows"} closed={driftChoice === "close" && driftClosed} labels={labels}
    driftTitle={recap?.topDrift?.source.label} />;
  const windows = platform === "windows";
  const today = <TodayPage labels={labels} theme={theme} />;
  const clock = labels.menuClock ?? "";
  // Both Windows taskbar cards keep the badge where a new install finds it: in the open hidden-icons flyout.
  const taskbar = (appOpen: boolean) => <WindowsTaskbar theme={theme} time={labels.trayTime ?? ""} date={labels.trayDate ?? ""} appOpen={appOpen} trayLit={!appOpen} overflowOpen />;

  // Windows: the app's taskbar button (the window is open now) and the tray badge where a new install
  // finds it, in the open hidden-icons flyout, each with one arrow like the Dock icon and ring on the Mac card.
  if (step === "welcome") return windows ? <g>
    {taskbar(true)}
    <Arc from={{ x: 70, y: 150 }} to={{ x: WIN_APP.x - 4, y: WIN_TASKBAR.y - 10 }} lift={-30} />
    <Arc from={{ x: 346, y: 150 }} to={{ x: WIN_OVERFLOW_TRAY.x + 20, y: WIN_OVERFLOW_TRAY.y - 4 }} lift={24} />
  </g> : <g>
    <StatusBar theme={theme} clock={clock} />
    <DeskDock />
    <Arc from={{ x: 112, y: 100 }} to={{ x: RING.x, y: BAR_H + 9 }} lift={30} />
    <Arc from={{ x: 272, y: 158 }} to={{ x: 201, y: 246 }} lift={30} />
  </g>;

  // The handoff card draws the dashboard the intro is about to reveal, the same art as the Today card.
  if (step === "day" || step === "handoff") {
    // Crop the navigation rail so the hours-down chart, activity names and right
    // Breakdown fit together. The former crop hid both new reading destinations.
    const k = 0.4, x = -76, y = 30;
    return <AppWindow x={x} y={y} w={APP_W * k} srcH={800} active="day" labels={labels} theme={theme} page={today} />;
  }

  if (step === "activity") {
    const ek = 0.56, ex = 220, ey = 38;
    const from = onWin(330, 262), chip = { x: ex + 12 * ek, y: ey + 95 * ek };
    return <g>
      {!windows && <DeskDock faded />}
      <AppWindow {...WIN} opacity={0.62} active="classification" labels={labels} theme={theme} page={<ClassificationPage labels={labels} />} />
      <Scaled x={ex} y={ey} k={ek}><CorrectionEditor labels={labels} selected={0} prod={0} /></Scaled>
      <Arc from={{ x: from.x + 18, y: from.y - 14 }} to={{ x: chip.x - 8, y: chip.y + 4 }} lift={22} />
    </g>;
  }

  // Menu bar: the last card. The menu drops from the lit icon and the arrow reopens the window.
  // macOS drops a status item's menu from the item's left edge, just under the bar. Windows opens the
  // tray menu at the click, here the badge pressed inside the hidden-icons flyout, and flips it upward
  // near the bottom of the screen, so its bottom-left corner sits at the badge.
  const mk = windows ? 0.88 : 0.95, mh = trayMenuHeight("running") * mk;
  const menu = windows ? { x: WIN_OVERFLOW_TRAY.x + 10, y: WIN_OVERFLOW_TRAY.y - mh } : { x: RING.x - 18, y: BAR_H + 3 };
  const dash = { x: menu.x, y: menu.y + (trayRowTop("dashboard") + 8.5) * mk };
  const win = windows ? { x: 18, y: 40, w: 160 } : { x: 18, y: 214, w: 176 };
  return <g>
    {windows ? taskbar(false) : <StatusBar theme={theme} clock={clock} lit />}
    <AppWindow {...win} srcH={700} opacity={0.45} active="day" labels={labels} theme={theme} page={today} />
    <Scaled x={menu.x} y={menu.y} k={mk}><TrayMenu x={0} y={0} ko={ko} active="dashboard" highlight={windows ? "neutral" : "accent"} /></Scaled>
    {windows
      ? <Arc from={{ x: dash.x - 8, y: dash.y }} to={{ x: win.x + win.w * 0.62, y: win.y + 700 * (win.w / APP_W) + 8 }} lift={20} />
      : <Arc from={{ x: dash.x - 8, y: dash.y }} to={{ x: win.x + win.w * 0.36, y: win.y - 8 }} lift={30} />}
  </g>;
}
