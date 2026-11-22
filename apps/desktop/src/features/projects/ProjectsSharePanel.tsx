import { useState } from "react";
import { donutArcPath } from "../../lib/donutArcPath";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedShortDurationFromSeconds } from "../../lib/formatting";
import { useLocalization } from "../localization/LocalizationContext";
import { BlockTitleText } from "../../components/BlockTitleText";
import { SkeletonText } from "../dashboard/DashboardLoadingParts";

export interface ShareProject {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Seconds in the window. */
  readonly total: number;
}

interface Slice {
  readonly key: string;
  readonly label: string;
  readonly color: string;
  readonly seconds: number;
  /** Of all project time in the window, 0–1. */
  readonly ratio: number;
}

/** Projects named in the ring before the rest fold into one slice. */
const NAMED_PROJECTS = 4;
const OTHER_PROJECTS_COLOR = "#b9b3a6";
const RADIUS = 40;

/**
 * How the week's project time splits between projects, beside the week's
 * chart, the way the Today breakdown's project ring does: projects only, the
 * total in the head, the biggest project's share in the middle. Hovering a
 * slice or its legend row brings it forward and puts it in the middle.
 */
export function ProjectsSharePanel({ projects, days, caption: captionOverride, trailing = null, namedCount = NAMED_PROJECTS, selectedProjectId = null, onProjectSelect, projectDetailsId, bare = false, loadingRows }: {
  /** Active projects with time in the window, biggest first. */
  readonly projects: readonly ShareProject[];
  readonly days: number;
  /** The panel title when the window is not "the latest N days" (the team Overview names its own). */
  readonly caption?: string;
  /** A last slice that never folds into "N more", such as a team's unassigned time. */
  readonly trailing?: ShareProject | null;
  /** How many projects the ring names before the rest fold into one slice. */
  readonly namedCount?: number;
  /** Optional drill-down; the default personal/Overview panel stays a passive summary. */
  readonly selectedProjectId?: string | null;
  readonly onProjectSelect?: (projectId: string) => void;
  readonly projectDetailsId?: string;
  /** The ring and its legend alone, for a card that draws its own frame and title (a team board widget). */
  readonly bare?: boolean;
  /** The window's activity is still loading: this many legend rows wait as placeholders. */
  readonly loadingRows?: number;
}): JSX.Element {
  const { effectiveLanguage, t } = useLocalization();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  // Under a minute reads in seconds ("25초"), never "0분" beside a project that has time.
  const fmt = (seconds: number) => seconds > 0 && seconds < 60
    ? formatLocalizedShortDurationFromSeconds(seconds, effectiveLanguage)
    : formatLocalizedCompactDurationFromSeconds(seconds, effectiveLanguage);
  const total = projects.reduce((sum, item) => sum + item.total, 0) + (trailing?.total ?? 0);
  const ratio = (seconds: number) => (total > 0 ? seconds / total : 0);
  const rest = projects.slice(namedCount);
  const restSeconds = rest.reduce((sum, item) => sum + item.total, 0);
  const slices: Slice[] = [
    ...projects.slice(0, namedCount).map((item) => ({ key: item.id, label: item.name, color: item.color, seconds: item.total, ratio: ratio(item.total) })),
    ...(restSeconds > 0 ? [{ key: "rest", label: t("projects.metric.otherProjects", { count: rest.length }), color: OTHER_PROJECTS_COLOR, seconds: restSeconds, ratio: ratio(restSeconds) }] : []),
    ...(trailing && trailing.total > 0 ? [{ key: trailing.id, label: trailing.name, color: trailing.color, seconds: trailing.total, ratio: ratio(trailing.total) }] : []),
  ];
  const pct = (slice: Slice) => Math.round(slice.ratio * 100) + "%";
  const caption = captionOverride ?? t("projects.metric.shareCaption", { count: days });
  if (loadingRows !== undefined) {
    return (
      <section className="editorial-panel editorial-panel--soft insight-chart-panel projects-share" aria-label={caption} aria-busy="true">
        <div className="insight-panel-head">
          <span className="label-mono"><BlockTitleText text={caption} /></span>
          <strong className="projects-share__total"><SkeletonText>0h 00m</SkeletonText></strong>
        </div>
        <div className="projects-share__pair" aria-hidden="true">
          <div className="projects-share__dial">
            <svg viewBox="0 0 100 100"><path className="projects-share__track" d={donutArcPath(50, 50, RADIUS, 0, 1)} /></svg>
            <div className="projects-share__center"><strong><SkeletonText>00%</SkeletonText></strong><span><SkeletonText>Project</SkeletonText></span></div>
          </div>
          <ul className="projects-share__legend">
            {Array.from({ length: Math.max(loadingRows, 1) }, (_, index) => (
              <li key={index}>
                <span className="projects-share__swatch projects-share__swatch--loading" />
                <span className="projects-share__label"><SkeletonText>Project</SkeletonText></span>
                <span className="projects-share__time"><SkeletonText>0h 00m</SkeletonText></span>
                <span className="projects-share__pct"><SkeletonText>00%</SkeletonText></span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    );
  }
  const emphasizedKey = selectedProjectId ?? activeKey;
  const focus = slices.find((slice) => slice.key === emphasizedKey) ?? slices[0];
  const dim = (key: string) => (emphasizedKey !== null && emphasizedKey !== key ? " is-dim" : "");
  const rowContent = (slice: Slice) => <>
    <span className="projects-share__swatch" style={{ background: slice.color }} />
    <span className="projects-share__label">{slice.label}</span>
    <span className="projects-share__time">{fmt(slice.seconds)}</span>
    <span className="projects-share__pct">{pct(slice)}</span>
  </>;
  const hover = (key: string) => ({ onMouseEnter: () => setActiveKey(key), onMouseLeave: () => setActiveKey(null) });
  const gap = slices.length > 1 ? 0.006 : 0;
  let cursor = 0;
  const arcs = slices.map((slice) => {
    const start = cursor;
    cursor += slice.ratio;
    return { slice, d: donutArcPath(50, 50, RADIUS, start, Math.max(start, cursor - gap)) };
  });

  const pair = (
      <div className="projects-share__pair">
        <div className="projects-share__dial">
          <svg viewBox="0 0 100 100" role="img" aria-label={caption + ": " + slices.map((slice) => slice.label + " " + fmt(slice.seconds) + " (" + pct(slice) + ")").join(", ")}>
            <path className="projects-share__track" d={donutArcPath(50, 50, RADIUS, 0, 1)} />
            {arcs.map(({ slice, d }) => <path key={slice.key} className={"projects-share__arc" + dim(slice.key)} d={d} stroke={slice.color} {...hover(slice.key)} />)}
          </svg>
          <div className="projects-share__center" aria-hidden="true">
            <strong>{focus ? pct(focus) : "—"}</strong>
            {focus ? <span>{focus.label}</span> : null}
          </div>
        </div>
        {slices.length > 0 ? (
          <ul className="projects-share__legend">
            {slices.map((slice) => (
              <li key={slice.key} className={dim(slice.key)} {...hover(slice.key)}>
                {onProjectSelect ? <button type="button" className="projects-share__select" aria-label={t("projects.share.details", { name: slice.label })} aria-expanded={selectedProjectId === slice.key} aria-controls={selectedProjectId === slice.key ? projectDetailsId : undefined} onClick={() => onProjectSelect(slice.key)}>{rowContent(slice)}</button> : rowContent(slice)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="projects-share__empty">{t("projects.chart.noActivity")}</p>
        )}
      </div>
  );
  if (bare) return <div className="projects-share projects-share--bare">{pair}</div>;
  return (
    <section className={"editorial-panel editorial-panel--soft insight-chart-panel projects-share" + (onProjectSelect ? " projects-share--selectable" : "")} aria-label={caption}>
      <div className="insight-panel-head">
        <span className="label-mono"><BlockTitleText text={caption} /></span>
        {total > 0 ? <strong className="projects-share__total">{fmt(total)}</strong> : null}
      </div>
      {pair}
      {onProjectSelect && slices.length > 0 ? <p className="projects-share__detail-hint">{t("projects.share.detailsHint")}</p> : null}
    </section>
  );
}
