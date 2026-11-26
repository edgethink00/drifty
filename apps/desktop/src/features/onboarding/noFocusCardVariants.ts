import type { ActivityCategory } from "@drifty/domain";
import { storyCategoryName } from "./storyCategories";
import type { DisplayLanguage } from "../localization/languageCatalog";
import type { TranslationKey } from "../localization/translations";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import type { FirstDayRecap } from "./firstDayStory";

/**
 * Review prototype: other ways to open the first story card on a day with almost no focus, so the
 * dev server can compare them (?driftyNoFocusCard=<variant>). Production always shows "kinds", the
 * chosen card, whose copy lives in the translations.
 * Copy is Korean and English only until one is chosen.
 */
export const NO_FOCUS_CARD_QUERY_PARAM = "driftyNoFocusCard";
export const NO_FOCUS_CARD_VARIANTS = ["places", "kinds", "rhythm", "stays", "reading"] as const;
export type NoFocusCardVariant = (typeof NO_FOCUS_CARD_VARIANTS)[number];

export function noFocusCardVariant(
  search: string = typeof window === "undefined" ? "" : window.location.search,
  isDevelopment: boolean = import.meta.env.DEV,
): NoFocusCardVariant {
  if (!isDevelopment) return "kinds";
  const raw = new URLSearchParams(search).get(NO_FOCUS_CARD_QUERY_PARAM);
  return NO_FOCUS_CARD_VARIANTS.find((variant) => variant === raw) ?? "kinds";
}

type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

const COPY = {
  ko: {
    rhythmTitle: "어제는 {start}부터 {end}까지 브라우저를 썼어요",
    rhythmBody: "가장 많이 쓴 때는 {from}~{to} 사이로, {duration}이었어요.",
    staysTitle: "어제 브라우저에서는 한곳에 평균 {average} 머물렀어요",
    staysBody: "가장 오래 머문 곳은 {source}, {time}부터 {duration}이에요.",
    readingTitle: "Drifty가 어제 브라우저에서 보낸 {total}을 제목까지 읽고 나눴어요",
    readingBody: "사이트 이름만이 아니라 페이지 제목을 보고 무엇을 하던 중인지 가려요.",
    readingPairBody: "같은 {source}에서도 ‘{first}’는 {firstKind}, ‘{second}’는 {secondKind} 봤어요.",
  },
  en: {
    rhythmTitle: "Yesterday your browsing ran from {start} to {end}",
    rhythmBody: "It was busiest between {from} and {to}, with {duration}.",
    staysTitle: "Yesterday you stayed {average} on a site on average",
    staysBody: "The longest was {source}: {duration} from {time}.",
    readingTitle: "Drifty read {total} of your browsing yesterday, page titles and all",
    readingBody: "It looks at page titles, not only sites, to tell what you were doing.",
    readingPairBody: "Even on {source}, it read “{first}” as {firstKind} and “{second}” as {secondKind}.",
  },
} as const;

/** A Korean word with 로 or 으로, by its last syllable (ㄹ and open syllables take 로). */
function withRo(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return word + "로";
  const coda = code % 28;
  return word + (coda === 0 || coda === 8 ? "로" : "으로");
}

function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/gu, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** A clock hour on the chart (first hour + index) as a time label in the display language. */
export function chartHourLabel(recap: FirstDayRecap, hourIndex: number, language: DisplayLanguage): string {
  const date = new Date(recap.day + "T00:00:00");
  date.setHours(recap.firstHour + hourIndex, 0, 0, 0);
  return formatLocalizedTimeLabel(date, language);
}

/** Title and body of the first card for a prototype variant; null for the shipped kinds card and the places card. */
export function noFocusCardText(
  variant: NoFocusCardVariant,
  recap: FirstDayRecap,
  language: DisplayLanguage,
  t: Translate,
): { readonly title: string; readonly body: string } | null {
  if (variant === "places" || variant === "kinds") return null;
  const copy = language === "ko" ? COPY.ko : COPY.en;
  const duration = (seconds: number) => formatLocalizedCompactDurationFromSeconds(seconds, language);
  const time = (iso: string) => formatLocalizedTimeLabel(iso, language);
  switch (variant) {
    case "rhythm": {
      if (!recap.span) return null;
      const busiest = recap.busiestHours;
      return {
        title: fill(copy.rhythmTitle, { start: time(recap.span.startedAt), end: time(recap.span.endedAt) }),
        body: busiest ? fill(copy.rhythmBody, {
          from: chartHourLabel(recap, busiest.fromHour, language),
          to: chartHourLabel(recap, busiest.toHour, language),
          duration: duration(busiest.seconds),
        }) : "",
      };
    }
    case "stays": {
      const longest = recap.stays.longest;
      return {
        title: fill(copy.staysTitle, { average: duration(recap.stays.averageSeconds) }),
        body: longest ? fill(copy.staysBody, { source: longest.source.label, time: time(longest.startedAt), duration: duration(longest.seconds) }) : "",
      };
    }
    case "reading": {
      const { pair } = readingRows(recap);
      const [first, second] = pair ?? [];
      const kind = (category: ActivityCategory) => language === "ko" ? storyCategoryName(category, t) : storyCategoryName(category, t).toLowerCase();
      return {
        title: fill(copy.readingTitle, { total: duration(recap.classifiedSeconds) }),
        body: first && second ? fill(copy.readingPairBody, {
          source: first.source.label,
          first: first.title,
          firstKind: kind(first.category),
          second: second.title,
          secondKind: language === "ko" ? withRo(kind(second.category)) : kind(second.category),
        }) : copy.readingBody,
      };
    }
  }
}


/**
 * The titles the reading card shows. Two titles from one site that Drifty sorted differently are the
 * clearest sign it reads the page and not only the site, so such a pair comes first.
 */
export function readingRows(recap: FirstDayRecap): {
  readonly rows: FirstDayRecap["examples"];
  readonly pair: readonly [FirstDayRecap["examples"][number], FirstDayRecap["examples"][number]] | null;
} {
  const examples = recap.examples;
  for (let index = 0; index < examples.length; index += 1) {
    const partner = examples.slice(index + 1).find((other) => other.source.key === examples[index].source.key && other.category !== examples[index].category);
    if (partner) {
      return { rows: [examples[index], partner, ...examples.filter((example) => example !== examples[index] && example !== partner)], pair: [examples[index], partner] };
    }
  }
  return { rows: examples, pair: null };
}

