import { useMemo, useState, type FormEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { useLocalization } from "../localization/LocalizationContext";
import { achievementRowParts } from "../achievements/achievementRows";
import { achievementCondition, achievementName } from "../achievements/achievementCopy";
import { isAchievementDesignReview, useAchievementReviewState } from "../achievements/achievementDesignReview";
import { itemsForReviewHolding } from "../achievements/useAchievementsTab";
import type { AchievementItem } from "../achievements/useAchievements";
import { C15Medal } from "../achievements/layouts/c15/C15Medal";
import { medalTint } from "../achievements/layouts/c15/c15Copy";
import { DEEP_FOCUS_MIN_SECONDS, type HomeModel, type HomeSession, type HomeWorkItem } from "./homeModel";
import { formatClock, formatDuration, formatShortDuration, topCard, type HomeLang } from "./homeCards";

/*
 * Home after Wispr Flow's home (owner request 2026-11-26): a welcome title,
 * a dark banner that speaks, a card that switches between today and before,
 * the day's stretches as a dated list, and a stats card on the right whose
 * numbers lead in a serif. Blocks keep the achievements tab's grey fill.
 */

export type FlowVariant = "flow1" | "flow2" | "flow3" | "flow4" | "flow5";
export const FLOW_VARIANTS: readonly FlowVariant[] = ["flow1", "flow2", "flow3", "flow4", "flow5"];

const COPY = {
  ko: {
    welcome: "다시 만나서 반가워요",
    today: "오늘", past: "어제", recording: "기록 중", lastRecord: (t: string) => "마지막 기록 " + t, notRecording: "아직 기록 없음",
    dayList: (d: string) => d + " 한 일", none: "아직 15분 넘게 이어진 일이 없어요", drift: "딴짓",
    focusTime: "집중", productivity: "생산성", goalDays: "일 목표 달성",
    goalLeft: "목표까지", goalLeftBody: (g: string, u: string | null) => "오늘 목표는 " + g + "예요." + (u ? " 평소 이 시각엔 " + u + " 집중했어요." : ""), goalDone: "목표 달성", goalDoneBody: (g: string) => "오늘 " + g + " 목표를 채웠어요.",
    ask: "Drifty에게 묻기", askExample: (q: string) => "예: " + q, send: "보내기", close: "닫기", open: "보기",
    longest: "가장 오래 한 일", next: "다음 업적", earned: "최근 얻은 업적",
    examples: { morning: "어제 정리해 줘", midday: "왜 평소보다 느려?", evening: "오늘 정리해 줘" },
    prodLabel: "생산성", todayTitle: "오늘", todayFocus: "집중", focusSub: (u: string | null, d: string) => u ? "평소 " + u : "딴짓 " + d, goalName: "목표", qualityName: "집중 품질", qualityNotYet: "25분 넘게 집중하면", longestShort: (d: string) => "가장 긴 집중 " + d, leftShort: (d: string) => d + " 남음", doneShort: "달성",
    week: "최근 7일 집중", weekMet: (n: number) => n + "일 목표 달성", weekdays: ["일", "월", "화", "수", "목", "금", "토"],
  },
  en: {
    welcome: "Welcome back",
    today: "Today", past: "Yesterday", recording: "Recording", lastRecord: (t: string) => "Last record " + t, notRecording: "Nothing recorded yet",
    dayList: (d: string) => d, none: "Nothing has held for 15 minutes yet", drift: "Drift",
    focusTime: "focus", productivity: "productive", goalDays: "days at goal",
    goalLeft: "to your goal", goalLeftBody: (g: string, u: string | null) => "Today's goal is " + g + "." + (u ? " A usual day has " + u + " by now." : ""), goalDone: "Goal met", goalDoneBody: (g: string) => "You reached today's " + g + ".",
    ask: "Ask Drifty", askExample: (q: string) => "e.g. " + q, send: "Send", close: "Close", open: "Open",
    longest: "Longest today", next: "Next achievement", earned: "Recently earned",
    examples: { morning: "Recap yesterday", midday: "Why am I behind usual?", evening: "Wrap up today" },
    prodLabel: "Productivity", todayTitle: "Today", todayFocus: "Focus", focusSub: (u: string | null, d: string) => u ? "Usually " + u : d + " drift", goalName: "Goal", qualityName: "Focus quality", qualityNotYet: "After 25 min of focus", longestShort: (d: string) => "Longest " + d, leftShort: (d: string) => d + " to go", doneShort: "Met",
    week: "Focus, last 7 days", weekMet: (n: number) => "Goal met " + n + (n === 1 ? " day" : " days"), weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },
};
type Copy = (typeof COPY)["ko"];
const WEEKDAY_LONG = { ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"], en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] };
const LIVE_MS = 10 * 60_000;

function dayLabel(day: string, lang: HomeLang): string {
  const date = new Date(day + "T12:00:00");
  return lang === "ko" ? (date.getMonth() + 1) + "월 " + date.getDate() + "일 " + WEEKDAY_LONG.ko[date.getDay()]
    : date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function ItemIcon({ item, appIcons, size = 20 }: { readonly item: HomeWorkItem; readonly appIcons: AppIconMap; readonly size?: number }) {
  const icon = appIcons[item.bundleId ?? item.appName] ?? appIcons[item.appName] ?? null;
  return item.siteDomain
    ? <SiteFavicon domain={item.siteDomain} size={size} fallbackIconSrc={icon} />
    : <AppGlyph appName={item.appName} iconSrc={icon} size={size > 28 ? "lg" : "sm"} />;
}

function useAchievementRows(items: readonly AchievementItem[]) {
  const review = isAchievementDesignReview();
  const { holding } = useAchievementReviewState();
  return useMemo(() => {
    const shown = review ? itemsForReviewHolding(items, holding) : items;
    const parts = achievementRowParts(shown, { almost: 1, earned: "recent" });
    return { next: parts.almost[0] ?? null, earned: parts.earned[0] ?? null };
  }, [review, items, holding]);
}

/** The dark banner: Drifty's sentence in a serif, one way to act, the day's focus hours drawn faintly on the right. */
function Banner({ model, lang, c, onAsk, onClose }: { readonly model: HomeModel; readonly lang: HomeLang; readonly c: Copy; readonly onAsk: (q: string) => void; readonly onClose: () => void }) {
  const card = topCard(model, lang);
  // Today's hours up to now, from the first hour with records; before any, yesterday's shape is not drawn.
  const upToNow = model.hours.filter((hour) => hour.startMs <= model.asOfMs);
  const first = upToNow.findIndex((hour) => hour.focus + hour.drift + hour.neutral > 0);
  const hours = first < 0 ? [] : upToNow.slice(first);
  const peak = Math.max(1800, ...hours.map((hour) => hour.focus));
  const ask = card.actions.find((action) => action.kind === "ask");
  return (
    <section className="wf-banner" aria-label={card.kicker}>
      <div className="wf-banner__art" aria-hidden="true">
        {hours.map((hour) => <i key={hour.startMs} style={{ height: (hour.focus / peak) * 82 + "%" }} />)}
      </div>
      <div className="wf-banner__text">
        <p className="wf-banner__title">{card.title}</p>
        {card.body ? <p className="wf-banner__body">{card.body}</p> : null}
      </div>
      <button type="button" className="wf-banner__go" onClick={() => onAsk(ask && ask.kind === "ask" ? ask.question : c.examples[model.phase])}>{ask?.label ?? c.ask}</button>
      <button type="button" className="wf-banner__close" onClick={onClose} aria-label={c.close}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </section>
  );
}

/** Drifty's message in a grey block, for the plans without a banner. */
function VoiceBlock({ model, lang, onAsk }: { readonly model: HomeModel; readonly lang: HomeLang; readonly onAsk: (q: string) => void }) {
  const card = topCard(model, lang);
  return (
    <section className="wf-block wf-voice" aria-label={card.kicker}>
      <p className="wf-voice__who">Drifty · {formatClock(card.atMs)}</p>
      <p className="wf-voice__title">{card.title}</p>
      {card.body ? <p className="wf-voice__body">{card.body}</p> : null}
      <div className="wf-chips">
        {card.actions.filter((action) => action.kind === "ask").map((action) => (
          <button key={action.id} type="button" className="app-btn app-btn--secondary wf-chip" onClick={() => action.kind === "ask" && onAsk(action.question)}>{action.label}</button>
        ))}
      </div>
    </section>
  );
}

function RecordStatus({ model, c }: { readonly model: HomeModel; readonly c: Copy }) {
  const live = model.lastRecordMs !== null && model.asOfMs - model.lastRecordMs <= LIVE_MS;
  return (
    <span className={"wf-rec" + (live ? " is-live" : "")}>
      <i aria-hidden="true" />{live ? c.recording : model.lastRecordMs !== null ? c.lastRecord(formatClock(model.lastRecordMs)) : c.notRecording}
    </span>
  );
}

/** The card with the today / yesterday switch, the recording status, and one step to take. */
function SwitchCard({ model, c, tab, onTab, achievements, onOpenAchievements }: {
  readonly model: HomeModel; readonly c: Copy; readonly tab: "today" | "past"; readonly onTab: (tab: "today" | "past") => void;
  readonly achievements: readonly AchievementItem[]; readonly onOpenAchievements: () => void;
}) {
  const { t } = useLocalization();
  const { next, earned } = useAchievementRows(achievements);
  const item = tab === "today" ? next?.item ?? earned : earned;
  const share = tab === "today" && next ? next.share : null;
  return (
    <section className="wf-block wf-switch">
      <div className="wf-switch__top">
        <div className="wf-seg" role="tablist">
          {(["today", "past"] as const).map((key) => (
            <button key={key} type="button" role="tab" aria-selected={tab === key} className={"wf-seg__opt" + (tab === key ? " is-on" : "")} onClick={() => onTab(key)}>{key === "today" ? c.today : c.past}</button>
          ))}
        </div>
        <RecordStatus model={model} c={c} />
      </div>
      {item ? (
        <div className="wf-step">
          <span className="wf-step__mark"><C15Medal item={item} className="wf-step__medal" /></span>
          <span className="wf-step__text">
            <span className="wf-step__name">{achievementName(item, t)}{share !== null ? <em>{Math.round(share * 100)}%</em> : null}</span>
            <span className="wf-step__sub">{achievementCondition(item, t)}</span>
          </span>
          <button type="button" className="app-btn app-btn--primary" onClick={onOpenAchievements}>{c.open}</button>
        </div>
      ) : null}
    </section>
  );
}

/** One day's stretches as a dated list: time, what, how long. */
function DayList({ day, sessions, lang, c, appIcons, onOpen, limit }: {
  readonly day: string; readonly sessions: readonly HomeSession[]; readonly lang: HomeLang; readonly c: Copy; readonly appIcons: AppIconMap; readonly onOpen: () => void; readonly limit: number;
}) {
  const rows = [...sessions].reverse().slice(0, limit);
  return (
    <section className="wf-day" aria-label={c.dayList(dayLabel(day, lang))}>
      <div className="wf-day__head">
        <h2>{c.dayList(dayLabel(day, lang))}</h2>
        <button type="button" className="wf-icon" onClick={onOpen} aria-label={c.open}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </button>
      </div>
      <div className="wf-block wf-list">
        {rows.length === 0 ? <p className="wf-list__none">{c.none}</p> : rows.map((session) => (
          <button key={session.kind + session.startMs} type="button" className={"wf-row is-" + session.kind} onClick={onOpen}>
            <span className="wf-row__time">{formatClock(session.startMs)}</span>
            <span className="wf-row__what">
              {session.item ? <ItemIcon item={session.item} appIcons={appIcons} /> : <i className="wf-row__dot" />}
              <span className="wf-row__title">{session.item?.label ?? (session.kind === "drift" ? c.drift : "")}</span>
              {session.kind === "drift" ? <span className="wf-row__tag">{c.drift}</span> : null}
            </span>
            <span className="wf-row__dur">{formatDuration(session.seconds, lang)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function AskBox({ c, phase, onAsk }: { readonly c: Copy; readonly phase: HomeModel["phase"]; readonly onAsk: (q: string) => void }) {
  const [text, setText] = useState("");
  const example = c.examples[phase];
  const submit = (event: FormEvent) => { event.preventDefault(); onAsk(text.trim() || example); setText(""); };
  return (
    <form className="wf-ask" onSubmit={submit}>
      <input type="text" value={text} onChange={(event) => setText(event.target.value)} placeholder={c.ask + " · " + c.askExample(example)} aria-label={c.ask} />
      <button type="submit" aria-label={c.send}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg></button>
    </form>
  );
}

type RingSegment = { readonly ratio: number; readonly tone: "focus" | "drift" | "neutral" };
/** The focus donut, drawn as the Your Day donut is: focus, drift and neutral around one track. */
function FocusRing({ segments, width }: { readonly segments: readonly RingSegment[]; readonly width: number }) {
  const r = 50 - width / 2 - 1;
  const C = 2 * Math.PI * r;
  const shown = segments.filter((segment) => segment.ratio > 0.004);
  const gap = shown.length > 1 ? 0.014 : 0;
  let start = 0;
  return (
    <svg className="wf-ring" viewBox="0 0 100 100" aria-hidden="true">
      <g transform="rotate(-90 50 50)">
        <circle className="wf-ring__track" cx="50" cy="50" r={r} strokeWidth={width} />
        {shown.map((segment) => {
          const arc = <circle key={segment.tone} className={"wf-ring__arc is-" + segment.tone} cx="50" cy="50" r={r} strokeWidth={width} strokeDasharray={Math.max(0, Math.min(1, segment.ratio) - gap) * C + " " + C} strokeDashoffset={-start * C} />;
          start += Math.min(1, segment.ratio);
          return arc;
        })}
      </g>
    </svg>
  );
}

/** Today's three figures: the focus donut leads with productivity; goal and focus quality follow as rows with small rings. */
function RingPart({ model, lang, c, onOpen }: { readonly model: HomeModel; readonly lang: HomeLang; readonly c: Copy; readonly onOpen: () => void }) {
  const tracked = Math.max(1, model.now.tracked);
  const has = model.now.tracked > 0;
  const goalShare = Math.min(1, model.now.focus / model.goalSeconds);
  const remaining = model.goalSeconds - model.now.focus;
  const qualityReady = model.now.focus >= DEEP_FOCUS_MIN_SECONDS;
  const quality = qualityReady ? model.deepFocusSeconds / model.now.focus : 0;
  const longest = model.pattern.longestFocus;
  const rows = [
    { key: "goal", name: c.goalName, value: String(Math.round(goalShare * 100)), unit: "%", sub: remaining > 0 ? c.leftShort(formatDuration(remaining, lang)) : c.doneShort, ratio: goalShare },
    { key: "quality", name: c.qualityName, value: qualityReady ? String(Math.round(quality * 100)) : "\u2014", unit: qualityReady ? "%" : "", sub: qualityReady && longest ? c.longestShort(formatDuration(longest.seconds, lang)) : c.qualityNotYet, ratio: quality },
  ];
  return (
    <div className="wf-stats__part wf-ringpart">
      <span className="wf-parthead"><span className="wf-parthead__title">{c.todayTitle}</span></span>
      <button type="button" className="wf-ringpart__hero" onClick={onOpen}>
        <span className="wf-ringpart__dial">
          <FocusRing width={9} segments={[{ ratio: model.now.focus / tracked, tone: "focus" }, { ratio: model.now.drift / tracked, tone: "drift" }, { ratio: model.now.neutral / tracked, tone: "neutral" }]} />
          <span className="wf-ringpart__pct"><b>{has ? Math.round((model.now.focus / tracked) * 100) : "\u2014"}{has ? <small>%</small> : null}</b><em>{c.prodLabel}</em></span>
        </span>
        <span className="wf-ringpart__lead">
          <span className="wf-small">{c.todayFocus}</span>
          <b>{model.now.focus < 60 ? "\u2014" : formatDuration(model.now.focus, lang)}</b>
          <span className="wf-small">{c.focusSub(model.baseline.days > 0 && model.baseline.focus > 0 ? formatDuration(model.baseline.focus, lang) : null, formatDuration(model.now.drift, lang))}</span>
        </span>
      </button>
      <div className="wf-ringpart__rows">
        {rows.map((row) => (
          <button key={row.key} type="button" className="wf-ringrow" onClick={onOpen}>
            <span className="wf-ringrow__dial"><FocusRing width={14} segments={[{ ratio: row.ratio, tone: "focus" }]} /></span>
            <span className="wf-ringrow__text"><span className="wf-ringrow__name">{row.name}</span><span className="wf-small">{row.sub}</span></span>
            <span className="wf-ringrow__value">{row.value}{row.unit ? <small>{row.unit}</small> : null}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The last 7 days, small: past days grey, today olive, one dashed goal line, weekday under each bar. */
function WeekPart({ model, c, onOpen }: { readonly model: HomeModel; readonly c: Copy; readonly onOpen: () => void }) {
  const top = Math.max(model.goalSeconds, ...model.week.map((day) => day.focus)) * 1.1;
  const last = model.week.length - 1;
  return (
    <button type="button" className="wf-stats__part wf-weekpart" onClick={onOpen}>
      <span className="wf-parthead"><span className="wf-parthead__title">{c.week}</span><span className="wf-parthead__meta">{c.weekMet(model.goalMetDays)}</span></span>
      <span className="wf-weekpart__plot" aria-hidden="true">
        <i className="wf-weekpart__goal" style={{ bottom: (model.goalSeconds / top) * 100 + "%" }} />
        {model.week.map((day, index) => (
          <span key={day.day} className={"wf-weekpart__col" + (index === last ? " is-today" : "")}>
            {index === last && day.focus >= 60 ? <em style={{ bottom: "calc(" + (day.focus / top) * 100 + "% + 3px)" }}>{formatShortDuration(day.focus)}</em> : null}
            <i style={{ height: (day.focus > 0 ? Math.max(3, (day.focus / top) * 100) : 0) + "%" }} />
          </span>
        ))}
      </span>
      <span className="wf-weekpart__days" aria-hidden="true">
        {model.week.map((day, index) => <span key={day.day} className={index === last ? "is-today" : undefined}>{c.weekdays[new Date(day.day + "T12:00:00").getDay()]}</span>)}
      </span>
    </button>
  );
}

/** The stats card on the right, in parts split by hairlines, as Flow's is. */
function StatsCard({ model, lang, c, appIcons, achievements, parts, onOpenDay, onOpenWeek, onOpenAchievements, onAsk }: {
  readonly model: HomeModel; readonly lang: HomeLang; readonly c: Copy; readonly appIcons: AppIconMap; readonly achievements: readonly AchievementItem[];
  readonly parts: readonly ("stats" | "goal" | "longest" | "next" | "ask" | "ring" | "week")[];
  readonly onOpenDay: () => void; readonly onOpenWeek: () => void; readonly onOpenAchievements: () => void; readonly onAsk: (q: string) => void;
}) {
  const { t } = useLocalization();
  const { next } = useAchievementRows(achievements);
  const tracked = model.now.tracked;
  const hours = Math.floor(model.now.focus / 3600);
  const minutes = Math.floor((model.now.focus % 3600) / 60);
  const remaining = model.goalSeconds - model.now.focus;
  const longest = model.topFocusItems[0] ?? null;
  const usual = model.baseline.days > 0 && model.baseline.focus > 0 ? formatDuration(model.baseline.focus, lang) : null;
  return (
    <aside className="wf-block wf-stats">
      {parts.map((part) => {
        if (part === "ring") return <RingPart key={part} model={model} lang={lang} c={c} onOpen={onOpenDay} />;
        if (part === "week") return <WeekPart key={part} model={model} c={c} onOpen={onOpenWeek} />;
        if (part === "stats") return (
          <button key={part} type="button" className="wf-stats__part wf-nums" onClick={onOpenDay}>
            <span><b>{model.now.focus < 60 ? "\u2014" : <>{hours > 0 ? <>{hours}<small>{lang === "ko" ? "시간 " : "h "}</small></> : null}{minutes}<small>{lang === "ko" ? "분" : "m"}</small></>}</b> {c.focusTime}</span>
            <span><b>{tracked > 0 ? Math.round((model.now.focus / tracked) * 100) : "\u2014"}<small>{tracked > 0 ? "%" : ""}</small></b> {c.productivity}</span>
            <span><b>{model.goalMetDays}</b> {c.goalDays}</span>
          </button>
        );
        if (part === "goal") return (
          <div key={part} className="wf-stats__part wf-goal">
            {remaining > 0
              ? <p className="wf-goal__head"><b>{formatDuration(remaining, lang)}</b> {c.goalLeft}</p>
              : <p className="wf-goal__head"><b>{c.goalDone}</b></p>}
            <p className="wf-goal__body">{remaining > 0 ? c.goalLeftBody(formatDuration(model.goalSeconds, lang), usual) : c.goalDoneBody(formatDuration(model.goalSeconds, lang))}</p>
            <span className="wf-goal__bar" aria-hidden="true"><i style={{ width: Math.min(100, (model.now.focus / model.goalSeconds) * 100) + "%" }} /></span>
          </div>
        );
        if (part === "longest") return longest ? (
          <button key={part} type="button" className="wf-stats__part wf-longest" onClick={onOpenDay}>
            <span className="wf-longest__text"><span className="wf-small">{c.longest}</span><span className="wf-longest__name">{longest.label}</span><span className="wf-small">{longest.source} · {formatDuration(longest.seconds, lang)}</span></span>
            <span className="wf-longest__icon"><ItemIcon item={longest} appIcons={appIcons} size={44} /></span>
          </button>
        ) : null;
        if (part === "next") return next ? (
          <button key={part} type="button" className="wf-stats__part wf-next" onClick={onOpenAchievements}>
            <span className="wf-small">{c.next}</span>
            <span className="wf-next__row"><C15Medal item={next.item} className="wf-next__medal" /><span className="wf-next__text"><span className="wf-longest__name">{achievementName(next.item, t)}</span><span className="wf-small">{achievementCondition(next.item, t)}</span></span></span>
            <span className="wf-next__bar" aria-hidden="true" style={medalTint(next.item.definition.id)}><i style={{ width: Math.round(next.share * 100) + "%" }} /></span>
          </button>
        ) : null;
        return <div key={part} className="wf-stats__part"><AskBox c={c} phase={model.phase} onAsk={onAsk} /></div>;
      })}
    </aside>
  );
}

export function FlowHome({ variant, model, lang, appIcons, achievements, onOpenDay, onOpenWeek, onOpenAchievements, onAsk }: {
  readonly variant: FlowVariant; readonly model: HomeModel; readonly lang: HomeLang; readonly appIcons: AppIconMap; readonly achievements: readonly AchievementItem[];
  readonly onOpenDay: () => void; readonly onOpenWeek: () => void; readonly onOpenAchievements: () => void; readonly onAsk: (q: string) => void;
}) {
  const c = COPY[lang];
  // Before today has a stretch, the list opens on yesterday, as Flow opens on its latest day.
  const [tab, setTab] = useState<"today" | "past">(() => (model.sessions.length === 0 && (model.yesterday?.sessions.length ?? 0) > 0 ? "past" : "today"));
  const [bannerOpen, setBannerOpen] = useState(true);
  const banner = variant !== "flow2" && bannerOpen;
  const yesterday = model.yesterday;
  const list = tab === "today"
    ? <DayList day={model.today} sessions={model.sessions} lang={lang} c={c} appIcons={appIcons} onOpen={onOpenDay} limit={6} />
    : yesterday ? <DayList day={yesterday.day} sessions={yesterday.sessions} lang={lang} c={c} appIcons={appIcons} onOpen={onOpenDay} limit={6} /> : null;
  const parts = variant === "flow2" ? (["stats", "goal", "longest"] as const)
    : variant === "flow3" ? (["stats", "next", "ask"] as const)
    : variant === "flow5" ? (["ring", "week"] as const)
    : (["stats", "goal", "longest"] as const);
  return (
    <div className={"page wf wf--" + variant}>
      <div className="pg-head wf-pagehead"><h1>{c.welcome}</h1></div>
      <div className="wf-grid">
        <div className="wf-main">
          {banner ? <Banner model={model} lang={lang} c={c} onAsk={onAsk} onClose={() => setBannerOpen(false)} /> : null}
          {variant === "flow2" ? <VoiceBlock model={model} lang={lang} onAsk={onAsk} /> : null}
          {variant === "flow3" ? null : <SwitchCard model={model} c={c} tab={tab} onTab={setTab} achievements={achievements} onOpenAchievements={onOpenAchievements} />}
          {variant === "flow3" ? (
            <div className="wf-seg wf-seg--bare" role="tablist">
              {(["today", "past"] as const).map((key) => (
                <button key={key} type="button" role="tab" aria-selected={tab === key} className={"wf-seg__opt" + (tab === key ? " is-on" : "")} onClick={() => setTab(key)}>{key === "today" ? c.today : c.past}</button>
              ))}
              <RecordStatus model={model} c={c} />
            </div>
          ) : null}
          {list}
        </div>
        <StatsCard model={model} lang={lang} c={c} appIcons={appIcons} achievements={achievements} parts={parts} onOpenDay={onOpenDay} onOpenWeek={onOpenWeek} onOpenAchievements={onOpenAchievements} onAsk={onAsk} />
      </div>
    </div>
  );
}

