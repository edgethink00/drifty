import type { ActivityCategory } from "@drifty/domain";
import { storyCategoryName, storyKindsList } from "./storyCategories";
import type { DisplayLanguage } from "../localization/languageCatalog";
import type { TranslationKey } from "../localization/translations";
import { formatLocalizedCompactDurationFromSeconds, formatLocalizedTimeLabel } from "../../lib/formatting";
import type { FirstDayRecap } from "./firstDayStory";
import type { FirstDaySource } from "./firstDayPreparationStory";
import type { IntroLayout } from "./postOnboardingSidebarGuide";

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
    readingSiteBody: "같은 {source}도 페이지 {count}개를 하나씩 보고 {kinds} 나눴어요.",
  },
  en: {
    rhythmTitle: "Yesterday your browsing ran from {start} to {end}",
    rhythmBody: "It was busiest between {from} and {to}, with {duration}.",
    staysTitle: "Yesterday you stayed {average} on a site on average",
    staysBody: "The longest was {source}: {duration} from {time}.",
    readingTitle: "Drifty read {total} of your browsing yesterday, page titles and all",
    readingBody: "It looks at page titles, not only sites, to tell what you were doing.",
    readingSiteBody: "Even on {source}, it read {count} pages one by one and sorted them into {kinds}.",
  },
} as const;

/** The final consonant of a Korean word's last syllable (0 when open), or -1 when it does not end in Hangul. */
function finalConsonant(word: string): number {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code < 0 || code > 11171 ? -1 : code % 28;
}

/** A Korean word with 로 or 으로 (ㄹ and open syllables take 로). */
function withRo(word: string): string {
  const coda = finalConsonant(word);
  return word + (coda <= 0 || coda === 8 ? "로" : "으로");
}

/** A Korean word with 와 or 과. */
function withWa(word: string): string {
  return word + (finalConsonant(word) > 0 ? "과" : "와");
}

/** Up to three kind names as one phrase, "and more" past three: "작업과 학습으로", "entertainment, music and work". */
function kindsPhrase(all: readonly string[], language: DisplayLanguage): string {
  const names = all.slice(0, 3), more = all.length > 3;
  if (language === "ko") {
    if (more) return names.join(", ") + " 등으로";
    if (names.length === 2) return withWa(names[0]) + " " + withRo(names[1]);
    return names.slice(0, -1).join(", ") + (names.length > 1 ? ", " : "") + withRo(names[names.length - 1] ?? "");
  }
  const lower = names.map((name) => name.toLowerCase());
  if (more) return lower.join(", ") + " and more";
  return lower.length > 1 ? lower.slice(0, -1).join(", ") + " and " + lower[lower.length - 1] : lower[0] ?? "";
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
      const view = readingView(recap);
      return {
        title: fill(copy.readingTitle, { total: duration(recap.classifiedSeconds) }),
        body: view.site ? fill(copy.readingSiteBody, {
          source: view.site.source.label,
          count: view.site.pageCount,
          kinds: kindsPhrase(view.site.kinds.map((kind) => storyCategoryName(kind.category, t)), language),
        }) : copy.readingBody,
      };
    }
  }
}

/** One line of the reading card: a page title and how Drifty read it, or how many pages of one kind there were. */
export type ReadingRow = {
  readonly category: ActivityCategory;
  readonly source: FirstDaySource;
  /** The page's title; absent when no one page stands for the kind (a day of short videos). */
  readonly title?: string;
  /** Other pages in the same kind on the site, or every page of the kind when there is no title. */
  readonly pages: number;
};

/**
 * What the reading card shows. A site whose pages Drifty sorted into several kinds comes first: one row
 * per kind in the order of its time, each with its longest page. The site's main kind names that page
 * only when it holds at least a tenth of the kind's time, so a page does not stand for sixty short videos
 * it happened to outlast; otherwise the row counts the kind's pages. Without such a site, the rows are
 * the day's longest page in each of up to three kinds.
 */
export function readingView(recap: FirstDayRecap): { readonly site: FirstDayRecap["readingSite"]; readonly rows: readonly ReadingRow[] } {
  const site = recap.readingSite;
  if (!site) return { site: null, rows: recap.examples.map((page) => ({ category: page.category, source: page.source, title: page.title, pages: 0 })) };
  const rows: ReadingRow[] = [];
  site.kinds.forEach((kind, index) => {
    if (rows.length >= 3) return;
    const page = kind.page;
    if (index === 0 && (!page || page.seconds * 10 < kind.seconds)) rows.push({ category: kind.category, source: site.source, pages: kind.pageCount });
    else if (page) rows.push({ category: kind.category, source: site.source, title: page.title, pages: kind.pageCount - 1 });
  });
  return { site, rows };
}


const BREAKDOWN_COPY = {
  ko: {
    kindsTitle: "종류별로 나눠 보면 이래요",
    kindsBody: "많은 순서대로 {list}이었어요.",
    readingTitle: "Drifty는 페이지 제목까지 읽고 나눠요",
    readingBody: "사이트 이름만 보고 나누지 않고, 페이지 제목을 보고 무엇을 하던 중인지 가려요.",
    driftHint: "딴짓이 아니었다면 ‘분류’에서 바로잡을 수 있어요. 고치면 지난 기록에도 함께 적용돼요.",
    quietHint: "분류가 내 일과 다르면 ‘분류’에서 바로잡을 수 있어요.",
  },
  en: {
    kindsTitle: "Here it is by kind",
    kindsBody: "From the most: {list}.",
    readingTitle: "Drifty reads page titles, not only sites",
    readingBody: "It looks at what a page is about to tell what you were doing there.",
    driftHint: "If some of it wasn't drift, fix it in Classification. The fix applies to earlier records too.",
    quietHint: "If a label doesn't fit your work, fix it in Classification.",
  },
} as const;

/**
 * Whether the day has enough to show how Drifty read pages: a site it sorted several ways, or pages in
 * at least two kinds. One page alone says little, so such a day has no reading card.
 */
export function hasReadingCard(recap: FirstDayRecap): boolean {
  return recap.readingSite !== null || recap.examples.length >= 2;
}

/**
 * Review prototype: what the six-card story's middle card shows in a layout, or null when the day has
 * nothing for it and the story goes on with five cards. A story that opened on focus ("rebalanced")
 * follows with the day by kind; one that opened by kind follows with its focus when it had some
 * ("overview"), else with how Drifty read its pages.
 */
export function breakdownContent(recap: FirstDayRecap, layout: IntroLayout): "focus" | "kinds" | "reading" | null {
  const reading = hasReadingCard(recap) ? "reading" as const : null;
  if (layout === "rebalanced") return recap.lead === "kinds" ? reading : "kinds";
  if (layout === "overview" && recap.lead !== "kinds" && recap.longestFocus) return "focus";
  return reading;
}

/**
 * Review prototype, the six-card story's middle card when it is not the focus card: the day by kind, or
 * the titles Drifty read and how it sorted them.
 */
export function breakdownCardText(
  recap: FirstDayRecap,
  language: DisplayLanguage,
  t: Translate,
  content: "kinds" | "reading",
): { readonly title: string; readonly body: string } {
  const copy = language === "ko" ? BREAKDOWN_COPY.ko : BREAKDOWN_COPY.en;
  if (content === "kinds") {
    const kinds = recap.categories.slice(0, 3);
    return { title: copy.kindsTitle, body: kinds.length > 0 ? fill(copy.kindsBody, { list: storyKindsList(kinds, language, t) }) : "" };
  }
  const reading = noFocusCardText("reading", recap, language, t);
  return { title: copy.readingTitle, body: recap.readingSite && reading ? reading.body : copy.readingBody };
}

/** Review prototype: the drift card's correction line once the separate correcting card is gone. */
export function rebalancedFixHint(language: DisplayLanguage): { readonly drift: string; readonly quiet: string } {
  const copy = language === "ko" ? BREAKDOWN_COPY.ko : BREAKDOWN_COPY.en;
  return { drift: copy.driftHint, quiet: copy.quietHint };
}

