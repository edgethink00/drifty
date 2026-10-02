import { AppIcon, type ArtTheme } from "./artKit";

/*
 * The Windows 11 taskbar, drawn at 1.5 art units per pixel so it reads like the macOS menu bar close-up
 * (the real 48px bar becomes 72 units, a 24px app icon 36 and a 16px tray icon 24). The art frame shows
 * the right half of a screen: Start and one pinned app, Drifty when its window is open, then the corner
 * in its real order: the hidden-icons chevron, Drifty's tray badge, Wi-Fi, volume and battery, and the
 * two-line clock. As on the menu bar, only Drifty's own items keep full strength; stock items are faint.
 */
export const WIN_K = 1.5;
export const WIN_TASKBAR = { y: 278, h: 48 * WIN_K } as const;
const CY = WIN_TASKBAR.y + WIN_TASKBAR.h / 2;
/** Centres of the items scenes point at. */
export const WIN_APP = { x: 120, y: CY, size: 24 * WIN_K } as const;
export const WIN_TRAY = { x: 206, y: CY, size: 16 * WIN_K } as const;
/**
 * Windows 11 puts a new app's tray icon in the hidden-icons flyout until the user drags it onto the
 * taskbar, so the welcome card shows that flyout open above the chevron with Drifty as its newest
 * (last) icon. Cells are 30px with an 8px inset, in the 2x2 grid the flyout uses for four icons.
 */
const FLYOUT_CELL = 30 * WIN_K, FLYOUT_PAD = 8 * WIN_K, FLYOUT_SIZE = FLYOUT_PAD * 2 + FLYOUT_CELL * 2;
const CHEVRON_X = { taskbar: 176, overflow: 214 } as const;
const FLYOUT = { x: CHEVRON_X.overflow - FLYOUT_SIZE / 2, y: WIN_TASKBAR.y - 4 * WIN_K - FLYOUT_SIZE } as const;
const flyoutCell = (col: number, row: number) => ({ x: FLYOUT.x + FLYOUT_PAD + FLYOUT_CELL * (col + 0.5), y: FLYOUT.y + FLYOUT_PAD + FLYOUT_CELL * (row + 0.5) });
/** Drifty's badge inside the open hidden-icons flyout. */
export const WIN_OVERFLOW_TRAY = { ...flyoutCell(1, 1), size: WIN_TRAY.size } as const;
const WIN_FONT = '"Segoe UI Variable Text", "Segoe UI", "Malgun Gothic", var(--font-sans), sans-serif';
/** Windows 11's default accent, used only for the running-app indicator under the focused app. */
const WIN_ACCENT: Record<ArtTheme, string> = { light: "#005fb8", dark: "#60cdff" };

/**
 * Drifty's Windows tray badge, the same geometry as donut_icon::render_windows_tray_badge: an opaque
 * warm tile (margin size/16, corner size/5) with the black hourglass inset by 27%. It does not follow
 * the theme, because the real badge must also read on the light overflow panel.
 */
export function WindowsTrayBadge({ cx, cy, size = WIN_TRAY.size }: { cx: number; cy: number; size?: number }) {
  const x = cx - size / 2, y = cy - size / 2, m = size / 16, inset = size * 0.27, far = size - inset, c = size / 2;
  return <g transform={"translate(" + x + " " + y + ")"} data-windows-tray-badge="">
    <rect x={m} y={m} width={size - m * 2} height={size - m * 2} rx={size / 5} fill="#f7f6f1" />
    <path d={"M" + inset + " " + inset + "H" + far + "L" + c + " " + c + "ZM" + c + " " + c + "L" + far + " " + far + "H" + inset + "Z"} fill="#050807" />
  </g>;
}

function StartLogo({ cx, cy, faint }: { cx: number; cy: number; faint: number }) {
  const tile = 8.6 * WIN_K, gap = 1.2 * WIN_K, x = cx - tile - gap / 2, y = cy - tile - gap / 2;
  return <g fill="var(--text)" opacity={faint}>
    {[0, 1, 2, 3].map(i => <rect key={i} x={x + (i % 2) * (tile + gap)} y={y + Math.floor(i / 2) * (tile + gap)} width={tile} height={tile} rx={1.4} />)}
  </g>;
}
function FolderGlyph({ cx, cy, faint }: { cx: number; cy: number; faint: number }) {
  const w = 22 * WIN_K, h = 17 * WIN_K, x = cx - w / 2, y = cy - h / 2;
  return <g opacity={faint} fill="var(--text)">
    <path d={"M" + x + " " + (y + 3) + "a3 3 0 0 1 3 -3h" + (w * 0.32) + "l4 4h" + (w * 0.68 - 10) + "a3 3 0 0 1 3 3v3H" + x + "z"} />
    <rect x={x} y={y + 8} width={w} height={h - 8} rx={3} />
  </g>;
}
function Chevron({ cx, cy, faint }: { cx: number; cy: number; faint: number }) {
  return <path d={"M" + (cx - 6) + " " + (cy + 3) + "L" + cx + " " + (cy - 3) + "L" + (cx + 6) + " " + (cy + 3)} fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity={faint + 0.1} />;
}
/** Stock tray icons in the flyout, as faint silhouettes: OneDrive, Bluetooth and Windows Security. */
function StockTrayGlyph({ kind, cx, cy, faint }: { kind: "cloud" | "bluetooth" | "shield"; cx: number; cy: number; faint: number }) {
  const stroke = { fill: "none", stroke: "var(--text)", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "cloud") return <path {...stroke} opacity={faint + 0.1} d={"M" + (cx - 9) + " " + (cy + 6) + "h18a5 5 0 0 0 0 -10a7 7 0 0 0 -13 -2a5.5 5.5 0 0 0 -5 12z"} />;
  if (kind === "bluetooth") return <path {...stroke} opacity={faint + 0.1} d={"M" + (cx - 6) + " " + (cy - 5) + "l11 10-5.5 5V" + (cy - 10) + "l5.5 5-11 10"} />;
  return <path {...stroke} opacity={faint + 0.1} d={"M" + cx + " " + (cy - 10) + "l9 3.5v6c0 6-4 9.5-9 11-5-1.5-9-5-9-11v-6z"} />;
}
function OverflowFlyout({ faint, pressed }: { faint: number; pressed: number | null }) {
  const glyphs = [["cloud", 0, 0], ["bluetooth", 1, 0], ["shield", 0, 1]] as const;
  return <g data-windows-tray-overflow="">
    <rect x={FLYOUT.x} y={FLYOUT.y} width={FLYOUT_SIZE} height={FLYOUT_SIZE} rx={8 * WIN_K} className="real-art__menu" />
    {glyphs.map(([kind, col, row]) => { const c = flyoutCell(col, row); return <StockTrayGlyph key={kind} kind={kind} cx={c.x} cy={c.y} faint={faint} />; })}
    {pressed !== null && <rect x={WIN_OVERFLOW_TRAY.x - FLYOUT_CELL / 2 + 3} y={WIN_OVERFLOW_TRAY.y - FLYOUT_CELL / 2 + 3} width={FLYOUT_CELL - 6} height={FLYOUT_CELL - 6} rx={6} fill="var(--text)" opacity={pressed} />}
    <WindowsTrayBadge cx={WIN_OVERFLOW_TRAY.x} cy={WIN_OVERFLOW_TRAY.y} />
  </g>;
}
function SystemIcons({ x, cy, faint }: { x: number; cy: number; faint: number }) {
  const ink = "var(--text)", base = cy + 7;
  const arc = (r: number) => { const dx = r * Math.sin(Math.PI / 4.2), dy = r * Math.cos(Math.PI / 4.2); return "M" + (x - dx) + " " + (base - dy) + "A" + r + " " + r + " 0 0 1 " + (x + dx) + " " + (base - dy); };
  const sx = x + 30, bx = x + 58;
  return <g opacity={faint + 0.1} fill="none" stroke={ink} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={arc(12) + arc(8) + arc(4)} /><circle cx={x} cy={base - 0.4} r={1.4} fill={ink} stroke="none" />
    <path d={"M" + (sx - 8) + " " + (cy - 3.5) + "h4l5 -5v17l-5 -5h-4z"} fill={ink} stroke="none" />
    <path d={"M" + (sx + 4) + " " + (cy - 4) + "a6 6 0 0 1 0 8M" + (sx + 7) + " " + (cy - 7.5) + "a10.5 10.5 0 0 1 0 15"} />
    <rect x={bx - 11} y={cy - 6} width={21} height={12} rx={3.2} strokeWidth="1.4" /><path d={"M" + (bx + 12) + " " + (cy - 2.4) + "v4.8"} strokeWidth="2" />
    <rect x={bx - 8.5} y={cy - 3.5} width={12} height={7} rx={1.4} fill={ink} stroke="none" />
  </g>;
}

/**
 * appOpen draws Drifty's taskbar button with the focused-app indicator; with the window closed the app
 * keeps no button (it is not pinned by default) and lives only in the tray. trayLit shows the pressed
 * tray icon while its menu is open. overflowOpen shows the default Windows 11 placement instead: the
 * badge inside the open hidden-icons flyout, with the pressed chevron right before the system icons;
 * trayLit then presses the badge inside the flyout.
 */
export function WindowsTaskbar({ theme, time, date, appOpen = false, trayLit = false, overflowOpen = false }: { theme: ArtTheme; time: string; date: string; appOpen?: boolean; trayLit?: boolean; overflowOpen?: boolean }) {
  const { y, h } = WIN_TASKBAR, faint = theme === "dark" ? 0.34 : 0.28;
  const pressed = theme === "dark" ? 0.14 : 0.08;
  const chevronX = overflowOpen ? CHEVRON_X.overflow : CHEVRON_X.taskbar;
  return <g style={{ fontFamily: WIN_FONT }} data-windows-taskbar="">
    <rect x={-400} y={y} width={1200} height={h + 350} className="real-art__menubar" />
    <path d={"M-400 " + (y + 0.5) + "H800"} stroke="var(--line-strong)" />
    <StartLogo cx={22} cy={CY} faint={faint} />
    <FolderGlyph cx={70} cy={CY} faint={faint} />
    {appOpen && <g data-windows-taskbar-app="">
      <rect x={WIN_APP.x - 20 * WIN_K} y={y + 4 * WIN_K} width={40 * WIN_K} height={40 * WIN_K} rx={4 * WIN_K} fill="var(--text)" opacity={theme === "dark" ? 0.08 : 0.05} />
      <AppIcon x={WIN_APP.x - WIN_APP.size / 2} y={CY - WIN_APP.size / 2 - 2} size={WIN_APP.size} />
      <rect x={WIN_APP.x - 8 * WIN_K} y={y + h - 4.5 * WIN_K} width={16 * WIN_K} height={3 * WIN_K} rx={1.5 * WIN_K} fill={WIN_ACCENT[theme]} />
    </g>}
    {overflowOpen && <rect x={chevronX - 16} y={CY - 22} width={32} height={44} rx={6} fill="var(--text)" opacity={pressed} />}
    <Chevron cx={chevronX} cy={CY} faint={faint} />
    {!overflowOpen && trayLit && <rect x={WIN_TRAY.x - 16} y={CY - 22} width={32} height={44} rx={6} fill="var(--text)" opacity={pressed} />}
    {!overflowOpen && <WindowsTrayBadge cx={WIN_TRAY.x} cy={CY} />}
    <SystemIcons x={246} cy={CY} faint={faint} />
    <g fill="var(--text)" opacity={faint + 0.24} fontSize="11.5" fontWeight="400" textAnchor="end">
      <text x={392} y={CY - 3}>{time}</text>
      <text x={392} y={CY + 13}>{date}</text>
    </g>
    {overflowOpen && <OverflowFlyout faint={faint} pressed={trayLit ? pressed : null} />}
  </g>;
}
