// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TrackerStatus } from "@drifty/domain";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUserOnboardingStorageKey } from "./features/onboarding/OnboardingModal";

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
  openSystemSettingsPane,
  billingMocks,
  appFeatureSwitches,
} = vi.hoisted(() => ({
  authState: {
    user: { id: "user-1", email: "alex@example.com" } as { id: string; email: string } | null,
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
  openSystemSettingsPane: vi.fn(),
  billingMocks: {
    fetchBillingEntitlement: vi.fn().mockResolvedValue({ success: true, data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null } }),
    createIndividualCheckout: vi.fn().mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } }),
  },
  appFeatureSwitches: {
    devOnboardingBypassEnabled: false,
  },
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
  sendNotification: vi.fn(),
}));

vi.mock("./lib/api/systemSettingsClient", () => ({
  openSystemSettingsPane,
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
    getCurrentSnapshot: vi.fn().mockResolvedValue(null),
    getHourlySummary: trackerGetHourlySummary,
    getTopSites: vi.fn().mockResolvedValue([]),
    getAppIcons: vi.fn().mockResolvedValue({}),
    start: vi.fn(),
    stop: vi.fn(),
    updateTrayProductivityIcon: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("./features/billing/billingService", () => ({
  fetchBillingEntitlement: billingMocks.fetchBillingEntitlement,
  createIndividualCheckout: billingMocks.createIndividualCheckout,
}));

vi.mock("./appFeatureSwitches", () => ({
  DEV_ONBOARDING_BYPASS_ENABLED: false,
  isDevOnboardingBypassEnabled: () => appFeatureSwitches.devOnboardingBypassEnabled,
  WATCHER_PEEK_PROTOTYPE_ENABLED: true,
}));

import App from "./App";

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

async function clickEnabledAction(name: RegExp = /^next$/i) {
  const button = (await screen.findByRole("button", { name })) as HTMLButtonElement;
  await waitFor(() => {
    expect(button.disabled).toBe(false);
  });
  fireEvent.click(button);
}

async function clickEnabledNext() {
  await clickEnabledAction(/^next$/i);
}

async function settleAppStartupEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function chooseSimpleSetup() {
  await screen.findByRole("dialog", { name: /welcome to drifty/i });
  await clickEnabledNext();
  await screen.findByRole("dialog", { name: /choose your ai mode/i });
  fireEvent.click(screen.getByRole("button", { name: /drifty cloud/i }));
  await clickEnabledAction(/^continue$/i);
}

async function chooseLocalAiSetup() {
  await screen.findByRole("dialog", { name: /welcome to drifty/i });
  await clickEnabledNext();
  await screen.findByRole("dialog", { name: /choose your ai mode/i });
  fireEvent.click(screen.getByRole("button", { name: /local ai/i }));
  await clickEnabledAction(/^continue$/i);
}

async function chooseByokSetup() {
  await screen.findByRole("dialog", { name: /welcome to drifty/i });
  await clickEnabledNext();
  await screen.findByRole("dialog", { name: /choose your ai mode/i });
  fireEvent.click(screen.getByRole("button", { name: /byok \(bring your own key\)/i }));
  await clickEnabledAction(/^continue$/i);
}

async function connectAccount() {
  await screen.findByRole("dialog", { name: /connect your account/i });
  await clickEnabledNext();
}

async function chooseJobType(role = "Designer") {
  void role;
  await screen.findByRole("dialog", { name: /tell drifty about your work/i });
  await clickEnabledAction(/^continue$/i);
}

async function advanceToPermissionsStep() {
  await chooseSimpleSetup();
  await connectAccount();
  await chooseJobType();
}

async function advanceToReadyStep() {
  await advanceToPermissionsStep();
  await screen.findByRole("dialog", { name: /set up permissions/i });
  await clickEnabledNext();
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
    trackerGetHourlySummary.mockResolvedValue([]);
    openSystemSettingsPane.mockResolvedValue(true);
    fetchOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    saveOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchPublicProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null, data: null });
    optOutLeaderboard.mockResolvedValue({ success: true, error: null });
    appFeatureSwitches.devOnboardingBypassEnabled = false;
  });

  it("opens onboarding on the welcome step for an authenticated user without local completion", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^back$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^next$/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Alex Chen")).toBeNull();
  });

  it("matches the provided welcome and setup-choice design contract", async () => {
    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(await screen.findByText(/hey, i'm drifty!/i)).toBeTruthy();
    expect(await screen.findByText(/your ai time tracker/i)).toBeTruthy();

    await clickEnabledNext();

    expect(await screen.findByRole("dialog", { name: /choose your ai mode/i })).toBeTruthy();
    expect(screen.getByText(/choose the option that fits your privacy, setup, and cost preferences/i)).toBeTruthy();
    for (const selector of [
      ".onboarding-copy-column",
      ".onboarding-progress-bar",
      ".onboarding-middle",
      ".onboarding-viewport",
      ".onboarding-step",
      ".onb-actions",
    ]) {
      expect(document.querySelector(selector)).toBeTruthy();
    }
    const continueButton = screen.getByRole("button", { name: /^continue$/i }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    expect(screen.getByRole("button", { name: /drifty cloud/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /local ai/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /byok \(bring your own key\)/i })).toBeTruthy();
    expect(document.querySelector(".onboarding-flow-mark")).toBeTruthy();
    expect(document.querySelector(".onboarding-topbar")).toBeNull();
    expect(screen.queryByRole("dialog", { name: /choose your setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /use simple setup/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /set up my own server/i })).toBeNull();
  });

  it("opens the provided welcome-first onboarding for a local unauthenticated user without local completion state", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /choose your ai mode/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /drifty cloud/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /local ai/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /byok \(bring your own key\)/i })).toBeTruthy();
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
    authState.isEnabled = false;

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
    expect(await screen.findByRole("dialog", { name: /choose your ai mode/i })).toBeTruthy();
  });

  it("requires the real account callback before Drifty Cloud can continue", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = false;

    render(<App />);

    await chooseSimpleSetup();

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(await screen.findByRole("button", { name: /continue with email/i }));

    expect(authState.signInWithWebsite).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("lets an already authenticated account continue without starting sign-in again", async () => {
    render(<App />);

    await chooseSimpleSetup();

    expect(await screen.findByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /account connected/i }) as HTMLButtonElement).disabled).toBe(true);
    await clickEnabledNext();

    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog", { name: /tell drifty about your work/i })).toBeTruthy();
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

    await advanceToReadyStep();
    await screen.findByRole("dialog", { name: /you're ready to start/i });

    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to start/i })).toBeNull();
    });

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    expect(storedValue).toBeTruthy();
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.version).toBe(2);
    expect(storedRecord.completed).toBe(true);
    expect(storedRecord.displayName).toBe("alex");
    expect(storedRecord.jobType).toBeNull();
    expect(storedRecord.workType).toBeNull();
    expect(storedRecord.workDomain).toBeNull();
    expect(storedRecord.focusGoalHours).toBeNull();
    expect(storedRecord.driftThresholdMinutes).toBeNull();
    expect(typeof storedRecord.completedAt).toBe("string");
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("stores onboarding completion under the v2 drifty key and ignores the legacy keys", async () => {
    render(<App />);

    await advanceToReadyStep();
    fireEvent.click(await screen.findByRole("button", { name: /start tracking/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /you're ready to start/i })).toBeNull();
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
      expect(screen.getByRole("dialog", { name: /you're ready to start/i })).toBeTruthy();
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

  it("routes Local AI through server URL data handling review after a successful connection", async () => {
    render(<App />);

    await chooseLocalAiSetup();

    const serverDialog = await screen.findByRole("dialog", { name: /add your server url/i });
    fireEvent.change(within(serverDialog).getByRole("textbox", { name: /server url/i }), {
      target: { value: "http://localhost:3000" },
    });
    expect(screen.queryByLabelText(/openrouter api key/i)).toBeNull();
    await clickEnabledAction(/^continue$/i);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /review your data settings/i })).toBeTruthy();
    }, { timeout: 6000 });
    expect(screen.getByText(/http:\/\/localhost:3000 instead of drifty cloud/i)).toBeTruthy();

    await clickEnabledAction(/^continue$/i);
    expect(await screen.findByRole("dialog", { name: /tell drifty about your work/i })).toBeTruthy();
  });

  it("routes BYOK through OpenRouter key data handling review without exposing the raw key", async () => {
    render(<App />);

    await chooseByokSetup();

    expect(await screen.findByRole("dialog", { name: /add your openrouter key/i })).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/openrouter api key/i), { target: { value: "sk-or-validkey1234" } });
    expect(screen.queryByLabelText(/server url/i)).toBeNull();
    await clickEnabledAction(/^continue$/i);

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /review your data settings/i })).toBeTruthy();
    }, { timeout: 6000 });
    expect(screen.getByText(/openrouter using your key/i).textContent).toContain("1234");
    expect(screen.queryByText(/validkey1234/i)).toBeNull();
  });

  it("does not present unverified Screen Recording or Browser Activity as enabled", async () => {
    render(<App />);

    await advanceToPermissionsStep();
    expect(await screen.findByRole("dialog", { name: /set up permissions/i })).toBeTruthy();

    expect(screen.queryByText("Screen Recording")).toBeNull();
    expect(screen.queryByText("Browser Activity")).toBeNull();

    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /you're ready to start/i })).toBeTruthy();
    expect(screen.queryByText(/permissions enabled/i)).toBeNull();
    expect(screen.getByText(/tracking readiness verified/i)).toBeTruthy();
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
});
