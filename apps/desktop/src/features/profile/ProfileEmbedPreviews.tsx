import { formatFocusDuration } from "../share/badgeSvg";
import type { BadgeThemeOption } from "../share/embedSnippets";
import type { DailyProductivityPoint } from "../share/dailyProductivity";

export function FocusDriftChart({ series }: { series: readonly DailyProductivityPoint[] }) {
  const height = 96;
  const count = series.length;
  const max = Math.max(...series.map((point) => point.focus + point.drift), 1);
  const gap = count > 14 ? 2.4 : 5;
  const barWidth = (1000 - gap * (count - 1)) / count;

  return (
    <div className="profile-chart" role="img" aria-label={`Daily focus and drift, last ${count} days`}>
      <svg viewBox={`0 0 1000 ${height + 2}`} preserveAspectRatio="none" className="profile-chart__svg">
        {series.map((point, index) => {
          const x = index * (barWidth + gap);
          const focusHeight = (point.focus / max) * height;
          const driftHeight = (point.drift / max) * height;
          const isEmpty = point.focus + point.drift === 0;
          return (
            <g key={point.day}>
              <title>{`${point.day} · focus ${formatFocusDuration(point.focus)} · drift ${formatFocusDuration(point.drift)}`}</title>
              {isEmpty ? (
                <rect className="profile-chart__bar profile-chart__bar--empty" x={x} y={height - 2} width={barWidth} height={2} rx={1} />
              ) : (
                <>
                  <rect className="profile-chart__bar profile-chart__bar--focus" x={x} y={height - focusHeight} width={barWidth} height={Math.max(focusHeight, point.focus > 0 ? 2 : 0)} rx={1.5} />
                  <rect className="profile-chart__bar profile-chart__bar--drift" x={x} y={height - focusHeight - driftHeight} width={barWidth} height={Math.max(driftHeight, point.drift > 0 ? 2 : 0)} rx={1.5} />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="profile-chart__axis">
        <span>{series[0]?.day.slice(5)}</span>
        <span>{series[Math.floor(count / 2)]?.day.slice(5)}</span>
        <span>{series[count - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}

export function FocusCardEmbedPreview({
  displayName,
  focusSeconds,
  theme = "light",
  dailyFocus = null,
}: {
  displayName: string;
  focusSeconds: number;
  theme?: BadgeThemeOption;
  dailyFocus?: readonly number[] | null;
}) {
  const name = displayName.trim() || "member";
  const isLive = focusSeconds > 0;
  const dark = theme === "dark";
  const palette = dark
    ? { surface: "#181c16", surfaceStrong: "#232821", line: "#2c3128", ink: "#f3f5f0", muted: "#a7aca2", green: "#57c47a", stub: "#3a4036" }
    : { surface: "#ffffff", surfaceStrong: "#f2f2ee", line: "#e2e2dc", ink: "#17201a", muted: "#6b6f66", green: "#1c7e3c", stub: "#d6d8cd" };
  const bars = dailyFocus && dailyFocus.length > 0 ? dailyFocus : null;
  const barMax = bars ? Math.max(...bars, 1) : 1;

  return (
    <div aria-label="Website card preview" style={{ width: 320, maxWidth: "100%", border: `1px solid ${palette.line}`, borderRadius: 14, padding: "13px 15px", background: palette.surface, color: palette.ink, display: "flex", flexDirection: "column", gap: 9, boxShadow: "0 1px 2px rgba(0,0,0,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", background: palette.surfaceStrong, border: `1px solid ${palette.line}`, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: palette.green }}>
        {(name.charAt(0) || "D").toUpperCase()}
        </span>
        <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</strong>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="label-mono" style={{ color: palette.muted }}>Focus · this week</span>
        <span style={{ fontSize: "1.3rem", fontWeight: 800, letterSpacing: "-0.02em", color: palette.green, lineHeight: 1 }}>
          {isLive ? formatFocusDuration(focusSeconds) : "—"}
        </span>
      </div>
      {bars ? (
        <svg viewBox="0 0 100 16" preserveAspectRatio="none" style={{ width: "100%", height: 26, display: "block" }} aria-hidden="true">
          {bars.map((value, index) => {
            const barGap = bars.length > 14 ? 0.6 : 1.6;
            const barWidth = (100 - barGap * (bars.length - 1)) / bars.length;
            const barHeight = value > 0 ? Math.max(1.5, (value / barMax) * 14) : 0.8;
            return <rect key={index} x={index * (barWidth + barGap)} y={16 - barHeight} width={barWidth} height={barHeight} rx={0.6} fill={value > 0 ? (index === bars.length - 1 ? palette.green : "#2e9e4f") : palette.stub} />;
          })}
        </svg>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${palette.line}`, paddingTop: 8, fontSize: "0.72rem", color: palette.muted }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: isLive ? "#2e9e4f" : "#9a9e96" }} />
        <span>live preview</span>
        <span style={{ marginLeft: "auto", fontWeight: 600 }}>powered by <strong style={{ color: palette.ink }}>drifty</strong> ↗</span>
      </div>
    </div>
  );
}
