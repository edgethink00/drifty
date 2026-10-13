import { DAY_START_HOUR, RECORDED_DAY_SECONDS, SLOTS_PER_DAY, dayMetrics, type InsightsRead, type ReadApp, type ReadDay, type ReadSwitch, type ReadUnlockProgress, type SlotKind } from "./readModel";

/**
 * Synthetic weeks for designing and reviewing the read surface. No real
 * activity: apps are generic, and every number on screen is computed from
 * these slots by readModel, so text and charts cannot disagree.
 */

type Run = readonly [start: string, end: string, kind: Exclude<SlotKind, "-">];

function slotIndex(clock: string): number {
  const [hour, minute] = clock.split(":").map(Number);
  const shifted = ((hour - DAY_START_HOUR + 24) % 24) * 60 + minute;
  return Math.round(shifted / 15);
}

function day(date: string, runs: readonly Run[]): ReadDay {
  const slots: SlotKind[] = Array.from({ length: SLOTS_PER_DAY }, () => "-");
  for (const [start, end, kind] of runs) {
    const from = slotIndex(start);
    const to = end === "04:00" ? SLOTS_PER_DAY : slotIndex(end);
    for (let index = from; index < to && index < SLOTS_PER_DAY; index += 1) slots[index] = kind;
  }
  return { date, slots: slots.join("") };
}

const HOUR = 3600;
const MIN = 60;

/** Five days open with video before 07:00; two start at the desk. */
const VIDEO_WEEK: readonly ReadDay[] = [
  day("2026-09-21", [["05:30", "06:30", "d"], ["06:30", "07:00", "n"], ["09:45", "11:30", "f"], ["11:30", "12:00", "d"], ["13:15", "15:00", "f"], ["15:00", "15:45", "d"], ["16:00", "17:15", "f"], ["17:15", "17:45", "n"], ["21:00", "22:30", "n"], ["22:30", "23:30", "d"]]),
  day("2026-09-22", [["05:15", "06:15", "d"], ["06:15", "06:45", "n"], ["10:00", "12:00", "f"], ["13:30", "14:15", "d"], ["14:15", "16:30", "f"], ["16:30", "17:00", "n"], ["20:30", "21:15", "f"], ["22:00", "23:15", "d"]]),
  day("2026-09-23", [["08:45", "09:00", "n"], ["09:00", "12:15", "f"], ["12:15", "12:30", "n"], ["13:30", "16:45", "f"], ["16:45", "17:15", "d"], ["17:15", "18:00", "n"], ["19:30", "20:15", "f"]]),
  day("2026-09-24", [["09:15", "09:30", "n"], ["09:30", "12:30", "f"], ["13:15", "13:30", "d"], ["13:30", "17:00", "f"], ["17:00", "17:30", "n"], ["20:00", "20:30", "n"]]),
  day("2026-09-25", [["05:45", "06:45", "d"], ["06:45", "07:00", "n"], ["10:15", "12:15", "f"], ["13:30", "14:30", "f"], ["14:30", "15:30", "d"], ["15:30", "17:00", "f"], ["21:30", "23:45", "d"]]),
  day("2026-09-26", [["06:00", "07:15", "d"], ["10:30", "12:00", "f"], ["12:00", "13:00", "d"], ["15:00", "16:30", "f"], ["16:30", "17:00", "n"], ["21:00", "23:00", "d"]]),
  day("2026-09-27", [["05:50", "06:50", "d"], ["11:00", "12:30", "f"], ["14:00", "15:30", "f"], ["15:30", "16:00", "d"], ["20:00", "21:00", "n"], ["22:00", "00:15", "d"]]),
];

/** The video week's apps, per average day of each group; class totals match the slots above. */
const VIDEO_APPS: readonly ReadApp[] = [
  { id: "code", label: "VS Code", bundleId: "com.microsoft.VSCode", glyph: "VS", kind: "focus", seconds: [130 * MIN, 220 * MIN] },
  { id: "figma", label: "Figma", bundleId: "com.figma.Desktop", glyph: "F", kind: "focus", seconds: [65 * MIN, 105 * MIN] },
  { id: "linear", label: "Linear", bundleId: "com.linear", glyph: "L", kind: "focus", seconds: [35 * MIN, 55 * MIN] },
  { id: "notion", label: "Notion", bundleId: "notion.id", glyph: "N", kind: "focus", seconds: [13 * MIN, 32.5 * MIN] },
  { id: "slack", label: "Slack", bundleId: "com.tinyspeck.slackmacgap", glyph: "S", kind: "neutral", seconds: [30 * MIN, 42 * MIN] },
  { id: "chat", label: "ChatGPT", bundleId: "com.openai.chat", glyph: "G", kind: "neutral", seconds: [25 * MIN, 20 * MIN] },
  { id: "other", label: "Other", glyph: "·", kind: "neutral", seconds: [8 * MIN, 13 * MIN] },
  { id: "yt", label: "YouTube", siteDomain: "youtube.com", glyph: "Y", kind: "drift", seconds: [160 * MIN, 14 * MIN] },
  { id: "x", label: "X", siteDomain: "x.com", glyph: "X", kind: "drift", seconds: [38 * MIN, 8.5 * MIN] },
  { id: "reddit", label: "Reddit", siteDomain: "reddit.com", glyph: "R", kind: "drift", seconds: [24 * MIN, 0] },
];

const VIDEO_SWITCHES: readonly ReadSwitch[] = [
  { a: "code", b: "figma", perDay: [18, 20] },
  { a: "code", b: "linear", perDay: [6, 9] },
  { a: "code", b: "slack", perDay: [12, 14] },
  { a: "code", b: "chat", perDay: [9, 11] },
  { a: "code", b: "yt", perDay: [9, 2] },
  { a: "figma", b: "yt", perDay: [5, 1] },
  { a: "figma", b: "notion", perDay: [4, 7] },
  { a: "figma", b: "slack", perDay: [5, 6] },
  { a: "linear", b: "slack", perDay: [3, 5] },
  { a: "yt", b: "x", perDay: [4, 1] },
  { a: "x", b: "reddit", perDay: [2, 0] },
  { a: "yt", b: "reddit", perDay: [3, 0] },
  { a: "slack", b: "yt", perDay: [2, 0] },
  { a: "notion", b: "chat", perDay: [2, 3] },
];

/** A normal week except Tuesday and Thursday, which filled with neutral time. */
const TWO_DAYS_WEEK: readonly ReadDay[] = [
  day("2026-09-14", [["09:00", "12:00", "f"], ["12:00", "12:30", "n"], ["13:30", "16:30", "f"], ["16:30", "17:00", "d"]]),
  day("2026-09-15", [["09:30", "11:00", "f"], ["11:00", "16:00", "n"], ["16:00", "17:15", "f"], ["17:15", "17:45", "d"]]),
  day("2026-09-16", [["09:00", "12:15", "f"], ["12:15", "12:45", "d"], ["13:30", "16:30", "f"]]),
  day("2026-09-17", [["09:30", "10:00", "n"], ["10:00", "11:30", "f"], ["11:30", "15:30", "n"], ["15:30", "17:00", "f"], ["17:00", "17:30", "d"]]),
  day("2026-09-18", [["09:30", "12:00", "f"], ["13:00", "16:15", "f"], ["16:15", "16:45", "d"]]),
  day("2026-09-19", [["11:00", "12:00", "n"], ["14:00", "16:00", "f"], ["16:00", "16:30", "d"]]),
  day("2026-09-20", [["13:00", "14:00", "n"], ["15:00", "16:30", "f"]]),
];

/** A thin week: two recorded days, nothing to compare. */
const THIN_WEEK: readonly ReadDay[] = [
  day("2026-09-07", [["09:00", "12:00", "f"], ["13:00", "15:30", "f"], ["15:30", "16:00", "d"]]),
  day("2026-09-08", []),
  day("2026-09-09", [["10:00", "10:40", "n"]]),
  day("2026-09-10", []),
  day("2026-09-11", [["09:30", "12:30", "f"], ["13:30", "14:00", "d"], ["14:00", "16:00", "f"]]),
  day("2026-09-12", []),
  day("2026-09-13", []),
];

/** An ordinary, well-recorded week with no claim strong enough to make. */
const PLAIN_WEEK: readonly ReadDay[] = [
  day("2026-08-31", [["08:45", "12:00", "f"], ["12:00", "12:30", "d"], ["13:30", "16:45", "f"], ["16:45", "17:30", "n"], ["20:30", "21:15", "d"]]),
  day("2026-09-01", [["09:15", "11:45", "f"], ["11:45", "12:15", "n"], ["13:15", "17:00", "f"], ["21:00", "21:30", "d"]]),
  day("2026-09-02", [["09:00", "12:15", "f"], ["13:30", "14:00", "d"], ["14:00", "17:15", "f"], ["17:15", "17:45", "n"]]),
  day("2026-09-03", [["08:30", "11:30", "f"], ["11:30", "12:00", "n"], ["13:00", "16:30", "f"], ["20:00", "20:45", "d"]]),
  day("2026-09-04", [["09:30", "12:00", "f"], ["12:00", "12:45", "d"], ["13:45", "16:00", "f"], ["16:00", "16:30", "n"]]),
  day("2026-09-05", [["10:30", "12:00", "n"], ["13:00", "15:00", "f"], ["15:00", "15:30", "d"], ["21:00", "22:00", "d"]]),
  day("2026-09-06", [["11:00", "12:30", "f"], ["14:00", "15:00", "n"], ["20:00", "20:45", "d"]]),
];

export const READ_VIDEO_DAYS: InsightsRead = {
  id: "video-days",
  weekStart: "2026-09-21",
  weekEnd: "2026-09-27",
  generatedOn: "2026-09-28",
  comparableDays: 7,
  status: "read",
  headline: {
    en: "Days that opened with video ran longer, not more focused.",
    ko: "영상으로 시작한 날은 길어졌지만, 집중이 늘지는 않았어요.",
  },
  emphasis: { en: "not more focused.", ko: "집중이 늘지는 않았어요." },
  body: {
    en: "On {a.days}, video came before 07:00. Those days started {firstActivity.gap} earlier and ran {span.gap} longer, yet carried {focus.gap} less focus than the {b.days} that started at the desk.",
    ko: "{a.days} 동안은 7시 전에 영상으로 하루를 열었어요. 그날들은 {firstActivity.gap} 일찍 시작해 {span.gap} 더 길었지만, 책상에서 시작한 {b.days}보다 집중이 {focus.gap} 적었어요.",
  },
  subject: { label: "YouTube", glyph: "Y" },
  evidence: {
    kind: "split",
    groups: [
      { label: { en: "Video before 07:00", ko: "7시 전 영상" }, dates: ["2026-09-21", "2026-09-22", "2026-09-25", "2026-09-26", "2026-09-27"] },
      { label: { en: "Started at the desk", ko: "책상에서 시작" }, dates: ["2026-09-23", "2026-09-24"] },
    ],
    metrics: ["focus", "drift", "firstActivity", "span"],
    apps: VIDEO_APPS,
    switches: VIDEO_SWITCHES,
  },
  notes: {
    focus: { en: "Lower on every video day than on either desk day.", ko: "영상으로 시작한 날은 모두 책상에서 시작한 날보다 낮아요." },
    drift: { en: "Drift grew by more than focus shrank.", ko: "줄어든 집중보다 늘어난 딴짓이 더 커요." },
    firstActivity: { en: "All five had started by 06:00.", ko: "다섯 날 모두 6시까지 시작했어요." },
    span: { en: "Longer days, with long gaps between blocks.", ko: "하루는 길었지만 블록 사이 빈 시간이 길어요." },
    "view.switching": {
      en: "YouTube was on one end of {switch.subject.share.a} of switches on video days and {switch.subject.share.b} on desk days. Switching among work apps stayed about as busy: {switch.work.a} a day against {switch.work.b}.",
      ko: "영상으로 시작한 날은 이동의 {switch.subject.share.a}가 YouTube와 이어졌고, 책상에서 시작한 날은 {switch.subject.share.b}였어요. 작업 앱끼리 오간 횟수는 비슷했어요 (하루 {switch.work.a} 대 {switch.work.b}).",
    },
    "view.flow": {
      en: "YouTube held {app.yt.a} of an average video day against {app.yt.b} on a desk day. VS Code ran {app.code.gap} shorter, and Focus fell from {share.focus.b} to {share.focus.a} of tracked time.",
      ko: "영상으로 시작한 날은 YouTube가 하루 평균 {app.yt.a}, 책상에서 시작한 날은 {app.yt.b}였어요. VS Code는 {app.code.gap} 짧았고, 기록된 시간 중 집중의 비중은 {share.focus.b}에서 {share.focus.a}로 줄었어요.",
    },
  },
  tryNext: {
    action: { en: "On two weekdays, open your work before any video.", ko: "평일 이틀은 영상보다 일을 먼저 여세요." },
    watch: { en: "The next read compares Focus on those days with this week's video days.", ko: "다음 해석이 그날 집중을 이번 주 영상으로 시작한 날과 비교해요." },
  },
  checked: [
    { verdict: "kept", text: { en: "Video mornings ran longer, not more focused", ko: "영상으로 시작한 날은 길어졌지만 집중은 늘지 않음" } },
    { verdict: "dropped", text: { en: "Weekend drift is higher: only two weekend days", ko: "주말 딴짓이 많음: 주말이 이틀뿐" } },
    { verdict: "dropped", text: { en: "Late nights cost the next morning: same days as above", ko: "늦은 밤이 다음 날 아침에 영향: 위와 같은 날" } },
  ],
  days: VIDEO_WEEK,
  followUp: {
    // The Sep 14 read's try, checked against this week's slots: Tuesday 5h 0m of focus (usual 6h 15m), Thursday 6h 30m (usual 6h 30m).
    action: { en: "Hold one two-hour focus block on Tuesday and Thursday", ko: "화요일과 목요일에 두 시간 집중 블록 하나씩" },
    result: "steady",
    detail: { en: "Done on both days. Thursday matched its usual 6h 30m of focus; Tuesday came in 1h 15m short.", ko: "이틀 모두 했어요. 목요일 집중은 평소와 같은 6시간 30분, 화요일은 평소보다 1시간 15분 적었어요." },
  },
};

export const READ_TWO_DAYS: InsightsRead = {
  id: "two-days",
  weekStart: "2026-09-14",
  weekEnd: "2026-09-20",
  generatedOn: "2026-09-21",
  comparableDays: 7,
  status: "read",
  headline: {
    en: "The lower week came down to Tuesday and Thursday.",
    ko: "이번 주 집중이 줄어든 건 화요일과 목요일 때문이에요.",
  },
  emphasis: { en: "Tuesday and Thursday.", ko: "화요일과 목요일" },
  body: {
    en: "{steady.days} landed within half an hour of your usual focus. Tuesday fell {2026-09-15.gap} short and Thursday {2026-09-17.gap}, and the time went to neutral work, not drift.",
    ko: "평소 집중과 30분 안쪽으로 비슷한 날이 {steady.days}이었어요. 화요일은 {2026-09-15.gap}, 목요일은 {2026-09-17.gap} 모자랐고, 그 시간은 딴짓이 아니라 중립 업무로 채워졌어요.",
  },
  evidence: {
    kind: "shift",
    metric: "focus",
    usualWeeks: 4,
    usual: {
      "2026-09-14": 6 * HOUR,
      "2026-09-15": 6.25 * HOUR,
      "2026-09-16": 6 * HOUR,
      "2026-09-17": 6.5 * HOUR,
      "2026-09-18": 5.5 * HOUR,
      "2026-09-19": 2 * HOUR,
      "2026-09-20": 1.5 * HOUR,
    },
  },
  notes: {
    "2026-09-15": { en: "Five hours of neutral from 11:00.", ko: "11시부터 중립 다섯 시간." },
    "2026-09-17": { en: "Four hours of neutral around lunch.", ko: "점심 전후 중립 네 시간." },
  },
  tryNext: {
    action: { en: "Hold one two-hour focus block on Tuesday and Thursday.", ko: "화요일과 목요일에 두 시간 집중 블록을 하나씩 잡아 보세요." },
    watch: { en: "The next read compares Focus on those two days with their usual.", ko: "다음 해석이 그 이틀의 집중을 평소와 비교해요." },
  },
  checked: [
    { verdict: "kept", text: { en: "The drop sits in two days, not the whole week", ko: "감소는 주 전체가 아니라 이틀에 몰림" } },
    { verdict: "dropped", text: { en: "Drift went up: within the usual range", ko: "딴짓이 늘었음: 평소 범위 안" } },
    { verdict: "dropped", text: { en: "Weekend focus is low: it always is", ko: "주말 집중이 낮음: 원래 그래요" } },
  ],
  days: TWO_DAYS_WEEK,
};

export const READ_ABSTAIN: InsightsRead = {
  id: "abstain",
  weekStart: "2026-08-31",
  weekEnd: "2026-09-06",
  generatedOn: "2026-09-07",
  comparableDays: 7,
  status: "abstain",
  headline: { en: "No read this week.", ko: "이번 주는 해석이 없어요." },
  body: {
    en: "The week was well recorded and looked like your usual weeks. Nothing held up well enough to be worth your attention.",
    ko: "기록은 충분했고 평소 주와 비슷했어요. 주목할 만큼 버티는 해석이 없었어요.",
  },
  checked: [
    { verdict: "dropped", text: { en: "Monday drift is higher: one day, 30 minutes", ko: "월요일 딴짓이 많음: 하루, 30분" } },
    { verdict: "dropped", text: { en: "Saturday ran long: within the usual range", ko: "토요일이 길었음: 평소 범위 안" } },
    { verdict: "dropped", text: { en: "Focus rose 4%: the usage tab already shows it", ko: "집중이 4% 늘었음: 사용 현황에 이미 있음" } },
  ],
  days: PLAIN_WEEK,
};

export const READ_THIN: InsightsRead = {
  id: "thin",
  weekStart: "2026-09-07",
  weekEnd: "2026-09-13",
  generatedOn: "2026-09-14",
  comparableDays: 2,
  status: "abstain",
  headline: { en: "Too little recorded to read this week.", ko: "이번 주는 기록이 적어 해석하지 않았어요." },
  body: {
    en: "{counted.days} had two or more hours recorded. A read needs {required.days}, so nothing was sent for analysis.",
    ko: "2시간 이상 기록된 날이 {counted.days}이었어요. 해석에는 {required.days}이 필요해서 분석을 요청하지 않았어요.",
  },
  checked: [],
  days: THIN_WEEK,
};


/* ------------------------------------------------------- comparison frames */

/**
 * Under review: the same video week read through comparisons whose sides name
 * themselves, in place of a hand-picked condition such as "video before 07:00".
 * Each frame is a fixed rule the app can apply to any week:
 *
 * - usual: this week against every recorded day of the four weeks before it;
 * - lastWeek: this week against the week before;
 * - best: this week's days with the most focus against the rest of the week;
 * - try: the days the user did last week's try against the other days.
 */
export type ReadFrameId = "usual" | "lastWeek" | "best" | "try";

/** A late-August week as ordinary as the plain one, so "usual" has four weeks behind it. */
const AUGUST_WEEK: readonly ReadDay[] = [
  day("2026-08-24", [["08:45", "12:00", "f"], ["12:00", "12:30", "n"], ["13:30", "17:00", "f"], ["17:00", "17:30", "d"], ["21:00", "21:30", "n"]]),
  day("2026-08-25", [["09:00", "11:45", "f"], ["11:45", "12:15", "d"], ["13:15", "16:45", "f"], ["16:45", "17:30", "n"]]),
  day("2026-08-26", [["09:15", "12:15", "f"], ["12:15", "12:45", "n"], ["13:45", "17:15", "f"], ["20:30", "21:00", "d"]]),
  day("2026-08-27", [["08:30", "11:30", "f"], ["11:30", "12:00", "n"], ["13:00", "15:30", "f"], ["15:30", "16:15", "d"], ["16:15", "17:30", "f"]]),
  day("2026-08-28", [["09:30", "12:00", "f"], ["12:00", "12:30", "n"], ["13:30", "16:00", "f"], ["16:00", "16:45", "d"]]),
  day("2026-08-29", [["10:30", "12:00", "f"], ["14:00", "15:00", "n"], ["15:00", "15:45", "d"]]),
  day("2026-08-30", [["11:30", "13:00", "n"], ["14:00", "15:30", "f"], ["20:00", "20:30", "d"]]),
];

/** The four weeks before the video week, oldest first. */
const FOUR_WEEKS: readonly ReadDay[] = [...AUGUST_WEEK, ...PLAIN_WEEK, ...THIN_WEEK, ...TWO_DAYS_WEEK];
const recordedDates = (days: readonly ReadDay[]) => days.filter((entry) => dayMetrics(entry).tracked >= RECORDED_DAY_SECONDS).map((entry) => entry.date);
const VIDEO_DATES = VIDEO_WEEK.map((entry) => entry.date);
const DESK_DATES = ["2026-09-23", "2026-09-24"];
const VIDEO_ONLY = VIDEO_DATES.filter((date) => !DESK_DATES.includes(date));
/** This week's three days with the most focus: the two desk days and Tuesday. */
const MOST_FOCUS_DATES = ["2026-09-22", "2026-09-23", "2026-09-24"];

// Each frame's apps and switches, from the video and desk averages above and the old weeks' own mix.
const onVideo = (app: ReadApp) => app.seconds[0];
const onDesk = (app: ReadApp) => app.seconds[1];
const thisWeekApp = (app: ReadApp) => (5 * onVideo(app) + 2 * onDesk(app)) / 7;
const USUAL_MINUTES: Readonly<Record<string, number>> = { code: 140, figma: 70, linear: 40, notion: 28, slack: 30, chat: 18, other: 7, yt: 18, x: 10, reddit: 7 };
const LAST_WEEK_MINUTES: Readonly<Record<string, number>> = { code: 120, figma: 60, linear: 32, notion: 22, slack: 55, chat: 33, other: 15, yt: 12, x: 9, reddit: 5 };
const appsFor = (a: (app: ReadApp) => number, b: (app: ReadApp) => number): readonly ReadApp[] =>
  VIDEO_APPS.map((app) => ({ ...app, seconds: [Math.round(a(app)), Math.round(b(app))] as const }));
const switchesFor = (a: (edge: ReadSwitch) => number, b: (edge: ReadSwitch) => number): readonly ReadSwitch[] =>
  VIDEO_SWITCHES.map((edge) => ({ ...edge, perDay: [Math.round(a(edge)), Math.round(b(edge))] as const }));
const edgeVideo = (edge: ReadSwitch) => edge.perDay[0];
const edgeDesk = (edge: ReadSwitch) => edge.perDay[1];
const edgeThisWeek = (edge: ReadSwitch) => (5 * edgeVideo(edge) + 2 * edgeDesk(edge)) / 7;

const NEXT_TRY = {
  action: { en: "On two weekdays, open your work before any video.", ko: "평일 이틀은 영상보다 일을 먼저 여세요." },
  watch: { en: "The next read compares those days with the rest of the week.", ko: "다음 해석이 그날들을 나머지 날과 비교해요." },
};

const FRAME_BASE = { ...READ_VIDEO_DAYS, emphasis: undefined, notes: undefined, tryNext: NEXT_TRY };

export const READ_FRAMES: Readonly<Record<ReadFrameId, InsightsRead>> = {
  usual: {
    ...FRAME_BASE,
    headline: { en: "This week ran longer than usual, and what grew was drift.", ko: "이번 주는 평소보다 길었고, 늘어난 건 딴짓이었어요." },
    emphasis: { en: "what grew was drift.", ko: "늘어난 건 딴짓이었어요." },
    body: {
      en: "Days started {firstActivity.gap} earlier than in the last four weeks and ran {span.gap} longer. Focus stayed about the same, while drift grew by {drift.gap}, most of it YouTube early in the morning and late at night.",
      ko: "지난 4주보다 하루가 {firstActivity.gap} 일찍 시작해 {span.gap} 더 길었어요. 집중은 비슷했지만 딴짓이 {drift.gap} 늘었고, 대부분 이른 아침과 늦은 밤의 YouTube였어요.",
    },
    evidence: {
      kind: "split",
      groups: [
        { label: { en: "This week", ko: "이번 주" }, dates: VIDEO_DATES },
        { label: { en: "Last 4 weeks", ko: "지난 4주" }, dates: recordedDates(FOUR_WEEKS) },
      ],
      metrics: ["focus", "drift", "firstActivity", "span"],
      apps: appsFor(thisWeekApp, (app) => USUAL_MINUTES[app.id] * MIN),
      switches: switchesFor(edgeThisWeek, (edge) => edgeDesk(edge) * 0.75),
      baseline: true,
    },
    notes: {
      focus: { en: "About the same as the last four weeks.", ko: "지난 4주와 비슷해요." },
      drift: { en: "Five days had more drift than any day of the last four weeks.", ko: "다섯 날이 지난 4주의 어느 날보다 딴짓이 많았어요." },
      firstActivity: { en: "Five days started by 06:00; none of the last four weeks did.", ko: "다섯 날이 6시까지 시작했어요. 지난 4주에는 그런 날이 없었어요." },
      span: { en: "Five days ran 17 hours or more.", ko: "다섯 날이 17시간 이상이었어요." },
    },
    days: [...FOUR_WEEKS, ...VIDEO_WEEK],
  },
  lastWeek: {
    ...FRAME_BASE,
    headline: { en: "Days got longer than last week, and drift grew more than focus.", ko: "지난주보다 하루가 길어졌고, 집중보다 딴짓이 더 늘었어요." },
    emphasis: { en: "drift grew more than focus.", ko: "집중보다 딴짓이 더 늘었어요." },
    body: {
      en: "Days started {firstActivity.gap} earlier than last week and ran {span.gap} longer. Focus rose {focus.gap}, but drift rose {drift.gap}.",
      ko: "지난주보다 {firstActivity.gap} 일찍 시작해 {span.gap} 더 길었어요. 집중은 {focus.gap} 늘었지만 딴짓은 {drift.gap} 늘었어요.",
    },
    evidence: {
      kind: "split",
      groups: [
        { label: { en: "This week", ko: "이번 주" }, dates: VIDEO_DATES },
        { label: { en: "Last week", ko: "지난주" }, dates: TWO_DAYS_WEEK.map((entry) => entry.date) },
      ],
      metrics: ["focus", "drift", "firstActivity", "span"],
      apps: appsFor(thisWeekApp, (app) => LAST_WEEK_MINUTES[app.id] * MIN),
      switches: switchesFor(edgeThisWeek, (edge) => edgeDesk(edge) * 0.7),
      baseline: true,
    },
    notes: {
      focus: { en: "Up, though last week had two neutral-heavy days.", ko: "늘었지만, 지난주에는 중립이 길었던 날이 이틀 있었어요." },
      drift: { en: "Last week no day passed 30 minutes.", ko: "지난주에는 30분을 넘긴 날이 없었어요." },
      firstActivity: { en: "Last week no day started before 09:00.", ko: "지난주에는 9시 전에 시작한 날이 없었어요." },
      span: { en: "Five days ran 17 hours or more.", ko: "다섯 날이 17시간 이상이었어요." },
    },
    days: [...TWO_DAYS_WEEK, ...VIDEO_WEEK],
  },
  best: {
    ...FRAME_BASE,
    headline: { en: "Your most focused days had a third of the drift.", ko: "집중이 많았던 날은 딴짓이 3분의 1이었어요." },
    emphasis: { en: "a third of the drift.", ko: "딴짓이 3분의 1이었어요." },
    body: {
      en: "The {a.days} with the most focus started {firstActivity.gap} later and carried {drift.gap} less drift than the other {b.days}. The two latest starts of the week are both among them.",
      ko: "집중이 가장 많았던 {a.days}은 나머지 {b.days}보다 {firstActivity.gap} 늦게 시작했고 딴짓이 {drift.gap} 적었어요. 이번 주 가장 늦게 시작한 두 날이 모두 여기에 있어요.",
    },
    evidence: {
      kind: "split",
      groups: [
        { label: { en: "More focus", ko: "집중 많은 날" }, dates: MOST_FOCUS_DATES },
        { label: { en: "Less focus", ko: "집중 적은 날" }, dates: VIDEO_DATES.filter((date) => !MOST_FOCUS_DATES.includes(date)) },
      ],
      metrics: ["focus", "drift", "firstActivity", "span"],
      apps: appsFor((app) => (onVideo(app) + 2 * onDesk(app)) / 3, onVideo),
      switches: switchesFor((edge) => (edgeVideo(edge) + 2 * edgeDesk(edge)) / 3, edgeVideo),
    },
    notes: {
      focus: { en: "The line the days were split by.", ko: "날을 나눈 기준이에요." },
      drift: { en: "Two of the three stayed at 30 minutes or less.", ko: "세 날 중 이틀은 30분 이하였어요." },
      firstActivity: { en: "The other four all started by 06:00.", ko: "나머지 네 날은 모두 6시까지 시작했어요." },
      span: { en: "Shorter by about four hours.", ko: "약 네 시간 짧았어요." },
    },
    days: VIDEO_WEEK,
  },
  try: {
    ...FRAME_BASE,
    headline: { en: "The two days you opened work first were your most focused.", ko: "일을 먼저 연 이틀이 이번 주 가장 집중한 날이었어요." },
    emphasis: { en: "your most focused.", ko: "가장 집중한 날이었어요." },
    body: {
      en: "On the {a.days} that opened with work, focus ran {focus.gap} higher and drift {drift.gap} lower than on the other {b.days}, and the days were {span.gap} shorter.",
      ko: "일을 먼저 연 {a.days}은 다른 {b.days}보다 집중이 {focus.gap} 많고 딴짓이 {drift.gap} 적었으며, 하루는 {span.gap} 짧았어요.",
    },
    evidence: {
      kind: "split",
      groups: [
        { label: { en: "Work first", ko: "일 먼저 연 날" }, dates: DESK_DATES },
        { label: { en: "Other days", ko: "다른 날" }, dates: VIDEO_ONLY },
      ],
      metrics: ["focus", "drift", "firstActivity", "span"],
      apps: appsFor(onDesk, onVideo),
      switches: switchesFor(edgeDesk, edgeVideo),
    },
    notes: {
      focus: { en: "Higher on both than on any other day.", ko: "두 날 모두 다른 어느 날보다 높았어요." },
      drift: { en: "Both stayed at 30 minutes or less.", ko: "두 날 모두 30분 이하였어요." },
      firstActivity: { en: "Both started after 08:30.", ko: "두 날 모두 8시 30분 이후에 시작했어요." },
      span: { en: "Both ended by 20:30.", ko: "두 날 모두 20시 30분까지 끝났어요." },
    },
    tryNext: {
      action: { en: "Open work first on three weekdays.", ko: "평일 사흘은 일을 먼저 여세요." },
      watch: { en: "The next read compares those days with the rest of the week.", ko: "다음 해석이 그날들을 나머지 날과 비교해요." },
    },
    followUp: {
      action: { en: "On two weekdays, open your work before any video", ko: "평일 이틀은 영상보다 일을 먼저 열기" },
      result: "improved",
      detail: { en: "Done on 2 days; focus on them ran 2h 50m above the other 5.", ko: "이틀 해 봤고, 그날 집중이 다른 5일보다 2시간 50분 많았어요." },
    },
    days: VIDEO_WEEK,
  },
};


/* ---------------------------------------------------------- try examples */

/**
 * Under review: what the try line can carry. Each example pairs last week's
 * try and how it went with this week's try, using tries the app can check
 * from the day data on its own (open work first, an app's time cap, a stop
 * time, a focus block) rather than ones it cannot see.
 */
export type ReadTryExampleId = "firstWork" | "cap" | "stop" | "block";

export const READ_TRY_EXAMPLES: Readonly<Record<ReadTryExampleId, Pick<InsightsRead, "tryNext" | "followUp">>> = {
  firstWork: {
    followUp: {
      action: { en: "On two weekdays, open your work before any video", ko: "평일 이틀은 영상보다 일을 먼저 열기" },
      result: "improved",
      detail: { en: "Done on 2 days; focus on them ran 2h 50m above the other 5.", ko: "이틀 해 봤고, 그날 집중이 다른 5일보다 2시간 50분 많았어요." },
    },
    tryNext: {
      action: { en: "Open work first on three weekdays.", ko: "평일 사흘은 일을 먼저 여세요." },
      watch: { en: "The next read compares those days with the rest of the week.", ko: "다음 해석이 그날들을 나머지 날과 비교해요." },
    },
  },
  cap: {
    followUp: {
      action: { en: "Keep YouTube under 30 minutes a day", ko: "YouTube 하루 30분 이하로" },
      result: "steady",
      detail: { en: "Under 30m on 3 of 7 days; drift on them was about the same as the rest.", ko: "7일 중 3일 30분 이하였고, 그날 딴짓은 나머지 날과 비슷했어요." },
    },
    tryNext: {
      action: { en: "Keep YouTube under 30 minutes on weekdays before 18:00.", ko: "평일 18시 전에는 YouTube를 30분 이하로 두세요." },
      watch: { en: "The next read compares drift on those days with your usual.", ko: "다음 해석이 그날 딴짓을 평소와 비교해요." },
    },
  },
  stop: {
    followUp: {
      action: { en: "Stop by 23:00 on weeknights", ko: "평일 밤 23시 전에 마치기" },
      result: "declined",
      detail: { en: "Done on 1 of 5 weeknights; the next mornings started 40m later than usual.", ko: "평일 5일 중 하루만 했고, 다음 날 아침 시작이 평소보다 40분 늦었어요." },
    },
    tryNext: {
      action: { en: "Stop by 23:00 on two weeknights you pick.", ko: "평일 밤 이틀을 골라 23시 전에 마치세요." },
      watch: { en: "The next read compares the mornings after with the others.", ko: "다음 해석이 그다음 날 아침을 다른 날과 비교해요." },
    },
  },
  block: {
    followUp: {
      action: { en: "Hold one two-hour focus block on Tuesday and Thursday", ko: "화요일과 목요일에 두 시간 집중 블록 하나씩" },
      result: "insufficient",
      detail: { en: "Thursday had only 1h 40m recorded, so one day is too few to tell.", ko: "목요일 기록이 1시간 40분뿐이라 하루로는 판단하기 어려워요." },
    },
    tryNext: undefined,
  },
};


/* ------------------------------------------------------------ app web cases */

/**
 * Design review only: the usual-week read with different amounts of app use,
 * to see the app web, its list and time flow hold up. Only the app breakdown
 * changes; the measures above stay those of the usual-week read.
 *
 * - heavy: nineteen apps and some forty links, busy coding and calls;
 * - light: five apps and a handful of links;
 * - hub: YouTube is the busiest app, so the subject sits in the middle;
 * - noSubject: the same apps without a subject app, so the list names the busiest links.
 */
export type ReadWebCaseId = "heavy" | "light" | "hub" | "noSubject";

const app = (id: string, label: string, kind: ReadApp["kind"], a: number, b: number, source: { bundleId?: string; siteDomain?: string }, glyph = label[0]): ReadApp =>
  ({ id, label, kind, glyph, seconds: [a * MIN, b * MIN] as const, ...source });
const link = (a: string, b: string, here: number, there: number): ReadSwitch => ({ a, b, perDay: [here, there] as const });

const HEAVY_APPS: readonly ReadApp[] = [
  app("code", "VS Code", "focus", 105, 100, { bundleId: "com.microsoft.VSCode" }, "VS"),
  app("figma", "Figma", "focus", 52, 50, { bundleId: "com.figma.Desktop" }),
  app("terminal", "Terminal", "focus", 34, 30, { bundleId: "com.apple.Terminal" }, ">_"),
  app("github", "GitHub", "focus", 28, 26, { siteDomain: "github.com" }),
  app("linear", "Linear", "focus", 24, 26, { bundleId: "com.linear" }),
  app("notion", "Notion", "focus", 18, 20, { bundleId: "notion.id" }),
  app("cursor", "Cursor", "focus", 16, 12, { bundleId: "com.todesktop.230313mzl4w4u92" }),
  app("xcode", "Xcode", "focus", 14, 12, { bundleId: "com.apple.dt.Xcode" }, "X"),
  app("slack", "Slack", "neutral", 20, 22, { bundleId: "com.tinyspeck.slackmacgap" }),
  app("chat", "ChatGPT", "neutral", 14, 12, { bundleId: "com.openai.chat" }, "G"),
  app("zoom", "Zoom", "neutral", 9, 10, { bundleId: "us.zoom.xos" }),
  app("gmail", "Gmail", "neutral", 8, 9, { siteDomain: "mail.google.com" }),
  app("calendar", "Calendar", "neutral", 6, 6, { bundleId: "com.apple.iCal" }),
  app("other", "Other", "neutral", 10, 9, {}, "·"),
  app("yt", "YouTube", "drift", 98, 22, { siteDomain: "youtube.com" }, "Y"),
  app("x", "X", "drift", 24, 12, { siteDomain: "x.com" }),
  app("reddit", "Reddit", "drift", 15, 7, { siteDomain: "reddit.com" }),
  app("instagram", "Instagram", "drift", 12, 5, { siteDomain: "instagram.com" }),
  app("netflix", "Netflix", "drift", 9, 2, { siteDomain: "netflix.com" }),
  app("news", "Hacker News", "drift", 7, 4, { siteDomain: "news.ycombinator.com" }, "Y"),
];

const HEAVY_SWITCHES: readonly ReadSwitch[] = [
  link("code", "terminal", 42, 38), link("code", "github", 24, 22), link("code", "cursor", 10, 8), link("code", "figma", 16, 18),
  link("code", "linear", 8, 9), link("code", "slack", 18, 16), link("code", "chat", 14, 12), link("code", "yt", 15, 3),
  link("terminal", "github", 12, 11), link("terminal", "chat", 6, 5), link("xcode", "terminal", 7, 6), link("xcode", "code", 5, 5),
  link("figma", "linear", 6, 7), link("figma", "notion", 5, 6), link("figma", "slack", 7, 6), link("figma", "yt", 8, 2),
  link("linear", "slack", 5, 6), link("notion", "chat", 3, 3), link("slack", "zoom", 4, 5), link("slack", "gmail", 6, 6),
  link("gmail", "calendar", 4, 4), link("zoom", "calendar", 3, 3), link("slack", "yt", 5, 1), link("chat", "yt", 4, 1),
  link("github", "yt", 3, 1), link("yt", "x", 9, 3), link("yt", "reddit", 6, 2), link("yt", "instagram", 5, 1),
  link("yt", "netflix", 2, 0), link("x", "reddit", 4, 1), link("x", "instagram", 3, 1), link("x", "news", 2, 1),
  link("instagram", "reddit", 2, 0), link("news", "code", 2, 2), link("cursor", "terminal", 4, 3), link("github", "slack", 3, 3),
];

const LIGHT_APPS: readonly ReadApp[] = [
  app("code", "VS Code", "focus", 230, 220, { bundleId: "com.microsoft.VSCode" }, "VS"),
  app("notion", "Notion", "focus", 61, 50, { bundleId: "notion.id" }),
  app("slack", "Slack", "neutral", 67, 60, { bundleId: "com.tinyspeck.slackmacgap" }),
  app("yt", "YouTube", "drift", 140, 30, { siteDomain: "youtube.com" }, "Y"),
  app("x", "X", "drift", 25, 10, { siteDomain: "x.com" }),
];

const LIGHT_SWITCHES: readonly ReadSwitch[] = [
  link("code", "slack", 6, 7), link("code", "notion", 4, 4), link("code", "yt", 5, 1), link("yt", "x", 3, 1), link("slack", "yt", 1, 0), link("notion", "slack", 2, 2),
];

const HUB_SWITCHES: readonly ReadSwitch[] = [
  link("yt", "x", 22, 5), link("yt", "reddit", 14, 3), link("code", "yt", 16, 3), link("figma", "yt", 9, 2), link("slack", "yt", 7, 1),
  link("chat", "yt", 5, 1), link("code", "figma", 10, 14), link("code", "slack", 8, 10), link("x", "reddit", 6, 2), link("figma", "notion", 3, 4),
  link("linear", "slack", 2, 3), link("code", "linear", 4, 6),
];

export const READ_WEB_CASES: Readonly<Record<ReadWebCaseId, { readonly apps: readonly ReadApp[]; readonly switches: readonly ReadSwitch[]; readonly subject?: InsightsRead["subject"] }>> = {
  heavy: { apps: HEAVY_APPS, switches: HEAVY_SWITCHES, subject: { label: "YouTube", glyph: "Y" } },
  light: { apps: LIGHT_APPS, switches: LIGHT_SWITCHES, subject: { label: "YouTube", glyph: "Y" } },
  hub: { apps: READ_FRAMES.usual.evidence?.kind === "split" ? READ_FRAMES.usual.evidence.apps ?? [] : [], switches: HUB_SWITCHES, subject: { label: "YouTube", glyph: "Y" } },
  noSubject: { apps: READ_FRAMES.usual.evidence?.kind === "split" ? READ_FRAMES.usual.evidence.apps ?? [] : [], switches: READ_FRAMES.usual.evidence?.kind === "split" ? READ_FRAMES.usual.evidence.switches ?? [] : [] },
};

/** The usual-week read with one of the cases' apps and links in place of its own. */
export function readWithWebCase(read: InsightsRead, id: ReadWebCaseId): InsightsRead {
  const evidence = read.evidence;
  if (evidence?.kind !== "split") return read;
  const entry = READ_WEB_CASES[id];
  return { ...read, subject: entry.subject, evidence: { ...evidence, apps: entry.apps, switches: entry.switches } };
}


export const READ_SAMPLES = { video: READ_VIDEO_DAYS, twoDays: READ_TWO_DAYS } as const;
export type ReadSampleId = keyof typeof READ_SAMPLES;

/** Log order, newest first. */
export const READ_LOG: readonly InsightsRead[] = [READ_VIDEO_DAYS, READ_TWO_DAYS, READ_THIN, READ_ABSTAIN];

/** Before unlock: about half way on hours, one day short of the three-day rule. */
export const UNLOCK_LOCKED: ReadUnlockProgress = { trackedSeconds: 14.5 * HOUR, meaningfulDays: 2, recentDailySeconds: 4.75 * HOUR };
/** Both rules met; the first read can be written now. */
export const UNLOCK_READY: ReadUnlockProgress = { trackedSeconds: 27.25 * HOUR, meaningfulDays: 5 };

/** The first read: same week as the video sample, written by hand right after unlock, nothing to close yet. */
export const READ_FIRST: InsightsRead = { ...READ_VIDEO_DAYS, id: "first", isFirst: true, followUp: undefined };
export const FIRST_LOG: readonly InsightsRead[] = [READ_FIRST];
