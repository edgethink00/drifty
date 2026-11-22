import { useId, type ReactNode } from "react";
import { ACHIEVEMENT_GLYPH_PATHS, type AchievementGlyphName } from "./AchievementGlyph";
import type { AchievementGroup } from "./achievementCatalog";
import type { AchievementBadgeVariant } from "./achievementDesignReview";
import type { AchievementTier } from "./achievementRarity";

export type AchievementArtState = "earned" | "locked" | "concealed";

type ArtProps = {
  readonly variant: Exclude<AchievementBadgeVariant, "line">;
  readonly group: AchievementGroup;
  readonly tier: AchievementTier;
  readonly state: AchievementArtState;
  readonly glyph: AchievementGlyphName;
  /** Best result so far toward a locked achievement, 0–1. */
  readonly progress: number;
  /** Stable per achievement, for the sticker's tilt. */
  readonly seed: string;
};

function Glyph({ name, cx, cy, scale, color, width }: { name: AchievementGlyphName; cx: number; cy: number; scale: number; color: string; width: number }) {
  return (
    <g className="achievement-art__glyph" transform={"translate(" + (cx - 12 * scale) + " " + (cy - 12 * scale) + ") scale(" + scale + ")"} fill="none" stroke={color} strokeWidth={width / scale} strokeLinecap="round" strokeLinejoin="round">
      {ACHIEVEMENT_GLYPH_PATHS[name].map((d) => <path key={d} d={d} />)}
    </g>
  );
}

function arc(radius: number, share: number) {
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, share)) * circumference;
  return { strokeDasharray: filled + " " + circumference };
}

function tilt(seed: string): number {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return (Math.abs(hash) % 15) - 7;
}

function scallopPath(cx: number, cy: number, inner: number, outer: number, bumps: number): string {
  const point = (angle: number, radius: number) => [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)].map((value) => value.toFixed(2)).join(" ");
  let d = "M" + point(-Math.PI / 2, inner);
  for (let index = 0; index < bumps; index += 1) {
    const start = -Math.PI / 2 + (index * 2 * Math.PI) / bumps;
    const end = start + (2 * Math.PI) / bumps;
    d += " Q" + point((start + end) / 2, outer) + " " + point(end, inner);
  }
  return d + " Z";
}

const SHIELD = "M32 5 L53 12.5 V30 C53 43.5 44 53.5 32 59 C20 53.5 11 43.5 11 30 V12.5 Z";
const HEX = "M32 4 L56.25 18 V46 L32 60 L7.75 46 V18 Z";

/** The badge styles under review, drawn on a 64 × 64 grid and coloured from CSS by group, tier and state. */
export function AchievementArt({ variant, group, tier, state, glyph, progress, seed }: ArtProps) {
  const id = useId().replace(/:/gu, "");
  const earned = state === "earned";
  const metal = "art-metal-" + id;
  const fill = "art-fill-" + id;
  const defs = (
    <defs>
      <linearGradient id={metal} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style={{ stopColor: "var(--metal-1)" }} />
        <stop offset="0.5" style={{ stopColor: "var(--metal-2)" }} />
        <stop offset="1" style={{ stopColor: "var(--metal-3)" }} />
      </linearGradient>
      <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" style={{ stopColor: "var(--art-a)" }} />
        <stop offset="1" style={{ stopColor: "var(--art-b)" }} />
      </linearGradient>
    </defs>
  );
  let body: ReactNode = null;

  if (variant === "stamp") {
    body = earned ? (
      <g transform="rotate(-8 32 32)">
        <circle cx="32" cy="32" r="28.5" fill="none" stroke="var(--art-ink)" strokeWidth="2.4" />
        <circle cx="32" cy="32" r="24" fill="var(--art-soft)" stroke="var(--art-ink)" strokeWidth="1.1" strokeDasharray="0.1 2.6" strokeLinecap="round" />
        <Glyph name={glyph} cx={32} cy={31} scale={1.12} color="var(--art-ink)" width={2} />
        {Array.from({ length: tier }, (_, index) => {
          const angle = Math.PI / 2 + (index - (tier - 1) / 2) * 0.28;
          return <circle key={index} cx={32 + 26.25 * Math.cos(angle)} cy={32 + 26.25 * Math.sin(angle)} r="1.25" fill="var(--art-ink)" />;
        })}
      </g>
    ) : (
      <g>
        <circle cx="32" cy="32" r="28.5" fill="none" stroke="var(--art-line)" strokeWidth="1.6" strokeDasharray="3 3" />
        {progress > 0 ? <circle cx="32" cy="32" r="28.5" fill="none" stroke="var(--art-progress)" strokeWidth="2.4" strokeLinecap="round" transform="rotate(-90 32 32)" style={arc(28.5, progress)} /> : null}
        <Glyph name={glyph} cx={32} cy={32} scale={1.05} color="var(--art-muted)" width={1.8} />
      </g>
    );
  } else if (variant === "pin") {
    body = earned ? (
      <g>
        <path d={SHIELD} fill={"url(#" + fill + ")"} stroke={"url(#" + metal + ")"} strokeWidth="4" strokeLinejoin="round" />
        <path d="M17 16 L32 10.5 L47 16 V21.5 C40 18.5 24 18.5 17 22.5 Z" fill="#fff" opacity="0.2" />
        <Glyph name={glyph} cx={32} cy={32} scale={1.08} color="#fff" width={2.3} />
      </g>
    ) : (
      <g>
        <path d={SHIELD} fill="var(--art-locked)" stroke="var(--art-line)" strokeWidth="2.4" strokeLinejoin="round" />
        <Glyph name={glyph} cx={32} cy={32} scale={1.02} color="var(--art-muted)" width={1.9} />
      </g>
    );
  } else if (variant === "medal") {
    body = (
      <g>
        <path d="M17 3 H28 L35 25 H24 Z" fill={earned ? "var(--art-a)" : "var(--art-line)"} />
        <path d="M47 3 H36 L29 25 H40 Z" fill={earned ? "var(--art-b)" : "var(--art-locked)"} />
        <circle cx="32" cy="40" r="20" fill={earned ? "url(#" + metal + ")" : "var(--art-locked)"} stroke={earned ? "none" : "var(--art-line)"} strokeWidth="1.6" />
        <circle cx="32" cy="40" r="15.2" fill="none" stroke={earned ? "var(--metal-ink)" : "var(--art-line)"} strokeOpacity={earned ? 0.35 : 1} strokeWidth="1" />
        <Glyph name={glyph} cx={32} cy={40} scale={0.92} color={earned ? "var(--metal-ink)" : "var(--art-muted)"} width={2.1} />
      </g>
    );
  } else if (variant === "hex") {
    const perimeter = 6 * 28;
    body = earned ? (
      <g>
        <path d={HEX} fill="var(--art-night)" stroke="var(--art-a)" strokeWidth="2.2" strokeLinejoin="round" className="achievement-art__glow" />
        <path d="M32 9.5 L51.5 20.75 V43.25 L32 54.5 L12.5 43.25 V20.75 Z" fill="none" stroke="var(--art-a)" strokeOpacity="0.3" strokeWidth="1" />
        <Glyph name={glyph} cx={32} cy={32} scale={1.08} color="var(--art-glow)" width={2.2} />
      </g>
    ) : (
      <g>
        <path d={HEX} fill="var(--art-locked)" stroke="var(--art-line)" strokeWidth="1.6" strokeLinejoin="round" />
        {progress > 0 ? <path d={HEX} fill="none" stroke="var(--art-progress)" strokeWidth="2.4" strokeLinejoin="round" style={{ strokeDasharray: Math.max(0, Math.min(1, progress)) * perimeter + " " + perimeter }} /> : null}
        <Glyph name={glyph} cx={32} cy={32} scale={1.02} color="var(--art-muted)" width={1.8} />
      </g>
    );
  } else if (variant === "sticker") {
    const scallop = scallopPath(32, 32, 25, 30, 12);
    body = earned ? (
      <g transform={"rotate(" + tilt(seed) + " 32 32)"} className="achievement-art__lift">
        <path d={scallop} fill={"url(#" + fill + ")"} stroke="var(--art-sticker-edge)" strokeWidth="3.4" strokeLinejoin="round" />
        <Glyph name={glyph} cx={32} cy={32} scale={1.12} color="#fff" width={2.4} />
      </g>
    ) : (
      <g>
        <path d={scallop} fill="none" stroke="var(--art-line)" strokeWidth="1.5" strokeDasharray="2.4 2.4" strokeLinejoin="round" />
        <Glyph name={glyph} cx={32} cy={32} scale={1.02} color="var(--art-muted)" width={1.8} />
      </g>
    );
  } else {
    body = (
      <g>
        {earned ? <circle cx="32" cy="32" r="30.5" fill="none" stroke={"url(#" + metal + ")"} strokeWidth="1.8" /> : null}
        <circle cx="32" cy="32" r="25.5" fill="none" stroke="var(--art-track)" strokeWidth="5.5" />
        {earned || progress > 0 ? (
          <circle cx="32" cy="32" r="25.5" fill="none" stroke={earned ? "var(--art-a)" : "var(--art-progress)"} strokeWidth="5.5" strokeLinecap="round" transform="rotate(-90 32 32)" style={earned ? undefined : arc(25.5, progress)} />
        ) : null}
        <circle cx="32" cy="32" r="18.5" fill={earned ? "var(--art-soft)" : "var(--art-locked)"} />
        <Glyph name={glyph} cx={32} cy={32} scale={0.92} color={earned ? "var(--art-ink)" : "var(--art-muted)"} width={2} />
      </g>
    );
  }

  return (
    <svg className={"achievement-art achievement-art--" + variant} viewBox="0 0 64 64" data-group={group} data-tier={tier} data-state={state} aria-hidden="true" focusable="false">
      {defs}
      {body}
    </svg>
  );
}

