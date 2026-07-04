// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TrackerStatus } from "@drifty/domain";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";
import type { ManagedLocalAiStatus } from "./features/settings/managedLocalAiClient";

const {
  authState,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  publishOwnFocusTotal,
  optOutLeaderboard,
  fetchOwnProfile,
  saveOwnProfile,
  fetchPublicProfile,
  isPermissionGranted,
  requestPermission,
  accessibilityGetStatus,
  accessibilityRequestAccess,
  trackerGetStatus,
  trackerGetHourlySummary,
  trackerPreviewBrowserHistoryImport,
  trackerImportBrowserHistory,
  openSystemSettingsPane,
  billingMocks,
  appFeatureSwitches,
  startupSettingsClient,
  tauriEventHandlers,
  invokeMock,
  sendNotificationMock,
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
  publishOwnFocusTotal: vi.fn(),
  optOutLeaderboard: vi.fn(),
  fetchOwnProfile: vi.fn(),
  saveOwnProfile: vi.fn(),
  fetchPublicProfile: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  accessibilityGetStatus: vi.fn(),
  accessibilityRequestAccess: vi.fn(),
  trackerGetStatus: vi.fn(),
  trackerGetHourlySummary: vi.fn(),
  trackerPreviewBrowserHistoryImport: vi.fn(),
  trackerImportBrowserHistory: vi.fn(),
  openSystemSettingsPane: vi.fn(),
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
    createBillingPortalSession: vi.fn().mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } }),
  },
  appFeatureSwitches: {
    devOnboardingBypassEnabled: false,
    devOnboardingAuthBypassEnabled: false,
    replayOnboardingDevToolEnabled: true,
  },
  startupSettingsClient: {
    isAvailable: vi.fn(),
    setOpenAtLoginEnabled: vi.fn(),
  },
  tauriEventHandlers: new Map<string, MockTauriEventHandler[]>(),
  invokeMock: vi.fn(),
  sendNotificationMock: vi.fn(),
}));

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
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
}));

vi.mock("./lib/api/startupSettingsClient", () => ({
  startupSettingsClient,
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
    getTopSites: vi.fn().mockResolvedValue([]),
    getAppIcons: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn().mockResolvedValue(undefined),
    previewBrowserHistoryImport: trackerPreviewBrowserHistoryImport,
    importBrowserHistory: trackerImportBrowserHistory,
  },
}));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
  createBillingPortalSession: billingMocks.createBillingPortalSession,
}));

vi.mock("./appFeatureSwitches", () => ({
  AI_UNAVAILABLE_CASE_PREVIEWS_ENABLED: true,
  DEMO_DASHBOARD_REPLAY_DEV_TOOL_ENABLED: false,
  DEV_ONBOARDING_BYPASS_ENABLED: false,
  get DEV_ONBOARDING_AUTH_BYPASS_ENABLED() {
    return appFeatureSwitches.devOnboardingAuthBypassEnabled;
  },
  DEV_SETTINGS_ENABLED: true,
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: true,
  DRIFT_ALARM_PANEL_PREVIEWS_ENABLED: true,
  END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: true,
  END_OF_DAY_REVIEW_NOTIFICATIONS_ENABLED: false,
  IS_PRODUCTION_BUILD: false,
  ONBOARDING_V2_2_PREVIEW_ENABLED: false,
  RELEASE_CHANNEL: "dev",
  TEAMS_BETA_ENABLED: true,
  get REPLAY_ONBOARDING_DEV_TOOL_ENABLED() {
    return appFeatureSwitches.replayOnboardingDevToolEnabled;
  },
  WATCHER_PEEK_PROTOTYPE_ENABLED: true,
  isDevOnboardingBypassEnabled: () => appFeatureSwitches.devOnboardingBypassEnabled,
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
  { id: "drifty-qwen3-5-2b-economy", tier: "economy", label: "Qwen 3.5 2B", detail: "Small local model.", downloadSize: "~1.4 GB", diskRequired: "3 GB free", minimumMemory: "8 GB RAM", recommended: false },
  { id: "drifty-qwen3-5-4b-default", tier: "default", label: "Qwen 3.5 4B", detail: "Recommended local model.", downloadSize: "~2.8 GB", diskRequired: "6 GB free", minimumMemory: "16 GB RAM", recommended: true },
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
  const activityInput = screen.getByLabelText(/search activities/i);
  if (!(activityInput instanceof HTMLInputElement)) {
    throw new Error("Activity combobox input was not rendered");
  }
  fireEvent.focus(activityInput);
  fireEvent.change(activityInput, { target: { value: option } });
  fireEvent.keyDown(activityInput, { key: "Enter", code: "Enter" });
}

function selectWorkDomain(option: string) {
  const domainInput = screen.getByLabelText(/your field/i);
  if (!(domainInput instanceof HTMLInputElement)) {
    throw new Error("Domain combobox input was not rendered");
  }
  fireEvent.focus(domainInput);
  fireEvent.change(domainInput, { target: { value: option } });
  fireEvent.keyDown(domainInput, { key: "Enter", code: "Enter" });
}

async function waitForConnectedAccountAutoAdvance() {
  await screen.findByRole("dialog", { name: /connect your account/i }, { timeout: 6_000 });
  expect((screen.getByRole("button", { name: /account connected/i }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
  await screen.findByRole("dialog", { name: /what do you usually do/i }, { timeout: 6_000 });
}

async function advanceThroughSharedBasics(options: { activity?: string } = {}) {
  await screen.findByRole("dialog", { name: /welcome to drifty/i }, { timeout: 6_000 });
  await clickEnabledNext();
  await waitForConnectedAccountAutoAdvance();
  if (options.activity) selectMainActivity(options.activity);
  await clickEnabledAction(/^continue$/i);
  await screen.findByRole("dialog", { name: /set up permissions/i }, { timeout: 6_000 });
  await clickEnabledNext();
  await screen.findByRole("dialog", { name: /set up drift alerts/i }, { timeout: 6_000 });
  await clickEnabledAction(/^continue$/i);
  await screen.findByRole("dialog", { name: /choose your setup/i }, { timeout: 6_000 });
}

async function chooseSimpleSetup(options: { activity?: string } = {}) {
  await advanceThroughSharedBasics(options);
  fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
  await clickEnabledAction(/^continue$/i);
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
  await screen.findByRole("dialog", { name: /welcome to drifty/i });
  await clickEnabledNext();
  await waitForConnectedAccountAutoAdvance();
  await clickEnabledAction(/^continue$/i);
}

async function advanceToReadyStep(options: { activity?: string } = {}) {
  await chooseSimpleSetup(options);
}

describe("App onboarding", () => {
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
    authState.signInWithWebsite.mockResolvedValue({ error: null });
    authState.signInWithGoogle.mockResolvedValue({ error: null });
    authState.signInWithEmail.mockResolvedValue({ error: null });
    authState.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    window.localStorage.clear();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      running: false,
      accessibilityGranted: false,
      trackerMode: "unavailable",
      message: "Tracker not available in this environment",
    }));
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    accessibilityGetStatus.mockResolvedValue({ granted: false });
    accessibilityRequestAccess.mockResolvedValue({ granted: false });
    startupSettingsClient.isAvailable.mockReturnValue(false);
    startupSettingsClient.setOpenAtLoginEnabled.mockResolvedValue({
      success: true,
      enabled: true,
      status: "enabled",
      backend: "smAppService",
    });
    configureManagedAiMocks();
    trackerGetHourlySummary.mockResolvedValue([]);
    trackerPreviewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 2,
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
    trackerImportBrowserHistory.mockResolvedValue({
      lookbackDays: 2,
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
    appFeatureSwitches.replayOnboardingDevToolEnabled = true;
  });

  it("opens onboarding on the welcome step for an authenticated user without local completion", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^continue$/i })).toBeTruthy();
    expect(document.querySelector(".onb-actions__dots")).toBeNull();
    expect(screen.queryByPlaceholderText("Alex Chen")).toBeNull();
  });

  it("matches the provided welcome and setup-choice design contract", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(await screen.findByText(/welcome to drifty\./i, undefined, { timeout: 6_000 })).toBeTruthy();
    expect(await screen.findByText(/your ai time tracker/i, undefined, { timeout: 6_000 })).toBeTruthy();
    expect(document.querySelector(".dc-onb-welcome__icon")).toBeTruthy();
    expect(screen.queryByText(/about a minute/i)).toBeNull();

    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /account connected/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();

    expect(await screen.findByRole("dialog", { name: /what do you usually do/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /what do you usually work on\?/i })).toBeTruthy();
    expect(screen.getByLabelText(/search activities/i, { selector: "input" })).toBeTruthy();
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

    selectMainActivity("Writing");
    selectWorkDomain("Tech");
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();
    expect(screen.queryByText("Screen Recording")).toBeNull();
    expect(screen.queryByText("Browser Activity")).toBeNull();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /set up drift alerts/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /drift alarm/i }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: /extreme nudge/i }).getAttribute("aria-pressed")).toBe("false");
    await clickEnabledAction(/^continue$/i);

    expect(await screen.findByRole("dialog", { name: /choose your setup/i })).toBeTruthy();
    const continueButton = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(false);
    expect(screen.getByRole("button", { name: /drifty cloud/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /local ai/i })).toBeTruthy();
    // Advanced providers (BYOK / custom endpoint) live behind a disclosure.
    expect(screen.queryByRole("button", { name: /bring your own key/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /connect your own ai provider/i }));
    expect(screen.getByRole("button", { name: /bring your own key/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /custom endpoint/i })).toBeTruthy();
    expect(screen.getByText(/point drifty at any openai-compatible endpoint/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /use simple setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set up my own server/i })).toBeNull();
  }, 15_000);

  it("opens the provided welcome-first onboarding for a local unauthenticated user without local completion state", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /drifty cloud/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /local ai/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /byok \(bring your own key\)/i })).toBeNull();
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

    expect(await screen.findByRole("dialog", { name: /what do you usually do/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /connect your account/i })).toBeNull();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it("bypasses onboarding for an authenticated dev startup without storing completion", async () => {
    appFeatureSwitches.devOnboardingBypassEnabled = true;

    render(<App />);

    expect(await screen.findByRole("navigation", { name: /primary navigation/i })).toBeTruthy();
    await waitFor(() => expect(fetchOwnProfile).toHaveBeenCalledTimes(1));
    await settleAppStartupEffects();
    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();
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

  it("opens the provided welcome-first onboarding in required auth mode without a signed-in user", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /drifty cloud/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /local ai/i })).toBeNull();
  });

  it("opens website sign-in from onboarding email continuation", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = true;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));

    await waitFor(() => {
      expect(authState.signInWithWebsite).toHaveBeenCalledTimes(1);
    });
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(authState.signInWithEmail).not.toHaveBeenCalled();
    expect(authState.signUpWithEmail).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: /sign in to drifty/i })).toBeNull();
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("opens website sign-in from required account onboarding without exposing the app shell", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));

    await waitFor(() => {
      expect(authState.signInWithWebsite).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("dialog", { name: /sign in to drifty/i })).toBeNull();
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: /primary navigation/i })).toBeNull();
  });

  it("starts direct Google OAuth from the onboarding Google button", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    const googleButton = await screen.findByRole("button", { name: /continue with google/i });

    expect(googleButton.querySelector(".onb-google-mark svg")).toBeTruthy();

    fireEvent.click(googleButton);

    expect(authState.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("lets an already authenticated account continue without starting sign-in again", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /account connected/i }) as HTMLButtonElement).disabled).toBe(true);

    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: /what do you usually do/i })).toBeTruthy();
  });

  it("treats an email-less non-anonymous account as connected", async () => {
    authState.user = { id: "user-1", email: null };
    authState.status = "authenticated";
    authState.hasRequiredAccountAuth = true;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /account connected/i }) as HTMLButtonElement).disabled).toBe(true);

    expect(await screen.findByRole("dialog", { name: /what do you usually do/i })).toBeTruthy();
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

    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();

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

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Alex Chen")).toBeNull();
  });

  it("stores v2 onboarding state and hides the modal after completion", async () => {
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    await screen.findByRole("dialog", { name: /you're ready to go/i });

    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    expect(storedValue).toBeTruthy();
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.version).toBe(2);
    expect(storedRecord.completed).toBe(true);
    expect(storedRecord.displayName).toBe("alex");
    expect(storedRecord.jobType).toBe("Coding");
    expect(storedRecord.workType).toBe("Coding");
    expect(storedRecord.workDomain).toBeNull();
    expect(storedRecord.driftAlarmEnabled).toBe(false);
    expect(storedRecord.extremeNudgeEnabled).toBe(false);
    expect(storedRecord.browserHistoryBootstrapEnabled).toBe(true);
    expect(storedRecord.focusGoalHours).toBeNull();
    expect(storedRecord.driftThresholdMinutes).toBeNull();
    expect(typeof storedRecord.completedAt).toBe("string");
    expect(saveOwnProfile).not.toHaveBeenCalled();
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

    expect(within(readyDialog).getByText(/drifty cloud selected/i)).toBeTruthy();
    expect(within(readyDialog).getByText(/7-day free trial started/i)).toBeTruthy();
    expect(within(readyDialog).getByText(/your drifty cloud trial is ready/i)).toBeTruthy();

    fireEvent.click(within(readyDialog).getByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });
    expect(screen.queryByRole("status", { name: /drifty cloud trial started/i })).toBeNull();
  });

  it("stores selected drift alarm and extreme nudge preferences from onboarding", async () => {
    render(<App />);

    await screen.findByRole("dialog", { name: /welcome to drifty/i });
    await clickEnabledNext();
    await waitForConnectedAccountAutoAdvance();
    await clickEnabledAction(/^continue$/i);
    await screen.findByRole("dialog", { name: /set up permissions/i });
    await clickEnabledNext();
    await screen.findByRole("dialog", { name: /set up drift alerts/i });

    const driftAlarmToggle = screen.getByRole("button", { name: "Drift alarm" });
    const extremeNudgeToggle = screen.getByRole("button", { name: "Extreme nudge" });
    fireEvent.click(extremeNudgeToggle);
    const confirmDialog = await screen.findByRole("alertdialog", { name: /let drifty close drift/i });
    expect(confirmDialog.textContent).toContain("close the distracting browser tab or quit the distracting app");
    expect(driftAlarmToggle.getAttribute("aria-pressed")).toBe("false");
    expect(extremeNudgeToggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: /keep off/i }));
    expect(screen.queryByRole("alertdialog", { name: /let drifty close drift/i })).toBeNull();
    expect(driftAlarmToggle.getAttribute("aria-pressed")).toBe("false");
    expect(extremeNudgeToggle.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(extremeNudgeToggle);
    fireEvent.click(await screen.findByRole("button", { name: /allow closing/i }));
    expect(screen.queryByRole("alertdialog", { name: /let drifty close drift/i })).toBeNull();
    expect(driftAlarmToggle.getAttribute("aria-pressed")).toBe("true");
    expect(extremeNudgeToggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByText(/can close distracting tabs or apps/i)).toBeNull();
    await clickEnabledAction(/^continue$/i);
    fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
    await clickEnabledAction(/^continue$/i);

    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.driftAlarmEnabled).toBe(true);
    expect(storedRecord.extremeNudgeEnabled).toBe(true);
    expect(window.localStorage.getItem("drifty.notifications.driftAlerts")).toBe("1");
    expect(window.localStorage.getItem("drifty.notifications.extremeNudge")).toBe("1");
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
      fireEvent.click(within(readyDialog).getByRole("button", { name: /start tracking/i }));

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
      fireEvent.click(within(readyDialog).getByRole("button", { name: /start tracking/i }));

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

  it("lets users opt out of the recent history first-dashboard bootstrap", async () => {
    render(<App />);

    await advanceToReadyStep({ activity: "Coding" });
    const readyDialog = await screen.findByRole("dialog", { name: /you're ready to go/i });
    const browserHistoryCheckbox = within(readyDialog).getByRole("checkbox", {
      name: /import from browser history \(last 48 hours\)/i,
    });

    expect((browserHistoryCheckbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(browserHistoryCheckbox);
    expect((browserHistoryCheckbox as HTMLInputElement).checked).toBe(false);

    fireEvent.click(within(readyDialog).getByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    });

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.browserHistoryBootstrapEnabled).toBe(false);
  }, 15_000);

  it("prepares the first day before revealing the dashboard when browser history import stays enabled", async () => {
    trackerPreviewBrowserHistoryImport.mockResolvedValue({
      lookbackDays: 2,
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
              lookbackDays: 2,
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
    fireEvent.click(within(readyDialog).getByRole("button", { name: /start tracking/i }));

    // The dashboard is gated behind the preparation screen while the 48h import runs.
    expect(await screen.findByText(/getting your day ready/i)).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /you're ready to go/i })).toBeNull();
    await waitFor(() => expect(trackerPreviewBrowserHistoryImport).toHaveBeenCalledWith({ lookbackDays: 2 }));
    await waitFor(() => expect(trackerImportBrowserHistory).toHaveBeenCalledWith({ lookbackDays: 2 }));

    // Only once preparation settles does the dashboard appear.
    resolveImport();
    await waitFor(() => expect(screen.queryByText(/getting your day ready/i)).toBeNull());
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
      fireEvent.click(within(readyDialog).getByRole("button", { name: /start tracking/i }));

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
    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

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
    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();
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
      fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

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

      expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it("does not expose a skip control or write completion without finishing", async () => {
    render(<App />);

    await screen.findByRole("dialog", { name: /welcome to drifty/i });
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

    render(<App />);

    await advanceToPermissionsStep();
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: /^enable$/i })[0]);

    await waitFor(() => {
      expect(accessibilityRequestAccess).toHaveBeenCalled();
    });
    expect(openSystemSettingsPane).not.toHaveBeenCalledWith("accessibility");
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
    expect(within(localDialog).getByText(/managed local ai runtime is running/i)).toBeTruthy();
    expect(within(localDialog).queryByText(/looking for downloaded local models/i)).toBeNull();

    await act(async () => {
      statusDeferred.resolve(readyStatus);
      await statusDeferred.promise;
    });
  });

  it("blocks Local AI onboarding until the managed model download completes, then applies the model", async () => {
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
    expect(within(defaultModel).getByRole("button", { name: /^downloading\.\.\.$/i })).toBeTruthy();
    await waitFor(() => expect(within(defaultModel).getByRole("button", { name: /^downloading 44%$/i })).toBeTruthy(), { timeout: 2_000 });
    await waitFor(() => {
      const statusPollCount = invokeMock.mock.calls.filter(([command]) => command === "managed_ai_status").length;
      expect(statusPollCount).toBeGreaterThan(statusPollCountBeforeDownload);
    }, { timeout: 2_000 });
    expect(within(localDialog).getAllByText(/1\.2\/2\.7 GB/i).length).toBeGreaterThan(0);
    expect(within(localDialog).queryByRole("button", { name: /^downloading 42%$/i })).toBeNull();

    // The user must not advance while the managed model is still downloading — the
    // first-day preparation gate that follows depends on the model being ready.
    const continueDuringDownload = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    expect(continueDuringDownload.disabled).toBe(true);

    // Complete the download; only then can onboarding continue.
    const completedStatus = installManagedModel("drifty-qwen3-5-4b-default");
    managedStatus = completedStatus;
    installDeferred.resolve(completedStatus);

    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /how your data is handled/i })).toBeTruthy();
    expect(screen.getByText(/activity goes to the selected local model on this mac, not to drifty cloud/i)).toBeTruthy();

    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /you're ready to start/i })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to start/i })).toBeNull();
    });

    await waitFor(() => {
      expect(sendNotificationMock).toHaveBeenCalledWith({
        title: "Local AI model ready",
        body: "Qwen 3.5 4B is ready for private classification.",
      });
    });
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("drifty.aiSetup.v1") ?? "{}")).toMatchObject({
        provider: "managed_local",
        driftyRoute: "local",
        managedLocalModelId: "drifty-qwen3-5-4b-default",
        managedLocalBaseUrl: "http://127.0.0.1:39217/v1",
        managedLocalModel: "drifty-qwen3.5-4b-local",
      });
    });
  });

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

    await waitFor(() => expect(within(localDialog).getByText(/managed local ai runtime is running/i)).toBeTruthy());
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

    expect(within(defaultModel).getByRole("button", { name: /^downloading 44%$/i })).toBeTruthy();
    expect(within(localDialog).getAllByText(/1\.2\/2\.7 GB/i).length).toBeGreaterThan(0);

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
    // and Continue stays blocked (no flash back to a ready state).
    expect(within(defaultModel).getByRole("button", { name: /^downloading/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement).disabled).toBe(true);
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
    expect(within(defaultModel).queryByRole("button", { name: /^downloading\.\.\.$/i })).toBeNull();
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
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /connection successful/i })).toBeTruthy();
    }, { timeout: 6000 });
    await clickEnabledAction(/^continue$/i);

    expect(await screen.findByRole("dialog", { name: /how your data is handled/i })).toBeTruthy();
    expect(screen.getByText(/masked openrouter key/i).textContent).toContain("1234");
    expect(screen.queryByText(/validkey1234/i)).toBeNull();
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
    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem("drifty.aiSetup.v1") ?? "{}")).toMatchObject({
        provider: "self_hosted",
        selfHostedBaseUrl: "http://localhost:11434/v1",
        selfHostedModel: "llama3.2:latest",
      });
    });
  }, 15_000);

  it("does not present unverified Screen Recording or Browser Activity as enabled", async () => {
    render(<App />);

    await advanceToPermissionsStep();
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();

    expect(screen.queryByText("Screen Recording")).toBeNull();
    expect(screen.queryByText("Browser Activity")).toBeNull();

    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /set up drift alerts/i })).toBeTruthy();
    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /choose your setup/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
    await clickEnabledAction(/^continue$/i);
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
    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();
  });

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
    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();

    fireEvent.click(await screen.findByRole("button", { name: /^alex$/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^settings$/i }));
    expect(await screen.findByRole("heading", { name: /^Settings$/ })).toBeTruthy();

    const settingsNav = screen.getByRole("navigation", { name: /settings sections/i });
    fireEvent.click(within(settingsNav).getByRole("button", { name: /^Dev$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Open onboarding$/i }));

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(document.querySelector(".app-shell")).toBeNull();
    expect(document.querySelector(".onboarding-topbar")).toBeNull();
    expect(screen.queryByText("Force browser history URL fallback")).toBeNull();
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

    expect(screen.queryByText(/^Replay onboarding$/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Open onboarding$/i })).toBeNull();
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
    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();
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

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /local ai/i })).toBeNull();
  });
});
