import type { CSSProperties } from "react";
import { formatRoundedDuration } from "../../lib/formatting";
import type { LeaderboardPeriod } from "./leaderboardService";

export type ProfileLink = {
  readonly kind: string;
  readonly label: string;
};

export function ProfileAvatar({ className, name, src, style }: { readonly className: string; readonly name: string; readonly src?: string | null; readonly style?: CSSProperties }) {
  const trimmedSrc = src?.trim();
  if (trimmedSrc) return <img className={className} src={trimmedSrc} alt="" aria-hidden="true" style={style} />;
  return <span className={className} aria-hidden="true" style={style}>{name.charAt(0).toUpperCase()}</span>;
}

export function ParticipationWindow({
  focusSeconds7d,
  windowStartDay,
  windowEndDay,
}: {
  readonly focusSeconds7d: number;
  readonly windowStartDay?: string | null;
  readonly windowEndDay?: string | null;
}) {
  return (
    <div className="leaderboard-window" aria-label="Rolling focus window preview">
      <span className="label-mono">Your focus window</span>
      <strong>{formatRoundedDuration(focusSeconds7d)}</strong>
      <p>{formatWindow(windowStartDay, windowEndDay)}</p>
    </div>
  );
}

export function StateBlock({ eyebrow, title, detail }: { readonly eyebrow: string; readonly title: string; readonly detail: string }) {
  return (
    <div className="empty-state leaderboard-state">
      <span className="eyebrow">{eyebrow}</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function getDailyAverageSeconds(totalSeconds: number, period: LeaderboardPeriod) {
  if (period === "monthly") return Math.round(totalSeconds / 30);
  if (period === "weekly") return Math.round(totalSeconds / 7);
  return totalSeconds;
}

export function formatRank(rank: number | null) {
  return rank === null ? "Not ranked yet" : `#${rank}`;
}

function formatWindow(startDay?: string | null, endDay?: string | null) {
  if (!startDay || !endDay) return "Current focus window";
  return `${startDay} -> ${endDay}`;
}
