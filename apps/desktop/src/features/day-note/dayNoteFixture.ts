import type { CustomActivityCategory } from "@drifty/domain";
import type { DisplayLanguage } from "../localization/languagePreference";

/**
 * A made-up week for the design review. The lab notes on the owner's real days
 * live outside Git (apps/desktop/scripts/eval-day-note); this sample only has
 * their shape: a headline, up to five things done (each with a short label for
 * the work), and one line on where time leaked. Like the real notes, a line
 * names the work, not the app it happened in, unless the app is what it was
 * about (only 22 of 231 real lines named an app), and says nothing of when or
 * for how long (2026-10-11: no times anywhere in the note's words). Each day is laid out as
 * tracked spans with their productivity and category, and every time on screen
 * (an item's, the leak's, the day's totals) is summed from those spans, the way
 * the shipped note takes its times from the app rather than from the model.
 *
 * Today so far (2026-10-12) is its own record: the note's page puts it on the
 * right, next to yesterday. Its items share labels with earlier days on
 * purpose, the way the lab's notes keep a short name for the same work, so the
 * page can count how long each has run: Checkout v3 five noted days, the API a
 * second day, the refund policy back after two days, the release notes new.
 */
export type LocalText = Readonly<Record<DisplayLanguage, string>>;
export type DayNoteSource = { readonly app: string; readonly site?: string };

export type DayKind = "focus" | "drift" | "neutral";
/** The app's activity categories, as Your Day colours them. */
export type DayCategory = "workspace" | "learning" | "communication" | "socialMedia" | "entertainment" | "utility" | "music" | "game" | "shopping" | "unknown" | CustomActivityCategory;
/** What a span belongs to in the note: an item's index, the leak, or nothing the note names. */
export type DayRef = number | "leak";
/** Minutes after midnight. */
export type DaySpan = {
  readonly start: number;
  readonly end: number;
  readonly kind: DayKind;
  readonly category: DayCategory;
  readonly ref?: DayRef;
  /** The project the span is assigned to, when the user has projects. */
  readonly project?: string;
  /** App, bundle and site of a recorded span (review exports only); absent for private sites. */
  readonly app?: string;
  readonly bundleId?: string;
  readonly site?: string;
};

export type DayNoteItem = {
  readonly text: LocalText;
  /** A few words for the item's row on the day grid. */
  readonly label: LocalText;
  readonly seconds: number;
  readonly source: DayNoteSource;
};

export type DayNoteSample = {
  readonly headline: LocalText;
  readonly items: readonly DayNoteItem[];
  readonly leak: { readonly text: LocalText; readonly seconds: number };
  readonly trackedSeconds: number;
};

/** One recorded day: its spans, and its note (null when the day was too thin for one). */
export type DayRecord = { readonly spans: readonly DaySpan[]; readonly note: DayNoteSample | null };

/** What a day without Intelligence still shows: the longest-open titles, no model. */
export type DayNoteTitle = { readonly title: string; readonly label: string; readonly seconds: number; readonly source: DayNoteSource; readonly ref: number };

const DEFAULT_CATEGORY: Record<DayKind, DayCategory> = { focus: "workspace", neutral: "utility", drift: "entertainment" };

type Step = readonly [DayKind | "gap", number, DayRef?, DayCategory?];
type ItemDraft = readonly [label: LocalText, ko: string, en: string, app: string, site?: string];
type NoteDraft = { readonly headline: LocalText; readonly items: readonly ItemDraft[]; readonly leak: LocalText };

function minutesOf(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function lay(start: string, steps: readonly Step[]): DaySpan[] {
  let at = minutesOf(start);
  const spans: DaySpan[] = [];
  for (const [kind, minutes, ref, category] of steps) {
    if (kind !== "gap") {
      const span: DaySpan = { start: at, end: at + minutes, kind, category: category ?? DEFAULT_CATEGORY[kind] };
      spans.push(ref === undefined ? span : { ...span, ref });
    }
    at += minutes;
  }
  return spans;
}

export function spanSeconds(spans: readonly DaySpan[], match: (span: DaySpan) => boolean): number {
  return spans.reduce((sum, span) => (match(span) ? sum + (span.end - span.start) * 60 : sum), 0);
}

function day(start: string, steps: readonly Step[], draft: NoteDraft | null): DayRecord {
  const spans = lay(start, steps);
  if (!draft) return { spans, note: null };
  return {
    spans,
    note: {
      headline: draft.headline,
      items: draft.items.map(([label, ko, en, app, site], index) => ({
        text: { ko, en },
        label,
        seconds: spanSeconds(spans, (span) => span.ref === index),
        source: site ? { app, site } : { app },
      })),
      leak: { text: draft.leak, seconds: spanSeconds(spans, (span) => span.ref === "leak") },
      trackedSeconds: spanSeconds(spans, () => true),
    },
  };
}

const label = (ko: string, en: string = ko): LocalText => ({ ko, en });

/** Today until now: what the right card of today's page is written from. */
/*
 * Shaped like the owner's real days (10/4-10/12, 2026-10-13): a few focus
 * stretches past 25 minutes among many short ones, and drift breaks between
 * them, so the day's figures have something real to count.
 */
export const DAY_NOTE_TODAY: DayRecord = day(
  "09:05",
  [
    ["neutral", 12, undefined, "communication"], ["focus", 9, 3], ["drift", 4], ["focus", 52, 0], ["neutral", 6],
    ["focus", 14, 1], ["drift", 11, "leak", "socialMedia"], ["focus", 7], ["neutral", 5, undefined, "communication"], ["gap", 45],
    ["focus", 33, 1], ["drift", 6, "leak"], ["focus", 12, 2], ["neutral", 3], ["focus", 28, 2],
    ["drift", 8, undefined, "socialMedia"], ["focus", 16, 3], ["neutral", 10, undefined, "communication"],
  ],
  {
    headline: { ko: "Checkout v3 마무리와 부분 환불", en: "Finishing Checkout v3 and partial refunds" },
    items: [
      [label("Checkout v3"), "Checkout v3 결제 완료 화면을 다듬었다.", "Polished the Checkout v3 confirmation screen.", "Figma"],
      [label("payments-api"), "payments-api에 부분 환불 테스트를 작성했다.", "Wrote partial-refund tests in payments-api.", "Visual Studio Code"],
      [label("환불 정책", "Refund policy"), "‘환불 정책 초안’에 부분 환불 조항을 넣었다.", "Added a partial-refund clause to the ‘Refund policy draft’.", "Arc", "docs.google.com"],
      [label("릴리즈 노트", "Release notes"), "10월 릴리즈 노트 초안을 썼다.", "Drafted the October release notes.", "Notion"],
    ],
    leak: { ko: "YouTube를 봤다.", en: "YouTube." },
  },
);

/** Newest first: index 0 is yesterday. */
export const DAY_NOTE_DAYS: readonly DayRecord[] = [
  day(
    "08:40",
    [
      ["neutral", 28, undefined, "communication"], ["focus", 22], ["focus", 30, 1, "communication"], ["neutral", 5],
      ["focus", 75, 0], ["neutral", 15], ["focus", 65, 2], ["gap", 50], ["focus", 35, 2], ["gap", 5],
      ["drift", 42, "leak"], ["gap", 28], ["focus", 18, 3], ["neutral", 6], ["focus", 16, 1, "communication"], ["gap", 10],
      ["focus", 33, 0], ["gap", 17], ["focus", 30, 2], ["gap", 275], ["drift", 30, "leak", "socialMedia"],
    ],
    {
      headline: { ko: "결제 화면 리디자인과 환불 API 작업을 했다", en: "Checkout redesign and the refunds API" },
      items: [
        [label("Checkout v3"), "‘Checkout v3’ 시안을 v2에서 v5까지 다듬었다.", "Took the ‘Checkout v3’ design from v2 to v5.", "Figma"],
        [label("디자인 싱크", "Design sync"), "주간 디자인 싱크에 참석하고 #design-review 스레드를 정리했다.", "Joined the weekly design sync and went through #design-review.", "Slack"],
        [label("payments-api"), "payments-api의 환불 처리를 작업했다.", "Worked on refund handling in payments-api.", "Visual Studio Code"],
        [label("PAY-214"), "‘PAY-214 부분 환불’ 이슈를 살펴봤다.", "Looked into ‘PAY-214 Partial refunds’.", "Arc", "linear.app"],
      ],
      leak: { ko: "YouTube와 x.com을 오가며 봤다.", en: "Went back and forth between YouTube and x.com." },
    },
  ),
  day(
    "09:20",
    [
      ["neutral", 20, undefined, "communication"], ["focus", 90, 0], ["neutral", 10], ["focus", 40, 1], ["gap", 60],
      ["drift", 55, "leak"], ["focus", 25, 1], ["neutral", 15], ["focus", 25, 2, "communication"], ["focus", 30, 3],
      ["gap", 120], ["neutral", 30, undefined, "communication"],
    ],
    {
      headline: { ko: "온보딩 카피 정리와 결제 QA", en: "Onboarding copy and checkout QA" },
      items: [
        [label("온보딩 카피", "Onboarding copy"), "온보딩 1–3단계 문구를 ‘Onboarding copy v4’로 정리했다.", "Rewrote onboarding steps 1–3 as ‘Onboarding copy v4’.", "Notion"],
        [label("결제 QA", "Checkout QA"), "스테이징에서 결제 흐름 QA 체크리스트를 돌렸다.", "Ran the checkout QA checklist on staging.", "Arc", "staging.example.com"],
        [label("#qa 버그", "#qa bugs"), "#qa 채널에서 버그 세 건을 정리했다.", "Triaged three bugs in #qa.", "Slack"],
        [label("Checkout v3"), "Checkout v3 결제 실패 화면을 그렸다.", "Drew the failed-payment screen for Checkout v3.", "Figma"],
      ],
      leak: { ko: "YouTube를 봤다.", en: "Watched YouTube." },
    },
  ),
  day(
    "09:50",
    [
      ["neutral", 15, undefined, "communication"], ["focus", 80, 0], ["neutral", 20], ["gap", 75], ["focus", 30, 1, "communication"],
      ["neutral", 10], ["focus", 30, 1, "communication"], ["focus", 60, 2], ["neutral", 25],
      ["gap", 335], ["drift", 40, "leak", "socialMedia"],
    ],
    {
      headline: { ko: "환불 정책 문서와 고객 인터뷰 두 건", en: "Refund policy doc and two customer interviews" },
      items: [
        [label("환불 정책", "Refund policy"), "‘환불 정책 초안’ 문서를 작업했다.", "Worked on the ‘Refund policy draft’ doc.", "Arc", "docs.google.com"],
        [label("고객 인터뷰", "Interviews"), "민지, 준호와 고객 인터뷰를 했다.", "Held two customer interviews, with Minji and Junho.", "Zoom"],
        [label("Checkout v3"), "Checkout v3 시안에 리뷰 코멘트를 반영했다.", "Worked the review comments into the Checkout v3 draft.", "Figma"],
      ],
      leak: { ko: "Instagram과 x.com을 봤다.", en: "Instagram and x.com." },
    },
  ),
  day("13:00", [["focus", 40], ["neutral", 20, undefined, "communication"], ["drift", 25], ["gap", 60], ["focus", 30], ["drift", 15, undefined, "socialMedia"]], null),
  day(
    "09:10",
    [
      ["neutral", 20, undefined, "communication"], ["focus", 70, 0], ["neutral", 10], ["focus", 50, 0], ["gap", 70],
      ["focus", 45, 1, "learning"], ["focus", 50], ["neutral", 20], ["gap", 75], ["drift", 30, "leak", "socialMedia"],
      ["focus", 40], ["neutral", 15, undefined, "communication"],
    ],
    {
      headline: { ko: "Checkout v3 첫 시안과 경쟁사 리서치", en: "First Checkout v3 draft and competitor research" },
      items: [
        [label("Checkout v3"), "‘Checkout v3’ 첫 시안을 만들었다.", "Started the first ‘Checkout v3’ draft.", "Figma"],
        [label("경쟁사 리서치", "Competitors"), "Stripe·Toss 결제 화면을 비교해 살펴봤다.", "Compared the Stripe and Toss checkout screens.", "Arc", "stripe.com"],
      ],
      leak: { ko: "Reddit을 봤다.", en: "Reddit." },
    },
  ),
  day(
    "10:00",
    [
      ["neutral", 15, undefined, "communication"], ["focus", 60, 0, "communication"], ["neutral", 10], ["focus", 85, 1], ["gap", 60],
      ["focus", 55], ["neutral", 30], ["gap", 465], ["drift", 35, "leak"],
    ],
    {
      headline: { ko: "결제 API 설계 회의와 스펙 정리", en: "Payments API design meeting and the spec" },
      items: [
        [label("API 설계 회의", "API meeting"), "‘결제 API 설계’ 회의에 참석했다.", "Joined the ‘Payments API design’ meeting.", "Arc", "meet.google.com"],
        [label("API 스펙", "API spec"), "‘payments-api spec’ 문서를 작업했다.", "Worked on the ‘payments-api spec’ doc.", "Notion"],
      ],
      leak: { ko: "YouTube를 봤다.", en: "YouTube." },
    },
  ),
];

/** Yesterday's note, for the places that only ever show yesterday. */
export const DAY_NOTE_SAMPLE: DayNoteSample = DAY_NOTE_DAYS[0]!.note!;

/** Earlier days, newest first; null is a day with too little recorded for a note. */
export const DAY_NOTE_PAST: readonly (DayNoteSample | null)[] = DAY_NOTE_DAYS.slice(1).map((entry) => entry.note);

/** Yesterday's longest-open titles; each sits where one of the note's items sits on the day, and takes its time from those spans. */
const title = (text: string, short: string, source: DayNoteSource, ref: number): DayNoteTitle => ({
  title: text,
  label: short,
  seconds: spanSeconds(DAY_NOTE_DAYS[0]!.spans, (span) => span.ref === ref),
  source,
  ref,
});

export const DAY_NOTE_TITLES: readonly DayNoteTitle[] = [
  title("refunds.ts — payments-api", "refunds.ts", { app: "Visual Studio Code" }, 2),
  title("Checkout v3 – Figma", "Checkout v3", { app: "Figma" }, 0),
  title("주간 디자인 싱크 – Google Meet", "디자인 싱크", { app: "Arc", site: "meet.google.com" }, 1),
  title("PAY-214 부분 환불 – Linear", "PAY-214", { app: "Arc", site: "linear.app" }, 3),
];
