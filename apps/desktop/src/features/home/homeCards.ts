import type { HomeModel, HomeWorkItem } from "./homeModel";
import { weekDiscovery } from "./homeModel";

/*
 * What the Home preview says, written by rules from HomeModel. No model call:
 * every sentence restates numbers and titles already on this computer.
 */

export type HomeLang = "ko" | "en";

export type HomeCardAction =
  | { readonly id: string; readonly kind: "ack"; readonly label: string; readonly reply: string }
  | { readonly id: string; readonly kind: "ask"; readonly label: string; readonly question: string }
  | { readonly id: string; readonly kind: "open-day"; readonly label: string };

export type HomeCardKind = "recap" | "pace" | "wrap" | "start" | "discovery" | "drift" | "goal" | "record" | "ask";

export type HomeCard = {
  readonly id: string;
  readonly kind: HomeCardKind;
  readonly kicker: string;
  readonly title: string;
  readonly body?: string;
  /** The work the card is about, shown with its app's icon. */
  readonly items?: readonly HomeWorkItem[];
  readonly actions: readonly HomeCardAction[];
  /** When the card would have been said, for the conversation layout. */
  readonly atMs: number;
};

const WEEKDAYS = {
  ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

export function formatDuration(seconds: number, lang: HomeLang): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (lang === "ko") {
    if (hours === 0) return rest + "분";
    return rest === 0 ? hours + "시간" : hours + "시간 " + rest + "분";
  }
  if (hours === 0) return rest + "m";
  return rest === 0 ? hours + "h" : hours + "h " + rest + "m";
}

export function formatShortDuration(seconds: number): string {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return Math.floor(minutes / 60) + ":" + String(minutes % 60).padStart(2, "0");
}

export function formatClock(ms: number): string {
  const date = new Date(ms);
  return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
}

function hourLabel(hour: number, lang: HomeLang): string {
  if (lang === "ko") return (hour < 12 ? "오전 " : "오후 ") + (hour % 12 === 0 ? 12 : hour % 12) + "시대";
  return (hour % 12 === 0 ? 12 : hour % 12) + (hour < 12 ? " a.m." : " p.m.") + " hour";
}

function quote(item: HomeWorkItem, lang: HomeLang): string {
  if (item.label === item.source) return item.label;
  return lang === "ko" ? "‘" + item.label + "’" : "“" + item.label + "”";
}

function weekdayOf(day: string, lang: HomeLang): string {
  return WEEKDAYS[lang][new Date(day + "T12:00:00").getDay()];
}

function recapCard(model: HomeModel, lang: HomeLang): HomeCard {
  const atMs = model.firstStartMs ?? model.asOfMs;
  const y = model.yesterday;
  if (!y || y.topItems.length === 0) {
    return {
      id: "recap", kind: "start", atMs,
      kicker: lang === "ko" ? "아침" : "Morning",
      title: lang === "ko" ? "어제는 집중으로 남은 기록이 없어요." : "Yesterday left no focus on record.",
      body: lang === "ko" ? "오늘 첫 집중이 시작되면 여기서 페이스를 알려 드릴게요." : "Once today's first focus starts, the pace shows up here.",
      actions: [{ id: "open-day", kind: "open-day", label: lang === "ko" ? "Your Day 보기" : "Open Your Day" }],
    };
  }
  const [first, second] = y.topItems;
  const pick = y.lastItem ?? first;
  const title = lang === "ko"
    ? "어제는 " + quote(first, lang) + "에서 가장 오래 집중했어요."
    : "Yesterday your longest focus went to " + quote(first, lang) + ".";
  const parts: string[] = [];
  if (second) parts.push(lang === "ko" ? "그다음은 " + quote(second, lang) + "." : "Next came " + quote(second, lang) + ".");
  parts.push(lang === "ko"
    ? "집중 " + formatDuration(y.slice.focus, lang) + ", 딴짓 " + formatDuration(y.slice.drift, lang) + "."
    : "Focus " + formatDuration(y.slice.focus, lang) + ", drift " + formatDuration(y.slice.drift, lang) + ".");
  parts.push(lang === "ko"
    ? "마지막엔 " + quote(pick, lang) + "에 오래 머물렀어요. 오늘 여기서 이어가면 돼요."
    : "The last long stretch was " + quote(pick, lang) + ". Pick it up from there.");
  return {
    id: "recap", kind: "recap", atMs, kicker: lang === "ko" ? "아침 · 어제 정리" : "Morning · Yesterday", title, body: parts.join(" "), items: y.topItems,
    actions: [
      { id: "continue", kind: "ack", label: lang === "ko" ? "여기서 이어갈게" : "I'll pick it up", reply: lang === "ko" ? "좋아요. 낮에 얼마나 이어졌는지 알려 드릴게요." : "Good. I'll tell you how far it went by midday." },
      { id: "why", kind: "ask", label: lang === "ko" ? "어제 더 자세히" : "More on yesterday", question: lang === "ko" ? "어제 한 일을 정리해 줘" : "Summarize what I did yesterday" },
      { id: "other", kind: "ack", label: lang === "ko" ? "오늘은 다른 일" : "Something else today", reply: lang === "ko" ? "알겠어요. 오늘 가장 오래 붙잡는 일을 따라갈게요." : "Got it. I'll follow whatever holds you longest today." },
    ],
  };
}

function paceCard(model: HomeModel, lang: HomeLang): HomeCard {
  const weekday = weekdayOf(model.today, lang);
  const pace = model.paceSeconds;
  let title: string;
  if (pace === null) {
    title = lang === "ko" ? "오늘 지금까지 " + formatDuration(model.now.focus, lang) + " 집중했어요." : "You've focused " + formatDuration(model.now.focus, lang) + " so far today.";
  } else if (Math.abs(pace) < 10 * 60) {
    title = lang === "ko" ? "평소 " + weekday + "과 비슷한 페이스예요." : "Right on your usual " + weekday + " pace.";
  } else if (pace > 0) {
    title = lang === "ko" ? "평소 " + weekday + "보다 " + formatDuration(pace, lang) + " 앞서 있어요." : formatDuration(pace, lang) + " ahead of a usual " + weekday + ".";
  } else {
    title = lang === "ko" ? "평소 " + weekday + "보다 " + formatDuration(-pace, lang) + " 느려요." : formatDuration(-pace, lang) + " behind a usual " + weekday + ".";
  }
  const parts: string[] = [];
  const longest = model.pattern.longestFocus;
  if (longest && model.topFocusItem) {
    parts.push(lang === "ko"
      ? quote(model.topFocusItem, lang) + "에서 가장 오래 집중했고, 가장 긴 집중은 " + formatClock(longest.startMs) + "부터 " + formatDuration(longest.seconds, lang) + "이었어요."
      : "Most focus went to " + quote(model.topFocusItem, lang) + "; the longest stretch ran " + formatDuration(longest.seconds, lang) + " from " + formatClock(longest.startMs) + ".");
  }
  const remaining = model.goalSeconds - model.now.focus;
  parts.push(remaining > 0
    ? (lang === "ko" ? "목표까지 " + formatDuration(remaining, lang) + " 남았어요." : formatDuration(remaining, lang) + " to your goal.")
    : (lang === "ko" ? "오늘 목표는 이미 채웠어요." : "Today's goal is already met."));
  return {
    id: "pace", kind: "pace", atMs: model.asOfMs, kicker: lang === "ko" ? "지금 · 페이스" : "Now · Pace", title, body: parts.join(" "), items: model.topFocusItems.slice(0, 2),
    actions: [
      { id: "keep", kind: "ack", label: lang === "ko" ? "좋아, 이어서" : "Keep going", reply: lang === "ko" ? "좋아요. 저녁에 오늘 하루를 정리해 드릴게요." : "Good. I'll wrap up the day this evening." },
      { id: "why", kind: "ask", label: lang === "ko" ? "왜 그렇게 봤어?" : "How do you know?", question: lang === "ko" ? "오늘 지금까지의 집중 시간을 지난 4주 같은 요일 같은 시각과 비교해 줘" : "Compare my focus so far today with the same weekday and time over the last four weeks" },
      { id: "day", kind: "open-day", label: lang === "ko" ? "오늘 흐름 보기" : "See today" },
    ],
  };
}

function wrapCard(model: HomeModel, lang: HomeLang): HomeCard {
  const met = model.now.focus >= model.goalSeconds;
  const title = met
    ? (lang === "ko" ? "목표 " + formatDuration(model.goalSeconds, lang) + "을 채웠어요. 최근 7일 중 " + model.goalMetDays + "번째예요." : "Goal of " + formatDuration(model.goalSeconds, lang) + " met, " + model.goalMetDays + " of the last 7 days.")
    : (lang === "ko" ? "오늘은 목표까지 " + formatDuration(model.goalSeconds - model.now.focus, lang) + " 남기고 마쳐요." : "Today ends " + formatDuration(model.goalSeconds - model.now.focus, lang) + " short of the goal.");
  const parts: string[] = [lang === "ko"
    ? "집중 " + formatDuration(model.now.focus, lang) + ", 딴짓 " + formatDuration(model.now.drift, lang) + "."
    : "Focus " + formatDuration(model.now.focus, lang) + ", drift " + formatDuration(model.now.drift, lang) + "."];
  if (model.topFocusItem) parts.push(lang === "ko" ? "가장 오래 머문 곳은 " + quote(model.topFocusItem, lang) + "." : "Longest on " + quote(model.topFocusItem, lang) + ".");
  if (model.topDrift && model.now.drift >= 10 * 60) parts.push(lang === "ko" ? "딴짓은 대부분 " + model.topDrift.label + "에서 했어요." : "Most drift went to " + model.topDrift.label + ".");
  return {
    id: "wrap", kind: "wrap", atMs: model.asOfMs, kicker: lang === "ko" ? "저녁 · 하루 마무리" : "Evening · Wrap-up", title, body: parts.join(" "), items: model.topFocusItems,
    actions: [
      { id: "tomorrow", kind: "ack", label: lang === "ko" ? "내일 이어갈 일로 기억해 줘" : "Remember for tomorrow", reply: lang === "ko" ? "기억했어요. 내일 아침 카드에서 다시 말할게요." : "Saved. I'll bring it up tomorrow morning." },
      { id: "standup", kind: "ask", label: lang === "ko" ? "오늘 한 일 정리해 줘" : "Write up today", question: lang === "ko" ? "오늘 한 일을 스탠드업 형식으로 정리해 줘" : "Write up what I did today as a standup" },
      { id: "day", kind: "open-day", label: lang === "ko" ? "오늘 흐름 보기" : "See today" },
    ],
  };
}

/** The card at the top of Home: yesterday in the morning, pace by day, the wrap-up at night. */
export function topCard(model: HomeModel, lang: HomeLang): HomeCard {
  if (model.phase === "morning") return recapCard(model, lang);
  if (model.phase === "evening") return wrapCard(model, lang);
  return paceCard(model, lang);
}

export function feedCards(model: HomeModel, lang: HomeLang): HomeCard[] {
  const cards: HomeCard[] = [];
  if (model.weekRecord && model.pattern.longestFocus && model.topFocusItem) {
    const run = model.pattern.longestFocus;
    cards.push({
      id: "record", kind: "record", atMs: run.endMs,
      kicker: lang === "ko" ? "기록 갱신" : "New best",
      title: lang === "ko" ? "최근 7일 중 가장 긴 집중이에요." : "Your longest focus of the last 7 days.",
      body: lang === "ko" ? formatClock(run.startMs) + "부터 " + formatDuration(run.seconds, lang) + " 동안 이어졌어요." : formatDuration(run.seconds, lang) + " from " + formatClock(run.startMs) + ".",
      actions: [],
    });
  }
  const discovery = weekDiscovery(model);
  if (discovery) {
    const title = discovery.kind === "same-hour"
      ? (lang === "ko" ? "최근 7일 가장 긴 집중 " + discovery.of + "번 중 " + discovery.count + "번이 " + hourLabel(discovery.hour, lang) + "에 시작했어요." : discovery.count + " of your last " + discovery.of + " longest focus stretches began in the " + hourLabel(discovery.hour, lang) + ".")
      : discovery.kind === "morning-heavy"
        ? (lang === "ko" ? "최근 7일 가장 긴 집중은 대부분 오전에 시작했어요." : "Your longest focus mostly started in the morning this week.")
        : (lang === "ko" ? "최근 7일 가장 긴 집중은 대부분 오후에 시작했어요." : "Your longest focus mostly started in the afternoon this week.");
    cards.push({
      id: "discovery", kind: "discovery", atMs: model.firstStartMs ?? model.asOfMs,
      kicker: lang === "ko" ? "발견" : "Pattern",
      title,
      body: lang === "ko" ? "내일도 그 시간을 비워 두면 좋겠어요." : "Worth keeping that time clear tomorrow.",
      actions: [
        { id: "remember", kind: "ack", label: lang === "ko" ? "기억해 줘" : "Remember this", reply: lang === "ko" ? "기억했어요. 내일 아침 카드에서 그 시간을 다시 말할게요." : "Saved. Tomorrow morning's card will mention it." },
        { id: "dismiss", kind: "ack", label: lang === "ko" ? "괜찮아" : "Not now", reply: lang === "ko" ? "알겠어요." : "Okay." },
      ],
    });
  }
  if (model.topDrift && model.now.drift >= 10 * 60) {
    const share = Math.round((model.topDrift.seconds / Math.max(1, model.now.drift)) * 100);
    cards.push({
      id: "drift", kind: "drift", atMs: model.lastDriftEndMs ?? model.asOfMs,
      kicker: lang === "ko" ? "딴짓" : "Drift",
      title: share >= 95
        ? (lang === "ko" ? "오늘 딴짓 " + formatDuration(model.now.drift, lang) + "은 모두 " + model.topDrift.label + "에서 했어요." : "All " + formatDuration(model.now.drift, lang) + " of today's drift went to " + model.topDrift.label + ".")
        : (lang === "ko" ? "오늘 딴짓 " + formatDuration(model.now.drift, lang) + " 중 " + share + "%는 " + model.topDrift.label + "에서 했어요." : share + "% of today's " + formatDuration(model.now.drift, lang) + " of drift went to " + model.topDrift.label + "."),
      body: model.baseline.days === 0 ? undefined
        : model.baseline.drift < 60
          ? (lang === "ko" ? "평소 이 시각까지는 딴짓이 거의 없었어요." : "By this time you usually have next to no drift.")
          : (lang === "ko" ? "평소 이 시각까지 딴짓은 " + formatDuration(model.baseline.drift, lang) + "이었어요." : "By this time you usually drift " + formatDuration(model.baseline.drift, lang) + "."),
      items: [model.topDrift],
      actions: [],
    });
  }
  if (model.phase !== "morning") {
    cards.push({
      id: "ask", kind: "ask", atMs: model.asOfMs,
      kicker: lang === "ko" ? "물어보기" : "Ask",
      title: lang === "ko" ? "이번 주에는 무엇에 시간을 가장 많이 썼을까요?" : "Where did most of this week go?",
      actions: [{ id: "ask-week", kind: "ask", label: lang === "ko" ? "Chat에서 물어보기" : "Ask in Chat", question: lang === "ko" ? "이번 주 뭐에 시간을 제일 많이 썼어?" : "What did I spend the most time on this week?" }],
    });
  }
  return cards;
}

/** The conversation layout: what Drifty would have said so far today, oldest first. */
export function threadCards(model: HomeModel, lang: HomeLang): HomeCard[] {
  const thread: HomeCard[] = [recapCard(model, lang)];
  for (const card of feedCards(model, lang)) if (card.kind === "record" || card.kind === "discovery" || card.kind === "drift") thread.push(card);
  if (model.phase !== "morning") thread.push(model.phase === "evening" ? wrapCard(model, lang) : paceCard(model, lang));
  return thread.sort((a, b) => a.atMs - b.atMs);
}

/**
 * The numbers as one plain sentence for the sentence-only strip. It states
 * the figures; the card under it says what they mean, so the two never repeat.
 */
export function headlineSentence(model: HomeModel, lang: HomeLang): string {
  const remaining = model.goalSeconds - model.now.focus;
  if (model.now.tracked === 0) {
    return lang === "ko" ? "오늘 기록은 아직 없어요. 목표는 " + formatDuration(model.goalSeconds, lang) + "이에요." : "Nothing recorded yet today. The goal is " + formatDuration(model.goalSeconds, lang) + ".";
  }
  if (lang === "ko") {
    return "지금까지 집중 " + formatDuration(model.now.focus, lang) + ", 딴짓 " + formatDuration(model.now.drift, lang) + "이에요. "
      + (remaining > 0 ? "목표까지 " + formatDuration(remaining, lang) + " 남았어요." : "오늘 목표는 채웠어요.");
  }
  return formatDuration(model.now.focus, lang) + " of focus and " + formatDuration(model.now.drift, lang) + " of drift so far. "
    + (remaining > 0 ? formatDuration(remaining, lang) + " to your goal." : "Today's goal is met.");
}

