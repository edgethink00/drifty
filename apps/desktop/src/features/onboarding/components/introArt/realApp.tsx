import { createContext, useContext, useId, type ReactNode } from "react";
import { Bar, BrandMark, Chevron, Glyph, RingArcs, DAY_SHARES, type ArtTheme } from "./artKit";

/**
 * Schematic replicas of the real Drifty screens, drawn in the app's own CSS pixels for a 1200x800 window
 * (measured from the running app: 205px sidebar, 30px nav rows, 987px content card, 248px detail column ...).
 * Text that has a product string is real text; the rest is drawn as bars, like the fixed baseline art.
 * Wrap in <g transform="scale(k)"> to place it.
 */
export const APP_W = 1200;
export const APP_H = 800;
export type RealLabels = {
  /** Menu bar clock at the sample "now" (18:08, Wed), e.g. "(수) 오후 6:08" / "Wed 6:08 PM". */
  readonly menuClock?: string;
  readonly day: string; readonly week: string; readonly classification: string; readonly projects: string; readonly insights: string; readonly history: string;
  readonly guest: string; readonly focus: string; readonly drift: string; readonly neutral: string;
  readonly groupDashboard: string; readonly groupActivity: string; readonly groupSocial: string; readonly leaderboard: string;
  readonly category: string; readonly productivity: string; readonly project: string; readonly breakdown: string;
  readonly total: string; readonly sessions: string; readonly topApp: string; readonly focusRate: string; readonly title: string;
  readonly dayShort: string; readonly weekShort: string; readonly now: string;
  /** Today header exactly as DashboardPageHeader renders it: ko "5시간 15분 집중했습니다", en "Focused for 5h 15m". */
  readonly focusValue: string; readonly focusWord: string; readonly focusValueFirst: boolean; readonly share: string; readonly date: string; readonly hours: readonly string[]; readonly cancel: string; readonly apply: string;
  readonly settings: string; readonly aiSettings: string; readonly language: string; readonly languageValue: string; readonly darkMode: string; readonly pet: string;
  readonly update: string; readonly feedback: string; readonly signIn: string; readonly recording: string;
  readonly workspace: string; readonly learning: string; readonly communication: string; readonly music: string; readonly game: string;
  readonly socialMedia: string; readonly entertainment: string; readonly shopping: string; readonly utility: string;
};
export const CAT = {
  workspace: "var(--category-workspace)", learning: "var(--category-learning)", communication: "var(--category-communication)", music: "var(--category-music)",
  game: "var(--category-game)", socialMedia: "var(--category-social-media)", entertainment: "var(--category-entertainment)", shopping: "var(--category-shopping)", utility: "var(--category-utility)",
} as const;
const PROD = { focus: "var(--productivity-focus)", neutral: "var(--productivity-neutral)", drift: "var(--productivity-drift)" };

/** How many art units one app pixel takes at the current nesting; text below MIN_TEXT is drawn as a bar. */
export const ArtScale = createContext(1);
/** Which window chrome to draw: macOS traffic lights or Windows caption buttons. */
export const ArtPlatform = createContext<"macos" | "windows" | "other">("macos");
const MIN_TEXT = 7.5;
export function Scaled({ x = 0, y = 0, k, children }: { x?: number; y?: number; k: number; children: ReactNode }) {
  const parent = useContext(ArtScale);
  return <g transform={"translate(" + x + " " + y + ") scale(" + k + ")"}><ArtScale.Provider value={parent * k}>{children}</ArtScale.Provider></g>;
}
export type CropBox = { readonly x: number; readonly y: number; readonly w: number; readonly src: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } };
/** Shows one region of the app at a readable scale inside a window frame. */
export function Crop({ box, r = 12, children }: { box: CropBox; r?: number; children: ReactNode }) {
  const id = useId();
  const parent = useContext(ArtScale);
  const k = box.w / box.src.w, h = box.src.h * k;
  return <g transform={"translate(" + box.x + " " + box.y + ")"}>
    <rect width={box.w} height={h} rx={r} className="real-art__window" />
    <clipPath id={id}><rect width={box.w} height={h} rx={r} /></clipPath>
    <g clipPath={"url(#" + id + ")"}><g transform={"scale(" + k + ") translate(" + -box.src.x + " " + -box.src.y + ")"}><ArtScale.Provider value={parent * k}>{children}</ArtScale.Provider></g></g>
    <rect width={box.w} height={h} rx={r} fill="none" stroke="var(--line-strong)" />
  </g>;
}
/** Maps an app-pixel rectangle into art units for a crop. */
export function at(box: CropBox, x: number, y: number, w = 0, h = 0) {
  const k = box.w / box.src.w;
  return { x: box.x + (x - box.src.x) * k, y: box.y + (y - box.src.y) * k, w: w * k, h: h * k };
}
function textWidth(text: string, size: number) {
  let width = 0;
  for (const ch of text) width += /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7a3]/.test(ch) ? size * 0.92 : ch === " " ? size * 0.3 : size * 0.56;
  return width;
}
function T({ x, y, size = 13, weight = 500, fill = "var(--text)", anchor = "start", children, spacing }: { x: number; y: number; size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; children: ReactNode; spacing?: number }) {
  const scale = useContext(ArtScale);
  if (size * scale < MIN_TEXT) {
    const width = typeof children === "string" || typeof children === "number" ? textWidth(String(children), size) : size * 4;
    const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
    return <rect x={left} y={y - size * 0.62} width={width} height={size * 0.52} rx={size * 0.26} fill={fill} opacity=".5" />;
  }
  return <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor} letterSpacing={spacing}>{children}</text>;
}
function Panel({ x, y, width, height, r = 10, tint }: { x: number; y: number; width: number; height: number; r?: number; tint?: string }) {
  return <rect x={x} y={y} width={width} height={height} rx={r} fill={tint ?? "var(--surface)"} stroke="var(--line)" />;
}
function Avatar({ cx, cy, r = 15, letter }: { cx: number; cy: number; r?: number; letter: string }) {
  return <g><circle cx={cx} cy={cy} r={r} fill="var(--accent-soft)" /><T x={cx} y={cy + r * 0.36} size={r * 0.92} weight={700} anchor="middle" fill="var(--text-muted)">{letter}</T></g>;
}
export function Dots({ x, y, colors }: { x: number; y: number; colors: string[] }) {
  return <g>{colors.map((c, i) => <circle key={i} cx={x + i * 14} cy={y} r={5} fill={c} />)}</g>;
}
/** The Today filter row: each chip followed by its category dots, laid out by measured text width. */
function ChipRow({ x, y, labels }: { x: number; y: number; labels: RealLabels }) {
  const groups: [string, string[]][] = [[labels.focus, [CAT.workspace, CAT.learning]], [labels.neutral, [CAT.communication, CAT.music, CAT.utility]], [labels.drift, [CAT.entertainment, CAT.socialMedia, CAT.shopping, CAT.game]]];
  let cursor = x;
  return <g>{groups.map(([text, colors]) => { const at = cursor; cursor += 22 + textAdvance(text, 13.5) + 16 + colors.length * 14 + 12; return <PillChip key={text} x={at} y={y} text={text} colors={colors} />; })}</g>;
}
function PillChip({ x, y, text, colors }: { x: number; y: number; text: string; colors: string[] }) {
  const w = 22 + textAdvance(text, 13.5);
  return <g><rect x={x} y={y} width={w} height={26} rx={13} fill="var(--surface-strong)" stroke="var(--line-strong)" /><T x={x + w / 2} y={y + 17.8} size={13.5} weight={600} anchor="middle">{text}</T><Dots x={x + w + 16} y={y + 13} colors={colors} /></g>;
}
export function Segmented({ x, y, w, h = 28, items, selected }: { x: number; y: number; w: number; h?: number; items: string[]; selected: number }) {
  const cw = (w - 6) / items.length;
  return <g><rect x={x} y={y} width={w} height={h} rx={h / 2 - 1} fill="var(--line)" opacity=".7" />
    <rect x={x + 3 + selected * cw} y={y + 3} width={cw} height={h - 6} rx={h / 2 - 4} fill="var(--surface)" stroke="var(--line)" />
    {items.map((t, i) => <T key={i} x={x + 3 + i * cw + cw / 2} y={y + h / 2 + 4.5} size={12} weight={i === selected ? 700 : 500} anchor="middle" fill={i === selected ? "var(--text)" : "var(--text-soft)"}>{t}</T>)}</g>;
}
export function Toggle({ x, y, on }: { x: number; y: number; on: boolean }) {
  return <g><rect x={x} y={y} width={32} height={18} rx={9} fill={on ? "var(--accent)" : "var(--line-strong)"} /><circle cx={on ? x + 23 : x + 9} cy={y + 9} r={7} fill="var(--surface)" /></g>;
}

/* ---------- Shell: chrome, sidebar and content card ---------- */
export type NavActive = "day" | "week" | "classification" | undefined;
export function AppShell({ active, labels, theme, accountHot = false, children }: { active: NavActive; labels: RealLabels; theme: ArtTheme; accountHot?: boolean; children?: ReactNode }) {
  const platform = useContext(ArtPlatform);
  const nav = (id: NavActive | "prj" | "trd" | "his" | "lead", y: number, icon: Parameters<typeof Glyph>[0]["type"], text: string) => {
    const on = id === active;
    return <g key={String(id) + y}>{on && <rect x={8} y={y} width={189} height={30} rx={8} fill="var(--accent-soft)" />}
      <Glyph type={icon} x={22} y={y + 6} size={18} fill={on ? "var(--accent-strong)" : "var(--text-soft)"} />
      <T x={51} y={y + 20} size={13.5} weight={on ? 700 : 500} fill={on ? "var(--accent-strong)" : "var(--text-muted)"}>{text}</T></g>;
  };
  return <g>
    <rect width={APP_W} height={APP_H} fill="var(--canvas)" />
    {/* chrome: macOS traffic lights sit over the sidebar */}
    {platform === "windows"
      ? <g fill="none" stroke="var(--text-muted)" strokeWidth="1.4" strokeLinecap="round"><path d="M1098 17h12" /><rect x={1134} y={11} width={12} height={12} rx={1.5} /><path d="M1170 11l12 12M1182 11l-12 12" /></g>
      : ["#ee6a5f", "#f5be4f", "#61c554"].map((c, i) => <circle key={c} cx={22 + i * 20} cy={17} r={6} fill={c} />)}
    <g fill="none" stroke="var(--text-soft)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x={180} y={10} width={13} height={11} rx={2.5} /><path d="M186 10v11" />
      <path d="M229 11l-5 5 5 5" /><path d="M259 11l5 5-5 5" opacity=".45" /><circle cx={288} cy={16} r={3.4} /><path d="M288 8.5v2M288 21.5v2M280.5 16h2M293.5 16h2" />
    </g>
    <g transform={platform === "windows" ? "translate(-130 0)" : undefined}><circle cx={1040} cy={16} r={5} fill="var(--category-entertainment)" /><Bar x={1052} y={11} w={70} h={9} fill="var(--text)" opacity={.85} /><Bar x={1130} y={11} w={50} h={9} fill="var(--category-entertainment)" /></g>
    {/* sidebar */}
    <BrandMark x={12} y={42} size={28} theme={theme} />
    <path d="M8 80.5H197" stroke="var(--line-strong)" />
    <T x={20} y={106} size={11} fill="var(--text-soft)" spacing={0.6}>{labels.groupDashboard}</T>
    {nav("day", 123, "home", labels.day)}{nav("week", 155, "calendar", labels.week)}
    <T x={20} y={207} size={11} fill="var(--text-soft)" spacing={0.6}>{labels.groupActivity}</T>
    {nav("classification", 223, "classification", labels.classification)}{nav("prj", 255, "projects", labels.projects)}{nav("trd", 287, "trends", labels.insights)}{nav("his", 319, "history", labels.history)}
    <T x={20} y={371} size={11} fill="var(--text-soft)" spacing={0.6}>{labels.groupSocial}</T>
    {nav("lead", 386, "leaderboard", labels.leaderboard)}
    <rect x={8} y={557} width={189} height={134} rx={13} fill="color-mix(in srgb, var(--accent) 7%, var(--surface))" stroke="var(--line)" />
    <Bar x={24} y={575} w={128} h={11} fill="var(--text)" opacity={.85} /><Bar x={24} y={600} w={120} h={6} /><Bar x={24} y={614} w={80} h={6} />
    <rect x={17} y={650} width={171} height={32} rx={16} fill="var(--surface)" stroke="var(--line)" /><Bar x={62} y={663} w={70} h={7} fill="var(--text)" opacity={.8} />
    <rect x={8} y={697} width={189} height={46} rx={10} fill="var(--surface)" stroke="var(--line)" />
    <circle cx={22} cy={711} r={4} fill="var(--accent)" /><T x={31} y={714} size={11} fill="var(--text-soft)">{labels.recording}</T><T x={20} y={733} size={14} weight={700}>Visual Studio Code</T>
    <rect x={173} y={716} width={3.4} height={10} rx={1.4} fill="var(--text)" /><rect x={179} y={716} width={3.4} height={10} rx={1.4} fill="var(--text)" />
    {accountHot && <rect x={8} y={749} width={189} height={43} rx={11} fill="var(--accent-soft)" />}
    <circle cx={31} cy={770} r={14} fill="var(--surface)" stroke="var(--line-strong)" /><circle cx={31} cy={766} r={4.4} fill="none" stroke="var(--text-soft)" strokeWidth="1.5" /><path d="M23 778a8 6 0 0 1 16 0" fill="none" stroke="var(--text-soft)" strokeWidth="1.5" />
    <T x={53} y={775} size={14} weight={600}>{labels.guest}</T><g fill="none" stroke="var(--text-soft)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M176 764l4-4 4 4M176 776l4 4 4-4" /></g>
    {/* content card */}
    <rect x={205} y={32} width={987} height={760} rx={14} fill="var(--surface)" stroke="var(--line)" />
    {children}
  </g>;
}
export function DateNavR({ x, y, labels, wide = false }: { x: number; y: number; labels: RealLabels; wide?: boolean }) {
  return <g>{wide ? <Bar x={x} y={y + 2} w={92} h={11} fill="var(--text)" opacity={.85} /> : <T x={x + 72} y={y + 12} size={13} weight={650} anchor="end">{labels.date}</T>}
    <Chevron x={x + (wide ? 122 : 100)} y={y + 1} s={1.4} /><T x={x + (wide ? 168 : 146)} y={y + 14} size={12.5} fill="var(--text-soft)" anchor="middle">{labels.now}</T><Chevron x={x + (wide ? 210 : 188)} y={y + 1} s={1.4} /></g>;
}

/* ---------- Today: chips, 24-hour canvas, score chart, side breakdown ---------- */
type Seg = readonly [number, number, number, string]; // hour column, from minute, to minute, colour
const TODAY_SEGS: Seg[] = [
  [5, 14, 22, CAT.communication], [5, 26, 60, CAT.workspace],
  [6, 0, 60, CAT.workspace], [6, 10, 16, CAT.communication],
  [7, 0, 34, CAT.workspace], [7, 34, 42, CAT.socialMedia], [7, 42, 60, CAT.workspace],
  [8, 6, 60, CAT.workspace], [8, 30, 36, CAT.utility],
  [9, 0, 60, CAT.workspace], [9, 12, 20, CAT.communication],
  [10, 0, 26, CAT.workspace], [10, 30, 58, CAT.workspace],
  [11, 4, 60, CAT.workspace], [11, 44, 52, CAT.entertainment],
  [12, 0, 60, CAT.workspace], [12, 30, 40, CAT.socialMedia],
  [13, 0, 12, CAT.workspace], [13, 18, 60, CAT.workspace], [13, 38, 50, CAT.entertainment],
  [14, 0, 8, CAT.workspace],
];
export const TODAY_SEGMENTS = TODAY_SEGS;
export function DayCanvas({ x, y, w, h, from = 0, to = 24, segs = TODAY_SEGS, recolor }: { x: number; y: number; w: number; h: number; from?: number; to?: number; segs?: readonly Seg[]; recolor?: (s: Seg) => string }) {
  const cols = to - from, cw = w / cols;
  return <g transform={"translate(" + x + " " + y + ")"}>
    {Array.from({ length: cols }, (_, i) => <rect key={i} x={i * cw} width={cw} height={h} fill="var(--line)" opacity={i % 2 ? 0.16 : 0.34} />)}
    {segs.filter(s => s[0] >= from && s[0] < to).map((s, i) => <rect key={i} x={(s[0] - from) * cw} y={(s[1] / 60) * h} width={cw + 0.4} height={((s[2] - s[1]) / 60) * h} fill={recolor ? recolor(s) : s[3]} stroke="var(--surface)" strokeWidth=".7" opacity=".9" />)}
  </g>;
}
function textAdvance(text: string, size: number) {
  let width = 0;
  for (const ch of text) width += /[ᄀ-ᇿ㄰-㆏가-힣]/.test(ch) ? size * 0.96 : ch === " " ? size * 0.28 : /[0-9]/.test(ch) ? size * 0.6 : size * 0.58;
  return width;
}
const TITLE_SIZE = 24;
function titleEnd(labels: RealLabels) {
  return 229 + textAdvance(labels.focusValue, TITLE_SIZE) + textAdvance(labels.focusWord, TITLE_SIZE) + TITLE_SIZE * 0.3;
}
function FocusTitle({ x, y, labels }: { x: number; y: number; labels: RealLabels }) {
  const value = <tspan fontWeight={720} fill="var(--text)" letterSpacing={-0.7}>{labels.focusValue}</tspan>;
  const word = <tspan fontWeight={560} fill="var(--text-muted)" letterSpacing={-0.4}>{labels.focusWord}</tspan>;
  return <T x={x} y={y} size={TITLE_SIZE}>{labels.focusValueFirst ? <>{value} {word}</> : <>{word} {value}</>}</T>;
}
function ShareButton({ x, y, label }: { x: number; y: number; label: string }) {
  const w = 44 + textAdvance(label, 13.5);
  return <g transform={"translate(" + x + " " + y + ")"}>
    <rect width={w} height={32} rx={16} fill="var(--surface)" stroke="var(--line-strong)" />
    <g fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 17v4.5h11V17M22.5 10.5v8M19.5 13l3-3 3 3" /></g>
    <T x={34} y={21} size={13.5} weight={600}>{label}</T>
  </g>;
}
export function TodayPage({ labels, theme, muted = false, recolor }: { labels: RealLabels; theme: ArtTheme; muted?: boolean; recolor?: (s: Seg) => string }) {
  const gridX = 264, gridY = 156, gridW = 640, gridH = 227;
  return <g opacity={muted ? .55 : 1}>
    <FocusTitle x={229} y={82} labels={labels} />
    <ShareButton x={titleEnd(labels) + 18} y={57} label={labels.share} />
    <DateNavR x={725} y={62} labels={labels} />
    <Panel x={229} y={96} width={683} height={297} />
    <ChipRow x={241} y={106} labels={labels} />
    <Segmented x={747} y={109} w={156} items={[labels.category, labels.productivity, labels.project]} selected={0} />
    {labels.hours.map((hour, i) => <T key={i} x={gridX + (i * 3 + 0.5) * (gridW / 24)} y={152} size={13.5} anchor="middle" fill="var(--text-soft)">{hour}</T>)}
    {Array.from({ length: 15 }, (_, i) => <Bar key={i} x={244} y={gridY + 3 + i * (gridH / 15)} w={13} h={3.4} fill="var(--text-soft)" opacity={.55} />)}
    <DayCanvas x={gridX} y={gridY} w={gridW} h={gridH} recolor={recolor} />
    <path d={"M" + gridX + " 186H" + (gridX + 14.5 * (gridW / 24))} stroke="var(--text)" strokeWidth="1.6" /><rect x={241} y={176} width={26} height={20} rx={10} fill="var(--text)" /><Bar x={247} y={183} w={14} h={5} fill="var(--surface)" />
    <Panel x={229} y={405} width={683} height={150} />
    <Bar x={241} y={424} w={150} h={7} opacity={.9} />
    <rect x={794} y={415} width={62} height={26} rx={13} fill="color-mix(in srgb, var(--accent) 16%, var(--surface))" /><circle cx={808} cy={428} r={4} fill={PROD.focus} /><Bar x={818} y={425} w={26} h={6} fill="var(--accent-strong)" />
    <rect x={846} y={415} width={58} height={26} rx={13} fill="color-mix(in srgb, var(--category-entertainment) 16%, var(--surface))" /><circle cx={860} cy={428} r={4} fill={PROD.drift} /><Bar x={870} y={425} w={24} h={6} fill="var(--category-entertainment)" />
    {[0, 1, 2].map(i => <Bar key={i} x={236} y={452 + i * 44} w={22} h={4} opacity={.6} />)}
    <g transform="translate(264 450)" fill="none" strokeLinecap="round">
      <path d="M0 88H640" stroke="var(--line-strong)" />
      <path d="M180 88C205 88 200 14 232 14H262C292 14 285 88 310 88 M330 88C345 88 350 26 375 26 M375 26C392 26 398 88 412 88 M420 88C430 88 440 20 452 20C466 20 470 88 484 88" stroke={PROD.focus} strokeWidth="2.6" />
      <path d="M270 88C285 88 292 48 300 48C312 48 318 88 332 88 M378 88C396 88 404 44 414 44C424 44 430 88 448 88" stroke={PROD.drift} strokeWidth="1.8" strokeDasharray="6 4" />
    </g>
    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => <Bar key={i} x={264 + i * 79 - 6} y={541} w={14} h={4} opacity={.6} />)}
    <Panel x={229} y={567} width={683} height={170} />
    <Panel x={243} y={577} width={257} height={145} r={10} tint="var(--surface-strong)" />
    <Avatar cx={271} cy={608} r={16} letter="V" /><Bar x={300} y={598} w={104} h={9} fill="var(--text)" opacity={.85} /><Bar x={300} y={614} w={80} h={5} /><Bar x={432} y={600} w={56} h={12} fill="var(--text)" opacity={.85} />
    <Bar x={251} y={655} w={240} h={7} fill="var(--accent)" opacity={.85} /><rect x={251} y={676} width={240} height={36} rx={6} fill="none" stroke="var(--line)" />
    {[0, 1, 2, 3].map(i => <g key={i} transform={"translate(520 " + (579 + i * 37.5) + ")"}>
      <Bar x={0} y={12} w={12} h={5} opacity={.7} /><Avatar cx={44} cy={19} r={14} letter={["F", "Y", "X", "S"][i]} /><Bar x={68} y={9} w={70} h={7} fill="var(--text)" opacity={.8} /><Bar x={68} y={22} w={100} h={5} />
      <Bar x={186} y={17} w={68} h={5} /><rect x={186} y={17} width={[22, 12, 8, 6][i]} height={5} rx={2.5} fill="var(--accent)" /><Bar x={286} y={8} w={72} h={7} fill="var(--text)" opacity={.7} /><Bar x={266} y={22} w={92} h={5} /></g>)}
    <DayAside labels={labels} theme={theme} />
  </g>;
}
function DayAside({ labels, theme }: { labels: RealLabels; theme: ArtTheme }) {
  const rows = [[CAT.workspace, labels.workspace], [CAT.communication, labels.communication], [CAT.entertainment, labels.entertainment], [CAT.socialMedia, labels.socialMedia], [CAT.utility, labels.utility]] as const;
  return <g>
    <Panel x={920} y={56} width={248} height={681} />
    <g fill="none" stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M943 68l5 5-5 5M950 68l5 5-5 5" /></g><T x={963} y={78} size={13} weight={700}>{labels.breakdown}</T>
    <path d="M933 100H1155" stroke="var(--line)" />
    <T x={933} y={130} size={12} fill="var(--text-muted)">{labels.productivity}</T><Bar x={1088} y={122} w={66} h={9} fill="var(--text)" opacity={.8} />
    <RingArcs cx={980} cy={187} r={33} sw={17} shares={DAY_SHARES} theme={theme} track={false} palette="app" /><T x={980} y={192} size={13} weight={700} anchor="middle">76%</T>
    {[[PROD.focus, labels.focus], [PROD.drift, labels.drift], [PROD.neutral, labels.neutral]].map(([c, t], i) => <g key={i}><circle cx={1041} cy={168 + i * 19} r={4.4} fill={c} /><T x={1052} y={172 + i * 19} size={12} fill="var(--text-muted)">{t}</T><Bar x={1108} y={165 + i * 19} w={46} h={7} fill="var(--text)" opacity={.75} /></g>)}
    <T x={933} y={274} size={12} fill="var(--text-muted)">{labels.category}</T><Bar x={1100} y={266} w={54} h={9} fill="var(--text)" opacity={.8} />
    <rect x={933} y={282} width={222} height={10} rx={5} fill={CAT.workspace} /><rect x={1100} y={282} width={16} height={10} fill={CAT.communication} /><rect x={1116} y={282} width={14} height={10} fill={CAT.entertainment} /><rect x={1130} y={282} width={14} height={10} fill={CAT.socialMedia} /><rect x={1144} y={282} width={11} height={10} rx={5} fill={CAT.utility} />
    {rows.map(([c, t], i) => <g key={i}><circle cx={940} cy={311 + i * 18.4} r={4.4} fill={c} /><T x={951} y={315 + i * 18.4} size={12} fill="var(--text-muted)">{t}</T><Bar x={1108} y={308 + i * 18.4} w={46} h={6} fill="var(--text)" opacity={.7} /></g>)}
    <path d="M933 392H1155" stroke="var(--line)" />
    <rect x={928} y={421} width={232} height={205} rx={8} fill="none" stroke="var(--line)" /><path d="M1044 421V626M928 489.5H1160M928 557.5H1160" stroke="var(--line)" />
    {[0, 1, 2, 3, 4, 5].map(i => <g key={i} transform={"translate(" + (940 + (i % 2) * 116) + " " + (434 + Math.floor(i / 2) * 68) + ")"}><Bar x={0} y={0} w={44} h={5} /><Bar x={0} y={16} w={64} h={12} fill="var(--text)" opacity={.85} /><Bar x={0} y={38} w={52} h={5} /></g>)}
  </g>;
}

/* ---------- Week: seven day columns with event blocks ---------- */
export function WeekBody({ labels }: { labels: RealLabels }) {
  const colX = (d: number) => 262 + d * 93;
  const ev: [number, number, number, string, string][] = [[0, 66, 72, CAT.workspace, "D"], [0, 168, 60, CAT.learning, "V"], [0, 244, 74, CAT.workspace, "V"], [0, 330, 40, CAT.music, "S"], [1, 40, 92, CAT.workspace, "V"], [1, 150, 34, CAT.communication, "S"], [1, 214, 108, CAT.workspace, "F"], [1, 340, 80, CAT.workspace, "V"], [2, 70, 90, CAT.workspace, "V"], [2, 176, 46, CAT.communication, "F"], [2, 232, 100, CAT.workspace, "V"], [2, 344, 30, CAT.socialMedia, "X"], [2, 390, 70, CAT.entertainment, "Y"]];
  return <g>
    <Bar x={229} y={62} w={320} h={22} fill="var(--text)" opacity={.88} />
    <rect x={568} y={57} width={72} height={32} rx={16} fill="var(--surface)" stroke="var(--line-strong)" /><DateNavR x={720} y={62} labels={labels} wide />
    <Panel x={229} y={96} width={683} height={640} />
    <ChipRow x={241} y={106} labels={labels} />
    <Segmented x={782} y={109} w={120} items={[labels.category, labels.productivity]} selected={0} />
    <path d="M229 138H912M229 168H912" stroke="var(--line)" />
    {[0, 1, 2, 3, 4, 5, 6].map(d => <g key={d}><path d={"M" + colX(d) + " 138V736"} stroke="var(--line)" /><Bar x={colX(d) + 34} y={148} w={26} h={7} fill="var(--text)" opacity={d === 2 ? .9 : .55} /></g>)}
    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => <g key={i}><path d={"M262 " + (170 + i * 56) + "H912"} stroke="var(--line)" /><Bar x={238} y={166 + i * 56} w={16} h={5} opacity={.6} /></g>)}
    {ev.map(([d, y, h, c, l], i) => <g key={i}><rect x={colX(d) + 4} y={170 + y} width={85} height={h} rx={6} fill={c} opacity=".88" /><rect x={colX(d) + 10} y={176 + y} width={16} height={16} rx={4} fill="var(--accent-soft)" /><T x={colX(d) + 18} y={188 + y} size={9} weight={700} anchor="middle">{l}</T></g>)}
    <path d="M262 552H912" stroke="var(--text)" strokeWidth="1.6" />
  </g>;
}

/* ---------- Classification: stats strip and three columns ---------- */
export function ClassificationPage({ labels, fixed = false, editing = false }: { labels: RealLabels; fixed?: boolean; editing?: boolean }) {
  const cats = [[CAT.workspace, labels.workspace, 0.98], [CAT.communication, labels.communication, 0.14], [CAT.entertainment, labels.entertainment, 0.12], [CAT.socialMedia, labels.socialMedia, 0.1], [CAT.utility, labels.utility, 0.06]] as const;
  const apps = [["V", 1], ["F", 0.32], ["L", 0.06]] as const;
  return <g>
    <T x={229} y={78} size={26} weight={700}>{labels.title}</T>
    <Segmented x={833} y={56} w={94} h={29} items={[labels.dayShort, labels.weekShort]} selected={0} />
    <DateNavR x={962} y={62} labels={labels} />
    <Panel x={229} y={101} width={939} height={64} r={12} />
    <path d="M464 101V165M699 101V165M933 101V165" stroke="var(--line)" />
    {[0, 1, 2, 3].map(i => <g key={i}><T x={241 + i * 235} y={121} size={11} fill="var(--text-soft)" spacing={0.4}>{[labels.total, labels.sessions, labels.topApp, labels.focusRate][i]}</T>
      {i === 2 ? <><Avatar cx={711} cy={147} r={13} letter="V" /><Bar x={733} y={141} w={100} h={11} fill="var(--text)" opacity={.85} /></> : <Bar x={241 + i * 235} y={140} w={i === 1 ? 24 : 70} h={13} fill="var(--text)" opacity={.85} />}</g>)}
    <Panel x={229} y={177} width={939} height={586} r={12} />
    <path d="M483 177V763M778 177V763" stroke="var(--line)" /><path d="M229 229H1168" stroke="var(--line)" />
    <T x={240} y={198} size={11} fill="var(--text-soft)" spacing={0.4}>{labels.category}</T><Bar x={240} y={207} w={70} h={9} fill="var(--text)" opacity={.85} /><Bar x={410} y={207} w={62} h={9} fill="var(--text)" opacity={.75} />
    <T x={494} y={198} size={11} fill="var(--text-soft)" spacing={0.4}>{labels.category}</T><Bar x={494} y={207} w={30} h={9} fill="var(--text)" opacity={.85} />
    <Bar x={1000} y={198} w={70} h={5} />
    {cats.map(([c, t, f], i) => <g key={i} transform={"translate(0 " + (i * 52) + ")"}>
      {i === 0 && <rect x={237} y={236} width={238} height={48} rx={9} fill="color-mix(in srgb, var(--accent) 14%, var(--surface-strong))" />}
      <circle cx={253} cy={253} r={5} fill={c} /><T x={265} y={258} size={13.5} weight={i === 0 ? 700 : 600}>{t}</T><Bar x={402} y={250} w={[54, 22, 20, 18, 14][i]} h={6} fill="var(--text)" opacity={.7} />
      <rect x={247} y={271} width={220} height={5} rx={2.5} fill="var(--line)" /><rect x={247} y={271} width={220 * (i === 0 ? 1 : f * 0.9 + 0.04)} height={5} rx={2.5} fill={c} /></g>)}
    {apps.map(([l, f], i) => <g key={i} transform={"translate(0 " + (i * 52) + ")"}>
      {i === 0 && <rect x={490} y={236} width={282} height={48} rx={9} fill="color-mix(in srgb, var(--accent) 14%, var(--surface-strong))" />}
      <Avatar cx={514} cy={260} r={15} letter={l} /><Bar x={540} y={247} w={104 - i * 24} h={8} fill="var(--text)" opacity={.85} /><Bar x={540} y={262} w={72} h={5} /><Bar x={712} y={248} w={48} h={9} fill="var(--text)" opacity={.8} /><Bar x={724} y={264} w={36} h={5} />
      <rect x={622} y={262} width={48 * f + 6} height={4} rx={2} fill="var(--accent)" /></g>)}
    <Avatar cx={790} cy={216} r={14} letter="V" /><Bar x={812} y={209} w={112} h={10} fill="var(--text)" opacity={.85} /><Bar x={1050} y={202} w={50} h={6} /><Bar x={1050} y={214} w={60} h={9} fill="var(--text)" opacity={.85} />
    <rect x={1130} y={196} width={28} height={28} rx={8} fill={editing ? "var(--accent-soft)" : "var(--surface-strong)"} stroke={editing ? "var(--accent)" : "var(--line)"} />
    <g fill="none" stroke="var(--text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M1139 216l1-4 8-8 3 3-8 8z" /></g>
    {[0, 1, 2, 3, 4].map(i => <g key={i} transform={"translate(0 " + (i * 53) + ")"}>
      <Bar x={794} y={250} w={[110, 130, 116, 108, 90][i]} h={8} fill="var(--text)" opacity={.85} /><Bar x={794} y={265} w={96} h={5} />
      <rect x={1010} y={254} width={80} height={5} rx={2.5} fill="var(--line)" /><rect x={1010} y={254} width={[80, 44, 42, 38, 34][i]} height={5} rx={2.5} fill={fixed && i === 0 ? CAT.workspace : "var(--accent)"} />
      <Bar x={1098} y={250} w={30} h={8} fill="var(--text)" opacity={.75} />{i < 4 && <path d="M780 281H1168" stroke="var(--line)" />}</g>)}
  </g>;
}

/* ---------- The real correction editor (classification-correction) and account menu ---------- */
export function CorrectionEditor({ labels, x = 0, y = 0, selected = 0, prod = 0, app = "Visual Studio Code", letter = "V" }: { labels: RealLabels; x?: number; y?: number; selected?: number; prod?: number; app?: string; letter?: string }) {
  const cats: [string, string][] = [[CAT.workspace, labels.workspace], [CAT.learning, labels.learning], [CAT.communication, labels.communication], [CAT.music, labels.music], [CAT.game, labels.game], [CAT.socialMedia, labels.socialMedia], [CAT.entertainment, labels.entertainment], [CAT.shopping, labels.shopping], [CAT.utility, labels.utility]];
  // The app lists the categories column by column: work, chat, game, entertainment, utility | learning, music, social, shopping.
  const slots = [0, 5, 1, 6, 2, 7, 3, 8, 4];
  return <g transform={"translate(" + x + " " + y + ")"}>
    <rect width={296} height={432} rx={18} className="real-art__menu" />
    <Avatar cx={30} cy={28} r={15} letter={letter} /><T x={54} y={25} size={13.5} weight={700}>{app}</T>
    <rect x={54} y={32} width={48} height={16} rx={8} fill="var(--accent-soft)" /><Bar x={61} y={38} w={34} h={4.6} fill="var(--accent-strong)" />
    <g stroke="var(--text-soft)" strokeWidth="1.6" strokeLinecap="round"><path d="M268 23l9 9M277 23l-9 9" /></g>
    <path d="M0 57H296" stroke="var(--line)" />
    <T x={16} y={74} size={12} fill="var(--text-soft)">{labels.category}</T>
    {slots.map((catIndex, slot) => { const col = slot % 2, row = Math.floor(slot / 2); const on = catIndex === selected; const [c, t] = cats[catIndex];
      return <g key={catIndex} transform={"translate(" + (col ? 158 : 12) + " " + (81 + row * 32) + ")"}>
        {on && <rect width={133} height={28} rx={9} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.4" />}
        <circle cx={12} cy={14} r={4.6} fill={c} /><T x={26} y={19} size={13} weight={on ? 700 : 500}>{t}</T></g>; })}
    <T x={16} y={253} size={12} fill="var(--text-soft)">{labels.productivity}</T>
    <Segmented x={12} y={262} w={272} h={30} items={[labels.focus, labels.neutral, labels.drift]} selected={prod} />
    <rect x={12} y={307} width={272} height={26} rx={7} fill="var(--surface-strong)" /><Bar x={22} y={317} w={176} h={5} />
    <path d="M0 343H296" stroke="var(--line)" />
    <Bar x={16} y={356} w={250} h={5} /><Bar x={16} y={371} w={188} h={5} />
    <T x={222} y={412} size={13} anchor="end">{labels.cancel}</T><rect x={238} y={394} width={46} height={26} rx={13} fill="var(--accent)" opacity=".92" /><T x={261} y={412} size={12.5} weight={700} anchor="middle" fill="var(--surface)">{labels.apply}</T>
  </g>;
}

/** The account menu's own icons (features/auth/AccountMenu.tsx and components/PetIcon.tsx), drawn in a 24px box. */
type MenuGlyphKind = "settings" | "ai" | "language" | "sun" | "moon" | "pet" | "update" | "feedback" | "signIn";
function MenuGlyph({ kind, x, y, size = 16 }: { kind: MenuGlyphKind; x: number; y: number; size?: number }) {
  const stroke = { fill: "none", stroke: "var(--text-soft)", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let body: ReactNode;
  if (kind === "settings") body = <g {...stroke}><circle cx="12" cy="12" r="3" /><path d="M10.09 3 L13.91 3 L14.08 5.79 L15.27 6.33 L16.34 7.1 L18.84 5.84 L20.75 9.16 L18.42 10.69 L18.55 12 L18.42 13.31 L20.75 14.84 L18.84 18.16 L16.34 16.9 L15.28 17.67 L14.08 18.21 L13.91 21 L10.09 21 L9.92 18.21 L8.73 17.67 L7.66 16.9 L5.16 18.16 L3.25 14.84 L5.58 13.31 L5.45 12 L5.58 10.69 L3.25 9.16 L5.16 5.84 L7.66 7.1 L8.73 6.33 L9.92 5.79 Z" /></g>;
  else if (kind === "ai") body = <g fill="var(--text-soft)"><path d="M11.5 2.22 13.33 9.05 20.16 11 13.33 12.95 11.5 19.78 9.67 12.95 2.84 11 9.67 9.05Z" /><path d="M19.67 13.93 20.28 16.25 22.6 16.86 20.28 17.47 19.67 19.78 19.06 17.47 16.75 16.86 19.06 16.25Z" /></g>;
  else if (kind === "language") body = <g {...stroke}><circle cx="12" cy="12" r="9" /><path d="M3.6 12h16.8M12 3c2.2 2.4 3.4 5.4 3.4 9s-1.2 6.6-3.4 9M12 3C9.8 5.4 8.6 8.4 8.6 12s1.2 6.6 3.4 9" /></g>;
  else if (kind === "sun") body = <g {...stroke}><circle cx="12" cy="12" r="4" /><path d="M12 2.4v2M12 19.6v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.4 12h2M19.6 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></g>;
  else if (kind === "moon") body = <g {...stroke}><path d="M20.5 13.2A8 8 0 1 1 10.8 3.5a6.3 6.3 0 0 0 9.7 9.7Z" /></g>;
  else if (kind === "pet") body = <g transform="scale(0.09375)" fill="var(--text-soft)"><path d="M212,80a28,28,0,1,0,28,28A28,28,0,0,0,212,80Zm0,40a12,12,0,1,1,12-12A12,12,0,0,1,212,120ZM72,108a28,28,0,1,0-28,28A28,28,0,0,0,72,108ZM44,120a12,12,0,1,1,12-12A12,12,0,0,1,44,120ZM92,88A28,28,0,1,0,64,60,28,28,0,0,0,92,88Zm0-40A12,12,0,1,1,80,60,12,12,0,0,1,92,48Zm72,40a28,28,0,1,0-28-28A28,28,0,0,0,164,88Zm0-40a12,12,0,1,1-12,12A12,12,0,0,1,164,48Zm23.12,100.86a35.3,35.3,0,0,1-16.87-21.14,44,44,0,0,0-84.5,0A35.25,35.25,0,0,1,69,148.82,40,40,0,0,0,88,224a39.48,39.48,0,0,0,15.52-3.13,64.09,64.09,0,0,1,48.87,0,40,40,0,0,0,34.73-72ZM168,208a24,24,0,0,1-9.45-1.93,80.14,80.14,0,0,0-61.19,0,24,24,0,0,1-20.71-43.26,51.22,51.22,0,0,0,24.46-30.67,28,28,0,0,1,53.78,0,51.27,51.27,0,0,0,24.53,30.71A24,24,0,0,1,168,208Z" /></g>;
  else if (kind === "update") body = <g {...stroke}><path d="M4.2 12a7.8 7.8 0 0 1 13.2-5.6L20 8.6" /><path d="M19.8 12a7.8 7.8 0 0 1-13.2 5.6L4 15.4" /><path d="M20 4v4.6h-4.6M4 20v-4.6h4.6" /></g>;
  else if (kind === "feedback") body = <g {...stroke}><rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.4" /><path d="m3.8 6.6 8.2 5.8 8.2-5.8" /></g>;
  else body = <g {...stroke}><path d="M9.5 4.2H7A2.3 2.3 0 0 0 4.7 6.5v11A2.3 2.3 0 0 0 7 19.8h2.5" /><path d="M15 16.5 19.5 12 15 7.5M19.5 12H8.5" /></g>;
  return <g transform={"translate(" + x + " " + y + ") scale(" + size / 24 + ")"}>{body}</g>;
}

export function AccountMenu({ labels, x = 0, y = 0, hot, darkOn = false, petOn = false }: { labels: RealLabels; x?: number; y?: number; hot?: "language" | "dark" | "pet" | "none"; darkOn?: boolean; petOn?: boolean }) {
  const item = (cy: number, icon: MenuGlyphKind, text: string, extra?: ReactNode, on = false) => <g key={text}>
    {on && <rect x={8} y={cy - 15} width={228} height={30} rx={8} fill="var(--accent-soft)" />}
    <MenuGlyph kind={icon} x={16} y={cy - 8} size={16} /><T x={42} y={cy + 5} size={14}>{text}</T>{extra}</g>;
  return <g transform={"translate(" + x + " " + y + ")"}>
    <rect width={244} height={309} rx={16} className="real-art__menu" />
    <T x={16} y={20} size={11.5} fill="var(--text-soft)" spacing={0.5}>v1.11.24</T>
    {item(42, "settings", labels.settings)}{item(72, "ai", labels.aiSettings)}
    <path d="M14 92H230" stroke="var(--line)" />
    {item(112, "language", labels.language, <g><T x={214} y={117} size={12.5} fill="var(--text-soft)" anchor="end">{labels.languageValue}</T><Chevron x={219} y={108} s={1} /></g>, hot === "language")}
    {item(142, darkOn ? "moon" : "sun", labels.darkMode, <Toggle x={196} y={133} on={darkOn} />, hot === "dark")}
    {item(173, "pet", labels.pet, <Toggle x={196} y={164} on={petOn} />, hot === "pet")}
    <path d="M14 194H230" stroke="var(--line)" />
    {item(214, "update", labels.update)}{item(244, "feedback", labels.feedback)}
    <path d="M14 264H230" stroke="var(--line)" />
    {item(285, "signIn", labels.signIn)}
  </g>;
}
