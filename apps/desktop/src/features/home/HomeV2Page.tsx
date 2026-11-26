import { useEffect, useMemo, useState } from "react";
import { logicalDayEndExclusiveMs, logicalDayStartMs, shiftIsoDate, type ActivitySegment, type AppIconMap, type ClassificationOptions } from "@drifty/domain";
import { getLogicalDayRange, logicalTodayIsoDate } from "../../lib/formatting";
import { mergeActivitySegments } from "../../lib/activitySegments";
import type { CompactHistoryLoad, CompactHistoryRange } from "../dashboard/compactHistoryCache";
import { useLocalization } from "../localization/LocalizationContext";
import type { AchievementItem } from "../achievements/useAchievements";
import { BASELINE_WEEKS, buildHomeModel } from "./homeModel";
import type { HomeLang } from "./homeCards";
import { FlowDsHome } from "./homeFlowDs";

/*
 * Home preview (owner review 2026-11-27): loads the records and draws the
 * Home built from the app's own parts and tokens (homeFlowDs). The earlier
 * explorations (A/B/C, F1–F5) live on as captures in the review file.
 * Dev-server preview only (?homePreview=1; ?homeAt=HH:MM pins the clock).
 */

const COPY = {
  ko: { nav: "홈", loading: "기록을 불러오는 중이에요", failed: "기록을 불러오지 못했어요" },
  en: { nav: "Home", loading: "Loading your records", failed: "Couldn't load your records" },
};

function previewClock(): string | null {
  if (typeof window === "undefined") return null;
  const clock = new URLSearchParams(window.location.search).get("homeAt");
  return clock && /^\d{1,2}:\d{2}$/.test(clock) ? clock : null;
}

function asOfFor(clock: string | null, today: string, startOfDayMinutes: number, nowMs: number): number {
  if (!clock) return nowMs;
  const [hours, minutes] = clock.split(":").map(Number);
  const [year, month, date] = today.split("-").map(Number);
  let at = new Date(year, month - 1, date, hours, minutes, 0, 0).getTime();
  if (at < logicalDayStartMs(today, startOfDayMinutes)) at += 24 * 60 * 60 * 1000;
  return at;
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

export function HomeV2Page({ loadHistory, recentSegments, classificationOptions, startOfDayMinutes, goalHours, achievements, appIcons = {}, onOpenDay, onOpenWeek, onOpenAchievements, onAsk }: HomeV2PageProps) {
  const { effectiveLanguage } = useLocalization();
  const lang: HomeLang = effectiveLanguage === "ko" ? "ko" : "en";
  const clock = useMemo(previewClock, []);
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
    return <div className="page hf"><p className="hf-sub">{failed === key ? COPY[lang].failed : COPY[lang].loading}</p></div>;
  }
  return <FlowDsHome model={model} lang={lang} appIcons={appIcons} achievements={achievements} onOpenDay={onOpenDay} onOpenWeek={onOpenWeek} onOpenAchievements={onOpenAchievements} onAsk={onAsk} />;
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
