import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { PET_MODE_PAW_CONTACT_FRAME } from "../../pet-mode/petModeData";
import { PetModeCat } from "../../pet-mode/PetModeCat";
import "../../pet-mode/petMode.css";
import type { HostPlatform } from "../../../lib/api/accessibilityClient";
import { useLocalization } from "../../localization/LocalizationContext";
import type { PostOnboardingSidebarGuideStep } from "../postOnboardingSidebarGuide";
import "../styles/sidebar-guide-real-art.css";
import { StoryScene, storyCatPlacement, type ArtCatPlacement } from "./introArt/StoryScene";
import { VIEW } from "./introArt/artKit";
import { ArtPlatform, type RealLabels } from "./introArt/realApp";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedCompactHourLabel } from "../../../lib/formatting";

/** Sample day for the drawn Today screen: 5h 15m of focus on a Wednesday afternoon. */
const FOCUS_SECONDS = 5 * 3600 + 15 * 60;
const SAMPLE_DAY = new Date(2026, 8, 30, 12);
/** The sample "now": the Today timeline stops at 18:08 and the menu bar clock shows the same time. */
const SAMPLE_NOW = new Date(2026, 8, 30, 18, 8);
/** macOS menu bar clock with the date hidden and the weekday shown (a stock Control Center setting). */
function menuBarClock(ko: boolean) {
  const locale = ko ? "ko-KR" : "en-US";
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(SAMPLE_NOW);
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(SAMPLE_NOW).replace(/\u202f/g, " ");
  return ko ? "(" + weekday + ") " + time : weekday + " " + time;
}

const CAT_STYLE = {
  position: "relative", width: 144, height: 99,
  "--pet-fur": "#e8e5da", "--pet-ink": "#171916", "--pet-accent": "#a9d66d",
  "--pet-raster-filter": "url(#pet-mode-coat-ivory)", "--pet-drag-raster-filter": "url(#pet-mode-coat-ivory)",
  "--pet-contact-shadow": "rgba(0, 0, 0, .22)", "--pet-drop-shadow": "drop-shadow(0 3px 3px rgba(0, 0, 0, 0.18))",
} as CSSProperties;

/**
 * Lays the real 144x99 cat over the SVG at art coordinates. It repeats the SVG's xMidYMid "meet" fit
 * (scale = min(width / 400, height / 350), centred) so it lands exactly where the scene drew its shadow.
 * It lives outside the SVG because WebKit ignores SVG transforms for positioned HTML in foreignObject.
 */
/** What the cat is doing on the Automatic close card at a moment: where it is and which frame it shows. */
type CatMotion = { readonly dx: number; readonly phase: "idle" | "run" | "paw" | "sit"; readonly frame: number; readonly closed: boolean; readonly stage: string };
const STILL: CatMotion = { dx: 0, phase: "paw", frame: PET_MODE_PAW_CONTACT_FRAME, closed: false, stage: "still" };
/*
 * The Automatic close card is a three-beat slideshow inside the card, in the same language as the card paging:
 * still frames, never a frame-by-frame animation. Windows dissolve (420ms). The cat never
 * slides or doubles: the old pose fades out in 120ms, then the next fades in at its own spot. 1) the cat notices the drift window, 2) its paw is on the
 * window, 3) the window is gone and the cat sits by the work. Each beat holds about 1.2s, plays once and
 * ends on the result. Every pose is a real desktop-pet frame. Reduced motion shows beat 2 only.
 */
const BEAT_MS = 1400;
const BEATS: readonly CatMotion[] = [
  { dx: 58, phase: "idle", frame: 0, closed: false, stage: "notice" },
  { dx: 0, phase: "paw", frame: PET_MODE_PAW_CONTACT_FRAME, closed: false, stage: "swat" },
  { dx: 0, phase: "sit", frame: 0, closed: true, stage: "closed" },
];
const canPlayBeats = () => typeof window !== "undefined" && typeof window.matchMedia === "function"
  && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/**
 * settled renders the last beat at once with no transitions: the page-change copy that fades out after
 * "Next" must keep the result on screen instead of replaying the slideshow from the drift window.
 * The first beat is the initial state, so entering the card never flashes the still frame first.
 */
function useSwatMotion(enabled: boolean, settled: boolean): { readonly motion: CatMotion; readonly beat: number | null } {
  const [beat, setBeat] = useState<number | null>(() => !enabled ? null : settled ? BEATS.length - 1 : canPlayBeats() ? 0 : null);
  useEffect(() => {
    if (!enabled || settled || !canPlayBeats()) return undefined;
    const image = new Image(); image.src = "/pet-mode/paw/f" + String(PET_MODE_PAW_CONTACT_FRAME + 1).padStart(3, "0") + ".png";
    const timers = [window.setTimeout(() => setBeat(1), BEAT_MS), window.setTimeout(() => setBeat(2), BEAT_MS * 2)];
    return () => timers.forEach(id => window.clearTimeout(id));
  }, [enabled, settled]);
  return { motion: beat === null ? STILL : BEATS[beat], beat };
}

/** One pose of the cat. All beat poses stay mounted and crossfade; they share the current beat's position. */
function ArtCat({ place, motion, dx, shown = true }: { readonly place: ArtCatPlacement; readonly motion?: CatMotion; readonly dx?: number; readonly shown?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ readonly s: number; readonly ox: number; readonly oy: number } | null>(null);
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return undefined;
    const measure = () => {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      const s = Math.min(w / VIEW.w, h / VIEW.h);
      setFit({ s, ox: (w - VIEW.w * s) / 2, oy: (h - VIEW.h * s) / 2 });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);
  const style: CSSProperties = fit
    ? { left: fit.ox + (place.x + (dx ?? motion?.dx ?? 0)) * fit.s, top: fit.oy + place.y * fit.s, transform: "scale(" + fit.s * place.k + ")", opacity: shown ? 1 : 0, transition: shown ? "opacity 200ms ease-out 120ms" : "opacity 120ms ease-in" }
    : { visibility: "hidden" };
  return <div ref={ref} className="sidebar-guide-narrative-art__cat" style={style} aria-hidden="true">
    <div style={CAT_STYLE}>{motion
      ? <PetModeCat phase={motion.phase} facing="left" pawFrame={motion.phase === "paw" ? motion.frame : 0} frameOverride={motion.phase === "run" ? motion.frame : undefined} fastRunBetaEnabled publishHitRegion={false} decorative />
      : <PetModeCat phase="idle" facing="left" pawFrame={0} publishHitRegion={false} decorative />}</div>
  </div>;
}

/**
 * The illustration for one intro card, drawn from real Drifty surfaces (app window, tray ring and menu,
 * desktop pet). settled draws the card's final state without transitions, for the copy that fades out
 * during a page change.
 */
export function NarrativeGuideIllustration({ step, hostPlatform = "macos", theme = "light", settled = false }: {
  readonly step: PostOnboardingSidebarGuideStep; readonly settled?: boolean;
  readonly hostPlatform?: HostPlatform; readonly theme?: "light" | "dark";
}) {
  const { t, effectiveLanguage } = useLocalization();
  const clip = useId();
  const ko = effectiveLanguage === "ko";
  const labels: RealLabels = {
    day: t("nav.yourDay"), week: t("nav.yourWeek"), classification: t("nav.classification"), projects: t("nav.projects"), insights: t("nav.trends"), history: t("nav.history"), guest: t("account.guest"),
    focus: t("activity.productivity.focus"), drift: t("activity.productivity.drift"), neutral: t("activity.productivity.neutral"),
    groupDashboard: t("nav.group.dashboard"), groupActivity: t("nav.group.activity"), groupSocial: t("nav.group.social"), leaderboard: t("nav.leaderboard"),
    category: t("common.category"), productivity: t("common.productivity"), project: t("common.project"), breakdown: t("dashboard.today.breakdown"),
    total: t("common.total"), sessions: t("common.sessions"), topApp: t("classification.topApp"), focusRate: t("classification.focusRate"), title: t("classification.title"),
    dayShort: t("common.day"), weekShort: t("common.week"), now: t("common.now"),
    focusValue: formatLocalizedCompactDurationFromSeconds(FOCUS_SECONDS, ko ? "ko" : "en"), focusWord: ko ? "집중했습니다" : "Focused for", focusValueFirst: ko, share: t("dashboard.today.share"),
    date: new Intl.DateTimeFormat(ko ? "ko-KR" : "en-US", { month: ko ? "long" : "short", day: "numeric", weekday: "short" }).format(SAMPLE_DAY),
    menuClock: menuBarClock(ko),
    hours: [0, 1, 2, 3, 4, 5, 6, 7].map(i => formatLocalizedCompactHourLabel(4 + i * 3, ko ? "ko" : "en")), cancel: t("common.cancel"), apply: t("classification.correction.apply"),
    settings: t("postOnboarding.sidebarGuide.settingsLabel"), aiSettings: t("account.aiSettings"), language: t("postOnboarding.sidebarGuide.languageLabel"), languageValue: ko ? "한국어" : "English",
    darkMode: t("account.darkMode"), pet: t("settings.pet.show"), update: t("account.checkForUpdates"), feedback: t("account.sendFeedback"), signIn: t("account.signIn"), recording: t("tracker.trackingNow"),
    workspace: t("activity.category.workspace"), learning: t("activity.category.learning"), communication: t("activity.category.communication"), music: t("activity.category.music"), game: t("activity.category.game"),
    socialMedia: t("activity.category.socialMedia"), entertainment: t("activity.category.entertainment"), shopping: t("activity.category.shopping"), utility: t("activity.category.utility"),
  };
  const props = { theme, ko, platform: hostPlatform, labels, step };
  // Windows, the menu bar and the taskbar bleed to the real panel edge, so when the panel is wider or
  // taller than the art the rounded panel (overflow: hidden) does the cropping.
  const frame = { x: -VIEW.w, y: -VIEW.h, w: VIEW.w * 3, h: VIEW.h * 3 };
  const swat = useSwatMotion(step === "account", settled);
  const motion = step === "account" ? swat.motion : undefined;
  const beats = motion && swat.beat !== null ? BEATS : null;
  const cat = storyCatPlacement(step);
  return <div className={"sidebar-guide-narrative-host" + (settled ? " sidebar-guide-narrative-host--settled" : "")} data-pet-motion={motion?.stage}><svg className="sidebar-guide-narrative-art sidebar-guide-narrative-art--bleed" viewBox={"0 0 " + VIEW.w + " " + VIEW.h} preserveAspectRatio="xMidYMid meet" aria-hidden="true" data-art-scene={step} data-platform={hostPlatform} data-art-theme={theme}>
    <defs><clipPath id={clip}><rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} /></clipPath></defs>
    <g clipPath={"url(#" + clip + ")"}><ArtPlatform.Provider value={hostPlatform}>
      <StoryScene {...props} driftClosed={motion?.closed ?? false} />
    </ArtPlatform.Provider></g>
  </svg>{cat && (beats ? beats.map((b, i) => <ArtCat key={b.stage} place={cat} motion={b} dx={b.dx} shown={i === swat.beat} />) : <ArtCat place={cat} motion={motion} />)}</div>;
}
