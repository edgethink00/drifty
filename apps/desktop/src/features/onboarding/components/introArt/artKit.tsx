import type { CSSProperties, ReactNode } from "react";
import { NavIcon } from "../../../../app/AppShell";
import type { NavIconType } from "../../../../app/navigation";
import driftyIcon from "../../../../assets/drifty-icon.png";
import driftyMark from "../../../../assets/drifty-mark.svg";
import { BUILD_INFO } from "../../../../buildInfo";

/**
 * Review-only drawing kit for the intro cards. Every piece copies a real Drifty surface:
 * the ring geometry and colours come from src-tauri/src/donut_icon.rs, the menu rows from
 * tray_menu_rows() in src-tauri/src/tray.rs, and sidebar glyphs are the app's own NavIcon.
 * Colours come from the app's CSS tokens so both themes follow the real product.
 */
export type ArtTheme = "light" | "dark";
export type Shares = { readonly focus: number; readonly drift: number; readonly neutral: number };
export const VIEW = { w: 400, h: 350 } as const;

const TRAY_COLORS = {
  light: { focus: "#536414", drift: "#8f352d", neutral: "#b8b3a7" },
  dark: { focus: "#cfe86a", drift: "#f28a78", neutral: "#6a675e" },
} as const;
export const tone = {
  focus: "var(--accent)", neutral: "var(--category-communication)", drift: "var(--category-entertainment)",
  purple: "var(--category-music)", teal: "var(--category-learning)", amber: "var(--category-shopping)",
};
/** Same split as the Today screen's productivity donut (76% focus). */
export const DAY_SHARES: Shares = { focus: 0.76, drift: 0.13, neutral: 0.11 };
const LIGHT_VARS = { "--canvas": "#f2f1ed", "--bg-2": "#e7e5df", "--surface": "#fafaf8", "--surface-strong": "#f4f3ef", "--line": "rgba(28,28,25,.08)", "--line-strong": "rgba(28,28,25,.16)", "--text": "#1c1c19", "--text-muted": "#383834", "--text-soft": "#79776f", "--accent": "#5f7f31", "--accent-soft": "#e1ead5", "--accent-strong": "#486924", "--productivity-focus": "#4f751e", "--productivity-drift": "#a34139", "--productivity-neutral": "#9b968b", "--category-workspace": "#5f7f31", "--category-learning": "#2f7f78", "--category-communication": "#476f8f", "--category-music": "#7b5ea7", "--category-game": "#9a6530", "--category-social-media": "#9b5b91", "--category-entertainment": "#c05d48", "--category-shopping": "#a1792f", "--category-utility": "#66707a" };
const DARK_VARS = { "--canvas": "#141412", "--bg-2": "#20201c", "--surface": "#1a1a17", "--surface-strong": "#22221e", "--line": "rgba(232,230,223,.13)", "--line-strong": "rgba(232,230,223,.20)", "--text": "#dcd9d0", "--text-muted": "#c8c5bc", "--text-soft": "#96938a", "--accent": "#9bbf5a", "--accent-soft": "#26321d", "--accent-strong": "#b6d779", "--productivity-focus": "#b7d96b", "--productivity-drift": "#e87568", "--productivity-neutral": "#8f897d", "--category-workspace": "#9bbf5a", "--category-learning": "#5fb7ad", "--category-communication": "#7fa2c2", "--category-music": "#a48bd2", "--category-game": "#c0864d", "--category-social-media": "#c17db4", "--category-entertainment": "#e67b65", "--category-shopping": "#caa04e", "--category-utility": "#8a98a4" };
/** Draws its children with the app's light or dark tokens, whatever theme the card itself uses. */
export function ThemeScope({ mode, children }: { mode: ArtTheme; children: ReactNode }) {
  return <g style={(mode === "dark" ? DARK_VARS : LIGHT_VARS) as CSSProperties}>{children}</g>;
}

export function RingArcs({ cx, cy, r, sw, shares, theme, track = true, palette = "tray" }: { cx: number; cy: number; r: number; sw: number; shares: Shares; theme: ArtTheme; track?: boolean; palette?: "tray" | "app" }) {
  // The tray icon has its own colours (donut_icon.rs); charts inside the app use the productivity tokens.
  const c = palette === "app" ? { focus: "var(--productivity-focus)", drift: "var(--productivity-drift)", neutral: "var(--productivity-neutral)" } : TRAY_COLORS[theme];
  const arc = (start: number, size: number, color: string, key: string) => size > 0
    ? <circle key={key} r={r} fill="none" stroke={color} strokeWidth={sw} pathLength={100} strokeDasharray={size * 100 + " " + (100 - size * 100)} strokeDashoffset={-start * 100} /> : null;
  return <g transform={"translate(" + cx + " " + cy + ") rotate(-90)"}>
    {track && <circle r={r} fill="none" stroke={c.neutral} strokeWidth={sw} opacity=".35" />}
    {arc(0, shares.focus, c.focus, "f")}{arc(shares.focus, shares.drift, c.drift, "d")}{arc(shares.focus + shares.drift, shares.neutral, c.neutral, "n")}
  </g>;
}
/**
 * The real 18pt menu-bar ring from donut_icon::render (compact): r 6.5 with a 2.5pt core and a 1.5pt fade
 * on each edge, focus → drift → neutral clockwise from 12 o'clock in the tray colours. The fade is a 1x
 * bitmap artefact, so the art draws the ring's 50%-alpha contour as a crisp stroke instead: the same
 * outer (8.5) and inner (4.5) radius the eye reads on screen, i.e. a 4pt stroke at r 6.5.
 */
export function TrayRing({ cx, cy, s = 1, shares = DAY_SHARES, theme }: { cx: number; cy: number; s?: number; shares?: Shares; theme: ArtTheme }) {
  return <RingArcs cx={cx} cy={cy} r={6.5 * s} sw={4 * s} shares={shares} theme={theme} />;
}
export function BrandMark({ x, y, size, theme }: { x: number; y: number; size: number; theme: ArtTheme }) {
  return <image href={driftyMark} x={x} y={y} width={size} height={size} style={theme === "dark" ? { filter: "invert(1)" } : undefined} />;
}
export function AppIcon({ x, y, size }: { x: number; y: number; size: number }) {
  return <image href={driftyIcon} x={x} y={y} width={size} height={size} />;
}
export function Txt({ x, y, size = 9, weight = 500, fill = "var(--text)", anchor = "start", children, opacity }: { x: number; y: number; size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; children: ReactNode; opacity?: number }) {
  return <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} opacity={opacity}>{children}</text>;
}
export function Bar({ x, y, w, h = 4, fill = "var(--line-strong)", opacity }: { x: number; y: number; w: number; h?: number; fill?: string; opacity?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={fill} opacity={opacity} />;
}
export function Glyph({ type, x, y, size = 10, fill }: { type: NavIconType; x: number; y: number; size?: number; fill?: string }) {
  return <g transform={"translate(" + x + " " + y + ") scale(" + size / 18 + ")"} style={{ color: fill ?? "var(--text-soft)" }}><NavIcon type={type} /></g>;
}
export function Check({ x, y, s = 1, color = "var(--accent)" }: { x: number; y: number; s?: number; color?: string }) {
  return <path d={"M" + x + " " + y + "l" + 3 * s + " " + 3 * s + " " + 6 * s + " " + -6.5 * s} fill="none" stroke={color} strokeWidth={1.8 * s} strokeLinecap="round" strokeLinejoin="round" />;
}
export function Chevron({ x, y, s = 1, dir = "right", color = "var(--text-soft)" }: { x: number; y: number; s?: number; dir?: "right" | "down"; color?: string }) {
  const d = dir === "right" ? "M0 0l3.5 3.5L0 7" : "M0 0l3.5 3.5L7 0";
  return <path d={d} transform={"translate(" + x + " " + y + ") scale(" + s + ")"} fill="none" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />;
}
export function Card({ x, y, w, h, r = 10, children, flat = false }: { x: number; y: number; w: number; h: number; r?: number; children?: ReactNode; flat?: boolean }) {
  return <g transform={"translate(" + x + " " + y + ")"}><rect width={w} height={h} rx={r} className={flat ? "real-art__flat" : "real-art__card"} />{children}</g>;
}

/** Coach-mark vocabulary: a dashed halo and a hand-drawn arrow, in the accent colour. */
export function Halo({ x, y, w, h, r = 6 }: { x: number; y: number; w: number; h: number; r?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={r} className="real-art__halo" />;
}
/* ---------- Calendar-style time grid: blocks sit at their real time offsets, like the app's day canvas ---------- */
export type GridBlock = { readonly col: number; readonly y: number; readonly h: number; readonly c: string };
/** One synthetic workday. y and h are fractions of the grid height; the drift block is column 2. */
export function dayBlocks(fixed = false): GridBlock[] {
  const d = fixed ? tone.focus : tone.drift;
  return [
    { col: 0, y: .10, h: .30, c: tone.focus }, { col: 0, y: .46, h: .16, c: tone.neutral },
    { col: 1, y: .06, h: .52, c: tone.focus }, { col: 1, y: .64, h: .12, c: tone.neutral },
    { col: 2, y: .18, h: .24, c: tone.focus }, { col: 2, y: .48, h: .14, c: d }, { col: 2, y: .68, h: .2, c: tone.focus },
    { col: 3, y: .04, h: .38, c: tone.focus }, { col: 3, y: .48, h: .1, c: tone.purple },
    { col: 4, y: .12, h: .18, c: tone.neutral }, { col: 4, y: .36, h: .4, c: tone.focus },
    { col: 5, y: .02, h: .24, c: tone.focus }, { col: 5, y: .32, h: .2, c: tone.neutral }, { col: 5, y: .6, h: .22, c: tone.focus },
    { col: 6, y: .14, h: .46, c: tone.focus }, { col: 6, y: .66, h: .1, c: tone.teal },
    { col: 7, y: .08, h: .2, c: tone.neutral }, { col: 7, y: .34, h: .34, c: tone.focus },
    { col: 8, y: .2, h: .5, c: tone.focus },
    { col: 9, y: .06, h: .26, c: tone.focus }, { col: 9, y: .4, h: .14, c: tone.neutral },
  ];
}
export function blockRect(w: number, h: number, cols: number, b: GridBlock) {
  const cw = w / cols;
  return { x: b.col * cw + cw * .18, y: b.y * h, w: cw * .64, h: b.h * h };
}
export function TimeGrid({ x, y, w, h, cols = 10, blocks, ticks = true }: { x: number; y: number; w: number; h: number; cols?: number; blocks: GridBlock[]; ticks?: boolean }) {
  const cw = w / cols;
  return <g transform={"translate(" + x + " " + y + ")"}>
    {Array.from({ length: cols }, (_, i) => i % 2 === 0 ? <rect key={i} x={i * cw} width={cw} height={h} fill="var(--line)" opacity=".28" /> : null)}
    {ticks && [0, 1, 2, 3, 4].map(i => <rect key={i} x={-9} y={i * h / 4.6 + 1} width={5} height={1.6} rx={.8} fill="var(--text-soft)" opacity=".5" />)}
    {blocks.map((b, i) => { const r = blockRect(w, h, cols, b); return <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={1.8} fill={b.c} opacity=".86" />; })}
  </g>;
}
/** Focus (solid) and drift (dashed) intensity through the day, as in the app's lower chart. */
export function Curves({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const bump = (cx: number, wd: number, ht: number) => "M" + (cx - wd) + " " + h + "C" + (cx - wd * .5) + " " + h + " " + (cx - wd * .6) + " " + (h - ht) + " " + cx + " " + (h - ht) + "S" + (cx + wd * .5) + " " + h + " " + (cx + wd) + " " + h;
  return <g transform={"translate(" + x + " " + y + ")"} fill="none" strokeLinecap="round">
    <path d={"M0 " + h + "H" + w} stroke="var(--line-strong)" />
    <path d={bump(w * .3, w * .2, h * .86) + bump(w * .64, w * .15, h * .7) + bump(w * .86, w * .1, h * .5)} stroke={tone.focus} strokeWidth="1.6" fill="color-mix(in srgb, var(--accent) 12%, transparent)" />
    <path d={bump(w * .5, w * .1, h * .34) + bump(w * .76, w * .08, h * .26)} stroke={tone.drift} strokeWidth="1.2" strokeDasharray="3 2.5" />
  </g>;
}
export function WeekPreview({ x, y, w = 150, h = 104, label, theme }: { x: number; y: number; w?: number; h?: number; label: string; theme: ArtTheme }) {
  const week: GridBlock[] = [
    { col: 0, y: .1, h: .5, c: tone.focus }, { col: 1, y: .04, h: .62, c: tone.focus }, { col: 1, y: .72, h: .12, c: tone.neutral }, { col: 2, y: .2, h: .3, c: tone.focus }, { col: 2, y: .56, h: .14, c: tone.drift },
    { col: 3, y: .08, h: .56, c: tone.focus }, { col: 4, y: .16, h: .34, c: tone.focus }, { col: 4, y: .56, h: .2, c: tone.neutral }, { col: 5, y: .3, h: .18, c: tone.focus }, { col: 6, y: .42, h: .12, c: tone.neutral },
  ];
  return <Card x={x} y={y} w={w} h={h} r={9}>
    <Txt x={12} y={19} size={9} weight={700}>{label}</Txt>
    <RingArcs cx={w - 20} cy={15} r={6.5} sw={3} shares={DAY_SHARES} theme={theme} />
    <TimeGrid x={20} y={32} w={w - 32} h={h - 44} cols={7} blocks={week} />
  </Card>;
}
export function Swoosh({ d, head, angle = 0, color = "var(--accent)" }: { d: string; head: readonly [number, number]; angle?: number; color?: string }) {
  return <g fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /><path d="M-5.5 -4.5L0 0-5.5 4.5" transform={"translate(" + head[0] + " " + head[1] + ") rotate(" + angle + ")"} /></g>;
}
export function Pill({ x, y, text, tint = "var(--accent)", size = 9 }: { x: number; y: number; text: string; tint?: string; size?: number }) {
  const w = Math.max(28, text.length * size * 0.62 + 16);
  return <g transform={"translate(" + x + " " + y + ")"}><rect width={w} height={size + 9} rx={(size + 9) / 2} fill={tint} /><text x={w / 2} y={size + 1.5} fontSize={size} fontWeight="600" fill="var(--surface)" textAnchor="middle">{text}</text></g>;
}
/** Segmented label used for productivity classes, coloured like the dashboard filter chips. */
export function Chip({ x, y, text, color, w, h = 14, size = 8, strong = false }: { x: number; y: number; text: string; color: string; w?: number; h?: number; size?: number; strong?: boolean }) {
  const width = w ?? text.length * size * 0.75 + 20;
  return <g transform={"translate(" + x + " " + y + ")"}>
    <rect width={width} height={h} rx={h / 2} fill={strong ? color : "var(--surface-strong)"} stroke={strong ? "none" : "var(--line-strong)"} />
    <circle cx={h / 2 + 1} cy={h / 2} r={2.4} fill={strong ? "var(--surface)" : color} />
    <text x={h / 2 + 7} y={h / 2 + size * 0.36} fontSize={size} fontWeight="600" fill={strong ? "var(--surface)" : "var(--text)"}>{text}</text>
  </g>;
}

/* ---------- macOS / Windows shell ---------- */
export const MENU_H = 22;
export const RING_FROM_RIGHT = 112;
export function MenuBar({ w = 400, theme, shares = DAY_SHARES, ringGlow = false, appName = "Drifty" }: { w?: number; theme: ArtTheme; shares?: Shares; ringGlow?: boolean; appName?: string }) {
  const ink = "var(--text)", soft = "var(--text-soft)";
  const ringX = w - RING_FROM_RIGHT;
  return <g>
    <rect width={w} height={MENU_H} className="real-art__menubar" />
    <Txt x={12} y={14.5} size={10} weight={700}>{appName}</Txt>
    {[62, 86, 110, 134].map(x => <Bar key={x} x={x} y={9.5} w={16} h={3.5} fill={soft} opacity={.42} />)}
    {ringGlow && <circle cx={ringX} cy={MENU_H / 2} r={13} fill="var(--accent)" opacity=".16" />}
    <TrayRing cx={ringX} cy={MENU_H / 2} shares={shares} theme={theme} />
    <g fill="none" stroke={ink} strokeWidth="1.2" strokeLinecap="round" opacity=".78">
      <path d={"M" + (w - 96) + " 9.5a6 6 0 0 1 9 0M" + (w - 94) + " 12a3.4 3.4 0 0 1 5 0"} />
      <circle cx={w - 91.5} cy={14.5} r=".8" fill={ink} stroke="none" />
      <rect x={w - 80} y={8.5} width={13} height={6.5} rx={1.8} /><rect x={w - 79} y={9.5} width={8} height={4.5} rx={1} fill={ink} stroke="none" /><path d={"M" + (w - 66) + " 10.6v2.4"} />
      <rect x={w - 56} y={8} width={9} height={7} rx={2} /><circle cx={w - 52.2} cy={11.5} r="1.2" fill={ink} stroke="none" />
    </g>
    <Txt x={w - 10} y={14.5} size={9.5} anchor="end" fill={ink}>10:04</Txt>
  </g>;
}
/* The Windows taskbar lives in windowsShell.tsx. */
export function Dock({ x = 100, y = 300, w = 200 }: { x?: number; y?: number; w?: number }) {
  return <g transform={"translate(" + x + " " + y + ")"}>
    <rect width={w} height={42} rx={13} className="real-art__dock" />
    {[0, 1, 2, 3, 4].map(i => {
      const tx = 15 + i * 36;
      return i === 2
        ? <g key={i}><AppIcon x={tx - 1} y={5} size={32} /><circle cx={tx + 15} cy={38.5} r="1.6" fill="var(--text-soft)" /></g>
        : <rect key={i} x={tx} y={7} width={28} height={28} rx={7.5} fill="var(--surface-strong)" stroke="var(--line-strong)" opacity={.92} />;
    })}
  </g>;
}
export const DOCK_ICON = { cx: 200 + 0, cy: 320 };

/* ---------- Tray menu: rows follow tray_menu_rows() in tray.rs for the running and paused states ---------- */
export type TrayRow = "header" | "p15" | "p30" | "p60" | "forever" | "resume" | "status" | "drift" | "dashboard" | "settings" | "version" | "update" | "quit";
export function trayLabels(ko: boolean) {
  return {
    header: ko ? "활동 기록 일시 정지" : "Pause Tracking", p15: ko ? "15분 동안" : "15 Minutes", p30: ko ? "30분 동안" : "30 Minutes",
    p60: ko ? "1시간 동안" : "1 Hour", forever: ko ? "직접 다시 시작할 때까지" : "Forever", resume: ko ? "활동 기록 다시 시작" : "Resume Tracking",
    drift: ko ? "딴짓 알림: 감지 중" : "Drift alerts: Monitoring", driftPaused: ko ? "딴짓 알림: 일시 정지됨" : "Drift alerts: Paused",
    dashboard: ko ? "대시보드 열기" : "Open Dashboard", settings: ko ? "설정" : "Settings", version: "Drifty " + BUILD_INFO.version,
    update: ko ? "업데이트 확인…" : "Check for Updates...", quit: ko ? "Drifty 종료" : "Quit",
    resumesAt: (time: string) => ko ? "일시 정지됨 · " + time + "에 다시 시작" : "Paused · resumes at " + time,
  };
}
type MenuRow = { readonly id: TrayRow | "sep"; readonly text?: string; readonly disabled?: boolean };
function trayRows(ko: boolean, state: "running" | "paused", resumeAt: string): MenuRow[] {
  const L = trayLabels(ko);
  const tail: MenuRow[] = [{ id: "sep" }, { id: "dashboard", text: L.dashboard }, { id: "settings", text: L.settings }, { id: "sep" }, { id: "version", text: L.version, disabled: true }, { id: "update", text: L.update }, { id: "sep" }, { id: "quit", text: L.quit }];
  return state === "running"
    ? [{ id: "header", text: L.header, disabled: true }, { id: "p15", text: L.p15 }, { id: "p30", text: L.p30 }, { id: "p60", text: L.p60 }, { id: "forever", text: L.forever }, { id: "sep" }, { id: "drift", text: L.drift, disabled: true }, ...tail]
    : [{ id: "resume", text: L.resume }, { id: "status", text: L.resumesAt(resumeAt), disabled: true }, { id: "sep" }, { id: "drift", text: L.driftPaused, disabled: true }, ...tail];
}
export function trayMenuHeight(state: "running" | "paused" = "running", rowH = 17, ko = true) {
  return trayRows(ko, state, "10:19").reduce((sum, row) => sum + (row.id === "sep" ? 9 : rowH), 12);
}
/** Returns the top of a row inside the menu, so callouts can point at it. */
export function trayRowTop(row: TrayRow, state: "running" | "paused" = "running", rowH = 17, ko = true) {
  let cursor = 6;
  for (const item of trayRows(ko, state, "10:19")) { if (item.id === row) return cursor; cursor += item.id === "sep" ? 9 : rowH; }
  return cursor;
}
/** highlight "neutral" is the Windows 11 context menu's grey hover; macOS fills the row with the accent. */
export function TrayMenu({ x, y, w = 176, ko, active, state = "running", resumeAt = "10:19", rowH = 17, highlight = "accent" }: { x: number; y: number; w?: number; ko: boolean; active?: TrayRow; state?: "running" | "paused"; resumeAt?: string; rowH?: number; highlight?: "accent" | "neutral" }) {
  let cursor = 6;
  const nodes = trayRows(ko, state, resumeAt).map((row, i) => {
    const top = cursor;
    if (row.id === "sep") { cursor += 9; return <path key={"s" + i} d={"M8 " + (top + 4.5) + "H" + (w - 8)} stroke="var(--line-strong)" />; }
    cursor += rowH;
    const on = active === row.id;
    const filled = on && highlight === "accent";
    return <g key={row.id}>{on && <rect x={4} y={top} width={w - 8} height={rowH} rx={4.5} fill={filled ? "var(--accent)" : "var(--text)"} opacity={filled ? 1 : 0.08} data-tray-highlight={highlight} />}
      <Txt x={12} y={top + rowH * 0.7} size={9.4} fill={filled ? "var(--surface)" : row.disabled ? "var(--text-soft)" : "var(--text)"}>{row.text}</Txt></g>;
  });
  return <g transform={"translate(" + x + " " + y + ")"}><rect width={w} height={cursor + 6} rx={9} className="real-art__menu" />{nodes}</g>;
}

/* ---------- App window pieces ---------- */
export type NavLabels = { readonly day: string; readonly week: string; readonly classification: string; readonly projects: string; readonly insights: string; readonly history: string; readonly guest: string };
export type SidebarActive = "day" | "week" | "classification" | undefined;
export function TrafficLights({ x, y }: { x: number; y: number }) {
  return <g transform={"translate(" + x + " " + y + ")"}>{["#ee6a5f", "#f5be4f", "#61c554"].map((c, i) => <circle key={c} cx={i * 12 + 3.5} cy={3.5} r={3.4} fill={c} opacity=".9" />)}</g>;
}
export function Sidebar({ x, y, w, h, active, labels, theme, accountHot = false }: { x: number; y: number; w: number; h: number; active: SidebarActive; labels: NavLabels; theme: ArtTheme; accountHot?: boolean }) {
  const items: { id: string; icon: NavIconType; text: string; y: number; a?: SidebarActive }[] = [
    { id: "day", icon: "home", text: labels.day, y: 40, a: "day" }, { id: "week", icon: "calendar", text: labels.week, y: 58, a: "week" },
    { id: "cls", icon: "classification", text: labels.classification, y: 92, a: "classification" }, { id: "prj", icon: "projects", text: labels.projects, y: 110 },
    { id: "trd", icon: "trends", text: labels.insights, y: 128 }, { id: "his", icon: "history", text: labels.history, y: 146 },
  ];
  return <g transform={"translate(" + x + " " + y + ")"}>
    <rect width={w} height={h} fill="var(--bg-2)" opacity=".62" />
    <TrafficLights x={9} y={7} />
    <BrandMark x={10} y={22} size={11} theme={theme} />
    <path d={"M8 36.5H" + (w - 8)} stroke="var(--line)" />
    <Bar x={10} y={44 - 20 + 21} w={0} />
    {items.map(item => {
      const on = item.a !== undefined && item.a === active;
      return <g key={item.id}>{on && <rect x={5} y={item.y - 2} width={w - 10} height={16} rx={5} fill="var(--accent-soft)" />}
        <Glyph type={item.icon} x={11} y={item.y + 0.5} size={10} fill={on ? "var(--accent-strong)" : "var(--text-soft)"} />
        <Txt x={26} y={item.y + 10} size={8.4} weight={on ? 700 : 500} fill={on ? "var(--accent-strong)" : "var(--text-muted)"}>{item.text}</Txt></g>;
    })}
    <Bar x={11} y={80} w={20} h={2.6} opacity={.7} />
    <g transform={"translate(0 " + (h - 32) + ")"}>
      {accountHot && <rect x={4} y={0} width={w - 8} height={26} rx={7} fill="var(--accent-soft)" />}
      <circle cx={17} cy={13} r={7.5} fill="var(--surface)" stroke="var(--line-strong)" /><circle cx={17} cy={11} r={2.3} fill="none" stroke="var(--text-soft)" strokeWidth="1" /><path d="M12.7 17.5a4.3 3.4 0 0 1 8.6 0" fill="none" stroke="var(--text-soft)" strokeWidth="1" />
      <Txt x={29} y={16} size={8.4} weight={600}>{labels.guest}</Txt><Chevron x={w - 14} y={9.5} s={.8} dir="down" />
    </g>
  </g>;
}
export function Window({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children?: ReactNode }) {
  return <g transform={"translate(" + x + " " + y + ")"}><rect width={w} height={h} rx={11} className="real-art__window" />{children}</g>;
}
/** The Today canvas: filter chips, hour columns, donut and a side breakdown. */
export function TodayPane({ x, y, w, h, theme, labels, muted = false }: { x: number; y: number; w: number; h: number; theme: ArtTheme; labels: { focus: string; drift: string; neutral: string }; muted?: boolean }) {
  const chartW = w - 70, gridH = h - 20 - 66;
  return <g transform={"translate(" + x + " " + y + ")"} opacity={muted ? .5 : 1}>
    <Chip x={0} y={0} text={labels.focus} color={tone.focus} /><Chip x={44} y={0} text={labels.neutral} color={tone.neutral} /><Chip x={88} y={0} text={labels.drift} color={tone.drift} />
    <rect x={0} y={20} width={chartW} height={gridH + 8} rx={7} fill="var(--surface)" stroke="var(--line)" />
    <TimeGrid x={16} y={26} w={chartW - 24} h={gridH - 6} blocks={dayBlocks()} />
    <rect x={0} y={h - 52} width={chartW} height={52} rx={7} fill="var(--surface)" stroke="var(--line)" />
    <Curves x={14} y={h - 44} w={chartW - 28} h={34} />
    <rect x={chartW + 6} y={0} width={w - chartW - 6} height={h} rx={7} fill="var(--surface)" stroke="var(--line)" />
    <RingArcs cx={chartW + 6 + (w - chartW - 6) / 2} cy={30} r={14} sw={6} shares={DAY_SHARES} theme={theme} />
    {[0, 1, 2].map(i => <g key={i}><circle cx={chartW + 14} cy={62 + i * 12} r={2.2} fill={[tone.focus, tone.drift, tone.neutral][i]} /><Bar x={chartW + 21} y={60.4 + i * 12} w={[22, 16, 19][i]} h={3} /></g>)}
  </g>;
}

/* ---------- A simple desktop that scenes can move a camera across ---------- */
export function camera(fx: number, fy: number, fw: number, fh: number) {
  const s = Math.min(VIEW.w / fw, VIEW.h / fh);
  return "translate(" + (-fx * s + (VIEW.w - fw * s) / 2) + " " + (-fy * s + (VIEW.h - fh * s) / 2) + ") scale(" + s + ")";
}
