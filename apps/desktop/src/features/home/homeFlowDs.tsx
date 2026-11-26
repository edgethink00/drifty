import { useMemo, useState, type FormEvent } from "react";
import type { AppIconMap, ProductivityDuration } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { buildDonutArcSegments } from "../../lib/donutArcPath";
import { DONUT_CIRCUMFERENCE } from "../insights/insightData";
import { CompactRingChart } from "../dashboard/CompactRingChart";
import { buildProductivityCenterPercent, buildProductivityRingEntries } from "../dashboard/FlowCompactSplitChart";
import { useLocalization } from "../localization/LocalizationContext";
import { localizedProductivityLabel } from "../localization/activityTranslations";
import { achievementRowParts } from "../achievements/achievementRows";
import { achievementCondition, achievementName } from "../achievements/achievementCopy";
import { isAchievementDesignReview, useAchievementReviewState } from "../achievements/achievementDesignReview";
import { itemsForReviewHolding } from "../achievements/useAchievementsTab";
import type { AchievementItem } from "../achievements/useAchievements";
import { C15Medal } from "../achievements/layouts/c15/C15Medal";
import { DEEP_FOCUS_MIN_SECONDS, type HomeModel, type HomeSession, type HomeWorkItem } from "./homeModel";
import { formatClock, formatDuration, formatShortDuration, topCard, type HomeLang } from "./homeCards";
import "./home-ds.css";

/*
 * F6: F5 rebuilt only from the app's own parts (owner review 2026-11-27:
 * "the design system doesn't match"). The productivity donut is Your Day's
 * CompactRingChart; goal and focus quality use the same donut track and arc;
 * the last 7 days use the Insights week columns (wt-*); the day switch is the
 * page segmented control (.seg); block titles use the shared block head;
 * buttons are app-btn; blocks are the achievements cards' grey fill. No new
 * surface, colour or type size.
 */

const COPY = {
  ko: {
    welcome: "다시 만나서 반가워요", today: "오늘", yesterday: "어제", switchLabel: "보는 날",
    recording: "기록 중", lastRecord: (t: string) => "마지막 기록 " + t, notRecording: "아직 기록 없음",
    dayTitle: (d: string) => d + " 한 일", none: "아직 15분 넘게 이어진 일이 없어요", drift: "딴짓",
    productivity: "오늘 생산성", goal: "목표", quality: "집중 품질", left: (d: string) => d + " 남음", done: "달성",
    longest: (d: string) => "가장 긴 집중 " + d, qualityNotYet: "25분 넘게 집중하면 보여요",
    week: "최근 7일 집중", weekMet: (n: number) => n + "일 목표 달성", goalLine: (d: string) => d,
    weekAvg: "하루 평균",
    next: "다음 업적", open: "보기", ask: "Drifty에게 묻기", send: "보내기", example: (q: string) => "Drifty에게 묻기 · 예: " + q,
    examples: { morning: "어제 정리해 줘", midday: "왜 평소보다 느려?", evening: "오늘 정리해 줘" },
    weekdays: ["일", "월", "화", "수", "목", "금", "토"], weekdaysLong: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  },
  en: {
    welcome: "Welcome back", today: "Today", yesterday: "Yesterday", switchLabel: "Day",
    recording: "Recording", lastRecord: (t: string) => "Last record " + t, notRecording: "Nothing recorded yet",
    dayTitle: (d: string) => d, none: "Nothing has held for 15 minutes yet", drift: "Drift",
    productivity: "Productivity today", goal: "Goal", quality: "Focus quality", left: (d: string) => d + " to go", done: "Met",
    longest: (d: string) => "Longest " + d, qualityNotYet: "Shows after 25 minutes of focus",
    week: "Focus, last 7 days", weekMet: (n: number) => "Goal met " + n + (n === 1 ? " day" : " days"), goalLine: (d: string) => d,
    weekAvg: "Daily average",
    next: "Next achievement", open: "Open", ask: "Ask Drifty", send: "Send", example: (q: string) => "Ask Drifty · e.g. " + q,
    examples: { morning: "Recap yesterday", midday: "Why am I behind usual?", evening: "Wrap up today" },
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], weekdaysLong: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  },
};
type Copy = (typeof COPY)["ko"];
const LIVE_MS = 10 * 60_000;

function dayLabel(day: string, lang: HomeLang, c: Copy): string {
  const date = new Date(day + "T12:00:00");
  return lang === "ko" ? (date.getMonth() + 1) + "월 " + date.getDate() + "일 " + c.weekdaysLong[date.getDay()]
    : date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function ItemIcon({ item, appIcons }: { readonly item: HomeWorkItem; readonly appIcons: AppIconMap }) {
  const icon = appIcons[item.bundleId ?? item.appName] ?? appIcons[item.appName] ?? null;
  return item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={icon} /> : <AppGlyph appName={item.appName} iconSrc={icon} size="sm" />;
}

/** A small donut drawn with Your Day's donut track and arc, for one share. */
function SmallDonut({ ratio }: { readonly ratio: number }) {
  const entries = ratio > 0.004 ? [{ key: "focus", ratio: Math.min(1, ratio) }] : [];
  const arcs = buildDonutArcSegments(entries, (entry) => entry.ratio, 50, 50, 40, 0 / DONUT_CIRCUMFERENCE);
  return (
    <svg className="hf-donut" viewBox="0 0 100 100" aria-hidden="true">
      <circle className="flow-compact-productivity-circle__track" cx="50" cy="50" r="40" />
      {arcs.map(({ entry, pathData }) => <path key={entry.key} className="flow-compact-productivity-circle__segment" d={pathData} stroke="var(--flow-tone-focus)" />)}
    </svg>
  );
}

function Title({ text, meta }: { readonly text: string; readonly meta?: string }) {
  return (
    <div className="hf-head">
      <span className="insight-section__label">{text}</span>
      {meta ? <span className="hf-head__meta">{meta}</span> : null}
    </div>
  );
}

function AskBox({ c, phase, onAsk }: { readonly c: Copy; readonly phase: HomeModel["phase"]; readonly onAsk: (q: string) => void }) {
  const [text, setText] = useState("");
  const example = c.examples[phase];
  const submit = (event: FormEvent) => { event.preventDefault(); onAsk(text.trim() || example); setText(""); };
  return (
    <form className="hf-ask" onSubmit={submit}>
      <input type="text" value={text} onChange={(event) => setText(event.target.value)} placeholder={c.example(example)} aria-label={c.ask} />
      <button type="submit" className="app-btn app-btn--primary app-btn--compact" aria-label={c.send}>{c.send}</button>
    </form>
  );
}

export function FlowDsHome({ model, lang, appIcons, achievements, onOpenDay, onOpenWeek, onOpenAchievements, onAsk }: {
  readonly model: HomeModel; readonly lang: HomeLang; readonly appIcons: AppIconMap; readonly achievements: readonly AchievementItem[];
  readonly onOpenDay: () => void; readonly onOpenWeek: () => void; readonly onOpenAchievements: () => void; readonly onAsk: (q: string) => void;
}) {
  const c = COPY[lang];
  const { t } = useLocalization();
  const card = topCard(model, lang);
  const [day, setDay] = useState<"today" | "yesterday">(() => (model.sessions.length === 0 && (model.yesterday?.sessions.length ?? 0) > 0 ? "yesterday" : "today"));
  const review = isAchievementDesignReview();
  const { holding } = useAchievementReviewState();
  const next = useMemo(() => {
    const shown = review ? itemsForReviewHolding(achievements, holding) : achievements;
    return achievementRowParts(shown, { almost: 1 }).almost[0] ?? null;
  }, [review, achievements, holding]);

  const live = model.lastRecordMs !== null && model.asOfMs - model.lastRecordMs <= LIVE_MS;
  const listDay = day === "today" ? model.today : model.yesterday?.day ?? model.today;
  const sessions: readonly HomeSession[] = day === "today" ? model.sessions : model.yesterday?.sessions ?? [];
  const rows = [...sessions].reverse().slice(0, 6);

  const tracked = model.now.focus + model.now.drift + model.now.neutral;
  const productivity: ProductivityDuration[] = (["focus", "neutral", "drift"] as const).map((key) => ({
    productivity: key, totalSeconds: model.now[key], segments: 0, ratio: tracked > 0 ? model.now[key] / tracked : 0,
  }));
  const goalShare = Math.min(1, model.now.focus / model.goalSeconds);
  const remaining = model.goalSeconds - model.now.focus;
  const qualityReady = model.now.focus >= DEEP_FOCUS_MIN_SECONDS;
  const quality = qualityReady ? model.deepFocusSeconds / model.now.focus : 0;
  const longest = model.pattern.longestFocus;
  const metrics = [
    { key: "goal", name: c.goal, figure: Math.round(goalShare * 100) + "%", sub: remaining > 0 ? c.left(formatDuration(remaining, lang)) : c.done, ratio: goalShare },
    { key: "quality", name: c.quality, figure: qualityReady ? Math.round(quality * 100) + "%" : "\u2014", sub: qualityReady && longest ? c.longest(formatDuration(longest.seconds, lang)) : c.qualityNotYet, ratio: quality },
  ];
  const top = Math.max(model.goalSeconds, ...model.week.map((entry) => entry.focus)) * 1.1;
  const last = model.week.length - 1;
  const pastDays = model.week.slice(0, -1).filter((entry) => entry.focus > 0);
  const weekAverage = pastDays.length > 0 ? pastDays.reduce((sum, entry) => sum + entry.focus, 0) / pastDays.length : 0;
  const primary = card.actions.find((action) => action.kind === "ask");

  return (
    <div className="page hf">
      <div className="pg-head"><h1>{c.welcome}</h1></div>
      <div className="hf-grid">
        <div className="hf-main">
          <section className="hf-block hf-voice" aria-label={card.kicker}>
            <Title text={"Drifty · " + formatClock(card.atMs)} />
            <p className="hf-voice__title">{card.title}</p>
            {card.body ? <p className="hf-voice__body">{card.body}</p> : null}
            <div className="hf-voice__actions">
              {primary && primary.kind === "ask" ? <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={() => onAsk(primary.question)}>{primary.label}</button> : null}
              <AskBox c={c} phase={model.phase} onAsk={onAsk} />
            </div>
          </section>

          <section className="hf-block hf-day" aria-label={c.dayTitle(dayLabel(listDay, lang, c))}>
            <div className="hf-day__top">
              <div className="seg" role="group" aria-label={c.switchLabel}>
                {(["today", "yesterday"] as const).map((key) => (
                  <button key={key} type="button" aria-pressed={day === key} className={day === key ? "on" : undefined} onClick={() => setDay(key)}>{key === "today" ? c.today : c.yesterday}</button>
                ))}
              </div>
              <span className="hf-status"><i className={"productivity-dot " + (live ? "productivity-dot--focus" : "productivity-dot--neutral")} aria-hidden="true" />{live ? c.recording : model.lastRecordMs !== null ? c.lastRecord(formatClock(model.lastRecordMs)) : c.notRecording}</span>
            </div>
            <Title text={c.dayTitle(dayLabel(listDay, lang, c))} />
            <ul className="hf-list">
              {rows.length === 0 ? <li className="hf-list__none">{c.none}</li> : rows.map((session) => (
                <li key={session.kind + session.startMs}>
                  <button type="button" className="hf-row" onClick={onOpenDay}>
                    <span className="hf-row__time"><i className={"productivity-dot productivity-dot--" + session.kind} aria-hidden="true" />{formatClock(session.startMs)}</span>
                    <span className="hf-row__what">
                      {session.item ? <ItemIcon item={session.item} appIcons={appIcons} /> : null}
                      <span className="hf-row__title">{session.item?.label ?? c.drift}</span>
                    </span>
                    <span className="hf-row__dur">{formatDuration(session.seconds, lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {next ? (
            <section className="hf-block hf-next" aria-label={c.next}>
              <C15Medal item={next.item} className="hf-next__medal" />
              <span className="hf-next__text">
                <span className="hf-name">{achievementName(next.item, t)}</span>
                <span className="hf-sub">{achievementCondition(next.item, t)} · {Math.round(next.share * 100)}%</span>
              </span>
              <button type="button" className="app-btn app-btn--secondary app-btn--compact" onClick={onOpenAchievements}>{c.open}</button>
            </section>
          ) : null}
        </div>

        <aside className="hf-block hf-side">
          <div className="hf-side__part hf-ring" onClick={onOpenDay} role="presentation">
            <CompactRingChart title={c.productivity} entries={buildProductivityRingEntries(productivity).map((entry) => ({ ...entry, label: localizedProductivityLabel(entry.key as "focus" | "neutral" | "drift", t) }))} totalSeconds={model.now.focus}
              centerPercent={buildProductivityCenterPercent(productivity)} flowBlocks={[]} appIcons={appIcons} getAppBreakdown={() => []} />
          </div>
          <div className="hf-side__part">
            {metrics.map((metric) => (
              <button key={metric.key} type="button" className="hf-metric" onClick={onOpenDay}>
                <span className="hf-metric__dial"><SmallDonut ratio={metric.ratio} /></span>
                <span className="hf-metric__text"><span className="hf-name">{metric.name}</span><span className="hf-sub">{metric.sub}</span></span>
                <span className="hf-figure">{metric.figure}</span>
              </button>
            ))}
          </div>
          <button type="button" className="hf-side__part hf-week" onClick={onOpenWeek}>
            <Title text={c.week} meta={c.weekMet(model.goalMetDays)} />
            <span className="hf-week__avg"><span className="hf-figure">{formatDuration(weekAverage, lang)}</span><span className="hf-sub">{c.weekAvg}</span></span>
            <span className="wt-plot hf-week__plot">
              <span className="wt-grid hf-week__grid" aria-hidden="true">
                <span className="wt-gridline" style={{ top: (1 - model.goalSeconds / top) * 100 + "%" }}><span className="wt-gridlabel">{formatShortDuration(model.goalSeconds)}</span></span>
              </span>
              <span className="wt-cols">
                {model.week.map((entry, index) => (
                  <span key={entry.day} className={"wt-col" + (index === last ? " hf-week__today" : "")}>
                    <span className="wt-bars-zone">
                      <span className="wt-bar" style={{ height: (entry.focus > 0 ? Math.max(2, (entry.focus / top) * 100) : 0) + "%" }} aria-label={c.weekdaysLong[new Date(entry.day + "T12:00:00").getDay()] + " " + formatDuration(entry.focus, lang)} role="img">
                        <span className="wt-seg hf-week__seg" style={{ height: "100%" }} />
                      </span>
                    </span>
                    <span className="wt-daylabel">{c.weekdays[new Date(entry.day + "T12:00:00").getDay()]}</span>
                  </span>
                ))}
              </span>
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}

