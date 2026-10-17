import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVITY_TIMELINE_MIN_WINDOW_TITLE_COVERAGE,
  ACTIVITY_TIMELINE_SESSION_GAP_MS,
  activityTimelineCardSaveInputs,
  activityTimelineTitleCoverage,
  activityTimelineWindowAnswered,
  buildActivityTimelineCardPrompt,
  buildActivityTimelineRecords,
  buildActivityTimelineWindows,
  decideActivityTimelineCards,
  listedActivityTimelineRecords,
  logicalDayIsoDateForDate,
  shiftIsoDate,
  type ActivityBlockLabelLanguage,
  type ActivityBlockLabelRecord,
  type ActivityTimelineWindow,
  type ActivitySegment,
  type ClassificationOptions,
  type TrackerApi,
} from "@drifty/domain";
import { buildIsoDayList, getLogicalDayRange } from "../../lib/formatting";
import { buildWeekDashboardDayModel } from "../dashboard/weekDashboardModel";
import type { WeekCalendarEvent } from "../dashboard/weekCalendar";
import type { AnalysisAiSetupState } from "../settings/analysisModelSetup";
import { AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, readAiPrivacyRequestSettings } from "../settings/aiPrivacyRequestSettings";
import type { ProjectPassInferenceDeps } from "../classification/projectPassInference";
import {
  ACTIVITY_LABEL_SETTLE_MS,
  buildActivityLabelBlocks,
  buildActivityLabelIndex,
  type ActivityLabelBlock,
  type ActivityLabelIndex,
  type ActivityLabelSourceEvent,
} from "./activityLabelBlocks";
import { consumeActivityLabelRequest } from "./activityLabelBudget";
import { createActivityLabelInference, type ActivityLabelInference } from "./activityLabelInference";

const CLOCK_TICK_MS = 60_000;
const FAILURE_BACKOFF_MS = 15 * 60_000;
const BUDGET_BACKOFF_MS = 30 * 60_000;
/** Background cadence for today's and yesterday's windows. */
const BACKGROUND_TICK_MS = 10 * 60_000;
const EMPTY_LABELS: readonly ActivityBlockLabelRecord[] = [];

export type ActivityLabelsController = {
  readonly index: ActivityLabelIndex;
  readonly editingEnabled: boolean;
  readonly saveUserLabel: (block: ActivityLabelBlock, title: string, description: string) => Promise<void>;
  readonly resetUserLabel: (block: ActivityLabelBlock) => Promise<void>;
};

export type UseActivityBlockLabelsArgs = {
  readonly tracker: TrackerApi;
  /** Dashboard Day/Week is showing live tracker data (not a replay or preview fixture). */
  readonly active: boolean;
  /**
   * Make cards for today's and yesterday's finished windows even while Day
   * and Week are closed (live tracker only, never a replay or preview).
   */
  readonly background?: boolean;
  readonly startDay: string;
  readonly endDay: string;
  /** Week view's canonical blocks; Day view computes its own from the same segments. */
  readonly weekCalendarEvents: ReadonlyMap<string, readonly WeekCalendarEvent[]> | null;
  readonly segments: readonly ActivitySegment[];
  readonly classificationOptions: ClassificationOptions;
  readonly startOfDayMinutes: number;
  readonly language: ActivityBlockLabelLanguage;
  readonly analysisConnected: boolean;
  readonly analysisSetup: AnalysisAiSetupState;
  readonly analysisOwnerId: string | null;
  readonly analysisCloudRecovery: boolean;
  readonly requestScopeKey: string;
  readonly canFallbackToCloud?: () => boolean;
  readonly resolveOpenRouterKey: () => Promise<string | null>;
  readonly onProviderUnavailable?: ProjectPassInferenceDeps["onProviderUnavailable"];
  readonly now?: () => number;
};

function usePrivacyPolicy() {
  const [settings, setSettings] = useState(readAiPrivacyRequestSettings);
  useEffect(() => {
    const sync = () => setSettings(readAiPrivacyRequestSettings());
    window.addEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(AI_PRIVACY_REQUEST_SETTINGS_CHANGED_EVENT, sync);
  }, []);
  return useMemo(
    () => ({ windowTitle: settings.optional.windowTitle, contentContext: settings.optional.contentContext }),
    [settings.optional.contentContext, settings.optional.windowTitle],
  );
}

function localDay(ms: number): string {
  const date = new Date(ms);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/**
 * Loads stored timeline cards for the visible Day/Week range, asks the
 * analysis model to describe finished activity windows one at a time (the
 * range on screen, and today's and yesterday's windows in the background),
 * and exposes the user's per-block choice to hide a name. Every
 * failure is silent: the block keeps its existing app/site text.
 * Like project analysis it has no switch of its own: it asks whenever an
 * Intelligence model is connected, and the AI privacy title switches decide
 * which titles it may read (with both off, no window has a title to send).
 */
export function useActivityBlockLabels(args: UseActivityBlockLabelsArgs): ActivityLabelsController | null {
  const {
    tracker, active, startDay, endDay, weekCalendarEvents, segments, classificationOptions, startOfDayMinutes,
    language, analysisConnected, analysisSetup, requestScopeKey, resolveOpenRouterKey, analysisOwnerId,
    analysisCloudRecovery, canFallbackToCloud, onProviderUnavailable,
  } = args;
  const background = args.background ?? false;
  const policy = usePrivacyPolicy();
  const supported = Boolean(tracker.getActivityBlockLabels && tracker.saveActivityBlockLabels);
  const range = useMemo(() => getLogicalDayRange(startDay, endDay, startOfDayMinutes), [endDay, startDay, startOfDayMinutes]);
  const rangeKey = range.start + "|" + range.end;
  const [labelState, setLabelState] = useState<{ readonly key: string; readonly labels: readonly ActivityBlockLabelRecord[] }>({ key: "", labels: EMPTY_LABELS });
  const [nowMs, setNowMs] = useState(() => (args.now ?? Date.now)());
  const [revision, setRevision] = useState(0);
  const mountedRef = useRef(true);
  const scopeRef = useRef("");
  const runningRef = useRef(false);
  // Windows already tried in this session, keyed with the language they were tried in.
  const attemptedRef = useRef(new Set<string>());
  const backoffUntilRef = useRef(0);
  const nowRef = useRef(args.now);
  nowRef.current = args.now;
  const scope = [rangeKey, language, requestScopeKey, policy.windowTitle, policy.contentContext].join("|");
  scopeRef.current = scope;
  const backgroundScope = [language, requestScopeKey, policy.windowTitle, policy.contentContext, startOfDayMinutes].join("|");
  const backgroundScopeRef = useRef("");
  backgroundScopeRef.current = backgroundScope;
  const [backgroundTick, setBackgroundTick] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setNowMs((nowRef.current ?? Date.now)()), CLOCK_TICK_MS);
    return () => window.clearInterval(interval);
  }, [active]);

  const reload = useCallback(async () => {
    if (!supported || !tracker.getActivityBlockLabels) return;
    const key = rangeKey;
    try {
      const labels = await tracker.getActivityBlockLabels({ start: range.start, end: range.end });
      if (mountedRef.current) setLabelState({ key, labels });
    } catch {
      if (mountedRef.current) setLabelState({ key, labels: EMPTY_LABELS });
    }
  }, [range.end, range.start, rangeKey, supported, tracker]);

  // Record deletion removes labels in the tracker, so a changed record set reloads them.
  const segmentCount = segments.length;
  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload, segmentCount, revision]);

  const segmentsById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);
  const eventsByDay = useMemo<ReadonlyMap<string, readonly ActivityLabelSourceEvent[]>>(() => {
    if (!active) return new Map();
    if (weekCalendarEvents && weekCalendarEvents.size > 0) return weekCalendarEvents;
    return new Map(buildIsoDayList(startDay, endDay).map((day) => [
      day,
      buildWeekDashboardDayModel({ day, segments: [...segments], classificationOptions, startOfDayMinutes }).calendarEvents,
    ]));
  }, [active, classificationOptions, endDay, segments, startDay, startOfDayMinutes, weekCalendarEvents]);

  const labels = labelState.key === rangeKey ? labelState.labels : EMPTY_LABELS;
  const blocks = useMemo(
    () => buildActivityLabelBlocks(eventsByDay, { startOfDayMinutes, segmentsById, labels, language, nowMs }),
    [eventsByDay, labels, language, nowMs, segmentsById, startOfDayMinutes],
  );
  const index = useMemo(() => buildActivityLabelIndex(blocks), [blocks]);

  // Window boundaries depend only on record times, so the Week view's compact
  // payload finds the same windows as the Day view.
  const windows = useMemo<ActivityTimelineWindow[]>(() => {
    if (!active) return [];
    return buildIsoDayList(startDay, endDay).flatMap((day) => {
      const dayRange = getLogicalDayRange(day, day, startOfDayMinutes);
      return buildActivityTimelineWindows(day, segments, Date.parse(dayRange.start), Date.parse(dayRange.end));
    });
  }, [active, endDay, segments, startDay, startOfDayMinutes]);

  const buildInference = useCallback(async (isRequestCurrent: () => boolean): Promise<ActivityLabelInference> => {
    const setup = { ...analysisSetup };
    if (setup.provider === "openrouter") setup.openRouterApiKey = (await resolveOpenRouterKey()) ?? "";
    return createActivityLabelInference(setup, {
      isRequestCurrent,
      expectedCloudUserId: analysisOwnerId,
      cloudRecovery: analysisCloudRecovery,
      canFallbackToCloud,
      onProviderUnavailable,
    });
  }, [analysisCloudRecovery, analysisOwnerId, analysisSetup, canFallbackToCloud, onProviderUnavailable, resolveOpenRouterKey]);

  /**
   * Describes one finished window from full local records and stores its cards
   * with the window marker. "stop" means the budget, a failure or a scope
   * change ended this run; the caller tries again later.
   */
  const describeWindow = useCallback(async (
    window: ActivityTimelineWindow,
    recordsById: ReadonlyMap<string, ActivitySegment>,
    isCurrent: () => boolean,
  ): Promise<"saved" | "stop"> => {
    const records = buildActivityTimelineRecords(window, recordsById, policy);
    attemptedRef.current.add(window.key + "|" + language);
    let rows = activityTimelineCardSaveInputs(window, [], language, {});
    if (activityTimelineTitleCoverage(records) >= ACTIVITY_TIMELINE_MIN_WINDOW_TITLE_COVERAGE) {
      if (!consumeActivityLabelRequest(analysisSetup.provider, localDay(Date.now()))) {
        attemptedRef.current.delete(window.key + "|" + language);
        backoffUntilRef.current = Date.now() + BUDGET_BACKOFF_MS;
        return "stop";
      }
      const listed = listedActivityTimelineRecords(records);
      const inference = await buildInference(isCurrent);
      const result = await inference(buildActivityTimelineCardPrompt(listed, records, language));
      if (!isCurrent()) return "stop";
      if (!result.output) {
        backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
        return "stop";
      }
      const { cards } = decideActivityTimelineCards(window, records, listed, result.output, language);
      rows = activityTimelineCardSaveInputs(window, cards, language, result.usage);
    }
    if (!isCurrent()) return "stop";
    await tracker.saveActivityBlockLabels?.(rows);
    return "saved";
  }, [analysisSetup.provider, buildInference, language, policy, tracker]);
  // The background run calls the latest describeWindow through a ref so its
  // effect re-runs only on its tick, connection and scope, not on every render.
  const describeWindowRef = useRef(describeWindow);
  describeWindowRef.current = describeWindow;

  useEffect(() => {
    if (!active || !supported || !analysisConnected || labelState.key !== rangeKey) return;
    if (runningRef.current || Date.now() < backoffUntilRef.current) return;
    // Latest finished window first: closed by a later record or a long break.
    const window = windows
      .filter((candidate) => !attemptedRef.current.has(candidate.key + "|" + language)
        && !activityTimelineWindowAnswered(candidate, labels, language)
        && (candidate.followed || nowMs - candidate.endMs >= ACTIVITY_TIMELINE_SESSION_GAP_MS + ACTIVITY_LABEL_SETTLE_MS))
      .sort((left, right) => right.endMs - left.endMs)[0];
    if (!window) return;
    runningRef.current = true;
    const requestScope = scope;
    const isCurrent = () => mountedRef.current && scopeRef.current === requestScope;
    void (async () => {
      let saved = false;
      try {
        // The Week view's compact payload has no window titles, so the
        // evidence always comes from the day's full local records.
        const dayRange = getLogicalDayRange(window.day, window.day, startOfDayMinutes);
        const fullSegments = await tracker.getTimeline({ start: dayRange.start, end: dayRange.end });
        if (!isCurrent()) return;
        const recordsById = new Map(segmentsById);
        for (const segment of fullSegments) recordsById.set(segment.id, segment);
        saved = (await describeWindow(window, recordsById, isCurrent)) === "saved";
      } catch {
        backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
      } finally {
        runningRef.current = false;
        if (saved && mountedRef.current) setRevision((value) => value + 1);
      }
    })();
  }, [active, analysisConnected, describeWindow, labelState.key, labels, language, nowMs, rangeKey, scope, segmentsById, startOfDayMinutes, supported, tracker, windows]);

  // Background: like the hourly project pass, cards for today's and
  // yesterday's finished windows are made whether or not Day or Week is open,
  // at start and every few minutes, latest first, one request at a time.
  useEffect(() => {
    if (!background) return;
    const interval = window.setInterval(() => setBackgroundTick((value) => value + 1), BACKGROUND_TICK_MS);
    return () => window.clearInterval(interval);
  }, [background]);

  useEffect(() => {
    if (!background || !supported || !analysisConnected || !tracker.getActivityBlockLabels) return;
    if (runningRef.current || Date.now() < backoffUntilRef.current) return;
    runningRef.current = true;
    const requestScope = backgroundScope;
    const isCurrent = () => mountedRef.current && backgroundScopeRef.current === requestScope;
    const readLabels = tracker.getActivityBlockLabels.bind(tracker);
    void (async () => {
      let saved = false;
      try {
        const now = (nowRef.current ?? Date.now)();
        const today = logicalDayIsoDateForDate(new Date(now), startOfDayMinutes);
        const days = [shiftIsoDate(today, -1), today];
        const span = getLogicalDayRange(days[0], today, startOfDayMinutes);
        const [stored, recent] = await Promise.all([
          readLabels({ start: span.start, end: span.end }),
          tracker.getTimeline({ start: span.start, end: span.end }),
        ]);
        if (!isCurrent()) return;
        const recordsById = new Map(recent.map((segment) => [segment.id, segment]));
        const pending = days
          .flatMap((day) => {
            const dayRange = getLogicalDayRange(day, day, startOfDayMinutes);
            return buildActivityTimelineWindows(day, recent, Date.parse(dayRange.start), Date.parse(dayRange.end));
          })
          .filter((candidate) => !attemptedRef.current.has(candidate.key + "|" + language)
            && !activityTimelineWindowAnswered(candidate, stored, language)
            && (candidate.followed || now - candidate.endMs >= ACTIVITY_TIMELINE_SESSION_GAP_MS + ACTIVITY_LABEL_SETTLE_MS))
          .sort((left, right) => right.endMs - left.endMs);
        for (const candidate of pending) {
          if (!isCurrent() || Date.now() < backoffUntilRef.current) break;
          if ((await describeWindowRef.current(candidate, recordsById, isCurrent)) !== "saved") break;
          saved = true;
        }
      } catch {
        backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
      } finally {
        runningRef.current = false;
        if (saved && mountedRef.current) setRevision((value) => value + 1);
      }
    })();
  }, [analysisConnected, background, backgroundScope, backgroundTick, language, startOfDayMinutes, supported, tracker]);

  const saveUserLabel = useCallback(async (block: ActivityLabelBlock, title: string, description: string) => {
    if (!tracker.saveActivityBlockUserLabel) throw new Error("Block labels are unavailable.");
    const previousBlockKey = block.resolution.kind === "user" && block.resolution.carried ? block.resolution.record.blockKey : null;
    await tracker.saveActivityBlockUserLabel({
      blockKey: block.key,
      logicalDay: block.day,
      blockStartedAt: new Date(block.startMs).toISOString(),
      blockEndedAt: new Date(block.endMs).toISOString(),
      segmentIds: block.segmentIds,
      title: title.trim(),
      description: description.trim(),
    }, previousBlockKey);
    if (mountedRef.current) setRevision((value) => value + 1);
  }, [tracker]);

  const resetUserLabel = useCallback(async (block: ActivityLabelBlock) => {
    if (block.resolution.kind !== "user" || !tracker.deleteActivityBlockUserLabel) return;
    await tracker.deleteActivityBlockUserLabel(block.resolution.record.blockKey);
    if (mountedRef.current) setRevision((value) => value + 1);
  }, [tracker]);

  return useMemo(() => {
    if (!active || !supported) return null;
    return {
      index,
      editingEnabled: Boolean(tracker.saveActivityBlockUserLabel),
      saveUserLabel,
      resetUserLabel,
    };
  }, [active, index, resetUserLabel, saveUserLabel, supported, tracker.saveActivityBlockUserLabel]);
}
