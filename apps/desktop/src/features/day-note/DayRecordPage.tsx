import { useEffect, useMemo, useState } from "react";
import {
  activityTimeBounds, aggregateDeviceElapsedTime, classifyActivity, logicalDayEndExclusiveMs, logicalDayStartMs, shiftIsoDate,
  type ActivitySegment, type AppIconMap, type ClassificationOptions, type ProductivityLevel,
} from "@drifty/domain";
import { DateNavigator } from "../../components/DateNavigator";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { mergeActivitySegments } from "../../lib/activitySegments";
import type { CompactHistoryLoad, CompactHistoryRange } from "../dashboard/compactHistoryCache";
import { useLocalization } from "../localization/LocalizationContext";
import type { DisplayLanguage } from "../localization/languagePreference";
import { levelFor } from "../productivity-levels/productivityLevelView";
import { useProductivityLevels } from "../settings/categoryCustomizationStore";
import { DailyFigures } from "./DailyFigures";
import type { DayCategory, DaySpan } from "./dayNoteFixture";
import "./dayNote.css";

/*
 * The daily record page behind Dev mode's "Daily record preview" switch
 * (owner, 2026-10-13: not shipped yet; hidden, and turned on from Dev).
 * The activity board reads this Mac's own records for the chosen day, the
 * same timeline Insights' focus calendar loads. The note under it is not
 * written yet: Intelligence does not generate day notes in the app, so the
 * two cards say so instead of showing sample text.
 */
const COPY = {
  ko: {
    nav: "하루 기록", dayNav: "날짜 이동", today: "오늘", toToday: "오늘로 이동", earlier: "이전 날", later: "다음 날",
    yesterday: "어제 하이라이트", todayCard: "오늘 하이라이트", soFar: "지금까지", closed: "마감",
    pending: "하이라이트는 아직 만들어지지 않아요. Intelligence가 쓰는 노트는 다음 단계에서 연결돼요.",
    loading: "기록을 불러오는 중…", failed: "이 날의 기록을 불러오지 못했어요.",
  },
  en: {
    nav: "Daily record", dayNav: "Change date", today: "Today", toToday: "Go to today", earlier: "Previous day", later: "Next day",
    yesterday: "Yesterday's highlights", todayCard: "Today's highlights", soFar: "So far", closed: "Closed",
    pending: "Highlights are not written yet. Notes from Intelligence come in a later step.",
    loading: "Loading the day's activity…", failed: "Could not load this day's activity.",
  },
};

const CATEGORY: Record<string, DayCategory> = { social_media: "socialMedia" };

/** The day's segments as the board's spans: minutes after the day's midnight, clipped to the app's day. */
export function daySpansFromSegments(segments: readonly ActivitySegment[], day: string, startOfDayMinutes: number, options?: ClassificationOptions, levels: readonly ProductivityLevel[] = []): DaySpan[] {
  const from = logicalDayStartMs(day, startOfDayMinutes);
  const to = logicalDayEndExclusiveMs(day, startOfDayMinutes);
  const midnight = new Date(day + "T00:00:00").getTime();
  const spans: DaySpan[] = [];
  for (const segment of aggregateDeviceElapsedTime(segments)) {
    const { start, end } = activityTimeBounds(segment);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const clippedStart = Math.max(start, from);
    const clippedEnd = Math.min(end, to);
    if (clippedEnd <= clippedStart) continue;
    const { category, productivity } = classifyActivity(segment, options);
    const level = levelFor(category, productivity, levels);
    spans.push({
      start: (clippedStart - midnight) / 60000,
      end: (clippedEnd - midnight) / 60000,
      kind: productivity,
      category: CATEGORY[category] ?? (category as DayCategory),
      ...(level ? { level: level.id } : {}),
      app: segment.appName,
      ...(segment.bundleId ? { bundleId: segment.bundleId } : {}),
      ...(segment.siteDomain ? { site: segment.siteDomain } : {}),
    });
  }
  return spans;
}

function dateLabel(day: string, lang: DisplayLanguage): string {
  const date = new Date(day + "T12:00:00");
  return lang === "ko"
    ? (date.getMonth() + 1) + "월 " + date.getDate() + "일 (" + date.toLocaleDateString("ko-KR", { weekday: "short" }) + ")"
    : date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** The sidebar item, in the activity group, shaped like the app's nav items. */
export function DayRecordNavItem({ active, collapsed, onOpen }: { readonly active: boolean; readonly collapsed: boolean; readonly onOpen: () => void }) {
  const { effectiveLanguage } = useLocalization();
  const label = COPY[effectiveLanguage === "ko" ? "ko" : "en"].nav;
  return (
    <button type="button" className={"nav-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined} onClick={onOpen}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
        <path d="M6.5 3.5h8l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-10.5A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M14 3.5V8h4.5M8.5 12.5h7M8.5 16h4.5" />
      </svg>
      <span>{label}</span>
      {collapsed ? <span className="nav-item__hover-label" aria-hidden="true">{label}</span> : null}
    </button>
  );
}

type DayRecordPageProps = {
  readonly loadHistory: (range: CompactHistoryRange) => Promise<CompactHistoryLoad>;
  readonly recentSegments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly appIcons: AppIconMap;
};

export function DayRecordPage({ loadHistory, recentSegments, classificationOptions, startOfDayMinutes, appIcons }: DayRecordPageProps) {
  const { effectiveLanguage } = useLocalization();
  const productivityLevels = useProductivityLevels();
  const lang: DisplayLanguage = effectiveLanguage === "ko" ? "ko" : "en";
  const c = COPY[lang];
  const today = logicalTodayIsoDate(startOfDayMinutes);
  const [day, setDay] = useState(today);
  const range = useMemo(() => getLogicalDayRange(day, day, startOfDayMinutes), [day, startOfDayMinutes]);
  const key = range.start + ":" + range.end;
  const [history, setHistory] = useState<{ readonly key: string; readonly segments: readonly ActivitySegment[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setFailedKey(null);
    void loadHistory(range)
      .then((load) => { if (!cancelled) setHistory({ key, segments: load.materialized.segments }); })
      .catch(() => { if (!cancelled) setFailedKey(key); });
    return () => { cancelled = true; };
  }, [key, range, loadHistory]);
  const ready = history?.key === key;
  const spans = useMemo(() => {
    if (!ready || !history) return [];
    const segments = day === today ? mergeActivitySegments(history.segments, recentSegments) : [...history.segments];
    return daySpansFromSegments(segments, day, startOfDayMinutes, { ...classificationOptions, fallbackCandidates: segments }, productivityLevels);
  }, [ready, history, day, today, recentSegments, startOfDayMinutes, classificationOptions, productivityLevels]);
  const isToday = day === today;
  return (
    <div className="page dn dn-page dn-live">
      <div className="pg-head">
        <h1>{c.nav}</h1>
        <DateNavigator
          ariaLabel={c.dayNav}
          label={dateLabel(day, lang)}
          todayLabel={c.today}
          todayActionLabel={c.toToday}
          isTodayDisabled={isToday}
          isNextDisabled={isToday}
          onPrevious={() => setDay(shiftIsoDate(day, -1))}
          onNext={() => setDay(day >= today ? today : shiftIsoDate(day, 1))}
          onToday={() => setDay(today)}
          previousLabel={c.earlier}
          nextLabel={c.later}
        />
      </div>
      <div className="dn-stack">
        {ready ? <DailyFigures spans={spans} lang={lang} appIcons={appIcons} /> : (
          <section className="dn-figs wf"><div className="dn-pnl wf-panel"><p className="wf-empty">{failedKey === key ? c.failed : c.loading}</p></div></section>
        )}
        <section className="dn-note" aria-label={c.nav}>
          <div className="dn-look is-dash">
            <div className="dn-pnl dn-look__card">
              <div className="dn-head is-beside"><p className="dn-t">{c.yesterday}</p><span className="dn-sub">{dateLabel(shiftIsoDate(day, -1), lang)}</span></div>
              <p className="dn-thin">{c.pending}</p>
            </div>
            <div className="dn-pnl dn-look__card">
              <div className="dn-head"><p className="dn-t">{c.todayCard}</p><span className="dn-sub">{isToday ? c.soFar : c.closed}</span></div>
              <p className="dn-thin">{c.pending}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
