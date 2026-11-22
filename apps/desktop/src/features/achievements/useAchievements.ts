import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { shiftIsoDate, type ActivitySegment, type ClassificationOptions } from "@drifty/domain";
import { getLogicalDayRange } from "../../lib/formatting";
import { buildAchievementDayFacts, type AchievementDayFacts } from "./achievementFacts";
import {
  ACHIEVEMENT_DEFINITIONS,
  type AchievementDefinition,
  type AchievementId,
  type AchievementProgress,
} from "./achievementCatalog";
import {
  evaluateStoredAchievements,
  forgetAchievementHistory,
  markAchievementsAnnounced,
  mergeAchievementFacts,
  nextAchievementRange,
  readAchievementStore,
  unannouncedAchievements,
  writeAchievementStore,
  type AchievementStore,
  type EarnedAchievement,
} from "./achievementStore";

export type AchievementItem = {
  readonly definition: AchievementDefinition;
  readonly earned: EarnedAchievement | null;
  readonly progress: AchievementProgress | null;
};

export type AchievementsStatus = "idle" | "loading" | "ready" | "error";

export type AchievementsSnapshot = {
  readonly status: AchievementsStatus;
  readonly items: readonly AchievementItem[];
  readonly unannounced: readonly AchievementId[];
  /** The first look-back found these; show them together once. */
  readonly firstLookPending: boolean;
};

type HistoryRange = { readonly start: string; readonly end: string };
type HistoryLoad = { readonly materialized: { readonly segments: readonly ActivitySegment[] } };

/** Load the first look-back in pieces so one request never spans the whole year. */
export const ACHIEVEMENT_LOAD_CHUNK_DAYS = 92;
/** Let the first screen finish loading before reading older history. */
export const ACHIEVEMENT_START_DELAY_MS = 4000;

export function buildAchievementItems(store: AchievementStore): AchievementItem[] {
  const evaluations = new Map(evaluateStoredAchievements(store).map((evaluation) => [evaluation.id, evaluation]));
  return ACHIEVEMENT_DEFINITIONS.map((definition) => ({
    definition,
    earned: store.earned[definition.id] ?? null,
    progress: evaluations.get(definition.id)?.progress ?? null,
  }));
}

/** Split startDay..endDay into consecutive pieces of at most chunkDays, newest first. */
export function achievementLoadChunks(startDay: string, endDay: string, chunkDays = ACHIEVEMENT_LOAD_CHUNK_DAYS): { startDay: string; endDay: string }[] {
  const chunks: { startDay: string; endDay: string }[] = [];
  let chunkEnd = endDay;
  while (chunkEnd >= startDay) {
    const candidate = shiftIsoDate(chunkEnd, -(chunkDays - 1));
    const chunkStart = candidate < startDay ? startDay : candidate;
    chunks.push({ startDay: chunkStart, endDay: chunkEnd });
    chunkEnd = shiftIsoDate(chunkStart, -1);
  }
  return chunks;
}

/**
 * Summarise finished days in the background and keep achievements current.
 * Today never counts: a day is judged once it has ended, so a classification
 * fix made the same evening can still change the result.
 */
export function useAchievements({
  enabled,
  todayDay,
  startOfDayMinutes,
  classificationOptions,
  loadHistory,
}: {
  readonly enabled: boolean;
  readonly todayDay: string;
  readonly startOfDayMinutes: number;
  readonly classificationOptions: ClassificationOptions;
  readonly loadHistory: (range: HistoryRange) => Promise<HistoryLoad>;
}) {
  const [store, setStore] = useState<AchievementStore>(() => readAchievementStore());
  const [status, setStatus] = useState<AchievementsStatus>("idle");
  const [attempt, setAttempt] = useState(0);
  const classificationOptionsRef = useRef(classificationOptions);
  classificationOptionsRef.current = classificationOptions;
  const loadHistoryRef = useRef(loadHistory);
  loadHistoryRef.current = loadHistory;

  useEffect(() => {
    if (!enabled) return undefined;
    const yesterday = shiftIsoDate(todayDay, -1);
    const range = nextAchievementRange(readAchievementStore(), yesterday);
    if (!range) {
      setStatus("ready");
      return undefined;
    }
    let cancelled = false;
    setStatus("loading");
    const timer = window.setTimeout(() => {
      void (async () => {
        const facts: AchievementDayFacts[] = [];
        for (const chunk of achievementLoadChunks(range.startDay, range.endDay)) {
          const load = await loadHistoryRef.current(getLogicalDayRange(chunk.startDay, chunk.endDay, startOfDayMinutes));
          if (cancelled) return;
          facts.push(...buildAchievementDayFacts(load.materialized.segments, {
            ...chunk,
            startOfDayMinutes,
            classificationOptions: classificationOptionsRef.current,
          }));
        }
        const next = mergeAchievementFacts(readAchievementStore(), facts, range);
        writeAchievementStore(next);
        setStore(next);
        setStatus("ready");
      })().catch(() => {
        if (!cancelled) setStatus("error");
      });
    }, ACHIEVEMENT_START_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attempt, enabled, startOfDayMinutes, todayDay]);

  const markAnnounced = useCallback((ids: readonly AchievementId[]) => {
    if (ids.length === 0) return;
    const next = markAchievementsAnnounced(readAchievementStore(), ids);
    writeAchievementStore(next);
    setStore(next);
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const forgetHistory = useCallback(() => {
    const next = forgetAchievementHistory(readAchievementStore());
    writeAchievementStore(next);
    setStore(next);
    setAttempt((value) => value + 1);
  }, []);

  const snapshot = useMemo<AchievementsSnapshot>(() => ({
    status,
    items: buildAchievementItems(store),
    unannounced: unannouncedAchievements(store),
    firstLookPending: store.firstLookPending,
  }), [status, store]);

  return { snapshot, markAnnounced, retry, forgetHistory };
}

