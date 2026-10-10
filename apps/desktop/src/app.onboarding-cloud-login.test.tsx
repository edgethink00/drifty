// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { TrackerStatus } from "@drifty/domain";
import type { ReactNode } from "react";
import type { OAuthCallbackStatus } from "./features/auth/AuthContext";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  authState,
  fetchOwnProfile,
  fetchPublicProfile,
  fetchGlobalLeaderboard,
  fetchOwnLeaderboardEntry,
  fetchOwnLeaderboardCheckpoint,
  publishOwnLeaderboardCheckpoint,
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
    callbackStatus: null as OAuthCallbackStatus | null,
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
  fetchOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: null }),
  publishOwnLeaderboardCheckpoint: vi.fn().mockResolvedValue({ success: true, error: null, data: true }),
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
    startCloudTrial: vi.fn(),
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
  useAuthConnectionStatus: () => ({ cloudConnectionStatus: "online" }),
}));

// The entry screen's product picture is covered by OnboardingEntryStep.test; these app flows
// only need the sign-in half, without the picture's animation clock running under jsdom.
vi.mock("./features/onboarding/components/EntryDayDemo", () => ({
  EntryDayDemo: () => null,
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
  fetchOwnLeaderboardCheckpoint,
  publishOwnLeaderboardCheckpoint,
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
  DEV_ONBOARDING_AUTH_SKIP_ENABLED: false,
  DEV_SETTINGS_ENABLED: true,
  DEVELOPER_PRE_RELEASE_UPDATES_ENABLED: true,
  END_OF_DAY_REVIEW_AUTOMATIC_NOTIFICATIONS_ENABLED: false,
  END_OF_DAY_REVIEW_DEV_PREVIEW_ENABLED: true,
  END_OF_DAY_REVIEW_NOTIFICATIONS_ENABLED: false,
  isDevOnboardingBypassEnabled: () => appFeatureSwitches.devOnboardingBypassEnabled,
  isDevOnboardingForceOpenEnabled: () => false,
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

async function clickButton(name: RegExp) {
  const button = await screen.findByRole("button", { name });
  await act(async () => {
    fireEvent.click(button);
  });
}

async function advanceToAccountStep() {
  await screen.findByRole("dialog", { name: /connect your account/i });
}

/** Email sign-in opens in place on the entry screen, under its own heading. */
async function findInlineEmailForm() {
  const heading = await screen.findByRole("heading", { name: /sign in to drifty/i, level: 2 });
  expect(screen.queryByRole("dialog", { name: /sign in to drifty/i })).toBeNull();
  return heading.closest("section") as HTMLElement;
}

describe("App onboarding cloud login", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    authState.user = null;
    authState.status = "unauthenticated";
    authState.callbackStatus = null;
    authState.hasRequiredAccountAuth = false;
    authState.signInWithWebsite.mockResolvedValue({ error: null });
    authState.signInWithGoogle.mockResolvedValue({ error: null });
    authState.signInWithEmail.mockResolvedValue({ error: null });
    authState.signUpWithEmail.mockResolvedValue({ error: null, needsEmailConfirmation: false });
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
    accessibilityGetStatus.mockResolvedValue({ granted: false, required: true });
    accessibilityRequestAccess.mockResolvedValue({ granted: false, required: true });
    openSystemSettingsPane.mockResolvedValue(true);
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
    expect(screen.queryByRole("button", { name: /continue with google/i })).toBeNull();

    await act(async () => {
      profileResult.resolve({ success: true, error: null, data: null });
      await profileResult.promise;
    });

    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  }, 15_000);

  it("keeps failed in-app email sign-in recoverable inside account onboarding", async () => {
    authState.signInWithEmail.mockResolvedValueOnce({ error: new Error("Invalid email or password.") });
    render(<App />);

    await advanceToAccountStep();
    await clickButton(/continue with email/i);
    const authDialog = await findInlineEmailForm();
    fireEvent.change(within(authDialog).getByLabelText(/^email$/i), { target: { value: "alex@example.com" } });
    fireEvent.change(within(authDialog).getByLabelText(/^password$/i), { target: { value: "incorrect password" } });
    fireEvent.click(within(authDialog).getByRole("button", { name: /^sign in$/i }));

    expect((await within(authDialog).findByRole("alert")).textContent).toContain("Invalid email or password.");
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /other sign-in options/i }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
    });
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
  });

  it("creates an email account from onboarding and resumes after confirmation", async () => {
    authState.signUpWithEmail.mockResolvedValueOnce({ error: null, needsEmailConfirmation: true });
    const { rerender } = render(<App />);

    await advanceToAccountStep();
    await clickButton(/continue with email/i);
    const authDialog = await findInlineEmailForm();
    expect(within(authDialog).queryByRole("button", { name: /continue with google/i })).toBeNull();

    fireEvent.click(within(authDialog).getByRole("button", { name: /^create account$/i }));
    fireEvent.change(within(authDialog).getByLabelText(/^email$/i), { target: { value: " new@example.com " } });
    fireEvent.change(within(authDialog).getByLabelText(/^password$/i), { target: { value: "correct horse battery" } });
    fireEvent.click(within(authDialog).getByRole("button", { name: /^create account$/i }));

    await waitFor(() => {
      expect(authState.signUpWithEmail).toHaveBeenCalledWith("new@example.com", "correct horse battery");
    });
    expect((await within(authDialog).findByRole("status")).textContent).toMatch(/confirm your email and drifty will reopen automatically/i);
    expect(screen.getByRole("dialog", { name: /connect your account/i })).toBeTruthy();
    expect(authState.signInWithGoogle).not.toHaveBeenCalled();

    authState.user = { id: "cloud-user-signup", email: "new@example.com" };
    authState.status = "authenticated";
    authState.hasRequiredAccountAuth = true;

    await act(async () => {
      rerender(<App />);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /create your account/i })).toBeNull();
    });
    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
  });

  it("closes in-app email auth and resumes onboarding after account authentication succeeds", async () => {
    const { rerender } = render(<App />);

    await advanceToAccountStep();
    await clickButton(/continue with email/i);
    const authDialog = await findInlineEmailForm();
    fireEvent.change(within(authDialog).getByLabelText(/^email$/i), { target: { value: "alex@example.com" } });
    fireEvent.change(within(authDialog).getByLabelText(/^password$/i), { target: { value: "correct horse battery" } });
    fireEvent.click(within(authDialog).getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => {
      expect(authState.signInWithEmail).toHaveBeenCalledWith("alex@example.com", "correct horse battery");
    });
    authState.user = { id: "cloud-user-email", email: "alex@example.com" };
    authState.status = "authenticated";
    authState.hasRequiredAccountAuth = true;

    await act(async () => {
      rerender(<App />);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: /sign in to drifty/i })).toBeNull();
    });
    expect(await screen.findByRole("dialog", { name: /what kind of work do you do/i }, { timeout: 6_000 })).toBeTruthy();
    expect(authState.signInWithWebsite).not.toHaveBeenCalled();
  }, 15_000);

  it("shows Google browser handoff status on the account onboarding step", async () => {
    authState.callbackStatus = {
      phase: "waiting",
      message: "Browser opened. Waiting for sign-in to return to Drifty.",
      method: "google",
      googleAction: "reopen",
    };

    render(<App />);

    await advanceToAccountStep();

    // Progress is carried by the button itself; no notice box appears.
    expect(screen.queryByRole("status")).toBeNull();
    const reopenButton = screen.getByRole("button", { name: /open google sign-in again/i }) as HTMLButtonElement;
    expect(reopenButton.disabled).toBe(false);
  });

  it("only disables Google handoff while the browser is opening or the callback is processing", async () => {
    authState.callbackStatus = {
      phase: "waiting",
      message: "Opening Google sign-in...",
      method: "google",
      googleAction: "opening",
    };

    const { rerender } = render(<App />);
    await advanceToAccountStep();

    expect((screen.getByRole("button", { name: /opening/i }) as HTMLButtonElement).disabled).toBe(true);

    authState.callbackStatus = {
      phase: "received",
      message: "OAuth callback received.",
      method: "google",
    };
    rerender(<App />);
    expect((screen.getByRole("button", { name: /opening/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows Google browser handoff failures on the account onboarding step", async () => {
    authState.callbackStatus = {
      phase: "failed",
      message: "Google sign-in expired after 5 minutes. Try again.",
      method: "google",
      googleAction: "retry",
    };

    render(<App />);

    await advanceToAccountStep();

    expect(screen.getByRole("alert").textContent).toContain("Google sign-in expired after 5 minutes. Try again.");
    const retryButton = screen.getByRole("button", { name: /try google sign-in again/i }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(false);
  });
});
