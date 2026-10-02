import { useId, type CSSProperties, type ReactNode } from "react";
import type { PostOnboardingSidebarGuideStep } from "../../postOnboardingSidebarGuide";
import type { HostPlatform } from "../../../../lib/api/accessibilityClient";
import { AppIcon, Bar, DAY_SHARES, TrayMenu, TrayRing, trayMenuHeight, trayRowTop, type ArtTheme } from "./artKit";
import { APP_W, AppShell, ClassificationPage, CorrectionEditor, Scaled, TodayPage, type NavActive, type RealLabels } from "./realApp";
import { WIN_APP, WIN_OVERFLOW_TRAY, WIN_TASKBAR, WindowsTaskbar } from "./windowsShell";

/*
 * The post-onboarding introduction's illustrations, drawn from real Drifty surfaces. The menu bar and Dock
 * appear only on the first and last cards, where they are the subject. The middle cards show one window,
 * a faded, cropped Dock for context, and at most one hand-drawn arrow. The Automatic close card is the
 * only one that changes over time (see SwatScene and NarrativeGuideIllustration).
 */


export type SceneProps = { readonly theme: ArtTheme; readonly ko: boolean; readonly platform: HostPlatform; readonly labels: RealLabels };
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
export function storyCatPlacement(step: PostOnboardingSidebarGuideStep): ArtCatPlacement | null {
  return step === "account" ? CAT_SWAT : null;
}

/*
 * The Automatic close card tells one event: a drifting video window is open, the cat runs in and swats it, and the
 * window closes, leaving the work behind it. There is no button or arrow to explain; the window closes
 * from the point the paw lands (a slight shrink and fade), so the cause is the paw itself.
 */
function SwatScene({ windows, closed, labels }: { windows: boolean; closed: boolean; labels: RealLabels }) {
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

export function StoryScene({ step, theme, ko, platform, labels, driftClosed = false }: SceneProps & { step: PostOnboardingSidebarGuideStep; driftClosed?: boolean }) {
  if (step === "account") return <SwatScene windows={platform === "windows"} closed={driftClosed} labels={labels} />;
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

  if (step === "day") {
    // Deliberate bleed: the window sits at 0.56 (the smallest scale where app text stays text) and runs
    // off the art frame's right and bottom edges with a hard cut, like a product screenshot. The right
    // edge falls just after "now" (18:08) and before the 19:00 hour label, and the bottom edge falls
    // between the score panel (ends at app y 555) and the sidebar status card (starts at 557), so no
    // label, panel, or card is sliced.
    const k = 0.56, x = 30, y = 350 - 556 * k;
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
