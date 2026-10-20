import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIVITY_TIMELINE_MIN_WINDOW_TITLE_COVERAGE,
  ACTIVITY_TIMELINE_SESSION_GAP_MS,
  activityTimelineTitleCoverage,
  activityTimelineWindowAnswered,
  activityTimelineWindowSaveInput,
  activityTimelineCardPromptInput,
  buildActivityTimelineCardPromptFromInput,
  buildActivityTimelineRecords,
  buildActivityTimelineWindows,
  decideActivityTimelineCards,
  listedActivityTimelineRecords,
  logicalDayIsoDateForDate,
  storedActivityTimelineCards,
  shiftIsoDate,
  type ActivityBlockLabelLanguage,
  type ActivityBlockLabelRecord,
  type ActivityTimelineWindow,
  type ActivityTimelineWindowRecord,
  type ActivitySegment,
  type ClassificationOptions,
  type TrackerApi,
} from "@drifty/domain";
import { buildIsoDayList, getLogicalDayRange } from "../../lib/formatting";
import { buildWeekDashboardDayModel } from "../dashboard/weekDashboardModel";
import { buildWeekTimelineEvents } from "../dashboard/weekTimelineEvents";
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
} from "./activityLabelBlocks";
import { consumeActivityLabelRequest } from "./activityLabelBudget";
import { createActivityLabelInference, type ActivityLabelInference } from "./activityLabelInference";

const CLOCK_TICK_MS = 60_000;
const FAILURE_BACKOFF_MS = 15 * 60_000;
const BUDGET_BACKOFF_MS = 30 * 60_000;
/** Background cadence for today's and yesterday's windows. */
const BACKGROUND_TICK_MS = 10 * 60_000;
const EMPTY_LABELS: readonly ActivityBlockLabelRecord[] = [];
const EMPTY_WINDOWS: readonly ActivityTimelineWindowRecord[] = [];

export type ActivityLabelsController = {
  readonly index: ActivityLabelIndex;
  /** Stored-card boundaries before B; absent on older/standalone controllers. */
  readonly weekCalendarEvents?: ReadonlyMap<string, readonly WeekCalendarEvent[]>;
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
  const supported = Boolean(tracker.getActivityBlockLabels && tracker.getActivityTimelineCards && tracker.saveActivityTimelineWindow);
  const range = useMemo(() => getLogicalDayRange(startDay, endDay, startOfDayMinutes), [endDay, startDay, startOfDayMinutes]);
  const rangeKey = range.start + "|" + range.end;
  const [labelState, setLabelState] = useState<{
    readonly key: string;
    readonly labels: readonly ActivityBlockLabelRecord[];
    readonly windows: readonly ActivityTimelineWindowRecord[];
  }>({ key: "", labels: EMPTY_LABELS, windows: EMPTY_WINDOWS });
  const [nowMs, setNowMs] = useState(() => (args.now ?? Date.now)());
  const [revision, setRevision] = useState(0);
  const mountedRef = useRef(true);
  const scopeRef = useRef("");
  const runningRef = useRef(false);
  // Only successful saves settle a window for this session. No-model empty
  // windows are checked once again when the allowed evidence changes.
  const settledRef = useRef(new Set<string>());
  const backoffUntilRef = useRef(0);
  const nowRef = useRef(args.now);
  nowRef.current = args.now;
  const scope = [rangeKey, language, requestScopeKey, policy.windowTitle, policy.contentContext].join("|");
  scopeRef.current = scope;
  const backgroundScope = [language, requestScopeKey, policy.windowTitle, policy.contentContext, startOfDayMinutes].join("|");
  const backgroundScopeRef = useRef("");
  backgroundScopeRef.current = backgroundScope;
  const [backgroundTick, setBackgroundTick] = useState(0);
  const titlesEnabled = policy.windowTitle || policy.contentContext;

  useEffect(() => {
    backoffUntilRef.current = 0;
  }, [requestScopeKey]);

  useEffect(() => {
    settledRef.current.clear();
  }, [policy.contentContext, policy.windowTitle]);

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
    if (!supported || !tracker.getActivityBlockLabels || !tracker.getActivityTimelineCards) return;
    const key = rangeKey;
    const query = { start: range.start, end: range.end };
    try {
      const [labels, windows] = await Promise.all([tracker.getActivityBlockLabels(query), tracker.getActivityTimelineCards(query)]);
      if (mountedRef.current) setLabelState({ key, labels, windows });
    } catch {
      if (mountedRef.current) setLabelState({ key, labels: EMPTY_LABELS, windows: EMPTY_WINDOWS });
    }
  }, [range.end, range.start, rangeKey, supported, tracker]);

  // Record deletion removes labels in the tracker, so a changed record set reloads them.
  const segmentCount = segments.length;
  useEffect(() => {
    if (!active) return;
    void reload();
  }, [active, reload, segmentCount, revision]);

  const segmentsById = useMemo(() => new Map(segments.map((segment) => [segment.id, segment])), [segments]);
  const eventsByDay = useMemo<ReadonlyMap<string, readonly WeekCalendarEvent[]>>(() => {
    if (!active) return new Map();
    if (weekCalendarEvents && weekCalendarEvents.size > 0) return weekCalendarEvents;
    return new Map(buildIsoDayList(startDay, endDay).map((day) => [
      day,
      buildWeekDashboardDayModel({ day, segments: [...segments], classificationOptions, startOfDayMinutes }).calendarEvents,
    ]));
  }, [active, classificationOptions, endDay, segments, startDay, startOfDayMinutes, weekCalendarEvents]);

  const labels = labelState.key === rangeKey ? labelState.labels : EMPTY_LABELS;
  const storedWindows = labelState.key === rangeKey ? labelState.windows : EMPTY_WINDOWS;
  const timelineEvents = useMemo(() => buildWeekTimelineEvents(eventsByDay, segments, storedActivityTimelineCards(storedWindows, language), {
    startOfDayMinutes, classificationOptions,
  }), [classificationOptions, eventsByDay, language, segments, startOfDayMinutes, storedWindows]);
  const blocks = useMemo(
    () => buildActivityLabelBlocks(timelineEvents, { startOfDayMinutes, segmentsById, labels, windows: storedWindows, language, nowMs }),
    [timelineEvents, labels, language, nowMs, segmentsById, startOfDayMinutes, storedWindows],
  );
  const index = useMemo(() => buildActivityLabelIndex(blocks, segmentsById), [blocks, segmentsById]);

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
    let input = activityTimelineWindowSaveInput(window, [], language, {});
    // Too few titles, or only runs too short to list: nothing to ask about,
    // so the window is stored without cards and keeps its app display.
    const listed = listedActivityTimelineRecords(records);
    if (listed.length > 0 && activityTimelineTitleCoverage(records) >= ACTIVITY_TIMELINE_MIN_WINDOW_TITLE_COVERAGE) {
      if (!consumeActivityLabelRequest(analysisSetup.provider, localDay(Date.now()))) {
        backoffUntilRef.current = Date.now() + BUDGET_BACKOFF_MS;
        return "stop";
      }
      const inference = await buildInference(isCurrent);
      const promptInput = activityTimelineCardPromptInput(listed, records, language);
      const result = await inference(buildActivityTimelineCardPromptFromInput(promptInput), promptInput);
      if (!isCurrent()) return "stop";
      if (!result.output) {
        backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
        return "stop";
      }
      const { cards } = decideActivityTimelineCards(window, records, listed, result.output, language);
      input = activityTimelineWindowSaveInput(window, cards, language, result.usage);
    }
    if (!isCurrent()) return "stop";
    const result = await tracker.saveActivityTimelineWindow!(input);
    if (result.saved !== 1) {
      backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
      return "stop";
    }
    if (isCurrent()) settledRef.current.add(window.key + "|" + language);
    return "saved";
  }, [analysisSetup.provider, buildInference, language, policy, tracker]);
  // The background run calls the latest describeWindow through a ref so its
  // effect re-runs only on its tick, connection and scope, not on every render.
  const describeWindowRef = useRef(describeWindow);
  describeWindowRef.current = describeWindow;

  useEffect(() => {
    if (!active || !supported || !analysisConnected || !titlesEnabled || labelState.key !== rangeKey) return;
    if (runningRef.current || Date.now() < backoffUntilRef.current) return;
    // Latest finished window first: closed by a later record or a long break.
    const window = windows
      .filter((candidate) => !settledRef.current.has(candidate.key + "|" + language)
        && !activityTimelineWindowAnswered(candidate, storedWindows, language)
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
        if (isCurrent()) backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
      } finally {
        runningRef.current = false;
        if (mountedRef.current) {
          if (saved || !isCurrent()) setRevision((value) => value + 1);
          if (!isCurrent()) setBackgroundTick((value) => value + 1);
        }
      }
    })();
  }, [active, analysisConnected, describeWindow, labelState.key, language, nowMs, rangeKey, scope, segmentsById, startOfDayMinutes, storedWindows, supported, titlesEnabled, tracker, windows]);

  // Background: like the hourly project pass, cards for today's and
  // yesterday's finished windows are made whether or not Day or Week is open,
  // at start and every few minutes, latest first, one request at a time.
  useEffect(() => {
    if (!background) return;
    const interval = window.setInterval(() => setBackgroundTick((value) => value + 1), BACKGROUND_TICK_MS);
    return () => window.clearInterval(interval);
  }, [background]);

  useEffect(() => {
    if (!background || !supported || !analysisConnected || !titlesEnabled || !tracker.getActivityTimelineCards) return;
    if (runningRef.current || Date.now() < backoffUntilRef.current) return;
    runningRef.current = true;
    const requestScope = backgroundScope;
    const isCurrent = () => mountedRef.current && backgroundScopeRef.current === requestScope;
    const readWindows = tracker.getActivityTimelineCards.bind(tracker);
    void (async () => {
      let saved = false;
      try {
        const now = (nowRef.current ?? Date.now)();
        const today = logicalDayIsoDateForDate(new Date(now), startOfDayMinutes);
        const days = [shiftIsoDate(today, -1), today];
        const span = getLogicalDayRange(days[0], today, startOfDayMinutes);
        const [stored, recent] = await Promise.all([
          readWindows({ start: span.start, end: span.end }),
          tracker.getTimeline({ start: span.start, end: span.end }),
        ]);
        if (!isCurrent()) return;
        const recordsById = new Map(recent.map((segment) => [segment.id, segment]));
        const pending = days
          .flatMap((day) => {
            const dayRange = getLogicalDayRange(day, day, startOfDayMinutes);
            return buildActivityTimelineWindows(day, recent, Date.parse(dayRange.start), Date.parse(dayRange.end));
          })
          .filter((candidate) => !settledRef.current.has(candidate.key + "|" + language)
            && !activityTimelineWindowAnswered(candidate, stored, language)
            && (candidate.followed || now - candidate.endMs >= ACTIVITY_TIMELINE_SESSION_GAP_MS + ACTIVITY_LABEL_SETTLE_MS))
          .sort((left, right) => right.endMs - left.endMs);
        for (const candidate of pending) {
          if (!isCurrent() || Date.now() < backoffUntilRef.current) break;
          if ((await describeWindowRef.current(candidate, recordsById, isCurrent)) !== "saved") break;
          saved = true;
        }
      } catch {
        if (isCurrent()) backoffUntilRef.current = Date.now() + FAILURE_BACKOFF_MS;
      } finally {
        runningRef.current = false;
        if (mountedRef.current) {
          if (saved || !isCurrent()) setRevision((value) => value + 1);
          if (!isCurrent()) setBackgroundTick((value) => value + 1);
        }
      }
    })();
  }, [analysisConnected, background, backgroundScope, backgroundTick, language, startOfDayMinutes, supported, titlesEnabled, tracker]);

  // A legacy hidden block can now be several cards. Materialize its current
  // slices before changing one, so showing that card cannot unhide its siblings.
  // Fresh rows and serialized writes also handle the hide/show loop of a B group.
  const choiceQueueRef = useRef(Promise.resolve());
  const queueChoice = useCallback((operation: () => Promise<void>) => {
    const next = choiceQueueRef.current.then(operation);
    choiceQueueRef.current = next.catch(() => undefined);
    return next;
  }, []);
  const materializeCarriedChoice = useCallback(async (block: ActivityLabelBlock) => {
    if (block.resolution.kind !== "user" || !block.resolution.carried) return;
    const originalKey = block.resolution.record.blockKey;
    const fresh = await tracker.getActivityBlockLabels!({ start: range.start, end: range.end });
    const current = buildActivityLabelBlocks(timelineEvents, {
      startOfDayMinutes, segmentsById, labels: fresh, windows: storedWindows, language, nowMs,
    });
    for (const sibling of current) {
      if (sibling.resolution.kind !== "user" || sibling.resolution.record.blockKey !== originalKey) continue;
      const record = sibling.resolution.record;
      await tracker.saveActivityBlockUserLabel!({
        blockKey: sibling.key, logicalDay: sibling.day, blockStartedAt: new Date(sibling.startMs).toISOString(),
        blockEndedAt: new Date(sibling.endMs).toISOString(), segmentIds: sibling.segmentIds,
        title: record.status === "hidden" ? "" : record.title, description: record.description,
      });
    }
    await tracker.deleteActivityBlockUserLabel!(originalKey);
  }, [language, nowMs, range.end, range.start, segmentsById, startOfDayMinutes, storedWindows, timelineEvents, tracker]);

  const saveUserLabel = useCallback((block: ActivityLabelBlock, title: string, description: string) => queueChoice(async () => {
    if (!tracker.saveActivityBlockUserLabel) throw new Error("Block labels are unavailable.");
    await materializeCarriedChoice(block);
    await tracker.saveActivityBlockUserLabel({
      blockKey: block.key,
      logicalDay: block.day,
      blockStartedAt: new Date(block.startMs).toISOString(),
      blockEndedAt: new Date(block.endMs).toISOString(),
      segmentIds: block.segmentIds,
      title: title.trim(),
      description: description.trim(),
    });
    if (mountedRef.current) setRevision((value) => value + 1);
  }), [materializeCarriedChoice, queueChoice, tracker]);

  const resetUserLabel = useCallback((block: ActivityLabelBlock) => queueChoice(async () => {
    if (block.resolution.kind !== "user" || !tracker.deleteActivityBlockUserLabel) return;
    await materializeCarriedChoice(block);
    await tracker.deleteActivityBlockUserLabel(block.key);
    if (mountedRef.current) setRevision((value) => value + 1);
  }), [materializeCarriedChoice, queueChoice, tracker]);

  return useMemo(() => {
    if (!active || !supported) return null;
    return {
      index,
      weekCalendarEvents: timelineEvents,
      editingEnabled: Boolean(tracker.saveActivityBlockUserLabel),
      saveUserLabel,
      resetUserLabel,
    };
  }, [active, index, resetUserLabel, saveUserLabel, supported, timelineEvents, tracker.saveActivityBlockUserLabel]);
}
