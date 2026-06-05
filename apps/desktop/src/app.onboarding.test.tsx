// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TrackerStatus } from "@dtime/domain";
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

async function clickEnabledNext() {
  const nextButton = (await screen.findByRole("button", { name: /^next$/i })) as HTMLButtonElement;
  await waitFor(() => {
    expect(nextButton.disabled).toBe(false);
  });
  fireEvent.click(nextButton);
}

async function settleAppStartupEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function chooseWorkProfile(role: string, field: string) {
  const roleTrigger = screen.getByRole("combobox", { name: /your role/i });
  fireEvent.click(roleTrigger);
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${role}$`, "i") }));
  const fieldTrigger = screen.getByRole("combobox", { name: /your field/i });
  fireEvent.click(fieldTrigger);
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^${field}$`, "i") }));
}

async function advanceThroughIntake() {
  await screen.findByRole("dialog", { name: /(nice to meet you|welcome to drifty)/i });
  await clickEnabledNext(); // → work_profile
  await screen.findByRole("dialog", { name: /tell us about your work/i });
  await chooseWorkProfile("Design", "Tech");
  await clickEnabledNext();
}

async function advanceToAccessibilityStep() {
  await advanceThroughIntake();
  await screen.findByRole("dialog", { name: /start your local timeline/i });
  await clickEnabledNext(); // → accessibility
}

async function advanceToNotificationsStep() {
  await advanceToAccessibilityStep();
  await clickEnabledNext(); // → notifications
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

  it("opens trial-first onboarding for a local unauthenticated user without local completion state", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /choose how you want to start/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /start drifty cloud trial/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /use my own ai setup/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue local-only without ai/i })).toBeTruthy();
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

  it("opens trial-first onboarding in required auth mode without a signed-in user", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = false;

    render(<App />);

    expect(await screen.findByRole("dialog", { name: /choose how you want to start/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /continue local-only without ai/i })).toBeTruthy();
  });

  it("continues local-only onboarding without signing in", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = false;

    render(<App />);

    expect(await screen.findByText(/drifty cloud and your own ai setup stay available later in settings/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /continue local-only without ai/i }));

    expect(await screen.findByRole("dialog", { name: /welcome to drifty/i })).toBeTruthy();
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
  });

  it("starts the Drifty Cloud trial path from local onboarding", async () => {
    authState.user = null;
    authState.status = "unauthenticated";
    authState.isEnabled = false;

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: /start drifty cloud trial/i }));

    await waitFor(() => expect(authState.signInWithWebsite).toHaveBeenCalledTimes(1));
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

    await advanceToNotificationsStep();
    await screen.findByRole("dialog", { name: /allow notifications/i });

    fireEvent.click(await screen.findByRole("button", { name: /finish setup/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /allow notifications/i })).toBeNull();
    });

    const storedValue = window.localStorage.getItem(getUserOnboardingStorageKey("user-1"));
    expect(storedValue).toBeTruthy();
    const storedRecord = JSON.parse(storedValue ?? "{}") as Record<string, unknown>;
    expect(storedRecord.version).toBe(2);
    expect(storedRecord.completed).toBe(true);
    expect(storedRecord.displayName).toBe("");
    expect(storedRecord.workType).toBe("Design");
    expect(storedRecord.workDomain).toBe("Tech");
    expect(storedRecord.focusGoalHours).toBeNull();
    expect(storedRecord.driftThresholdMinutes).toBeNull();
    expect(typeof storedRecord.completedAt).toBe("string");
    expect(saveOwnProfile).not.toHaveBeenCalled();
  });

  it("stores onboarding completion under the v2 drifty key and ignores the legacy keys", async () => {
    render(<App />);

    await advanceToNotificationsStep();
    fireEvent.click(await screen.findByRole("button", { name: /finish setup/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /allow notifications/i })).toBeNull();
    });

    expect(getUserOnboardingStorageKey("user-1")).toBe("drifty:onboarding:v2:user-1");
    expect(window.localStorage.getItem("drifty:onboarding:v2:user-1")).toBeTruthy();
    expect(window.localStorage.getItem("drifty:onboarding:v1:user-1")).toBeNull();
    expect(window.localStorage.getItem("dtime:onboarding:v1:user-1")).toBeNull();
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

  it("uses the legacy dtime onboarding record as a migration fallback", async () => {
    window.localStorage.setItem(
      "dtime:onboarding:v1:user-1",
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

      await advanceToNotificationsStep();
      fireEvent.click(await screen.findByRole("button", { name: /finish setup/i }));

      const storageError = await screen.findByRole("alert");
      expect(storageError.textContent).toMatch(/unable to save setup locally/i);
      expect(screen.getByRole("dialog", { name: /allow notifications/i })).toBeTruthy();
      expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
      expect(saveOwnProfile).not.toHaveBeenCalled();
    } finally {
      setItemSpy.mockRestore();
    }
  });

  it("does not crash when local completion cannot be read", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation((key) => {
      if (String(key).startsWith("drifty:onboarding:") || String(key).startsWith("dtime:onboarding:")) {
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

  it("enables drift alerts when notification permission is granted during onboarding", async () => {
    setTauriRuntime();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus());
    accessibilityGetStatus.mockResolvedValue({ granted: true });
    requestPermission.mockResolvedValueOnce("granted");

    render(<App />);

    await advanceToNotificationsStep();
    expect(await screen.findByRole("dialog", { name: /allow notifications/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /request permission/i }));

    await waitFor(() => {
      expect(window.localStorage.getItem("drifty.notifications.driftAlerts")).toBe("1");
    });
    expect((screen.getByRole("button", { name: /notifications ready/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("requires notification permission before finishing setup in the desktop app", async () => {
    setTauriRuntime();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus());
    accessibilityGetStatus.mockResolvedValue({ granted: true });
    requestPermission.mockResolvedValueOnce("denied");

    render(<App />);

    await advanceToNotificationsStep();
    expect(await screen.findByRole("dialog", { name: /allow notifications/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /open notification settings/i })).toBeNull();

    const finishButton = screen.getByRole("button", { name: /finish setup/i }) as HTMLButtonElement;
    expect(finishButton.disabled).toBe(true);
    expect(screen.getByText(/allow notifications to finish setup/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /request permission/i }));

    expect(await screen.findByRole("button", { name: /open notification settings/i })).toBeTruthy();
    expect((screen.getByRole("button", { name: /finish setup/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
  });

  it("allows going back from notifications to accessibility after auto-detecting a grant", async () => {
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));

    render(<App />);

    await advanceToAccessibilityStep();
    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    await waitFor(() => {
      expect(trackerGetHourlySummary).toHaveBeenCalledTimes(2);
    });
    trackerGetHourlySummary.mockClear();

    accessibilityGetStatus.mockResolvedValue({ granted: true });
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    expect(await screen.findByText(/detected automatically/i)).toBeTruthy();
    expect(screen.getByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    await clickEnabledNext();
    expect(await screen.findByRole("dialog", { name: /allow notifications/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));

    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /allow notifications/i })).toBeNull();
    });
  });

  it("updates Accessibility status even if a dashboard refresh request fails", async () => {
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));

    render(<App />);

    await advanceToAccessibilityStep();
    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    await waitFor(() => {
      expect(trackerGetHourlySummary).toHaveBeenCalledTimes(2);
    });
    trackerGetHourlySummary.mockClear();

    accessibilityGetStatus.mockResolvedValue({ granted: true });
    trackerGetHourlySummary.mockRejectedValueOnce(new Error("hourly summary failed"));
    fireEvent.click(screen.getByRole("button", { name: /check again/i }));

    expect(await screen.findByText(/detected automatically/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^next$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(accessibilityGetStatus).toHaveBeenCalled();
    expect(trackerGetHourlySummary).not.toHaveBeenCalledWith(expect.objectContaining({ day: expect.any(String) }));
  });

  it("requests Accessibility access through the macOS prompt without direct guide UI", async () => {
    setTauriRuntime();
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));

    render(<App />);

    await advanceToAccessibilityStep();
    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    expect(screen.getByRole("list", { name: /accessibility permission steps/i })).toBeTruthy();
    expect(screen.getByText(/this lets drifty understand/i)).toBeTruthy();
    expect(screen.queryByText(/terminal or tauri runner/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /open accessibility settings/i }));

    await waitFor(() => {
      expect(accessibilityRequestAccess).toHaveBeenCalled();
    });
    expect(openSystemSettingsPane).not.toHaveBeenCalledWith("accessibility");
    expect(screen.getByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
  });

  it("keeps onboarding open when the same authenticated user refreshes while requesting Accessibility", async () => {
    setTauriRuntime();
    authState.authMode = "required";
    authState.isAuthRequired = true;
    authState.allowsAnonymousAuth = false;
    authState.hasRequiredAccountAuth = true;
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({
      accessibilityGranted: false,
    }));

    render(<App />);

    await advanceToAccessibilityStep();
    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();

    authState.user = { id: "user-1", email: "alex@example.com" };
    fireEvent.click(screen.getByRole("button", { name: /open accessibility settings/i }));

    await waitFor(() => {
      expect(accessibilityRequestAccess).toHaveBeenCalled();
    });
    expect(screen.getByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
  });

  it("rechecks Accessibility after entering the step instead of trusting stale granted status", async () => {
    setTauriRuntime();
    trackerGetStatus
      .mockResolvedValueOnce(makeTrackerStatus())
      .mockResolvedValue(makeTrackerStatus({ accessibilityGranted: false }));

    render(<App />);

    await advanceToAccessibilityStep();
    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    expect(await screen.findByRole("list", { name: /accessibility permission steps/i })).toBeTruthy();
    const nextButton = screen.getByRole("button", { name: /^next$/i }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
    fireEvent.click(nextButton);

    expect(screen.queryByRole("dialog", { name: /allow notifications/i })).toBeNull();
  });

  it("does not treat tracker unavailable as Accessibility ready in the desktop app", async () => {
    setTauriRuntime();

    render(<App />);

    await advanceToAccessibilityStep();
    expect(await screen.findByRole("dialog", { name: /enable accessibility/i })).toBeTruthy();
    expect(screen.getByRole("list", { name: /accessibility permission steps/i })).toBeTruthy();

    const nextButton = screen.getByRole("button", { name: /^next$/i }) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
    fireEvent.click(nextButton);

    expect(screen.queryByRole("dialog", { name: /allow notifications/i })).toBeNull();
    expect(window.localStorage.getItem(getUserOnboardingStorageKey("user-1"))).toBeNull();
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

// Keep `within` referenced in case future helpers use it; vitest is strict about unused imports.
void within;
