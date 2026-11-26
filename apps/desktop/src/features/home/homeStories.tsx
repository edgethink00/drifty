import { useState, type FormEvent, type ReactNode } from "react";
import { CURVE_STEP_MINUTES, DEEP_FOCUS_MIN_SECONDS, weekDiscovery, type HomeModel, type HomeSession } from "./homeModel";
import { formatClock, formatDuration, type HomeLang } from "./homeCards";
import { PaceChart, voiceCopy, type PaceProjection } from "./homeVoice";

/*
 * What Drifty talks about (owner review 2026-11-27): seven stories in one
 * frame (message, evidence beside it, two questions under it), each with the
 * evidence that proves it. Every sentence restates numbers already on this
 * computer; parts and colors are the app's own.
 */

export type StoryVariant = "n1" | "n2" | "n3" | "n4" | "n5" | "n6" | "n7";
export const STORY_VARIANTS: readonly StoryVariant[] = ["n1", "n2", "n3", "n4", "n5", "n6", "n7"];

const HOUR_MS = 3_600_000;
const STEP_MS = CURVE_STEP_MINUTES * 60_000;
const WEEKDAYS = { ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"], en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] };
const WEEKDAYS_SHORT = { ko: ["일", "월", "화", "수", "목", "금", "토"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };

type Ask = readonly [label: string, question: string];
type Story = {
  readonly title: string;
  readonly body?: string;
  readonly evidence: ReactNode;
  readonly asks?: readonly Ask[];
  readonly replies?: readonly { readonly label: string; readonly reply: string }[];
  readonly note?: { readonly placeholder: string; readonly button: string; readonly done: string };
};

const L = (lang: HomeLang, ko: string, en: string) => (lang === "ko" ? ko : en);
const quote = (lang: HomeLang, label: string) => (lang === "ko" ? "‘" + label + "’" : "“" + label + "”");
const dur = (seconds: number, lang: HomeLang) => formatDuration(seconds, lang);
const weekdayOf = (day: string, lang: HomeLang) => WEEKDAYS[lang][new Date(day + "T12:00:00").getDay()];
const hourWord = (hour: number, lang: HomeLang) => (lang === "ko" ? (hour === 12 ? "낮 " : hour < 12 ? "오전 " : "오후 ") + (hour % 12 === 0 ? 12 : hour % 12) + "시대" : (hour % 12 === 0 ? 12 : hour % 12) + (hour < 12 ? " a.m." : " p.m.") + " hour");
const minutesOfDay = (ms: number) => { const date = new Date(ms); return date.getHours() * 60 + date.getMinutes(); };
const clockOfMinutes = (minutes: number) => String(Math.floor(minutes / 60) % 24).padStart(2, "0") + ":" + String(Math.round(minutes % 60)).padStart(2, "0");

function valueAt(values: readonly number[], index: number): number {
  const low = Math.max(0, Math.min(values.length - 1, Math.floor(index)));
  const high = Math.min(values.length - 1, low + 1);
  return values[low] + (values[high] - values[low]) * (index - low);
}

function Legend({ children }: { readonly children: ReactNode }) {
  return <div className="hf-pace__legend">{children}</div>;
}
function Key({ tone, children }: { readonly tone: "deep" | "short" | "drift" | "focus" | "muted" | "past"; readonly children: ReactNode }) {
  return <span><i className={"hf-key hf-key--" + tone} aria-hidden="true" />{children}</span>;
}

/** Stacked hour columns (focus under drift), drawn with the Insights week columns. */
function HourColumns({ model, lang }: { readonly model: HomeModel; readonly lang: HomeLang }) {
  const hours = model.hours;
  const nowHour = Math.min(hours.length - 1, Math.floor((model.asOfMs - hours[0].startMs) / HOUR_MS));
  const first = Math.max(0, hours.findIndex((hour) => hour.focus + hour.drift + hour.neutral > 0));
  const shown = hours.slice(Math.min(first, Math.max(0, nowHour - 3)), nowHour + 1);
  const label = (startMs: number) => String(new Date(startMs).getHours());
  return (
    <div className="hf-pace">
      <Legend><Key tone="drift">{L(lang, "딴짓", "Drift")}</Key><Key tone="short">{L(lang, "집중", "Focus")}</Key></Legend>
      <div className="hf-mini">
        <span className="wt-cols" style={{ gridTemplateColumns: "repeat(" + shown.length + ", minmax(0, 1fr))" }}>
          {shown.map((hour) => (
            <span key={hour.startMs} className="wt-col">
              <span className="wt-bars-zone">
                <span className="wt-bar" style={{ height: Math.min(100, ((hour.focus + hour.drift) / 3600) * 100) + "%" }} role="img" aria-label={label(hour.startMs) + ": " + dur(hour.focus, lang) + " / " + dur(hour.drift, lang)}>
                  <span className="wt-seg hf-week__seg" style={{ flex: hour.focus }} />
                  <span className="wt-seg hf-seg--drift" style={{ flex: hour.drift }} />
                </span>
              </span>
              <span className="wt-daylabel">{label(hour.startMs)}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

type Block = { readonly startMs: number; readonly endMs: number; readonly tone: "deep" | "short" | "drift" | "muted" };

/** A day as one strip: focus stretches and drift in the productivity tones. */
function DayStrip({ blocks, fromMs, toMs, legend, lang }: { readonly blocks: readonly Block[]; readonly fromMs: number; readonly toMs: number; readonly legend: ReactNode; readonly lang: HomeLang }) {
  const span = Math.max(1, toMs - fromMs);
  const left = (ms: number) => ((Math.max(fromMs, ms) - fromMs) / span) * 100;
  return (
    <div className="hf-pace">
      <Legend>{legend}</Legend>
      <div className="hf-strip" role="img" aria-label={L(lang, "하루 구간", "The day")}>
        {blocks.map((block) => <i key={block.tone + block.startMs} className={"hf-strip__block hf-key--" + block.tone} style={{ left: left(block.startMs) + "%", width: Math.max(0.8, left(block.endMs) - left(block.startMs)) + "%" }} />)}
      </div>
      <div className="hf-pace__axis hf-pace__axis--flush"><span className="wt-daylabel">{formatClock(fromMs)}</span><span className="wt-daylabel">{formatClock(toMs)}</span></div>
    </div>
  );
}

/** Each of the last seven days as a row, with its longest focus placed on the clock. */
function WeekRuns({ model, lang, bandHour }: { readonly model: HomeModel; readonly lang: HomeLang; readonly bandHour: number | null }) {
  const runs = model.week.map((entry) => entry.longestFocus);
  const placed = runs.filter((run): run is NonNullable<typeof run> => run !== null);
  const lo = Math.floor(Math.min(9 * 60, ...placed.map((run) => minutesOfDay(run.startMs))) / 60) * 60;
  const hi = Math.ceil(Math.max(lo + 8 * 60, ...placed.map((run) => minutesOfDay(run.startMs) + run.seconds / 60)) / 60) * 60;
  const pos = (minutes: number) => ((minutes - lo) / (hi - lo)) * 100;
  const last = model.week.length - 1;
  return (
    <div className="hf-pace">
      <Legend><Key tone="past">{L(lang, "그날 가장 긴 집중", "Longest that day")}</Key><Key tone="deep">{L(lang, "오늘", "Today")}</Key></Legend>
      <div className="hf-weekruns">
        {model.week.map((entry, index) => {
          const run = entry.longestFocus;
          return (
            <div key={entry.day} className={"hf-weekruns__row" + (index === last ? " is-today" : "")}>
              <span className="wt-daylabel">{WEEKDAYS_SHORT[lang][new Date(entry.day + "T12:00:00").getDay()]}</span>
              <span className="hf-weekruns__track">
                {bandHour !== null ? <i className="hf-weekruns__band" style={{ left: pos(bandHour * 60) + "%", width: pos(bandHour * 60 + 60) - pos(bandHour * 60) + "%" }} /> : null}
                {run ? <i className={"hf-strip__block " + (index === last ? "hf-key--deep" : "hf-key--past")} style={{ left: pos(minutesOfDay(run.startMs)) + "%", width: Math.max(1.5, pos(minutesOfDay(run.startMs) + run.seconds / 60) - pos(minutesOfDay(run.startMs))) + "%" }} /> : null}
              </span>
            </div>
          );
        })}
      </div>
      <div className="hf-pace__axis hf-weekruns__axis"><span className="wt-daylabel">{clockOfMinutes(lo)}</span><span className="wt-daylabel">{clockOfMinutes(hi)}</span></div>
    </div>
  );
}

/** The longest focus of each of the last seven days as columns, the day in question in full tone. */
function LongestColumns({ model, lang, target }: { readonly model: HomeModel; readonly lang: HomeLang; readonly target: number }) {
  const values = model.week.map((entry) => entry.longestFocus?.seconds ?? 0);
  const top = Math.max(DEEP_FOCUS_MIN_SECONDS, ...values) * 1.12;
  return (
    <div className="hf-pace">
      <Legend><Key tone="deep">{L(lang, "그날 가장 긴 집중", "Longest that day")}</Key></Legend>
      <div className="hf-mini hf-mini--grid">
        <span className="wt-gridline" style={{ top: (1 - DEEP_FOCUS_MIN_SECONDS / top) * 100 + "%" }}><span className="wt-gridlabel">{L(lang, "25분", "25m")}</span></span>
        <span className="wt-cols">
          {model.week.map((entry, index) => (
            <span key={entry.day} className={"wt-col" + (index === target ? " hf-week__today" : "")}>
              <span className="wt-bars-zone">
                <span className="wt-bar" style={{ height: (values[index] / top) * 100 + "%" }} role="img" aria-label={weekdayOf(entry.day, lang) + " " + dur(values[index], lang)}>
                  <span className={"wt-seg " + (index === target ? "hf-seg--focus" : "hf-week__seg")} style={{ height: "100%" }} />
                </span>
              </span>
              <span className="wt-daylabel">{WEEKDAYS_SHORT[lang][new Date(entry.day + "T12:00:00").getDay()]}</span>
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function focusBlocks(sessions: readonly HomeSession[], highlight: number | null = null): Block[] {
  return sessions.map((session) => ({
    startMs: session.startMs,
    endMs: session.endMs,
    tone: session.kind === "drift" ? "drift" : highlight !== null ? (session.startMs === highlight ? "deep" : "muted") : session.seconds >= DEEP_FOCUS_MIN_SECONDS ? "deep" : "short",
  }));
}

function forecast(model: HomeModel, lang: HomeLang): Story {
  const c = voiceCopy(lang);
  const { today, usual, startMs } = model.focusCurve;
  const goal = model.goalSeconds;
  const weekday = weekdayOf(model.today, lang);
  const at = Math.max(1, Math.min(today.length - 1, (model.asOfMs - startMs) / STEP_MS));
  const clockAt = (index: number) => formatClock(startMs + index * STEP_MS);
  const asks: Ask[] = [
    [L(lang, "목표까지 어떻게 채울까?", "How do I make the goal?"), L(lang, "남은 목표 시간을 오늘 어떻게 채우면 좋을지 알려 줘", "How can I fill the rest of today's goal?")],
    [L(lang, "평소 " + weekday + " 오후엔 뭘 했어?", "What do my " + weekday + " afternoons hold?"), L(lang, "평소 " + weekday + " 오후엔 주로 무슨 일을 했어?", "What do I usually do on " + weekday + " afternoons?")],
  ];
  if (model.phase === "evening") {
    const cross = today.findIndex((value) => value >= goal);
    return {
      title: cross >= 0 ? L(lang, "오늘은 " + clockAt(cross) + "에 목표 " + dur(goal, lang) + "을 넘었어요.", "You passed the " + dur(goal, lang) + " goal at " + clockAt(cross) + ".") : L(lang, "오늘은 목표까지 " + dur(goal - model.now.focus, lang) + " 남기고 마쳐요.", "Today ends " + dur(goal - model.now.focus, lang) + " short of the goal."),
      body: model.baseline.days > 0 ? L(lang, "평소 " + weekday + "엔 하루 " + dur(model.baseline.fullDayFocus, lang) + " 집중해요. 오늘은 " + dur(model.now.focus, lang) + "이에요.", "A usual " + weekday + " holds " + dur(model.baseline.fullDayFocus, lang) + " of focus; today " + dur(model.now.focus, lang) + ".") : undefined,
      evidence: <PaceChart model={model} c={c} />,
      asks,
    };
  }
  if (!usual) {
    return { title: L(lang, "평소 기록이 쌓이면 언제 목표를 채울지 알려 드릴게요.", "Once there's a usual day on record, I'll tell you when the goal lands."), evidence: <PaceChart model={model} c={c} />, asks };
  }
  const base = model.now.focus;
  const usualNow = valueAt(usual, at);
  const lastRise = usual.reduce((last, value, index) => (index > 0 && value > usual[index - 1] ? index : last), 0);
  const points: [number, number][] = [];
  let cross: number | null = null;
  for (let index = Math.ceil(at); index <= lastRise + 1 && index < usual.length; index += 1) {
    const value = base + (usual[index] - usualNow);
    points.push([index, value]);
    if (cross === null && base < goal && value >= goal) { cross = index; break; }
  }
  const end = points.length > 0 ? points[points.length - 1][1] : base;
  const projection: PaceProjection = { points, label: cross !== null ? L(lang, "예상 " + clockAt(cross), "Expected " + clockAt(cross)) : L(lang, "평소대로면", "At usual pace") };
  const title = base >= goal
    ? L(lang, "오늘 목표는 벌써 채웠어요.", "Today's goal is already met.")
    : cross !== null
      ? (model.phase === "morning" ? L(lang, "평소대로면 " + clockAt(cross) + "쯤 목표 " + dur(goal, lang) + "을 채워요.", "At your usual pace the goal lands around " + clockAt(cross) + ".") : L(lang, "이대로면 " + clockAt(cross) + "쯤 목표를 채워요.", "At this pace the goal lands around " + clockAt(cross) + "."))
      : L(lang, "이대로면 오늘은 목표에 " + dur(goal - end, lang) + " 못 미쳐요.", "At this pace today ends " + dur(goal - end, lang) + " short.");
  const body = model.phase === "morning"
    ? (model.baseline.firstStartMinutes !== null ? L(lang, "평소 " + weekday + "엔 " + formatClock(startMs + model.baseline.firstStartMinutes * 60_000) + "에 시작해 하루 " + dur(model.baseline.fullDayFocus, lang) + " 집중해요.", "A usual " + weekday + " starts at " + formatClock(startMs + model.baseline.firstStartMinutes * 60_000) + " and holds " + dur(model.baseline.fullDayFocus, lang) + ".") : undefined)
    : L(lang, "평소 " + weekday + "엔 이 시각부터 " + dur(usual[lastRise] - usualNow, lang) + " 더 집중했어요. 목표까지는 " + dur(Math.max(0, goal - base), lang) + " 남았어요.", "From now a usual " + weekday + " adds " + dur(usual[lastRise] - usualNow, lang) + "; " + dur(Math.max(0, goal - base), lang) + " to the goal.");
  return { title, body, evidence: <PaceChart model={model} c={c} projection={projection} />, asks };
}

function drift(model: HomeModel, lang: HomeLang): Story {
  if (model.phase === "morning") {
    const y = model.yesterday;
    const drifts = [...(y?.sessions ?? [])].filter((session) => session.kind === "drift").sort((a, b) => b.seconds - a.seconds);
    const top = drifts[0];
    return {
      title: top?.item ? L(lang, "어제 딴짓 " + dur(y?.slice.drift ?? 0, lang) + " 중 가장 길었던 건 " + formatClock(top.startMs) + " " + top.item.label + "이었어요.", "Yesterday's longest drift was " + top.item.label + " at " + formatClock(top.startMs) + ".") : L(lang, "어제는 딴짓이 거의 없었어요.", "Yesterday had next to no drift."),
      body: L(lang, "오늘은 그 시간을 조심하면 돼요.", "Watch that hour today."),
      evidence: y && y.sessions.length > 0 ? <DayStrip blocks={y.sessions.map((session) => ({ startMs: session.startMs, endMs: session.endMs, tone: session.kind === "drift" ? "drift" : "muted" }))} fromMs={y.sessions[0].startMs} toMs={y.sessions[y.sessions.length - 1].endMs} lang={lang} legend={<><Key tone="drift">{L(lang, "딴짓", "Drift")}</Key><Key tone="muted">{L(lang, "집중", "Focus")}</Key></>} /> : null,
      asks: [[L(lang, "어제 딴짓 정리해 줘", "Recap yesterday's drift"), L(lang, "어제 딴짓은 언제 어디서 했어?", "When and where did I drift yesterday?")], [L(lang, "이번 주 딴짓은 어디서 했어?", "Where did this week's drift go?"), L(lang, "이번 주 딴짓은 주로 어디서 했어?", "Where did most of this week's drift go?")]],
    };
  }
  const hours = model.hours;
  const nowHour = Math.min(hours.length - 1, Math.floor((model.asOfMs - hours[0].startMs) / HOUR_MS));
  const peak = hours.slice(0, nowHour + 1).reduce((best, hour, index) => (hour.drift > hours[best].drift ? index : best), 0);
  const peakHour = new Date(hours[peak].startMs).getHours();
  const share = model.topDrift ? Math.round((model.topDrift.seconds / Math.max(1, model.now.drift)) * 100) : 0;
  return {
    title: model.now.drift >= 60 && model.topDrift
      ? L(lang, "오늘 딴짓 " + dur(model.now.drift, lang) + " 중 " + share + "%는 " + model.topDrift.label + "이었어요.", share + "% of today's " + dur(model.now.drift, lang) + " of drift was " + model.topDrift.label + ".")
      : L(lang, "오늘은 딴짓이 거의 없어요.", "Next to no drift today."),
    body: model.now.drift >= 60 ? L(lang, "가장 많았던 때는 " + hourWord(peakHour, lang) + "예요." + (model.baseline.days > 0 ? (model.baseline.drift < 60 ? " 평소 이 시각까지는 딴짓이 거의 없었어요." : " 평소 이 시각까지 딴짓은 " + dur(model.baseline.drift, lang) + "이었어요.") : ""), "Most came in the " + hourWord(peakHour, lang) + "." + (model.baseline.days > 0 ? " By now you usually drift " + dur(model.baseline.drift, lang) + "." : "")) : undefined,
    evidence: <HourColumns model={model} lang={lang} />,
    asks: [[L(lang, hourWord(peakHour, lang) + "엔 뭐 했어?", "What happened in the " + hourWord(peakHour, lang) + "?"), L(lang, "오늘 " + hourWord(peakHour, lang) + "에 무엇을 했는지 알려 줘", "What did I do in the " + hourWord(peakHour, lang) + " today?")], [L(lang, "이번 주 딴짓은 어디서 했어?", "Where did this week's drift go?"), L(lang, "이번 주 딴짓은 주로 어디서 했어?", "Where did most of this week's drift go?")]],
  };
}

function pattern(model: HomeModel, lang: HomeLang): Story {
  const discovery = weekDiscovery(model);
  const runs = model.week.slice(0, -1).map((entry) => entry.longestFocus).filter((run): run is NonNullable<typeof run> => run !== null);
  const average = runs.length > 0 ? runs.reduce((sum, run) => sum + minutesOfDay(run.startMs), 0) / runs.length : null;
  const title = discovery?.kind === "same-hour"
    ? L(lang, "최근 7일 가장 긴 집중 " + discovery.of + "번 중 " + discovery.count + "번이 " + hourWord(discovery.hour, lang) + "에 시작했어요.", discovery.count + " of your last " + discovery.of + " longest stretches began in the " + hourWord(discovery.hour, lang) + ".")
    : discovery?.kind === "morning-heavy" ? L(lang, "최근 7일 가장 긴 집중은 대부분 오전에 시작했어요.", "This week your longest focus mostly began in the morning.")
      : discovery?.kind === "afternoon-heavy" ? L(lang, "최근 7일 가장 긴 집중은 대부분 오후에 시작했어요.", "This week your longest focus mostly began in the afternoon.")
        : average !== null ? L(lang, "최근 7일 가장 긴 집중은 보통 " + clockOfMinutes(average) + " 무렵 시작했어요.", "This week your longest focus usually began around " + clockOfMinutes(average) + ".") : L(lang, "며칠 더 쌓이면 집중이 잘 되는 시간을 찾아 드릴게요.", "A few more days and I'll find your best hours.");
  const todayRun = model.pattern.longestFocus;
  const body = model.phase !== "morning" && todayRun
    ? L(lang, "오늘은 " + formatClock(todayRun.startMs) + "부터 " + dur(todayRun.seconds, lang) + " 이어졌어요.", "Today's ran " + dur(todayRun.seconds, lang) + " from " + formatClock(todayRun.startMs) + ".")
    : L(lang, "오늘도 그 시간을 비워 두면 좋겠어요.", "Worth keeping that time clear today.");
  return {
    title, body, evidence: <WeekRuns model={model} lang={lang} bandHour={discovery?.kind === "same-hour" ? discovery.hour : null} />,
    asks: [[L(lang, "그 시간엔 주로 뭘 했어?", "What fills those hours?"), L(lang, "최근 7일 가장 긴 집중 때 주로 무슨 일을 했어?", "What was I doing in my longest focus this week?")], [L(lang, "이번 달은 어땠어?", "And this month?"), L(lang, "이번 달 집중이 가장 잘 된 시간대를 알려 줘", "Which hours worked best this month?")]],
  };
}

function breaks(model: HomeModel, lang: HomeLang): Story {
  const morning = model.phase === "morning";
  const sessions = morning ? model.yesterday?.sessions ?? [] : model.sessions;
  const focus = sessions.filter((session) => session.kind === "focus");
  const deep = (morning ? focus.map((session) => session.seconds) : model.pattern.focusRuns.map((run) => run.seconds)).filter((seconds) => seconds >= DEEP_FOCUS_MIN_SECONDS).length;
  const longest = [...focus].sort((a, b) => b.seconds - a.seconds)[0] ?? null;
  const fromMs = sessions.length > 0 ? sessions[0].startMs : model.asOfMs - HOUR_MS;
  const toMs = morning ? (sessions.length > 0 ? sessions[sessions.length - 1].endMs : model.asOfMs) : model.asOfMs;
  const title = morning
    ? L(lang, "어제는 25분 넘게 이어진 집중이 " + deep + "번 있었어요.", "Yesterday held " + deep + " stretches of 25 minutes or more.")
    : model.focusBreaks > 0 ? L(lang, "오늘 집중이 " + model.focusBreaks + "번 끊겼어요.", "Today's focus broke " + model.focusBreaks + " times.") : L(lang, "오늘 집중은 한 번도 끊기지 않았어요.", "Today's focus hasn't broken once.");
  const body = longest
    ? L(lang, (morning ? "" : "25분 넘게 이어진 건 " + deep + "번, ") + "가장 긴 건 " + formatClock(longest.startMs) + "부터 " + dur(longest.seconds, lang) + "이었어요." + (!morning && model.topDrift && model.focusBreaks > 0 ? " 끊긴 자리엔 대부분 " + model.topDrift.label + "이 있었어요." : ""), (morning ? "" : deep + " held past 25 minutes; ") + "the longest ran " + dur(longest.seconds, lang) + " from " + formatClock(longest.startMs) + ".")
    : undefined;
  return {
    title, body,
    evidence: <DayStrip blocks={focusBlocks(sessions)} fromMs={fromMs} toMs={toMs} lang={lang} legend={<>{focusBlocks(sessions).some((block) => block.tone === "deep") ? <Key tone="deep">{L(lang, "25분 넘게", "25m+")}</Key> : null}{focusBlocks(sessions).some((block) => block.tone === "short") ? <Key tone="short">{L(lang, "짧게", "Short")}</Key> : null}{focusBlocks(sessions).some((block) => block.tone === "drift") ? <Key tone="drift">{L(lang, "딴짓", "Drift")}</Key> : null}</>} />,
    asks: [[L(lang, "끊기기 전엔 뭘 했어?", "What came before the breaks?"), L(lang, "오늘 집중이 끊기기 직전에 무엇을 했는지 알려 줘", "What came right before my focus broke today?")], [L(lang, "길게 집중한 날은 뭐가 달랐어?", "What's different on long days?"), L(lang, "집중이 길게 이어진 날들의 공통점을 찾아 줘", "What do my longest focus days have in common?")]],
  };
}

function record(model: HomeModel, lang: HomeLang): Story {
  const target = model.phase === "morning" ? model.week.length - 2 : model.week.length - 1;
  const day = model.week[target];
  const run = day?.longestFocus ?? null;
  const sessions = model.phase === "morning" ? model.yesterday?.sessions ?? [] : model.sessions;
  const item = run ? sessions.find((session) => session.kind === "focus" && Math.abs(session.startMs - run.startMs) < 60_000)?.item ?? null : null;
  const values = model.week.map((entry) => entry.longestFocus?.seconds ?? 0);
  const rank = run ? 1 + values.filter((seconds, index) => index !== target && seconds > run.seconds).length : 0;
  const best = values.reduce((bestIndex, seconds, index) => (seconds > values[bestIndex] ? index : bestIndex), 0);
  const when = model.phase === "morning" ? L(lang, "어제 ", "Yesterday, ") : "";
  return {
    title: run
      ? L(lang, when + formatClock(run.startMs) + "부터 " + dur(run.seconds, lang) + ", " + (rank === 1 ? "최근 7일 중 가장 긴 집중이에요." : "최근 7일 중 " + rank + "번째로 긴 집중이에요."), when + dur(run.seconds, lang) + " from " + formatClock(run.startMs) + (rank === 1 ? ": your longest focus in 7 days." : ": number " + rank + " of the last 7 days."))
      : L(lang, "아직 이어진 집중이 없어요.", "No stretch of focus yet."),
    body: item ? L(lang, quote(lang, item.label) + "에서였어요." + (rank !== 1 ? " 가장 길었던 날은 " + weekdayOf(model.week[best].day, lang) + " " + dur(values[best], lang) + "이에요." : ""), "It was " + quote(lang, item.label) + "." + (rank !== 1 ? " The longest was " + weekdayOf(model.week[best].day, lang) + ", " + dur(values[best], lang) + "." : "")) : undefined,
    evidence: <LongestColumns model={model} lang={lang} target={target} />,
    asks: [[L(lang, "그날은 뭘 했어?", "What was that day?"), L(lang, "최근 7일 중 가장 길게 집중한 날엔 무슨 일을 했어?", "What did I do on my longest focus day this week?")], [L(lang, "더 길게 하려면?", "How do I go longer?"), L(lang, "집중이 길게 이어진 날들의 공통점을 찾아 줘", "What do my longest focus days have in common?")]],
  };
}

function askBack(model: HomeModel, lang: HomeLang): Story {
  if (model.phase === "morning") {
    const y = model.yesterday;
    const item = y?.lastItem ?? null;
    const sessions = y?.sessions ?? [];
    const last = item ? [...sessions].reverse().find((session) => session.kind === "focus" && session.item?.id === item.id) ?? null : null;
    return {
      title: item ? L(lang, "어제 마지막엔 " + quote(lang, item.label) + "에 오래 머물렀어요. 오늘 이어서 할 거예요?", "Yesterday ended on " + quote(lang, item.label) + ". Picking it up today?") : L(lang, "오늘은 무엇부터 할 거예요?", "What's first today?"),
      body: L(lang, "알려 주면 낮에 얼마나 이어졌는지 같이 볼게요.", "Tell me and I'll check how far it went by midday."),
      evidence: sessions.length > 0 ? <DayStrip blocks={focusBlocks(sessions, last?.startMs ?? null)} fromMs={sessions[0].startMs} toMs={sessions[sessions.length - 1].endMs} lang={lang} legend={<><Key tone="deep">{item ? item.label : L(lang, "어제", "Yesterday")}</Key><Key tone="muted">{L(lang, "다른 집중", "Other focus")}</Key></>} /> : null,
      replies: [
        { label: L(lang, "이어서 할게", "Yes, picking it up"), reply: L(lang, "좋아요. 점심때 얼마나 이어졌는지 알려 드릴게요.", "Good. I'll tell you how far it went by lunch.") },
        { label: L(lang, "오늘은 다른 일", "Something else today"), reply: L(lang, "알겠어요. 오늘 가장 오래 붙잡는 일을 따라갈게요.", "Got it. I'll follow whatever holds you longest.") },
      ],
    };
  }
  const longest = [...model.sessions].filter((session) => session.kind === "focus").sort((a, b) => b.seconds - a.seconds)[0] ?? null;
  return {
    title: longest?.item
      ? L(lang, formatClock(longest.startMs) + "부터 " + dur(longest.seconds, lang) + " 동안 " + quote(lang, longest.item.label) + "에 머물렀어요. 무슨 일이었어요?", "You stayed on " + quote(lang, longest.item.label) + " for " + dur(longest.seconds, lang) + " from " + formatClock(longest.startMs) + ". What was it?")
      : L(lang, "오늘은 무엇을 하고 있어요?", "What are you working on today?"),
    body: L(lang, "한 줄 남기면 오늘 기록과 저녁 정리에 같이 적어 둘게요.", "Leave a line and I'll keep it with today's record and tonight's wrap-up."),
    evidence: model.sessions.length > 0 ? <DayStrip blocks={focusBlocks(model.sessions, longest?.startMs ?? null)} fromMs={model.sessions[0].startMs} toMs={model.asOfMs} lang={lang} legend={<><Key tone="deep">{longest?.item ? longest.item.label : L(lang, "오늘", "Today")}</Key><Key tone="muted">{L(lang, "다른 집중", "Other focus")}</Key></>} /> : null,
    note: { placeholder: L(lang, "예: 집중 그래프 범례 정리", "e.g. tidy the focus chart legend"), button: L(lang, "남기기", "Save"), done: L(lang, "적어 뒀어요. 저녁 정리에 같이 넣을게요.", "Saved. It'll be in tonight's wrap-up.") },
  };
}

function buildStory(story: Exclude<StoryVariant, "n1">, model: HomeModel, lang: HomeLang): Story {
  switch (story) {
    case "n2": return forecast(model, lang);
    case "n3": return drift(model, lang);
    case "n4": return pattern(model, lang);
    case "n5": return breaks(model, lang);
    case "n6": return record(model, lang);
    case "n7": return askBack(model, lang);
  }
}

function Note({ note }: { readonly note: NonNullable<Story["note"]> }) {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const submit = (event: FormEvent) => { event.preventDefault(); if (text.trim()) setSaved(text.trim()); };
  if (saved) {
    return (
      <div className="hf-reply">
        <span className="hf-reply__you">{saved}</span>
        <p className="hf-reply__drifty"><span className="hf-sub">Drifty</span>{note.done}</p>
      </div>
    );
  }
  return (
    <form className="hf-ask hf-note" onSubmit={submit}>
      <input type="text" value={text} onChange={(event) => setText(event.target.value)} placeholder={note.placeholder} aria-label={note.placeholder} />
      <button type="submit" className="app-btn app-btn--secondary app-btn--compact">{note.button}</button>
    </form>
  );
}

function Replies({ replies }: { readonly replies: NonNullable<Story["replies"]> }) {
  const [said, setSaid] = useState<(typeof replies)[number] | null>(null);
  if (said) {
    return (
      <div className="hf-reply">
        <span className="hf-reply__you">{said.label}</span>
        <p className="hf-reply__drifty"><span className="hf-sub">Drifty</span>{said.reply}</p>
      </div>
    );
  }
  return <div className="hf-pills">{replies.map((reply) => <button key={reply.label} type="button" className="chat-suggestion" onClick={() => setSaid(reply)}>{reply.label}</button>)}</div>;
}

export function StoryVoice({ story, model, lang, onAsk }: {
  readonly story: Exclude<StoryVariant, "n1">; readonly model: HomeModel; readonly lang: HomeLang; readonly onAsk: (q: string) => void;
}) {
  const content = buildStory(story, model, lang);
  return (
    <section className={"hf-block hf-voice hf-voice--d4 hf-story--" + story} aria-label="Drifty">
      <div className="hf-head"><span className="insight-section__label">{"Drifty · " + formatClock(model.asOfMs)}</span></div>
      <div className={content.evidence ? "hf-voice__split" : undefined}>
        <div className="hf-voice__message">
          <p className="hf-voice__title">{content.title}</p>
          {content.body ? <p className="hf-voice__body">{content.body}</p> : null}
          {content.asks ? <div className="hf-pills">{content.asks.map(([label, question]) => <button key={label} type="button" className="chat-suggestion" onClick={() => onAsk(question)}>{label}</button>)}</div> : null}
          {content.replies ? <Replies replies={content.replies} /> : null}
          {content.note ? <Note note={content.note} /> : null}
        </div>
        {content.evidence}
      </div>
    </section>
  );
}
