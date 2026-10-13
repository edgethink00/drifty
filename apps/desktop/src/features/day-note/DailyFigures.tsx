import { useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { CompactClassificationHoverCard, type CompactClassificationHoverState } from "../dashboard/HoverCards";
import { formatLocalizedCompactDurationFromSeconds } from "../../lib/formatting";
import type { DisplayLanguage } from "../localization/languagePreference";
import { useLocalization } from "../localization/LocalizationContext";
import type { TranslationKey } from "../localization/translations";
import { durationLabel } from "../insights/read/readFormat";
import { formatRhythmHourLabel } from "../insights/InsightCards";
import { CATEGORY_COLORS } from "../../lib/activityLabels";
import { resolveInitialStartOfDayMinutes } from "../settings/settingsStorage";
import { clockLabel } from "./dayNoteMetrics";
import type { DayCategory, DaySpan } from "./dayNoteFixture";
import { dailyFigures, type DailyRowKind } from "./dailyFiguresModel";
import "./dailyFigures.css";

/*
 * The day's activity (settled 2026-10-13): Insights' Attention rhythm board,
 * reused. Its board, cells, 1px dividers, three intensity tiers (18/34/54% of
 * the colour, against the busiest cell of the group) and bare hour labels.
 * Rows are grouped and stacked with no gap between rows: productivity
 * (focus, drift, neutral) as the summary, then categories, then projects when
 * the day has project time. 30-minute cells over the app's 24-hour day, with a
 * divider on the hour. Name and total sit at the left, hours below. Each cell
 * opens the app hover card Your Day and Insights use.
 */
const CATEGORY_KEYS: Record<DayCategory, TranslationKey> = {
  workspace: "activity.category.workspace", learning: "activity.category.learning", communication: "activity.category.communication",
  music: "activity.category.music", game: "activity.category.game", socialMedia: "activity.category.socialMedia", entertainment: "activity.category.entertainment",
  shopping: "activity.category.shopping", utility: "activity.category.utility", unknown: "activity.category.unknown",
};
const color = (category: DayCategory) => CATEGORY_COLORS[category === "socialMedia" ? "social_media" : category];
const KIND_COLORS: Record<string, string> = { focus: "var(--productivity-focus)", drift: "var(--productivity-drift)", neutral: "color-mix(in srgb, var(--text-soft) 55%, var(--surface-strong))" };
const PROJECT_TONES = ["var(--accent)", "var(--category-learning)", "var(--category-communication)", "var(--category-social-media)", "var(--category-entertainment)", "var(--category-utility)"];
const GROUP_LABEL: Record<DailyRowKind, TranslationKey> = { category: "dashboard.today.category", productivity: "dashboard.today.productivity", project: "dashboard.today.project" };
const COPY = {
  ko: { title: "시간대별 기록", less: "적음", more: "많음", label: "선택한 날의 기록", empty: "아직 이 날의 기록이 없어요", privateSite: "비공개 사이트" },
  en: { title: "Activity by hour", less: "Less", more: "More", label: "Selected day's activity", empty: "No recorded activity for this day yet", privateSite: "Private site" },
};
const CELL_MINUTES = 30;
const PER_HOUR = 60 / CELL_MINUTES;
/* A row with under a minute reads "1분 미만", not "0분". */
const duration = (minutes: number, lang: DisplayLanguage) => minutes > 0 && minutes < 0.5 ? (lang === "ko" ? "1분 미만" : "<1m") : durationLabel(Math.max(1, Math.round(minutes)) * 60, lang);

/** Attention rhythm's tiering (attentionRhythm.ts): against the busiest cell, at a third and two thirds. */
function tier(value: number, max: number): 1 | 2 | 3 {
  if (max <= 0) return 1;
  const ratio = value / max;
  return ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
}

export function DailyFigures({ spans, lang, appIcons = {} }: { spans: readonly DaySpan[]; lang: DisplayLanguage; appIcons?: AppIconMap }) {
  const { t } = useLocalization();
  const [hover, setHover] = useState<CompactClassificationHoverState | null>(null);
  const start = resolveInitialStartOfDayMinutes();
  const figures = useMemo(() => dailyFigures(spans, start, CELL_MINUTES), [spans, start]);
  const c = COPY[lang];

  /* The panel's title (settled 2026-10-13): section size in the muted ink, the less/more key at its right. */
  const head = (withKey: boolean) => (
    <div className="wf-head">
      <h2 className="wf-title">{c.title}</h2>
      {withKey ? <span className="wf-legend" aria-hidden="true">{c.less}<i className="is-t1" /><i className="is-t2" /><i className="is-t3" />{c.more}</span> : null}
    </div>
  );

  if (!figures.rows.length) {
    return <section className="dn-figs wf" aria-label={c.label}><div className="dn-pnl wf-panel">{head(false)}<p className="wf-empty">{c.empty}</p></div></section>;
  }

  const groups: DailyRowKind[] = spans.some((span) => Boolean(span.project)) ? ["productivity", "category", "project"] : ["productivity", "category"];
  const firstHour = Math.floor(figures.start / 60);
  const hours = Array.from({ length: 24 }, (_, i) => (firstHour + i) % 24);
  const rowsOf = (kind: DailyRowKind) => figures.rowsBy(kind).map((row, index) => ({
    ...row,
    name: kind === "category" ? t(CATEGORY_KEYS[row.key as DayCategory]) : kind === "productivity" ? t(`activity.productivity.${row.key}` as TranslationKey) : row.key,
    tone: kind === "category" ? color(row.key as DayCategory) : kind === "productivity" ? KIND_COLORS[row.key]! : PROJECT_TONES[index % PROJECT_TONES.length]!,
  }));

  return (
    <section className="dn-figs wf" aria-label={c.label}>
      <div className="dn-pnl wf-panel">
        {head(true)}
        <div className="wf-rhythm">
          {groups.map((kind) => {
            const rows = rowsOf(kind);
            const max = Math.max(0, ...rows.flatMap((row) => row.cells));
            const last = rows.length - 1;
            return (
              <div className="wf-rhythm__group" key={kind} style={{ "--wf-rows": rows.length } as CSSProperties} aria-label={t(GROUP_LABEL[kind])}>
                <div className="wf-rhythm__labels">
                  {rows.map((row) => (
                    <div className="wf-rhythm__label" key={row.key} style={{ "--wf-tone": row.tone } as CSSProperties}>
                      <span className="wf-name"><i aria-hidden="true" />{row.name}</span>
                      <span className="wf-total">{duration(row.minutes, lang)}</span>
                    </div>
                  ))}
                </div>
                <div className="productivity-rhythm-card__board wf-rhythm__board" role="img" aria-label={`${c.label} · ${t(GROUP_LABEL[kind])}`}>
                  {rows.flatMap((row, r) => row.cells.map((minutes, h) => {
                    const dividers: string[] = [];
                    if (h !== row.cells.length - 1 && (h + 1) % PER_HOUR === 0) dividers.push("inset -1px 0 0 var(--attention-rhythm-divider)");
                    if (r < last) dividers.push("inset 0 -1px 0 var(--attention-rhythm-divider)");
                    const show = (event: MouseEvent<HTMLSpanElement>) => {
                      const from = figures.start + h * CELL_MINUTES;
                      setHover({
                        label: `${row.name} · ${clockLabel(from)}–${clockLabel(from + CELL_MINUTES)}`,
                        durationLabel: formatLocalizedCompactDurationFromSeconds(minutes * 60, lang),
                        shareLabel: `${Math.max(1, Math.round((minutes / Math.max(figures.total, 1)) * 100))}%`,
                        dotClassName: "",
                        color: row.tone,
                        appBreakdown: figures.cellApps(kind, row.key, h).map((entry) => ({
                          appName: entry.appName || c.privateSite,
                          bundleId: entry.bundleId ?? null,
                          siteDomain: entry.site ?? null,
                          totalSeconds: entry.minutes * 60,
                        })),
                        x: event.clientX,
                        y: event.clientY,
                      });
                    };
                    return (
                      <span
                        key={row.key + "-" + h}
                        className={"productivity-rhythm-card__cell" + (minutes > 0 ? " is-t" + tier(minutes, max) : "")}
                        style={{ "--wf-tone": row.tone, boxShadow: dividers.join(", ") } as CSSProperties}
                        onMouseEnter={minutes > 0 ? show : undefined}
                        onMouseMove={minutes > 0 ? (event: MouseEvent<HTMLSpanElement>) => setHover((current) => (current ? { ...current, x: event.clientX, y: event.clientY } : current)) : undefined}
                        onMouseLeave={() => setHover(null)}
                      />
                    );
                  }))}
                </div>
              </div>
            );
          })}
          <div className="wf-rhythm__foot">
            <span />
            <div className="productivity-rhythm-card__times wf-rhythm__times" aria-hidden="true">
              {hours.map((hour, i) => <span key={i}>{formatRhythmHourLabel(hour, lang)}</span>)}
            </div>
          </div>
        </div>
      </div>
      {hover ? <CompactClassificationHoverCard hover={hover} appIcons={appIcons} language={lang} /> : null}
    </section>
  );
}
