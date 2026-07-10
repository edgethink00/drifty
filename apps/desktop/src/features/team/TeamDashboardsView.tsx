import { useMemo } from "react";
import type {
  TeamProject,
  TeamProjectMemberRow,
  TeamProjectMixRow,
} from "./teamTypes";
import "./team-projects.css";

export type TeamDashboardsViewProps = {
  readonly teamName: string;
  readonly window: { readonly start_date: string; readonly end_date: string };
  readonly projects: readonly TeamProject[];
  readonly mix: readonly TeamProjectMixRow[];
  readonly members: readonly TeamProjectMemberRow[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly actionError: string | null;
  readonly publishing: boolean;
  readonly publishNote: string | null;
  readonly onPublishMyTime: () => void;
  readonly onStopSharing: () => void;
  readonly onRefresh: () => void;
};

const FALLBACK_PALETTE = [
  "#6f9a4b",
  "#c98a3c",
  "#4c86b5",
  "#a05fb0",
  "#c25f6e",
  "#4fa6a0",
  "#b7953d",
  "#7f7bce",
] as const;

const NEUTRAL_GRAY = "#9ca3af";

function isUsableColor(color: string | null | undefined): boolean {
  return typeof color === "string" && color.trim().length > 0;
}

function formatSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

function formatSecondsLong(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${hh} h ${mm} m`;
}

type ProjectMeta = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
};

// Resolve a stable color + name per project id, preferring the projects list,
// then the mix rows, then a deterministic fallback palette / neutral gray.
function useProjectMeta(
  projects: readonly TeamProject[],
  mix: readonly TeamProjectMixRow[],
): Map<string, ProjectMeta> {
  return useMemo(() => {
    const meta = new Map<string, ProjectMeta>();
    const idOrder: string[] = [];

    const remember = (id: string, name: string, color: string | null) => {
      if (!id) return;
      if (!meta.has(id)) {
        idOrder.push(id);
        meta.set(id, {
          id,
          name: name || "Untitled project",
          color: isUsableColor(color) ? (color as string) : "",
        });
        return;
      }
      const existing = meta.get(id)!;
      if (!existing.color && isUsableColor(color)) {
        meta.set(id, { ...existing, color: color as string });
      }
      if ((!existing.name || existing.name === "Untitled project") && name) {
        meta.set(id, { ...meta.get(id)!, name });
      }
    };

    for (const project of projects) {
      remember(project.id, project.name, project.color);
    }
    for (const row of mix) {
      remember(row.organization_project_id, row.project_name, row.project_color);
    }

    // Fill unresolved colors from the fallback palette in a stable order.
    idOrder.forEach((id, index) => {
      const entry = meta.get(id)!;
      if (!entry.color) {
        const fallback = FALLBACK_PALETTE[index % FALLBACK_PALETTE.length] ?? NEUTRAL_GRAY;
        meta.set(id, { ...entry, color: fallback });
      }
    });

    return meta;
  }, [projects, mix]);
}

function colorFor(meta: Map<string, ProjectMeta>, id: string): string {
  return meta.get(id)?.color ?? NEUTRAL_GRAY;
}

function nameFor(meta: Map<string, ProjectMeta>, id: string, fallback: string): string {
  return meta.get(id)?.name ?? fallback ?? "Untitled project";
}

// ---- Donut ----

type DonutSlice = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly seconds: number;
  readonly fraction: number;
};

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number): [number, number] {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return [cx + radius * Math.cos(angleRad), cy + radius * Math.sin(angleRad)];
}

function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  startAngle: number,
  endAngle: number,
): string {
  // Clamp a full circle slightly so start != end (SVG arc degenerates at 360).
  const sweep = Math.min(endAngle - startAngle, 359.999);
  const end = startAngle + sweep;
  const [ox1, oy1] = polarToCartesian(cx, cy, outer, startAngle);
  const [ox2, oy2] = polarToCartesian(cx, cy, outer, end);
  const [ix2, iy2] = polarToCartesian(cx, cy, inner, end);
  const [ix1, iy1] = polarToCartesian(cx, cy, inner, startAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return [
    `M ${ox1} ${oy1}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${ox2} ${oy2}`,
    `L ${ix2} ${iy2}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${ix1} ${iy1}`,
    "Z",
  ].join(" ");
}

function MixDonut({ slices, total }: { readonly slices: readonly DonutSlice[]; readonly total: number }): JSX.Element {
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const outer = 72;
  const inner = 46;

  let cursor = 0;
  const arcs = slices.map((slice) => {
    const start = cursor * 360;
    cursor += slice.fraction;
    const end = cursor * 360;
    return (
      <path
        key={slice.id}
        d={arcPath(cx, cy, outer, inner, start, end)}
        fill={slice.color}
        stroke="var(--surface-strong)"
        strokeWidth={1}
      />
    );
  });

  return (
    <svg
      className="tpj-donut"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Team project mix donut chart"
    >
      {arcs}
      <text
        className="tpj-donut-center"
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={13}
        fontWeight={640}
      >
        {formatSeconds(total)}
      </text>
      <text
        className="tpj-donut-center-sub"
        x={cx}
        y={cy + 13}
        textAnchor="middle"
        fontSize={8}
        letterSpacing={1.4}
      >
        SHARED
      </text>
    </svg>
  );
}

// ---- Trend chart ----

type TrendSeries = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly values: readonly number[];
};

function buildLinePath(values: readonly number[], xs: readonly number[], scaleY: (v: number) => number): string {
  if (values.length === 0) return "";
  if (values.length === 1) {
    const y = scaleY(values[0]);
    // A tiny horizontal stub so a single point is still visible.
    return `M ${xs[0] - 3} ${y} L ${xs[0] + 3} ${y}`;
  }
  return values
    .map((value, index) => `${index === 0 ? "M" : "L"} ${xs[index]} ${scaleY(value)}`)
    .join(" ");
}

function TrendChart({
  dates,
  series,
  maxValue,
}: {
  readonly dates: readonly string[];
  readonly series: readonly TrendSeries[];
  readonly maxValue: number;
}): JSX.Element {
  const width = 560;
  const height = 200;
  const padLeft = 8;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 24;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const denom = Math.max(dates.length - 1, 1);
  const xs = dates.map((_, index) =>
    dates.length === 1 ? padLeft + plotW / 2 : padLeft + (plotW * index) / denom,
  );

  const safeMax = maxValue > 0 ? maxValue : 1;
  const scaleY = (value: number) => padTop + plotH - (plotH * value) / safeMax;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padTop + plotH - plotH * ratio;
    return <line key={ratio} className="tpj-trend-grid" x1={padLeft} y1={y} x2={width - padRight} y2={y} />;
  });

  // Pick a few x labels: first, last, and a couple between.
  const labelIndices = new Set<number>();
  if (dates.length > 0) {
    labelIndices.add(0);
    labelIndices.add(dates.length - 1);
    if (dates.length > 2) labelIndices.add(Math.floor((dates.length - 1) / 3));
    if (dates.length > 3) labelIndices.add(Math.floor((2 * (dates.length - 1)) / 3));
  }

  const xLabels = dates.map((date, index) => {
    if (!labelIndices.has(index)) return null;
    const anchor = index === 0 ? "start" : index === dates.length - 1 ? "end" : "middle";
    return (
      <text
        key={date + index}
        className="tpj-trend-axis"
        x={xs[index]}
        y={height - 8}
        textAnchor={anchor}
      >
        {date.slice(5)}
      </text>
    );
  });

  return (
    <svg
      className="tpj-trend"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Team project time over the window"
    >
      {gridLines}
      {series.map((line) => (
        <path
          key={line.id}
          className="tpj-trend-line"
          d={buildLinePath(line.values, xs, scaleY)}
          stroke={line.color}
        />
      ))}
      {xLabels}
    </svg>
  );
}

function TeamDashboardsView(props: TeamDashboardsViewProps): JSX.Element {
  const {
    teamName,
    window: windowRange,
    projects,
    mix,
    members,
    loading,
    error,
    actionError,
    publishing,
    publishNote,
    onPublishMyTime,
    onStopSharing,
    onRefresh,
  } = props;

  const meta = useProjectMeta(projects, mix);

  // ---- Aggregate mix by project ----
  const { slices, grandTotal } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of mix) {
      totals.set(
        row.organization_project_id,
        (totals.get(row.organization_project_id) ?? 0) + Math.max(0, row.seconds),
      );
    }
    const total = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    const built: DonutSlice[] = Array.from(totals.entries())
      .map(([id, seconds]) => ({
        id,
        name: nameFor(meta, id, ""),
        color: colorFor(meta, id),
        seconds,
        fraction: total > 0 ? seconds / total : 0,
      }))
      .filter((slice) => slice.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);
    return { slices: built, grandTotal: total };
  }, [mix, meta]);

  // ---- Trend series ----
  const { dates, series, maxDaily } = useMemo(() => {
    const dateSet = new Set<string>();
    for (const row of mix) dateSet.add(row.activity_date);
    const sortedDates = Array.from(dateSet).sort();
    const dateIndex = new Map(sortedDates.map((date, index) => [date, index] as const));

    const perProject = new Map<string, number[]>();
    for (const row of mix) {
      let arr = perProject.get(row.organization_project_id);
      if (!arr) {
        arr = new Array<number>(sortedDates.length).fill(0);
        perProject.set(row.organization_project_id, arr);
      }
      const idx = dateIndex.get(row.activity_date);
      if (idx !== undefined) arr[idx] += Math.max(0, row.seconds);
    }

    let max = 0;
    for (const arr of perProject.values()) {
      for (const value of arr) if (value > max) max = value;
    }

    const built: TrendSeries[] = Array.from(perProject.entries())
      .map(([id, values]) => ({
        id,
        name: nameFor(meta, id, ""),
        color: colorFor(meta, id),
        values,
      }))
      .sort((a, b) => {
        const sumA = a.values.reduce((s, v) => s + v, 0);
        const sumB = b.values.reduce((s, v) => s + v, 0);
        return sumB - sumA;
      });

    return { dates: sortedDates, series: built, maxDaily: max };
  }, [mix, meta]);

  // ---- Member breakdown ----
  const memberRows = useMemo(() => {
    type MemberAgg = { name: string; total: number; segments: Map<string, number> };
    const byMember = new Map<string, MemberAgg>();
    for (const row of members) {
      let agg = byMember.get(row.member_display_name);
      if (!agg) {
        agg = { name: row.member_display_name, total: 0, segments: new Map() };
        byMember.set(row.member_display_name, agg);
      }
      const seconds = Math.max(0, row.seconds);
      agg.total += seconds;
      agg.segments.set(
        row.organization_project_id,
        (agg.segments.get(row.organization_project_id) ?? 0) + seconds,
      );
    }
    return Array.from(byMember.values())
      .map((agg) => ({
        name: agg.name,
        total: agg.total,
        segments: Array.from(agg.segments.entries())
          .map(([id, seconds]) => ({
            id,
            color: colorFor(meta, id),
            name: nameFor(meta, id, ""),
            seconds,
            pct: agg.total > 0 ? (seconds / agg.total) * 100 : 0,
          }))
          .sort((a, b) => b.seconds - a.seconds),
      }))
      .sort((a, b) => b.total - a.total);
  }, [members, meta]);

  const hasMix = slices.length > 0 && grandTotal > 0;
  const showLoadingMix = loading && !hasMix;

  return (
    <div className="tpj-root">
      {/* Header */}
      <div className="tpj-head">
        <div className="tpj-head-titles">
          <span className="tpj-head-team">{teamName}</span>
          <h2 className="tpj-head-title">Shared project dashboards</h2>
          <span className="tpj-head-window">
            {windowRange.start_date} – {windowRange.end_date}
          </span>
        </div>
        <div className="tpj-head-actions">
          <button
            type="button"
            className="tpj-btn tpj-btn--accent"
            onClick={onPublishMyTime}
            disabled={publishing}
            aria-label="Share my project time with the team"
          >
            {publishing ? "Sharing…" : "Share my time"}
          </button>
          <button
            type="button"
            className="tpj-btn tpj-btn--ghost"
            onClick={onStopSharing}
            aria-label="Stop sharing my project time"
          >
            Stop sharing
          </button>
          <button
            type="button"
            className="tpj-btn"
            onClick={onRefresh}
            aria-label="Refresh team dashboards"
          >
            Refresh
          </button>
        </div>
      </div>

      {publishNote ? <p className="tpj-muted">{publishNote}</p> : null}
      {actionError ? <p className="tpj-warn">{actionError}</p> : null}
      {error ? <p className="tpj-warn">{error}</p> : null}

      {/* Team mix */}
      <section className="tpj-panel" aria-label="Team mix">
        <h3 className="tpj-section-title">Team mix</h3>
        {showLoadingMix ? (
          <div className="tpj-loading" style={{ height: "10rem" }} />
        ) : hasMix ? (
          <div className="tpj-mix">
            <MixDonut slices={slices} total={grandTotal} />
            <div className="tpj-legend">
              {slices.map((slice) => {
                const pct = grandTotal > 0 ? Math.round((slice.seconds / grandTotal) * 100) : 0;
                return (
                  <div className="tpj-legend-row" key={slice.id}>
                    <span className="tpj-legend-swatch" style={{ background: slice.color }} />
                    <span className="tpj-legend-name">{slice.name || "Untitled project"}</span>
                    <span className="tpj-legend-meta">
                      {formatSecondsLong(slice.seconds)} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="tpj-empty">No shared project time yet — click Share my time.</div>
        )}
      </section>

      {/* Over time */}
      <section className="tpj-panel" aria-label="Over time">
        <h3 className="tpj-section-title">Over time</h3>
        {showLoadingMix ? (
          <div className="tpj-loading" style={{ height: "12rem" }} />
        ) : hasMix ? (
          <div>
            <TrendChart dates={dates} series={series} maxValue={maxDaily} />
            <div className="tpj-legend" style={{ marginTop: "0.6rem", gridAutoFlow: "column", gridAutoColumns: "max-content" }}>
              {series.slice(0, 6).map((line) => (
                <div className="tpj-legend-row" key={line.id} style={{ gap: "0.4rem" }}>
                  <span className="tpj-legend-swatch" style={{ background: line.color }} />
                  <span className="tpj-legend-name">{line.name || "Untitled project"}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="tpj-empty">No timeline yet — shared time appears here once members share.</div>
        )}
      </section>

      {/* By member */}
      <section className="tpj-panel" aria-label="By member">
        <h3 className="tpj-section-title">By member</h3>
        {memberRows.length > 0 ? (
          <div className="tpj-members">
            {memberRows.map((member) => (
              <div className="tpj-member" key={member.name}>
                <div className="tpj-member-head">
                  <span className="tpj-member-name">{member.name}</span>
                  <span className="tpj-member-total">{formatSeconds(member.total)}</span>
                </div>
                <div
                  className="tpj-member-bar"
                  role="img"
                  aria-label={`${member.name} project split`}
                >
                  {member.segments.map((segment) => (
                    <span
                      key={segment.id}
                      className="tpj-member-seg"
                      style={{ width: `${segment.pct}%`, background: segment.color }}
                      title={`${segment.name || "Untitled"} · ${formatSeconds(segment.seconds)}`}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="tpj-empty">No member breakdown yet.</div>
        )}
      </section>
    </div>
  );
}

export default TeamDashboardsView;
