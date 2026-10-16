import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { AppIconMap } from "@drifty/domain";
import "../insights/read/readPage.css";
import "./dayNote.css";
import { DateNavigator } from "../../components/DateNavigator";
import { AppGlyph } from "../../components/AppGlyph";
import { SiteFavicon } from "../../components/SiteFavicon";
import { PillBrandMark, PillDismissIcon } from "../companion/CompanionPillIcons";
import { useLocalization } from "../localization/LocalizationContext";
type PreviewLanguage = keyof LocalText;
import { durationLabel } from "../insights/read/readFormat";
import {
  DAY_NOTE_DAYS,
  DAY_NOTE_PAST,
  DAY_NOTE_SAMPLE,
  DAY_NOTE_TITLES,
  DAY_NOTE_TODAY,
  type DayNoteSample,
  type LocalText,
  type DayNoteSource,
  type DayRecord,
  type DaySpan,
} from "./dayNoteFixture";
import { DAY_NOTE_PLACES, readDayNotePreview, type DayNotePlace, type DayNotePreview, type DayNoteState } from "./dayNoteGate";
import { DailyFigures } from "./DailyFigures";

/*
 * Design review of the day note ("어제 노트"), away from Your Day.
 * Dev server only (?driftyNote=1); loaded lazily behind import.meta.env.DEV so
 * none of it reaches a production bundle.
 *
 * - page: its own sidebar item and page. For now only its written part is
 *   under review, words only, no headline, no rules between lines. The
 *   highlights are a plain list without times, the way Dayflow lists them
 *   (2026-10-11), one marker for both lists, no leak line. Frame (2026-10-12):
 *   two titled white panels split 5:5. Owner, 2026-10-12: yesterday's
 *   highlights left, today's so far right, the same list on both, so the page
 *   reads the same whenever it is opened; an earlier date shows that day on
 *   the right and the day before on the left. Only the right card's lines say
 *   how long their work has run, as a flame. The note is one block of the
 *   page, "작업 일지", with its thumbs and copy in its own title row, and
 *   its lines can be changed or added by hand (all settled 2026-10-13). The
 *   day's figures, above it, are next.
 * - insights: the Insights second tab, yesterday's note with the earlier ones
 *   under it.
 * - moment: the morning card under the menu bar, the way the Day Review
 *   arrives in the evening; it leads to the note's page.
 */

const COPY = {
  ko: {
    yesterday: "어제",
    note: "어제 노트",
    nav: "하루 기록",
    leak: "샌 시간",
    copy: "스탠드업으로 복사",
    copyStandup: "스탠드업 복사",
    copyHint: "어제와 오늘을 스탠드업으로 복사",
    copied: "복사했어요",
    reactions: "이 노트에 반응",
    helpful: "쓸모 있음",
    notHelpful: "별로",
    connect: "Intelligence 연결",
    lockedHeadline: "Intelligence를 연결하면 어제를 글로 정리해 드려요",
    lockedTitles: "어제 가장 오래 연 창",
    lockedLead: "매일 아침, 이 창들을 무엇을 했는지로 묶어 한 일 목록으로 써요.",
    lockedShort: "Intelligence를 연결하면 이 자리에 그날 한 일이 정리돼요.",
    momentLockedHeadline: "매일 아침, 어제를 글로 정리해 드려요",
    momentLockedSub: "Intelligence를 연결하면 내일 아침부터 이 자리에 와요.",
    open: "노트 열기",
    past: "지난 노트",
    noNote: "기록이 적어 노트를 쓰지 않은 날",
    noNoteDetail: "3시간보다 적게 기록된 날은 노트를 쓰지 않아요.",
    dismiss: "닫기",
    place: "위치",
    state: "상태",
    ready: "준비됨",
    locked: "Intelligence 없음",
    dayNav: "하루 기록 날짜",
    today: "오늘",
    yesterdayHighlights: "어제 하이라이트",
    todayHighlights: "오늘 하이라이트",
    soFar: "지금까지",
    closed: "마감",
    todaySoFar: "오늘 지금까지",
    toToday: "오늘 기록으로 이동",
    workLog: "작업 일지",
    addLine: "항목 추가",
    linePlaceholder: "한 일을 적어 주세요",
    editLine: "눌러서 고치기",
    moveLine: "끌어서 옮기기",
    clearLines: "직접 쓴 것 지우기",
    summaryLocked: "Intelligence를 연결하면 어제 연 창들을 한 일로 정리하고, 오늘 한 일도 하루 동안 채워 드려요.",
    yesterdayDone: "어제 한 일",
    earlier: "이전 날",
    later: "다음 날",
  },
  en: {
    yesterday: "Yesterday",
    note: "Yesterday's note",
    nav: "Daily record",
    leak: "Leaked",
    copy: "Copy as standup",
    copyStandup: "Copy standup",
    copyHint: "Copy yesterday and today as a standup",
    copied: "Copied",
    reactions: "React to this note",
    helpful: "Helpful",
    notHelpful: "Not helpful",
    connect: "Connect Intelligence",
    lockedHeadline: "Connect Intelligence and yesterday gets written up",
    lockedTitles: "Open longest yesterday",
    lockedLead: "Every morning these windows become a short list of what you worked on.",
    lockedShort: "Connect Intelligence and what you did that day is written up here.",
    momentLockedHeadline: "Yesterday, written up every morning",
    momentLockedSub: "Connect Intelligence and it arrives here tomorrow morning.",
    open: "Open the note",
    past: "Earlier notes",
    noNote: "Too little recorded for a note",
    noNoteDetail: "Days with less than three hours recorded get no note.",
    dismiss: "Dismiss",
    place: "Place",
    state: "State",
    ready: "Ready",
    locked: "No Intelligence",
    dayNav: "Note date",
    today: "Today",
    yesterdayHighlights: "Yesterday's highlights",
    todayHighlights: "Today's highlights",
    soFar: "So far",
    closed: "Closed",
    todaySoFar: "Today so far",
    toToday: "Go to today's note",
    workLog: "Work log",
    addLine: "Add item",
    linePlaceholder: "What did you do?",
    editLine: "Click to edit",
    moveLine: "Drag to move",
    clearLines: "Clear my edits",
    summaryLocked: "Connect Intelligence and these windows become what you did, with today filled in as the day goes on.",
    yesterdayDone: "Done yesterday",
    earlier: "Earlier day",
    later: "Later day",
  },
} as const;

type Copy = (typeof COPY)[PreviewLanguage];

const PLACE_LABEL: Record<DayNotePlace, Record<PreviewLanguage, string>> = {
  page: { ko: "① 사이드바 ‘하루 기록’ 메뉴", en: "① Daily record in the sidebar" },
  insights: { ko: "② 인사이트 탭", en: "② Insights tab" },
  moment: { ko: "③ 아침 메뉴바 카드", en: "③ Morning menu-bar card" },
};

function useCopy(): { readonly c: Copy; readonly lang: PreviewLanguage } {
  const { effectiveLanguage } = useLocalization();
  const lang: PreviewLanguage = effectiveLanguage === "ko" ? "ko" : "en";
  return { c: COPY[lang], lang };
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function whenLabel(day: string, lang: PreviewLanguage, short = false): string {
  const date = new Date(day + "T12:00:00");
  if (short) {
    return lang === "ko"
      ? (date.getMonth() + 1) + "월 " + date.getDate() + "일 (" + date.toLocaleDateString("ko-KR", { weekday: "short" }) + ")"
      : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return lang === "ko"
    ? date.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })
    : date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** The logical day (04:00 start) as the preview's clock sees it. */
function localToday(): string {
  const now = new Date(Date.now() - 4 * 3600 * 1000);
  return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
}

/** 1 is yesterday. Undefined past the fixture; null is a day too thin for a note. */
function noteFor(daysAgo: number): DayNoteSample | null | undefined {
  return daysAgo === 1 ? DAY_NOTE_SAMPLE : DAY_NOTE_PAST[daysAgo - 2];
}

/* ------------------------------------------------------------------ bits */

const THUMB = "M5.5 7.2v6.3H3.2V7.2h2.3Zm0 0 2.4-4.1c.3-.5.9-.7 1.4-.5.6.2.9.8.8 1.4l-.4 2.4h3c.8 0 1.4.7 1.3 1.5l-.6 4.3c-.1.7-.7 1.3-1.4 1.3H5.5";

type GlyphName = "up" | "down" | "copy" | "check" | "arrow" | "prev" | "next" | "plus" | "spark" | "lines" | "flame" | "again";

function Glyph({ name, size = 14 }: { readonly name: GlyphName; readonly size?: number }) {
  const shapes: Record<GlyphName, ReactNode> = {
    up: <path d={THUMB} />,
    down: <g transform="rotate(180 8 8)"><path d={THUMB} /></g>,
    copy: <><rect x="5.2" y="5.2" width="7.6" height="7.6" rx="1.6" /><path d="M10.6 3.2H4.8c-.9 0-1.6.7-1.6 1.6v5.8" /></>,
    check: <path d="m3.6 8.4 2.9 2.9 5.9-6.6" />,
    arrow: <path d="M3.5 8h9m-3.5-3.5L12.5 8 9 11.5" />,
    prev: <path d="M10 3.5 5.5 8l4.5 4.5" />,
    next: <path d="M6 3.5 10.5 8 6 12.5" />,
    plus: <path d="M8 3.5v9M3.5 8h9" />,
    spark: <path d="M8 2.8 9.2 6.8 13.2 8 9.2 9.2 8 13.2 6.8 9.2 2.8 8 6.8 6.8Z" />,
    lines: <path d="M3.5 4.5h9M3.5 8h9M3.5 11.5h5.5" />,
    flame: (
      <>
        <path d="M8 14.6C5.3 14.6 3.4 12.8 3.4 10.3 3.4 8.4 4.5 7 5.6 5.9 5.7 7.1 6.2 8 7 8.4 6.7 5.8 7.8 3.4 9.6 1.6 9.9 3.6 11.2 4.9 12.1 6.3 12.7 7.3 12.6 8.5 12.6 10.3 12.6 12.8 10.7 14.6 8 14.6Z" />
        <path className="dn-flame__core" d="M8 13.1c-1.1 0-1.9-.8-1.9-1.9 0-.9.6-1.6 1.2-2.3.1.7.5 1.1 1 1.3.1-.9.4-1.6.9-2.1.6.9 1.3 1.8 1.3 2.9 0 1.2-1 2.1-2.5 2.1Z" />
      </>
    ),
    again: <><path d="M12.6 9.2A4.7 4.7 0 1 1 11.1 4.7" /><path d="M11.7 2.3v2.7H9" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shapes[name]}
    </svg>
  );
}

/**
 * Letter glyphs, as the preview's app list shows them. The shipped note will
 * resolve icons by bundle id the way the app usage list does.
 */
function SourceIcon({ source }: { readonly source: DayNoteSource }) {
  return (
    <span className="dn-icon">
      {source.site ? <SiteFavicon domain={source.site} size={18} /> : <AppGlyph appName={source.app} size="sm" iconSrc={null} />}
    </span>
  );
}

function Thumbs() {
  const { c } = useCopy();
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  return (
    <span className="dn-thumbs" role="group">
      {(["up", "down"] as const).map((entry) => {
        const label = entry === "up" ? c.helpful : c.notHelpful;
        return (
          <button key={entry} type="button" className="dn-thumb" aria-pressed={vote === entry} aria-label={label} title={label} onClick={() => setVote(vote === entry ? null : entry)}>
            <Glyph name={entry} size={13} />
          </button>
        );
      })}
    </span>
  );
}

function CopyButton({ day, note }: { readonly day: string; readonly note: DayNoteSample }) {
  const { c, lang } = useCopy();
  const [done, setDone] = useState(false);
  const copy = () => {
    const lines = [c.yesterday + " (" + whenLabel(day, lang) + ")"].concat(note.items.map((entry) => "- " + entry.text[lang]));
    void navigator.clipboard?.writeText(lines.join("\n")).catch(() => undefined);
    setDone(true);
    window.setTimeout(() => setDone(false), 1400);
  };
  return (
    <button type="button" className="dn-copy" onClick={copy}>
      <Glyph name={done ? "check" : "copy"} size={13} />
      {done ? c.copied : c.copy}
    </button>
  );
}

function ConnectPill({ onConnect, small = false }: { readonly onConnect?: () => void; readonly small?: boolean }) {
  const { c } = useCopy();
  return (
    <button type="button" className={"dn-pill" + (small ? " is-small" : "")} onClick={onConnect}>
      {c.connect}
      <Glyph name="arrow" size={12} />
    </button>
  );
}

/* ------------------------------------------------------------ ① the note's page */

/** Newest first: today so far, then yesterday and the earlier days. Index 0 is today's page. */
/* Sample days only: a span written for a note line belongs to that line's work, as a project would (review of the project view, 2026-10-13). */
const withProjects = (record: DayRecord): DayRecord => ({
  ...record,
  spans: record.spans.map((span) => (typeof span.ref === "number" && record.note?.items[span.ref] ? { ...span, project: record.note.items[span.ref]!.label.ko } : span)),
});
const PAGE_RECORDS: readonly DayRecord[] = [DAY_NOTE_TODAY, ...DAY_NOTE_DAYS].map(withProjects);

/** The page for a date: the day's index in PAGE_RECORDS, its date, and whether Intelligence is connected. */
type DayView = {
  readonly index: number;
  readonly day: string;
  readonly locked: boolean;
  readonly onConnect?: () => void;
};

/**
 * How a line of the right card stands against the days before it
 * (2026-10-12), counted by the app from the work's short name the way the lab
 * matches names: noted days in a row, or back after a break. A day too thin
 * for a note (a weekend, a day off) neither breaks nor extends a run. Only the
 * right card carries it: the left card is the day before, and a tag there
 * would count the same run twice on one page.
 */
type Run = { readonly kind: "run"; readonly days: number } | { readonly kind: "back"; readonly gap: number };

/** Back after a break is only worth a tag while the break is short. */
const BACK_WITHIN = 5;

/* Names are matched loosely, as the model spells the same work with or without spaces ("연구과제 계획서", "연구과제계획서"). */
const sameWork = (a: string, b: string) => a.replace(/\s+/g, "").toLowerCase() === b.replace(/\s+/g, "").toLowerCase();

function runOf(index: number, name: string): Run | null {
  const real = realNotes;
  const has = real
    ? Object.keys(real).filter((day) => day <= shiftDay(localToday(), -index)).sort().reverse().map((day) => real[day]!.some((entry) => sameWork(entry.name, name)))
    : PAGE_RECORDS.slice(index)
      .filter((record) => record.note)
      .map((record) => record.note!.items.some((entry) => sameWork(entry.label.ko, name)));
  let days = 1;
  while (days < has.length && has[days]) days += 1;
  if (days >= 2) return { kind: "run", days };
  const back = has.indexOf(true, 1);
  return back > 0 && back <= BACK_WITHIN + 1 ? { kind: "back", gap: back - 1 } : null;
}

type Tier = "short" | "mid" | "long" | "top" | "back";

/**
 * 2 days, 3, 4-5 in a chip, 6 or more in a deeper chip (owner, 2026-10-13:
 * the first bars, 4 and 7, then 3 and 5, still left the chip rare, since the
 * same work five days running almost never happens; the chip comes at 4 and
 * one more step marks the rare long run).
 */
function tierOf(run: Run): Tier {
  if (run.kind === "back") return "back";
  return run.days >= 6 ? "top" : run.days >= 4 ? "long" : run.days >= 3 ? "mid" : "short";
}

function runWords(run: Run, lang: PreviewLanguage): string {
  if (run.kind === "run") return lang === "ko" ? run.days + "일 연속" : run.days + " days running";
  return lang === "ko" ? "다시 · " + run.gap + "일 쉬고" : "Back after " + run.gap + (run.gap === 1 ? " day" : " days");
}

/** Back after a break, short, after the return arrow: "2일 쉬고". */
function breakWords(gap: number, lang: PreviewLanguage): string {
  return lang === "ko" ? gap + "일 쉬고" : gap + (gap === 1 ? " day off" : " days off");
}

/**
 * The tag at the end of a right-card line (settled 2026-10-13, the old
 * badge D): a flame and the days, an outline for 2, gold from 3, a gold
 * chip from 5; back after a break turns to a return arrow and the days
 * off. Gold is the app's achievement colour, which no productivity colour
 * uses, and nothing warns when a run ends.
 */
function RunBadge({ run }: { readonly run: Run }) {
  const { lang } = useCopy();
  const words = runWords(run, lang);
  const className = "dn-run is-" + tierOf(run);
  if (run.kind === "back") return <span className={className} title={words}><Glyph name="again" size={12} />{breakWords(run.gap, lang)}</span>;
  return <span className={className} title={words}><Glyph name="flame" size={tierOf(run) === "long" || tierOf(run) === "top" ? 14 : 13} /><span>{run.days}{lang === "ko" ? "일" : "d"}</span></span>;
}


/* ------------------------------------------------------ shared parts */

function copyHead(view: DayView, at: number, c: Copy, lang: PreviewLanguage): string {
  const date = whenLabel(shiftDay(view.day, view.index - at), lang, true);
  if (view.index !== 0) return date;
  return (at === 0 ? c.todaySoFar : c.yesterdayDone) + " (" + date + ")";
}

/**
 * What the copy puts on the clipboard (2026-10-12): the page's two days as a
 * standup, what was done the day before and what has been done since. On
 * today's page that is "done yesterday" and "today so far"; an earlier page
 * copies its two days under their dates.
 */
function standupText(view: DayView, c: Copy, lang: PreviewLanguage, linesOf: (at: number) => readonly NoteLine[] | null): string {
  const block = (at: number): string[] => {
    const lines = (linesOf(at) ?? []).map((line) => lineText(line, lang).trim()).filter(Boolean);
    return lines.length ? [copyHead(view, at, c, lang)].concat(lines.map((line) => "- " + line)) : [];
  };
  const left = block(view.index + 1);
  const right = block(view.index);
  return left.concat(left.length && right.length ? [""] : [], right).join("\n");
}

/**
 * The note's reactions, by the read card's rule (owner, 2026-10-07): icon
 * buttons with no words, the read's two thumbs. They rate the writing; where
 * they sit is under the cards with the copy pill (settled 2026-10-13).
 */
function NoteVote() {
  const { c } = useCopy();
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  return (
    <span className="rp-vote dn-acts" role="group" aria-label={c.reactions}>
      {(["up", "down"] as const).map((entry) => {
        const label = entry === "up" ? c.helpful : c.notHelpful;
        return (
          <button key={entry} type="button" className="rp-thumb" aria-pressed={vote === entry} aria-label={label} title={label} onClick={() => setVote(vote === entry ? null : entry)}>
            <Glyph name={entry} size={13} />
          </button>
        );
      })}
    </span>
  );
}

function useClipboard(text: () => string): { readonly copied: boolean; readonly copy: () => void } {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text()).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return { copied, copy };
}

/**
 * Copy the page's two days as a standup, the header pill Your Day keeps for
 * Share: it acts on the whole page rather than on one card.
 */
function CopyPill({ view }: { readonly view: DayView }) {
  const { c, lang } = useCopy();
  const api = useContext(LinesContext);
  const { copied, copy } = useClipboard(() => standupText(view, c, lang, api?.linesOf ?? modelLines));
  return (
    <button type="button" className={"app-btn app-btn--secondary app-btn--header-action dn-copy-pill" + (copied ? " is-done" : "")} title={c.copyHint} onClick={copy}>
      <Glyph name={copied ? "check" : "copy"} size={14} />
      <span>{copied ? c.copied : c.copyStandup}</span>
    </button>
  );
}

/** Keep channel names together when a narrow card wraps the surrounding sentence. */
function NoteSentence({ text }: { readonly text: string }) {
  return <>{text.split(/(#[\p{L}\p{N}_-]+)/gu).map((part, index) =>
    part.startsWith("#") ? <span className="dn-phrase" key={index}>{part}</span> : part
  )}</>;
}

/* ------------------------------------------------------ lines the user writes */

/**
 * A line of a day's note as the page holds it (2026-10-13, owner: "add items
 * by hand, the way Dayflow does"). The model's lines keep their words in both
 * languages and the short name the app counts runs by; a line the user wrote,
 * or changed, carries its own text. Every line can be edited, moved by its
 * handle, or removed by emptying it, like Dayflow's daily cards.
 *
 * Today's card is rewritten as the day goes on. In the shipped note the lines
 * the user wrote or changed stay through that rewrite: they go to the model as
 * given, and it adds only what they do not already say. Here they are kept on
 * this Mac per date, and nothing else reads them.
 */
type NoteLine = { readonly id: string; readonly base?: LocalText; readonly text?: string; readonly name?: string };
type LinesApi = {
  readonly linesOf: (at: number) => readonly NoteLine[] | null;
  readonly setLines: (at: number, lines: readonly NoteLine[]) => void;
};

const LinesContext = createContext<LinesApi | null>(null);
const LINES_KEY = "drifty.dayNotePreview.lines";

/*
 * Dev review only: notes the lab wrote from real records (?noteReal=<abs path>
 * to a {days: {date: [{name, text}]}} file), shown in place of the fixture's.
 * Read through Vite's /@fs, so never in a build.
 */
type RealNotes = Readonly<Record<string, readonly { readonly name: string; readonly text: string }[]>>;
let realNotes: RealNotes | null = null;

function useRealNotes(): RealNotes | null {
  const [notes, setNotes] = useState<RealNotes | null>(null);
  const path = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("noteReal");
  useEffect(() => {
    if (!path || !import.meta.env.DEV) return;
    let live = true;
    void fetch("/@fs" + path)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { days?: RealNotes } | null) => {
        if (live && data?.days) {
          realNotes = data.days;
          setNotes(data.days);
        }
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);
  return notes;
}

function modelLines(at: number): NoteLine[] | null {
  if (realNotes) {
    const day = shiftDay(localToday(), -at);
    const lines = realNotes[day];
    return lines?.length ? lines.map((entry, line) => ({ id: "r" + day + "-" + line, base: { ko: entry.text, en: entry.text }, name: entry.name })) : null;
  }
  const note = PAGE_RECORDS[at]?.note;
  return note ? note.items.map((entry, line) => ({ id: "m" + at + "-" + line, base: entry.text, name: entry.label.ko })) : null;
}

function lineText(line: NoteLine, lang: PreviewLanguage): string {
  return line.text ?? line.base?.[lang] ?? "";
}

function readSaved(): Record<string, readonly NoteLine[]> {
  try {
    const raw = window.localStorage.getItem(LINES_KEY);
    return raw ? (JSON.parse(raw) as Record<string, readonly NoteLine[]>) : {};
  } catch {
    return {};
  }
}

/** The page's lines, by date: the model's until the user changes a day, then the user's, kept on this Mac. */
function useNoteLines(today: string): LinesApi & { readonly clear: () => void } {
  const [saved, setSaved] = useState<Record<string, readonly NoteLine[]>>(readSaved);
  useEffect(() => {
    try {
      window.localStorage.setItem(LINES_KEY, JSON.stringify(saved));
    } catch {
      /* a preview without storage keeps its lines until reload */
    }
  }, [saved]);
  return {
    linesOf: (at) => saved[shiftDay(today, -at)] ?? modelLines(at),
    setLines: (at, next) => setSaved((all) => ({ ...all, [shiftDay(today, -at)]: next })),
    clear: () => setSaved({}),
  };
}

let lineSeq = 0;
function newLine(): NoteLine {
  lineSeq += 1;
  return { id: "u" + Date.now().toString(36) + lineSeq, text: "" };
}

const GRIP = <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true">{[3.5, 7, 10.5].flatMap((y) => [5, 9].map((x) => <circle key={x + "-" + y} cx={x} cy={y} r={1.1} fill="currentColor" />))}</svg>;

/** A line being written: same type as the list, grows with its words. Enter starts the next line; an empty line goes on Backspace or on leaving it. */
function LineInput({ value, placeholder, onDone, onEnter, onRemove }: {
  readonly value: string;
  readonly placeholder: string;
  readonly onDone: (text: string) => void;
  readonly onEnter: (text: string) => void;
  readonly onRemove: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const settled = useRef(false);
  const [text, setText] = useState(value);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    fit();
  }, []);
  const settle = (action: () => void) => {
    settled.current = true;
    action();
  };
  return (
    <textarea
      ref={ref}
      className="dn-edit"
      rows={1}
      value={text}
      placeholder={placeholder}
      onChange={(event) => {
        setText(event.target.value);
        fit();
      }}
      onKeyDown={(event) => {
        /* Korean and other IMEs send Enter while a syllable is still being composed. */
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          settle(() => onEnter(text));
        } else if (event.key === "Escape") {
          event.preventDefault();
          settle(() => onDone(text));
        } else if (event.key === "Backspace" && text === "") {
          event.preventDefault();
          settle(onRemove);
        }
      }}
      onBlur={() => {
        if (!settled.current) onDone(text);
      }}
    />
  );
}

/**
 * One card's list, words only, every line the user's to change. The right
 * card's lines carry how long their work has run; a line the user wrote has
 * no name to count by, so no badge. A day too thin for a note still takes
 * lines by hand.
 */
function DayLines({ at, runs = false }: { readonly at: number; readonly runs?: boolean }) {
  const { c, lang } = useCopy();
  const api = useContext(LinesContext);
  const lines = api?.linesOf(at) ?? modelLines(at);
  const [editing, setEditing] = useState<string | null>(null);
  const [grab, setGrab] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ readonly id: string; readonly to: number } | null>(null);
  const list = lines ?? [];
  const save = (next: readonly NoteLine[]) => api?.setLines(at, next);
  const patch = (id: string, text: string): NoteLine[] =>
    list.map((line) => (line.id === id ? { ...line, text } : line));
  const done = (id: string, text: string) => {
    const words = text.trim();
    save(words ? patch(id, words) : list.filter((line) => line.id !== id));
    setEditing(null);
  };
  const enter = (id: string, text: string) => {
    const words = text.trim();
    if (!words) {
      done(id, "");
      return;
    }
    const next = newLine();
    const kept = patch(id, words);
    const where = kept.findIndex((line) => line.id === id);
    save([...kept.slice(0, where + 1), next, ...kept.slice(where + 1)]);
    setEditing(next.id);
  };
  const remove = (id: string) => {
    const where = list.findIndex((line) => line.id === id);
    save(list.filter((line) => line.id !== id));
    setEditing(where > 0 ? list[where - 1]!.id : null);
  };
  const add = () => {
    const next = newLine();
    save([...list, next]);
    setEditing(next.id);
  };
  const drop = () => {
    if (!drag) return;
    const from = list.findIndex((line) => line.id === drag.id);
    if (from >= 0) {
      const moved = list.filter((line) => line.id !== drag.id);
      const to = drag.to > from ? drag.to - 1 : drag.to;
      moved.splice(to, 0, list[from]!);
      save(moved);
    }
    setDrag(null);
    setGrab(null);
  };
  return (
    <>
      {list.length ? (
        <ul className="dn-list is-edit">
          {list.map((line, index) => {
            const run = runs && line.name ? runOf(at, line.name) : null;
            const text = lineText(line, lang);
            const before = drag && drag.id !== line.id && drag.to === index;
            const after = drag && drag.id !== line.id && index === list.length - 1 && drag.to === list.length;
            return (
              <li
                key={line.id}
                className={"dn-list__item" + (editing === line.id ? " is-editing" : "") + (drag?.id === line.id ? " is-dragging" : "") + (before ? " is-drop-before" : "") + (after ? " is-drop-after" : "")}
                draggable={grab === line.id}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", text);
                  setDrag({ id: line.id, to: index });
                }}
                onDragOver={(event) => {
                  if (!drag) return;
                  event.preventDefault();
                  const box = event.currentTarget.getBoundingClientRect();
                  const to = event.clientY < box.top + box.height / 2 ? index : index + 1;
                  if (to !== drag.to) setDrag({ id: drag.id, to });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  drop();
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setGrab(null);
                }}
              >
                <span className="dn-grip" title={c.moveLine} onPointerDown={() => setGrab(line.id)} onPointerUp={() => setGrab(null)}>{GRIP}</span>
                {editing === line.id ? (
                  <LineInput
                    value={text}
                    placeholder={c.linePlaceholder}
                    onDone={(words) => done(line.id, words)}
                    onEnter={(words) => enter(line.id, words)}
                    onRemove={() => remove(line.id)}
                  />
                ) : (
                  <span
                    className="dn-text"
                    role="button"
                    tabIndex={0}
                    title={c.editLine}
                    onClick={() => setEditing(line.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        setEditing(line.id);
                      }
                    }}
                  >
                    <NoteSentence text={text} />
                  </span>
                )}
                {run && editing !== line.id ? <RunBadge run={run} /> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="dn-thin">{c.noNote}</p>
      )}
      <button type="button" className="dn-add" onClick={add}>
        <Glyph name="plus" size={12} />
        <span>{c.addLine}</span>
      </button>
    </>
  );
}


/** Is there anything on the page to copy or rate: the model's lines or the user's. */
function pageHasNote(view: DayView, linesOf: (at: number) => readonly NoteLine[] | null): boolean {
  return !view.locked && Boolean(linesOf(view.index)?.length || linesOf(view.index + 1)?.length);
}

/** A card's title row: the title, and its soft note at the right (the date, or "so far"). */
/** A card's label; a date sits right beside it (2026-10-13), a status such as "마감" stays at the card's right. */
function CardHead({ title, sub, beside = false }: { readonly title: string; readonly sub: string; readonly beside?: boolean }) {
  return (
    <div className={"dn-head" + (beside ? " is-beside" : "")}>
      <p className="dn-t">{title}</p>
      <span className="dn-sub">{sub}</span>
    </div>
  );
}

/**
 * The note block's action row (2026-10-13): no block title, like the graph
 * above it; the page title names the page and each card names itself. The
 * thumbs and the copy pill sit right, just above the cards they act on.
 */
function BlockHead({ actions }: { readonly actions?: ReactNode }) {
  return actions ? <div className="dn-sechead"><div className="dn-secacts">{actions}</div></div> : null;
}

/** Without Intelligence, under the block's title: yesterday's longest-open windows left, what connecting brings right. */
function LockedPair({ view }: { readonly view: DayView }) {
  const { c, lang } = useCopy();
  if (view.index !== 0) {
    return (
      <section className="dn-note" aria-label={c.workLog}>
        <BlockHead />
        <div className="dn-pnl dn-quiet is-locked">
          <span>{c.lockedShort}</span>
          <ConnectPill onConnect={view.onConnect} />
        </div>
      </section>
    );
  }
  return (
    <section className="dn-note" aria-label={c.workLog}>
      <BlockHead />
      <div className="dn-look is-dash is-locked">
        <div className="dn-pnl dn-look__card">
          <CardHead title={c.lockedTitles} sub={whenLabel(shiftDay(view.day, -1), lang, true)} beside />
          <ul className="dn-list">
            {DAY_NOTE_TITLES.map((entry) => <li key={entry.title} className="dn-list__item"><span className="dn-text">{entry.title}</span></li>)}
          </ul>
        </div>
        <div className="dn-pnl dn-look__card">
          <CardHead title={c.todayHighlights} sub={c.soFar} />
          <p className="dn-sum__text">{c.summaryLocked}</p>
          <div className="dn-foot is-start"><ConnectPill onConnect={view.onConnect} /></div>
        </div>
      </div>
    </section>
  );
}

/**
 * The note's block (2026-10-12, owner): two titled white panels split 5:5,
 * yesterday's highlights left and today's right, the same kind of list on
 * both. The right card is rewritten as the day goes on ("so far") and closes
 * at the 04:00 day start, when it moves over as the next page's left card.
 * One marker for both lists, the dash; no times and no apps beside a line.
 * Roomy inside (settled 2026-10-13).
 *
 * The note is one block of the page, not the page (owner, 2026-10-13): the
 * day's figures will sit between the page title and the note, so the block
 * has its own title row, "작업 일지", Dayflow's way, with its buttons at the
 * right: the two thumbs, one pair for the whole note, and the copy pill.
 * Every line can be changed and more added by hand.
 */
function TwoDay({ view }: { readonly view: DayView }) {
  const { c, lang } = useCopy();
  const api = useContext(LinesContext);
  if (view.locked) return <LockedPair view={view} />;
  const leftDay = shiftDay(view.day, -1);
  const has = pageHasNote(view, api?.linesOf ?? modelLines);
  /* The thumbs and the copy pill sit under the cards at the right (settled 2026-10-13): react and copy once the note is read. */
  return (
    <section className="dn-note" aria-label={c.workLog}>
      <div className="dn-look is-dash">
        <div className="dn-pnl dn-look__card">
          <CardHead title={c.yesterdayHighlights} sub={whenLabel(leftDay, lang, true)} beside />
          <DayLines at={view.index + 1} />
        </div>
        <div className="dn-pnl dn-look__card">
          <CardHead title={c.todayHighlights} sub={view.index === 0 ? c.soFar : c.closed} />
          <DayLines at={view.index} runs />
        </div>
      </div>
      {has ? <div className="dn-secacts dn-below"><NoteVote /><CopyPill view={view} /></div> : null}
    </section>
  );
}


/* -------------------------- Daily metric variants, review only. */
type LabDays = { readonly days: readonly { readonly day: string; readonly spans: readonly DaySpan[] }[]; readonly generated: string };

function useLabDays(): LabDays | null {
  const [lab, setLab] = useState<LabDays | null>(null);
  const path = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("noteSpans");
  useEffect(() => {
    if (!path || !import.meta.env.DEV) return;
    let live = true;
    void fetch("/@fs" + path)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: LabDays | null) => {
        if (live && data?.days?.length) setLab(data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [path]);
  return lab;
}

/* ---------------------------------------------- the note card, other places */

type Layout = "wide" | "stack";

function When({ day, label }: { readonly day: string; readonly label?: string }) {
  const { lang } = useCopy();
  return <p className="dn-when">{label ? <b>{label}</b> : null}<span>{whenLabel(day, lang)}</span></p>;
}

/** The written note. */
function ReadyNote({ day, label, layout, note }: { readonly day: string; readonly label?: string; readonly layout: Layout; readonly note: DayNoteSample }) {
  const { c, lang } = useCopy();
  return (
    <article className={"dn dn-card is-" + layout}>
      <header className="dn-card__head">
        <When day={day} label={label} />
        <h2 className="dn-headline">{note.headline[lang]}</h2>
      </header>
      <ol className="dn-items">
        {note.items.map((entry) => (
          <li key={entry.text.en} className="dn-item">
            <SourceIcon source={entry.source} />
            <span className="dn-item__text">{entry.text[lang]}</span>
            <span className="dn-item__time">{durationLabel(entry.seconds, lang)}</span>
          </li>
        ))}
      </ol>
      <p className="dn-leak">
        <span className="dn-leak__label"><i aria-hidden="true" />{c.leak} {durationLabel(note.leak.seconds, lang)}</span>
        <span className="dn-leak__text">{note.leak.text[lang]}</span>
      </p>
      <footer className="dn-card__foot">
        <CopyButton day={day} note={note} />
        <Thumbs />
      </footer>
    </article>
  );
}

/** No Intelligence: what the app already knows, and one way to get the note. */
function LockedNote({ day, label, layout, onConnect, titles }: { readonly day: string; readonly label?: string; readonly layout: Layout; readonly onConnect?: () => void; readonly titles: boolean }) {
  const { c, lang } = useCopy();
  return (
    <article className={"dn dn-card is-locked is-" + layout}>
      <header className="dn-card__head">
        <When day={day} label={label} />
        <h2 className="dn-headline">{c.lockedHeadline}</h2>
      </header>
      {titles ? (
        <div className="dn-items">
          <p className="dn-items__label">{c.lockedTitles}</p>
          <ol className="dn-titles">
            {DAY_NOTE_TITLES.map((entry) => (
              <li key={entry.title} className="dn-item">
                <SourceIcon source={entry.source} />
                <span className="dn-item__text">{entry.title}</span>
                <span className="dn-item__time">{durationLabel(entry.seconds, lang)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <p className="dn-leak dn-lead">{titles ? c.lockedLead : c.lockedShort}</p>
      <footer className="dn-card__foot">
        <ConnectPill onConnect={onConnect} />
      </footer>
    </article>
  );
}

function ThinDay({ day, label }: { readonly day: string; readonly label?: string }) {
  const { c } = useCopy();
  return (
    <article className="dn dn-card is-thin is-stack">
      <header className="dn-card__head">
        <When day={day} label={label} />
        <h2 className="dn-headline">{c.noNote}</h2>
      </header>
      <p className="dn-leak dn-lead">{c.noNoteDetail}</p>
    </article>
  );
}

/** The note for a day, the locked card, or the thin-day card. */
function DayCard({ daysAgo, today, layout, state, onConnect }: { readonly daysAgo: number; readonly today: string; readonly layout: Layout; readonly state: DayNoteState; readonly onConnect?: () => void }) {
  const { c } = useCopy();
  const day = shiftDay(today, -daysAgo);
  const label = daysAgo === 1 ? c.yesterday : undefined;
  const note = noteFor(daysAgo);
  if (note === null) return <ThinDay day={day} label={label} />;
  if (state === "locked") return <LockedNote day={day} label={label} layout={layout} onConnect={onConnect} titles={daysAgo === 1} />;
  return note ? <ReadyNote day={day} label={label} layout={layout} note={note} /> : <ThinDay day={day} label={label} />;
}

/* ---------------------------------------------------------------- places */

/** ① The sidebar item that opens the note's own page. Same shape as the app's nav items. */
export function DayNoteNavItem({ active, collapsed, onOpen }: { readonly active: boolean; readonly collapsed: boolean; readonly onOpen: () => void }) {
  const { c } = useCopy();
  return (
    <button type="button" className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
        <path d="M6.5 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h4.5" />
      </svg>
      <span>{c.nav}</span>
      {collapsed ? <span className="nav-item__hover-label" aria-hidden="true">{c.nav}</span> : null}
    </button>
  );
}

const PAGE_DAYS = [1, 2, 3, 4, 5, 6] as const;

/**
 * ① The note's own page: today's date by default, yesterday left and today
 * so far right. An earlier date shows that day right and the day before left.
 */
export function DayNotePage({ appIcons, onConnect }: { readonly appIcons?: AppIconMap; readonly onConnect?: () => void }) {
  const { c, lang } = useCopy();
  const preview = readDayNotePreview();
  const locked = (preview?.state ?? "ready") === "locked";
  const today = localToday();
  const lab = useLabDays();
  const real = useRealNotes();
  const [selected, setSelected] = useState(0);
  const requestedDay = new URLSearchParams(window.location.search).get("noteDate");
  useEffect(() => {
    if (!lab || !requestedDay) return;
    const index = lab.days.findIndex(entry => entry.day === requestedDay);
    if (index >= 0) setSelected(index);
  }, [lab, requestedDay]);
  /* Review exports may have more days than the written-note fixture. */
  const last = lab ? lab.days.length - 1 : PAGE_RECORDS.length - 2;
  const select = (index: number) => setSelected(Math.min(Math.max(index, 0), last));
  const day = lab?.days[selected]?.day ?? shiftDay(today, -selected);
  const noteIndex = lab ? Math.max(0, Math.round((Date.parse(today + "T12:00:00") - Date.parse(day + "T12:00:00")) / 86400000)) : selected;
  const view: DayView = { index: noteIndex, day, locked, onConnect };
  const lines = useNoteLines(today);
  return (
    <LinesContext.Provider value={lines}>
    <div className="page dn dn-page rp-root">
      <div className="pg-head">
        <h1>{c.nav}</h1>
        <DateNavigator
          ariaLabel={c.dayNav}
          label={whenLabel(day, lang, true)}
          todayLabel={lab && lab.days[0]?.day !== today ? (lang === "ko" ? "최신" : "Latest") : c.today}
          todayActionLabel={lab && lab.days[0]?.day !== today ? (lang === "ko" ? "최신 기록으로 이동" : "Go to latest record") : c.toToday}
          isTodayDisabled={selected === 0}
          isNextDisabled={selected === 0}
          isPreviousDisabled={selected >= last}
          onPrevious={() => select(selected + 1)}
          onNext={() => select(selected - 1)}
          onToday={() => select(0)}
          previousLabel={c.earlier}
          nextLabel={c.later}
        />
      </div>
      <div className="dn-stack">
        <DailyFigures spans={lab?.days[selected]?.spans ?? PAGE_RECORDS[selected]?.spans ?? []} lang={lang} appIcons={appIcons} />
        <TwoDay key={selected + "-" + String(locked) + (real ? "-real" : "")} view={view} />
      </div>
    </div>
    </LinesContext.Provider>
  );
}


/** ② The Insights second tab: yesterday's note, the earlier ones under it. */
export function DayNoteInsights({ onConnect }: { readonly appIcons?: AppIconMap; readonly onConnect?: () => void }) {
  const { c, lang } = useCopy();
  const state = readDayNotePreview()?.state ?? "ready";
  const today = localToday();
  const [selected, setSelected] = useState<number>(1);
  return (
    <div className="dn-insights">
      <DayCard daysAgo={selected} today={today} layout="wide" state={state} onConnect={onConnect} />
      {state === "ready" ? (
        <section className="dn-past">
          <h3 className="dn-past__title">{c.past}</h3>
          <ul>
            {PAGE_DAYS.filter((daysAgo) => daysAgo !== selected).map((daysAgo) => {
              const note = noteFor(daysAgo);
              return (
                <li key={daysAgo}>
                  <button type="button" className={note ? "" : "is-empty"} onClick={() => setSelected(daysAgo)}>
                    <span className="dn-past__day">{daysAgo === 1 ? c.yesterday + " · " : ""}{whenLabel(shiftDay(today, -daysAgo), lang)}</span>
                    <span className="dn-past__headline">{note ? note.headline[lang] : c.noNote}</span>
                    <Glyph name="arrow" size={12} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** ③ The morning card under the menu bar. It leads to the note's page. */
export function DayNoteMoment({ onConnect }: { readonly onConnect?: () => void }) {
  const { c, lang } = useCopy();
  const [shown, setShown] = useState(true);
  const state = readDayNotePreview()?.state ?? "ready";
  if (!shown) return null;
  const note = DAY_NOTE_SAMPLE;
  const yesterday = shiftDay(localToday(), -1);
  const openPage = () => {
    const params = new URLSearchParams(window.location.search);
    params.set("notePlace", "page");
    window.location.search = params.toString();
  };
  return (
    <aside className={"dn dn-moment" + (state === "locked" ? " is-locked" : "")} aria-label={c.note}>
      <header className="dn-moment__head">
        <span className="dn-moment__brand"><PillBrandMark /></span>
        <b>{c.note}</b>
        <span className="dn-moment__meta">{whenLabel(yesterday, lang, true)}</span>
        <button type="button" className="dn-moment__close" title={c.dismiss} aria-label={c.dismiss} onClick={() => setShown(false)}><PillDismissIcon /></button>
      </header>
      {state === "locked" ? (
        <>
          <p className="dn-moment__headline">{c.momentLockedHeadline}</p>
          <p className="dn-moment__sub">{c.momentLockedSub}</p>
          <ConnectPill onConnect={onConnect} />
        </>
      ) : (
        <>
          <p className="dn-moment__headline">{note.headline[lang]}</p>
          <ul className="dn-moment__items">
            {note.items.slice(0, 3).map((entry) => (
              <li key={entry.text.en}><span>{entry.text[lang]}</span><em>{durationLabel(entry.seconds, lang)}</em></li>
            ))}
          </ul>
          <div className="dn-moment__actions">
            <CopyButton day={yesterday} note={note} />
            <button type="button" className="dn-moment__open" onClick={openPage}>{c.open}</button>
          </div>
        </>
      )}
    </aside>
  );
}

/** Switch place and state while reviewing. Hidden with ?noteChrome=0 for captures. */
export function DayNoteDevBar() {
  const { c, lang } = useCopy();
  const preview = readDayNotePreview();
  if (!preview || new URLSearchParams(window.location.search).get("noteChrome") === "0") return null;
  const go = (next: Partial<DayNotePreview>) => {
    const to = { ...preview, ...next };
    const params = new URLSearchParams(window.location.search);
    params.set("notePlace", to.place);
    params.set("noteState", to.state);
    params.delete("noteHead");
    for (const old of ["noteFig", "noteSkin", "noteGroups", "noteCell", "noteRange", "noteMode", "noteSlot", "noteBadge", "noteRuns", "noteTitle", "noteVote", "noteGap", "noteActs", "noteRoom", "noteLook", "noteMix", "noteOrder", "noteToday", "noteLayout", "noteWrite", "noteSide", "noteSheet", "noteRatio"]) params.delete(old);
    if (to.place === "insights") params.set("driftyRead", "1"); else params.delete("driftyRead");
    window.location.search = params.toString();
  };
  const group = <T extends string>(label: string, values: readonly T[], on: T, name: (value: T) => string, pickOne: (value: T) => Partial<DayNotePreview>) => (
    <>
      <span className="dn-devbar__sep" />
      <span className="dn-devbar__label">{label}</span>
      {values.map((value) => (
        <button key={value} type="button" className={value === on ? "is-on" : ""} onClick={() => go(pickOne(value))}>{name(value)}</button>
      ))}
    </>
  );
  return (
    <div className="dn-devbar" role="toolbar">
      <span className="dn-devbar__label">{c.place}</span>
      {DAY_NOTE_PLACES.map((place) => (
        <button key={place} type="button" className={place === preview.place ? "is-on" : ""} onClick={() => go({ place })}>{PLACE_LABEL[place][lang]}</button>
      ))}
      {group(c.state, ["ready", "locked"] as const, preview.state, (state) => (state === "ready" ? c.ready : c.locked), (state) => ({ state }))}
      <span className="dn-devbar__sep" />
      <button
        type="button"
        onClick={() => {
          window.localStorage.removeItem(LINES_KEY);
          window.location.reload();
        }}
      >
        {c.clearLines}
      </button>
    </div>
  );
}
