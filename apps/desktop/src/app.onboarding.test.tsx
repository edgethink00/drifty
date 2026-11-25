// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TrackerStatus } from "@drifty/domain";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";
import { beginFirstDayCloudBacklog, readFirstDayCloudBacklog, releaseFirstDayCloudBacklog } from "./features/onboarding/firstDayCloudBacklog";
import { FIRST_DAY_PREPARATION_READY_HOLD_MS } from "./features/onboarding/firstDayPreparationProgress";
import { getOnboardingProgressStorageKey } from "./features/onboarding/onboardingProgress";
import {
  parsePostOnboardingSidebarGuideRecord,
  postOnboardingSidebarGuideStorageKey,
} from "./features/onboarding/postOnboardingSidebarGuide";
import { DISPLAY_LANGUAGE_STORAGE_KEY } from "./features/localization/LocalizationContext";
import type { ManagedLocalAiStatus } from "./features/settings/managedLocalAiClient";
import { DEV_MODE_STORAGE_KEY } from "./features/settings/settingsStorage";
import { fetchFriendInvite } from "./features/billing/billingService";

const FINAL_ONBOARDING_ACTION = /start tracking|continue with cloud|start 7-day free trial/i;
const AVAILABLE_CLOUD_TRIAL = {
  plan: "individual" as const,
  status: "locked" as const,
  canUseApp: false,
  trialEndsAt: null,
  currentPeriodEnd: null,
  lockedReason: "billing_missing" as const,
  trialActivation: { state: "available" as const, startedAt: null, endsAt: null },
};
const GRANTED_CLOUD_TRIAL = {
  ...AVAILABLE_CLOUD_TRIAL,
  status: "trialing" as const,
  canUseApp: true,
  trialEndsAt: "2026-09-21T00:00:00.000Z",
  trialActivation: {
    state: "started" as const,
    startedAt: "2026-09-14T00:00:00.000Z",
    endsAt: "2026-09-21T00:00:00.000Z",
  },
};

const {
  authState,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  fetchOwnLeaderboardCheckpoint,
  publishOwnLeaderboardCheckpoint,
  publishOwnFocusTotal,
  optOutLeaderboard,
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  isPermissionGranted,
  requestPermission,
  accessibilityGetStatus,
  accessibilityRequestAccess,
  accessibilityDetectHostPlatform,
  trackerGetStatus,
  trackerStart,
  trackerGetHourlySummary,
  trackerGetClassificationMetrics,
  trackerPreviewBrowserHistoryImport,
  trackerImportBrowserHistory,
  trackerGetBrowserHistoryEnvironment,
  openSystemSettingsPane,
  openFullDiskAccessSettingsPane,
  capturePostHogEvent,
  browserHistoryBootstrapReset,
  billingMocks,
  appFeatureSwitches,
  startupSettingsClient,
  tauriEventHandlers,
  invokeMock,
  sendNotificationMock,
  githubStarMocks,
} = vi.hoisted(() => ({
  authState: {
    user: { id: "user-1", email: "alex@example.com" } as { id: string; email: string | null } | null,
    session: null,
    status: "authenticated" as "loading" | "authenticated" | "unauthenticated",
    callbackStatus: null,
    isEnabled: true,
    authMode: "optional" as "optional" | "required",
    isAuthRequired: false,
    allowsAnonymousAuth: true,
    hasRequiredAccountAuth: true,
    hasBlockingAuthConfigurationError: false,
    cloudConnectionStatus: undefined as "disabled" | "checking" | "online" | "offline" | undefined,
    isSavedSignInPending: false,
    signInAnonymously: vi.fn(),
    signInWithWebsite: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    clearCallbackStatus: vi.fn(),
    signOut: vi.fn(),
  },
  fetchGlobalLeaderboard: vi.fn(),
  fetchOwnLeaderboardEntry: vi.fn(),
  fetchOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  publishOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: true }),
  publishOwnFocusTotal: vi.fn(),
  optOutLeaderboard: vi.fn(),
  fetchOwnProfile: vi.fn(),
  saveOwnProfile: vi.fn(),
  fetchPublicProfile: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  accessibilityGetStatus: vi.fn(),
  accessibilityRequestAccess: vi.fn(),
  accessibilityDetectHostPlatform: vi.fn(),
  trackerGetStatus: vi.fn(),
  trackerStart: vi.fn(),
  trackerGetHourlySummary: vi.fn(),
  trackerGetClassificationMetrics: vi.fn(),
  trackerPreviewBrowserHistoryImport: vi.fn(),
  trackerImportBrowserHistory: vi.fn(),
  trackerGetBrowserHistoryEnvironment: vi.fn(),
  openSystemSettingsPane: vi.fn(),
  openFullDiskAccessSettingsPane: vi.fn(),
  capturePostHogEvent: vi.fn(),
  browserHistoryBootstrapReset: vi.fn(),
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    startCloudTrial: vi.fn(),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
    createBillingPortalSession: vi.fn().mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } }),
  },
  appFeatureSwitches: {
    devOnboardingBypassEnabled: false,
    devOnboardingAuthBypassEnabled: false,
    devOnboardingAuthSkipEnabled: false,
    devOnboardingForceOpenEnabled: false,
    replayOnboardingDevToolEnabled: true,
  },
  startupSettingsClient: {
    isAvailable: vi.fn(),
    setOpenAtLoginEnabled: vi.fn(),
  },
  tauriEventHandlers: new Map<string, MockTauriEventHandler[]>(),
  invokeMock: vi.fn(),
  sendNotificationMock: vi.fn(),
  githubStarMocks: {
    loadAccount: vi.fn<() => Promise<string | null>>(async () => null),
    star: vi.fn<(account: string) => Promise<void>>(async () => undefined),
    markDone: vi.fn(),
  },
}));

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
  useAuthConnectionStatus: () => ({ cloudConnectionStatus: "online" }),
}));

// The entry screen's product picture is covered by OnboardingEntryStep.test; these app flows
// only need the sign-in half, without the picture's animation clock running under jsdom.
vi.mock("./features/onboarding/components/EntryDayDemo", () => ({
  EntryDayDemo: () => null,
}));

vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  fetchOwnLeaderboardCheckpoint,
  publishOwnLeaderboardCheckpoint,
  publishOwnFocusTotal,
  optOutLeaderboard,
}));

vi.mock("./features/profile/profileService", () => ({
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  fallbackDisplayName: (email?: string | null) => email?.split("@")[0]?.trim() || "drifty",
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted,
  requestPermission,
  sendNotification: sendNotificationMock,
}));

vi.mock("./lib/api/systemSettingsClient", () => ({
  openSystemSettingsPane,
  openFullDiskAccessSettingsPane,
}));

vi.mock("./lib/api/startupSettingsClient", () => ({
  startupSettingsClient,
}));

vi.mock("./lib/analytics/posthogClient", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/analytics/posthogClient")>(),
  capturePostHogEvent,
}));

vi.mock("./features/dashboard/useBrowserHistoryBootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./features/dashboard/useBrowserHistoryBootstrap")>();

  return {
    ...actual,
    useBrowserHistoryBootstrap: (...args: Parameters<typeof actual.useBrowserHistoryBootstrap>) => {
      const result = actual.useBrowserHistoryBootstrap(...args);
      return {
        ...result,
        reset: () => {
          browserHistoryBootstrapReset();
          result.reset();
        },
      };
    },
  };
});

// The onboarding star needs the Mac app's gh; these flows stand in for it.
vi.mock("./features/github-star/githubStar", async (importOriginal) => ({
  ...await importOriginal<typeof import("./features/github-star/githubStar")>(),
  loadOnboardingGitHubStarAccount: githubStarMocks.loadAccount,
  starDriftyFromOnboarding: githubStarMocks.star,
  markGitHubStarDone: githubStarMocks.markDone,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: () => false,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, handler: MockTauriEventHandler) => {
    const handlers = tauriEventHandlers.get(eventName) ?? [];
    handlers.push(handler);
    tauriEventHandlers.set(eventName, handlers);
    return Promise.resolve(() => {
      const currentHandlers = tauriEventHandlers.get(eventName) ?? [];
      tauriEventHandlers.set(eventName, currentHandlers.filter((item) => item !== handler));
    });
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn().mockResolvedValue(null),
}));

vi.mock("./lib/api/accessibilityClient", () => ({
  accessibilityClient: {
    getStatus: accessibilityGetStatus,
    requestAccess: accessibilityRequestAccess,
    detectHostPlatform: accessibilityDetectHostPlatform,
  },
}));

vi.mock("./lib/api/trackerClient", () => ({
  trackerClient: {
    getStatus: trackerGetStatus,
    getTimeline: vi.fn().mockResolvedValue([]),
    getDashboardWeekTimeline: vi.fn().mockResolvedValue([]),
    getLiveTail: vi.fn().mockResolvedValue({
      running: false,
      trackerMode: "tracking",
      lastEventAt: null,
      segments: [],
    }),
    getCurrentSnapshot: vi.fn().mockResolvedValue(null),
    getHourlySummary: trackerGetHourlySummary,
    getClassificationMetrics: trackerGetClassificationMetrics,
    getUnclassifiedSegments: vi.fn().mockResolvedValue([]),
    getTopSites: vi.fn().mockResolvedValue([]),
    getAppIcons: vi.fn().mockResolvedValue({}),
    start: trackerStart,
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn().mockResolvedValue(undefined),
    previewBrowserHistoryImport: trackerPreviewBrowserHistoryImport,
    importBrowserHistory: trackerImportBrowserHistory,
    getBrowserHistoryEnvironment: trackerGetBrowserHistoryEnvironment,
  },
}));

vi.mock("./features/billing/billingService", () => ({
  fetchFriendInvite: vi.fn().mockResolvedValue({ kind: "disabled" }),
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  startCloudTrial: billingMocks.startCloudTrial,
  fetchIndividualPricingQuote: vi.fn().mockResolvedValue({ success: false, error: "Pricing unavailable in this test." }),
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  createBillingPortalSession: billingMocks.createBillingPortalSession,
}));

vi.mock("./appFeatureSwitches", () => ({
  AI_AVAILABILITY_CLASSIFICATION_GATE_ENABLED: true,
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: true,
  DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED: false,
  DEV_ONBOARDING_BYPASS_ENABLED: false,
  get DEV_ONBOARDING_AUTH_BYPASS_ENABLED() {
    return appFeatureSwitches.devOnboardingAuthBypassEnabled;
  },
  get DEV_ONBOARDING_AUTH_SKIP_ENABLED() {
    return appFeatureSwitches.devOnboardingAuthSkipEnabled;
  },
  DEV_SETTINGS_ENABLED: true,
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: true,
  END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: true,
  END_OF_DAY_REVIEW_NOTIFICATIONS_ENABLED: false,
  get REPLAY_ONBOARDING_DEV_TOOL_ENABLED() {
    return appFeatureSwitches.replayOnboardingDevToolEnabled;
  },
  isDevOnboardingBypassEnabled: () => appFeatureSwitches.devOnboardingBypassEnabled,
  isDevOnboardingForceOpenEnabled: () => appFeatureSwitches.devOnboardingForceOpenEnabled,
}));

import App from "./App";

type MockTauriEventHandler = (event: { readonly payload: unknown }) => void;

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function setTauriRuntime() {
  Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
}

function emitTauriEvent(eventName: string, payload: unknown) {
  for (const handler of tauriEventHandlers.get(eventName) ?? []) {
    handler({ payload });
  }
}

function makeTrackerStatus(overrides: Partial<TrackerStatus> = {}): TrackerStatus {
  return {
    running: true,
    accessibilityGranted: true,
    lastEventAt: null,
    databasePath: null,
    trackerMode: "tracking",
    message: "Tracker running.",
    idleSeconds: null,
    idleDetectionAvailable: null,
    ...overrides,
  };
}

const managedCatalog = [
  { id: "drifty-qwen3-5-2b-economy", tier: "economy", label: "Qwen 3.5 2B", detail: "Small local model.", downloadSize: "~1.4 GB", diskRequired: "3 GB free", minimumMemory: "8 GB RAM", estimatedRuntimeMemoryBytes: 2_147_483_648, recommended: false },
  { id: "drifty-qwen3-5-4b-default", tier: "default", label: "Qwen 3.5 4B", detail: "Recommended local model.", downloadSize: "~2.8 GB", diskRequired: "6 GB free", minimumMemory: "16 GB RAM", estimatedRuntimeMemoryBytes: 3_758_096_384, recommended: true },
] as const;

function installManagedModel(modelId: string): ManagedLocalAiStatus {
  return {
    state: "installed",
    selectedModelId: modelId,
    installedModels: [{ id: modelId, artifactDir: `/Users/test/Library/Application Support/Drifty/managed-ai/models/${modelId}` }],
    baseUrl: "http://127.0.0.1:39217/v1",
    model: "drifty-qwen3.5-4b-local",
    message: "Managed local model downloaded.",
    artifactDir: `/Users/test/Library/Application Support/Drifty/managed-ai/models/${modelId}`,
    progress: null,
    errorKind: null,
    memoryUsageBytes: null,
  };
}

function runningManagedModel(modelId: string): ManagedLocalAiStatus {
  const installedStatus = installManagedModel(modelId);
  return {
    ...installedStatus,
    state: "running",
    message: "Managed local AI runtime is running.",
    memoryUsageBytes: 270_532_608,
  };
}

function configureManagedAiMocks() {
  let managedStatus: ManagedLocalAiStatus = {
    state: "not_installed",
    selectedModelId: null,
    installedModels: [],
    baseUrl: null,
    model: null,
    message: "Choose a local model and Drifty will download it inside the app.",
    artifactDir: null,
    progress: null,
    errorKind: null,
    memoryUsageBytes: null,
  };
  invokeMock.mockImplementation((command: string, args?: unknown) => {
    switch (command) {
      case "managed_ai_catalog":
        return Promise.resolve(managedCatalog);
      case "managed_ai_status":
        return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          managedStatus = installManagedModel(modelId);
          return Promise.resolve(managedStatus);
        }
        case "ai_classification_openai_chat":
          return Promise.resolve({ status: 200, body: "{\"choices\":[{\"message\":{\"content\":\"{\\\"ok\\\":true}\"}}]}", latencyMs: 42 });
        default:
          return Promise.resolve({});
      }
    });
  }

function modelIdFromArgs(args: unknown): string {
  if (!args || typeof args !== "object" || !("modelId" in args) || typeof args.modelId !== "string") return "";
  return args.modelId;
}

async function clickEnabledAction(name: RegExp = /^continue$/i) {
  const button = (await screen.findByRole("button", { name })) as HTMLButtonElement;
  await waitFor(() => {
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
  });
  fireEvent.click(button);
}

async function clickEnabledNext() {
  await clickEnabledAction(/^continue$/i);
}

async function settleAppStartupEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function selectMainActivity(option: string) {
  fireEvent.click(screen.getByRole("button", { name: option }));
}

/** An account that is already connected when onboarding opens is acknowledged on the entry screen, then Continue. */
async function continuePastConnectedEntry() {
  await screen.findByRole("dialog", { name: /connect your account/i }, { timeout: 6_000 });
  expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
  await clickEnabledNext();
  await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 });
}

async function advanceThroughSharedBasics(options: { activity?: string; workDescription?: string } = {}) {
  await continuePastConnectedEntry();
  if (options.activity) selectMainActivity(options.activity);
  else if (!options.workDescription) selectMainActivity("Coding");
  if (options.workDescription) {
    fireEvent.change(screen.getByLabelText(/tell us more about your work/i), {
      target: { value: options.workDescription },
    });
  }
  await clickEnabledAction(/^continue$/i);
  await screen.findByRole("dialog", { name: /choose your setup/i }, { timeout: 6_000 });
}

async function chooseSimpleSetup(options: { activity?: string; workDescription?: string } = {}) {
  await advanceThroughSharedBasics(options);
  fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
  await clickEnabledAction(/^continue$/i);
  await screen.findByRole("dialog", { name: /set up permissions/i }, { timeout: 6_000 });
  await clickEnabledNext();
  await screen.findByRole("dialog", { name: /you're ready to go/i }, { timeout: 6_000 });
}

async function chooseLocalAiSetup(options: { activity?: string } = {}) {
  await advanceThroughSharedBasics(options);
  fireEvent.click(screen.getByRole("button", { name: /local ai/i }));
  await clickEnabledAction(/^continue$/i);
}

function expandAdvancedProviders() {
  const disclosure = screen.queryByRole("button", { name: /connect your own ai provider/i });
  if (disclosure && disclosure.getAttribute("aria-expanded") !== "true") {
    fireEvent.click(disclosure);
  }
}

async function chooseByokSetup(options: { activity?: string } = {}) {
  await advanceThroughSharedBasics(options);
  expandAdvancedProviders();
  fireEvent.click(screen.getByRole("button", { name: /bring your own key/i }));
  await clickEnabledAction(/^continue$/i);
}

async function chooseCustomEndpointSetup(options: { activity?: string } = {}) {
  await advanceThroughSharedBasics(options);
  expandAdvancedProviders();
  fireEvent.click(screen.getByRole("button", { name: /custom endpoint/i }));
  await clickEnabledAction(/^continue$/i);
}

async function advanceToPermissionsStep() {
  await advanceThroughSharedBasics();
  fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
  await clickEnabledAction(/^continue$/i);
  await screen.findByRole("dialog", { name: /set up permissions/i }, { timeout: 6_000 });
}

async function advanceToReadyStep(options: { activity?: string; workDescription?: string } = {}) {
  await chooseSimpleSetup(options);
}

describe("App onboarding", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: "user-1", email: "alex@example.com" };
    authState.session = null;
    authState.status = "authenticated";
    authState.isEnabled = true;
    authState.authMode = "optional";
    authState.isAuthRequired = false;
    authState.allowsAnonymousAuth = true;
    authState.hasRequiredAccountAuth = true;
    authState.hasBlockingAuthConfigurationError = false;
    authState.cloudConnectionStatus = undefined;
    authState.isSavedSignInPending = false;
    authState.signInWithWebsite.mockResolvedValue({ error: null });
    authState.signInWithGoogle.mockResolvedValue({ error: null });
    authState.signInWithEmail.mockResolvedValue({ error: null });
    authState.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: true,
      data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null },
    });
    billingMocks.startCloudTrial.mockResolvedValue({
      success: true,
      data: { plan: "individual", status: "trialing", canUseApp: true, trialEndsAt: "2026-09-21T00:00:00.000Z", currentPeriodEnd: null,
        trialActivation: { state: "started", startedAt: "2026-09-14T00:00:00.000Z", endsAt: "2026-09-21T00:00:00.000Z" } },
    });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });
    billingMocks.createBillingPortalSession.mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } });
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    window.localStorage.clear();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      running: false,
      accessibilityGranted: true,
      trackerMode: "unavailable",
      message: "Tracker not available in this environment",
    }));
    trackerStart.mockResolvedValue(makeTrackerStatus({
      running: true,
      accessibilityGranted: true,
      trackerMode: "tracking",
      message: null,
    }));
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    accessibilityGetStatus.mockResolvedValue({ granted: true, required: true });
    accessibilityRequestAccess.mockResolvedValue({ granted: true, required: true });
    accessibilityDetectHostPlatform.mockReturnValue("macos");
    startupSettingsClient.isAvailable.mockReturnValue(false);
    startupSettingsClient.setOpenAtLoginEnabled.mockResolvedValue({
      success: true,
      enabled: true,
      status: "enabled",
      backend: "smAppService",
    });
    configureManagedAiMocks();
    trackerGetHourlySummary.mockResolvedValue([]);
    trackerGetClassificationMetrics.mockReset().mockRejectedValue(new Error("classification metrics unavailable"));
    trackerPreviewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 3,
      candidateCount: 0,
      segmentCount: 0,
      estimatedSeconds: 0,
      browserCount: 0,
      profileCount: 0,
      databaseCount: 0,
      errorCount: 0,
      windowStart: "2026-07-01T13:15:00.000Z",
      windowEnd: "2026-07-03T13:15:00.000Z",
    });
    trackerGetBrowserHistoryEnvironment.mockResolvedValue({
      safariHistoryReadable: false,
      defaultBrowserIsSafari: false,
    });
    trackerImportBrowserHistory.mockResolvedValue({
      lookbackDays: 3,
      candidateCount: 0,
      segmentCount: 0,
      estimatedSeconds: 0,
      browserCount: 0,
      profileCount: 0,
      databaseCount: 0,
      errorCount: 0,
      windowStart: "2026-07-01T13:15:00.000Z",
      windowEnd: "2026-07-03T13:15:00.000Z",
      insertedCount: 0,
      skippedDuplicateCount: 0,
    });
    openSystemSettingsPane.mockResolvedValue(true);
    tauriEventHandlers.clear();
    fetchOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    saveOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchPublicProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null, data: null });
    optOutLeaderboard.mockResolvedValue({ success: true, error: null });
    appFeatureSwitches.devOnboardingBypassEnabled = false;
    appFeatureSwitches.devOnboardingAuthBypassEnabled = false;
    appFeatureSwitches.devOnboardingAuthSkipEnabled = false;
    appFeatureSwitches.devOnboardingForceOpenEnabled = false;
    appFeatureSwitches.replayOnboardingDevToolEnabled = true;
  });

  it("opens onboarding on the combined entry screen for an authenticated user without local completion", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.getByText("Welcome to drifty.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    expect(document.querySelector(".onb-actions__dots")).toBeNull();
    expect(screen.queryByPlaceholderText("Alex Chen")).toBeNull();
  });

  it("distinguishes the first work screen, Back from setup, and reopening the saved work screen", async () => {
    const app = render(<App />);
    await advanceThroughSharedBasics();
    expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_step_viewed", { step: "job" });

    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_step_viewed", {
      step: "job", navigation: "back", previous_step: "choose_setup",
    }));

    app.unmount();
    capturePostHogEvent.mockClear();
    render(<App />);
    await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_step_viewed", {
      step: "job", navigation: "restored",
    }));
  });

  it("matches the entry and setup-choice design contract", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(await screen.findByText("Welcome to drifty.", undefined, { timeout: 6_000 })).toBeTruthy();
    expect(screen.getByText(/^it records the apps and sites you use as you work, and its AI splits the time into focus and drift\. No timers, no entries\.$/i)).toBeTruthy();
    expect(screen.getByRole("img", { name: "drifty" })).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();
    expect(screen.queryByText(/joining a team or sharing a report/i)).toBeNull();
    await clickEnabledNext();

    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
    // Work is the first setup step: the dots start here and there is no Back to sign-in.
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
    expect(document.querySelector(".onb-actions__dot")?.classList.contains("onb-actions__dot--active")).toBe(true);
    expect(screen.getByText(/choose 1–4 that fit best/i)).toBeTruthy();
    expect(screen.getByRole("group", { name: /choose the work that fits you/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Coding$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /writing & content/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /research & learning/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /marketing & sales/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /meetings & communication/i })).toBeTruthy();
    expect(screen.queryByText(/AI understands work and fields that aren't listed/i)).toBeNull();
    expect(screen.getByPlaceholderText(/Write it the way you would say it\. The AI will understand/i)).toBeTruthy();
    const workDescription = screen.getByLabelText(/tell us more about your work/i, { selector: "textarea" });
    expect(workDescription).toBeTruthy();
    const workContinue = screen.getByRole("button", { name: /^continue$/i });
    const workBlockedHint = /choose at least one item or describe your work to continue/i;
    expect(workContinue.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(workBlockedHint)).toBeNull();
    fireEvent.click(workContinue);
    expect(screen.getByText(workBlockedHint)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: /what kind of work do you do/i })).toBeTruthy();
    fireEvent.change(workDescription, { target: { value: "I advise education teams." } });
    expect(workContinue.getAttribute("aria-disabled")).toBeNull();
    expect((workContinue as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(workBlockedHint)).toBeNull();
    expect(screen.queryByText(/24 \/ 240/)).toBeNull();
    fireEvent.change(workDescription, { target: { value: "x".repeat(201) } });
    expect(screen.getByText(/201 \/ 240/)).toBeTruthy();
    fireEvent.change(workDescription, { target: { value: "" } });
    expect(workContinue.getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText(/write naturally\. this context helps/i)).toBeNull();
    expect(screen.queryByLabelText(/your field/i)).toBeNull();
    expect(screen.getByText(/no need to include company or client names/i)).toBeTruthy();
    selectMainActivity("Coding");
    expect(screen.getByRole("button", { name: /^Coding$/i }).querySelector("svg")).toBeNull();
    selectMainActivity("Product & Planning");
    selectMainActivity("Designing");
    selectMainActivity("Data Analysis");
    expect((screen.getByRole("button", { name: /^Writing & Content$/i }) as HTMLButtonElement).disabled).toBe(true);
    selectMainActivity("Coding");
    expect((screen.getByRole("button", { name: /^Writing & Content$/i }) as HTMLButtonElement).disabled).toBe(false);
    const onboardingDragStrip = document.querySelector(".onboarding-window-drag-strip");
    for (const selector of [
      ".onboarding-window-drag-strip",
      ".dc-onb-card",
      ".dc-onb-scroll",
      ".onb-actions__dots",
      ".onboarding-step",
      ".onb-actions",
      ".dc-onb-title",
      ".dc-onb-job",
    ]) {
      expect(document.querySelector(selector)).toBeTruthy();
    }
    expect(onboardingDragStrip?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(document.querySelector(".onboarding-topbar")).toBeNull();
    expect(document.querySelector(".onboarding-flow-mark")).toBeNull();

    selectMainActivity("Writing & Content");
    expect(screen.queryByText("Likely Focus")).toBeNull();
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /choose your setup/i })).toBeTruthy();
    const continueButton = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    expect(screen.getByRole("button", { name: /drifty cloud/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /local ai/i })).toBeTruthy();
    expect(screen.queryByText(/data goes to/i)).toBeNull();
    // Advanced providers (BYOK / custom endpoint) live behind a disclosure.
    expect(screen.queryByRole("button", { name: /bring your own key/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /connect your own ai provider/i }));
    expect(screen.getByRole("button", { name: /bring your own key/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /custom endpoint/i })).toBeTruthy();
    expect(screen.getByText(/point drifty at any openai-compatible endpoint/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /use simple setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set up my own server/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();
    expect(screen.queryByText("Screen Recording")).toBeNull();
    expect(screen.queryByText("Browser Activity")).toBeNull();
    await clickEnabledNext();
    // Permissions leads straight to Ready; the drift decision waits for the intro after the first day is shown.
    expect(await screen.findByRole("dialog", { name: /you're ready to go/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /automatic close/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show desktop cat" })).toBeNull();
  }, 15_000);

  it("opens sign-in on the entry screen for a local unauthenticated user without local completion state", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue with email/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /drifty cloud/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /local ai/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /sign in on drifty\.so/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /byok \(bring your own key\)/i })).toBeNull();
  });

  it("does not start tracking in the background while onboarding is open", async () => {
    // Regression: on a build without required auth, the background auto-start
    // recovered the stopped tracker and began recording on the welcome screen,
    // before onboarding explained capture or the user granted Accessibility.
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;
    // A genuinely new install has not granted Accessibility yet, so the
    // onboarding early start must not fire either.
    accessibilityGetStatus.mockResolvedValue({ granted: false, required: true });
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      running: false,
      accessibilityGranted: false,
      trackerMode: "tracking",
      message: null,
    }));
    trackerStart.mockClear();

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(trackerStart).not.toHaveBeenCalled();
  });

  it("skips only the account step for dev onboarding auth bypass", async () => {
    appFeatureSwitches.devOnboardingAuthBypassEnabled = true;
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();

    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it("offers a dev-only account skip without starting authentication", async () => {
    appFeatureSwitches.devOnboardingAuthSkipEnabled = true;
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /continue without signing in/i }));

    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(authState.signInWithEmail).not.toHaveBeenCalled();
    expect(authState.signUpWithEmail).not.toHaveBeenCalled();
  });

  it("bypasses onboarding for an authenticated dev startup without storing completion", async () => {
    appFeatureSwitches.devOnboardingBypassEnabled = true;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledTimes(1));
    await settleAppStartupEffects();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
  });

  it("bypasses onboarding for a local unauthenticated dev startup without storing completion", async () => {
    appFeatureSwitches.devOnboardingBypassEnabled = true;
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    await settleAppStartupEffects();
    expect(screen.queryByRole("dialog", { name: /choose how you want to start/i })).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("local"))).toBeNull();
  });

  it("force-opens onboarding without clearing saved completion", async () => {
    appFeatureSwitches.devOnboardingForceOpenEnabled = true;
    const onboardingStorageKey = getUserOnboardingStorageKey("user-1");
    const completedOnboardingRecord = JSON.stringify({
      version: 2,
      completed: true,
      displayName: "Alex",
      workType: "Design",
      workTypeOther: "",
      workDomain: "Tech",
      workDomainOther: "",
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-05-08T00:00:00.000Z",
    });
    window.localStorage.setItem(onboardingStorageKey, completedOnboardingRecord);

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
    expect(window.localStorage.getItem(onboardingStorageKey)).toBe(completedOnboardingRecord);
  });

  it("opens sign-in on the entry screen in required auth mode without a signed-in user", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /drifty cloud/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /local ai/i })).toBeNull();
  });

  it("opens in-app email sign-in and account creation in place on the entry screen", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));

    const authDialog = (await screen.findByRole("heading", { name: /sign in to drifty/i, level: 2 })).closest("section") as HTMLElement;
    expect(screen.queryByRole("dialog", { name: /sign in to drifty/i })).toBeNull();
    expect(within(authDialog).getByLabelText(/^email$/i)).toBeTruthy();
    expect(within(authDialog).getByLabelText(/^password$/i)).toBeTruthy();
    expect(within(authDialog).getByRole("button", { name: /^sign in$/i })).toBeTruthy();
    expect(within(authDialog).queryByRole("button", { name: /continue with google/i })).toBeNull();
    expect(within(authDialog).queryByText(/^or$/i)).toBeNull();
    fireEvent.click(within(authDialog).getByRole("button", { name: /^create account$/i }));
    expect(await within(authDialog).findByRole("heading", { name: /create your account/i })).toBeTruthy();
    expect(within(authDialog).getByRole("button", { name: /^create account$/i })).toBeTruthy();

    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(authState.signInWithEmail).not.toHaveBeenCalled();
    expect(authState.signUpWithEmail).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("keeps in-app email authentication localized with Korean onboarding", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;
    window.localStorage.setItem(DISPLAY_LANGUAGE_STORAGE_KEY, "ko");

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "계정을 연결하세요" })).toBeTruthy();
    expect(screen.getByText("drifty에 오신 것을 환영합니다.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /drifty\.so에서 로그인/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "이메일로 계속" }));

    const authDialog = (await screen.findByRole("heading", { name: "Drifty에 로그인", level: 2 })).closest("section") as HTMLElement;
    expect(within(authDialog).getByLabelText("이메일")).toBeTruthy();
    expect(within(authDialog).getByLabelText("비밀번호")).toBeTruthy();
    expect(within(authDialog).getByRole("button", { name: "로그인" })).toBeTruthy();
    fireEvent.click(within(authDialog).getByRole("button", { name: "계정 만들기" }));
    expect(await within(authDialog).findByRole("heading", { name: "계정 만들기" })).toBeTruthy();
  });

  it("returns from in-place email sign-in to the provider choice in required auth mode", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));

    expect(await screen.findByRole("heading", { name: /sign in to drifty/i, level: 2 })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /other sign-in options/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
    });
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /continue with google/i })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it("starts direct Google OAuth from the onboarding Google button", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    const googleButton = await screen.findByRole("button", { name: /continue with google/i });

    expect(googleButton.querySelector(".onb-google-mark svg")).toBeTruthy();

    fireEvent.click(googleButton);

    expect(authState.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("finds a promotional pass after a standard onboarding sign-in before advancing", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;
    const entitlementResult = createDeferred<{
      success: true;
      data: {
        plan: "individual";
        status: "trialing";
        canUseApp: true;
        trialEndsAt: string;
        currentPeriodEnd: null;
        accessSource: "promotion";
      };
    }>();
    billingMocks.fetchBillingEntitlement.mockReturnValue(entitlementResult.promise);

    const view = render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();

    await act(async () => {
      authState.user = { id: "promo-user", email: "promo@example.com" };
      authState.status = "authenticated";
      authState.hasRequiredAccountAuth = true;
      view.rerender(<App />);
      await Promise.resolve();
    });

    expect(within(screen.getByRole("status")).getByText(/^account connected$/i)).toBeTruthy();
    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("false");
    expect(screen.queryByRole("button", { name: /^continue(?: setup)?$/i })).toBeNull();
    expect(screen.queryByText(/checking pro access/i)).toBeNull();
    expect(screen.queryByRole("dialog", { name: /what kind of work do you do/i })).toBeNull();

    await act(async () => {
      entitlementResult.resolve({
        success: true,
        data: {
          plan: "individual",
          status: "trialing",
          canUseApp: true,
          trialEndsAt: "2026-10-26T00:00:00.000Z",
          currentPeriodEnd: null,
          accessSource: "promotion",
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText(/pro access is active/i)).toBeTruthy();
    expect(screen.getByText(/available through oct 26, 2026/i)).toBeTruthy();
    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
    const transitions = capturePostHogEvent.mock.calls.filter(([event, properties]) =>
      (event === "onboarding_entry_action" && properties.action === "auto_advance_attempted")
      || (event === "onboarding_step_viewed" && properties.step === "job"));
    expect(transitions).toEqual([
      ["onboarding_entry_action", { action: "auto_advance_attempted" }],
      ["onboarding_step_viewed", { step: "job" }],
    ]);
  });

  it("continues setup after promo verification is deferred and retries when the network returns", async () => {
    window.localStorage.setItem("drifty:billing:promo-handoff:v1", JSON.stringify({ receivedAt: Date.now() }));
    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: false,
      error: "Network connection failed.",
    });

    render(<App />);

    const accountDialog = await screen.findByRole("dialog", { name: /connect your account/i });
    const deferredStatus = await within(accountDialog).findByText(/check pro access again later/i, undefined, { timeout: 4_000 });
    expect(deferredStatus).toBeTruthy();
    expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(2);
    expect(window.localStorage.getItem("drifty:billing:promo-handoff:v1")).not.toBeNull();
    // The account was connected before onboarding opened, so the deferred check waits for Continue.
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();

    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: true,
      data: {
        plan: "individual",
        status: "trialing",
        canUseApp: true,
        trialEndsAt: "2026-10-26T00:00:00.000Z",
        currentPeriodEnd: null,
        accessSource: "promotion",
      },
    });
    fireEvent(window, new Event("online"));

    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(window.localStorage.getItem("drifty:billing:promo-handoff:v1")).toBeNull());
  });

  it("lets an already authenticated account continue without starting sign-in again", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();

    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
  });

  it("treats an email-less non-anonymous account as connected", async () => {
    authState.user = { id: "user-1", email: null };
    authState.status = "authenticated";
    authState.hasRequiredAccountAuth = true;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();

    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
  });

  it("waits for profile loading to settle before showing onboarding", async () => {
    const profileResult = createDeferred<{
      success: true;
      error: null;
      data: {
        public_id: string;
        display_name: string;
        bio: string;
        avatar_url: string;
        website_url: string;
        github_url: string;
        linkedin_url: string;
        timezone: string;
        is_public: boolean;
        updated_at: string;
      };
    }>();
    fetchOwnProfile.mockReturnValueOnce(profileResult.promise);

    render(<App />);

    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();

    await act(async () => {
      profileResult.resolve({
        success: true,
        error: null,
        data: {
          public_id: "profile-1",
          display_name: "Profile Alex",
          bio: "",
          avatar_url: "",
          website_url: "",
          github_url: "",
          linkedin_url: "",
          timezone: "UTC",
          is_public: true,
          updated_at: "2026-05-08T00:00:00.000Z",
        },
      });
      await profileResult.promise;
    });

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Alex Chen")).toBeNull();
  });

  it("stores v2 onboarding state and hides the modal after completion", async () => {
    render(<App />);

    await advanceToReadyStep({
      activity: "Coding",
      workDescription: "I build a small SaaS product and help customers.",
    });
    await screen.findByRole("dialog", { name: /you're ready to go/i });

    fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(trackerStart).toHaveBeenLastCalledWith({ resumePaused: true });
    expect(parsePostOnboardingSidebarGuideRecord(
      window.localStorage.getItem(postOnboardingSidebarGuideStorageKey("user-1")),
    )).toMatchObject({ status: "active", step: "welcome" });

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    expect(storedValue).toBeTruthy();
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.version).toBe(2);
    expect(storedRecord.completed).toBe(true);
    expect(storedRecord.displayName).toBe("alex");
    expect(storedRecord.jobType).toBe("Coding");
    expect(storedRecord.workType).toBe("Coding");
    expect(storedRecord.workDomain).toBeNull();
    expect(storedRecord.workDescription).toBe("I build a small SaaS product and help customers.");
    expect(storedRecord.driftAlarmEnabled).toBe(false);
    expect(storedRecord.extremeNudgeEnabled).toBe(false);
    expect(storedRecord.browserHistoryBootstrapEnabled).toBe(true);
    expect(storedRecord.focusGoalHours).toBeNull();
    expect(storedRecord.driftThresholdMinutes).toBeNull();
    expect(typeof storedRecord.completedAt).toBe("string");
    expect(saveOwnProfile).not.toHaveBeenCalled();
  }, 15_000);

  it("grants an available Cloud trial only from the final action after tracking is ready", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: AVAILABLE_CLOUD_TRIAL });
    billingMocks.startCloudTrial.mockResolvedValue({ success: true, data: GRANTED_CLOUD_TRIAL });
    const pendingTrackerStart = createDeferred<TrackerStatus>();
    trackerStart.mockReturnValue(pendingTrackerStart.promise);

    render(<App />);

    await advanceThroughSharedBasics({ activity: "Coding" });
    const setupDialog = await screen.findByRole("dialog", { name: /choose your setup/i });
    expect(within(setupDialog).getByText(/7-day free trial/i)).toBeTruthy();
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();

    fireEvent.click(within(setupDialog).getByRole("button", { name: /drifty cloud/i }));
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();
    await clickEnabledNext();

    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const grantButton = within(readyDialog).getByRole("button", { name: /^start 7-day free trial$/i });
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();
    fireEvent.click(grantButton);
    fireEvent.click(grantButton);
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();
    await waitFor(() => expect(trackerStart).toHaveBeenCalledTimes(1));
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();

    await act(async () => {
      pendingTrackerStart.resolve(makeTrackerStatus());
      await pendingTrackerStart.promise;
    });
    await waitFor(() => expect(billingMocks.startCloudTrial).toHaveBeenCalledTimes(1));
    expect(billingMocks.startCloudTrial).toHaveBeenCalledWith(undefined, "user-1");
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
  }, 15_000);

  it("keeps available Cloud onboarding open when the explicit final grant fails", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: AVAILABLE_CLOUD_TRIAL });
    billingMocks.startCloudTrial.mockResolvedValue({ success: false, error: "Trial grant failed." });

    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    expect(billingMocks.startCloudTrial).not.toHaveBeenCalled();
    fireEvent.click(within(readyDialog).getByRole("button", { name: /^start 7-day free trial$/i }));

    expect((await within(readyDialog).findByRole("alert")).textContent).toContain("Trial grant failed.");
    expect(billingMocks.startCloudTrial).toHaveBeenCalledTimes(1);
    expect(trackerStart).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /you're ready to go/i })).toBeTruthy();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
  }, 15_000);

  it.each([false, true])("resets another account's draft and ignores its pending grant (pending=%s)", async (pending) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: AVAILABLE_CLOUD_TRIAL });
    const grant = createDeferred<{ success: true; data: typeof GRANTED_CLOUD_TRIAL }>();
    billingMocks.startCloudTrial.mockReturnValue(grant.promise);
    const view = render(<App />);
    await advanceToReadyStep({ activity: "Coding", workDescription: "Account A private draft" });
    if (pending) {
      fireEvent.click(await screen.findByRole("button", { name: /^start 7-day free trial$/i }));
      await waitFor(() => expect(billingMocks.startCloudTrial).toHaveBeenCalledOnce());
    }
    await act(async () => {
      authState.user = { id: "user-2", email: "second@example.com" };
      view.rerender(<App />);
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull());
    await act(async () => {
      grant.resolve({ success: true, data: GRANTED_CLOUD_TRIAL });
      await grant.promise;
    });
    expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-2"))).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
    const progress = JSON.parse(window.localStorage.getItem(getOnboardingProgressStorageKey("user-2")) ?? "{}");
    expect(progress.step).toBe("account");
    expect(progress.workDescription).not.toBe("Account A private draft");
    // Cloud is the fresh form's default; it still starts at the entry screen and
    // requires a new final action from this account.
    expect(progress.setupChoice).toBe("simple");
    expect(billingMocks.startCloudTrial).toHaveBeenCalledTimes(pending ? 1 : 0);
  }, 15_000);

  it("submits final onboarding only once while tracker startup is pending", async () => {
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const startButton = within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }) as HTMLButtonElement;
    const readyForm = startButton.closest("form");
    const trackerStartsBeforeCompletion = trackerStart.mock.calls.length;
    const pendingTrackerStart = createDeferred<TrackerStatus>();
    trackerStart.mockReturnValue(pendingTrackerStart.promise);

    fireEvent.click(startButton);
    expect(startButton.disabled).toBe(true);
    expect(startButton.textContent).toMatch(/finishing/i);
    expect((within(readyDialog).getByRole("button", { name: /start drifty at login/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(readyDialog).getByRole("checkbox", { name: /import from browser history/i }) as HTMLInputElement).disabled).toBe(true);

    if (!readyForm) throw new Error("Expected final onboarding button to belong to the onboarding form.");
    fireEvent.submit(readyForm);
    await waitFor(() => expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 1));

    await act(async () => {
      pendingTrackerStart.resolve(makeTrackerStatus());
      await pendingTrackerStart.promise;
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(capturePostHogEvent.mock.calls.filter(([event]) => event === "onboarding_completed")).toHaveLength(1);
  }, 15_000);

  it.each(["before", "after"])("recovers AI setup storage failure %s the grant without a duplicate trial", async (failureAt) => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: AVAILABLE_CLOUD_TRIAL });
    let failStorage = failureAt === "before";
    billingMocks.startCloudTrial.mockImplementation(async () => {
      billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: GRANTED_CLOUD_TRIAL });
      if (failureAt === "after") failStorage = true;
      return { success: true, data: GRANTED_CLOUD_TRIAL };
    });
    render(<App />);
    await advanceToReadyStep({ activity: "Coding" });
    const originalSetItem = Storage.prototype.setItem;
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === "drifty.aiSetup.v1" && failStorage) throw new DOMException("Storage full", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });
    try {
      fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));
      expect((await screen.findByRole("alert")).textContent).toContain("Unable to save AI setup locally");
      expect(billingMocks.startCloudTrial).toHaveBeenCalledTimes(failureAt === "before" ? 0 : 1);
      expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
      failStorage = false;
      fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull());
      expect(billingMocks.startCloudTrial).toHaveBeenCalledOnce();
      expect(JSON.parse(window.localStorage.getItem("drifty.aiSetup.v1") ?? "{}")).toMatchObject({ provider: "managed_local", driftyRoute: "cloud" });
    } finally { storage.mockRestore(); }
  }, 15_000);

  it("allows final onboarding to be retried after tracker startup fails", async () => {
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const trackerStartsBeforeCompletion = trackerStart.mock.calls.length;
    trackerStart.mockRejectedValueOnce(new Error("Tracker start failed"));

    fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    expect((await within(readyDialog).findByRole("alert")).textContent).toContain("Tracker start failed");
    const retryButton = within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(false);
    expect((within(readyDialog).getByRole("button", { name: /^back$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(readyDialog).getByRole("button", { name: /start drifty at login/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((within(readyDialog).getByRole("checkbox", { name: /import from browser history/i }) as HTMLInputElement).disabled).toBe(false);
    expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 1);

    trackerStart.mockResolvedValue(makeTrackerStatus());
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 2);
    expect(capturePostHogEvent.mock.calls.filter(([event]) => event === "onboarding_completed")).toHaveLength(1);
  }, 15_000);

  it("locks before the start-at-login request and ignores a second final submit", async () => {
    startupSettingsClient.isAvailable.mockReturnValue(true);
    const pendingStartupSetting = createDeferred<{
      success: boolean;
      enabled: boolean;
      status: string;
      backend: string;
    }>();
    startupSettingsClient.setOpenAtLoginEnabled.mockReturnValue(pendingStartupSetting.promise);
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const startButton = within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }) as HTMLButtonElement;
    const readyForm = startButton.closest("form");
    const trackerStartsBeforeCompletion = trackerStart.mock.calls.length;

    fireEvent.click(startButton);
    if (!readyForm) throw new Error("Expected final onboarding button to belong to the onboarding form.");
    fireEvent.submit(readyForm);

    expect(startupSettingsClient.setOpenAtLoginEnabled).toHaveBeenCalledTimes(1);
    expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion);
    expect(startButton.disabled).toBe(true);

    await act(async () => {
      pendingStartupSetting.resolve({
        success: true,
        enabled: true,
        status: "enabled",
        backend: "smAppService",
      });
      await pendingStartupSetting.promise;
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 1);
    expect(capturePostHogEvent.mock.calls.filter(([event]) => event === "onboarding_completed")).toHaveLength(1);
  }, 15_000);

  it("unlocks every final control after local completion storage fails and then retries", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: AVAILABLE_CLOUD_TRIAL });
    billingMocks.startCloudTrial.mockImplementation(async () => {
      billingMocks.fetchBillingEntitlement.mockResolvedValue({ success: true, data: GRANTED_CLOUD_TRIAL });
      return { success: true, data: GRANTED_CLOUD_TRIAL };
    });
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const completionStorageKey = getUserOnboardingStorageKey("user-1");
    const originalSetItem = window.localStorage.setItem.bind(window.localStorage);
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key, value) => {
      if (key === completionStorageKey) throw new DOMException("Storage quota exceeded", "QuotaExceededError");
      originalSetItem(key, value);
    });
    const trackerStartsBeforeCompletion = trackerStart.mock.calls.length;

    try {
      fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      expect((await within(readyDialog).findByRole("alert")).textContent).toContain("Unable to save setup locally");
      const retryButton = within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }) as HTMLButtonElement;
      expect(retryButton.disabled).toBe(false);
      expect((within(readyDialog).getByRole("button", { name: /^back$/i }) as HTMLButtonElement).disabled).toBe(false);
      expect((within(readyDialog).getByRole("button", { name: /start drifty at login/i }) as HTMLButtonElement).disabled).toBe(false);
      expect((within(readyDialog).getByRole("checkbox", { name: /import from browser history/i }) as HTMLInputElement).disabled).toBe(false);
      expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 1);
      expect(capturePostHogEvent.mock.calls.filter(([event]) => event === "onboarding_completed")).toHaveLength(0);
      expect(billingMocks.startCloudTrial).toHaveBeenCalledOnce();

      setItemSpy.mockRestore();
      fireEvent.click(retryButton);

      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
      });
      expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 2);
      expect(capturePostHogEvent.mock.calls.filter(([event]) => event === "onboarding_completed")).toHaveLength(1);
      expect(billingMocks.startCloudTrial).toHaveBeenCalledOnce();
    } finally {
      setItemSpy.mockRestore();
    }
  }, 15_000);

  it("keeps completion terminal when presentation fails after local persistence", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    browserHistoryBootstrapReset.mockImplementationOnce(() => {
      throw new Error("Presentation update failed");
    });

    try {
      render(<App />);
      await advanceToReadyStep({ activity: "Coding" });
      const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
      const startButton = within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }) as HTMLButtonElement;
      const readyForm = startButton.closest("form");
      const trackerStartsBeforeCompletion = trackerStart.mock.calls.length;

      fireEvent.click(startButton);
      await waitFor(() => {
        expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeTruthy();
      });
      expect(startButton.disabled).toBe(true);
      if (!readyForm) throw new Error("Expected final onboarding button to belong to the onboarding form.");
      fireEvent.submit(readyForm);

      expect(trackerStart).toHaveBeenCalledTimes(trackerStartsBeforeCompletion + 1);
      expect(capturePostHogEvent.mock.calls.filter(([event]) => event === "onboarding_completed")).toHaveLength(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Onboarding presentation failed after local completion was saved.",
        expect.any(Error),
      );
    } finally {
      consoleErrorSpy.mockRestore();
    }
  }, 15_000);

  it("shows the free trial started notice inside Cloud onboarding", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: true,
      data: {
        plan: "individual",
        status: "trialing",
        canUseApp: true,
        trialEndsAt: "2026-06-20T00:00:00.000Z",
        currentPeriodEnd: null,
      },
    });

    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });

    expect(within(readyDialog).getByText(/^drifty cloud$/i)).toBeTruthy();
    expect(within(readyDialog).getByText(/^free trial active$/i)).toBeTruthy();
    expect(within(readyDialog).queryByText(/open today to review your timeline/i)).toBeNull();
    expect(within(readyDialog).queryByText(/7-day free trial started/i)).toBeNull();

    fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(screen.queryByRole("status", { name: /drifty cloud trial started/i })).toBeNull();
  });

  it("skips the connected account step and carries a promotional pass through onboarding", async () => {
    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: true,
      data: {
        plan: "individual",
        status: "trialing",
        canUseApp: true,
        trialEndsAt: "2026-10-26T00:00:00.000Z",
        currentPeriodEnd: null,
        accessSource: "promotion",
      },
    });

    render(<App />);

    const welcomeDialog = await screen.findByRole("dialog", { name: /welcome to drifty/i }, { timeout: 6_000 });
    // A pass already active on a connected account settles sign-in: the entry screen shows the pass and Continue.
    expect(within(welcomeDialog).getByText("Welcome to drifty.")).toBeTruthy();
    expect(await within(welcomeDialog).findByText(/pro access is active/i)).toBeTruthy();
    expect(within(welcomeDialog).getByText(/available through oct 26, 2026.*no card required.*no automatic renewal/i)).toBeTruthy();
    expect(within(welcomeDialog).queryByRole("button", { name: /continue with google/i })).toBeNull();
    await clickEnabledNext();

    await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 });
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
    selectMainActivity("Coding");
    await clickEnabledAction(/^continue$/i);

    const setupDialog = await screen.findByRole("dialog", { name: /choose your setup/i }, { timeout: 6_000 });
    expect(within(setupDialog).getByText("Included")).toBeTruthy();
    expect(within(setupDialog).getByText(/pro pass through oct 26, 2026/i)).toBeTruthy();
    expect(within(setupDialog).queryByText(/7-day free trial/i)).toBeNull();
    fireEvent.click(within(setupDialog).getByRole("button", { name: /drifty cloud/i }));
    await clickEnabledAction(/^continue$/i);
    await screen.findByRole("dialog", { name: /set up permissions/i }, { timeout: 6_000 });
    await clickEnabledNext();

    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i }, { timeout: 6_000 });
    expect(within(readyDialog).getByText(/^pro pass through oct 26, 2026$/i)).toBeTruthy();
  });

  it("opens the intro on the sample cards when the day cannot be read", async () => {
    const { trackerClient } = await import("./lib/api/trackerClient");
    vi.mocked(trackerClient.getTimeline).mockRejectedValue(new Error("tracker unavailable"));
    window.localStorage.setItem(getUserOnboardingStorageKey("user-1"), JSON.stringify({
      version: 2, completed: true, displayName: "Alex", workType: "Design", workTypeOther: "", workDomain: "Tech",
      workDomainOther: "", focusGoalHours: null, driftThresholdMinutes: null, purpose: null, completedAt: "2026-05-08T00:00:00.000Z",
    }));
    window.localStorage.setItem(postOnboardingSidebarGuideStorageKey("user-1"), JSON.stringify({
      version: 1, status: "active", step: "welcome", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));

    try {
      render(<App />);
      expect(await screen.findByRole("dialog", { name: /welcome to drifty/i }, { timeout: 8_000 })).toBeTruthy();
      await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_intro", expect.objectContaining({
        action: "step_viewed", sequence: "sample", decision_reason: "history_read_failed",
      })));
    } finally {
      vi.mocked(trackerClient.getTimeline).mockResolvedValue([]);
    }
  });

  it("applies the intro's Automatic close and desktop cat choices and asks before closing", async () => {
    window.localStorage.setItem(getUserOnboardingStorageKey("user-1"), JSON.stringify({
      version: 2, completed: true, displayName: "Alex", workType: "Design", workTypeOther: "", workDomain: "Tech",
      workDomainOther: "", focusGoalHours: null, driftThresholdMinutes: null, purpose: null, completedAt: "2026-05-08T00:00:00.000Z",
    }));
    window.localStorage.setItem(postOnboardingSidebarGuideStorageKey("user-1"), JSON.stringify({
      version: 1, status: "active", step: "account", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }));

    render(<App />);

    let decision = await screen.findByRole("dialog", { name: /when drift runs long/i });
    expect(within(decision).queryByText(/let me know/i)).toBeNull();
    // During sessions is held on the card; Next asks before anything turns on.
    expect(within(decision).getByRole("radio", { name: /^during sessions/i }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(decision).getByRole("button", { name: /^Next$/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: /close distractions during focus sessions/i })).getByRole("button", { name: /keep off/i }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(window.localStorage.getItem("drifty.notifications.extremeNudge")).not.toBe("1");
    // Keeping it off here leaves the first focus session's offer open.
    expect(window.localStorage.getItem("drifty.focusSession.autoCloseOffer.v1")).toBeNull();
    fireEvent.click(within(decision).getByRole("radio", { name: /^during sessions/i }));
    fireEvent.click(within(decision).getByRole("button", { name: /^Next$/i }));
    fireEvent.click(within(await screen.findByRole("alertdialog", { name: /close distractions during focus sessions/i })).getByRole("button", { name: /^turn on$/i }));
    await waitFor(() => expect(window.localStorage.getItem("drifty.notifications.extremeNudge")).toBe("1"));
    expect(window.localStorage.getItem("drifty.focusSession.autoCloseScope.v1")).toBe("session");
    // During sessions needs no Drift alerts of its own; Turn on moved on to the next card.
    expect(window.localStorage.getItem("drifty.notifications.driftAlerts")).not.toBe("1");
    fireEvent.click(await screen.findByRole("button", { name: /^back$/i }));
    decision = await screen.findByRole("dialog", { name: /when drift runs long/i });
    // A saved choice changes at once; Always rides on Drift alerts, as in Settings.
    fireEvent.click(within(decision).getByRole("radio", { name: /^always$/i }));
    await waitFor(() => expect(window.localStorage.getItem("drifty.notifications.driftAlerts")).toBe("1"));

    fireEvent.click(within(decision).getByRole("switch", { name: /show desktop cat/i }));
    await waitFor(() => expect(window.localStorage.getItem("drifty.pet.enabled")).toBe("1"));
    // Turning the cat on asks for its name; nothing is named until the user confirms one.
    const naming = await screen.findByRole("dialog", { name: /what should we call this cat/i });
    expect(window.localStorage.getItem("drifty.pet.name.v1")).toBeNull();
    fireEvent.change(within(naming).getByRole("textbox", { name: /cat name/i }), { target: { value: "Mochi" } });
    fireEvent.click(within(naming).getByRole("button", { name: /use this name/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /what should we call this cat/i })).toBeNull());
    expect(window.localStorage.getItem("drifty.pet.name.v1")).toBe("Mochi");

    // Turning it back off leaves no Drift alerts the user never chose.
    fireEvent.click(within(decision).getByRole("radio", { name: /^off$/i }));
    await waitFor(() => expect(window.localStorage.getItem("drifty.notifications.extremeNudge")).toBe("0"));
    expect(window.localStorage.getItem("drifty.notifications.driftAlerts")).toBe("0");

    // The intro reports the card it showed and, when it ends, the choices it settled.
    expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_intro", expect.objectContaining({ action: "step_viewed", step: "account" }));
    // Escape on the decision card goes on to the menu bar card, which everyone sees once.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_intro", expect.objectContaining({ action: "skipped", step: "account" })));
    await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_intro", expect.objectContaining({ action: "step_viewed", step: "tracking" })));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_intro", expect.objectContaining({
      action: "dismissed",
      step: "tracking",
      drift_alarm_enabled: false,
      extreme_nudge_enabled: false,
      pet_enabled: true,
      pet_named: true,
    })));
    // Only whether the cat has a name is reported, never the name.
    expect(JSON.stringify(capturePostHogEvent.mock.calls)).not.toContain("Mochi");
  });

  it("stars Drifty as the signed-in gh account when tracking starts, on by default", async () => {
    githubStarMocks.loadAccount.mockResolvedValue("octocat");
    try {
      render(<App />);

      await advanceToReadyStep({ activity: "Coding" });
      const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
      const choice = await within(readyDialog).findByRole("checkbox", { name: "Star Drifty on GitHub as @octocat when tracking starts" });
      expect((choice as HTMLInputElement).checked).toBe(true);
      fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      await waitFor(() => expect(githubStarMocks.star).toHaveBeenCalledWith("octocat"));
      expect(githubStarMocks.markDone).not.toHaveBeenCalled();
      expect(capturePostHogEvent).toHaveBeenCalledWith("github_star_prompt", { action: "clicked", placement: "onboarding", method: "gh" });
    } finally {
      githubStarMocks.loadAccount.mockResolvedValue(null);
    }
  });

  it("starts tracking without a star when the GitHub choice is unticked, and does not ask again", async () => {
    githubStarMocks.loadAccount.mockResolvedValue("octocat");
    try {
      render(<App />);

      await advanceToReadyStep({ activity: "Coding" });
      const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
      fireEvent.click(await within(readyDialog).findByRole("checkbox", { name: /star drifty on github/i }));
      fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      await waitFor(() => expect(githubStarMocks.markDone).toHaveBeenCalled());
      expect(githubStarMocks.star).not.toHaveBeenCalled();
      expect(capturePostHogEvent).toHaveBeenCalledWith("github_star_prompt", { action: "dismissed", placement: "onboarding", method: "gh" });
    } finally {
      githubStarMocks.loadAccount.mockResolvedValue(null);
    }
  });

  it("enables login startup by default when onboarding completes in the Mac app", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    startupSettingsClient.isAvailable.mockReturnValue(true);

    try {
      render(<App />);

      await advanceToReadyStep({ activity: "Coding" });
      const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
      const startupToggle = within(readyDialog).getByRole("button", { name: /start drifty at login/i });

      expect(startupToggle.getAttribute("aria-pressed")).toBe("true");
      fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      await waitFor(() => {
        expect(startupSettingsClient.setOpenAtLoginEnabled).toHaveBeenCalledWith(true);
      });
      expect(debugSpy).toHaveBeenCalledWith("Start at login update completed during onboarding.", {
        requested: true,
        success: true,
        enabled: true,
        status: "enabled",
        backend: "smAppService",
      });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("honors the opt-out login startup choice from onboarding", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    startupSettingsClient.isAvailable.mockReturnValue(true);
    startupSettingsClient.setOpenAtLoginEnabled.mockResolvedValueOnce({
      success: true,
      enabled: false,
      status: "notRegistered",
      backend: "smAppService",
    });

    try {
      render(<App />);

      await advanceToReadyStep({ activity: "Coding" });
      const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
      const startupToggle = within(readyDialog).getByRole("button", { name: /start drifty at login/i });
      fireEvent.click(startupToggle);
      expect(startupToggle.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      await waitFor(() => {
        expect(startupSettingsClient.setOpenAtLoginEnabled).toHaveBeenCalledWith(false);
      });
      expect(debugSpy).toHaveBeenCalledWith("Start at login update completed during onboarding.", {
        requested: false,
        success: true,
        enabled: false,
        status: "notRegistered",
        backend: "smAppService",
      });
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("lets users opt out of recent history while still preparing the selected Cloud route", async () => {
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const browserHistoryCheckbox = within(readyDialog).getByRole("checkbox", {
      name: /import from browser history \(last 72 hours\)/i,
    });

    expect((browserHistoryCheckbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(browserHistoryCheckbox);
    expect((browserHistoryCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(await screen.findByText(/making sense of your day/i)).toBeTruthy();
    expect(trackerPreviewBrowserHistoryImport).not.toHaveBeenCalled();

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.browserHistoryBootstrapEnabled).toBe(false);
  }, 15_000);

  it("prepares the first day before revealing the dashboard when browser history import stays enabled", async () => {
    trackerPreviewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 3,
      candidateCount: 3,
      segmentCount: 2,
      estimatedSeconds: 600,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount: 0,
      windowStart: "2026-07-01T13:15:00.000Z",
      windowEnd: "2026-07-03T13:15:00.000Z",
    });
    let resolveImport: () => void = () => undefined;
    trackerImportBrowserHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = () =>
            resolve({
              lookbackDays: 3,
              candidateCount: 3,
              segmentCount: 2,
              estimatedSeconds: 600,
              browserCount: 1,
              profileCount: 1,
              databaseCount: 1,
              errorCount: 0,
              windowStart: "2026-07-01T13:15:00.000Z",
              windowEnd: "2026-07-03T13:15:00.000Z",
              insertedCount: 2,
              skippedDuplicateCount: 0,
            });
        }),
    );

    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    // The dashboard is gated behind the preparation screen while the 48h import runs.
    expect(await screen.findByText(/getting your day ready/i)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    await waitFor(() => expect(trackerImportBrowserHistory).toHaveBeenCalledWith({ lookbackDays: 3 }));
    expect(trackerPreviewBrowserHistoryImport).not.toHaveBeenCalled();

    // Only once preparation settles does the dashboard appear.
    resolveImport();
    await waitFor(() => expect(screen.queryByText(/getting your day ready/i)).toBeNull());
    expect(trackerImportBrowserHistory).toHaveBeenCalledTimes(1);
    expect(trackerPreviewBrowserHistoryImport).not.toHaveBeenCalled();
  }, 15_000);

  it("lets the empty dashboard retry when first-day browser history import fails", async () => {
    trackerImportBrowserHistory.mockRejectedValueOnce(new Error("browser database temporarily locked"));
    trackerGetClassificationMetrics.mockResolvedValue({ totalSegments: 0, classifiedSegments: 0, unclassifiedSegments: 0 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(<App />);
    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => expect(trackerImportBrowserHistory).toHaveBeenCalledTimes(1));
    // The finished gate holds its closing line before the dashboard takes over.
    await waitFor(() => expect(document.querySelector(".first-day-prep")).toBeNull(), { timeout: FIRST_DAY_PREPARATION_READY_HOLD_MS + 1_000 });
    await waitFor(() => expect(trackerPreviewBrowserHistoryImport).toHaveBeenCalledTimes(1));
    expect(warnSpy).toHaveBeenCalledWith("First-day browser history import unavailable", expect.any(Error));
  }, 15_000);

  it("completes onboarding when login startup cannot be enabled", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    startupSettingsClient.isAvailable.mockReturnValue(true);
    startupSettingsClient.setOpenAtLoginEnabled.mockRejectedValue(new Error("Autostart denied"));

    try {
      render(<App />);

      await advanceToReadyStep({ activity: "Coding" });
      const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
      fireEvent.click(within(readyDialog).getByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
      });

      expect(startupSettingsClient.setOpenAtLoginEnabled).toHaveBeenCalledWith(true);
      expect(debugSpy).toHaveBeenCalledWith("Start at login update failed during onboarding.", {
        requested: true,
        error: { name: "Error", message: "Autostart denied" },
      });
      expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeTruthy();
    } finally {
      debugSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("stores onboarding completion under the v2 drifty key and ignores the legacy keys", async () => {
    render(<App />);

    await advanceToReadyStep();
    fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });

    expect(getUserOnboardingStorageKey("user-1")).toBe("drifty:onboarding:v2:user-1");
    expect(window.localStorage.getItem("drifty:onboarding:v2:user-1")).toBeTruthy();
    expect(window.localStorage.getItem("drifty:onboarding:v1:user-1")).toBeNull();
  });

  it("uses a v1 drifty onboarding record as a migration fallback", async () => {
    window.localStorage.setItem(
      "drifty:onboarding:v1:user-1",
      JSON.stringify({
        version: 1,
        completed: true,
        displayName: "Alex",
        purpose: "exploring",
        completedAt: "2026-05-08T00:00:00.000Z",
      }),
    );

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
    expect(window.localStorage.getItem("drifty:onboarding:v2:user-1")).toBeTruthy();
  });


  it("keeps onboarding open when local completion cannot be saved", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key) => {
      if (String(key).startsWith("drifty:onboarding:")) {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
    });

    try {
      render(<App />);

      await advanceToReadyStep();
      fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));

      const storageError = await screen.findByRole("alert");
      expect(storageError.textContent).toMatch(/unable to save setup locally/i);
      expect(screen.getByRole("dialog", { name: /you're ready to go/i })).toBeTruthy();
      expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
      expect(saveOwnProfile).not.toHaveBeenCalled();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("does not crash when local completion cannot be read", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (String(key).startsWith("drifty:onboarding:")) {
        throw new DOMException("Storage unavailable", "SecurityError");
      }
      return null;
    });

    try {
      render(<App />);

      expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it("does not expose a skip control or write completion without finishing", async () => {
    render(<App />);

    await screen.findByRole("dialog", { name: /connect your account/i });
    expect(screen.queryByRole("button", { name: /skip for now/i })).toBeNull();
    expect(screen.queryByPlaceholderText("Alex Chen")).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("opens Accessibility through the provided permissions step", async () => {
    setTauriRuntime();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));
    accessibilityGetStatus.mockResolvedValue({ granted: false, required: true });
    accessibilityRequestAccess.mockResolvedValue({ granted: false, required: true });

    render(<App />);

    await advanceToPermissionsStep();
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();

    // Every macOS row now says Allow in Settings; press the Accessibility row's.
    const accessibilityRow = screen.getByText("Accessibility", { selector: ".dc-onb-row__title span" }).closest("li");
    fireEvent.click(within(accessibilityRow as HTMLElement).getByRole("button", { name: /^allow in settings$/i }));

    await waitFor(() => {
      expect(accessibilityRequestAccess).toHaveBeenCalled();
    });
    expect(openSystemSettingsPane).not.toHaveBeenCalledWith("accessibility");
  });

  it("shows the Safari history row on the permissions step for a Safari-default user", async () => {
    setTauriRuntime();
    trackerGetBrowserHistoryEnvironment.mockResolvedValue({
      safariHistoryReadable: false,
      defaultBrowserIsSafari: true,
    });
    trackerPreviewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 3,
      candidateCount: 40,
      segmentCount: 20,
      estimatedSeconds: 3600,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount: 0,
      windowStart: "2026-07-01T13:15:00.000Z",
      windowEnd: "2026-07-03T13:15:00.000Z",
    });

    render(<App />);

    await advanceToPermissionsStep();
    expect(await screen.findByText("Safari history")).toBeTruthy();

    const safariRow = screen.getByText("Safari history").closest("li");
    fireEvent.click(within(safariRow as HTMLElement).getByRole("button", { name: /^allow in settings$/i }));
    await waitFor(() => {
      expect(openFullDiskAccessSettingsPane).toHaveBeenCalled();
    });
  });

  it("hides the Safari history row for a non-Safari user with plenty of supported history", async () => {
    setTauriRuntime();
    trackerGetBrowserHistoryEnvironment.mockResolvedValue({
      safariHistoryReadable: false,
      defaultBrowserIsSafari: false,
    });
    trackerPreviewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 3,
      candidateCount: 40,
      segmentCount: 20,
      estimatedSeconds: 3600,
      browserCount: 1,
      profileCount: 1,
      databaseCount: 1,
      errorCount: 0,
      windowStart: "2026-07-01T13:15:00.000Z",
      windowEnd: "2026-07-03T13:15:00.000Z",
    });

    render(<App />);

    await advanceToPermissionsStep();
    await waitFor(() => {
      expect(trackerGetBrowserHistoryEnvironment).toHaveBeenCalled();
    });
    expect(screen.queryByText("Safari history")).toBeNull();
  });

  it("blocks the combined permissions step until Accessibility is granted on desktop", async () => {
    setTauriRuntime();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));
    accessibilityGetStatus.mockResolvedValue({ granted: false, required: true });

    render(<App />);

    await advanceToPermissionsStep();
    const continueButton = await screen.findByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    await waitFor(() => expect(continueButton.disabled).toBe(true));
    expect(screen.getByText(/enable accessibility to continue/i)).toBeTruthy();
    // macOS shows a decorative picture of the Accessibility list, and the path to it under it.
    const preview = document.querySelector(".onb-ax-preview");
    expect(preview?.getAttribute("aria-hidden")).toBe("true");
    expect(preview?.getAttribute("data-granted")).toBe("false");
    expect(document.querySelector(".onb-ax-aside__caption")?.textContent).toMatch(/Privacy & Security → Accessibility/);
    // The desktop notification plugin never prompts the OS, so macOS
    // onboarding no longer offers a Notifications "grant" that only relabels.
    expect(screen.queryByText(/^Notifications$/)).toBeNull();

    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: true,
    }));
    accessibilityGetStatus.mockResolvedValue({ granted: true, required: true });
    fireEvent.focus(window);

    await waitFor(() => expect(continueButton.disabled).toBe(false), { timeout: 3_000 });
    // Once granted the picture shows drifty switched on and the path is no longer needed.
    expect(document.querySelector(".onb-ax-preview")?.getAttribute("data-granted")).toBe("true");
    expect(document.querySelector(".onb-ax-aside__caption")).toBeNull();
  });

  it("records a confirmed Accessibility grant after returning from Settings before setup is completed", async () => {
    setTauriRuntime();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({ accessibilityGranted: false }));
    accessibilityGetStatus.mockResolvedValue({ granted: false, required: true, platform: "macos" });
    accessibilityRequestAccess.mockResolvedValue({ granted: false, required: true, platform: "macos" });
    const app = render(<App />);

    await advanceToPermissionsStep();
    const proceed = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    expect(proceed.disabled).toBe(true);
    const row = screen.getByText("Accessibility", { selector: ".dc-onb-row__title span" }).closest("li");
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: /^allow in settings$/i }));
    await waitFor(() => expect(capturePostHogEvent).toHaveBeenCalledWith("permission_action", {
      permission: "accessibility", action: "request", result: "skipped", accessibility_granted: false,
    }));
    expect(capturePostHogEvent).not.toHaveBeenCalledWith("permission_action", expect.objectContaining({
      permission: "accessibility", action: "check",
    }));

    accessibilityGetStatus.mockResolvedValue({ granted: true, required: true, platform: "macos" });
    trackerStart.mockResolvedValue(makeTrackerStatus({ accessibilityGranted: true }));
    fireEvent.focus(window);
    await waitFor(() => expect(proceed.disabled).toBe(false));
    fireEvent.focus(window);
    app.unmount();
    const grantChecks = capturePostHogEvent.mock.calls.filter(([event, properties]) =>
      event === "permission_action" && properties.permission === "accessibility" && properties.action === "check",
    );
    expect(grantChecks).toEqual([["permission_action", {
      permission: "accessibility", action: "check", result: "success", accessibility_granted: true,
    }]]);
    expect(capturePostHogEvent).not.toHaveBeenCalledWith("onboarding_completed", expect.anything());
    expect(capturePostHogEvent).not.toHaveBeenCalledWith("onboarding_step_viewed", { step: "ready" });
  });

  it("keeps the Windows onboarding early start implicit after Accessibility becomes ready", async () => {
    setTauriRuntime();
    accessibilityDetectHostPlatform.mockReturnValue("windows");
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      running: false,
      accessibilityGranted: false,
      trackerMode: "idle",
    }));
    accessibilityGetStatus.mockResolvedValue({ granted: true, required: false });
    trackerStart.mockResolvedValue(makeTrackerStatus({
      running: false,
      trackingPaused: true,
      trackerMode: "stopped",
    }));

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    await waitFor(() => expect(trackerStart).toHaveBeenCalledExactlyOnceWith());
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("lets Windows continue without presenting a macOS-only Accessibility grant", async () => {
    setTauriRuntime();
    accessibilityDetectHostPlatform.mockReturnValue("windows");
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));
    accessibilityGetStatus.mockResolvedValue({ granted: true, required: false });

    render(<App />);

    await advanceToPermissionsStep();
    const continueButton = await screen.findByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    await waitFor(() => expect(continueButton.disabled).toBe(false));
    expect(screen.queryByText(/^Accessibility$/)).toBeNull();
    expect(document.querySelector(".onb-ax-preview")).toBeNull();
    expect(screen.queryByText("Safari history")).toBeNull();
    expect(trackerGetBrowserHistoryEnvironment).not.toHaveBeenCalled();
    expect(trackerPreviewBrowserHistoryImport).not.toHaveBeenCalled();
    expect(screen.getByText(/^Notifications$/)).toBeTruthy();
  });

  it("uses downloaded-model lookup copy before initial managed status resolves and applies native ready events", async () => {
    setTauriRuntime();
    const statusDeferred = createDeferred<ManagedLocalAiStatus>();
    const readyStatus = runningManagedModel("drifty-qwen3-5-4b-default");
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return statusDeferred.promise;
        default:
          return Promise.resolve({});
      }
    });
    render(<App />);

    await chooseLocalAiSetup();

    const localDialog = await screen.findByRole("dialog", { name: /set up your local ai model/i });
    expect(await within(localDialog).findByText(/looking for downloaded local models/i)).toBeTruthy();
    expect(within(localDialog).queryByText(/checking managed local ai/i)).toBeNull();
    await waitFor(() => expect(tauriEventHandlers.has("managed-ai-status")).toBe(true));

    act(() => {
      emitTauriEvent("managed-ai-status", readyStatus);
    });

    const defaultModel = within(localDialog).getByRole("article", { name: /qwen 3\.5 4b local ai model/i });
    await waitFor(() => expect(within(defaultModel).getByRole("button", { name: /^ready$/i })).toBeTruthy());
    expect(within(localDialog).getByText(/model ready — classification runs entirely on this computer/i)).toBeTruthy();
    expect(within(localDialog).queryByText(/looking for downloaded local models/i)).toBeNull();

    await act(async () => {
      statusDeferred.resolve(readyStatus);
      await statusDeferred.promise;
    });
  });

  it("lets Local AI onboarding continue while the download runs, then attaches the model after close", async () => {
    setTauriRuntime();
    const installDeferred = createDeferred<ManagedLocalAiStatus>();
    let managedStatus: ManagedLocalAiStatus = {
      state: "not_installed",
      selectedModelId: null,
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Choose a local model and Drifty will download it inside the app.",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    };
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          managedStatus = {
            state: "installing",
            selectedModelId: modelId,
            installedModels: [],
            baseUrl: null,
            model: null,
            message: "Downloading managed local model... (44%)",
            artifactDir: null,
            progress: {
              percent: 44,
              downloadedBytes: 1_200_000_000,
              totalBytes: 2_740_937_888,
            },
            errorKind: null,
            memoryUsageBytes: null,
          };
          return installDeferred.promise;
        }
        default:
          return Promise.resolve({});
      }
    });
    render(<App />);

    await chooseLocalAiSetup();

    const localDialog = await screen.findByRole("dialog", { name: /set up your local ai model/i });
    expect(within(localDialog).queryByRole("textbox", { name: /server url/i })).toBeNull();
    expect(screen.queryByLabelText(/openrouter api key/i)).toBeNull();
    const defaultModel = within(localDialog).getByRole("article", { name: /qwen 3\.5 4b local ai model/i });
    const statusPollCountBeforeDownload = invokeMock.mock.calls.filter(([command]) => command === "managed_ai_status").length;
    fireEvent.click(within(defaultModel).getByRole("button", { name: /^download$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
    expect(within(defaultModel).getByRole("button", { name: /^downloading…$/i })).toBeTruthy();
    // The card button names the model being fetched; the number lives on the bar.
    await waitFor(() => expect(within(localDialog).getByRole("progressbar", { name: /downloading/i }).getAttribute("aria-valuenow")).toBe("44"), { timeout: 2_000 });
    expect(within(defaultModel).getByRole("button", { name: /^downloading…$/i })).toBeTruthy();
    await waitFor(() => {
      const statusPollCount = invokeMock.mock.calls.filter(([command]) => command === "managed_ai_status").length;
      expect(statusPollCount).toBeGreaterThan(statusPollCountBeforeDownload);
    }, { timeout: 2_000 });
    expect(within(localDialog).getAllByText(/1\.2\/2\.7 GB/i).length).toBeGreaterThan(0);
    expect(within(localDialog).queryByRole("button", { name: /^downloading 42%$/i })).toBeNull();
    // A multi-gigabyte wait gets a real bar, not just a percentage in a button.
    expect(within(localDialog).getByRole("progressbar", { name: /downloading/i }).getAttribute("aria-valuenow")).toBe("44");

    // A started download no longer blocks onboarding — the first-day gate (and the
    // app-level attach watcher) finish the setup once the model lands.
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /how your data is handled/i })).toBeTruthy();
    expect(screen.getByText(/activity goes to the selected local model on this computer, not to drifty cloud/i)).toBeTruthy();

    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /you're ready to start/i })).toBeTruthy();
    expect(screen.getByText(/local model downloading/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to start/i })).toBeNull();
    });

    // The download finishes only after onboarding has closed; the attach watcher
    // writes the ready model into the AI setup and sends the ready notification.
    const completedStatus = installManagedModel("drifty-qwen3-5-4b-default");
    managedStatus = completedStatus;
    installDeferred.resolve(completedStatus);

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("drifty.aiSetup.v1") ?? "{}")).toMatchObject({
        provider: "managed_local",
        driftyRoute: "local",
        managedLocalModelId: "drifty-qwen3-5-4b-default",
        managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
        managedLocalModel: "drifty-qwen3.5-4b-local",
      });
    }, { timeout: 8_000 });
    await waitFor(() => {
      expect(sendNotificationMock).toHaveBeenCalledWith({
        title: "Local AI model ready",
        body: "Qwen 3.5 4B is ready for private classification.",
      });
    }, { timeout: 8_000 });
  }, 25_000);

  it("shows native ready status before the managed catalog refresh finishes", async () => {
    setTauriRuntime();
    const catalogDeferred = createDeferred<typeof managedCatalog>();
    const runningStatus = runningManagedModel("drifty-qwen3-5-4b-default");
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case "managed_ai_catalog":
          return catalogDeferred.promise;
        case "managed_ai_status":
          return Promise.resolve(runningStatus);
        default:
          return Promise.resolve({});
      }
    });
    render(<StrictMode><App /></StrictMode>);

    await chooseLocalAiSetup();
    const localDialog = await screen.findByRole("dialog", { name: /set up your local ai model/i });

    await waitFor(() => expect(within(localDialog).getByText(/model ready — classification runs entirely on this computer/i)).toBeTruthy());
    expect(within(localDialog).queryByText(/checking managed local ai/i)).toBeNull();
    const defaultModel = within(localDialog).getByRole("article", { name: /qwen 3\.5 4b local ai model/i });
    expect(within(defaultModel).getByRole("button", { name: /^ready$/i })).toBeTruthy();

    await act(async () => {
      catalogDeferred.resolve(managedCatalog);
      await catalogDeferred.promise;
    });
  });

  it("shows managed model progress from native status events before the install command returns", async () => {
    setTauriRuntime();
    const installDeferred = createDeferred<ManagedLocalAiStatus>();
    let managedStatus: ManagedLocalAiStatus = {
      state: "not_installed",
      selectedModelId: null,
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Choose a local model and Drifty will download it inside the app.",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    };
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          managedStatus = {
            state: "installing",
            selectedModelId: modelId,
            installedModels: [],
            baseUrl: null,
            model: null,
            message: "Downloading managed local model...",
            artifactDir: null,
            progress: null,
            errorKind: null,
            memoryUsageBytes: null,
          };
          return installDeferred.promise;
        }
        default:
          return Promise.resolve({});
      }
    });
    render(<App />);

    await chooseLocalAiSetup();
    await waitFor(() => expect(tauriEventHandlers.has("managed-ai-status")).toBe(true));

    const localDialog = await screen.findByRole("dialog", { name: /set up your local ai model/i });
    const defaultModel = within(localDialog).getByRole("article", { name: /qwen 3\.5 4b local ai model/i });
    fireEvent.click(within(defaultModel).getByRole("button", { name: /^download$/i }));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));

    act(() => {
      emitTauriEvent("managed-ai-status", {
        state: "installing",
        selectedModelId: "drifty-qwen3-5-4b-default",
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "Downloading managed local model... (44%)",
        artifactDir: null,
        progress: {
          percent: 44,
          downloadedBytes: 1_200_000_000,
          totalBytes: 2_740_937_888,
        },
        errorKind: null,
        memoryUsageBytes: null,
      });
    });

    expect(within(defaultModel).getByRole("button", { name: /^downloading…$/i })).toBeTruthy();
    expect(within(localDialog).getAllByText(/1\.2\/2\.7 GB/i).length).toBeGreaterThan(0);
    expect(within(localDialog).getByRole("progressbar", { name: /downloading/i }).getAttribute("aria-valuenow")).toBe("44");

    await act(async () => {
      installDeferred.resolve(installManagedModel("drifty-qwen3-5-4b-default"));
      await installDeferred.promise;
    });
  });

  it("does not flash back to Ready when the install command returns a stale running status", async () => {
    setTauriRuntime();
    let managedStatus: ManagedLocalAiStatus = {
      state: "not_installed", selectedModelId: null, installedModels: [], baseUrl: null, model: null,
      message: "Choose a local model and Drifty will download it inside the app.",
      artifactDir: null, progress: null, errorKind: null, memoryUsageBytes: null,
    };
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          managedStatus = { ...installManagedModel(modelId), state: "installing", message: "Downloading..." };
          // The install command briefly reports a *different*, previously-loaded model as
          // running; this stale return must not clobber the optimistic "installing" state
          // (which would flash Continue back on mid-download).
          return Promise.resolve(runningManagedModel("drifty-qwen3-5-2b-economy"));
        }
        default:
          return Promise.resolve({});
      }
    });
    render(<App />);

    await chooseLocalAiSetup();
    const localDialog = await screen.findByRole("dialog", { name: /set up your local ai model/i });
    const defaultModel = within(localDialog).getByRole("article", { name: /qwen 3\.5 4b local ai model/i });
    await act(async () => {
      fireEvent.click(within(defaultModel).getByRole("button", { name: /^download$/i }));
    });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
    // Flush the resolved install command + the guarded status update.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // The stale different-model "running" must be ignored: the 4B row stays downloading
    // and the status row must not flash the ready state for the wrong model.
    expect(within(defaultModel).getByRole("button", { name: /^downloading/i })).toBeTruthy();
    expect(screen.queryByText(/model ready — classification runs entirely on this computer/i)).toBeNull();

    // The 500ms status poll that runs while installing can also return the stale
    // previously-loaded model as "running"; that too must not flash Ready.
    const statusCallsBeforeStalePoll = invokeMock.mock.calls.filter(([command]) => command === "managed_ai_status").length;
    managedStatus = runningManagedModel("drifty-qwen3-5-2b-economy");
    await waitFor(
      () => expect(invokeMock.mock.calls.filter(([command]) => command === "managed_ai_status").length).toBeGreaterThan(statusCallsBeforeStalePoll),
      { timeout: 2_000 },
    );
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(within(defaultModel).getByRole("button", { name: /^downloading/i })).toBeTruthy();
    expect(screen.queryByText(/model ready — classification runs entirely on this computer/i)).toBeNull();
  });

  it("shows a retry action when managed model download reports an error before the install command returns", async () => {
    setTauriRuntime();
    const installDeferred = createDeferred<ManagedLocalAiStatus>();
    let managedStatus: ManagedLocalAiStatus = {
      state: "not_installed",
      selectedModelId: null,
      installedModels: [],
      baseUrl: null,
      model: null,
      message: "Choose a local model and Drifty will download it inside the app.",
      artifactDir: null,
      progress: null,
      errorKind: null,
      memoryUsageBytes: null,
    };
    invokeMock.mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case "managed_ai_catalog":
          return Promise.resolve(managedCatalog);
        case "managed_ai_status":
          return Promise.resolve(managedStatus);
        case "managed_ai_install": {
          const modelId = modelIdFromArgs(args);
          managedStatus = {
            state: "error",
            selectedModelId: modelId,
            installedModels: [],
            baseUrl: "http://127.0.0.1:39217/v1",
            model: "drifty-qwen3.5-4b-local",
            message: "Managed local model files are missing. Download again when model assets are available.",
            artifactDir: null,
            progress: null,
            errorKind: "model_artifact_missing",
            memoryUsageBytes: null,
          };
          return installDeferred.promise;
        }
        default:
          return Promise.resolve({});
      }
    });
    render(<App />);

    await chooseLocalAiSetup();

    const localDialog = await screen.findByRole("dialog", { name: /set up your local ai model/i });
    const defaultModel = within(localDialog).getByRole("article", { name: /qwen 3\.5 4b local ai model/i });
    fireEvent.click(within(defaultModel).getByRole("button", { name: /^download$/i }));

    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("managed_ai_install", { modelId: "drifty-qwen3-5-4b-default" }));
    await waitFor(() => expect(within(defaultModel).getByRole("button", { name: /^retry$/i })).toBeTruthy(), { timeout: 2_000 });
    expect(within(defaultModel).queryByRole("button", { name: /^downloading…$/i })).toBeNull();
    expect(within(defaultModel).getByText(/managed local model files are missing/i)).toBeTruthy();

    await act(async () => {
      installDeferred.resolve(managedStatus);
      await installDeferred.promise;
    });
  });

  it("keeps connect-step blocked hints hidden until the user enters invalid provider details", async () => {
    render(<App />);

    await chooseByokSetup();

    expect(await screen.findByRole("dialog", { name: /add your openrouter key/i })).toBeTruthy();
    const testConnection = screen.getByRole("button", { name: /^test connection$/i });
    if (!(testConnection instanceof HTMLButtonElement)) throw new Error("Test connection action should be a button.");
    expect(testConnection.disabled).toBe(true);
    expect(screen.queryByText(/enter an openrouter key that starts with sk-or-/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/openrouter api key/i), { target: { value: "not-a-real-key" } });

    expect(screen.getByText(/openrouter key should start with sk-or-/i)).toBeTruthy();
    expect(screen.queryByText(/enter an openrouter key that starts with sk-or-/i)).toBeNull();
  });

  it("routes BYOK through OpenRouter key data handling review without exposing the raw key", async () => {
    render(<App />);

    await chooseByokSetup();

    expect(await screen.findByRole("dialog", { name: /add your openrouter key/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/openrouter api key/i), { target: { value: "sk-or-validkey1234" } });
    expect(screen.queryByLabelText(/server url/i)).toBeNull();
    await clickEnabledAction(/^test connection$/i);

    expect(await screen.findByRole("dialog", { name: /testing connection/i })).toBeTruthy();
    expect(screen.getByText(/openrouter key shape valid/i)).toBeTruthy();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("ai_classification_openai_chat", expect.objectContaining({
      request: expect.objectContaining({
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-or-validkey1234",
      }),
    })));
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /connection successful/i })).toBeTruthy();
    }, { timeout: 6000 });
    await clickEnabledAction(/^continue$/i);

    expect(await screen.findByRole("dialog", { name: /how your data is handled/i })).toBeTruthy();
    expect(screen.getByText(/masked openrouter key/i).textContent).toContain("1234");
    expect(screen.queryByText(/validkey1234/i)).toBeNull();
  }, 15_000);

  it("keeps BYOK onboarding blocked when the real OpenRouter connection test fails", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "ai_classification_openai_chat") {
        return Promise.resolve({ status: 401, body: "{\"error\":\"invalid key\"}", latencyMs: 31 });
      }
      if (command === "managed_ai_catalog") return Promise.resolve(managedCatalog);
      if (command === "managed_ai_status") return Promise.resolve({
        state: "not_installed",
        selectedModelId: null,
        installedModels: [],
        baseUrl: null,
        model: null,
        message: "",
        artifactDir: null,
        progress: null,
        errorKind: null,
        memoryUsageBytes: null,
      });
      return Promise.resolve({});
    });
    render(<App />);

    await chooseByokSetup();
    fireEvent.change(await screen.findByLabelText(/openrouter api key/i), { target: { value: "sk-or-invalidkey1234" } });
    await clickEnabledAction(/^test connection$/i);

    expect(await screen.findByRole("dialog", { name: /connection failed/i }, { timeout: 6_000 })).toBeTruthy();
    expect(screen.getByText(/openrouter rejected the api key/i)).toBeTruthy();
    const continueButton = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
  }, 15_000);

  it("stores a custom endpoint setup from onboarding after connection review", async () => {
    render(<App />);

    await chooseCustomEndpointSetup();

    expect(await screen.findByRole("dialog", { name: /add your custom endpoint/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/custom endpoint base url/i), { target: { value: "http://localhost:11434/v1" } });
    fireEvent.change(screen.getByLabelText(/custom endpoint model/i), { target: { value: "llama3.2:latest" } });
    await clickEnabledAction(/^test connection$/i);

    expect(await screen.findByRole("dialog", { name: /testing connection/i })).toBeTruthy();
    expect(screen.getByText(/endpoint url valid/i)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /connection successful/i })).toBeTruthy();
    }, { timeout: 6000 });
    await clickEnabledAction(/^continue$/i);

    expect(await screen.findByRole("dialog", { name: /how your data is handled/i })).toBeTruthy();
    expect(screen.getByText(/minimized classification context goes to your custom endpoint/i)).toBeTruthy();
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();
    await clickEnabledAction(/^continue$/i);
    fireEvent.click(await screen.findByRole("button", { name: FINAL_ONBOARDING_ACTION }));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("drifty.aiSetup.v1") ?? "{}")).toMatchObject({
        provider: "self_hosted",
        selfHostedBaseUrl: "http://localhost:11434/v1",
        selfHostedModel: "llama3.2:latest",
      });
    });
  }, 15_000);

  it("keeps custom endpoint drafts out of the saved AI setup until the connection test passes", async () => {
    render(<App />);

    await chooseCustomEndpointSetup();

    expect(await screen.findByRole("dialog", { name: /add your custom endpoint/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/custom endpoint base url/i), { target: { value: "http://draft-only:9999/v1" } });
    fireEvent.change(screen.getByLabelText(/custom endpoint model/i), { target: { value: "draft-model" } });

    // Typing alone must not flip the persisted provider or leak the draft endpoint.
    const persisted = JSON.parse(window.localStorage.getItem("drifty.aiSetup.v1") ?? "{}");
    expect(persisted.provider ?? null).not.toBe("self_hosted");
    expect(persisted.selfHostedBaseUrl ?? "").not.toBe("http://draft-only:9999/v1");
    expect(persisted.selfHostedModel ?? "").not.toBe("draft-model");
  }, 15_000);

  it("does not present unverified Screen Recording or Browser Activity as enabled", async () => {
    render(<App />);

    await advanceToPermissionsStep();
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();

    expect(screen.queryByText("Screen Recording")).toBeNull();
    expect(screen.queryByText("Browser Activity")).toBeNull();

    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /you're ready to go/i })).toBeTruthy();
    expect(screen.queryByText(/permissions enabled/i)).toBeNull();
    expect(screen.getByText(/tracking ready/i)).toBeTruthy();
  });

  it("does not show onboarding when local completion state already exists", async () => {
    window.localStorage.setItem(
      getUserOnboardingStorageKey("user-1"),
      JSON.stringify({
        version: 2,
        completed: true,
        displayName: "Alex",
        workType: "Design",
        workTypeOther: "",
        workDomain: "Tech",
        workDomainOther: "",
        focusGoalHours: null,
        driftThresholdMinutes: null,
        purpose: null,
        completedAt: "2026-05-08T00:00:00.000Z",
      }),
    );

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
  });

  it("opens the app on a saved sign-in the server could not confirm and reads cloud data once it is confirmed", async () => {
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.isSavedSignInPending = true;
    authState.cloudConnectionStatus = "offline";
    window.localStorage.setItem(
      getUserOnboardingStorageKey("user-1"),
      JSON.stringify({ version: 2, completed: true, completedAt: "2026-09-24T00:00:00.000Z" }),
    );

    const view = render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();
    // Reads that would only fail before the sign-in is confirmed wait for it.
    expect(fetchOwnProfile).not.toHaveBeenCalled();
    expect(vi.mocked(fetchFriendInvite)).not.toHaveBeenCalled();
    expect(billingMocks.fetchBillingEntitlement).not.toHaveBeenCalled();

    authState.isSavedSignInPending = false;
    authState.cloudConnectionStatus = "online";
    view.rerender(<App />);

    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(vi.mocked(fetchFriendInvite)).toHaveBeenCalled());
    await waitFor(() => expect(billingMocks.fetchBillingEntitlement).toHaveBeenCalled());
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
  });

  it("still opens onboarding for a saved account that has not finished it on this computer", async () => {
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.isSavedSignInPending = true;
    authState.cloudConnectionStatus = "offline";

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(within(screen.getByRole("status")).getByText(/account connected/i)).toBeTruthy();
    expect(fetchOwnProfile).not.toHaveBeenCalled();
  });

  it("retries an interrupted first-day Cloud import after app restart", async () => {
    window.localStorage.setItem(
      getUserOnboardingStorageKey("user-1"),
      JSON.stringify({ version: 2, completed: true, completedAt: "2026-09-24T00:00:00.000Z" }),
    );
    const marker = beginFirstDayCloudBacklog("user-1", "2026-09-24", true)!;
    releaseFirstDayCloudBacklog(marker.runId); // a new renderer has no live gate

    render(<App />);

    await waitFor(() => expect(trackerImportBrowserHistory).toHaveBeenCalledWith({ lookbackDays: 3 }));
    await waitFor(() => expect(readFirstDayCloudBacklog("user-1")?.importPending).toBe(false));
    expect(screen.queryByText(/getting your day ready/i)).toBeNull();
  }, 15_000);

  it("keeps completed onboarding hidden until Dev Settings replays it without clearing completion", async () => {
    const onboardingStorageKey = getUserOnboardingStorageKey("user-1");
    const completedOnboardingRecord = JSON.stringify({
      version: 2,
      completed: true,
      displayName: "Alex",
      workType: "Design",
      workTypeOther: "",
      workDomain: "Tech",
      workDomainOther: "",
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-05-08T00:00:00.000Z",
    });
    window.localStorage.setItem(onboardingStorageKey, completedOnboardingRecord);
    window.localStorage.setItem("drifty.dev.mode", "1");

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /^Settings$/ })).toBeTruthy();

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    fireEvent.click(within(settingsNav).getByRole("button", { name: /^Dev$/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /^Previews$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Open onboarding$/i }));

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(document.querySelector(".app-shell")).toBeNull();
    expect(document.querySelector(".onboarding-topbar")).toBeNull();
    expect(screen.queryByText("Force browser history URL fallback")).toBeNull();
    expect(window.localStorage.getItem(onboardingStorageKey)).toBe(completedOnboardingRecord);
  });

  it("replays the sidebar tutorial from Dev Settings without clearing onboarding completion", async () => {
    const onboardingStorageKey = getUserOnboardingStorageKey("user-1");
    const completedOnboardingRecord = JSON.stringify({
      version: 2,
      completed: true,
      displayName: "Alex",
      workType: "Design",
      workTypeOther: "",
      workDomain: "Tech",
      workDomainOther: "",
      focusGoalHours: null,
      driftThresholdMinutes: null,
      purpose: null,
      completedAt: "2026-05-08T00:00:00.000Z",
    });
    window.localStorage.setItem(onboardingStorageKey, completedOnboardingRecord);
    window.localStorage.setItem(
      postOnboardingSidebarGuideStorageKey("user-1"),
      JSON.stringify({
        version: 1,
        status: "completed",
        step: "account",
        startedAt: "2026-05-08T00:00:00.000Z",
        updatedAt: "2026-05-08T00:05:00.000Z",
      }),
    );
    window.localStorage.setItem("drifty.dev.mode", "1");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));
    const settingsNav = await screen.findByRole("navigation", { name: /settings sections/i });
    fireEvent.click(within(settingsNav).getByRole("button", { name: /^Dev$/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /^Previews$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Replay tutorial$/i }));

    expect(await screen.findByRole("dialog", { name: /^welcome to drifty$/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(document.querySelector(".cmd-overlay")).toBeNull();
    expect(screen.getByRole("dialog", { name: /^welcome to drifty$/i })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /^Settings$/ })).toBeNull();
    expect(parsePostOnboardingSidebarGuideRecord(
      window.localStorage.getItem(postOnboardingSidebarGuideStorageKey("user-1")),
    )).toMatchObject({ status: "active", step: "welcome" });
    expect(window.localStorage.getItem(onboardingStorageKey)).toBe(completedOnboardingRecord);
    fireEvent.click(screen.getByRole("button", { name: /^Show me around$/i }));
    expect(await screen.findByRole("dialog", { name: /where your day adds up/i })).toBeTruthy();
    for (const title of [/when drift runs long/i, /make labels fit your work/i, /still here in the menu bar/i, /your day starts adding up today/i]) {
      fireEvent.click(screen.getByRole("button", { name: /^Next$/i }));
      expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
      // The decision card holds During sessions until Next asks; Off walks on without a popup.
      if (title.source.startsWith("when drift")) fireEvent.click(screen.getByRole("radio", { name: /^off$/i }));
    }
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^See my day$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /your day starts adding up today/i })).toBeNull());
    expect(capturePostHogEvent).toHaveBeenCalledWith("onboarding_intro", expect.objectContaining({ action: "completed", step: "handoff", sequence: "sample" }));
    expect(capturePostHogEvent.mock.calls.filter(([event, properties]) => event === "onboarding_intro" && (properties as { action?: string }).action === "step_viewed")
      .map(([, properties]) => (properties as { step: string }).step)).toEqual(["welcome", "day", "account", "activity", "tracking", "handoff"]);
    expect(parsePostOnboardingSidebarGuideRecord(
      window.localStorage.getItem(postOnboardingSidebarGuideStorageKey("user-1")),
    )).toMatchObject({ status: "completed", step: "handoff" });
    expect(window.localStorage.getItem(onboardingStorageKey)).toBe(completedOnboardingRecord);
  });

  it("hides replay onboarding controls from Dev Settings when the replay dev tool is disabled", async () => {
    appFeatureSwitches.replayOnboardingDevToolEnabled = false;
    window.localStorage.setItem(
      getUserOnboardingStorageKey("user-1"),
      JSON.stringify({
        version: 2,
        completed: true,
        displayName: "Alex",
        workType: "Design",
        workTypeOther: "",
        workDomain: "Tech",
        workDomainOther: "",
        focusGoalHours: null,
        driftThresholdMinutes: null,
        purpose: null,
        completedAt: "2026-05-08T00:00:00.000Z",
      }),
    );
    window.localStorage.setItem("drifty.dev.mode", "1");

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /^Settings$/ })).toBeTruthy();

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    fireEvent.click(within(settingsNav).getByRole("button", { name: /^Dev$/i }));
    fireEvent.click(await screen.findByRole("tab", { name: /^Previews$/i }));

    expect(screen.queryByText(/^Replay onboarding$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open onboarding$/i })).toBeNull();
    expect(screen.queryByText(/^Replay tutorial$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Replay tutorial$/i })).toBeNull();
  });

  it("does not show local onboarding when local completion state already exists", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = false;
    window.localStorage.setItem(
      getUserOnboardingStorageKey("local"),
      JSON.stringify({
        version: 2,
        completed: true,
        displayName: "Local",
        workType: "Design",
        workTypeOther: "",
        workDomain: "Tech",
        workDomainOther: "",
        focusGoalHours: null,
        driftThresholdMinutes: null,
        purpose: null,
        completedAt: "2026-05-08T00:00:00.000Z",
      }),
    );

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
  });

  it("ignores legacy local completion when required auth needs an account", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;
    window.localStorage.setItem(
      getUserOnboardingStorageKey("local"),
      JSON.stringify({
        version: 2,
        completed: true,
        displayName: "Local",
        workType: "Design",
        workTypeOther: "",
        workDomain: "Tech",
        workDomainOther: "",
        focusGoalHours: null,
        driftThresholdMinutes: null,
        purpose: null,
        completedAt: "2026-05-08T00:00:00.000Z",
      }),
    );

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /local ai/i })).toBeNull();
  });
});
