import { type ReactNode, useId } from "react";
import type { DisplayLanguage } from "../localization/languagePreference";
import {
  buildSparklineGeometry,
  SPARKLINE_VIEW_HEIGHT,
  SPARKLINE_VIEW_WIDTH,
  sparklineWeekdayLetter,
  type LeaderboardGraphStyle,
  type LeaderboardSparklinePoint,
} from "./leaderboardGraphStyle";

type SparklineVariant = Exclude<LeaderboardGraphStyle, "off">;

interface LeaderboardSparklineProps {
  readonly points: readonly LeaderboardSparklinePoint[];
  readonly variant: SparklineVariant;
  readonly language: DisplayLanguage;
  readonly ariaLabel: string;
}

function polyline(points: string, width: number, extra?: { opacity?: number; linejoin?: "miter" | "round"; linecap?: "square" | "round" }) {
  return (
    <polyline
      points={points}
      fill="none"
      stroke="var(--accent-strong)"
      strokeWidth={width}
      strokeLinejoin={extra?.linejoin ?? "miter"}
      strokeLinecap={extra?.linecap ?? "square"}
      opacity={extra?.opacity}
    />
  );
}

export function LeaderboardSparkline({
  points,
  variant,
  language,
  ariaLabel,
}: LeaderboardSparklineProps) {
  const reactId = useId().replace(/:/g, "");
  const values = points.map((point) => point.focus);
  const geometry = buildSparklineGeometry(values);
  if (geometry.length < 2) return null;

  const ptStr = geometry.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const last = geometry[geometry.length - 1];
  if (!last) return null;
  const fillPoly = `${ptStr} ${SPARKLINE_VIEW_WIDTH},${SPARKLINE_VIEW_HEIGHT} 0,${SPARKLINE_VIEW_HEIGHT}`;
  const endDot = <circle cx={last.x} cy={last.y} r={3.2} fill="var(--accent-strong)" />;
  const labels = points.map((point) => sparklineWeekdayLetter(point.day, language));

  const graph = renderVariant(variant, {
    reactId,
    ptStr,
    fillPoly,
    geometry,
    last,
    endDot,
  });

  return (
    <div className="leaderboard-sparkline">
      <svg
        viewBox={`0 0 ${SPARKLINE_VIEW_WIDTH} ${SPARKLINE_VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        className="leaderboard-sparkline__plot"
        role="img"
        aria-label={ariaLabel}
      >
        {graph}
      </svg>
      <div className="leaderboard-sparkline__axis" aria-hidden="true">
        {labels.map((label, index) => <span key={`${points[index]?.day ?? index}-${label}`}>{label}</span>)}
      </div>
    </div>
  );
}

function renderVariant(
  variant: SparklineVariant,
  ctx: {
    reactId: string;
    ptStr: string;
    fillPoly: string;
    geometry: readonly { readonly x: number; readonly y: number }[];
    last: { readonly x: number; readonly y: number };
    endDot: ReactNode;
  },
): ReactNode {
  const { reactId, ptStr, fillPoly, geometry, last, endDot } = ctx;

  switch (variant) {
    case "flat":
      return <>{polyline(ptStr, 2)}{endDot}</>;
    case "solid":
      return (
        <>
          <polygon points={fillPoly} fill="var(--accent)" opacity={0.18} />
          {polyline(ptStr, 2.2)}
          {endDot}
        </>
      );
    case "thick":
      return (
        <>
          {polyline(ptStr, 4, { linejoin: "round", linecap: "round" })}
          <circle cx={last.x} cy={last.y} r={4.5} fill="var(--accent-strong)" />
        </>
      );
    case "bars": {
      const slot = SPARKLINE_VIEW_WIDTH / geometry.length;
      const barWidth = Math.min(22, slot * 0.72);
      return (
        <>
          {geometry.map((point, index) => (
            <rect
              key={index}
              x={index * slot + (slot - barWidth) / 2}
              y={point.y}
              width={barWidth}
              height={SPARKLINE_VIEW_HEIGHT - point.y}
              rx={3}
              fill="var(--accent)"
              opacity={index === geometry.length - 1 ? 0.38 : 0.15}
            />
          ))}
          {polyline(ptStr, 1.8, { opacity: 0.7 })}
          {endDot}
        </>
      );
    }
    case "warm": {
      const gradId = `lb-warm-${reactId}`;
      const glowId = `lb-glow-${reactId}`;
      return (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--gold, #a88850)" stopOpacity={0.52} />
              <stop offset="50%" stopColor="var(--gold-wash, #c49e5c)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--gold, #a88850)" stopOpacity={0} />
            </linearGradient>
            <filter id={glowId}>
              <feGaussianBlur stdDeviation={2} result="blur" />
              <feFlood floodColor="var(--gold-wash, #c49e5c)" floodOpacity={0.5} result="glow-color" />
              <feComposite in="glow-color" in2="blur" operator="in" result="glow" />
              <feMerge>
                <feMergeNode in="glow" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <polygon points={fillPoly} fill={`url(#${gradId})`} />
          <polyline points={ptStr} fill="none" stroke="var(--gold, #a88850)" strokeWidth={2.8} strokeLinejoin="miter" strokeLinecap="square" filter={`url(#${glowId})`} />
          <circle cx={last.x} cy={last.y} r={3.6} fill="var(--gold, #a88850)" />
        </>
      );
    }
    case "sweep": {
      const fillId = `lb-sweep-fill-${reactId}`;
      const lineId = `lb-sweep-line-${reactId}`;
      return (
        <>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0} />
              <stop offset="40%" stopColor="var(--accent)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity={0.48} />
            </linearGradient>
            <linearGradient id={lineId} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--text-soft)" stopOpacity={0.3} />
              <stop offset="50%" stopColor="var(--accent)" stopOpacity={0.7} />
              <stop offset="100%" stopColor="var(--accent-strong)" stopOpacity={1} />
            </linearGradient>
          </defs>
          <polygon points={fillPoly} fill={`url(#${fillId})`} />
          <polyline points={ptStr} fill="none" stroke={`url(#${lineId})`} strokeWidth={2.4} strokeLinejoin="miter" strokeLinecap="square" />
          {endDot}
        </>
      );
    }
    case "layered": {
      const fillId = `lb-layer-${reactId}`;
      const avgY = geometry.reduce((sum, point) => sum + point.y, 0) / geometry.length;
      return (
        <>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent-strong)" stopOpacity={0.42} />
              <stop offset="40%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="70%" stopColor="var(--accent)" stopOpacity={0.10} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <rect x={0} y={0} width={SPARKLINE_VIEW_WIDTH} height={SPARKLINE_VIEW_HEIGHT} fill="var(--accent)" opacity={0.04} />
          <line x1={0} y1={avgY} x2={SPARKLINE_VIEW_WIDTH} y2={avgY} stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="6 4" opacity={0.5} />
          <polygon points={fillPoly} fill={`url(#${fillId})`} />
          {polyline(ptStr, 2.4)}
          {endDot}
        </>
      );
    }
    default: {
      const fillId = `lb-area-${reactId}`;
      return (
        <>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.36} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={fillPoly} fill={`url(#${fillId})`} />
          {polyline(ptStr, 2.2)}
          {endDot}
        </>
      );
    }
  }
}

