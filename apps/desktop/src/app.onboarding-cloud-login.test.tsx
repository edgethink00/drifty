// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TrackerStatus } from "@drifty/domain";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  fetchOwnProfile,
  fetchPublicProfile,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  publishOwnFocusTotal,
  optOutLeaderboard,
  trackerGetStatus,
  trackerGetHourlySummary,
  isPermissionGranted,
  requestPermission,
  accessibilityGetStatus,
  accessibilityRequestAccess,
  openSystemSettingsPane,
  billingMocks,
  appFeatureSwitches,
} = vi.hoisted(() => ({
  authState: {
    user: null as { readonly id: string; readonly email: string } | null,
    session: null,
    status: "unauthenticated" as "loading" | "authenticated" | "unauthenticated",
    callbackStatus: null,
    isEnabled: true,
    authMode: "optional" as "optional" | "required",
    isAuthRequired: false,
    allowsAnonymousAuth: true,
    hasRequiredAccountAuth: false,
    hasBlockingAuthConfigurationError: false,
    signInAnonymously: vi.fn(),
    signInWithWebsite: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    clearCallbackStatus: vi.fn(),
    signOut: vi.fn(),
  },
  fetchOwnProfile: vi.fn(),
  fetchPublicProfile: vi.fn(),
  fetchGlobalLeaderboard: vi.fn(),
  fetchOwnLeaderboardEntry: vi.fn(),
  publishOwnFocusTotal: vi.fn(),
  optOutLeaderboard: vi.fn(),
  trackerGetStatus: vi.fn(),
  trackerGetHourlySummary: vi.fn(),
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  accessibilityGetStatus: vi.fn(),
  accessibilityRequestAccess: vi.fn(),
  openSystemSettingsPane: vi.fn(),
  billingMocks: {
    fetchBillingEntitlement: vi.fn(),
    createIndividualCheckout: vi.fn(),
    createBillingPortalSession: vi.fn(),
  },
  appFeatureSwitches: {
    devOnboardingBypassEnabled: false,
    devOnboardingAuthBypassEnabled: false,
  },
}));

vi.mock("./features/auth/AuthContext", () => ({
  AuthProvider: ({ children }: { readonly children: ReactNode }) => children,
  useAuth: () => authState,
}));

vi.mock("./features/profile/profileService", () => ({
  fetchOwnProfile,
  fetchPublicProfile,
  saveOwnProfile: vi.fn(),
  fallbackDisplayName: (email?: string | null) => email?.split("@")[0]?.trim() || "drifty",
}));

vi.mock("./features/leaderboard/leaderboardService", () => ({
  DEFAULT_LEADERBOARD_PERIOD: "weekly",
  LEADERBOARD_PERIODS: ["daily", "weekly", "monthly"],
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  publishOwnFocusTotal,
  optOutLeaderboard,
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
  PROJECT_CLASSIFICATION_PREVIEW_ENABLED: true,
  RELEASE_CHANNEL: "dev",
  TEAMS_BETA_ENABLED: true,
  WATCHER_PEEK_PROTOTYPE_ENABLED: true,
  isDevOnboardingBypassEnabled: () => appFeatureSwitches.devOnboardingBypassEnabled,
}));

import App from "./App";

type ProfileResult = {
  readonly success: true;
  readonly error: null;
  readonly data: null;
};

function createDeferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
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

async function clickEnabledAction(name: RegExp = /^continue$/i) {
  const button = (await screen.findByRole("button", { name })) as HTMLButtonElement;
  await waitFor(() => {
    expect(button.disabled).toBe(false);
  });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function clickButton(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function advanceToAccountStep() {
  await screen.findByRole("dialog", { name: /welcome to drifty/i });
  await clickEnabledAction(/^continue$/i);
  await screen.findByRole("dialog", { name: /connect your account/i });
}

describe("App onboarding cloud login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    authState.user = null;
    authState.status = "unauthenticated";
    authState.hasRequiredAccountAuth = false;
    authState.signInWithWebsite.mockResolvedValue({ error: null });
    fetchOwnProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchPublicProfile.mockResolvedValue({ success: true, error: null, data: null });
    fetchGlobalLeaderboard.mockResolvedValue({ success: true, error: null, data: [] });
    fetchOwnLeaderboardEntry.mockResolvedValue({ success: true, error: null, data: null });
    publishOwnFocusTotal.mockResolvedValue({ success: true, error: null, data: null });
    optOutLeaderboard.mockResolvedValue({ success: true, error: null });
    trackerGetStatus.mockResolvedValue(makeTrackerStatus({ running: false }));
    trackerGetHourlySummary.mockResolvedValue([]);
    isPermissionGranted.mockResolvedValue(false);
    requestPermission.mockResolvedValue("granted");
    accessibilityGetStatus.mockResolvedValue({ granted: false });
    accessibilityRequestAccess.mockResolvedValue({ granted: false });
    openSystemSettingsPane.mockResolvedValue(true);
    billingMocks.fetchBillingEntitlement.mockResolvedValue({
      success: true,
      data: { plan: "individual", status: "active", canUseApp: true, trialEndsAt: null, currentPeriodEnd: null },
    });
    billingMocks.createIndividualCheckout.mockResolvedValue({ success: true, data: { url: "https://checkout.example.test" } });
    billingMocks.createBillingPortalSession.mockResolvedValue({ success: true, data: { url: "https://portal.example.test" } });
    appFeatureSwitches.devOnboardingBypassEnabled = false;
    appFeatureSwitches.devOnboardingAuthBypassEnabled = false;
  });

  it("keeps the account onboarding step mounted while cloud login profile readiness settles", async () => {
    const profileResult = createDeferred<ProfileResult>();
    const { rerender } = render(<App />);

    await advanceToAccountStep();
    await clickButton(/continue with google/i);
    expect(authState.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();

    fetchOwnProfile.mockReturnValueOnce(profileResult.promise);
    authState.user = { id: "cloud-user-1", email: "cloud@example.com" };
    authState.status = "authenticated";
    authState.hasRequiredAccountAuth = true;

    await act(async () => {
      rerender(<App />);
      await Promise.resolve();
    });

    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: /welcome to drifty/i })).toBeNull();

    await act(async () => {
      profileResult.resolve({ success: true, error: null, data: null });
      await profileResult.promise;
    });

    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  }, 15_000);
});
