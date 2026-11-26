import { useState, type FormEvent } from "react";
import type { AppIconMap } from "@drifty/domain";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { CURVE_STEP_MINUTES, type HomeModel, type HomeWorkItem } from "./homeModel";
import { formatClock, formatDuration, formatShortDuration, type HomeCard, type HomeCardAction, type HomeLang } from "./homeCards";
import "../chat/chat.css";

/*
 * The Drifty block's variations (owner review 2026-11-27): the message stays;
 * what sits under or beside it changes. Every part is an existing one: the
 * Chat follow-up pill (chat-suggestion), the productivity dot, the Insights
 * gridline and label, app-btn, and the shared text and space tokens.
 */

export type VoiceVariant = "d0" | "d1" | "d2" | "d3" | "d4" | "d5";
export const VOICE_VARIANTS: readonly VoiceVariant[] = ["d0", "d1", "d2", "d3", "d4", "d5"];

const COPY = {
  ko: {
    ask: "Drifty에게 묻기", send: "보내기", example: (q: string) => "Drifty에게 묻기 · 예: " + q,
    examples: { morning: "어제 정리해 줘", midday: "왜 평소보다 느려?", evening: "오늘 정리해 줘" },
    today: "오늘", usual: (w: string) => "평소 " + w, yesterdayTop: "어제 가장 오래 한 일",
    usualNow: "평소 이 시각", now: "지금", gap: "차이", focus: "집중", goal: "목표", drift: "딴짓",
    yFocus: "어제 집중", yDrift: "어제 딴짓", weekAvg: "최근 7일 평균", usualDay: (w: string) => "평소 " + w + " 하루",
    weekdays: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
    more: {
      morning: [["어제 딴짓은 어디서 했어?", "어제 딴짓은 주로 어디서 했어?"], ["이번 주 언제 집중이 잘 됐어?", "이번 주 집중이 가장 잘 된 시간대를 알려 줘"]],
      midday: [["목표까지 어떻게 채울까?", "남은 목표 시간을 오늘 어떻게 채우면 좋을지 알려 줘"], ["오늘 딴짓은 어디서 했어?", "오늘 딴짓은 주로 어디서 했어?"]],
      evening: [["내일은 뭐부터 할까?", "오늘 기록을 보고 내일 무엇부터 하면 좋을지 알려 줘"], ["이번 주 뭐에 제일 많이 썼어?", "이번 주 뭐에 시간을 제일 많이 썼어?"]],
    },
  },
  en: {
    ask: "Ask Drifty", send: "Send", example: (q: string) => "Ask Drifty · e.g. " + q,
    examples: { morning: "Recap yesterday", midday: "Why am I behind usual?", evening: "Wrap up today" },
    today: "Today", usual: (w: string) => "Usual " + w, yesterdayTop: "Longest yesterday",
    usualNow: "Usual by now", now: "Now", gap: "Gap", focus: "Focus", goal: "Goal", drift: "Drift",
    yFocus: "Focus yesterday", yDrift: "Drift yesterday", weekAvg: "7-day average", usualDay: (w: string) => "Usual " + w,
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    more: {
      morning: [["Where did yesterday's drift go?", "Where did most of yesterday's drift go?"], ["When did I focus best this week?", "Which hours did I focus best this week?"]],
      midday: [["How do I make the goal?", "How can I fill the rest of today's goal?"], ["Where did today's drift go?", "Where did most of today's drift go?"]],
      evening: [["What first tomorrow?", "Looking at today, what should I start with tomorrow?"], ["Where did this week go?", "What did I spend the most time on this week?"]],
    },
  },
};
type Copy = (typeof COPY)["ko"];

export function ItemIcon({ item, appIcons }: { readonly item: HomeWorkItem; readonly appIcons: AppIconMap }) {
  const icon = appIcons[item.bundleId ?? item.appName] ?? appIcons[item.appName] ?? null;
  return item.siteDomain ? <SiteFavicon domain={item.siteDomain} size={20} fallbackIconSrc={icon} /> : <AppGlyph appName={item.appName} iconSrc={icon} size="sm" />;
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

const weekdayOf = (day: string, c: Copy) => c.weekdays[new Date(day + "T12:00:00").getDay()];

/** Today's focus added up against the usual same weekday, with the goal as the Insights gridline. */
function PaceChart({ model, c }: { readonly model: HomeModel; readonly c: Copy }) {
  const { today, usual, startMs } = model.focusCurve;
  const stepMs = CURVE_STEP_MINUTES * 60_000;
  // The exact clock time as a fractional step, so the line ends at now, not at the next quarter hour.
  const at = Math.max(1, Math.min(today.length - 1, (model.asOfMs - startMs) / stepMs));
  const whole = Math.floor(at);
  const firstActive = (values: readonly number[]) => values.findIndex((value) => value > 0);
  const lastRise = (values: readonly number[]) => values.reduce((last, value, index) => (index > 0 && value > values[index - 1] ? index : last), 0);
  const valueAt = (values: readonly number[], index: number) => {
    const low = Math.floor(index);
    const high = Math.min(values.length - 1, low + 1);
    return values[low] + (values[high] - values[low]) * (index - low);
  };
  const starts = [firstActive(today), usual ? firstActive(usual) : -1].filter((index) => index >= 0);
  const from = Math.max(0, (starts.length > 0 ? Math.min(...starts) : 0) - 2);
  const to = Math.min(today.length - 1, Math.max(Math.ceil(at), usual ? lastRise(usual) : 0) + 2);
  // The figures are the ones the sentence uses; the dots sit on the drawn lines.
  const nowFocus = model.now.focus;
  const usualFigure = model.baseline.days > 0 ? model.baseline.focus : null;
  const usualDot = usual ? valueAt(usual, at) : null;
  const top = Math.max(model.goalSeconds, usual?.[to] ?? 0, nowFocus) * 1.08;
  const x = (index: number) => ((index - from) / Math.max(1, to - from)) * 100;
  const y = (value: number) => 100 - (value / top) * 100;
  const pts = (values: readonly number[], end: number) => values.slice(from, end + 1).map((value, offset) => x(from + offset).toFixed(2) + "," + y(value).toFixed(2));
  const todayLine = [...pts(today, whole), x(at).toFixed(2) + "," + y(nowFocus).toFixed(2)].join(" ");
  const clockAt = (index: number) => formatClock(startMs + index * stepMs);
  const weekday = weekdayOf(model.today, c);
  return (
    <div className="hf-pace">
      <div className="hf-pace__legend">
        <span><i className="productivity-dot productivity-dot--focus" aria-hidden="true" />{c.today} <b>{formatShortDuration(nowFocus)}</b></span>
        {usualFigure !== null ? <span><i className="hf-pace__dash" aria-hidden="true" />{c.usual(weekday)} <b>{formatShortDuration(usualFigure)}</b></span> : null}
      </div>
      <div className="hf-pace__plot" role="img" aria-label={c.today + " " + formatDuration(nowFocus, "ko") + (usualFigure !== null ? ", " + c.usual(weekday) + " " + formatDuration(usualFigure, "ko") : "")}>
        <span className="wt-gridline" style={{ top: y(model.goalSeconds) + "%" }}><span className="wt-gridlabel">{formatShortDuration(model.goalSeconds)}</span></span>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {usual ? <polyline className="hf-pace__usual" points={pts(usual, to).join(" ")} /> : null}
          <polygon className="hf-pace__area" points={x(from) + ",100 " + todayLine + " " + x(at).toFixed(2) + ",100"} />
          <polyline className="hf-pace__today" points={todayLine} />
        </svg>
        {usualDot !== null ? <i className="productivity-dot productivity-dot--neutral hf-pace__dot" style={{ left: x(at) + "%", top: y(usualDot) + "%" }} /> : null}
        <i className="productivity-dot productivity-dot--focus hf-pace__dot" style={{ left: x(at) + "%", top: y(nowFocus) + "%" }} />
      </div>
      <div className="hf-pace__axis"><span className="wt-daylabel">{clockAt(from)}</span><span className="wt-daylabel">{clockAt(to)}</span></div>
    </div>
  );
}

/** Morning: yesterday's longest work, as the day list's rows. */
function YesterdayTop({ model, c, appIcons }: { readonly model: HomeModel; readonly c: Copy; readonly appIcons: AppIconMap }) {
  const items = model.yesterday?.topItems.slice(0, 3) ?? [];
  if (items.length === 0) return null;
  return (
    <div className="hf-ytop">
      <span className="insight-section__label">{c.yesterdayTop}</span>
      <ul className="hf-list">
        {items.map((item) => (
          <li key={item.id} className="hf-ytop__row">
            <ItemIcon item={item} appIcons={appIcons} />
            <span className="hf-ytop__label">{item.label}</span>
            <span className="hf-row__dur">{formatDuration(item.seconds, "ko")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Evidence({ model, c, appIcons }: { readonly model: HomeModel; readonly c: Copy; readonly appIcons: AppIconMap }) {
  return model.phase === "morning" ? <YesterdayTop model={model} c={c} appIcons={appIcons} /> : <PaceChart model={model} c={c} />;
}

/** The figures behind the sentence, in three columns split by hairlines. */
function Figures({ model, c }: { readonly model: HomeModel; readonly c: Copy }) {
  const weekday = weekdayOf(model.today, c);
  const has = model.baseline.days > 0;
  const signed = (seconds: number) => (seconds < 0 ? "\u2212" : "+") + formatDuration(Math.abs(seconds), "ko");
  const weekAverage = model.week.slice(0, -1).reduce((sum, entry) => sum + entry.focus, 0) / Math.max(1, model.week.length - 1);
  const cells: readonly (readonly [string, string])[] = model.phase === "morning"
    ? [[c.yFocus, formatDuration(model.yesterday?.slice.focus ?? 0, "ko")], [c.yDrift, formatDuration(model.yesterday?.slice.drift ?? 0, "ko")], [c.weekAvg, formatDuration(weekAverage, "ko")]]
    : model.phase === "evening"
      ? [[c.focus, formatDuration(model.now.focus, "ko")], [c.goal, formatDuration(model.goalSeconds, "ko")], [c.usualDay(weekday), has ? formatDuration(model.baseline.fullDayFocus, "ko") : "\u2014"]]
      : [[c.usualNow, has ? formatDuration(model.baseline.focus, "ko") : "\u2014"], [c.now, formatDuration(model.now.focus, "ko")], [c.gap, model.paceSeconds !== null ? signed(model.paceSeconds) : "\u2014"]];
  return (
    <dl className="hf-figures">
      {cells.map(([label, value]) => (
        <div key={label} className="hf-figures__cell"><dt className="hf-sub">{label}</dt><dd className="hf-figure">{value}</dd></div>
      ))}
    </dl>
  );
}

/** Questions to carry on in Chat, as Chat's own follow-up pills. */
function Questions({ card, model, c, limit, onAsk }: { readonly card: HomeCard; readonly model: HomeModel; readonly c: Copy; readonly limit: number; readonly onAsk: (q: string) => void }) {
  const asks = card.actions.filter((action): action is Extract<HomeCardAction, { kind: "ask" }> => action.kind === "ask").map((action) => [action.label, action.question] as const);
  const list = [...asks, ...c.more[model.phase]].slice(0, limit);
  return (
    <div className="hf-pills">
      {list.map(([label, question]) => <button key={label} type="button" className="chat-suggestion" onClick={() => onAsk(question)}>{label}</button>)}
    </div>
  );
}

/** The card's own answers: a reply shows in the block, a question opens Chat. */
function Replies({ card, onAsk, onOpenDay }: { readonly card: HomeCard; readonly onAsk: (q: string) => void; readonly onOpenDay: () => void }) {
  const [said, setSaid] = useState<{ readonly label: string; readonly reply: string } | null>(null);
  if (said) {
    return (
      <div className="hf-reply">
        <span className="hf-reply__you">{said.label}</span>
        <p className="hf-reply__drifty"><span className="hf-sub">Drifty</span>{said.reply}</p>
      </div>
    );
  }
  return (
    <div className="hf-pills">
      {card.actions.map((action) => (
        <button key={action.id} type="button" className="chat-suggestion" onClick={() => {
          if (action.kind === "ack") setSaid({ label: action.label, reply: action.reply });
          else if (action.kind === "ask") onAsk(action.question);
          else onOpenDay();
        }}>{action.label}</button>
      ))}
    </div>
  );
}

export function DriftyVoice({ variant, card, model, lang, appIcons, onAsk, onOpenDay }: {
  readonly variant: VoiceVariant; readonly card: HomeCard; readonly model: HomeModel; readonly lang: HomeLang; readonly appIcons: AppIconMap;
  readonly onAsk: (q: string) => void; readonly onOpenDay: () => void;
}) {
  const c = COPY[lang];
  const side = variant === "d1" || variant === "d4";
  const askLink = variant === "d1" || variant === "d5";
  const primary = card.actions.find((action) => action.kind === "ask");
  const message = (
    <div className="hf-voice__message">
      <p className="hf-voice__title">{card.title}</p>
      {card.body ? <p className="hf-voice__body">{card.body}</p> : null}
      {variant === "d2" || variant === "d4" ? <Questions card={card} model={model} c={c} limit={side ? 2 : 3} onAsk={onAsk} /> : null}
      {variant === "d3" ? <Replies card={card} onAsk={onAsk} onOpenDay={onOpenDay} /> : null}
    </div>
  );
  return (
    <section className={"hf-block hf-voice hf-voice--" + variant} aria-label={card.kicker}>
      <div className="hf-head">
        <span className="insight-section__label">{"Drifty · " + formatClock(card.atMs)}</span>
        {askLink ? <button type="button" className="hf-head__link" onClick={() => onAsk(c.examples[model.phase])}>{c.ask} →</button> : null}
      </div>
      {side ? <div className="hf-voice__split">{message}<Evidence model={model} c={c} appIcons={appIcons} /></div> : message}
      {variant === "d0" ? (
        <div className="hf-voice__actions">
          {primary && primary.kind === "ask" ? <button type="button" className="app-btn app-btn--primary app-btn--compact" onClick={() => onAsk(primary.question)}>{primary.label}</button> : null}
          <AskBox c={c} phase={model.phase} onAsk={onAsk} />
        </div>
      ) : null}
      {variant === "d5" ? <Figures model={model} c={c} /> : null}
    </section>
  );
}
