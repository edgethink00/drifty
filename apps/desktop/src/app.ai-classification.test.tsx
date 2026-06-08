// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ActivitySegment, ClassificationMetrics, ClassificationQuery } from "@drifty/domain";
import { shiftIsoDate, todayIsoDate } from "@drifty/domain";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";
import type { AiClassificationSummary, AiClassificationUsageSummary } from "./features/classification/aiClassificationService";

const styles = readFileSync("src/styles.css", "utf8");
const AI_CLASSIFICATION_BACKGROUND_THRESHOLD = 20;
const AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD = 5;
const AI_CLASSIFICATION_FOCUSED_IDLE_MS = 20 * 60 * 1000;

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

const { authState, aiClassificationMocks, billingMocks, trackerClient } = vi.hoisted(() => ({
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
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    clearCallbackStatus: vi.fn(),
    signOut: vi.fn(),
  },
  aiClassificationMocks: {
    getAiClassificationUsageSummary: vi.fn(),
    runAiClassification: vi.fn(),
    runAiClassificationForUnknownThreshold: vi.fn(),
    runAiClassificationUntilEmpty: vi.fn(),
  },
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
  },
  trackerClient: {
    getStatus: vi.fn(),
    getTimeline: vi.fn(),
    getCurrentSnapshot: vi.fn(),
    getHourlySummary: vi.fn(),
    getTopSites: vi.fn(),
    getAppIcons: vi.fn(),
    getUnclassifiedSegments: vi.fn(),
    getClassificationMetrics: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn(),
  },
}));

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock("./lib/api/trackerClient", () => ({ trackerClient }));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
}));

vi.mock("./features/classification/aiClassificationService", () => {
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
    AI_CLASSIFICATION_BACKGROUND_THRESHOLD: 20,
    AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD: 5,
    AI_CLASSIFICATION_FOCUSED_IDLE_MS: 20 * 60 * 1000,
    diffAiClassificationUsageSummary,
    projectAiClassificationCost,
    toClassificationQueryForDay: (day: string, limit?: number) => (limit ? { day, limit } : { day }),
    getAiClassificationUsageSummary: aiClassificationMocks.getAiClassificationUsageSummary,
    runAiClassification: aiClassificationMocks.runAiClassification,
    runAiClassificationForUnknownThreshold: aiClassificationMocks.runAiClassificationForUnknownThreshold,
    runAiClassificationUntilEmpty: aiClassificationMocks.runAiClassificationUntilEmpty,
  };
});

vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard: vi.fn().mockResolvedValue({ success: true, error: null, data: [] }),
  fetchOwnLeaderboardEntry: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
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

function formatDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00`));
}

async function selectDashboardDayOffset(daysBack: number) {
  const selectedDay = shiftIsoDate(todayIsoDate(), -daysBack);

  await screen.findByRole("navigation", { name: /dashboard views/i });
  for (let index = 0; index < daysBack; index += 1) {
    fireEvent.click(screen.getByRole("button", { name: /show previous today/i }));
  }
  await waitFor(() => expect(aiClassificationMocks.getAiClassificationUsageSummary).toHaveBeenCalledWith(selectedDay));

  return selectedDay;
}

function usageCallCountForDay(day: string) {
  const calls = aiClassificationMocks.getAiClassificationUsageSummary.mock.calls as Array<[string]>;
  return calls.filter((call) => call[0] === day).length;
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
    trackerClient.getCurrentSnapshot.mockResolvedValue(null);
    trackerClient.getHourlySummary.mockResolvedValue([]);
    trackerClient.getTopSites.mockResolvedValue([]);
    trackerClient.getAppIcons.mockResolvedValue({});
    trackerClient.getUnclassifiedSegments.mockResolvedValue([]);
    trackerClient.getClassificationMetrics.mockResolvedValue(selectedDayMetrics);
    trackerClient.start.mockResolvedValue({ running: true, accessibilityGranted: true, lastEventAt: null, databasePath: "/tmp/drifty.sqlite3", trackerMode: "tracking" });
    trackerClient.stop.mockResolvedValue({ running: false, accessibilityGranted: true, lastEventAt: null, databasePath: "/tmp/drifty.sqlite3", trackerMode: "tracking" });
    trackerClient.updateTrayProductivityIcon.mockResolvedValue(undefined);
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });
    aiClassificationMocks.getAiClassificationUsageSummary.mockImplementation((day: string) => Promise.resolve(
      day === todayIsoDate()
        ? executionUsageAfterAvailable ? executionUsageAfter : executionUsageBefore
        : selectedDayUsage,
    ));
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
      return { status: "saved", selectedSegments: 30, savedRecords: 30, message: "Classified all available activity: saved 30 AI classifications across 2 batches.", metrics: selectedDayMetrics } satisfies AiClassificationSummary;
    });
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
    expect(cssRule(".content--classify")).toContain("overflow-y: hidden;");
    expect(cssRule(".content--classify .page")).toMatch(/height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".content--classify .classification-panel-view")).toMatch(/flex:\s*1 1 auto;[\s\S]*min-height:\s*0;/);
    expect(cssRule(".classification-panel-view__grid")).toMatch(/height:\s*100%;[\s\S]*min-height:\s*0;/);
    expect(styles).toMatch(/\.panel-header\s*{[\s\S]*min-height:\s*52px;[\s\S]*padding:\s*8px 10px 7px;/);
    expect(styles).toMatch(/\.classification-panel-view__category-row,\s*\.classification-panel-view__source-row\s*{[\s\S]*min-height:\s*3rem;/);
    expect(styles).toMatch(/\.classification-panel-view__category-row,\s*\.classification-panel-view__source-row\s*{[\s\S]*padding:\s*5px 8px;/);
    expect(styles).toMatch(/\.classification-panel-view__bar\s*{[\s\S]*height:\s*6px;/);
    expect(styles).toMatch(/\.classification-panel-view__category-row\[data-selected="true"\]\s*{[\s\S]*var\(--classification-selected-tone\)/);
    expect(styles).toMatch(/\.classification-panel-view__source-row\[data-selected="true"\]\s*{[\s\S]*var\(--classification-selected-tone\)/);
    expect(styles).toMatch(/\.classification-panel-view__activity-row\s*{[\s\S]*align-items:\s*center;/);
  });

  it("auto-runs one 20-item AI classification batch when the renderer is not focused", async () => {
    const today = todayIsoDate();
    setRendererFocus(false);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_BACKGROUND_THRESHOLD, today));
    render(<App />);

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
    ));
  });

  it("does not auto-run a 5-item focused batch while the renderer is still active", async () => {
    setRendererFocus(true);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD));
    render(<App />);

    await screen.findByRole("navigation", { name: /primary navigation/i });
    await waitFor(() => expect(trackerClient.getTimeline).toHaveBeenCalled());

    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalledWith(
      { day: todayIsoDate(), limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD },
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

    render(<App />);

    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalled());

    expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).not.toHaveBeenCalled();
    expect(aiClassificationMocks.runAiClassification).not.toHaveBeenCalled();
  });

  it("waits for a usable Drifty Cloud entitlement before auto-running cloud AI classification", async () => {
    const today = todayIsoDate();
    const entitlementRequest = createDeferred<{
      success: true;
      data: { plan: "individual"; status: "active"; canUseApp: true; trialEndsAt: null; currentPeriodEnd: null };
    }>();
    billingMocks.fetchBillingEntitlement.mockReturnValue(entitlementRequest.promise);
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

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
    ));
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
    const today = todayIsoDate();
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
      { localProvider: { provider: "self_hosted", baseUrl: "http://localhost:11434/v1", model: "llama3.1:8b" } },
    ));
  });

  it("passes OpenRouter fallback models through local AI classification options after dropping Auto", async () => {
    const today = todayIsoDate();
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

    fireEvent.click(await screen.findByRole("button", { name: /alex drifty cloud ai/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /settings/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^AI setup$/ }));
    fireEvent.change(screen.getByLabelText(/OpenRouter API key/i), { target: { value: "sk-or-v1-test" } });

    await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
      { day: today, limit: AI_CLASSIFICATION_BACKGROUND_THRESHOLD },
      AI_CLASSIFICATION_BACKGROUND_THRESHOLD,
      {
        localProvider: {
          provider: "openrouter_byok",
          apiKey: "sk-or-v1-test",
          model: "openai/gpt-4o-mini",
          fallbackModels: ["qwen/qwen3.6-flash", "deepseek/deepseek-v4-flash:free"],
        },
      },
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
    const today = todayIsoDate();
    setRendererFocus(true);
    trackerClient.getUnclassifiedSegments.mockResolvedValue(createUnclassifiedSegments(AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD, today));

    try {
      render(<App />);

      await waitFor(() => expect(aiClassificationMocks.runAiClassificationForUnknownThreshold).toHaveBeenCalledWith(
        { day: today, limit: AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD },
        AI_CLASSIFICATION_FOCUSED_IDLE_THRESHOLD,
      ));
    } finally {
      dateNow.mockRestore();
    }
  });


});
