import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { logicalDayEndExclusiveMs, logicalDayStartMs, shiftIsoDate, type ActivitySegment, type AppIconMap, type ClassificationOptions } from "@drifty/domain";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { mergeActivitySegments } from "../../lib/activitySegments";
import type { CompactHistoryLoad, CompactHistoryRange } from "../dashboard/compactHistoryCache";
import { useLocalization } from "../localization/LocalizationContext";
import { achievementRowParts } from "../achievements/achievementRows";
import { achievementCondition, achievementName } from "../achievements/achievementCopy";
import type { AchievementItem } from "../achievements/useAchievements";
import { C15Medal } from "../achievements/layouts/c15/C15Medal";
import { medalTint } from "../achievements/layouts/c15/c15Copy";
import { isAchievementDesignReview, useAchievementReviewState } from "../achievements/achievementDesignReview";
import { itemsForReviewHolding } from "../achievements/useAchievementsTab";
import { BASELINE_WEEKS, DEEP_FOCUS_MIN_SECONDS, buildHomeModel, type HomeHour, type HomeModel } from "./homeModel";
import { formatClock, formatDuration, formatShortDuration, topCard, type HomeCard, type HomeLang } from "./homeCards";
import "./home-v2.css";

/*
 * Home, second start (owner request 2026-11-26): rebuilt to read as one
 * family with Insights › Achievements. Blocks are the achievement cards'
 * faint grey fill with no border, the shared 12px corner, 12px gaps and the
 * 15px inset; block titles use the shared 12px soft head. Dev-server preview
 * only (?homePreview=1).
 */

const COPY = {
  ko: {
    nav: "홈",
    greet: { morning: "좋은 아침이에요", midday: "좋은 오후예요", evening: "수고했어요" },
    today: "오늘", productivity: "생산성", goal: "목표", quality: "집중 품질",
    focusOf: (d: string) => "집중 " + d, left: (d: string) => d + " 남음", goalDone: "목표 달성", longest: (d: string) => "가장 긴 집중 " + d, qualityNotYet: "25분 넘게 집중하면 보여요",
    hours: "오늘 시간대별", hoursYesterday: "어제 시간대별", usual: (w: string) => "평소 " + w,
    week: "최근 7일 집중", weekMeta: (g: string, n: number) => "목표 " + g + " · " + n + "일 달성",
    next: "다음 업적", recent: "최근 얻은 업적", percent: (p: number) => p + "%",
    ask: "Drifty에게 묻기", askExample: (q: string) => "Drifty에게 묻기 · 예: " + q, send: "보내기",
    open: "자세히 보기", loading: "기록을 불러오는 중이에요", failed: "기록을 불러오지 못했어요",
    examples: { morning: "어제 정리해 줘", midday: "왜 평소보다 느려?", evening: "오늘 정리해 줘" },
  },
  en: {
    nav: "Home",
    greet: { morning: "Good morning", midday: "Good afternoon", evening: "Nice work today" },
    today: "Today", productivity: "Productivity", goal: "Goal", quality: "Focus quality",
    focusOf: (d: string) => d + " focus", left: (d: string) => d + " to go", goalDone: "Goal met", longest: (d: string) => "Longest " + d, qualityNotYet: "Shows after 25 minutes of focus",
    hours: "Today by hour", hoursYesterday: "Yesterday by hour", usual: (w: string) => "Usual " + w,
    week: "Focus, last 7 days", weekMeta: (g: string, n: number) => "Goal " + g + " · met " + n + (n === 1 ? " day" : " days"),
    next: "Next achievements", recent: "Recently earned", percent: (p: number) => p + "%",
    ask: "Ask Drifty", askExample: (q: string) => "Ask Drifty · e.g. " + q, send: "Send",
    open: "Open", loading: "Loading your records", failed: "Couldn't load your records",
    examples: { morning: "Recap yesterday", midday: "Why am I behind usual?", evening: "Wrap up today" },
  },
};
type Copy = (typeof COPY)["ko"];

const WEEKDAY_SHORT = { ko: ["일", "월", "화", "수", "목", "금", "토"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
const WEEKDAY_LONG = { ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"], en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] };
const weekdayOf = (day: string, lang: HomeLang) => WEEKDAY_LONG[lang][new Date(day + "T12:00:00").getDay()];

export type HomeVariant = "rows" | "rings" | "two";
const VARIANTS: readonly HomeVariant[] = ["rows", "rings", "two"];

function previewParams(): { readonly variant: HomeVariant; readonly clock: string | null } {
  if (typeof window === "undefined") return { variant: "rows", clock: null };
  const params = new URLSearchParams(window.location.search);
  const variant = params.get("homeV2") as HomeVariant | null;
  const clock = params.get("homeAt");
  return { variant: variant && VARIANTS.includes(variant) ? variant : "rows", clock: clock && /^\d{1,2}:\d{2}$/.test(clock) ? clock : null };
}

function asOfFor(clock: string | null, today: string, startOfDayMinutes: number, nowMs: number): number {
  if (!clock) return nowMs;
  const [hours, minutes] = clock.split(":").map(Number);
  const [year, month, date] = today.split("-").map(Number);
  let at = new Date(year, month - 1, date, hours, minutes, 0, 0).getTime();
  if (at < logicalDayStartMs(today, startOfDayMinutes)) at += 24 * 60 * 60 * 1000;
  return at;
}

function dateLine(day: string, lang: HomeLang, asOfMs: number): string {
  const date = new Date(day + "T12:00:00");
  const label = lang === "ko"
    ? (date.getMonth() + 1) + "월 " + date.getDate() + "일 " + WEEKDAY_LONG.ko[date.getDay()]
    : date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  return label + " · " + formatClock(asOfMs);
}

function Chevron() {
  return <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

/** A block's head: the shared 12px soft title, an optional note on the right, an optional way in. */
function Head({ title, meta, onOpen, label }: { readonly title: string; readonly meta?: ReactNode; readonly onOpen?: () => void; readonly label?: string }) {
  return (
    <div className="hv-head">
      <h2 className="hv-title">{title}</h2>
      {meta ? <span className="hv-meta">{meta}</span> : null}
      {onOpen ? <button type="button" className="hv-open" onClick={onOpen} aria-label={label ?? title} title={label ?? title}><Chevron /></button> : null}
    </div>
  );
}

type Segment = { readonly ratio: number; readonly tone: "focus" | "drift" | "neutral" };
type Metric = { readonly key: string; readonly label: string; readonly value: string; readonly unit: string | null; readonly sub: string; readonly segments: readonly Segment[] };

function metrics(model: HomeModel, c: Copy, lang: HomeLang): readonly Metric[] {
  const tracked = Math.max(1, model.now.tracked);
  const has = model.now.tracked > 0;
  const goalShare = Math.min(1, model.now.focus / model.goalSeconds);
  const qualityReady = model.now.focus >= DEEP_FOCUS_MIN_SECONDS;
  const quality = qualityReady ? model.deepFocusSeconds / model.now.focus : 0;
  const remaining = model.goalSeconds - model.now.focus;
  const longest = model.pattern.longestFocus;
  return [
    { key: "productivity", label: c.productivity, value: has ? String(Math.round((model.now.focus / tracked) * 100)) : "\u2014", unit: has ? "%" : null,
      sub: c.focusOf(formatDuration(model.now.focus, lang)),
      segments: [{ ratio: model.now.focus / tracked, tone: "focus" }, { ratio: model.now.drift / tracked, tone: "drift" }, { ratio: model.now.neutral / tracked, tone: "neutral" }] },
    { key: "goal", label: c.goal, value: String(Math.round(goalShare * 100)), unit: "%", sub: remaining > 0 ? c.left(formatDuration(remaining, lang)) : c.goalDone,
      segments: [{ ratio: goalShare, tone: "focus" }] },
    { key: "quality", label: c.quality, value: qualityReady ? String(Math.round(quality * 100)) : "\u2014", unit: qualityReady ? "%" : null,
      sub: qualityReady && longest ? c.longest(formatDuration(longest.seconds, lang)) : c.qualityNotYet, segments: [{ ratio: quality, tone: "focus" }] },
  ];
}

function Ring({ segments, width }: { readonly segments: readonly Segment[]; readonly width: number }) {
  const r = 50 - width / 2 - 1;
  const C = 2 * Math.PI * r;
  const shown = segments.filter((segment) => segment.ratio > 0.004);
  const gap = shown.length > 1 ? 0.012 : 0;
  let start = 0;
  return (
    <svg className="hv-ring" viewBox="0 0 100 100" aria-hidden="true">
      <g transform="rotate(-90 50 50)">
        <circle className="hv-ring__track" cx="50" cy="50" r={r} strokeWidth={width} />
        {shown.map((segment) => {
          const length = Math.max(0, Math.min(1, segment.ratio) - gap) * C;
          const arc = <circle key={segment.tone} className={"hv-ring__arc is-" + segment.tone} cx="50" cy="50" r={r} strokeWidth={width} strokeDasharray={length + " " + C} strokeDashoffset={-start * C} />;
          start += Math.min(1, segment.ratio);
          return arc;
        })}
      </g>
    </svg>
  );
}

/** Today as rows, the way an achievement reads: the mark, name over one line, the figure on the right. */
function TodayRows({ items, onOpen }: { readonly items: readonly Metric[]; readonly onOpen: () => void }) {
  return (
    <ul className="hv-today">
      {items.map((m) => (
        <li key={m.key}>
          <button type="button" className="hv-today__row" onClick={onOpen} aria-label={m.label + " " + m.value + (m.unit ?? "") + ", " + m.sub}>
            <span className="hv-today__mark"><Ring segments={m.segments} width={13} /></span>
            <span className="hv-today__text"><span className="hv-today__name">{m.label}</span><span className="hv-today__sub">{m.sub}</span></span>
            <span className="hv-figure">{m.value}{m.unit ? <small>{m.unit}</small> : null}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Today as three rings side by side, the figure inside each. */
function TodayRings({ items, onOpen }: { readonly items: readonly Metric[]; readonly onOpen: () => void }) {
  return (
    <div className="hv-rings">
      {items.map((m) => (
        <button key={m.key} type="button" className="hv-rings__item" onClick={onOpen} aria-label={m.label + " " + m.value + (m.unit ?? "") + ", " + m.sub}>
          <span className="hv-rings__dial"><Ring segments={m.segments} width={8} /><span className="hv-figure">{m.value}{m.unit ? <small>{m.unit}</small> : null}</span></span>
          <span className="hv-today__name">{m.label}</span>
          <span className="hv-today__sub">{m.sub}</span>
        </button>
      ))}
    </div>
  );
}

function Voice({ card, c, phase, past, onAsk }: { readonly card: HomeCard; readonly c: Copy; readonly phase: HomeModel["phase"]; readonly past: boolean; readonly onAsk: (question: string) => void }) {
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const example = c.examples[phase];
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAsk(text.trim() || example);
    setText("");
  };
  const reply = card.actions.find((action) => action.id === chosen);
  return (
    <section className="hv-block hv-voice" aria-label={card.kicker}>
      <Head title={"Drifty · " + formatClock(card.atMs)} />
      <p className="hv-voice__title">{card.title}</p>
      {card.body ? <p className="hv-voice__body">{card.body}</p> : null}
      {reply && reply.kind === "ack" ? <p className="hv-voice__reply" role="status">{reply.reply}</p> : past ? null : (
        <div className="hv-chips">
          {card.actions.filter((action) => action.kind !== "open-day").map((action) => (
            <button key={action.id} type="button" className="hv-chip" onClick={() => (action.kind === "ask" ? onAsk(action.question) : setChosen(action.id))}>{action.label}</button>
          ))}
        </div>
      )}
      <form className="hv-ask" onSubmit={submit}>
        <input type="text" value={text} onChange={(event) => setText(event.target.value)} placeholder={c.askExample(example)} aria-label={c.ask} />
        <button type="submit" aria-label={c.send}><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg></button>
      </form>
    </section>
  );
}

type Bin = { readonly clock: number; focus: number; drift: number; readonly usual: number | null; readonly now: boolean };

/** Today hour by hour up to now (yesterday before today has records); the usual hour as a tick of the bar's width. */
function Hours({ model, c, lang, onOpen }: { readonly model: HomeModel; readonly c: Copy; readonly lang: HomeLang; readonly onOpen: () => void }) {
  const clockOf = (ms: number) => new Date(ms).getHours();
  const dayHours = model.hours.filter((hour: HomeHour) => hour.startMs < model.hours[0].startMs + 24 * 3_600_000);
  const todayHas = dayHours.some((hour) => hour.focus + hour.drift > 0);
  const yesterday = !todayHas ? model.yesterday?.sessions ?? [] : [];
  const fromYesterday = yesterday.length > 0;
  const bins: Bin[] = fromYesterday
    ? Array.from({ length: 24 }, (_, clock) => ({ clock, focus: 0, drift: 0, usual: null, now: false }))
    : dayHours.map((hour) => ({ clock: clockOf(hour.startMs), focus: hour.focus, drift: hour.drift,
        usual: model.asOfMs >= hour.startMs ? hour.usualFocus : null, now: model.asOfMs >= hour.startMs && model.asOfMs < hour.startMs + 3_600_000 }));
  for (const session of yesterday) {
    for (let at = session.startMs; at < session.endMs;) {
      const until = Math.min((Math.floor(at / 3_600_000) + 1) * 3_600_000, session.endMs);
      const bin = bins[clockOf(at)];
      if (bin) bin[session.kind] += (until - at) / 1000;
      at = until;
    }
  }
  const active = bins.filter((bin) => bin.focus + bin.drift > 0 || (bin.usual ?? 0) >= 600).map((bin) => bin.clock);
  const nowClock = bins.find((bin) => bin.now)?.clock;
  const lo = Math.min(9, ...active);
  const hi = nowClock ?? Math.max(lo + 7, ...active);
  const shown = bins.filter((bin) => bin.clock >= lo && bin.clock <= hi).sort((a, b) => a.clock - b.clock);
  const peak = Math.max(3600, ...shown.map((bin) => Math.max(bin.focus + bin.drift, bin.usual ?? 0)));
  const title = fromYesterday ? c.hoursYesterday : c.hours;
  return (
    <section className="hv-block hv-chart" aria-label={title}>
      <Head title={title} meta={fromYesterday ? undefined : <span className="hv-key"><i />{c.usual(weekdayOf(model.today, lang))}</span>} onOpen={onOpen} label={c.open} />
      <div className="hv-bars" style={{ gridTemplateColumns: "repeat(" + shown.length + ", minmax(0, 1fr))" }}>
        {shown.map((bin) => {
          const total = bin.focus + bin.drift;
          return (
            <div key={bin.clock} className={"hv-bars__col" + (bin.now ? " is-now" : "") + (fromYesterday ? " is-past" : "")}>
              <div className="hv-bars__zone">
                {total > 0 ? (
                  <span className="hv-bars__bar" style={{ height: Math.max(2, (total / peak) * 100) + "%" }} role="img" aria-label={bin.clock + " " + formatDuration(bin.focus, lang)}>
                    {bin.drift > 0 ? <i className="is-drift" style={{ flexGrow: bin.drift }} /> : null}
                    {bin.focus > 0 ? <i className="is-focus" style={{ flexGrow: bin.focus }} /> : null}
                  </span>
                ) : null}
                {bin.usual !== null && bin.usual >= 60 ? <i className="hv-bars__usual" style={{ bottom: (bin.usual / peak) * 100 + "%" }} aria-hidden="true" /> : null}
              </div>
              <span className="hv-bars__label">{bin.clock % 3 === 0 || bin.now ? bin.clock : ""}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Week({ model, c, lang, onOpen }: { readonly model: HomeModel; readonly c: Copy; readonly lang: HomeLang; readonly onOpen: () => void }) {
  const top = Math.max(model.goalSeconds, ...model.week.map((day) => day.focus)) * 1.12;
  const last = model.week.length - 1;
  return (
    <section className="hv-block hv-chart" aria-label={c.week}>
      <Head title={c.week} meta={c.weekMeta(formatDuration(model.goalSeconds, lang), model.goalMetDays)} onOpen={onOpen} label={c.open} />
      <div className="hv-bars hv-bars--week" style={{ gridTemplateColumns: "repeat(" + model.week.length + ", minmax(0, 1fr))" }}>
        <i className="hv-goal" style={{ bottom: "calc(var(--hv-label-h) + (100% - var(--hv-label-h)) * " + (model.goalSeconds / top).toFixed(4) + ")" }} aria-hidden="true" />
        {model.week.map((day, index) => {
          const height = day.focus > 0 ? Math.max(2, (day.focus / top) * 100) : 0;
          return (
            <div key={day.day} className={"hv-bars__col" + (index === last ? " is-now" : " is-past")}>
              <div className="hv-bars__zone">
                {day.focus >= 60 ? <em className="hv-bars__value" style={{ bottom: "calc(" + height + "% + 4px)" }}>{formatShortDuration(day.focus)}</em> : null}
                <span className="hv-bars__bar" style={{ height: height + "%" }} role="img" aria-label={WEEKDAY_LONG[lang][new Date(day.day + "T12:00:00").getDay()] + " " + formatDuration(day.focus, lang)}><i className="is-focus" style={{ flexGrow: 1 }} /></span>
              </div>
              <span className="hv-bars__label">{WEEKDAY_SHORT[lang][new Date(day.day + "T12:00:00").getDay()]}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The achievements under way (or, without any, the latest earned), as small achievement rows. */
function Achievements({ items, c, onOpen, limit }: { readonly items: readonly AchievementItem[]; readonly c: Copy; readonly onOpen: () => void; readonly limit: number }) {
  const { t } = useLocalization();
  // The design review shows the same held state as the Achievements tab.
  const review = isAchievementDesignReview();
  const { holding } = useAchievementReviewState();
  const shown = useMemo(() => (review ? itemsForReviewHolding(items, holding) : items), [review, items, holding]);
  const parts = useMemo(() => achievementRowParts(shown, { almost: limit, earned: "recent" }), [shown, limit]);
  const rows = parts.almost.length > 0
    ? parts.almost.slice(0, limit).map((entry) => ({ item: entry.item, share: entry.share }))
    : parts.earned.slice(0, limit).map((item) => ({ item, share: null as number | null }));
  if (rows.length === 0) return null;
  return (
    <section className="hv-block hv-ach" aria-label={parts.almost.length > 0 ? c.next : c.recent}>
      <Head title={parts.almost.length > 0 ? c.next : c.recent} onOpen={onOpen} label={c.open} />
      <ul className="hv-ach__list">
        {rows.map(({ item, share }) => (
          <li key={item.definition.id}>
            <button type="button" className="hv-ach__row" onClick={onOpen}>
              <C15Medal item={item} className="hv-ach__medal" />
              <span className="hv-ach__text">
                <span className="hv-today__name">{achievementName(item, t)}</span>
                <span className="hv-today__sub">{achievementCondition(item, t)}</span>
                {share !== null ? <span className="hv-ach__bar" aria-hidden="true" style={medalTint(item.definition.id)}><i style={{ width: Math.round(share * 100) + "%" }} /></span> : null}
              </span>
              {share !== null ? <span className="hv-figure hv-figure--sm">{Math.round(share * 100)}<small>%</small></span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}


export type HomeV2PageProps = {
  readonly loadHistory: (range: CompactHistoryRange) => Promise<CompactHistoryLoad>;
  readonly recentSegments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly goalHours: number | null;
  readonly achievements: readonly AchievementItem[];
  readonly appIcons?: AppIconMap;
  readonly onOpenDay: () => void;
  readonly onOpenWeek: () => void;
  readonly onOpenAchievements: () => void;
  readonly onAsk: (question: string) => void;
};

export function HomeV2Page({ loadHistory, recentSegments, classificationOptions, startOfDayMinutes, goalHours, achievements, onOpenDay, onOpenWeek, onOpenAchievements, onAsk }: HomeV2PageProps) {
  const { effectiveLanguage } = useLocalization();
  const lang: HomeLang = effectiveLanguage === "ko" ? "ko" : "en";
  const c = COPY[lang];
  const { variant, clock } = useMemo(previewParams, []);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = logicalTodayIsoDate(startOfDayMinutes);
  const range = useMemo(() => getLogicalDayRange(shiftIsoDate(today, -7 * BASELINE_WEEKS - 1), today, startOfDayMinutes), [today, startOfDayMinutes]);
  const key = range.start + ":" + range.end;
  const [history, setHistory] = useState<{ readonly key: string; readonly segments: readonly ActivitySegment[] } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadHistory(range)
      .then((load) => { if (!cancelled) setHistory({ key, segments: load.materialized.segments }); })
      .catch(() => { if (!cancelled) setFailed(key); });
    return () => { cancelled = true; };
  }, [key, range, loadHistory]);
  const asOfMs = Math.min(asOfFor(clock, today, startOfDayMinutes, nowMs), logicalDayEndExclusiveMs(today, startOfDayMinutes) - 1);
  const model = useMemo(() => {
    if (!history || history.key !== key) return null;
    const segments = mergeActivitySegments(history.segments, recentSegments);
    return buildHomeModel({ segments, today, asOfMs, startOfDayMinutes, classificationOptions: { ...classificationOptions, fallbackCandidates: segments }, goalHours });
  }, [history, key, recentSegments, today, asOfMs, startOfDayMinutes, classificationOptions, goalHours]);

  if (!model) {
    return <div className="page hv"><p className="hv-empty">{failed === key ? c.failed : c.loading}</p></div>;
  }
  const items = metrics(model, c, lang);
  const card = topCard(model, lang);
  const today_ = variant === "rings" ? <TodayRings items={items} onOpen={onOpenDay} /> : <TodayRows items={items} onOpen={onOpenDay} />;
  return (
    <div className={"page hv hv--" + variant}>
      <div className="pg-head hv-pagehead">
        <h1>{c.greet[model.phase]}</h1>
        <span className="hv-date">{dateLine(model.today, lang, model.asOfMs)}</span>
      </div>
      <div className="hv-grid">
        <section className="hv-block hv-todayblock" aria-label={c.today}>
          <Head title={c.today} onOpen={onOpenDay} label={c.open} />
          {today_}
        </section>
        <Voice card={card} c={c} phase={model.phase} past={false} onAsk={onAsk} />
        <Hours model={model} c={c} lang={lang} onOpen={onOpenDay} />
        <Week model={model} c={c} lang={lang} onOpen={onOpenWeek} />
        {variant === "two" ? null : <Achievements items={achievements} c={c} onOpen={onOpenAchievements} limit={2} />}
      </div>
    </div>
  );
}

/** The sidebar item for the preview, at the top of the list like the old Home. */
export function HomeNavItem({ active, collapsed, onOpen }: { readonly active: boolean; readonly collapsed: boolean; readonly onOpen: () => void }) {
  const { effectiveLanguage } = useLocalization();
  const label = COPY[effectiveLanguage === "ko" ? "ko" : "en"].nav;
  return (
    <button type="button" className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
        <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z" />
      </svg>
      <span>{label}</span>
      {collapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
    </button>
  );
}

