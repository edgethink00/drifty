// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment, ClassificationMetrics, ClassificationQuery, CurrentActivitySnapshot } from "@drifty/domain";
import { logicalDayIsoDateForDate, todayIsoDate } from "@drifty/domain";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";
import type { AiClassificationSummary, AiClassificationUsageSummary } from "./features/classification/aiClassificationService";
import { BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY } from "./features/settings/settingsStorage";

const styles = readAppStyles();
const AI_CLASSIFICATION_BACKGROUND_THRESHOLD = 20;
const AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD = 5;
const AI_CLASSIFICATION_FOCUSED_IDLE_MS = 20 * 60 * 1000;
const APP_REFRESH_INTERVAL_MS = 30_000;
const DRIFT_ALARM_POLL_INTERVAL_MS = 15_000;
const AUTO_AI_CLASSIFICATION_INTERVAL_MS = 2 * 60 * 1000;
const DASHBOARD_WEEK_PREFETCH_DELAY_MS = 600;
const DEFAULT_START_OF_DAY_MINUTES = 4 * 60;

function timelineQueryIncludesDay(query: ClassificationQuery, day: string): boolean {
  if (query.day === day) return true;
  if (!query.start || !query.end) return false;
  return query.start <= `${day}T23:59:59` && query.end >= `${day}T00:00:00`;
}

function cssRule(selector: string): string {
  const start = styles.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = styles.indexOf("}", start);
  expect(end).toBeGreaterThan(start);
  return styles.slice(start, end + 1);
}

const { authState, aiClassificationMocks, billingMocks, cloudAiConnectionMock, trackerClient } = vi.hoisted(() => ({
  authState: {
    user: { id: "user-1", email: "alex@example.com" } as { id: string; email: string } | null,
    session: null,
    status: "authenticated" as "loading" | "authenticated" | "unauthenticated",
    callbackStatus: null as { phase: "waiting" | "received" | "exchanging" | "completed" | "failed"; message: string } | null,
    isEnabled: true,
    authMode: "optional" as "optional" | "required",
    isAuthRequired: false,
    allowsAnonymousAuth: true,
    hasRequiredAccountAuth: true,
    hasBlockingAuthConfigurationError: false,
    signInAnonymously: vi.fn(),
    signInWithWebsite: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    clearCallbackStatus: vi.fn(),
    signOut: vi.fn(),
  },
  aiClassificationMocks: {
    classifyLiveActivityWithAi: vi.fn(),
    describeAiClassificationFailure: vi.fn(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error ?? "AI classification failed.");
      const quotaWindow = /minute ai classification quota exceeded/i.test(message)
        ? "minute" as const
        : /hourly ai classification quota exceeded/i.test(message)
          ? "hour" as const
          : /daily ai classification quota exceeded/i.test(message)
            ? "day" as const
            : null;
      return quotaWindow
        ? { message, failureKind: "quota" as const, quotaWindow }
        : { message, failureKind: "transport" as const };
    }),
    getAiClassificationUsageSummary: vi.fn(),
    runAiClassification: vi.fn(),
    runAiClassificationForUnknownThreshold: vi.fn(),
    runAiClassificationUntilEmpty: vi.fn(),
  },
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
    createBillingPortalSession: vi.fn().mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } }),
  },
  cloudAiConnectionMock: vi.fn(),
  trackerClient: {
    getStatus: vi.fn(),
    getTimeline: vi.fn(),
    getDashboardWeekTimeline: vi.fn().mockResolvedValue([]),
    getLiveTail: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    getHourlySummary: vi.fn(),
	    getTopSites: vi.fn(),
	    getAppIcons: vi.fn(),
	    getUnclassifiedSegments: vi.fn(),
	    getClassificationMetrics: vi.fn(),
	    getClassificationRules: vi.fn(),
	    saveClassificationRule: vi.fn(),
	    deleteClassificationRule: vi.fn(),
	    searchClassificationRuleCandidates: vi.fn(),
	    applyClassificationRules: vi.fn(),
	    saveClassifications: vi.fn(),
	    start: vi.fn(),
	    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn(),
    updateTrayDriftAlarmStatus: vi.fn(),
  },
}));

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
  useAuthConnectionStatus: () => ({ cloudConnectionStatus: "online" }),
}));

vi.mock("./lib/api/trackerClient", () => ({ trackerClient }));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  fetchIndividualPricingQuote: vi.fn().mockResolvedValue({ success: false, error: "Pricing unavailable in this test." }),
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  createBillingPortalSession: billingMocks.createBillingPortalSession,
}));

vi.mock("./features/settings/cloudAiConnectionTest", () => ({
  testCloudAiConnection: cloudAiConnectionMock,
}));

vi.mock("./features/classification/aiClassificationService", async () => {
  // Keep every real export App.tsx may call (for example
  // describeLocalAiClassificationFailure); override only what these tests
  // control. See appMockCoverage.test.ts.
  const actual = await vi.importActual<typeof import("./features/classification/aiClassificationService")>("./features/classification/aiClassificationService");
  function projectAiClassificationCost(
    usage: { itemsRequested: number; estimatedCostUsd: number } | null | undefined,
    metrics: { totalSegments: number } | null | undefined,
  ) {
    const processedItems = usage?.itemsRequested ?? 0;
    const candidateItems = metrics?.totalSegments ?? 0;
    const measuredCostUsd = usage?.estimatedCostUsd ?? 0;
    const multiplier = processedItems > 0 && candidateItems > 0 ? candidateItems / processedItems : 0;
    const dailyProjectedCostUsd = processedItems > 0 && candidateItems > 0 ? measuredCostUsd * multiplier : 0;

    return {
      processedItems,
      candidateItems,
      multiplier,
      measuredCostUsd,
      dailyProjectedCostUsd,
      monthlyProjectedCostUsd: dailyProjectedCostUsd * 30,
    };
  }

  function positiveDelta(after: number | null | undefined, before: number | null | undefined) {
    return Math.max((after ?? 0) - (before ?? 0), 0);
  }

  function diffAiClassificationUsageSummary(
    before: AiClassificationUsageSummary | null | undefined,
    after: AiClassificationUsageSummary | null | undefined,
  ): AiClassificationUsageSummary {
    const requests = positiveDelta(after?.requests, before?.requests);
    const errors = positiveDelta(after?.errors, before?.errors);
    const latencyMsTotal = positiveDelta(after?.latencyMsTotal, before?.latencyMsTotal);

    return {
      requests,
      llmRequests: positiveDelta(after?.llmRequests, before?.llmRequests),
      itemsRequested: positiveDelta(after?.itemsRequested, before?.itemsRequested),
      cacheHits: positiveDelta(after?.cacheHits, before?.cacheHits),
      cacheMisses: positiveDelta(after?.cacheMisses, before?.cacheMisses),
      errors,
      quotaErrors: positiveDelta(after?.quotaErrors, before?.quotaErrors),
      configErrors: positiveDelta(after?.configErrors, before?.configErrors),
      requestErrors: positiveDelta(after?.requestErrors, before?.requestErrors),
      parseErrors: positiveDelta(after?.parseErrors, before?.parseErrors),
      schemaErrors: positiveDelta(after?.schemaErrors, before?.schemaErrors),
      lastErrorType: errors > 0 ? after?.lastErrorType ?? null : null,
      lastErrorMessage: errors > 0 ? after?.lastErrorMessage ?? null : null,
      lastErrorStatus: errors > 0 ? after?.lastErrorStatus ?? null : null,
      lastErrorAt: errors > 0 ? after?.lastErrorAt ?? null : null,
      latencyMsTotal,
      averageLatencyMs: requests > 0 ? Math.round(latencyMsTotal / requests) : 0,
      promptTokens: positiveDelta(after?.promptTokens, before?.promptTokens),
      responseTokens: positiveDelta(after?.responseTokens, before?.responseTokens),
      totalTokens: positiveDelta(after?.totalTokens, before?.totalTokens),
      estimatedCostUsd: positiveDelta(after?.estimatedCostUsd, before?.estimatedCostUsd),
    };
  }

  return {
    ...actual,
    AI_CLASSIFICATION_BACKGROUND_THRESHOLD: 20,
    AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD: 5,
    AI_CLASSIFICATION_FOCUSED_IDLE_MS: 20 * 60 * 1000,
    diffAiClassificationUsageSummary,
    projectAiClassificationCost,
    toClassificationQueryForDay: (day: string, limit?: number) => (limit ? { day, limit } : { day }),
    getAiClassificationUsageSummary: aiClassificationMocks.getAiClassificationUsageSummary,
    runAiClassification: aiClassificationMocks.runAiClassification,
    clearCloudAiRequestBackoff: vi.fn(),
    classifyLiveActivityWithAi: aiClassificationMocks.classifyLiveActivityWithAi,
    describeAiClassificationFailure: aiClassificationMocks.describeAiClassificationFailure,
    runAiClassificationForUnknownThreshold: aiClassificationMocks.runAiClassificationForUnknownThreshold,
    runAiClassificationUntilEmpty: aiClassificationMocks.runAiClassificationUntilEmpty,
  };
});

vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null, data: [] }),
  fetchOwnLeaderboardEntry: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  fetchOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  publishOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: true }),
  optOutLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null }),
  publishOwnFocusTotal: vi.fn().mockResolvedValue({ success: true, error: null, data: { opted_in: true, rank: null } }),
}));

vi.mock("./features/profile/profileService", () => ({
  fallbackDisplayName: (email?: string | null) => email?.split("@")[0] ?? "drifty",
  fetchOwnProfile: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  fetchPublicProfile: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  saveOwnProfile: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
}));

import App from "./App";
import { readAppStyles } from "./test/readStyles";

const selectedDayMetrics: ClassificationMetrics = {
  totalSegments: 100,
  classifiedSegments: 70,
  unclassifiedSegments: 30,
  aiClassifiedSegments: 10,
  staleClassifications: 0,
};

function createUsageSummary(overrides: Partial<AiClassificationUsageSummary>): AiClassificationUsageSummary {
  return {
    requests: 0,
    llmRequests: 0,
    itemsRequested: 0,
    cacheHits: 0,
    cacheMisses: 0,
    errors: 0,
    quotaErrors: 0,
    configErrors: 0,
    requestErrors: 0,
    parseErrors: 0,
    schemaErrors: 0,
    lastErrorType: null,
    lastErrorMessage: null,
    lastErrorStatus: null,
    lastErrorAt: null,
    latencyMsTotal: 0,
    averageLatencyMs: 0,
    promptTokens: 0,
    responseTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function mockAutoAiClassificationEmpty() {
  aiClassificationMocks.runAiClassificationForUnknownThreshold.mockResolvedValue({
    status: "empty",
    selectedSegments: 0,
    savedRecords: 0,
    message: "No unknown activity met the threshold.",
    metrics: selectedDayMetrics,
  } satisfies AiClassificationSummary);
}

async function flushInitialDashboardWeekPrefetch() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(DASHBOARD_WEEK_PREFETCH_DELAY_MS);
  });
}

const selectedDayUsage = createUsageSummary({
  requests: 1,
  llmRequests: 1,
  itemsRequested: 3,
  cacheMisses: 3,
  latencyMsTotal: 900,
  averageLatencyMs: 900,
  promptTokens: 9_000,
  responseTokens: 1_000,
  totalTokens: 10_000,
  estimatedCostUsd: 0.003,
});

const executionUsageBefore = createUsageSummary({
  requests: 4,
  llmRequests: 4,
  itemsRequested: 40,
  cacheMisses: 40,
  latencyMsTotal: 4000,
  averageLatencyMs: 1000,
  promptTokens: 100_000,
  responseTokens: 20_000,
  totalTokens: 120_000,
  estimatedCostUsd: 0.1,
});

let executionUsageAfterAvailable = false;

const executionUsageAfter = createUsageSummary({
  requests: 5,
  llmRequests: 5,
  itemsRequested: 50,
  cacheHits: 1,
  cacheMisses: 49,
  latencyMsTotal: 5200,
  averageLatencyMs: 1040,
  promptTokens: 140_000,
  responseTokens: 26_667,
  totalTokens: 166_667,
  estimatedCostUsd: 0.12,
});

function markOnboardingCompleted(userId: string) {
  window.localStorage.setItem(
    getUserOnboardingStorageKey(userId),
    JSON.stringify({
      version: 1,
      completed: true,
      displayName: "Alex",
      purpose: "exploring",
      completedAt: "2026-05-08T00:00:00.000Z",
    }),
  );
}

function mockSidebarCollapseMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function createSegmentForDay(day: string): ActivitySegment {
  return {
    id: `segment-${day}`,
    startedAt: `${day}T09:00:00.000`,
    endedAt: `${day}T09:30:00.000`,
    durationSeconds: 1800,
    appName: "Code",
    bundleId: "com.microsoft.VSCode",
    windowTitle: "Selected day work",
    platform: "macos",
    source: "nsworkspace",
  };
}

function createUnclassifiedSegments(count: number, day = todayIsoDate()): ActivitySegment[] {
  return Array.from({ length: count }, (_, index) => ({
    ...createSegmentForDay(day),
    id: `unclassified-${day}-${index}`,
    windowTitle: `Unclassified work ${index}`,
  }));
}

function currentAutoClassificationDay(): string {
  return logicalDayIsoDateForDate(new Date(), DEFAULT_START_OF_DAY_MINUTES);
}

function setRendererFocus(focused: boolean) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: focused ? "visible" : "hidden",
  });
  Object.defineProperty(document, "hasFocus", {
    configurable: true,
    value: vi.fn(() => focused),
  });
}

function disableAiAvailabilityGateForSchedulerTest() {
  window.localStorage.setItem("drifty.dev.mode", "1");
  window.localStorage.setItem("drifty.dev.disableAiAvailabilityGate", "1");
}

describe("App AI classification controls", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    window.localStorage.clear();
    setRendererFocus(true);
    mockSidebarCollapseMedia();
    markOnboardingCompleted("user-1");
    authState.user = { id: "user-1", email: "alex@example.com" };
    authState.status = "authenticated";
    authState.isEnabled = true;
    authState.isAuthRequired = false;
    authState.hasRequiredAccountAuth = true;
    authState.hasBlockingAuthConfigurationError = false;
    executionUsageAfterAvailable = false;

    trackerClient.getStatus.mockResolvedValue({
      running: false,
      accessibilityGranted: true,
      lastEventAt: null,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => {
      const today = todayIsoDate();
      const queryDay = query.day ?? query.start?.slice(0, 10) ?? null;
      return Promise.resolve(queryDay && queryDay !== today ? [createSegmentForDay(queryDay)] : []);
    });
    trackerClient.getLiveTail.mockResolvedValue({
      running: false,
      trackerMode: "tracking",
      lastEventAt: null,
      segments: [],
    });
    trackerClient.getCurrentSnapshot.mockResolvedValue(null);
    trackerClient.getHourlySummary.mockResolvedValue([]);
    trackerClient.getTopSites.mockResolvedValue([]);
	    trackerClient.getAppIcons.mockResolvedValue({});
	    trackerClient.getUnclassifiedSegments.mockResolvedValue([]);
	    trackerClient.getClassificationMetrics.mockResolvedValue(selectedDayMetrics);
	    trackerClient.getClassificationRules.mockResolvedValue([]);
	    trackerClient.saveClassificationRule.mockImplementation(async (input) => ({
	      id: `${input.targetKind}:${input.targetValue}`,
	      targetKind: input.targetKind,
	      targetValue: input.targetValue,
	      matchScope: input.matchScope ?? "surface",
	      detailKind: input.detailKind ?? null,
	      detailValue: input.detailValue ?? null,
	      category: input.category,
	      productivity: input.productivity,
	      enabled: input.enabled ?? true,
	      confidence: input.confidence ?? null,
	    }));
	    trackerClient.deleteClassificationRule.mockResolvedValue({ deleted: 1 });
	    trackerClient.searchClassificationRuleCandidates.mockResolvedValue([]);
	    trackerClient.applyClassificationRules.mockResolvedValue({ matchedCount: 0, appliedCount: 0, skippedCount: 0 });
	    trackerClient.saveClassifications.mockResolvedValue({ saved: 1 });
	    trackerClient.start.mockResolvedValue({ running: true, accessibilityGranted: true, lastEventAt: null, databasePath: "/tmp/drifty.sqlite3", trackerMode: "tracking" });
    trackerClient.stop.mockResolvedValue({ running: false, accessibilityGranted: true, lastEventAt: null, databasePath: "/tmp/drifty.sqlite3", trackerMode: "tracking" });
    trackerClient.updateTrayProductivityIcon.mockResolvedValue(undefined);
    trackerClient.updateTrayDriftAlarmStatus.mockResolvedValue(undefined);
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });
    billingMocks.createBillingPortalSession.mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } });
    cloudAiConnectionMock.mockResolvedValue({ kind: "success", message: "Cloud AI connected." });
    aiClassificationMocks.getAiClassificationUsageSummary.mockImplementation((day: string) => Promise.resolve(
      day === todayIsoDate()
        ? executionUsageAfterAvailable ? executionUsageAfter : executionUsageBefore
        : selectedDayUsage,
    ));
    aiClassificationMocks.classifyLiveActivityWithAi.mockResolvedValue({ kind: "unavailable", reason: "not configured in this test" });
    aiClassificationMocks.runAiClassification.mockImplementation(async () => {
      executionUsageAfterAvailable = true;
      return { status: "saved", selectedSegments: 10, savedRecords: 10, message: "Saved 10 AI classifications.", metrics: selectedDayMetrics } satisfies AiClassificationSummary;
    });
    aiClassificationMocks.runAiClassificationForUnknownThreshold.mockImplementation(async () => {
      executionUsageAfterAvailable = true;
      return { status: "saved", selectedSegments: 10, savedRecords: 10, message: "Saved 10 AI classifications.", metrics: selectedDayMetrics } satisfies AiClassificationSummary;
    });
    aiClassificationMocks.runAiClassificationUntilEmpty.mockImplementation(async () => {
      executionUsageAfterAvailable = true;
      return {
        status: "saved",
        selectedSegments: 30,
        savedRecords: 30,
        message: "Classified all available activity: saved 30 AI classifications across 2 batches.",
        metrics: { ...selectedDayMetrics, classifiedSegments: 100, unclassifiedSegments: 0 },
      } satisfies AiClassificationSummary;
    });
  });

  it("does not read AI classification usage while refreshing dashboard dates", async () => {
    render(<App />);

    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    trackerClient.getTimeline.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /show previous today/i }));

    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    expect(aiClassificationMocks.getAiClassificationUsageSummary).not.toHaveBeenCalled();
  });

  it("keeps long classification activity detail titles recoverable", async () => {
    const selectedDay = todayIsoDate();
    const longWindowTitle = "Quarterly classification QA reproduction title - ".repeat(10) + "final window title segment";
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => Promise.resolve(
      timelineQueryIncludesDay(query, selectedDay)
        ? [{
            ...createSegmentForDay(selectedDay),
            id: "long-activity-title",
            appName: "Visual Studio Code",
            bundleId: "com.microsoft.VSCode",
            windowTitle: longWindowTitle,
          }]
        : [],
    ));
    render(<App />);

    const primaryNavigation = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: /^classification$/i }));

    const title = await screen.findByTitle(longWindowTitle);
    expect(title.textContent).toBe(longWindowTitle);
    expect(title.closest(".classification-panel-view__activity-row")).toBeTruthy();
  });

  it("places classification panel header labels above their values", async () => {
    const selectedDay = todayIsoDate();
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => Promise.resolve(
      timelineQueryIncludesDay(query, selectedDay) ? [createSegmentForDay(selectedDay)] : [],
    ));
    render(<App />);

    const primaryNavigation = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: /^classification$/i }));

    const panel = await screen.findByLabelText("Classification panel view") as HTMLElement;
    const headers = panel.querySelectorAll(".classification-panel-view__panel-header");
    const rightStacks = Array.from(headers).slice(0, 2).map((header) => header.querySelector(".panel-header__right"));

    expect(rightStacks).toHaveLength(2);
    for (const stack of rightStacks) {
      expect(Array.from(stack?.children ?? []).map((child) => child.className)).toEqual([
        "panel-header__meta",
        "panel-header__value",
      ]);
    }
    expect(rightStacks[0]?.textContent).toBe("Total30m");
    expect(rightStacks[1]?.textContent).toBe("source1");
  });

  it("keeps browser source rows site-wise when only a page title is captured", async () => {
    const selectedDay = todayIsoDate();
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => Promise.resolve(
      timelineQueryIncludesDay(query, selectedDay)
        ? [
            {
              ...createSegmentForDay(selectedDay),
              id: "classification-title-only-browser",
              startedAt: `${selectedDay}T10:00:00.000`,
              endedAt: `${selectedDay}T10:45:00.000`,
              durationSeconds: 2700,
              appName: "Google Chrome",
              bundleId: "com.google.Chrome",
              browserName: "Google Chrome",
              siteDomain: "   ",
              siteTitle: "Course Canvas",
              windowTitle: "Course Canvas - Google Chrome",
              classification: {
                category: "workspace",
                productivity: "focus",
                source: "manual",
                confidence: 0.94,
              },
            },
            {
              ...createSegmentForDay(selectedDay),
              id: "classification-native-code",
              startedAt: `${selectedDay}T11:00:00.000`,
              endedAt: `${selectedDay}T11:10:00.000`,
              durationSeconds: 600,
              appName: "Visual Studio Code",
              bundleId: "com.microsoft.VSCode",
              windowTitle: "Implementation notes",
              classification: {
                category: "workspace",
                productivity: "focus",
                source: "manual",
                confidence: 0.98,
              },
            },
          ]
        : [],
    ));
    render(<App />);

    const primaryNavigation = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: /^classification$/i }));

    const panel = await screen.findByLabelText("Classification panel view") as HTMLElement;
    const sourceRows = Array.from(panel.querySelectorAll<HTMLElement>(".classification-panel-view__source-row"));

    expect(sourceRows.map((row) => row.querySelector("strong")?.textContent)).toEqual(["Course Canvas", "Visual Studio Code"]);
    expect(sourceRows[0]?.textContent).not.toContain("Google Chrome");
  });

  it("shows source productivity mix dots and short AI source labels in classification details", async () => {
    const selectedDay = todayIsoDate();
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => Promise.resolve(
      timelineQueryIncludesDay(query, selectedDay)
        ? [
            {
              ...createSegmentForDay(selectedDay),
              id: "gmail-neutral",
              startedAt: `${selectedDay}T09:00:00.000`,
              endedAt: `${selectedDay}T09:10:00.000`,
              durationSeconds: 600,
              appName: "Google Chrome",
              bundleId: "com.google.Chrome",
              browserName: "Google Chrome",
              siteDomain: "mail.google.com",
              siteTitle: "Gmail",
              windowTitle: "Inbox",
              classification: {
                category: "communication",
                productivity: "neutral",
                source: "llm",
                confidence: 0.96,
                reason: "Messaging context",
                aiResult: true,
              },
            },
            {
              ...createSegmentForDay(selectedDay),
              id: "gmail-drift",
              startedAt: `${selectedDay}T09:10:00.000`,
              endedAt: `${selectedDay}T09:15:00.000`,
              durationSeconds: 300,
              appName: "Google Chrome",
              bundleId: "com.google.Chrome",
              browserName: "Google Chrome",
              siteDomain: "mail.google.com",
              siteTitle: "Gmail",
              windowTitle: "Inbox",
              classification: {
                category: "communication",
                productivity: "drift",
                source: "llm",
                confidence: 0.94,
                reason: "Messaging drift",
                aiResult: true,
              },
            },
          ]
        : [],
    ));
    render(<App />);

    const primaryNavigation = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: /^classification$/i }));

    const panel = await screen.findByLabelText("Classification panel view") as HTMLElement;
    const sourceRow = await screen.findByRole("button", { name: /mail\.google\.com/i });
    const mix = sourceRow.querySelector(".classification-panel-view__source-productivity");
    expect(mix?.getAttribute("aria-label")).toBe("Neutral 10m, Drift 5m");
    expect(sourceRow.querySelectorAll(".classification-panel-view__source-productivity-dot")).toHaveLength(2);

    const activityToggle = panel.querySelector<HTMLButtonElement>(".classification-panel-view__activity-toggle");
    expect(activityToggle).toBeTruthy();
    fireEvent.click(activityToggle as HTMLButtonElement);
    const summary = panel.querySelector(".classification-panel-view__activity-classification");
    expect(summary?.textContent).not.toContain("SourceAI");
    expect(summary?.querySelectorAll("dd")).toHaveLength(3);
  });

  it("uses the selected category tone for classification selections and activity detail bars", async () => {
    const selectedDay = todayIsoDate();
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => Promise.resolve(
      timelineQueryIncludesDay(query, selectedDay)
        ? [
            createSegmentForDay(selectedDay),
            {
              ...createSegmentForDay(selectedDay),
              id: "entertainment-youtube",
              startedAt: `${selectedDay}T17:52:00.000`,
              endedAt: `${selectedDay}T18:21:00.000`,
              durationSeconds: 1740,
              appName: "Arc",
              bundleId: "company.thebrowser.Browser",
              browserName: "Arc",
              siteDomain: "youtube.com",
              siteTitle: "MKBHD - phone reviews",
              windowTitle: "MKBHD - phone reviews",
              classification: {
                category: "entertainment",
                productivity: "drift",
                source: "manual",
                confidence: 0.96,
                reason: "test entertainment row",
              },
            },
          ]
        : [],
    ));
    render(<App />);

    const primaryNavigation = await screen.findByRole("navigation", { name: /primary navigation/i });
    fireEvent.click(within(primaryNavigation).getByRole("button", { name: /^classification$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Entertainment/i }));

    const panel = await screen.findByLabelText("Classification panel view") as HTMLElement;
    const detailBar = document.querySelector(".classification-panel-view__activity-measure .classification-panel-view__bar span") as HTMLElement | null;
    const selectedCategories = document.querySelectorAll(".classification-panel-view__category-row[data-selected=\"true\"]");
    const selectedSource = document.querySelector(".classification-panel-view__source-row[data-selected=\"true\"]");

    expect(panel.style.getPropertyValue("--classification-selected-tone")).toBe("var(--category-entertainment)");
    expect(detailBar?.getAttribute("style")).toContain("background: var(--category-entertainment)");
    expect(selectedCategories).toHaveLength(1);
    expect(selectedCategories[0]?.textContent).toContain("Entertainment");
    expect(selectedSource?.textContent).toContain("youtube.com");
    expect(panel.querySelector(".classification-panel-view__insight-card")).toBeNull();
    expect(cssRule(".content--classification")).toContain("overflow-y: hidden;");
    expect(cssRule(".content--classification .page")).toMatch(/height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".content--classification .classification-panel-view")).toMatch(/flex:\s*1 1 auto;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".classification-panel-view__grid")).toMatch(/height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".classification-panel-view__grid")).toMatch(/grid-template-columns:\s*minmax\(0,\s*0\.95fr\)\s+minmax\(0,\s*1\.1fr\)\s+minmax\(0,\s*1\.45fr\);/);
    expect(styles).toMatch(/\.content--classification \.page\s*{[\s\S]*container-name:\s*classification-page;[\s\S]*container-type:\s*inline-size;/);
    expect(styles).not.toMatch(/@container classification-page\s*\(max-width:\s*55rem\)/);
    expect(styles).toMatch(/\.panel-header\s*{[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*8px 10px 7px;/);
    expect(styles).toMatch(/\.classification-panel-view\s*\{[\s\S]*--classification-row-height:\s*48px;/);
    expect(styles).toMatch(/\.classification-panel-view__category-row,\s*\.classification-panel-view__source-row\s*{[\s\S]*min-height:\s*var\(--classification-row-height\);/);
    expect(styles).toMatch(/\.classification-panel-view__category-row,\s*\.classification-panel-view__source-row\s*{[\s\S]*padding:\s*5px 8px;/);
    expect(cssRule(".classification-panel-view__category-row")).not.toMatch(/border-color:|box-shadow:|linear-gradient/);
    expect(cssRule(".classification-panel-view__activity-summary,\n.classification-panel-view__activity-toggle")).toContain("min-height: var(--classification-row-height);");
    expect(styles).toMatch(/\.classification-panel-view__activity-copy strong\s*{[\s\S]*font-size:\s*0\.71875rem;/);
    expect(styles).toMatch(/\.classification-panel-view__bar\s*{[\s\S]*height:\s*6px;/);
    expect(cssRule('.classification-panel-view__category-row[data-selected="true"]')).toContain("box-shadow: none;");
    expect(cssRule('.classification-panel-view__source-row[data-selected="true"]')).toContain("box-shadow: none;");
    expect(styles).toMatch(/\.classification-panel-view__activity-row\s*{[\s\S]*align-items:\s*center;/);
  }, 60_000);

  it("auto-runs one 20-item AI classification batch for the logical day when the renderer is not focused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T00:30:00+09:00"));
    const today = "2026-06-15";
    window.localStorage.setItem("drifty.general.startOfDayMinutes", "240");
    disableAiAvailabilityGateForSchedulerTest();
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));
    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      expect.objectContaining({ allowProviderlessPersistence: true, persistenceAllowed: expect.any(Function) }),
    ));
  });

  it("waits two minutes before retrying the auto AI classification batch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    const today = "2026-06-16";
    disableAiAvailabilityGateForSchedulerTest();
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));
    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledTimes(1));
    aiClassificationMocks.runAiClassificationForUnknownThreshold.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS / 2);
    });
    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS / 2);
    });
    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      expect.objectContaining({ allowProviderlessPersistence: true, persistenceAllowed: expect.any(Function) }),
    ));
  });

  it("does not turn repeated Cloud quota denials into a connection issue", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    const today = "2026-06-16";
    disableAiAvailabilityGateForSchedulerTest();
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));
    aiClassificationMocks.runAiClassificationForUnknownThreshold.mockRejectedValue(
      new Error("Minute AI classification quota exceeded. Please wait before trying again."),
    );

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledTimes(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });
    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledTimes(2));

    expect(await screen.findByRole("button", {
      name: /AI connection: Connected, Drifty Cloud\. Open AI settings/i,
    })).toBeTruthy();
    expect(screen.queryByRole("button", {
      name: /AI connection: Connection issue, Drifty Cloud\. Open AI settings/i,
    })).toBeNull();
  });

  it("runs live AI classification for current unknown drift alarm activity before the batch threshold", async () => {
    const today = todayIsoDate();
    const gameSegment: ActivitySegment = {
      id: "survev-1",
      startedAt: `${today}T09:00:00.000Z`,
      endedAt: `${today}T09:05:00.000Z`,
      durationSeconds: 300,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "survev.io - 2d battle royale game - Chrome",
      browserName: "Google Chrome",
      siteDomain: "survev.io",
      siteTitle: "survev.io - 2d battle royale game",
      siteUrl: "https://survev.io/",
      platform: "macos",
      source: "accessibility",
    };
    const classifiedGameSegment: ActivitySegment = {
      ...gameSegment,
      classification: {
        category: "game",
        productivity: "drift",
        source: "llm",
        confidence: 0.9,
        reason: "AI classified live browser game",
        aiResult: true,
      },
    };
    const gameSnapshot: CurrentActivitySnapshot = {
      observedAt: `${today}T09:06:00.000Z`,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "survev.io - 2d battle royale game - Chrome",
      browserName: "Google Chrome",
      siteDomain: "survev.io",
      siteTitle: "survev.io - 2d battle royale game",
      siteUrl: "https://survev.io/",
      source: "accessibility",
    };
    let liveClassified = false;
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T09:06:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });
    trackerClient.getTimeline.mockImplementation(() => Promise.resolve(liveClassified ? [classifiedGameSegment] : [gameSegment]));
    trackerClient.getCurrentSnapshot.mockResolvedValue(gameSnapshot);
    aiClassificationMocks.classifyLiveActivityWithAi.mockImplementation(async () => {
      liveClassified = true;
      return {
        kind: "classified",
        classification: {
          segmentId: "survev-1",
          inputFingerprint: "live-survev",
          category: "game",
          productivity: "drift",
          source: "llm",
          confidence: 0.9,
          reason: "AI classified live browser game",
          model: "gemini-3.1-flash-lite",
          promptVersion: "v2-work-profile",
          taxonomyVersion: "v1",
          aiResult: true,
          classifiedAt: `${today}T09:06:01.000Z`,
        },
      };
    });

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.classifyLiveActivityWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "survev-1",
        durationSeconds: 360,
        siteDomain: "survev.io",
      }),
      expect.objectContaining({ persistLiveResult: true }),
    ));
    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();
  });

  it("backs off unavailable live AI drift alarm classification between polls", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:06:00+09:00"));
    const today = "2026-06-16";
    const gameSegment: ActivitySegment = {
      id: "survev-1",
      startedAt: `${today}T01:00:00.000Z`,
      endedAt: `${today}T01:05:00.000Z`,
      durationSeconds: 300,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "survev.io - 2d battle royale game - Chrome",
      browserName: "Google Chrome",
      siteDomain: "survev.io",
      siteTitle: "survev.io - 2d battle royale game",
      siteUrl: "https://survev.io/",
      platform: "macos",
      source: "accessibility",
    };
    const gameSnapshot: CurrentActivitySnapshot = {
      observedAt: `${today}T01:06:00.000Z`,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "survev.io - 2d battle royale game - Chrome",
      browserName: "Google Chrome",
      siteDomain: "survev.io",
      siteTitle: "survev.io - 2d battle royale game",
      siteUrl: "https://survev.io/",
      source: "accessibility",
    };
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T01:06:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });
    trackerClient.getTimeline.mockResolvedValue([gameSegment]);
    trackerClient.getCurrentSnapshot.mockResolvedValue(gameSnapshot);
    aiClassificationMocks.classifyLiveActivityWithAi.mockResolvedValue({ kind: "unavailable", reason: "cloud unavailable" });

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.classifyLiveActivityWithAi).toHaveBeenCalledTimes(1));
    aiClassificationMocks.classifyLiveActivityWithAi.mockClear();
    trackerClient.getCurrentSnapshot.mockClear();

    act(() => {
      setRendererFocus(false);
      window.dispatchEvent(new Event("blur"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    expect(aiClassificationMocks.classifyLiveActivityWithAi).not.toHaveBeenCalled();
  });

  it("uses recent poll timeline segments for live drift alarm detection", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:06:00+09:00"));
    const today = "2026-06-16";
    const focusSegment: ActivitySegment = {
      id: "focus-before-game",
      startedAt: `${today}T00:45:00.000Z`,
      endedAt: `${today}T00:55:00.000Z`,
      durationSeconds: 600,
      appName: "Visual Studio Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "App.tsx",
      platform: "macos",
      source: "accessibility",
    };
    const gameSegment: ActivitySegment = {
      id: "survev-poll",
      startedAt: `${today}T01:04:00.000Z`,
      endedAt: `${today}T01:05:00.000Z`,
      durationSeconds: 60,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "survev.io - 2d battle royale game - Chrome",
      browserName: "Google Chrome",
      siteDomain: "survev.io",
      siteTitle: "survev.io - 2d battle royale game",
      siteUrl: "https://survev.io/",
      platform: "macos",
      source: "accessibility",
    };
    const gameSnapshot: CurrentActivitySnapshot = {
      observedAt: `${today}T01:06:15.000Z`,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "survev.io - 2d battle royale game - Chrome",
      browserName: "Google Chrome",
      siteDomain: "survev.io",
      siteTitle: "survev.io - 2d battle royale game",
      siteUrl: "https://survev.io/",
      source: "accessibility",
    };
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T01:06:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => Promise.resolve(
      query.start === `${today}T04:00:00` ? [focusSegment] : [gameSegment],
    ));
    trackerClient.getCurrentSnapshot.mockImplementation(async () => ({ ...gameSnapshot }));
    aiClassificationMocks.classifyLiveActivityWithAi.mockResolvedValue({ kind: "unavailable", reason: "cloud unavailable" });

    render(<App />);

    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalledWith({ start: `${today}T04:00:00`, end: "2026-06-17T03:59:59" }));
    expect(aiClassificationMocks.classifyLiveActivityWithAi).not.toHaveBeenCalled();

    act(() => {
      setRendererFocus(false);
      window.dispatchEvent(new Event("blur"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(aiClassificationMocks.classifyLiveActivityWithAi).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "survev-poll",
        durationSeconds: 135,
        siteDomain: "survev.io",
      }),
      expect.objectContaining({ persistLiveResult: true }),
    ));
  });

  it("polls live drift alarm activity every 15 seconds without a full refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    const today = "2026-06-16";
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    mockAutoAiClassificationEmpty();
    setRendererFocus(false);
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T01:00:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });

    render(<App />);
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    await flushInitialDashboardWeekPrefetch();

    trackerClient.getTimeline.mockClear();
    trackerClient.getCurrentSnapshot.mockClear();
    trackerClient.getStatus.mockClear();
    trackerClient.getTopSites.mockClear();
    trackerClient.getClassificationMetrics.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS / 2);
    });
    expect(trackerClient.getCurrentSnapshot).not.toHaveBeenCalled();
    expect(trackerClient.getTimeline).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS / 2);
    });
    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    expect(trackerClient.getTimeline).toHaveBeenCalledWith(expect.objectContaining({
      start: "2026-06-16T09:30:15",
      end: "2026-06-16T10:00:15",
    }));
    expect(trackerClient.getTimeline).not.toHaveBeenCalledWith(expect.objectContaining({
      start: `${today}T04:00:00`,
      end: "2026-06-17T03:59:59",
    }));
    expect(trackerClient.getStatus).not.toHaveBeenCalled();
    expect(trackerClient.getTopSites).not.toHaveBeenCalled();
    expect(trackerClient.getClassificationMetrics).not.toHaveBeenCalled();
  });

  it("continues today drift alarm polling while browsing a previous dashboard day", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    const today = "2026-06-16";
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    mockAutoAiClassificationEmpty();
    setRendererFocus(true);
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T01:00:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });

    render(<App />);
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalledWith({ start: `${today}T04:00:00`, end: "2026-06-17T03:59:59" }));
    await flushInitialDashboardWeekPrefetch();

    fireEvent.click(screen.getByRole("button", { name: /show previous today/i }));
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalledWith({ start: "2026-06-15T04:00:00", end: "2026-06-16T03:59:59" }));

    trackerClient.getTimeline.mockClear();
    trackerClient.getCurrentSnapshot.mockClear();
    trackerClient.getStatus.mockClear();

    act(() => {
      setRendererFocus(false);
      window.dispatchEvent(new Event("blur"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    expect(trackerClient.getTimeline).toHaveBeenCalledWith(expect.objectContaining({
      start: "2026-06-16T09:30:15",
      end: "2026-06-16T10:00:15",
    }));
    expect(trackerClient.getTimeline).not.toHaveBeenCalledWith(expect.objectContaining({
      start: "2026-06-15T04:00:00",
      end: "2026-06-16T03:59:59",
    }));
    expect(trackerClient.getStatus).not.toHaveBeenCalled();
  });

  it("uses lightweight live tail instead of full refresh while the renderer is focused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    const today = "2026-06-16";
    mockAutoAiClassificationEmpty();
    setRendererFocus(true);
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T01:00:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });
    trackerClient.getTimeline.mockResolvedValue([{
      id: "42",
      startedAt: `${today}T00:50:00.000Z`,
      endedAt: `${today}T01:00:00.000Z`,
      durationSeconds: 600,
      appName: "Drifty",
      bundleId: "so.drifty.mac",
      windowTitle: "Dashboard",
      platform: "macos",
      source: "accessibility",
    }]);
    trackerClient.getLiveTail.mockResolvedValue({
      running: true,
      trackerMode: "tracking",
      lastEventAt: `${today}T01:00:30.000Z`,
      segments: [{
        id: "42",
        startedAt: `${today}T00:50:00.000Z`,
        endedAt: `${today}T01:00:30.000Z`,
        durationSeconds: 630,
        appName: "Drifty",
        bundleId: "so.drifty.mac",
        windowTitle: "Dashboard",
        platform: "macos",
        source: "accessibility",
      }],
    });

    render(<App />);
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    await flushInitialDashboardWeekPrefetch();

    trackerClient.getTimeline.mockClear();
    trackerClient.getStatus.mockClear();
    trackerClient.getCurrentSnapshot.mockClear();
    trackerClient.getHourlySummary.mockClear();
    trackerClient.getTopSites.mockClear();
    trackerClient.getClassificationMetrics.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(APP_REFRESH_INTERVAL_MS);
    });

    await waitFor(() => expect(trackerClient.getLiveTail).toHaveBeenCalledWith({
      start: `${today}T04:00:00`,
      end: "2026-06-17T03:59:59",
      afterSegmentId: "42",
      afterEndedAt: `${today}T01:00:00.000Z`,
      limit: 8,
    }));
    expect(trackerClient.getStatus).not.toHaveBeenCalled();
    expect(trackerClient.getCurrentSnapshot).not.toHaveBeenCalled();
    expect(trackerClient.getTimeline).not.toHaveBeenCalled();
    expect(trackerClient.getHourlySummary).not.toHaveBeenCalled();
    expect(trackerClient.getTopSites).not.toHaveBeenCalled();
    expect(trackerClient.getClassificationMetrics).not.toHaveBeenCalled();
  });

  it("skips 15-second live drift alarm polling while the renderer is focused", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    mockAutoAiClassificationEmpty();
    setRendererFocus(true);
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: "2026-06-16T01:00:00.000Z",
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });

    render(<App />);
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    await flushInitialDashboardWeekPrefetch();

    trackerClient.getTimeline.mockClear();
    trackerClient.getCurrentSnapshot.mockClear();
    trackerClient.getStatus.mockClear();
    trackerClient.updateTrayDriftAlarmStatus.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS);
    });

    expect(trackerClient.getCurrentSnapshot).not.toHaveBeenCalled();
    expect(trackerClient.getTimeline).not.toHaveBeenCalled();
    expect(trackerClient.getStatus).not.toHaveBeenCalled();
    expect(trackerClient.updateTrayDriftAlarmStatus).not.toHaveBeenCalled();
  });

  it("keeps 15-second drift alarm polling out of the live tracker sidebar state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-06-16T10:00:00+09:00"));
    const today = "2026-06-16";
    const focusSegment: ActivitySegment = {
      id: "sidebar-focus-before-poll",
      startedAt: `${today}T00:50:00.000Z`,
      endedAt: `${today}T01:00:00.000Z`,
      durationSeconds: 600,
      appName: "Visual Studio Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "App.tsx",
      platform: "macos",
      source: "accessibility",
      classification: {
        category: "workspace",
        productivity: "focus",
        source: "manual",
        confidence: 0.9,
        reason: "test focused editor state",
      },
    };
    const chromeSegment: ActivitySegment = {
      id: "sidebar-poll-chrome",
      startedAt: `${today}T01:00:00.000Z`,
      endedAt: `${today}T01:00:15.000Z`,
      durationSeconds: 15,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "Docs",
      browserName: "Google Chrome",
      siteDomain: "docs.example.com",
      siteTitle: "Docs",
      siteUrl: "https://docs.example.com/",
      platform: "macos",
      source: "accessibility",
      classification: {
        category: "communication",
        productivity: "drift",
        source: "manual",
        confidence: 0.9,
        reason: "test drift alarm poll state",
      },
    };
    const focusSnapshot: CurrentActivitySnapshot = {
      observedAt: `${today}T01:00:00.000Z`,
      appName: "Visual Studio Code",
      bundleId: "com.microsoft.VSCode",
      windowTitle: "App.tsx",
      source: "accessibility",
    };
    const chromeSnapshot: CurrentActivitySnapshot = {
      observedAt: `${today}T01:00:15.000Z`,
      appName: "Google Chrome",
      bundleId: "com.google.Chrome",
      windowTitle: "Docs",
      browserName: "Google Chrome",
      siteDomain: "docs.example.com",
      siteTitle: "Docs",
      siteUrl: "https://docs.example.com/",
      source: "accessibility",
    };
    window.localStorage.setItem("drifty.notifications.driftAlerts", "1");
    trackerClient.getStatus.mockResolvedValue({
      running: true,
      accessibilityGranted: true,
      lastEventAt: `${today}T01:00:00.000Z`,
      databasePath: "/tmp/drifty.sqlite3",
      trackerMode: "tracking",
    });
    let livePollStarted = false;
    trackerClient.getTimeline.mockImplementation((query: ClassificationQuery) => {
      if (timelineQueryIncludesDay(query, today)) return Promise.resolve([focusSegment]);
      livePollStarted = true;
      return Promise.resolve([chromeSegment]);
    });
    trackerClient.getCurrentSnapshot.mockImplementation(async () => (livePollStarted ? chromeSnapshot : focusSnapshot));

    const { container } = render(<App />);

    const livePill = container.querySelector(".live-pill");
    if (!(livePill instanceof HTMLElement)) {
      throw new Error("Expected live tracker sidebar pill to render.");
    }

    await waitFor(() => expect(within(livePill).getByText("Visual Studio Code")).toBeTruthy());
    trackerClient.getCurrentSnapshot.mockClear();
    trackerClient.updateTrayDriftAlarmStatus.mockClear();

    act(() => {
      setRendererFocus(false);
      window.dispatchEvent(new Event("blur"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DRIFT_ALARM_POLL_INTERVAL_MS);
    });

    await waitFor(() => expect(trackerClient.getCurrentSnapshot).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.updateTrayDriftAlarmStatus).toHaveBeenCalled());
    expect(within(livePill).getByText("Visual Studio Code")).toBeTruthy();
    expect(within(livePill).queryByText("Google Chrome")).toBeNull();
    expect(within(livePill).queryByText("docs.example.com")).toBeNull();
  });

  it("does not auto-run a 5-item focused batch while the renderer is still active", async () => {
    setRendererFocus(true);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD));
    render(<App />);

    await screen.findByRole("navigation", { name: /primary navigation/i });
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());

    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalledWith(
      { day: currentAutoClassificationDay(), limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD },
      AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD,
    );
    expect(aiClassificationMocks.runAiClassification).not.toHaveBeenCalled();
  });

  it("does not auto-run AI classification when signed out", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    markOnboardingCompleted("local");
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD));
    render(<App />);

    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());

    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();
    expect(aiClassificationMocks.runAiClassification).not.toHaveBeenCalled();
  });

  it("does not auto-run cloud AI classification when Drifty Cloud entitlement is locked", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: true,
      data: {
        plan: "individual",
        status: "locked",
        canUseApp: false,
        trialEndsAt: "2026-05-20T00:00:00.000Z",
        currentPeriodEnd: null,
        lockedReason: "trial_expired",
      },
    });
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD));

    const firstRender = render(<App />);

    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalled());

    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();
    expect(aiClassificationMocks.runAiClassification).not.toHaveBeenCalled();

    const firstCutoff = window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY);
    expect(firstCutoff).not.toBeNull();
    expect(Number.isFinite(new Date(firstCutoff ?? "").getTime())).toBe(true);

    firstRender.unmount();
    render(<App />);
    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(2));
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(firstCutoff);
  });

  it("restores a persisted backlog and waits for usable Cloud entitlement before draining it", async () => {
    const today = currentAutoClassificationDay();
    const cutoff = "2026-09-01T08:00:00.000Z";
    const entitlementRequest = createDeferred<{
      success: true;
      data: { plan: "individual"; status: "active"; canUseApp: true; trialEndsAt: null; currentPeriodEnd: null };
    }>();
    billingMocks.fetchBillingEntitlement.mockReturnValue(entitlementRequest.promise);
    window.localStorage.setItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY, cutoff);
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));

    render(<App />);

    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();

    entitlementRequest.resolve({
      success: true,
      data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null },
    });

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledWith(
      expect.objectContaining({
        start: cutoff,
        end: expect.any(String),
        limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      }),
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      expect.objectContaining({ allowProviderlessPersistence: true, persistenceAllowed: expect.any(Function) }),
    ));
    const recoveryQuery = aiClassificationMocks.runAiClassificationUntilEmpty.mock.calls[0]?.[0];
    expect(recoveryQuery).not.toHaveProperty("day");
    expect(new Date(recoveryQuery?.end ?? 0).getTime()).toBeGreaterThan(new Date(cutoff).getTime());
  });

  it("probes the recorded Cloud outage backlog without waiting for new activity today", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-28T10:00:00+09:00"));
    setRendererFocus(false);
    aiClassificationMocks.runAiClassificationForUnknownThreshold
      .mockRejectedValueOnce(new Error("OpenRouter classification response could not be parsed"));
    const recoveryProbe = createDeferred<AiClassificationSummary>();
    aiClassificationMocks.runAiClassification.mockReturnValue(recoveryProbe.promise);

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold.mock.calls.length).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });
    await waitFor(() => expect(aiClassificationMocks.runAiClassification).toHaveBeenCalled());
    const cutoff = aiClassificationMocks.runAiClassification.mock.calls[0]?.[0]?.start;
    expect(cutoff).toEqual(expect.any(String));
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);
    expect(aiClassificationMocks.runAiClassification.mock.calls[0]).toEqual([
      expect.objectContaining({ start: cutoff, end: expect.any(String), limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD }),
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      expect.objectContaining({ allowProviderlessPersistence: false }),
    ]);
    expect(aiClassificationMocks.runAiClassification.mock.calls[0]?.[0]).not.toHaveProperty("day");

    await act(async () => recoveryProbe.resolve({
      status: "saved",
      selectedSegments: 1,
      savedRecords: 1,
      message: "Recovered a prior-day classification.",
      usedAiProvider: true,
      metrics: selectedDayMetrics,
    } satisfies AiClassificationSummary));
    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalled());
    const resumedQuery = aiClassificationMocks.runAiClassificationUntilEmpty.mock.calls[0]?.[0];
    expect(resumedQuery).toEqual(expect.objectContaining({ start: expect.any(String), end: expect.any(String) }));
    expect(new Date(resumedQuery?.start ?? 0).getTime()).toBeLessThanOrEqual(new Date(cutoff ?? 0).getTime());
  });

  it("unblocks automatic recovery when an outage probe has no AI candidates", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-28T10:00:00+09:00"));
    setRendererFocus(false);
    aiClassificationMocks.runAiClassificationForUnknownThreshold
      .mockRejectedValueOnce(new Error("OpenRouter classification response could not be parsed"));
    aiClassificationMocks.runAiClassification.mockResolvedValue({
      status: "empty",
      selectedSegments: 0,
      savedRecords: 0,
      message: "No provider candidates in the first recorded backlog batch.",
      metrics: selectedDayMetrics,
    } satisfies AiClassificationSummary);

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold.mock.calls.length).toBeGreaterThanOrEqual(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });
    await waitFor(() => expect(cloudAiConnectionMock).toHaveBeenCalled());
    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalled());
    expect(aiClassificationMocks.runAiClassificationUntilEmpty.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ start: expect.any(String), end: expect.any(String) }),
    );
  });

  it("keeps a failed Cloud recovery test bounded and preserves the backlog", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-28T10:00:00+09:00"));
    setRendererFocus(false);
    aiClassificationMocks.runAiClassificationForUnknownThreshold
      .mockRejectedValueOnce(new Error("OpenRouter classification response could not be parsed"));
    aiClassificationMocks.runAiClassification.mockResolvedValue({
      status: "empty",
      selectedSegments: 0,
      savedRecords: 0,
      message: "No AI candidates in the recorded backlog batch.",
      metrics: selectedDayMetrics,
    } satisfies AiClassificationSummary);
    cloudAiConnectionMock.mockResolvedValue({ kind: "error", issueKind: "provider", message: "Cloud unavailable." });

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });
    await waitFor(() => expect(cloudAiConnectionMock).toHaveBeenCalledTimes(1));
    const cutoff = window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY);
    expect(cutoff).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    expect(cloudAiConnectionMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);
  });

  it("backs off failed paid backlog probes and retries automatically afterward", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-28T10:00:00+09:00"));
    setRendererFocus(false);
    aiClassificationMocks.runAiClassificationForUnknownThreshold
      .mockRejectedValueOnce(new Error("OpenRouter classification response could not be parsed"))
      .mockResolvedValue({
        status: "empty",
        selectedSegments: 0,
        savedRecords: 0,
        message: "No new activity today.",
        metrics: selectedDayMetrics,
      } satisfies AiClassificationSummary);
    aiClassificationMocks.runAiClassification
      .mockRejectedValueOnce(new Error("OpenRouter classification response could not be parsed"))
      .mockRejectedValueOnce(new Error("OpenRouter classification response could not be parsed again"))
      .mockResolvedValue({
        status: "saved",
        selectedSegments: 1,
        savedRecords: 1,
        message: "Recovered a prior-day classification.",
        usedAiProvider: true,
        metrics: selectedDayMetrics,
      } satisfies AiClassificationSummary);

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalled());
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS); });
    await waitFor(() => expect(aiClassificationMocks.runAiClassification).toHaveBeenCalledTimes(1));
    const cutoff = window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY);
    expect(cutoff).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(8 * 60 * 1000); });
    expect(aiClassificationMocks.runAiClassification).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS); });
    await waitFor(() => expect(aiClassificationMocks.runAiClassification).toHaveBeenCalledTimes(2));
    await act(async () => { await vi.advanceTimersByTimeAsync(18 * 60 * 1000); });
    expect(aiClassificationMocks.runAiClassification).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS); });
    await waitFor(() => expect(aiClassificationMocks.runAiClassification).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalled());
  });

  it("keeps retrying a safety-capped recovery range until no unclassified rows remain", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-05T10:00:00+09:00"));
    const cutoff = "2026-09-01T08:00:00.000Z";
    const firstCompletionProbe = createDeferred<ActivitySegment[]>();
    window.localStorage.setItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY, cutoff);
    setRendererFocus(false);
    aiClassificationMocks.runAiClassificationUntilEmpty
      .mockResolvedValueOnce({
        status: "saved",
        selectedSegments: 2_000,
        savedRecords: 2_000,
        message: "Run again to continue.",
        metrics: { ...selectedDayMetrics, classifiedSegments: 2_000, unclassifiedSegments: 7 },
      } satisfies AiClassificationSummary)
      .mockResolvedValueOnce({
        status: "saved",
        selectedSegments: 7,
        savedRecords: 7,
        message: "Classified all available activity.",
        metrics: { ...selectedDayMetrics, classifiedSegments: 2_007, unclassifiedSegments: 0 },
      } satisfies AiClassificationSummary);
    trackerClient.getUnclassifiedSegments
      .mockReturnValueOnce(firstCompletionProbe.promise)
      .mockResolvedValueOnce([]);

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trackerClient.getUnclassifiedSegments).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);

    await act(async () => {
      firstCompletionProbe.resolve(createUnclassifiedSegments(1, "2026-09-01"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBeNull());
    for (const [query] of aiClassificationMocks.runAiClassificationUntilEmpty.mock.calls) {
      expect(query).toEqual(expect.objectContaining({
        start: cutoff,
        end: expect.any(String),
        limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      }));
    }
  });

  it("retries recovery when the canonical completion probe fails transiently", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-05T10:00:00+09:00"));
    const cutoff = "2026-09-01T08:00:00.000Z";
    const firstCompletionProbe = createDeferred<ActivitySegment[]>();
    window.localStorage.setItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY, cutoff);
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments
      .mockReturnValueOnce(firstCompletionProbe.promise)
      .mockResolvedValueOnce([]);

    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trackerClient.getUnclassifiedSegments).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);

    await act(async () => {
      firstCompletionProbe.reject(new Error("tracker database busy"));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBeNull());
  });

  it("does not resurrect a recovery timer after the owning effect is disposed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-05T10:00:00+09:00"));
    const cutoff = "2026-09-01T08:00:00.000Z";
    const completionProbe = createDeferred<ActivitySegment[]>();
    window.localStorage.setItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY, cutoff);
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockReturnValue(completionProbe.promise);

    const view = render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(trackerClient.getUnclassifiedSegments).toHaveBeenCalledTimes(1));
    view.unmount();
    completionProbe.resolve([]);
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(AUTO_AI_CLASSIFICATION_INTERVAL_MS);
    });

    expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);
  });

  it("resumes an incomplete recovery immediately after restart", async () => {
    const cutoff = "2026-09-01T08:00:00.000Z";
    const firstRecoveryPass = createDeferred<AiClassificationSummary>();
    window.localStorage.setItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY, cutoff);
    setRendererFocus(false);
    aiClassificationMocks.runAiClassificationUntilEmpty
      .mockReturnValueOnce(firstRecoveryPass.promise)
      .mockResolvedValueOnce({
        status: "saved",
        selectedSegments: 1,
        savedRecords: 1,
        message: "Classified all available local activity.",
        // Aggregate metrics can retain an unclassified row synced from
        // another device; the local candidate probe still completes recovery.
        metrics: { ...selectedDayMetrics, classifiedSegments: 2_001, unclassifiedSegments: 1 },
      } satisfies AiClassificationSummary);
    trackerClient.getUnclassifiedSegments.mockResolvedValue([]);

    const firstRender = render(<App />);
    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBe(cutoff);

    firstRender.unmount();
    firstRecoveryPass.resolve({
      status: "saved",
      selectedSegments: 2_000,
      savedRecords: 2_000,
      message: "Run again to continue.",
      metrics: { ...selectedDayMetrics, classifiedSegments: 2_000, unclassifiedSegments: 1 },
    });
    await act(async () => {
      await Promise.resolve();
    });
    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationUntilEmpty).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(window.localStorage.getItem(BUILT_IN_HEURISTICS_UNAVAILABLE_SINCE_STORAGE_KEY)).toBeNull());
  });

  it("does not auto-run cloud AI classification when billing entitlement cannot be loaded", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: false, error: "Unable to check billing status." });
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD));

    render(<App />);

    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalled());
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());

    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();
    expect(aiClassificationMocks.runAiClassification).not.toHaveBeenCalled();
  });

  it("auto-runs signed-out AI classification when self-hosted AI is configured locally", async () => {
    const today = currentAutoClassificationDay();
    authState.user = null;
    authState.status = "unauthenticated";
    markOnboardingCompleted("local");
    setRendererFocus(false);
    window.localStorage.setItem("drifty.aiSetup.v1", JSON.stringify({ provider: "self_hosted", selfHostedBaseUrl: "http://localhost:11434/v1", selfHostedModel: "llama3.1:8b" }));
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));
    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      expect.objectContaining({ localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.1:8b" }, allowProviderlessPersistence: false, persistenceAllowed: expect.any(Function) }),
    ));
  });

  it("passes OpenRouter fallback models through local AI classification options after dropping Auto", async () => {
    const today = currentAutoClassificationDay();
    setRendererFocus(false);
    window.localStorage.setItem("drifty.aiSetup.v1", JSON.stringify({
      provider: "openrouter_byok",
      openRouterModel: "openai/gpt-4o-mini",
      openRouterFallbackModels: [" openrouter/auto ", "openai/gpt-4o-mini", "qwen/qwen3.6-flash", "deepseek/deepseek-v4-flash:free"],
    }));
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));
    render(<App />);

    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());
    aiClassificationMocks.runAiClassificationForUnknownThreshold.mockClear();

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^AI setup$/ }));
    // OpenRouter is expanded by default because it is the saved provider.
    fireEvent.change(await screen.findByLabelText(/OpenRouter API key/i), { target: { value: "sk-or-v1-test" } });

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      expect.objectContaining({
        allowProviderlessPersistence: false,
        persistenceAllowed: expect.any(Function),
        localProvider: {
          provider: "openrouter_byok",
          apiKey: "sk-or-v1-test",
          model: "openai/gpt-4o-mini",
          fallbackModels: ["qwen/qwen3.6-flash", "deepseek/deepseek-v4-flash:free"],
        },
      }),
    ));
  });

  it("auto-runs one 5-item batch after 20 focused idle minutes", async () => {
    let recordedInteraction = false;
    const dateNow = vi.spyOn(Date, "now").mockImplementation(() => {
      if (new Error().stack?.includes("recordRendererInteraction")) {
        recordedInteraction = true;
        return 0;
      }
      return recordedInteraction ? AI_CLASSIFICATION_FOCUSED_IDLE_MS + 1 : 0;
    });
    const today = currentAutoClassificationDay();
    disableAiAvailabilityGateForSchedulerTest();
    setRendererFocus(true);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, today));

    try {
      render(<App />);

      await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
        { day: today, limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD },
        AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD,
        expect.objectContaining({ allowProviderlessPersistence: true, persistenceAllowed: expect.any(Function) }),
      ));
    } finally {
      dateNow.mockRestore();
    }
  });


});
