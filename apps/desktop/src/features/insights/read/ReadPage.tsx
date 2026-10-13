import { useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AppIconMap } from "@drifty/domain";
import "./readPage.css";
import { DateNavigator } from "../../../components/DateNavigator";
import { useLocalization } from "../../localization/LocalizationContext";
import type { DisplayLanguage } from "../../localization/languagePreference";
import type { TranslationKey } from "../../localization/translations";
import { COACH_MEANINGFUL_DAY_HOURS } from "../insightsReadiness";
import { ReadCat, seatForWeek, type ReadCatSeat } from "./ReadCat";
import { SwitchingView, TimeFlowView } from "./ReadEvidenceViews";
import { fillFacts, readFacts, SHIFT_NOTABLE_SECONDS, switchTotals } from "./readFacts";
import { useReadVote } from "./readVotes";
import { dayLabel, formatValue, shiftDate, signedDuration, tickLabel, weekRangeLabel, durationLabel } from "./readFormat";
import {
  READ_REQUIRED_DAYS,
  RECORDED_DAY_SECONDS,
  SLOT_SECONDS,
  dayMetrics,
  evidenceGroupLabels,
  evidenceGroupSizes,
  localize,
  shiftRows,
  splitRows,
  type InsightsRead,
  type ReadMetricId,
  type ReadValueFormat,
  type SplitRow,
} from "./readModel";

/*
 * Your read after the first read exists. Three blocks, top to bottom:
 *
 * 1. The read itself, in the read's own voice: one flat grey card with the
 *    claim, a quiet label, the body and Drifty's cat. No logo or header; it is
 *    the only grey card on the page, which is what marks it as the read.
 * 2. The evidence, in the editorial panel Your usage uses. It never redraws
 *    Your usage: no hour-by-weekday picture, no per-day totals, no rankings.
 *    Only each side of a split day by day, or this week against the usual.
 * 3. The try: last week's result, this week's action, and the next read that
 *    checks it, on one line.
 *
 * Words come from the model; every number, including the ones inside the
 * words, is computed by the app.
 */

const HOUR = 3600;

/* ----------------------------------------------------------------- icons */

type IconName = "check" | "info" | "x" | "up" | "down" | "approx" | "trendUp" | "trendDown" | "plus" | "arrow";

const THUMB = "M5.5 7.2v6.3H3.2V7.2h2.3Zm0 0 2.4-4.1c.3-.5.9-.7 1.4-.5.6.2.9.8.8 1.4l-.4 2.4h3c.8 0 1.4.7 1.3 1.5l-.6 4.3c-.1.7-.7 1.3-1.4 1.3H5.5";

function Icon({ name, size = 14, weight = 1.5 }: { readonly name: IconName; readonly size?: number; readonly weight?: number }) {
  const shapes: Record<IconName, ReactNode> = {
    check: <path d="m3.6 8.4 2.9 2.9 5.9-6.6" />,
    info: <><circle cx="8" cy="8" r="6.1" /><path d="M8 7.3v3.7M8 5.1v.1" /></>,
    x: <path d="m5.2 5.2 5.6 5.6m0-5.6-5.6 5.6" />,
    up: <path d={THUMB} />,
    down: <g transform="rotate(180 8 8)"><path d={THUMB} /></g>,
    approx: <path d="M3.5 6.4c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0M3.5 10.2c1.5-1.3 3-1.3 4.5 0s3 1.3 4.5 0" />,
    trendUp: <path d="m3 11 3.5-3.5 2.5 2.5L13 6m0 0H9.8M13 6v3.2" />,
    trendDown: <path d="m3 5 3.5 3.5L9 6l4 4m0 0H9.8m3.2 0V6.8" />,
    plus: <path d="M8 3.5v9M3.5 8h9" />,
    arrow: <path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" />,
  };
  return (
    <svg className="rp-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shapes[name]}
    </svg>
  );
}

/* ----------------------------------------------------------------- scales */

type Scale = { readonly min: number; readonly max: number; readonly ticks: readonly number[] };

function niceScale(values: readonly number[], format: ReadValueFormat): Scale {
  const high = Math.max(...values, 0);
  const low = Math.min(...values);
  if (format === "clock") {
    // Slots are 15 minutes from 04:00; ticks every two hours.
    const min = Math.floor(low / 8) * 8;
    const max = Math.max(min + 16, Math.ceil(high / 8) * 8);
    const ticks: number[] = [];
    for (let slot = min; slot <= max; slot += 8) ticks.push(slot);
    return { min, max, ticks };
  }
  if (format === "percent") return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  const step = high <= 4 * HOUR ? HOUR : high <= 8 * HOUR ? 2 * HOUR : high <= 16 * HOUR ? 4 * HOUR : 6 * HOUR;
  const max = Math.max(step * 2, Math.ceil(high / step) * step);
  const ticks: number[] = [];
  for (let value = 0; value <= max; value += step) ticks.push(value);
  return { min: 0, max, ticks };
}

function position(value: number, scale: Scale): number {
  return ((value - scale.min) / (scale.max - scale.min)) * 100;
}

/** The end ticks sit inside the plot, so a label never runs past its edge. */
function tickClass(index: number, count: number): string {
  return "rp-tick" + (index === 0 ? " is-start" : index === count - 1 ? " is-end" : "");
}

/** Days with nearly the same value stack above and below the line instead of hiding each other. */
function lanesFor(points: readonly { readonly key: string; readonly x: number }[]): Map<string, number> {
  const placed: { x: number; lane: number }[] = [];
  const lanes = new Map<string, number>();
  for (const point of [...points].sort((a, b) => a.x - b.x)) {
    const lane = [0, -1, 1, -2, 2, -3, 3].find((candidate) => !placed.some((other) => other.lane === candidate && Math.abs(other.x - point.x) < 3.2)) ?? 0;
    placed.push({ x: point.x, lane });
    lanes.set(point.key, lane);
  }
  return lanes;
}

const LANE_STEP = 10;

const TONE: Record<ReadMetricId, "focus" | "drift" | "ink"> = {
  focus: "focus",
  drift: "drift",
  driftShare: "drift",
  firstActivity: "ink",
  span: "ink",
};

/* ------------------------------------------------------------ panel parts */

/** Your usage's panel overline, with an optional plain-case detail beside it. */
function PanelHead({ label, detail, children }: { readonly label: string; readonly detail?: string; readonly children?: ReactNode }) {
  return (
    <div className="rp-head">
      <span className="rp-eyebrow">
        <span className="label-mono insight-section__label">{label}</span>
        {detail ? <span className="rp-eyebrow__detail">{detail}</span> : null}
      </span>
      {children}
    </div>
  );
}

function Legend({ items }: { readonly items: readonly { readonly side: "a" | "b"; readonly label: string; readonly count?: string }[] }) {
  return (
    <span className="rp-legend">
      {items.map((item) => (
        <span key={item.side} className="rp-legend__item">
          <i className={"rp-key is-" + item.side} aria-hidden="true" />
          {item.label}
          {item.count ? <em>{item.count}</em> : null}
        </span>
      ))}
    </span>
  );
}

/**
 * The patterns a read checked and dropped. A week with a read does not show
 * them: its evidence carries the read, and a list of claims that did
 * not hold up under it would compete with the one that did (product decision
 * 2026-10-10). A week without a read shows them as its body (Checked).
 */
function CheckList({ read }: { readonly read: InsightsRead }) {
  const { effectiveLanguage } = useLocalization();
  return (
    <ul className="rp-list">
      {read.checked.filter((check) => check.verdict === "dropped").map((check, index) => {
        const [claim, why] = localize(check.text, effectiveLanguage).split(": ");
        return (
          <li key={index}>
            <span className="rp-x"><Icon name="x" size={11} weight={1.75} /></span>
            <span className="rp-list__main">{claim}</span>
            {why ? <span className="rp-list__aside">{why}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------- evidence */

type Translate = ReturnType<typeof useLocalization>["t"];

/** A measure's change against the other side, the number the read's words cite ({focus.gap}, {span.gap}), and whether it is good or bad news. */
function measureChange(row: SplitRow, shown: 0 | 1, t: Translate, language: DisplayLanguage): { readonly change: string; readonly tone: string } {
  const other = shown === 0 ? 1 : 0;
  const delta = row.values[shown] - row.values[other];
  const deltaSeconds = row.format === "clock" ? delta * SLOT_SECONDS : delta;
  const change = row.format === "clock"
    ? (Math.abs(deltaSeconds) < 60 ? "±0" : t(delta < 0 ? "trends.read.tile.earlier" : "trends.read.tile.later", { value: durationLabel(Math.abs(deltaSeconds), language) }))
    : row.format === "percent" ? (delta >= 0 ? "+" : "−") + Math.round(Math.abs(delta) * 100) + (language === "ko" ? "%p" : " pts")
    : signedDuration(delta, language);
  // Less focus or more drift is the bad direction; time of day and day length carry no judgement.
  const notable = row.format === "duration" && Math.abs(delta) >= MEASURE_NOTABLE_SECONDS;
  const tone = !notable || TONE[row.id] === "ink" ? "" : (delta < 0) === (TONE[row.id] === "focus") ? " is-bad" : " is-good";
  return { change, tone };
}

/**
 * Every day of a measure as a dot, filled for the first side and hollow for
 * the second, each side's average as a line, over the measure's axis. Ticks
 * can be left off where the line below shares the axis or the cell is small.
 *
 * When the second side is an earlier stretch of time (baseline), it is not
 * dotted: its days become one usual range under this week's dots, a thin line
 * from its lowest to its highest day and a soft pill over its middle half; its
 * average is the "vs" figure beside the value. This week's days inside that range are
 * drawn faint and the ones outside it full, so the unusual days stand out.
 */
function MeasureStrip({ row, scale, ticks = true, step = LANE_STEP, baseline }: { readonly row: SplitRow; readonly scale: Scale; readonly ticks?: boolean; readonly step?: number; readonly baseline?: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const sorted = baseline ? row.days[1].map((day) => day.value).sort((x, y) => x - y) : [];
  const quantile = (p: number) => sorted[Math.round(p * (sorted.length - 1))];
  const range = baseline && sorted.length > 0
    ? { lo: sorted[0], q1: quantile(0.25), q3: quantile(0.75), hi: sorted[sorted.length - 1] }
    : null;
  const points = [
    ...row.days[0].map((day) => ({ key: "a" + day.date, side: "a" as const, x: position(day.value, scale), day })),
    ...(range ? [] : row.days[1].map((day) => ({ key: "b" + day.date, side: "b" as const, x: position(day.value, scale), day }))),
  ];
  const lanes = lanesFor(points);
  const spread = Math.max(1, ...[...lanes.values()].map((lane) => Math.abs(lane)));
  const center = Math.round(step * 0.6) + spread * step;
  const a = position(row.values[0], scale);
  const b = position(row.values[1], scale);
  const meanTop = center - spread * step - 5;
  const meanHeight = spread * step * 2 + 10;
  const valueA = formatValue(row.values[0], row.format, effectiveLanguage);
  const valueB = formatValue(row.values[1], row.format, effectiveLanguage);
  const fmt = (value: number) => formatValue(value, row.format, effectiveLanguage);
  return (
    <div className="rp-measure__plot" role="cell" aria-label={valueA + " / " + valueB} style={{ "--rp-center": center + "px", height: center * 2 + (ticks ? 18 : 0) } as CSSProperties}>
      <span className="rp-measure__line" style={{ top: center }} />
      {range ? (
        <span className="rp-range" title={t("trends.read.range", { group: baseline ?? "", q1: fmt(range.q1), q3: fmt(range.q3), lo: fmt(range.lo), hi: fmt(range.hi) })}>
          <span className="rp-range__whisker" style={{ left: position(range.lo, scale) + "%", width: position(range.hi, scale) - position(range.lo, scale) + "%" }} />
          <span className="rp-range__box" style={{ left: position(range.q1, scale) + "%", width: Math.max(0.8, position(range.q3, scale) - position(range.q1, scale)) + "%" }} />
        </span>
      ) : <span className="rp-measure__mean is-b" style={{ left: b + "%", top: meanTop, height: meanHeight }} />}
      <span className="rp-measure__mean is-a" style={{ left: a + "%", top: meanTop, height: meanHeight }} />
      {points.map((point) => (
        <i
          key={point.key}
          className={"rp-dot is-" + point.side + (range && point.day.value >= range.lo && point.day.value <= range.hi ? " is-usual" : "")}
          title={dayLabel(point.day.date, effectiveLanguage, "date") + " · " + formatValue(point.day.value, row.format, effectiveLanguage)}
          style={{ left: point.x + "%", "--lane": lanes.get(point.key) ?? 0, "--step": step + "px" } as CSSProperties}
        />
      ))}
      {ticks ? scale.ticks.map((tick, index) => (
        <span key={tick} className={"rp-measure__tick" + (index === 0 ? " is-start" : index === scale.ticks.length - 1 ? " is-end" : "")} style={{ left: position(tick, scale) + "%" }}>{tickLabel(tick, row.format, effectiveLanguage)}</span>
      )) : null}
    </div>
  );
}

/**
 * One measure on one line of a shared grey plate. At the left, its name, the
 * shown side's average large with the other side after "vs", and the change
 * as a chip: the number the read's words cite, so a reader finds it at a
 * glance. In the middle, the days over an axis that lines up with the other
 * lines' axes. The read's sentence at the right. The style under review
 * rearranges the same parts with CSS.
 */
function MeasureRow({ row, note, shown, scale, ticks = true, step, baseline }: { readonly row: SplitRow; readonly note: string | null; readonly shown: 0 | 1; readonly scale: Scale; readonly ticks?: boolean; readonly step?: number; readonly baseline?: string }) {
  const { effectiveLanguage, t } = useLocalization();
  const other = shown === 0 ? 1 : 0;
  const { change, tone } = measureChange(row, shown, t, effectiveLanguage);
  return (
    <div className={"rp-measure tone-" + TONE[row.id]} role="row" data-measure={row.id}>
      <div className="rp-measure__head" role="rowheader">
        <span className="rp-measure__top">
          <span className="rp-measure__name">{localize(row.label, effectiveLanguage)}</span>
          <span className={"rp-delta" + tone}>{change}</span>
        </span>
        <p className="rp-measure__value">
          <b>{formatValue(row.values[shown], row.format, effectiveLanguage)}</b>
          <span>{t("trends.read.tile.vs", { value: formatValue(row.values[other], row.format, effectiveLanguage) })}</span>
        </p>
      </div>
      <MeasureStrip row={row} scale={scale} ticks={ticks} step={step} baseline={baseline} />
      {note ? <p className="rp-measure__note" role="cell">{note}</p> : <span aria-hidden="true" />}
    </div>
  );
}

/** A change on a duration line smaller than this stays grey. */
const MEASURE_NOTABLE_SECONDS = 30 * 60;

/**
 * Each line's scale. Focus and drift are both hours of the same days, so they
 * share one scale: the reader sees drift's gain beside focus's loss at their
 * true sizes, as the read's notes compare them.
 */
function measureScales(rows: readonly SplitRow[]): Map<string, Scale> {
  const valuesOf = (row: SplitRow) => [...row.days[0].map((d) => d.value), ...row.days[1].map((d) => d.value), ...row.values];
  const hours = rows.filter((row) => row.id === "focus" || row.id === "drift");
  const shared = hours.length > 1 ? niceScale(hours.flatMap(valuesOf), "duration") : null;
  return new Map(rows.map((row) => [row.id, shared && hours.includes(row) ? shared : niceScale(valuesOf(row), row.format)]));
}

/**
 * How much the evidence keeps while the choice is under review. All three show
 * every picture with no panel label, one comparison bar on top, the measures
 * as lines on one grey plate with their axes lined up, and the two app
 * pictures side by side under them.
 *
 * - tidy: nothing left out; one switch for the side shown; short card titles;
 *   the read's sentence under each app picture.
 * - finding: each app picture opens on its figure (27% of switches, 2h 40m of
 *   YouTube) in place of a title and the read's sentence.
 * - minimal: finding, without the side switch, the totals, the bars or more
 *   than three links.
 */
export type ReadEvidencePolish = "tidy" | "finding" | "minimal";

const NO_ICONS: AppIconMap = {};

/**
 * Both sides of the comparison once, above every picture; on tidy and finding it also picks the side the pictures
 * lead with. It carries no caveat sentence about sample size (product decision 2026-10-10).
 */
function CompareBar({ names, sizes, shown, onShown, baseline = false }: {
  readonly names: readonly [string, string];
  readonly sizes: readonly [number, number];
  readonly shown: 0 | 1;
  readonly onShown?: (side: 0 | 1) => void;
  /** The second side is an earlier stretch drawn as a range; its key is a pill. */
  readonly baseline?: boolean;
}) {
  const { t } = useLocalization();
  const side = (index: 0 | 1) => (
    <>
      <i className={"rp-key is-" + (index === 0 ? "a" : baseline ? "range" : "b")} aria-hidden="true" />
      <span className="rp-side__name" title={names[index] + " · " + t("trends.read.days", { count: String(sizes[index]) })}>{names[index]}</span>
      <em>{t("trends.read.days", { count: String(sizes[index]) })}</em>
    </>
  );
  return (
    <div className="rp-compare">
      {onShown ? (
        <div className="wt-toggle rp-compare__sides" role="group" aria-label={t("trends.read.groupShownAria")}>
          {([0, 1] as const).map((index) => (
            <button key={index} type="button" className={"wt-toggle-btn" + (index === shown ? " is-active" : "")} aria-pressed={index === shown} onClick={() => onShown(index)}>{side(index)}</button>
          ))}
        </div>
      ) : (
        <span className="rp-compare__sides is-static">
          <span>{side(0)}</span>
          <span className="rp-compare__vs">vs</span>
          <span>{side(1)}</span>
        </span>
      )}
    </div>
  );
}

/** A picture's lead figure, computed by the app: the shown side's value large, the other side's after it. */
function Figure({ value, label, other }: { readonly value: string; readonly label: string; readonly other: string }) {
  return (
    <div className="rp-figure">
      <b>{value}</b>
      <span>{label}<em>{other}</em></span>
    </div>
  );
}

/**
 * Where the measures go while the choice is under review. In every layout they
 * are one narrow column, one stacked line each, beside a picture rather than
 * across the whole panel: beside time flow with switching laid out wide under
 * both ("side"); beside switching with time flow laid out wide under both
 * ("beside"); or a narrow column that stays in view down the left of both
 * pictures ("rail").
 */
export type ReadMeasureStyle = "side" | "rail" | "beside";
/**
 * What the blocks on the page look like, under review: every block, the read
 * included, as one deeper grey block on the light page ("grey", the default);
 * each part of the page on a grey plate with the evidence pictures as white
 * cards on it ("well"); or Your usage's white panel under the grey read ("panel").
 */
export type ReadCardTone = "panel" | "grey" | "well";

/**
 * Where the comparison's two sides are named, under review: as a line above
 * the blocks ("above", as it was), or inside the measures block as its first
 * line, so nothing on the page floats outside a block ("inside").
 */
export type ReadCompareStyle = "above" | "inside";

function SplitEvidence({ read, appIcons, polish, measures, compare }: { readonly read: InsightsRead; readonly appIcons: AppIconMap; readonly polish: ReadEvidencePolish; readonly measures: ReadMeasureStyle; readonly compare: ReadCompareStyle }) {
  const { effectiveLanguage, t } = useLocalization();
  const [chosen, setChosen] = useState<0 | 1>(0);
  const labels = evidenceGroupLabels(read);
  const sizes = evidenceGroupSizes(read);
  if (!labels || !sizes || read.evidence?.kind !== "split") return null;
  const evidence = read.evidence;
  // Minimal always leads with the side the read is about, and so does a comparison with an earlier stretch of time.
  const baseline = Boolean(evidence.baseline);
  const shown: 0 | 1 = polish === "minimal" || baseline ? 0 : chosen;
  const other: 0 | 1 = shown === 0 ? 1 : 0;
  const names = [localize(labels[0], effectiveLanguage), localize(labels[1], effectiveLanguage)] as const;
  const rows = splitRows(read);
  const hasApps = Boolean(evidence.apps?.length);
  const hasSwitches = hasApps && Boolean(evidence.switches?.length);
  const figures = polish !== "tidy";
  const noteFor = (key: "switching" | "flow") => {
    const note = read.notes?.["view." + key];
    return !figures && note ? <p className="rp-view-note"><FactText read={read} text={localize(note, effectiveLanguage)} /></p> : null;
  };

  const subject = evidence.apps?.find((app) => app.label === read.subject?.label);
  const totals = switchTotals(read);
  const share = (index: 0 | 1) => totals ? Math.round((totals.subject[index] / Math.max(1, totals.total[index])) * 100) + "%" : "";
  const switchHead = figures && subject && totals
    ? <Figure value={share(shown)} label={t("trends.read.stat.switchShare", { subject: subject.label })} other={t("trends.read.stat.other", { group: names[other], value: share(other) })} />
    : <h3 className="rp-card-title">{t("trends.read.card.switching")}</h3>;
  const focusShare = (dates: readonly string[]) => {
    const metrics = read.days.filter((day) => dates.includes(day.date)).map(dayMetrics);
    const tracked = metrics.reduce((sum, m) => sum + m.tracked, 0);
    return tracked === 0 ? "0%" : Math.round((metrics.reduce((sum, m) => sum + m.focus, 0) / tracked) * 100) + "%";
  };
  const flowHead = !figures
    ? <h3 className="rp-card-title">{t("trends.read.card.flow")}</h3>
    : subject
      ? <Figure value={durationLabel(subject.seconds[shown], effectiveLanguage)} label={t("trends.read.stat.appTime", { subject: subject.label })} other={t("trends.read.stat.other", { group: names[other], value: durationLabel(subject.seconds[other], effectiveLanguage) })} />
      : <Figure value={focusShare(evidence.groups[shown].dates)} label={t("trends.read.stat.focusShare")} other={t("trends.read.stat.other", { group: names[other], value: focusShare(evidence.groups[other].dates) })} />;

  const scales = measureScales(rows);
  // Focus and drift share a scale; the focus line leaves the shared axis to the drift line right under it.
  const hoursShared = scales.get("focus") !== undefined && scales.get("focus") === scales.get("drift");
  const compareBar = <CompareBar names={names} sizes={sizes} shown={shown} onShown={polish === "minimal" || baseline ? undefined : setChosen} baseline={baseline} />;
  // Inside, the two sides head the measures block: its dots are the ones the keys name, and the pictures beside it
  // name the other side in their own figures and "vs" values.
  const tiles = (
    <div className="rp-measures-card">
      {compare === "inside" ? compareBar : null}
      <div className="rp-measures" role="table" aria-label={t("trends.read.compareAria")}>
        {rows.map((row) => {
        const rowNote = read.notes?.[row.id];
        return (
          <MeasureRow
            key={row.id}
            row={row}
            note={rowNote ? localize(rowNote, effectiveLanguage) : null}
            shown={shown}
            scale={scales.get(row.id)!}
            ticks={!(hoursShared && row.id === "focus")}
            baseline={baseline ? names[1] : undefined}
          />
        );
        })}
      </div>
    </div>
  );
  const switching = hasSwitches ? (
    <section className="editorial-panel rp-panel rp-card is-switching" aria-label={t("trends.read.evidenceSwitching")}>
      <SwitchingView read={read} group={shown} appIcons={appIcons} head={switchHead} sums={polish !== "minimal"} />
      {noteFor("switching")}
    </section>
  ) : null;
  const flow = hasApps ? (
    <section className="editorial-panel rp-panel rp-card is-flow" aria-label={t("trends.read.evidenceFlow")}>
      <TimeFlowView read={read} group={shown} appIcons={appIcons} head={flowHead} />
      {noteFor("flow")}
    </section>
  ) : null;
  return (
    <section className={"rp-ev is-" + polish + (hasApps ? " has-measures-" + measures : " is-alone")} aria-label={t("trends.read.evidence")}>
      {compare === "above" ? compareBar : null}
      <div className="rp-ev-grid">
        {tiles}
        {switching}
        {flow}
      </div>
    </section>
  );
}

function ShiftEvidence({ read }: { readonly read: InsightsRead }) {
  const { effectiveLanguage, t } = useLocalization();
  if (read.evidence?.kind !== "shift") return null;
  const weeks = String(read.evidence.usualWeeks);
  const rows = shiftRows(read);
  const scale = niceScale(rows.flatMap((row) => [row.value, row.usual]), "duration");
  return (
    <section className={"editorial-panel rp-panel rp-evidence tone-" + read.evidence.metric} aria-label={t("trends.read.evidence")}>
      <div className="rp-sub"><Legend items={[{ side: "a", label: t("trends.read.thisWeek") }, { side: "b", label: t("trends.read.usual", { weeks }) }]} /></div>
      <div className="rp-shifts" role="table" aria-label={t("trends.read.shiftAria", { weeks })}>
        {rows.map((row) => {
          const notable = Math.abs(row.delta) >= SHIFT_NOTABLE_SECONDS;
          const direction = notable ? (row.delta < 0 ? " is-down" : " is-up") : "";
          const note = read.notes?.[row.date];
          const value = position(row.value, scale);
          const usual = position(row.usual, scale);
          return (
            <div key={row.date} className={"rp-shift" + (notable ? " is-notable" : "") + direction} role="row">
              <span className="rp-shift__day" role="rowheader">{dayLabel(row.date, effectiveLanguage)}</span>
              <div className="rp-shift__track" role="cell" aria-label={durationLabel(row.value, effectiveLanguage) + " / " + durationLabel(row.usual, effectiveLanguage)}>
                <span className="rp-shift__line" />
                <span className="rp-shift__gap" style={{ left: Math.min(value, usual) + "%", width: Math.abs(value - usual) + "%" }} />
                <i className="rp-dot is-b" title={t("trends.read.usual", { weeks }) + " · " + durationLabel(row.usual, effectiveLanguage)} style={{ left: usual + "%" }} />
                <i className="rp-dot is-a" title={dayLabel(row.date, effectiveLanguage, "date") + " · " + durationLabel(row.value, effectiveLanguage)} style={{ left: value + "%" }} />
              </div>
              <span className="rp-shift__delta" role="cell"><b>{signedDuration(row.delta, effectiveLanguage)}</b></span>
              <p className="rp-row__note" role="cell">{note ? localize(note, effectiveLanguage) : null}</p>
            </div>
          );
        })}
        <div className="rp-shift is-axis" aria-hidden="true">
          <span />
          <div className="rp-shift__track">
            {scale.ticks.map((tick, index) => (
              <span key={tick} className={tickClass(index, scale.ticks.length)} style={{ left: position(tick, scale) + "%" }}>{tickLabel(tick, "duration", effectiveLanguage)}</span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Too little recorded: how many days counted, as a share of what a read needs. Never the hours of each day. */
function Coverage({ read }: { readonly read: InsightsRead }) {
  const { t } = useLocalization();
  const counted = read.days.filter((entry) => dayMetrics(entry).tracked >= RECORDED_DAY_SECONDS).length;
  const dayHours = String(COACH_MEANINGFUL_DAY_HOURS);
  return (
    <section className="editorial-panel rp-panel rp-evidence is-quiet">
      <PanelHead label={t("trends.read.coverageTitle")} detail={t("trends.read.coverageCounted", { count: String(counted), days: String(read.days.length), dayHours })} />
      <span className="rp-seg is-wide" role="progressbar" aria-valuemin={0} aria-valuemax={READ_REQUIRED_DAYS} aria-valuenow={Math.min(counted, READ_REQUIRED_DAYS)} aria-label={t("trends.read.coverageNeeded", { days: String(READ_REQUIRED_DAYS) })}>
        {Array.from({ length: READ_REQUIRED_DAYS }, (_, index) => <i key={index} className={index < counted ? "is-on" : ""} />)}
      </span>
      <p className="rp-fine">{t("trends.read.next.rule", { days: String(READ_REQUIRED_DAYS), dayHours })}</p>
    </section>
  );
}

/** No read: the patterns that were checked and why each was left out. */
function Checked({ read }: { readonly read: InsightsRead }) {
  const { t } = useLocalization();
  const dropped = read.checked.filter((check) => check.verdict === "dropped");
  if (dropped.length === 0) return null;
  return (
    <section className="editorial-panel rp-panel rp-evidence is-quiet">
      <PanelHead label={t("trends.read.checkedTitle")} detail={t("trends.read.checkedDetail", { count: String(dropped.length) })} />
      <CheckList read={read} />
    </section>
  );
}

/* ------------------------------------------------------------------ voice */

/** Read text with the app's numbers filled in, each one marked and sourced. */
function FactText({ read, text }: { readonly read: InsightsRead; readonly text: string }) {
  const { effectiveLanguage } = useLocalization();
  const parts = fillFacts(text, readFacts(read, effectiveLanguage));
  if (!parts) return null;
  return (
    <>
      {parts.map((part, index) => ("text" in part
        ? part.text
        : <span key={index} className="rp-fact" title={part.fact.source} data-fact={part.id}>{part.fact.value}</span>))}
    </>
  );
}

function Headline({ read }: { readonly read: InsightsRead }) {
  const { effectiveLanguage } = useLocalization();
  const text = localize(read.headline, effectiveLanguage);
  const emphasis = read.emphasis ? localize(read.emphasis, effectiveLanguage) : "";
  const at = emphasis ? text.lastIndexOf(emphasis) : -1;
  if (at < 0) return <h2 className="rp-voice__title">{text}</h2>;
  return <h2 className="rp-voice__title">{text.slice(0, at)}<em className="rp-em">{emphasis}</em>{text.slice(at + emphasis.length)}</h2>;
}

/**
 * Two thumbs and nothing else, right after the read's last sentence like a
 * reaction on a message. The pick stays pressed and is kept on this device;
 * pressing it again clears it.
 */
function Vote({ readId }: { readonly readId: string }) {
  const { t } = useLocalization();
  const [vote, setVote] = useReadVote(readId);
  return (
    <span className="rp-vote" role="group" aria-label={t("trends.read.feedbackPrompt")}>
      {(["up", "down"] as const).map((entry) => {
        const label = t(entry === "up" ? "trends.read.feedbackYes" : "trends.read.feedbackNo");
        return (
          <button key={entry} type="button" className="rp-thumb" aria-pressed={vote === entry} aria-label={label} title={label} onClick={() => setVote(vote === entry ? null : entry)}>
            <Icon name={entry} size={13} />
          </button>
        );
      })}
    </span>
  );
}

/** The read in its own voice: the claim, one quiet label line, the body with its thumbs, and the cat. */
function Voice({ read, seat }: { readonly read: InsightsRead; readonly seat: ReadCatSeat }) {
  const { effectiveLanguage, t } = useLocalization();
  const quiet = read.status === "abstain";
  const thin = read.comparableDays < READ_REQUIRED_DAYS;
  const date = dayLabel(read.generatedOn, effectiveLanguage, "date");
  const keyword = read.subject?.label
    ?? t(quiet ? (thin ? "trends.read.kind.thin" : "trends.read.kind.quiet") : read.evidence?.kind === "shift" ? "trends.read.kind.shift" : "trends.read.kind.split");
  const details = quiet
    ? [t("trends.read.checkedOn", { date })]
    : [read.isFirst ? t("trends.read.firstLabel") : null, t("trends.read.compared", { days: String(read.comparableDays) }), t("trends.read.written", { date })];
  return (
    <article className={"rp-voice" + (quiet ? " is-quiet" : "")}>
      <div className="rp-voice__copy">
        <Headline read={read} />
        <p className="rp-voice__label">
          <span className="label-mono">{keyword}</span>
          <span>{details.filter(Boolean).join(" · ")}</span>
        </p>
        {/* A week without a read has nothing to rate. */}
        <p className="rp-voice__body"><FactText read={read} text={localize(read.body, effectiveLanguage)} />{quiet ? null : <Vote readId={read.id} />}</p>
      </div>
      <ReadCat pose={quiet ? "sleep" : "sit"} seat={seat} />
    </article>
  );
}

/* -------------------------------------------------------------------- try */

const RESULT_ICON: Record<"improved" | "steady" | "declined" | "insufficient", IconName> = {
  improved: "trendUp",
  steady: "approx",
  declined: "trendDown",
  insufficient: "info",
};

/**
 * The try at the foot of the page, in the page's own voice (product decision
 * 2026-10-10): a plain label, this week's try as a serif sentence the way the
 * evidence cards lead with a serif figure, and one accent pill that stays
 * pressed, as the thumbs do. Last week's result is one quiet line under it,
 * its verdict coloured text. An older read links the read that checked its try.
 */
function TryPill({ trying, onTry }: { readonly trying: boolean; readonly onTry: () => void }) {
  const { t } = useLocalization();
  return (
    <button type="button" className={"rp-trypill" + (trying ? " is-on" : "")} aria-pressed={trying} onClick={onTry}>
      <Icon name={trying ? "check" : "plus"} size={12} weight={trying ? 2.4 : 1.8} />
      {t(trying ? "trends.read.trying" : "trends.read.tryCommit")}
    </button>
  );
}

function TryVerdict({ follow }: { readonly follow: NonNullable<InsightsRead["followUp"]> }) {
  const { t } = useLocalization();
  return (
    <span className={"rp-tryres__verdict is-" + follow.result}>
      <Icon name={RESULT_ICON[follow.result]} size={12} />
      {t(("trends.read.result." + follow.result) as TranslationKey)}
    </span>
  );
}

/** What an older read links to in place of the pill: the read that checked its try. */
function TryCheckedBy({ newer, onSelect }: { readonly newer: InsightsRead | undefined; readonly onSelect: (id: string) => void }) {
  const { effectiveLanguage, t } = useLocalization();
  if (!newer) return null;
  return (
    <button type="button" className="app-btn app-btn--quiet app-btn--compact rp-trylink" onClick={() => onSelect(newer.id)}>
      {t("trends.read.loop.checkedBy", { date: dayLabel(newer.generatedOn, effectiveLanguage, "day") })}<Icon name="arrow" />
    </button>
  );
}

type TryProps = {
  readonly log: readonly InsightsRead[];
  readonly index: number;
  readonly onSelect: (id: string) => void;
  readonly trying: boolean;
  readonly onTry: () => void;
};

function useTry({ log, index }: Pick<TryProps, "log" | "index">) {
  const { effectiveLanguage, t } = useLocalization();
  const read = log[index];
  const latest = index === 0;
  return {
    read,
    latest,
    newer: log[index - 1],
    follow: read.followUp,
    lastLabel: latest ? t("trends.read.loop.last", { range: weekRangeLabel(read.weekStart, read.weekEnd, effectiveLanguage) }) : weekRangeLabel(read.weekStart, read.weekEnd, effectiveLanguage),
    nowLabel: latest
      ? t("trends.read.loop.now", { range: weekRangeLabel(shiftDate(read.weekEnd, 1), shiftDate(read.weekEnd, 7), effectiveLanguage) })
      : weekRangeLabel(shiftDate(read.weekEnd, 1), shiftDate(read.weekEnd, 7), effectiveLanguage),
    language: effectiveLanguage,
  };
}

function TryLine(props: TryProps) {
  const { read, latest, newer, follow, lastLabel, nowLabel, language } = useTry(props);
  if (!read.tryNext && !follow) return null;
  return (
    <section className="editorial-panel rp-panel rp-try" aria-label={nowLabel}>
      {read.tryNext ? (
        <div className="rp-trylead">
          <div className="rp-trylead__copy">
            <span className={"rp-trylead__when" + (latest ? "" : " is-past")}>{nowLabel}</span>
            <p className="rp-trylead__what">{localize(read.tryNext.action, language)}</p>
            <p className="rp-trylead__sub">{localize(read.tryNext.watch, language)}</p>
          </div>
          {latest ? <TryPill trying={props.trying} onTry={props.onTry} /> : <TryCheckedBy newer={newer} onSelect={props.onSelect} />}
        </div>
      ) : null}
      {follow ? (
        <p className={"rp-tryres" + (read.tryNext ? "" : " is-alone")}>
          <span className="rp-tryres__when">{lastLabel}</span>
          <span className="rp-tryres__what">{localize(follow.action, language)}</span>
          <TryVerdict follow={follow} />
          <span className="rp-tryres__detail">{localize(follow.detail, language)}</span>
        </p>
      ) : null}
    </section>
  );
}

/* --------------------------------------------------------------- navigator */

/**
 * The week navigator Your usage uses, in the toolbar slot Your usage uses. A
 * read is one week, so the label is that week; Latest returns to the newest read.
 */
function ReadNavigator({ log, index, onSelect, toolbar }: {
  readonly log: readonly InsightsRead[];
  readonly index: number;
  readonly onSelect: (id: string) => void;
  readonly toolbar: HTMLElement;
}) {
  const { effectiveLanguage, t } = useLocalization();
  const read = log[index];
  const older = log[index + 1];
  const newer = log[index - 1];
  return createPortal(
    <DateNavigator
      ariaLabel={t("trends.read.navAria")}
      label={weekRangeLabel(read.weekStart, read.weekEnd, effectiveLanguage)}
      todayLabel={t("trends.latest")}
      todayActionLabel={t("trends.read.latestAria")}
      isTodayDisabled={index === 0}
      isNextDisabled={!newer}
      isPreviousDisabled={!older}
      onPrevious={() => { if (older) onSelect(older.id); }}
      onNext={() => { if (newer) onSelect(newer.id); }}
      onToday={() => onSelect(log[0].id)}
      previousLabel={t("trends.read.older")}
      nextLabel={t("trends.read.newer")}
    />,
    toolbar,
  );
}

/** Which way the reader just stepped, so the next read slides in from that side. */
type Step = "none" | "older" | "newer";

/** The read page: the read, its evidence, and the try it leads to. */
export function ReadPage({ log, selectedId, onSelect, toolbar = null, appIcons = NO_ICONS, evidencePolish = "tidy", measureStyle = "side", cardTone = "grey", compareStyle = "inside", arrival = "fade" }: {
  readonly log: readonly InsightsRead[];
  readonly selectedId: string;
  readonly onSelect: (id: string) => void;
  /** The Insights toolbar slot for the week navigator. */
  readonly toolbar?: HTMLElement | null;
  /** App icons, as Your usage receives them; sites read the site icon cache. */
  readonly appIcons?: AppIconMap;
  readonly evidencePolish?: ReadEvidencePolish;
  /** How the measures are laid out; under review. */
  readonly measureStyle?: ReadMeasureStyle;
  /** What the cards under the read sit on; under review. */
  readonly cardTone?: ReadCardTone;
  /** Where the comparison's two sides are named; under review. */
  readonly compareStyle?: ReadCompareStyle;
  /**
   * How the page appears: a short fade, or none when the first read has just
   * been revealed in place behind the writing dialog and is already on screen.
   */
  readonly arrival?: "fade" | "none";
}) {
  const [trying, setTrying] = useState(false);
  const index = Math.max(0, log.findIndex((entry) => entry.id === selectedId));
  const read = log[index];
  // Remember the last index shown so a step can slide the next read in from its side.
  const [shown, setShown] = useState<{ readonly index: number; readonly step: Step }>({ index, step: "none" });
  if (shown.index !== index) setShown({ index, step: index > shown.index ? "older" : "newer" });
  const quiet = read.status === "abstain";
  const thin = read.comparableDays < READ_REQUIRED_DAYS;
  // The log runs newest first, so its last read is the first one; the cat's seat turns each week from there.
  const seat = seatForWeek(log[log.length - 1].weekStart, read.weekStart);
  const onTry = () => setTrying((value) => !value);
  const tryProps = { log, index, onSelect, trying, onTry };
  return (
    <div className={"rp-root" + (cardTone === "panel" ? "" : " is-cards-" + cardTone)}>
      {toolbar ? <ReadNavigator log={log} index={index} onSelect={onSelect} toolbar={toolbar} /> : null}
      <div key={read.id} className={"rp-stack" + (shown.step === "none" ? (arrival === "none" ? " is-in-place" : "") : " is-from-" + shown.step)}>
        <Voice read={read} seat={seat} />
        {quiet ? (thin ? <Coverage read={read} /> : <Checked read={read} />)
          : read.evidence?.kind === "shift" ? <ShiftEvidence read={read} />
          : <SplitEvidence read={read} appIcons={appIcons} polish={evidencePolish} measures={measureStyle} compare={compareStyle} />}
        <TryLine {...tryProps} />
      </div>
    </div>
  );
}
