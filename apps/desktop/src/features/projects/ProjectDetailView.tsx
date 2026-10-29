import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ActivitySegment, AppIconMap, Project } from "@drifty/domain";
import { SkeletonText } from "../dashboard/DashboardLoadingParts";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { useProjectDetailFormat, type ProjectDetailFormat } from "./projectDetailFormat";
import {
  buildProjectDetailModel,
  rankTitles,
  sessionEvidence,
  summarizeSources,
  type DetailSession,
  type ProjectAssignmentSources,
  type ProjectDetailModel,
} from "./projectDetailModel";
import {
  BackLink,
  BigFigure,
  DateBarsPanel,
  FigureTiles,
  MiniLane,
  RailPart,
  RecentTrend,
  SourceRows,
  TitleRows,
  WorkLogPanel,
  placeCount,
  sessionCount,
  type FigureItem,
  type ProjectDetailRangeMode,
} from "./ProjectDetailParts";
import "./project-trend-chart.css";
import "./project-detail.css";

export type { ProjectDetailRangeMode } from "./ProjectDetailParts";

export interface ProjectDetailViewProps {
  readonly project: Project;
  /** Project slices inside the shown window. */
  readonly windowSegments: readonly ActivitySegment[];
  /** Slices in the window just before it, for the change line. */
  readonly previousSegments: readonly ActivitySegment[];
  /** Everything loaded: at least the last eight weeks up to the window's end. */
  readonly historySegments: readonly ActivitySegment[];
  readonly projectBySegmentId: ReadonlyMap<string, string>;
  /** The assignment records behind the slices, for a session's "why it's here". */
  readonly assignmentSources?: ProjectAssignmentSources;
  readonly appIcons: AppIconMap;
  readonly trendReady: boolean;
  readonly rangeMode: ProjectDetailRangeMode;
  readonly startDay: string;
  readonly endDay: string;
  /** e.g. "Last 7 days" / "Today" — matches the range controls. */
  readonly totalCaption: string;
  readonly busy?: boolean;
  /** Opens the category editor on this project (where it is also archived or deleted). */
  readonly onEdit: () => void;
}

type Selection =
  | { readonly kind: "window" }
  | { readonly kind: "day"; readonly day: string }
  | { readonly kind: "session"; readonly id: string; readonly fromDay: string | null };

const CHANGE_KEYS: Record<ProjectDetailRangeMode, Record<"up" | "down" | "same" | "none", TranslationKey>> = {
  day: { up: "projects.detail.change.upDay", down: "projects.detail.change.downDay", same: "projects.detail.change.sameDay", none: "projects.detail.change.noneDay" },
  week: { up: "projects.detail.change.upWeek", down: "projects.detail.change.downWeek", same: "projects.detail.change.sameWeek", none: "projects.detail.change.noneWeek" },
  month: { up: "projects.detail.change.upMonth", down: "projects.detail.change.downMonth", same: "projects.detail.change.sameMonth", none: "projects.detail.change.noneMonth" },
};

/**
 * A project's detail: the headline and the time by date, the work log by
 * session, and one tall block on the right that says what the project is and
 * how it has been going. Picking a day or a session opens it in the same block
 * beside it; the way back returns the block to the project. The block scrolls
 * with the page.
 */
export function ProjectDetailView(props: ProjectDetailViewProps): JSX.Element {
  if (!props.trendReady) return <ProjectDetailLoading {...props} />;
  // A new project or window starts from the project's own block.
  return <ProjectDetailBody key={props.project.id + ":" + props.startDay + ":" + props.endDay} {...props} />;
}

function ProjectDetailBody(props: ProjectDetailViewProps) {
  const { t } = useLocalization();
  const format = useProjectDetailFormat();
  const { project, projectBySegmentId, rangeMode } = props;
  const model = useMemo(() => buildProjectDetailModel({
    projectId: project.id,
    windowSegments: props.windowSegments,
    previousSegments: props.previousSegments,
    projectBySegmentId,
    startDay: props.startDay,
    endDay: props.endDay,
  }), [project.id, props.windowSegments, props.previousSegments, projectBySegmentId, props.startDay, props.endDay]);
  const [selection, setSelection] = useState<Selection>({ kind: "window" });
  const sessionById = useMemo(() => new Map(model.sessions.map((session) => [session.id, session])), [model.sessions]);
  const session = selection.kind === "session" ? sessionById.get(selection.id) ?? null : null;
  // Choosing a session keeps the log as it was, so the row stays under the pointer.
  const selectedDay = selection.kind === "day" ? selection.day : selection.kind === "session" ? selection.fromDay : null;
  const dayModel = selection.kind === "day" ? model.days.find((day) => day.day === selection.day) ?? null : null;

  // The block scrolls with the page, so a chosen session's details line up beside its row.
  const layoutRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [anchorOffset, setAnchorOffset] = useState(0);
  const sessionId = session?.id ?? null;
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const layout = layoutRef.current;
    if (!sessionId || !anchor || !layout) return undefined;
    const place = () => {
      const row = [...layout.querySelectorAll<HTMLElement>("[data-session-id]")].find((item) => item.dataset.sessionId === sessionId);
      if (!row) return;
      // The rendered margin, not the target: it may still be easing toward the last one.
      const natural = anchor.getBoundingClientRect().top - (parseFloat(getComputedStyle(anchor).marginTop) || 0);
      const next = Math.max(0, Math.round(row.getBoundingClientRect().top - natural - 14));
      setAnchorOffset((current) => (Math.abs(next - current) > 1 ? next : current));
    };
    place();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(place);
    const main = layout.querySelector(".pd-layout__main");
    if (main) observer.observe(main);
    return () => observer.disconnect();
  }, [sessionId]);

  let rail: ReactNode;
  if (session) {
    const backTo: Selection = selection.kind === "session" && selection.fromDay ? { kind: "day", day: selection.fromDay } : { kind: "window" };
    rail = (
      <div ref={anchorRef} className="pd-railanchor" style={{ marginTop: anchorOffset }}>
        <SessionInspector
          session={session}
          props={props}
          format={format}
          back={<BackLink label={backTo.kind === "day" ? format.md(backTo.day) + " " + format.weekday(backTo.day) : t("projects.detail.backToAll")} onClick={() => setSelection(backTo)} />}
        />
      </div>
    );
  } else if (dayModel) {
    const segments = dayModel.sessions.flatMap((item) => item.segments);
    const daySources = summarizeSources(segments);
    const dayTitles = rankTitles(daySources);
    rail = (
      <div className="pd-railanchor">
        <RailPart title={format.dayTitle(dayModel.day)} action={<BackLink label={t("projects.detail.backToAll")} onClick={() => setSelection({ kind: "window" })} />}>
          <BigFigure value={format.duration(dayModel.seconds)} caption={sessionCount(dayModel.sessions.length, t)} />
          <MiniLane day={dayModel} range={model.clockRange} color={project.color} format={format} />
        </RailPart>
        <RailPart title={t("projects.detail.appsAndSites")} meta={placeCount(daySources.length, t)}>
          <SourceRows sources={daySources} total={dayModel.seconds} color={project.color} appIcons={props.appIcons} format={format} limit={5} />
        </RailPart>
        {dayTitles.length > 0 ? (
          <RailPart title={t("projects.detail.topWork")}>
            <TitleRows titles={dayTitles} appIcons={props.appIcons} format={format} />
          </RailPart>
        ) : null}
      </div>
    );
  } else {
    rail = <AboutRail props={props} model={model} format={format} />;
  }

  return (
    <div className="pd-layout" ref={layoutRef}>
      <div className="pd-layout__main">
        <DetailHeadline props={props} model={model} format={format} />
        <DateBarsPanel
          project={project}
          rangeMode={rangeMode}
          startDay={props.startDay}
          endDay={props.endDay}
          windowSegments={props.windowSegments}
          historySegments={props.historySegments}
          projectBySegmentId={projectBySegmentId}
          format={format}
          selectedDay={selectedDay}
          onSelectDay={(day) => setSelection(day ? { kind: "day", day } : { kind: "window" })}
        />
        <WorkLogPanel
          model={model}
          rangeMode={rangeMode}
          appIcons={props.appIcons}
          format={format}
          selectedDay={selectedDay}
          selectedSessionId={session?.id ?? null}
          onSelectSession={(item) => setSelection({ kind: "session", id: item.id, fromDay: selectedDay })}
        />
      </div>
      <RailBlock props={props}>{rail}</RailBlock>
    </div>
  );
}

function DetailHeadline({ props, model, format }: { readonly props: ProjectDetailViewProps; readonly model: ProjectDetailModel; readonly format: ProjectDetailFormat }) {
  const { t } = useLocalization();
  const keys = CHANGE_KEYS[props.rangeMode];
  const delta = model.totalSeconds - model.previousSeconds;
  const change = model.previousSeconds <= 0
    ? { text: t(keys.none), tone: "up" }
    : Math.abs(delta) < 60
      ? { text: t(keys.same), tone: "flat" }
      : { text: t(delta > 0 ? keys.up : keys.down, { delta: format.duration(Math.abs(delta)) }), tone: delta > 0 ? "up" : "down" };
  return (
    <header className="pd-head">
      {model.totalSeconds > 0 ? (
        <>
          <p className="pd-headline">
            <span className="pd-headline__word">{t("projects.detail.headlineLead", { caption: props.totalCaption })}</span>
            <span className="pd-headline__value">{format.duration(model.totalSeconds)}</span>
          </p>
          <p className={"pd-change pd-change--" + change.tone}>{change.text}</p>
        </>
      ) : (
        <p className="pd-headline"><span className="pd-headline__word">{t("projects.detail.headlineEmpty", { caption: props.totalCaption })}</span></p>
      )}
    </header>
  );
}

/** The block's fixed top: what the project is, and the one way to change it. */
function RailIdentity({ props }: { readonly props: ProjectDetailViewProps }) {
  const { t } = useLocalization();
  const description = props.project.description.trim();
  return (
    <div className="pd-identity">
      <div className="pd-railpart__head">
        <span className="label-mono">{t("projects.detail.description")}</span>
        <button
          type="button"
          className="app-btn app-btn--secondary app-btn--compact"
          disabled={props.busy}
          aria-haspopup="dialog"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            props.onEdit();
          }}
        >
          {t("common.edit")}
        </button>
      </div>
      <p className={"pd-identity__desc" + (description ? "" : " is-empty")}>{description || t("projects.detail.descriptionEmpty")}</p>
    </div>
  );
}

function RailBlock({ props, children }: { readonly props: ProjectDetailViewProps; readonly children: ReactNode }) {
  const { t } = useLocalization();
  return (
    <aside className="editorial-panel editorial-panel--soft pd-rail" aria-label={t("projects.detail.aboutAria")}>
      <RailIdentity props={props} />
      {children}
    </aside>
  );
}

function figureSet(model: ProjectDetailModel, rangeMode: ProjectDetailRangeMode, format: ProjectDetailFormat, t: ReturnType<typeof useLocalization>["t"]): FigureItem[] {
  const items: FigureItem[] = [];
  const longest = model.longestSession;
  const usualHours = model.peakHours
    ? { label: t("projects.detail.usualHours"), value: format.hourRange(model.peakHours[0], model.peakHours[1]), detail: t("projects.detail.usualHoursDetail", { pct: format.pct(model.peakShare) }) }
    : null;
  if (rangeMode === "day") {
    const first = model.sessions[0];
    const last = model.sessions[model.sessions.length - 1];
    if (first && last) items.push({ label: t("projects.detail.workedBetween"), value: format.clock(first.start) + "–" + format.clock(last.end), detail: sessionCount(model.sessions.length, t) });
    if (longest) items.push({ label: t("projects.detail.longestSession"), value: format.duration(longest.seconds), detail: t("dashboard.today.fromTime", { time: format.clock(longest.start) }) });
    if (usualHours) items.push(usualHours);
    if (model.trackedSeconds > 0) items.push({ label: t("projects.detail.dayShare"), value: format.pct(model.totalSeconds / model.trackedSeconds), detail: t("projects.detail.dayShareDetail", { duration: format.duration(model.trackedSeconds) }) });
    return items;
  }
  if (model.activeDays > 0) items.push({ label: t("projects.detail.dailyAverage"), value: format.duration(model.totalSeconds / model.activeDays), detail: t("projects.detail.dailyAverageDetail", { count: model.activeDays }) });
  items.push({ label: t("projects.detail.activeDays"), value: t("projects.detail.activeDaysValue", { count: model.activeDays }), detail: t("projects.detail.activeDaysDetail", { total: model.days.length }) });
  if (usualHours) items.push(usualHours);
  if (longest) items.push({ label: t("projects.detail.longestSession"), value: format.duration(longest.seconds), detail: format.md(longest.day) + " " + format.weekday(longest.day) });
  return items;
}

/** The block at rest: four figures, the apps and sites, and the last eight weeks. */
function AboutRail({ props, model, format }: { readonly props: ProjectDetailViewProps; readonly model: ProjectDetailModel; readonly format: ProjectDetailFormat }) {
  const { t } = useLocalization();
  return (
    <>
      {model.totalSeconds > 0
        ? <section className="pd-railpart pd-railpart--tiles"><FigureTiles items={figureSet(model, props.rangeMode, format, t)} /></section>
        : <RailPart title={props.totalCaption}><p className="pd-empty">{t("projects.detail.noTimeInRange")}</p></RailPart>}
      {model.sources.length > 0 ? (
        <RailPart title={t("projects.detail.topSources")} meta={placeCount(model.sources.length, t)}>
          <SourceRows sources={model.sources} total={model.totalSeconds} color={props.project.color} appIcons={props.appIcons} format={format} />
        </RailPart>
      ) : null}
      <RecentTrend project={props.project} historySegments={props.historySegments} projectBySegmentId={props.projectBySegmentId} endDay={props.endDay} format={format} />
    </>
  );
}

function SessionInspector({ session, props, format, back }: { readonly session: DetailSession; readonly props: ProjectDetailViewProps; readonly format: ProjectDetailFormat; readonly back: ReactNode }) {
  const { t } = useLocalization();
  const evidence = useMemo(() => (props.assignmentSources ? sessionEvidence(session.segments, props.assignmentSources) : null), [session.segments, props.assignmentSources]);
  const records = session.segments.length === 1 ? t("projects.detail.recordsOne") : t("projects.detail.records", { count: session.segments.length });
  let evidenceLine: string | null = null;
  if (evidence) {
    if (evidence.manualSeconds > 0 && evidence.aiSeconds > 0) {
      evidenceLine = t("projects.detail.evidenceMixed", { manual: format.duration(evidence.manualSeconds), ai: format.duration(evidence.aiSeconds) });
    } else if (evidence.manualSeconds > 0) {
      evidenceLine = t("projects.detail.evidenceManual");
    } else {
      evidenceLine = t("projects.detail.evidenceAi") + (evidence.confidence !== null ? " · " + t("projects.detail.evidenceConfidence", { pct: format.pct(evidence.confidence) }) : "");
    }
  }
  return (
    <>
      <RailPart title={t("projects.detail.selectedSession")} action={back}>
        <BigFigure value={format.clock(session.start) + "–" + format.clock(session.end)} caption={format.duration(session.seconds) + " · " + records} />
      </RailPart>
      <RailPart title={t("projects.detail.appsAndSites")} meta={placeCount(session.sources.length, t)}>
        <SourceRows sources={session.sources} total={session.seconds} color={props.project.color} appIcons={props.appIcons} format={format} limit={5} />
      </RailPart>
      {session.titles.length > 0 ? (
        <RailPart title={t("projects.detail.work")}>
          <TitleRows titles={session.titles} appIcons={props.appIcons} format={format} limit={8} />
        </RailPart>
      ) : null}
      {evidenceLine ? (
        <RailPart title={t("projects.detail.evidence")}>
          <p className="pd-evidence">{evidenceLine}</p>
          {evidence?.reason ? <p className="pd-evidence__reason">{evidence.reason}</p> : null}
        </RailPart>
      ) : null}
    </>
  );
}

const LOADING_TITLES = ["DashboardPage.tsx", "Homepage demo", "Dashboard QA", "AppUsagePanel.tsx"] as const;

/** The same layout while the window's activity loads: placeholders where the figures will land. */
function ProjectDetailLoading(props: ProjectDetailViewProps) {
  const { t } = useLocalization();
  const tiles = props.rangeMode === "day"
    ? [t("projects.detail.workedBetween"), t("projects.detail.longestSession"), t("projects.detail.usualHours"), t("projects.detail.dayShare")]
    : [t("projects.detail.dailyAverage"), t("projects.detail.activeDays"), t("projects.detail.usualHours"), t("projects.detail.longestSession")];
  return (
    <div className="pd-layout" aria-busy="true">
      <div className="pd-layout__main" aria-hidden="true">
        <header className="pd-head">
          <p className="pd-headline"><span className="pd-headline__word"><SkeletonText>{props.totalCaption + " 00h 00m"}</SkeletonText></span></p>
          <p className="pd-change"><SkeletonText>0h 00m less than the previous 7 days</SkeletonText></p>
        </header>
        <section className="editorial-panel editorial-panel--soft pd-panel pd-datebars">
          <div className="insight-panel-head pd-panel__head"><span className="label-mono">{t("projects.detail.byDate")}</span></div>
          <div className="ptc-bars pd-datebars__chart"><div className="ptc-bars__plot" /></div>
        </section>
        <section className="editorial-panel editorial-panel--soft pd-panel pd-log">
          <div className="insight-panel-head pd-panel__head"><span className="label-mono">{t("projects.detail.workLog")}</span></div>
          <ol className="pd-log__sessions">
            {LOADING_TITLES.map((title) => (
              <li key={title} className="pd-session pd-session--loading">
                <span className="pd-session__time"><SkeletonText>00:00–00:00</SkeletonText></span>
                <span className="pd-session__lead"><span className="pd-icon pd-icon--loading" /></span>
                <span className="pd-session__main"><strong><SkeletonText>{title}</SkeletonText></strong></span>
                <span className="pd-session__dur"><SkeletonText>0h 00m</SkeletonText></span>
                <span />
              </li>
            ))}
          </ol>
        </section>
      </div>
      <RailBlock props={props}>
        <section className="pd-railpart pd-railpart--tiles" aria-hidden="true">
          <div className="kpi-row kpi-row--insights pd-kpi">
            {tiles.map((label) => (
              <div className="metric-tile" key={label}><span className="eyebrow">{label}</span><strong><SkeletonText>0h 00m</SkeletonText></strong><p><SkeletonText>0 of 7 days</SkeletonText></p></div>
            ))}
          </div>
        </section>
      </RailBlock>
    </div>
  );
}
